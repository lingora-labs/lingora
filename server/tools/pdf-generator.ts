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
import { CANONICAL_PRODUCT_URL } from '../../lib/product';

function toPdfSafeText(s: string, maxLen: number = Number.MAX_SAFE_INTEGER): string {
  return String(s ?? '')
    .replace(/◆/g, '-')
    .replace(/▶/g, '>')
    .replace(/→/g, '->')
    .replace(/[–—]/g, '-')
    .replace(/[══]/g, '=')
    .replace(/[──]/g, '-')
    .replace(/💡/g, 'TIP')
    .replace(/[·]/g, '.')
    .replace(/[^ -~áéíóúüñ¿¡ÁÉÍÓÚÜÑàèìòùâêîôûçœæÀÈÌÒÙÂÊÎÔÛÇŒÆ]/g, ' ')
    .slice(0, maxLen);
}

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

    if (params.lessonContent) {
      const { generateLessonPdf } = await import('./pdf/generateLessonPdf');
      pdfBytes = await generateLessonPdf(params.lessonContent);
    } else if (params.courseContent) {
      const { renderCoursePdf } = await import('./pdf/generateCoursePdf');
      pdfBytes = await renderCoursePdf(params.courseContent);
    } else {
      pdfBytes = await generatePlainTextPdf(params.title, params.content);
    }

    const validation = await validateRender(pdfBytes);
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

async function generatePlainTextPdf(title: string, content: string): Promise<Uint8Array> {
  const { PDFDocument, rgb, StandardFonts } = await import('pdf-lib');

  const doc = await PDFDocument.create();
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const PAGE_W = 595.28;
  const PAGE_H = 841.89;
  const LEFT = 48;
  const MAX_WIDTH = PAGE_W - 2 * LEFT;

  const NAVY = rgb(0.05, 0.10, 0.16);
  const TEAL = rgb(0.00, 0.79, 0.66);
  const DKGRAY = rgb(0.20, 0.25, 0.30);
  const MIDGRAY = rgb(0.78, 0.84, 0.90);
  const WHITE = rgb(1, 1, 1);

  // Every page has a genuine header/footer; no first-page-only rendering.
  function newPage() {
    const page = doc.addPage([PAGE_W, PAGE_H]);
    page.drawRectangle({ x: 0, y: PAGE_H - 56, width: PAGE_W, height: 56, color: NAVY });
    page.drawText('LINGORA', { x: LEFT, y: PAGE_H - 34, size: 16, font: bold, color: WHITE });
    page.drawText(toPdfSafeText(title, 70), { x: LEFT, y: PAGE_H - 50, size: 9, font: regular, color: TEAL });
    page.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: 26, color: NAVY });
    page.drawText(`${CANONICAL_PRODUCT_URL.replace('https://', '')} - Exportado desde LINGORA`, {
      x: LEFT, y: 9, size: 7.5, font: regular, color: MIDGRAY,
    });
    return page;
  }

  // Measure glyph widths, not arbitrary character counts. Long unbroken
  // tokens are split across lines without discarding any of their characters.
  function wrap(raw: string, size: number, useBold: boolean): string[] {
    const cleaned = toPdfSafeText(raw, Number.MAX_SAFE_INTEGER);
    if (!cleaned.trim()) return [''];
    const font = useBold ? bold : regular;
    const words = cleaned.trim().split(/\s+/);
    const lines: string[] = [];
    let line = '';
    for (const word of words) {
      const parts: string[] = [];
      let segment = '';
      for (const char of word) {
        if (segment && font.widthOfTextAtSize(segment + char, size) > MAX_WIDTH) {
          parts.push(segment);
          segment = char;
        } else segment += char;
      }
      if (segment) parts.push(segment);
      for (const part of parts) {
        const next = line ? line + ' ' + part : part;
        if (line && font.widthOfTextAtSize(next, size) > MAX_WIDTH) {
          lines.push(line);
          line = part;
        } else {
          line = next;
        }
      }
    }
    if (line) lines.push(line);
    return lines.length ? lines : [''];
  }

  let page = newPage();
  let y = PAGE_H - 72;
  const ensureLine = () => {
    if (y < 46) {
      page = newPage();
      y = PAGE_H - 72;
    }
  };
  for (const rawLine of String(content ?? '').split('\n')) {
    const isHeader = rawLine.startsWith('══') || rawLine.startsWith('──');
    const isMentor = rawLine.startsWith('◆');
    const isStudent = rawLine.startsWith('▶');
    if (isHeader) {
      ensureLine();
      page.drawLine({ start: { x: LEFT, y: y - 4 }, end: { x: PAGE_W - LEFT, y: y - 4 }, thickness: 0.5, color: TEAL });
      y -= 10;
      continue;
    }
    const size = isMentor || isStudent ? 9.5 : 9;
    const font = isMentor || isStudent ? bold : regular;
    const color = isMentor ? NAVY : DKGRAY;
    for (const line of wrap(rawLine, size, isMentor || isStudent)) {
      ensureLine();
      if (line) page.drawText(line, { x: LEFT, y, size, font, color });
      y -= 13;
    }
  }

  return doc.save();
}
