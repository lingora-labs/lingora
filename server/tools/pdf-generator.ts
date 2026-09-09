// =============================================================================
// server/tools/pdf-generator.ts
// LINGORA SEEK 3.9-c — PDF Generator Router (Integration Fix)
// =============================================================================
import type { LessonContent } from './pdf/generateLessonPdf';
import type { CourseContent }  from './pdf/generateCoursePdf';
import { CANONICAL_PRODUCT_URL } from '../../lib/product';

function toPdfSafeText(s: string, maxLen: number = 400): string {
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

    const buffer  = Buffer.from(pdfBytes);
    const key     = `pdfs/${params.filename ?? `lingora-${Date.now()}`}.pdf`;

    if (uploadToS3) {
      try {
        const s3Url = await uploadToS3(buffer, key, 'application/pdf');
        if (s3Url) return { success: true, url: s3Url, method: 's3' };
      } catch (s3Err) {
        console.warn('[pdf-generator] S3 upload failed, using data URL fallback:', s3Err);
      }
    }

    const dataUrl = 'data:application/pdf;base64,' + buffer.toString('base64');
    return { success: true, url: dataUrl, method: 'dataurl' };

  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[pdf-generator] generation failed:', msg);
    return { success: false, error: 'generation_failed', message: msg };
  }
}

async function generatePlainTextPdf(title: string, content: string): Promise<Uint8Array> {
  const { PDFDocument, rgb, StandardFonts } = await import('pdf-lib');

  const doc     = await PDFDocument.create();
  const bold    = await doc.embedFont(StandardFonts.HelveticaBold);
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const page    = doc.addPage([595.28, 841.89]);
  const { height } = page.getSize();

  const NAVY    = rgb(0.05, 0.10, 0.16);
  const TEAL    = rgb(0.00, 0.79, 0.66);
  const DKGRAY  = rgb(0.20, 0.25, 0.30);
  const MIDGRAY = rgb(0.78, 0.84, 0.90);
  const WHITE   = rgb(1, 1, 1);

  page.drawRectangle({ x: 0, y: height - 56, width: 595.28, height: 56, color: NAVY });
  page.drawText('LINGORA', { x: 48, y: height - 34, size: 16, font: bold, color: WHITE });
  page.drawText(toPdfSafeText(title, 70), { x: 48, y: height - 50, size: 9, font: regular, color: TEAL });

  const lines = String(content).split('\n');
  let y = height - 72;
  for (const rawLine of lines) {
    if (y < 40) break;
    const line      = toPdfSafeText(rawLine.slice(0, 88));
    const isHeader  = rawLine.startsWith('══') || rawLine.startsWith('──');
    const isMentor  = rawLine.startsWith('◆');
    const isStudent = rawLine.startsWith('▶');

    if (isHeader) {
      page.drawLine({ start: { x: 48, y: y - 4 }, end: { x: 548, y: y - 4 }, thickness: 0.5, color: TEAL });
      y -= 10;
      continue;
    }
    page.drawText(line, {
      x: 48, y,
      size:  isMentor || isStudent ? 9.5 : 9,
      font:  isMentor || isStudent ? bold : regular,
      color: isMentor ? NAVY : DKGRAY,
    });
    y -= 13;
  }

  page.drawRectangle({ x: 0, y: 0, width: 595.28, height: 26, color: NAVY });
  page.drawText(`${CANONICAL_PRODUCT_URL.replace('https://', '')} - Exportado desde LINGORA`, { x: 48, y: 9, size: 7.5, font: regular, color: MIDGRAY });

  return doc.save();
}
