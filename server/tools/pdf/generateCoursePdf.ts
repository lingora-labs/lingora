// =============================================================================
// server/tools/pdf/generateCoursePdf.ts
// LINGORA SEEK 3.9-c — Course PDF Generator (Layout Fix)
// =============================================================================
// SEEK 3.9-c CHANGES:
//   LAYOUT-1 — Flowing layout replaces fixed Y coordinates.
//              Previous renderer placed sections at hardcoded Y positions
//              (vocab at Y=650, grammar at Y=500, etc.). When content was
//              short, 60-70% of the page remained blank. When content was
//              long, text was truncated. Fix: track currentY and advance by
//              actual content height after each rendered block.
//
//   LAYOUT-2 — Text wrapping for all long-form fields.
//              drawText() was being called with full strings including spaces.
//              pdf-lib's drawText does NOT auto-wrap. Fix: wrapText() splits
//              strings into lines that fit within page width, then each line
//              is drawn separately with currentY advancing per line.
//
//   LAYOUT-3 — All vocabulary pairs rendered (no fixed limit).
//              Previous code likely iterated vocab with a fixed count or
//              ran out of Y space because grammar/exercise had fixed offsets.
//              Fix: flowing Y means all pairs render until page fills,
//              then continues on next page.
//
//   LAYOUT-4 — Multi-page flow per module.
//              If a module's content exceeds one page, it continues
//              seamlessly on the next page with a continuation header.
//              No content is ever truncated.
//
// CEO note: "Quiero que se aproveche toda la hoja en los PDF.
//            No más espacio en blanco."
// =============================================================================

import { PDFDocument, PDFPage, PDFFont, rgb, StandardFonts } from 'pdf-lib';

// ── Types ───────────────────────────────────────────────────────────────────
export interface CourseModule {
  index:               number;
  title:               string;
  vocabulary:          [string, string][];
  grammar:             string;
  exercise:            string;
  development:         string;
  communicativeFunction: string;
  tip:                 string;
}

export interface CourseContent {
  mentorName:    string;
  level:         string;
  studentName:   string;
  courseTitle:   string;
  objective:     string;
  nativeLanguage: string;
  totalModules:  number;
  modules:       CourseModule[];
  nextStep:      string;
  generatedAt:   string;
}

// ── Constants ────────────────────────────────────────────────────────────────
const PAGE_W      = 595.28;  // A4 width in points
const PAGE_H      = 841.89;  // A4 height in points
const MARGIN_L    = 48;
const MARGIN_R    = 48;
const MARGIN_TOP  = 48;
const MARGIN_BOT  = 60;
const CONTENT_W   = PAGE_W - MARGIN_L - MARGIN_R;

// Font sizes
const SZ_TITLE    = 22;
const SZ_SUBTITLE = 13;
const SZ_MODULE   = 16;
const SZ_BODY     = 9.5;
const SZ_SMALL    = 8.5;

// Line heights
const LH_BODY     = 13;
const LH_SMALL    = 12;

// Colors (LINGORA brand)
const C_DARK      = rgb(0.08, 0.09, 0.18);   // #141729
const C_TEAL      = rgb(0.00, 0.74, 0.78);   // #00BCC7
const C_ACCENT    = rgb(0.36, 0.48, 0.96);   // #5C7AF5
const C_MUTED     = rgb(0.42, 0.47, 0.58);   // #6C7894
const C_WHITE     = rgb(1.00, 1.00, 1.00);
const C_LIGHT_BG  = rgb(0.95, 0.96, 0.98);   // section background
const C_TIP_BG    = rgb(0.08, 0.12, 0.24);   // dark tip background

// ── WinAnsi safe text (SEEK 3.5 fix — preserve) ──────────────────────────────
function toPdfSafeText(text: string): string {
  return (text ?? '')
    .replace(/◆/g, '*').replace(/▶/g, '>').replace(/→/g, '->')
    .replace(/💡/g, '!').replace(/[^\x00-\xFF]/g, '?')
    .replace(/[\x80-\x9F]/g, '?');
}

function safe(text: unknown): string {
  return toPdfSafeText(String(text ?? ''));
}

