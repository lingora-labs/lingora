// =============================================================================
// server/tools/generateCoursePdf.ts
// LINGORA SEEK 3.4 — Course PDF Generator
// =============================================================================
// Layout: Zakia extended format
// Structure: PORTADA · OBJETIVO · ROADMAP · MÓDULOS (vocab/gramática/ejercicio/función) · CIERRE
//
// CONTRACT: LLM provides structured JSON. This generator renders fixed layout.
// Módulo format per unit:
//   - Vocabulario con ejemplos
//   - Regla gramatical 80/20
//   - Ejercicio de producción
//   - Función comunicativa
//   - Consejo (DELE/profesional/cultural)
// =============================================================================

import { PDFDocument, rgb, StandardFonts, PDFPage, PDFFont } from 'pdf-lib';

export interface CourseModule {
  index: number;
  title: string;
  /** Vocabulary items: [[word, definition/translation]] */
  vocabulary: Array<[string, string]>;
  /** Grammar rule: the 80/20 core rule in one sentence */
  grammar: string;
  /** Production exercise text */
  exercise: string;
  /** Communicative function: what the student can DO after this module */
  communicativeFunction: string;
  /** Tip: DELE tip, professional context, or cultural note */
  tip: string;
}

export interface CourseContent {
  mentorName: string;
  level: string;
  studentName: string;
  courseTitle: string;
  objective: string;
  nativeLanguage: string;
  totalModules: number;
  modules: CourseModule[];
  /** Closing recommendations */
  nextStep: string;
  generatedAt: string; // ISO date string
}

// ── Colors ────────────────────────────────────────────────────────────────────
const NAVY    = rgb(0.05, 0.10, 0.16);
const TEAL    = rgb(0.00, 0.79, 0.66);
const DKGRAY  = rgb(0.20, 0.25, 0.30);
const LTGRAY  = rgb(0.94, 0.96, 0.98);
const MIDGRAY = rgb(0.78, 0.84, 0.90);
const WHITE   = rgb(1, 1, 1);
const CORAL   = rgb(0.80, 0.15, 0.00);

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 48;
const COL_W  = PAGE_W - MARGIN * 2;

interface PdfState {
  doc: PDFDocument;
  page: PDFPage;
  bold: PDFFont;
  regular: PDFFont;
  italic: PDFFont;
  y: number;
  pageNum: number;
}

function newPage(s: PdfState): void {
  s.page = s.doc.addPage([PAGE_W, PAGE_H]);
  s.y = PAGE_H - 28;
  s.pageNum++;
}

function ensureSpace(s: PdfState, needed: number): void {
  if (s.y - needed < 55) newPage(s);
}

function txt(s: PdfState, text: string, x: number, y: number, size: number, color = DKGRAY, font?: PDFFont): void {
  s.page.drawText(String(text).slice(0, 110), { x, y, size, color, font: font ?? s.regular });
}

function rect(s: PdfState, x: number, y: number, w: number, h: number, color = LTGRAY): void {
  s.page.drawRectangle({ x, y: y - h, width: w, height: h, color });
}

function hRule(s: PdfState, color = MIDGRAY, thickness = 0.5): void {
  s.page.drawLine({ start: { x: MARGIN, y: s.y }, end: { x: MARGIN + COL_W, y: s.y }, thickness, color });
}

