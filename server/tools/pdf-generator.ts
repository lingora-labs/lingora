// =============================================================================
// server/tools/pdf-generator.ts
// LINGORA 7.5 — the one PDF path: canonical document page (lib/content) → Chromium.
// Every PDF LINGORA delivers (Tutor delivery, "download this material", the
// conversation export) is the 'print' surface of renderDocumentPage(). No LLM
// composer, no raw-transcript template, no second Markdown converter.
// Self-validation: the produced bytes are re-parsed with pdf-lib, and their
// SHA-256 is recorded before any transport, as before.
// =============================================================================
import { createHash } from 'crypto';
import type { ExportTurn } from './pdf/conversationExport';
import type { DocumentPage } from '../../lib/content/document-page';

let uploadToS3: ((buf: Buffer, key: string, mime: string) => Promise<string | null>) | null = null;
try {
  if (process.env.S3_BUCKET) {
    const storageModule = require('./storage');
    uploadToS3 = storageModule.uploadToS3;
  }
} catch { /* S3 not configured */ }

export interface GeneratePDFParams {
  title: string;
  filename?: string;
  /** A canonical document (sections of Tutor text + artifacts). */
  document?: DocumentPage;
  /** The student's conversation, one section per turn. */
  conversationTurns?: ExportTurn[];
  /** Already-rendered print page from renderDocumentPage(…, 'print'). */
  html?: string;
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
  pageCount?: number;
}

async function validateRender(pdfBytes: Uint8Array): Promise<{ ok: boolean; pages?: number; error?: string }> {
  try {
    const { PDFDocument } = await import('pdf-lib');
    const reloaded = await PDFDocument.load(pdfBytes);
    return { ok: true, pages: reloaded.getPageCount() };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function generatePDF(params: GeneratePDFParams): Promise<GeneratePDFResult> {
  try {
    const { renderDocumentPage } = await import('../../lib/content/document-page');
    let html: string;
    if (params.html) html = params.html;
    else if (params.document) html = renderDocumentPage(params.document, 'print');
    else if (params.conversationTurns) {
      const { renderConversationExportHtml } = await import('./pdf/conversationExport');
      html = renderConversationExportHtml(params.title, params.conversationTurns);
    } else {
      return { success: false, error: 'generation_failed', message: 'export_missing_artifact_content:document' };
    }
    const { renderDocumentPdf } = await import('./pdf/renderDocumentPdf');
    const pdfBytes = await renderDocumentPdf(html);

    const validation = await validateRender(pdfBytes);
    if (!validation.ok) {
      return { success: false, error: 'render_validation_failed', message: validation.error ?? 'PDF structural validation failed', renderValidated: false, renderValidationError: validation.error };
    }
    const buffer = Buffer.from(pdfBytes);
    const sha256 = createHash('sha256').update(buffer).digest('hex');
    const key = `pdfs/${params.filename ?? `lingora-${Date.now()}`}.pdf`;
    const base = { renderValidated: true, pdfByteLength: pdfBytes.length, pdfSha256: sha256, pageCount: validation.pages };

    if (uploadToS3) {
      try {
        const s3Url = await uploadToS3(buffer, key, 'application/pdf');
        if (s3Url) return { success: true, url: s3Url, method: 's3', ...base };
      } catch (s3Err) {
        console.warn('[pdf-generator] S3 upload failed, using data URL fallback:', s3Err);
      }
    }
    return { success: true, url: 'data:application/pdf;base64,' + buffer.toString('base64'), method: 'dataurl', ...base };
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[pdf-generator] generation failed:', msg);
    return { success: false, error: 'generation_failed', message: msg };
  }
}