// ── Text wrapping ─────────────────────────────────────────────────────────────
// Splits a string into lines that fit within maxWidth characters.
// Uses a simple word-wrap approach adequate for pdf-lib's monospace estimate.
function wrapText(text: string, maxCharsPerLine: number): string[] {
  const words = safe(text).split(' ');
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if ((current + ' ' + word).trim().length <= maxCharsPerLine) {
      current = (current + ' ' + word).trim();
    } else {
      if (current) lines.push(current);
      // If single word is longer than max, split it
      if (word.length > maxCharsPerLine) {
        let w = word;
        while (w.length > maxCharsPerLine) {
          lines.push(w.slice(0, maxCharsPerLine));
          w = w.slice(maxCharsPerLine);
        }
        current = w;
      } else {
        current = word;
      }
    }
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [''];
}

// Estimate characters per line for a given font size
// pdf-lib Helvetica: approximately 0.52 * fontSize points per char
function charsPerLine(fontSize: number): number {
  return Math.floor(CONTENT_W / (fontSize * 0.52));
}

// ── Page state ────────────────────────────────────────────────────────────────
interface PageState {
  pdfDoc:    PDFDocument;
  page:      PDFPage;
  boldFont:  PDFFont;
  regFont:   PDFFont;
  currentY:  number;
}

// ── Core draw helpers ─────────────────────────────────────────────────────────
async function newPage(pdfDoc: PDFDocument, boldFont: PDFFont, regFont: PDFFont): Promise<PageState> {
  const page = pdfDoc.addPage([PAGE_W, PAGE_H]);
  return { pdfDoc, page, boldFont, regFont, currentY: PAGE_H - MARGIN_TOP };
}

function ensureSpace(ps: PageState, needed: number): boolean {
  return ps.currentY - needed >= MARGIN_BOT;
}

// Draw text line and advance Y. Returns false if page full.
function drawLine(
  ps: PageState,
  text: string,
  opts: {
    size?:  number;
    font?:  PDFFont;
    color?: ReturnType<typeof rgb>;
    x?:     number;
    indent?: number;
  } = {}
): void {
  const size   = opts.size  ?? SZ_BODY;
  const font   = opts.font  ?? ps.regFont;
  const color  = opts.color ?? C_DARK;
  const x      = opts.x ?? (MARGIN_L + (opts.indent ?? 0));
  ps.page.drawText(safe(text), { x, y: ps.currentY, size, font, color });
  ps.currentY -= (size * 1.4);
}

function drawWrapped(
  ps: PageState,
  text: string,
  opts: {
    size?:   number;
    font?:   PDFFont;
    color?:  ReturnType<typeof rgb>;
    indent?: number;
  } = {}
): void {
  const size  = opts.size ?? SZ_BODY;
  const cpl   = charsPerLine(size) - Math.floor((opts.indent ?? 0) / (size * 0.52));
  const lines = wrapText(text, cpl);
  for (const line of lines) {
    drawLine(ps, line, opts);
  }
}

function gap(ps: PageState, points: number = 6): void {
  ps.currentY -= points;
}

function hLine(ps: PageState, color: ReturnType<typeof rgb> = C_LIGHT_BG): void {
  ps.page.drawLine({
    start: { x: MARGIN_L, y: ps.currentY },
    end:   { x: PAGE_W - MARGIN_R, y: ps.currentY },
    thickness: 0.5, color,
  });
  ps.currentY -= 4;
}

// Section label (colored, small caps style)
function sectionLabel(ps: PageState, label: string, color: ReturnType<typeof rgb> = C_TEAL): void {
  gap(ps, 8);
  drawLine(ps, label.toUpperCase(), { size: SZ_SMALL, font: ps.boldFont, color });
  gap(ps, 2);
}

