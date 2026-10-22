// =============================================================================
// server/tools/pdf-generator.ts
// LINGORA SEEK 3.9-c — PDF Generator Router (Integration Fix)
// P9c-diag (10 sep 2026): self-validation round-trip. Immediately after
// generation, attempt to re-parse the produced bytes with pdf-lib's own
// PDFDocument.load(). Structural check only — does not certify visual render.
// P9c chain-of-custody (10 sep 2026): SHA-256 of the exact bytes produced,
// computed server-side before any base64/transport handling. Lets DAE verify
// byte-for-byte integrity of whatever copy later reaches inspection, instead
// of trusting the transport path. Purely additive — no rendering logic changed.
// =============================================================================
import { createHash } from 'crypto';
import type { LessonContent } from './pdf/generateLessonPdf';
import type { CourseContent }  from './pdf/generateCoursePdf';
import type { ExportTurn } from './pdf/conversationExport';

let uploadToS3: ((buf: Buffer, key: string, mime: string) => Promise<string | null>) | null = null;
try {
  if (process.env.S3_BUCKET) {
    const storageModule = require('./storage');
    uploadToS3 = storageModule.uploadToS3;
  }
} catch { /* S3 not configured */ }

export interface GeneratePDFParams {
  title: string;
  content: string;
  filename?: string;
  lessonContent?: LessonContent;
  courseContent?: CourseContent;
  conversationTurns?: ExportTurn[];
}

export interface GeneratePDFResult {
  success: boolean;
  url?: string;
  method?: 'dataurl' | 's3';
  error?: string;
  message?: string;
  renderValidated?: boolean;
  renderValidationError?: string;
  pdfByteLength?: number;
  pdfSha256?: string;
}

async function validateRender(pdfBytes: Uint8Array): Promise<{ ok: boolean; error?: string }> {
  try {
    const { PDFDocument: PDFDocumentCheck } = await import('pdf-lib');
    const reloaded = await PDFDocumentCheck.load(pdfBytes);
    // Touch page count to force parsing of the page tree, not just the header.
    void reloaded.getPageCount();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function generatePDF(params: GeneratePDFParams): Promise<GeneratePDFResult> {
  try {
    let pdfBytes: Uint8Array;

    // One document pipeline for all languages, all product artifacts,
    // lessons and verbatim conversation exports. Only HTML generation varies
    // by document TYPE; PDF rendering never branches by writing system.
    const { renderDocumentPdf, transcriptPrintHtml } = await import('./pdf/renderDocumentPdf');
    let html: string;
    if (params.lessonContent) {
      const { renderLessonHtml } = await import('./pdf/generateLessonPdf');
      html = renderLessonHtml(params.lessonContent);
    } else if (params.courseContent) {
      const { renderArtifactHtml } = await import('./web/renderArtifactHtml');
      html = renderArtifactHtml(params.courseContent);
    } else if (params.conversationTurns) {
      const { renderConversationExportHtml } = await import('./pdf/conversationExport');
      html = renderConversationExportHtml(params.title, params.conversationTurns);
    } else {
      html = transcriptPrintHtml(params.title, params.content);
    }
    pdfBytes = await renderDocumentPdf(html, {
      layout: params.lessonContent ? 'lesson' : 'document',
    });

    const validation = await validateRender(pdfBytes);
    if (!validation.ok) {
      return { success: false, error: 'render_validation_failed', message: validation.error ?? 'PDF structural validation failed', renderValidated: false, renderValidationError: validation.error };
    }
    const buffer  = Buffer.from(pdfBytes);
    const sha256  = createHash('sha256').update(buffer).digest('hex');
    const key     = `pdfs/${params.filename ?? `lingora-${Date.now()}`}.pdf`;

    if (uploadToS3) {
      try {
        const s3Url = await uploadToS3(buffer, key, 'application/pdf');
        if (s3Url) {
          return {
            success: true,
            url: s3Url,
            method: 's3',
            renderValidated: validation.ok,
            renderValidationError: validation.error,
            pdfByteLength: pdfBytes.length,
            pdfSha256: sha256,
          };
        }
      } catch (s3Err) {
        console.warn('[pdf-generator] S3 upload failed, using data URL fallback:', s3Err);
      }
    }

    const dataUrl = 'data:application/pdf;base64,' + buffer.toString('base64');
    return {
      success: true,
      url: dataUrl,
      method: 'dataurl',
      renderValidated: validation.ok,
      renderValidationError: validation.error,
      pdfByteLength: pdfBytes.length,
      pdfSha256: sha256,
    };

  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[pdf-generator] generation failed:', msg);
    return { success: false, error: 'generation_failed', message: msg };
  }
}

