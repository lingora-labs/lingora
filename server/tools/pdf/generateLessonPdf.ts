// =============================================================================
// server/tools/generateLessonPdf.ts
// LINGORA SEEK 3.4 — Lesson PDF Generator.
// =============================================================================
// Layout: Business Spanish A0/A1 (Sara format)
// Sections: HEADER · DEL 1 (key phrases table) · DEL 2 (build your own)
//           DEL 3 (gap fill) · DEL 4 (translate) · DEL 5 (roleplay) · FASIT
//
// CONTRACT: LLM provides structured JSON. This generator renders fixed layout.
// No LLM improvisation of section count or structure.
// =============================================================================

import { PDFDocument, rgb, StandardFonts, PDFPage, PDFFont } from 'pdf-lib';

export interface LessonContent {
  /** Mentor name: Alex | Sarah | Nick */
  mentorName: string;
  /** CEFR level string: A0/A1, B1, etc */
  level: string;
  /** Topic title, e.g. "Profesjonell introduksjon på spansk" */
  topicTitle: string;
  /** Student native language (for bilingual table header) */
  nativeLanguage: string;
  /** Interface language (determines labels) */
  interfaceLanguage: string;
  /** DEL 1 — bilingual key phrases: [[spanish, native]] */
  keyPhrases: Array<[string, string]>;
  /** DEL 2 — sentence starters for student to complete */
  buildSlots: Array<{ label: string; prefix: string }>;
  /** DEL 3 — gap fill: { sentence (with blank ___), answer } */
  gapFill: Array<{ sentence: string; answer: string; wordBank: string[] }>;
  /** DEL 4 — native → spanish translation sentences */
  translations: Array<{ native: string; spanish: string }>;
  /** DEL 5 — roleplay scenario */
  roleplay: { scenario: string; question: string };
  /** FASIT — correct answers for DEL 3 and DEL 4 */
  fasit: {
    del3: string[];   // e.g. ["días", "llamo", "de", "Trabajo", "Mucho"]
    del4: string[];   // complete spanish sentences
  };
}

// ── Layout constants ──────────────────────────────────────────────────────────
const PAGE_W  = 595.28;   // A4 width pt
const PAGE_H  = 841.89;   // A4 height pt
const MARGIN  = 50;
const COL_W   = PAGE_W - MARGIN * 2;
const NAVY    = rgb(0.05, 0.10, 0.16);    // #0D1828
const TEAL    = rgb(0.00, 0.79, 0.66);    // #00C9A7
const DKGRAY  = rgb(0.20, 0.25, 0.30);
const LTGRAY  = rgb(0.94, 0.96, 0.98);
const MIDGRAY = rgb(0.78, 0.84, 0.90);    // #C8D6E5
const WHITE   = rgb(1, 1, 1);
const RED_ACC = rgb(0.78, 0.13, 0.00);    // #C82200

interface PdfState {
  doc: PDFDocument;
  page: PDFPage;
  bold: PDFFont;
  regular: PDFFont;
  italic: PDFFont;
  y: number;
}

function newPage(state: PdfState): void {
  state.page = state.doc.addPage([PAGE_W, PAGE_H]);
  state.y = PAGE_H - 30;
}

function ensureSpace(state: PdfState, needed: number): void {
  if (state.y - needed < 50) newPage(state);
}

function drawLine(state: PdfState, x1: number, y: number, x2: number, color = MIDGRAY, w = 0.5): void {
  state.page.drawLine({ start: { x: x1, y }, end: { x: x2, y }, thickness: w, color });
}

function drawText(state: PdfState, text: string, x: number, y: number, size: number, color = DKGRAY, font?: PDFFont): void {
  state.page.drawText(text.slice(0, 120), {
    x, y, size, color,
    font: font ?? state.regular,
    lineHeight: size * 1.3,
  });
}

function sectionLabel(state: PdfState, label: string, subtitle: string): void {
  ensureSpace(state, 36);
  // Teal accent bar
  state.page.drawRectangle({ x: MARGIN, y: state.y - 22, width: 4, height: 22, color: TEAL });
  drawText(state, label, MARGIN + 10, state.y - 16, 10, TEAL, state.bold);
  drawText(state, subtitle, MARGIN + 10 + state.bold.widthOfTextAtSize(label, 10) + 6, state.y - 16, 10, DKGRAY, state.italic);
  state.y -= 30;
}