export async function generateCoursePdf(content: CourseContent): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const [bold, regular, italic] = await Promise.all([
    doc.embedFont(StandardFonts.HelveticaBold),
    doc.embedFont(StandardFonts.Helvetica),
    doc.embedFont(StandardFonts.HelveticaOblique),
  ]);

  const s: PdfState = {
    doc,
    page: doc.addPage([PAGE_W, PAGE_H]),
    bold, regular, italic,
    y: PAGE_H - 28,
    pageNum: 1,
  };

  // ── PORTADA ────────────────────────────────────────────────────────────────
  // Full navy background cover
  s.page.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: PAGE_H, color: NAVY });
  // Teal accent stripe
  s.page.drawRectangle({ x: 0, y: PAGE_H - 8, width: PAGE_W, height: 8, color: TEAL });
  s.page.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: 8, color: TEAL });

  // LINGORA wordmark
  txt(s, 'LINGORA', MARGIN, PAGE_H - 80, 42, WHITE, bold);
  txt(s, 'AI Cultural Immersion Platform for Spanish', MARGIN, PAGE_H - 104, 11, TEAL, regular);

  // Divider
  s.page.drawLine({ start: { x: MARGIN, y: PAGE_H - 120 }, end: { x: MARGIN + COL_W, y: PAGE_H - 120 }, thickness: 1, color: TEAL });

  // Course title
  txt(s, content.courseTitle, MARGIN, PAGE_H - 160, 20, WHITE, bold);
  txt(s, content.objective.slice(0, 90), MARGIN, PAGE_H - 184, 10, MIDGRAY, italic);

  // Student info box
  s.page.drawRectangle({ x: MARGIN, y: PAGE_H - 280, width: COL_W, height: 70, color: rgb(0.10, 0.18, 0.26) });
  txt(s, 'Estudiante:', MARGIN + 12, PAGE_H - 230, 9, TEAL, bold);
  txt(s, content.studentName, MARGIN + 12, PAGE_H - 244, 11, WHITE, bold);
  txt(s, `Nivel: ${content.level}   ·   Mentor: ${content.mentorName}   ·   ${content.totalModules} módulos`, MARGIN + 12, PAGE_H - 258, 8.5, MIDGRAY);

  // Course info
  txt(s, `Idioma origen: ${content.nativeLanguage.toUpperCase()}`, MARGIN, PAGE_H - 310, 9, MIDGRAY);
  txt(s, `Generado: ${content.generatedAt}`, MARGIN, PAGE_H - 324, 9, MIDGRAY);

  // ROADMAP preview box
  const roadY = PAGE_H - 420;
  txt(s, 'ROADMAP DEL CURSO', MARGIN, roadY + 14, 9, TEAL, bold);
  s.page.drawLine({ start: { x: MARGIN, y: roadY + 4 }, end: { x: MARGIN + COL_W, y: roadY + 4 }, thickness: 0.5, color: TEAL });
  const modsPerRow = 4;
  for (let i = 0; i < Math.min(content.modules.length, 12); i++) {
    const col = i % modsPerRow;
    const row = Math.floor(i / modsPerRow);
    const bx = MARGIN + col * (COL_W / modsPerRow) + 4;
    const by = roadY - 16 - row * 36;
    s.page.drawRectangle({ x: bx, y: by - 26, width: COL_W / modsPerRow - 8, height: 28, color: rgb(0.10, 0.18, 0.26) });
    txt(s, `M${i + 1}`, bx + 4, by - 12, 8, TEAL, bold);
    const moduleTitle = content.modules[i]?.title ?? '';
    txt(s, moduleTitle.slice(0, 18), bx + 4, by - 24, 7, MIDGRAY);
  }

  // Cover footer
  txt(s, 'lingora.netlify.app  ·  Learn → Connect → Experience', MARGIN, 24, 8, MIDGRAY);

  // ── OBJECTIVE PAGE ────────────────────────────────────────────────────────
  newPage(s);
  // Page header band
  s.page.drawRectangle({ x: 0, y: PAGE_H - 42, width: PAGE_W, height: 42, color: NAVY });
  txt(s, 'LINGORA', MARGIN, PAGE_H - 26, 12, WHITE, bold);
  txt(s, content.courseTitle, MARGIN + 72, PAGE_H - 26, 10, TEAL);
  s.y = PAGE_H - 60;

  txt(s, 'OBJETIVO GENERAL DEL CURSO', MARGIN, s.y, 13, NAVY, bold);
  s.page.drawRectangle({ x: MARGIN, y: s.y - 4, width: 36, height: 3, color: TEAL });
  s.y -= 20;

  // Objective box
  rect(s, MARGIN, s.y, COL_W, 52, LTGRAY);
  s.page.drawRectangle({ x: MARGIN, y: s.y - 52, width: 4, height: 52, color: TEAL });
  txt(s, content.objective, MARGIN + 12, s.y - 18, 10, DKGRAY);
  s.y -= 64;

  // Communicative functions list from modules
  txt(s, 'AL FINALIZAR ESTE CURSO, PODRÁS:', MARGIN, s.y - 2, 10, NAVY, bold);
  s.y -= 16;
  for (const mod of content.modules) {
    ensureSpace(s, 16);
    s.page.drawCircle({ x: MARGIN + 6, y: s.y - 6, size: 3, color: TEAL });
    txt(s, mod.communicativeFunction, MARGIN + 16, s.y - 9, 9, DKGRAY);
    s.y -= 16;
  }

  // ── MODULES ───────────────────────────────────────────────────────────────
  for (const mod of content.modules) {
    newPage(s);
    // Module header bar
    s.page.drawRectangle({ x: 0, y: PAGE_H - 42, width: PAGE_W, height: 42, color: NAVY });
    txt(s, 'LINGORA', MARGIN, PAGE_H - 26, 10, WHITE, bold);
    txt(s, content.courseTitle, MARGIN + 64, PAGE_H - 26, 9, TEAL);
    s.y = PAGE_H - 56;

    // Module title pill
    rect(s, MARGIN, s.y + 2, COL_W, 28, rgb(0.07, 0.14, 0.22));
    txt(s, `MÓDULO ${mod.index}`, MARGIN + 10, s.y - 7, 8, TEAL, bold);
    txt(s, mod.title, MARGIN + 72, s.y - 7, 12, WHITE, bold);
    s.y -= 36;

    // ── VOCABULARIO ────────────────────────────────────────────────────────
    txt(s, '📚  VOCABULARIO', MARGIN, s.y - 2, 9, TEAL, bold);
    s.y -= 14;
    const vocColW = COL_W / 2;
    for (let i = 0; i < mod.vocabulary.length; i++) {
      ensureSpace(s, 16);
      const bg = i % 2 === 0 ? LTGRAY : WHITE;
      rect(s, MARGIN, s.y + 2, COL_W, 16, bg);
      s.page.drawLine({ start: { x: MARGIN + vocColW, y: s.y - 14 }, end: { x: MARGIN + vocColW, y: s.y + 2 }, thickness: 0.3, color: MIDGRAY });
      txt(s, mod.vocabulary[i][0], MARGIN + 6, s.y - 10, 8.5, NAVY, bold);
      txt(s, mod.vocabulary[i][1], MARGIN + vocColW + 6, s.y - 10, 8.5, DKGRAY);
      s.y -= 16;
    }
    s.y -= 8;

    // ── GRAMÁTICA 80/20 ────────────────────────────────────────────────────
    ensureSpace(s, 40);
    txt(s, '📐  GRAMÁTICA — REGLA 80/20', MARGIN, s.y - 2, 9, TEAL, bold);
    s.y -= 12;
    rect(s, MARGIN, s.y + 2, COL_W, 28, LTGRAY);
    s.page.drawRectangle({ x: MARGIN, y: s.y - 26, width: 4, height: 28, color: CORAL });
    txt(s, mod.grammar, MARGIN + 10, s.y - 14, 9, DKGRAY);
    s.y -= 36;

    // ── EJERCICIO DE PRODUCCIÓN ────────────────────────────────────────────
    ensureSpace(s, 50);
    txt(s, '✏️  EJERCICIO DE PRODUCCIÓN', MARGIN, s.y - 2, 9, TEAL, bold);
    s.y -= 12;
    rect(s, MARGIN, s.y + 2, COL_W, 24, LTGRAY);
    txt(s, mod.exercise, MARGIN + 8, s.y - 13, 8.5, DKGRAY, italic);
    s.y -= 30;
    // Answer line
    txt(s, 'Tu respuesta:', MARGIN, s.y - 9, 8, DKGRAY, bold);
    s.page.drawLine({ start: { x: MARGIN + 82, y: s.y - 11 }, end: { x: MARGIN + COL_W, y: s.y - 11 }, thickness: 0.4, color: MIDGRAY });
    s.y -= 22;

    // ── FUNCIÓN COMUNICATIVA ──────────────────────────────────────────────
    ensureSpace(s, 32);
    txt(s, '💬  FUNCIÓN COMUNICATIVA', MARGIN, s.y - 2, 9, TEAL, bold);
    s.y -= 12;
    rect(s, MARGIN, s.y + 2, COL_W, 22, rgb(0.90, 0.97, 0.95));
    txt(s, '✓  ' + mod.communicativeFunction, MARGIN + 8, s.y - 13, 9, NAVY);
    s.y -= 30;

    // ── CONSEJO ────────────────────────────────────────────────────────────
    ensureSpace(s, 36);
    rect(s, MARGIN, s.y + 2, COL_W, 30, rgb(0.07, 0.14, 0.22));
    s.page.drawRectangle({ x: MARGIN, y: s.y - 28, width: 4, height: 30, color: TEAL });
    txt(s, '💡  CONSEJO', MARGIN + 10, s.y - 10, 8, TEAL, bold);
    txt(s, mod.tip, MARGIN + 10, s.y - 22, 8, MIDGRAY, italic);
    s.y -= 38;

    // Module footer separator
    ensureSpace(s, 12);
    hRule(s, TEAL, 0.8);
    s.y -= 8;
  }

  // ── CIERRE / NEXT STEPS ───────────────────────────────────────────────────
  newPage(s);
  s.page.drawRectangle({ x: 0, y: PAGE_H - 42, width: PAGE_W, height: 42, color: NAVY });
  txt(s, 'LINGORA  ·  ' + content.courseTitle, MARGIN, PAGE_H - 26, 10, WHITE, bold);
  s.y = PAGE_H - 60;

  txt(s, 'CIERRE Y PRÓXIMOS PASOS', MARGIN, s.y, 13, NAVY, bold);
  s.page.drawRectangle({ x: MARGIN, y: s.y - 4, width: 36, height: 3, color: TEAL });
  s.y -= 22;

  rect(s, MARGIN, s.y + 2, COL_W, 50, LTGRAY);
  s.page.drawRectangle({ x: MARGIN, y: s.y - 48, width: 4, height: 50, color: TEAL });
  txt(s, content.nextStep, MARGIN + 12, s.y - 16, 9.5, DKGRAY);
  s.y -= 62;

  // Summary grid
  const summaryItems = [
    ['Módulos completados', String(content.totalModules)],
    ['Nivel alcanzado', content.level],
    ['Mentor', content.mentorName],
    ['Estudiante', content.studentName],
  ];
  txt(s, 'RESUMEN DEL CURSO', MARGIN, s.y, 9, TEAL, bold);
  s.y -= 14;
  const sumColW = COL_W / 2;
  for (let i = 0; i < summaryItems.length; i++) {
    ensureSpace(s, 22);
    const col = i % 2;
    const bx = MARGIN + col * sumColW;
    if (col === 0) {
      rect(s, MARGIN, s.y + 2, COL_W, 20, i % 4 < 2 ? LTGRAY : WHITE);
    }
    txt(s, summaryItems[i][0] + ':', bx + 6, s.y - 8, 8, DKGRAY, italic);
    txt(s, summaryItems[i][1], bx + 6, s.y - 18, 9.5, NAVY, bold);
    if (col === 1) s.y -= 22;
  }

  // ── FOOTERS ON ALL PAGES ─────────────────────────────────────────────────
  const total = doc.getPageCount();
  for (let p = 1; p < total; p++) {  // skip cover (p=0)
    const pg = doc.getPage(p);
    pg.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: 26, color: NAVY });
    pg.drawText(
      `lingora.netlify.app  ·  ${content.courseTitle}  ·  ${content.studentName}  ·  Nivel ${content.level}`,
      { x: MARGIN, y: 9, size: 7, font: regular, color: MIDGRAY },
    );
    pg.drawText(`${p + 1} / ${total}`, { x: PAGE_W - MARGIN - 24, y: 9, size: 7, font: bold, color: TEAL });
  }

  return doc.save();
}