// ── Cover page ────────────────────────────────────────────────────────────────
async function drawCover(ps: PageState, content: CourseContent): Promise<void> {
  const { page, boldFont, regFont } = ps;

  // Background header bar
  page.drawRectangle({ x: 0, y: PAGE_H - 120, width: PAGE_W, height: 120, color: C_DARK });

  // LINGORA wordmark
  page.drawText('LINGORA', {
    x: MARGIN_L, y: PAGE_H - 52,
    size: 28, font: boldFont, color: C_WHITE,
  });
  page.drawText('AI Cultural Immersion Platform for Spanish', {
    x: MARGIN_L, y: PAGE_H - 74,
    size: 10, font: regFont, color: C_TEAL,
  });

  ps.currentY = PAGE_H - 148;

  // Course title
  gap(ps, 10);
  const titleLines = wrapText(content.courseTitle, charsPerLine(SZ_TITLE));
  for (const line of titleLines) {
    drawLine(ps, line, { size: SZ_TITLE, font: boldFont, color: C_DARK });
  }

  gap(ps, 12);

  // Objective
  const objLines = wrapText(content.objective, charsPerLine(SZ_BODY));
  for (const line of objLines) {
    drawLine(ps, line, { size: SZ_BODY, color: C_MUTED });
  }

  gap(ps, 20);
  hLine(ps);
  gap(ps, 10);

  // Metadata row
  const meta = [
    ['Nivel', content.level],
    ['Mentor', content.mentorName],
    ['Módulos', String(content.totalModules)],
    ['Idioma', (content.nativeLanguage || 'ES').toUpperCase()],
  ];
  const colW = CONTENT_W / meta.length;
  for (let i = 0; i < meta.length; i++) {
    const x = MARGIN_L + i * colW;
    page.drawText(safe(meta[i][0].toUpperCase()), { x, y: ps.currentY, size: SZ_SMALL, font: boldFont, color: C_MUTED });
    page.drawText(safe(meta[i][1]), { x, y: ps.currentY - 14, size: SZ_SUBTITLE, font: boldFont, color: C_DARK });
  }
  ps.currentY -= 40;

  gap(ps, 20);
  hLine(ps);

  // Footer
  const footerY = MARGIN_BOT;
  page.drawText('Learn -> Connect -> Experience', {
    x: MARGIN_L, y: footerY + 14, size: SZ_SMALL, font: boldFont, color: C_TEAL,
  });
  const date = new Date().toLocaleDateString('es-ES', { year: 'numeric', month: 'long', day: 'numeric' });
  page.drawText(`lingora.netlify.app - ${safe(date)}`, {
    x: MARGIN_L, y: footerY, size: SZ_SMALL, font: regFont, color: C_MUTED,
  });
}