export async function generateLessonPdf(content: LessonContent): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const [bold, regular, italic] = await Promise.all([
    doc.embedFont(StandardFonts.HelveticaBold),
    doc.embedFont(StandardFonts.Helvetica),
    doc.embedFont(StandardFonts.HelveticaOblique),
  ]);
  const page = doc.addPage([PAGE_W, PAGE_H]);
  const state: PdfState = { doc, page, bold, regular, italic, y: PAGE_H - 30 };

  // ── HEADER ────────────────────────────────────────────────────────────────
  // Navy background bar
  state.page.drawRectangle({ x: 0, y: PAGE_H - 72, width: PAGE_W, height: 72, color: NAVY });
  drawText(state, 'LINGORA', MARGIN, PAGE_H - 24, 18, WHITE, bold);
  drawText(state, content.mentorName + ' · Nivel ' + content.level, MARGIN + 130, PAGE_H - 24, 10, TEAL, bold);
  drawText(state, content.topicTitle, MARGIN, PAGE_H - 50, 12, WHITE, bold);
  drawText(state, 'lingora.netlify.app', PAGE_W - MARGIN - 120, PAGE_H - 60, 8, MIDGRAY);
  state.y = PAGE_H - 84;

  // Teal rule under header
  state.page.drawRectangle({ x: 0, y: PAGE_H - 75, width: PAGE_W, height: 3, color: TEAL });

  // ── DEL 1 — KEY PHRASES TABLE ─────────────────────────────────────────────
  state.y -= 10;
  sectionLabel(state, 'DEL 1', '— Frases clave / Key phrases');

  const colSpan = COL_W / 2;
  // Table header
  ensureSpace(state, 22);
  state.page.drawRectangle({ x: MARGIN, y: state.y - 18, width: COL_W, height: 20, color: NAVY });
  drawText(state, 'Español', MARGIN + 8, state.y - 13, 9, WHITE, bold);
  drawText(state, content.nativeLanguage === 'no' ? 'Norsk' : content.nativeLanguage.toUpperCase(), MARGIN + colSpan + 8, state.y - 13, 9, WHITE, bold);
  state.y -= 20;

  for (let i = 0; i < content.keyPhrases.length; i++) {
    const [esp, nat] = content.keyPhrases[i];
    ensureSpace(state, 18);
    const bg = i % 2 === 0 ? LTGRAY : WHITE;
    state.page.drawRectangle({ x: MARGIN, y: state.y - 15, width: COL_W, height: 17, color: bg });
    // Vertical divider
    state.page.drawLine({ start: { x: MARGIN + colSpan, y: state.y - 15 }, end: { x: MARGIN + colSpan, y: state.y + 2 }, thickness: 0.3, color: MIDGRAY });
    drawText(state, esp, MARGIN + 8, state.y - 11, 9, DKGRAY);
    drawText(state, nat, MARGIN + colSpan + 8, state.y - 11, 9, DKGRAY);
    state.y -= 17;
  }
  state.page.drawLine({ start: { x: MARGIN, y: state.y }, end: { x: MARGIN + COL_W, y: state.y }, thickness: 0.5, color: MIDGRAY });
  state.y -= 12;

  // ── DEL 2 — BUILD YOUR OWN ────────────────────────────────────────────────
  sectionLabel(state, 'DEL 2', '— Construye tu presentación');
  for (let i = 0; i < content.buildSlots.length; i++) {
    const slot = content.buildSlots[i];
    ensureSpace(state, 24);
    drawText(state, `${i + 1}. ${slot.label}:`, MARGIN, state.y - 11, 8.5, DKGRAY, bold);
    // Print prefix text + dotted line
    const prefixX = MARGIN + bold.widthOfTextAtSize(`${i + 1}. ${slot.label}:`, 8.5) + 6;
    if (slot.prefix) {
      drawText(state, slot.prefix, prefixX, state.y - 11, 8.5, DKGRAY);
    }
    const lineStart = slot.prefix ? prefixX + regular.widthOfTextAtSize(slot.prefix, 8.5) + 4 : prefixX;
    state.page.drawLine({ start: { x: lineStart, y: state.y - 13 }, end: { x: MARGIN + COL_W, y: state.y - 13 }, thickness: 0.4, color: MIDGRAY });
    state.y -= 22;
  }
  state.y -= 6;

  // ── DEL 3 — GAP FILL ──────────────────────────────────────────────────────
  sectionLabel(state, 'DEL 3', '— Completa los espacios');
  // Word bank box
  const wbWords = content.gapFill[0]?.wordBank ?? [];
  if (wbWords.length > 0) {
    ensureSpace(state, 26);
    state.page.drawRectangle({ x: MARGIN, y: state.y - 20, width: COL_W, height: 22, color: LTGRAY });
    state.page.drawRectangle({ x: MARGIN, y: state.y - 20, width: COL_W, height: 22, color: NAVY, opacity: 0.04 });
    drawText(state, '[  ' + wbWords.join('  /  ') + '  ]', MARGIN + 6, state.y - 13, 8.5, DKGRAY, italic);
    state.y -= 28;
  }
  for (let i = 0; i < content.gapFill.length; i++) {
    ensureSpace(state, 18);
    drawText(state, `${i + 1}.  ${content.gapFill[i].sentence}`, MARGIN + 4, state.y - 11, 8.5, DKGRAY);
    state.y -= 18;
  }
  state.y -= 6;

  // ── DEL 4 — TRANSLATE ─────────────────────────────────────────────────────
  sectionLabel(state, 'DEL 4', '— Traduce al español');
  for (let i = 0; i < content.translations.length; i++) {
    ensureSpace(state, 24);
    drawText(state, `${i + 1}.  ${content.translations[i].native}`, MARGIN + 4, state.y - 11, 8.5, DKGRAY);
    drawText(state, '→', MARGIN + 20, state.y - 22, 8, TEAL, bold);
    state.page.drawLine({ start: { x: MARGIN + 34, y: state.y - 24 }, end: { x: MARGIN + COL_W, y: state.y - 24 }, thickness: 0.4, color: MIDGRAY });
    state.y -= 30;
  }

  // ── DEL 5 — ROLEPLAY ──────────────────────────────────────────────────────
  ensureSpace(state, 80);
  state.y -= 8;
  sectionLabel(state, 'DEL 5', '— Práctica de roleplay');
  // Scenario box
  state.page.drawRectangle({ x: MARGIN, y: state.y - 36, width: COL_W, height: 38, color: LTGRAY });
  state.page.drawRectangle({ x: MARGIN, y: state.y - 36, width: 3, height: 38, color: TEAL });
  drawText(state, content.roleplay.scenario, MARGIN + 10, state.y - 12, 8.5, DKGRAY, italic);
  drawText(state, '"" + content.roleplay.question + ""', MARGIN + 10, state.y - 26, 9, NAVY, bold);
  state.y -= 48;
  drawText(state, 'Tu respuesta:', MARGIN, state.y - 11, 8.5, DKGRAY, bold);
  state.page.drawLine({ start: { x: MARGIN + 90, y: state.y - 13 }, end: { x: MARGIN + COL_W, y: state.y - 13 }, thickness: 0.4, color: MIDGRAY });
  state.y -= 22;
  // Second response line
  state.page.drawLine({ start: { x: MARGIN, y: state.y - 13 }, end: { x: MARGIN + COL_W, y: state.y - 13 }, thickness: 0.4, color: MIDGRAY });
  state.y -= 20;

  // ── FASIT ─────────────────────────────────────────────────────────────────
  ensureSpace(state, 80);
  state.y -= 10;
  // Fasit separator
  state.page.drawRectangle({ x: MARGIN, y: state.y - 2, width: COL_W, height: 2, color: TEAL });
  state.y -= 14;
  drawText(state, 'FASIT', MARGIN, state.y - 11, 11, NAVY, bold);
  state.y -= 20;

  drawText(state, 'DEL 3:', MARGIN, state.y - 11, 9, DKGRAY, bold);
  const del3Line = content.fasit.del3.map((a, i) => `${i + 1}. ${a}`).join('   ');
  drawText(state, del3Line, MARGIN + 38, state.y - 11, 8.5, DKGRAY);
  state.y -= 18;

  drawText(state, 'DEL 4:', MARGIN, state.y - 11, 9, DKGRAY, bold);
  state.y -= 14;
  for (let i = 0; i < content.fasit.del4.length; i++) {
    ensureSpace(state, 14);
    drawText(state, `${i + 1}. ${content.fasit.del4[i]}`, MARGIN + 10, state.y - 11, 8.5, DKGRAY);
    state.y -= 14;
  }

  // ── FOOTER ────────────────────────────────────────────────────────────────
  const totalPages = doc.getPageCount();
  for (let p = 0; p < totalPages; p++) {
    const pg = doc.getPage(p);
    pg.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: 28, color: NAVY });
    pg.drawText('lingora.netlify.app  ·  ' + content.topicTitle + '  ·  ' + content.mentorName + ' ' + content.level, {
      x: MARGIN, y: 10, size: 7.5, font: regular, color: MIDGRAY,
    });
    pg.drawText(`${p + 1} / ${totalPages}`, { x: PAGE_W - MARGIN - 20, y: 10, size: 7.5, font: bold, color: TEAL });
  }

  return doc.save();
}