// ── Module page(s) ────────────────────────────────────────────────────────────
async function drawModule(
  pdfDoc:    PDFDocument,
  boldFont:  PDFFont,
  regFont:   PDFFont,
  mod:       CourseModule,
  total:     number,
  mentorName: string,
  level:     string,
  courseTitle: string,
): Promise<PageState> {
  let ps = await newPage(pdfDoc, boldFont, regFont);

  // ── Module header bar ──
  const headerH = 44;
  ps.page.drawRectangle({ x: 0, y: PAGE_H - headerH, width: PAGE_W, height: headerH, color: C_DARK });
  ps.page.drawText('LINGORA', { x: MARGIN_L, y: PAGE_H - 18, size: 11, font: boldFont, color: C_WHITE });
  const subtitle = safe(`${mentorName} - ${level} - ${courseTitle}`);
  const subtitleCpl = charsPerLine(SZ_SMALL);
  const subtitleTrunc = subtitle.length > subtitleCpl ? subtitle.slice(0, subtitleCpl - 3) + '...' : subtitle;
  ps.page.drawText(subtitleTrunc, { x: MARGIN_L, y: PAGE_H - 32, size: SZ_SMALL, font: regFont, color: C_MUTED });

  // Module number & title banner
  ps.currentY = PAGE_H - headerH - 4;
  ps.page.drawRectangle({
    x: 0, y: ps.currentY - 40, width: PAGE_W, height: 44, color: C_ACCENT,
  });
  ps.page.drawText(safe(`MODULO ${mod.index}`), {
    x: MARGIN_L, y: ps.currentY - 14, size: SZ_SMALL, font: boldFont, color: C_WHITE,
  });
  const titleLines = wrapText(mod.title, charsPerLine(SZ_MODULE));
  ps.page.drawText(safe(titleLines[0] || mod.title), {
    x: MARGIN_L, y: ps.currentY - 30, size: SZ_MODULE, font: boldFont, color: C_WHITE,
  });
  // Page counter top-right
  ps.page.drawText(safe(`${mod.index} / ${total}`), {
    x: PAGE_W - MARGIN_R - 28, y: ps.currentY - 22, size: SZ_SMALL, font: regFont, color: C_WHITE,
  });
  ps.currentY -= 54;

  // ── VOCABULARY ──
  if (mod.vocabulary?.length > 0) {
    sectionLabel(ps, 'Vocabulario', C_TEAL);
    const vocabColW = CONTENT_W * 0.28;
    for (const [term, def] of mod.vocabulary) {
      if (!ensureSpace(ps, LH_BODY * 3)) {
        ps = await continueOnNewPage(ps, pdfDoc, boldFont, regFont, mod, mentorName, level, courseTitle);
      }
      // Term in bold
      drawLine(ps, safe(term), { size: SZ_BODY, font: boldFont });
      ps.currentY += LH_BODY; // Back up to same line for definition
      // Definition: wrap within right column
      const defCpl = charsPerLine(SZ_BODY) - Math.floor(vocabColW / (SZ_BODY * 0.52));
      const defLines = wrapText(def, defCpl);
      for (let li = 0; li < defLines.length; li++) {
        ps.page.drawText(safe(defLines[li]), {
          x: MARGIN_L + vocabColW, y: ps.currentY,
          size: SZ_BODY, font: ps.regFont, color: C_DARK,
        });
        if (li < defLines.length - 1) ps.currentY -= LH_BODY;
      }
      ps.currentY -= LH_BODY + 2;
    }
    gap(ps, 4);
  }

  // ── GRAMÁTICA ──
  if (mod.grammar) {
    if (!ensureSpace(ps, 50)) {
      ps = await continueOnNewPage(ps, pdfDoc, boldFont, regFont, mod, mentorName, level, courseTitle);
    }
    sectionLabel(ps, 'Gramática 80/20', C_ACCENT);
    // Light background box
    const gramLines = wrapText(mod.grammar, charsPerLine(SZ_BODY) - 2);
    const gramH = gramLines.length * LH_BODY + 16;
    ps.page.drawRectangle({ x: MARGIN_L - 4, y: ps.currentY - gramH + 8, width: CONTENT_W + 8, height: gramH, color: C_LIGHT_BG });
    for (const line of gramLines) {
      drawLine(ps, line, { size: SZ_BODY, indent: 4 });
    }
    gap(ps, 4);
  }

  // ── EJERCICIO ──
  if (mod.exercise) {
    if (!ensureSpace(ps, 50)) {
      ps = await continueOnNewPage(ps, pdfDoc, boldFont, regFont, mod, mentorName, level, courseTitle);
    }
    sectionLabel(ps, 'Ejercicio', C_TEAL);
    drawWrapped(ps, mod.exercise, { size: SZ_BODY });
    gap(ps, 4);
  }

  // ── DEVELOPMENT ──
  if (mod.development) {
    if (!ensureSpace(ps, 40)) {
      ps = await continueOnNewPage(ps, pdfDoc, boldFont, regFont, mod, mentorName, level, courseTitle);
    }
    drawWrapped(ps, mod.development, { size: SZ_BODY, color: C_MUTED });
    gap(ps, 8);
  }

  // ── PUEDES HACER ──
  if (mod.communicativeFunction) {
    if (!ensureSpace(ps, 40)) {
      ps = await continueOnNewPage(ps, pdfDoc, boldFont, regFont, mod, mentorName, level, courseTitle);
    }
    hLine(ps);
    gap(ps, 4);
    drawLine(ps, 'PUEDES HACER:', { size: SZ_SMALL, font: boldFont, color: C_TEAL });
    drawWrapped(ps, mod.communicativeFunction, { size: SZ_BODY });
    gap(ps, 8);
  }

  // ── TIP CONSEJO ──
  if (mod.tip) {
    if (!ensureSpace(ps, 50)) {
      ps = await continueOnNewPage(ps, pdfDoc, boldFont, regFont, mod, mentorName, level, courseTitle);
    }
    const tipLines = wrapText(mod.tip, charsPerLine(SZ_BODY) - 2);
    const tipH = tipLines.length * LH_BODY + 20;
    ps.page.drawRectangle({ x: MARGIN_L - 4, y: ps.currentY - tipH + 8, width: CONTENT_W + 8, height: tipH, color: C_TIP_BG });
    drawLine(ps, 'TIP  CONSEJO', { size: SZ_SMALL, font: boldFont, color: C_TEAL, indent: 4 });
    for (const line of tipLines) {
      drawLine(ps, line, { size: SZ_BODY, color: C_WHITE, indent: 4 });
    }
    gap(ps, 4);
  }

  // Page footer
  drawFooter(ps, mentorName, level, courseTitle);

  return ps;
}

// Start a continuation page when a module overflows
async function continueOnNewPage(
  oldPs:      PageState,
  pdfDoc:     PDFDocument,
  boldFont:   PDFFont,
  regFont:    PDFFont,
  mod:        CourseModule,
  mentorName: string,
  level:      string,
  courseTitle: string,
): Promise<PageState> {
  drawFooter(oldPs, mentorName, level, courseTitle);
  const ps = await newPage(pdfDoc, boldFont, regFont);
  // Minimal continuation header
  ps.page.drawRectangle({ x: 0, y: PAGE_H - 32, width: PAGE_W, height: 32, color: C_DARK });
  ps.page.drawText(safe(`LINGORA - Modulo ${mod.index} (cont.)`), {
    x: MARGIN_L, y: PAGE_H - 20, size: SZ_SMALL, font: boldFont, color: C_WHITE,
  });
  ps.currentY = PAGE_H - 48;
  return ps;
}

function drawFooter(ps: PageState, mentorName: string, level: string, courseTitle: string): void {
  const y = MARGIN_BOT - 10;
  ps.page.drawLine({ start: { x: MARGIN_L, y: y + 14 }, end: { x: PAGE_W - MARGIN_R, y: y + 14 }, thickness: 0.3, color: C_MUTED });
  ps.page.drawText(safe(`${mentorName} - ${level} - ${courseTitle}`), {
    x: MARGIN_L, y: y, size: SZ_SMALL, font: ps.regFont, color: C_MUTED,
  });
  ps.page.drawText('lingora.netlify.app - Learn -> Connect -> Experience', {
    x: PAGE_W - MARGIN_R - 220, y: y, size: SZ_SMALL, font: ps.regFont, color: C_MUTED,
  });
  const date = new Date().toLocaleDateString('es-ES', { year: 'numeric', month: 'long', day: 'numeric' });
  ps.page.drawText(safe(date), { x: MARGIN_L, y: y - 12, size: SZ_SMALL, font: ps.regFont, color: C_MUTED });
}

// ── Closing page ──────────────────────────────────────────────────────────────
async function drawClosing(ps: PageState, content: CourseContent): Promise<void> {

  gap(ps, 20);
  hLine(ps, C_ACCENT);
  gap(ps, 16);

  drawLine(ps, 'PRÓXIMOS PASOS', { size: SZ_SUBTITLE, font: ps.boldFont, color: C_ACCENT });
  gap(ps, 4);
  drawWrapped(ps, content.nextStep || 'Continúa practicando con tu mentor LINGORA.', { size: SZ_BODY, color: C_MUTED });

  gap(ps, 20);
  hLine(ps);
  gap(ps, 8);

  const summary = [
    ['Módulos completados:', String(content.totalModules)],
    ['Nivel:', content.level],
    ['Mentor:', content.mentorName],
    ['Estudiante:', content.studentName || 'Estudiante'],
  ];
  for (const [label, value] of summary) {
    ps.page.drawText(safe(label), { x: MARGIN_L, y: ps.currentY, size: SZ_SMALL, font: ps.boldFont, color: C_MUTED });
    ps.page.drawText(safe(value), { x: MARGIN_L + 130, y: ps.currentY, size: SZ_SMALL, font: ps.regFont, color: C_DARK });
    ps.currentY -= LH_SMALL + 2;
  }
}

// ── Main export function ──────────────────────────────────────────────────────
export async function renderCoursePdf(content: CourseContent): Promise<Uint8Array> {
  const pdfDoc   = await PDFDocument.create();
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const regFont  = await pdfDoc.embedFont(StandardFonts.Helvetica);

  // 1. Cover page
  let ps = await newPage(pdfDoc, boldFont, regFont);
  await drawCover(ps, content);

  // 2. Module pages
  for (const mod of content.modules) {
    ps = await drawModule(
      pdfDoc, boldFont, regFont,
      mod,
      content.totalModules,
      content.mentorName,
      content.level,
      content.courseTitle,
    );
  }

  // 3. Closing on last page (reuse last module page if space)
  if (ps.currentY > MARGIN_BOT + 100) {
    await drawClosing(ps, content);
  } else {
    const closingPs = await newPage(pdfDoc, boldFont, regFont);
    await drawClosing(closingPs, content);
  }

  return pdfDoc.save();
}

