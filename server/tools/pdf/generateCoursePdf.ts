// =============================================================================
// server/tools/pdf/generateCoursePdf.ts
// LINGORA SEEK 4.1a — Document Composer + Neutral Renderer
// =============================================================================
// SEEK 4.0 — LIBEREN A WILLY — Architectural reform:
//
//   The old CourseContent contract forced every document into:
//     vocabulary[][] / grammar / exercise / communicativeFunction / tip
//   That schema was a pedagogical cage. The LLM filled boxes instead of
//   reasoning freely. Result: "Español para pedir un curso de acupuntura A1"
//   regardless of domain.
//
//   This file replaces CourseContent with DocumentContent + DocumentBlock[].
//   The LLM now decides the document structure. The renderer only applies
//   typography, margins, LINGORA branding and layout. It never imposes
//   "VOCABULARIO", "GRAMÁTICA 80/20", or "TIP CONSEJO" unless the LLM chose
//   those specific headings itself.
//
//   Approved by IS + CSJ — consensus 6 de abril de 2026
//   Doctrinal basis: Manifiesto 7.0 Art. 3, 8, 31, 38
//   "El formato nunca será más importante que la utilidad."
//
// TRANSITION NOTE (IS condition):
//   DocumentContent and DocumentBlock are LOCAL to this file for SEEK 4.0.
//   They will be promoted to lib/contracts.ts in a consolidation sprint
//   once production stability is confirmed. contracts.ts is NOT touched
//   this sprint (protected file, 48 exported types, full audit required).
//
// The import chain is unchanged:
//   execution-engine.ts → import type { DocumentContent } from here
//   pdf-generator.ts    → import type { DocumentContent } from here
//   pdf-generator.ts    → calls renderCoursePdf(params.courseContent)
// =============================================================================

import { PDFDocument, PDFPage, PDFFont, rgb, StandardFonts } from 'pdf-lib';

// ── DocumentBlock — the unit of free composition ─────────────────────────────
// The LLM produces an array of these. It decides which types to use,
// how many, and in what order. The renderer only applies visual style.
export type DocumentBlockType =
  | 'heading'        // section title (level 1-3)
  | 'paragraph'      // free-form prose
  | 'bullets'        // unordered list
  | 'numbered'       // ordered list
  | 'table'          // 2D data grid
  | 'callout'        // highlighted box (tip, warning, exercise, note)
  | 'quote'          // pull-quote or clinical reference
  | 'divider'        // visual separator
  | 'key_value'      // term: definition pairs
  | 'exercise'       // practice block
  | 'answer_key'     // solutions to a preceding exercise
  | 'case'           // clinical, legal, or business case
  | 'timeline'       // chronological sequence
  | 'comparison'     // side-by-side contrast
  | 'framework'      // conceptual framework or process
  | 'glossary'       // term definitions
  | 'index'          // table of contents or topic index
  | 'summary';       // closing synthesis       // closing synthesis

export interface DocumentBlock {
  type:      DocumentBlockType;
  level?:    1 | 2 | 3;
  content?:  string;
  items?:    string[];
  headers?:  string[];
  rows?:     string[][];
  label?:    string;
  style?:    'info' | 'warning' | 'exercise' | 'quote' | 'tip';

  // SEEK 4.0 — rich neutral block payloads
  events?:  Array<Record<string, string>>;
  steps?:   Array<Record<string, string>>;
  terms?:   Array<Record<string, string>>;
  answers?: string[];
}

// ── DocumentContent — top-level document ─────────────────────────────────────
// TRANSITION: replaces CourseContent. Local to this file until SEEK 4.1.
// The old CourseContent interface is preserved below as a legacy type alias
// so that any callers that haven't migrated yet will still compile.
// EpistemicNature — the LLM declares what type of document it is creating.
// The renderer uses this only for the cover badge label — never for content decisions.
export type EpistemicNature =
  | 'language_course'       // language grammar/vocabulary course
  | 'domain_theoretical'    // academic domain course (medicine, law, etc.)
  | 'domain_practical'      // professional practical guide
  | 'reference_guide'       // reference / consultation material
  | 'exam_preparation'      // exam prep (DELE, SIELE, etc.)
  | 'professional_training' // corporate / professional training
  | 'cultural_guide'        // cultural immersion guide
  | 'mixed';                // combination

export interface DocumentContent {
  title:           string;
  subtitle?:       string;
  documentType:    string;   // LLM decides: 'curriculo' | 'guia' | 'dossier' | 'curso' | etc.
  level?:          string;
  mentorName:      string;
  nativeLanguage?: string;
  studentName?:    string;
  blocks:          DocumentBlock[];
  nextStep?:       string;
  generatedAt:     string;
  // SEEK 3.9-d C3: epistemicNature — LLM declares the intellectual type of document
  epistemicNature?: EpistemicNature;
}

// Legacy alias — allows gradual migration without breaking callers
// that still reference CourseContent. Remove in SEEK 4.1 consolidation.
export type CourseContent = DocumentContent;

// ── WinAnsi sanitization (SEEK 3.5 — preserved) ─────────────────────────────
function toPdfSafeText(s: string, maxLen = 400): string {
  return String(s ?? '')
    .replace(/◆/g, '-').replace(/▶/g, '>').replace(/→/g, '->')
    .replace(/[–—]/g, '-').replace(/💡/g, '!').replace(/[·]/g, '.')
    .replace(/[^ -~áéíóúüñ¿¡ÁÉÍÓÚÜÑàèìòùâêîôûçœæÀÈÌÒÙÂÊÎÔÛÇŒÆ]/g, ' ')
    .slice(0, maxLen);
}

function safe(v: unknown, max = 400): string {
  return toPdfSafeText(String(v ?? ''), max);
}

// ── Layout constants ──────────────────────────────────────────────────────────
const W = 595.28, H = 841.89;
const ML = 48, MR = 48;
const CW = W - ML - MR;
const MB = 52;

const C_DARK   = rgb(0.08, 0.09, 0.18);
const C_TEAL   = rgb(0.00, 0.74, 0.78);
const C_ACCENT = rgb(0.22, 0.32, 0.72);
const C_MUTED  = rgb(0.42, 0.47, 0.58);
const C_WHITE  = rgb(1, 1, 1);
const C_LIGHT  = rgb(0.95, 0.96, 0.98);
const C_TIP    = rgb(0.08, 0.12, 0.24);
const C_WARN   = rgb(0.96, 0.94, 0.88);

// ── Page state ────────────────────────────────────────────────────────────────
interface PS {
  doc:  PDFDocument;
  page: PDFPage;
  bold: PDFFont;
  reg:  PDFFont;
  y:    number;
}

async function newPage(doc: PDFDocument, bold: PDFFont, reg: PDFFont, doc_content: DocumentContent): Promise<PS> {
  const page = doc.addPage([W, H]);
  // Header band
  page.drawRectangle({ x: 0, y: H - 38, width: W, height: 38, color: C_DARK });
  page.drawText('LINGORA', { x: ML, y: H - 24, size: 11, font: bold, color: C_WHITE });
  const sub = safe(`${doc_content.mentorName} - ${doc_content.level ?? ''} - ${doc_content.title}`, 90);
  page.drawText(sub, { x: ML, y: H - 34, size: 7, font: reg, color: C_TEAL });
  return { doc, page, bold, reg, y: H - 52 };
}

function ensureSpace(ps: PS, needed: number): boolean {
  return ps.y - needed >= MB;
}

// Word-wrap text to fit within maxW points at given font size
function wrapLines(text: string, font: PDFFont, size: number, maxW: number): string[] {
  const words = safe(text).split(' ');
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const test = cur ? `${cur} ${w}` : w;
    if (font.widthOfTextAtSize(test, size) > maxW && cur) {
      lines.push(cur);
      cur = w.length > 0 ? w : '';
    } else {
      cur = test;
    }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [''];
}

function drawLines(ps: PS, lines: string[], size: number, font: PDFFont, color = C_DARK, indent = 0): void {
  for (const line of lines) {
    ps.page.drawText(safe(line), { x: ML + indent, y: ps.y, size, font, color });
    ps.y -= size * 1.45;
  }
}

function gap(ps: PS, n = 8): void { ps.y -= n; }

function hRule(ps: PS, color = C_LIGHT, thickness = 0.5): void {
  ps.page.drawLine({ start: { x: ML, y: ps.y }, end: { x: W - MR, y: ps.y }, thickness, color });
  ps.y -= 5;
}

function footer(ps: PS, content: DocumentContent): void {
  const y = MB - 14;
  ps.page.drawLine({ start: { x: ML, y: y + 14 }, end: { x: W - MR, y: y + 14 }, thickness: 0.3, color: C_MUTED });
  ps.page.drawText('lingora.netlify.app - Learn -> Connect -> Experience', { x: ML, y, size: 7, font: ps.reg, color: C_MUTED });
  ps.page.drawText(safe(content.generatedAt, 40), { x: W - MR - 90, y, size: 7, font: ps.reg, color: C_MUTED });
}

// ── Block renderers ───────────────────────────────────────────────────────────

async function renderBlock(ps: PS, block: DocumentBlock, content: DocumentContent): Promise<PS> {
  const text = block.content ?? '';

  switch (block.type) {

    // SEEK 3.9-d C4: New block types — rendered via neutral generic renderer
    case 'timeline':
    case 'comparison':
    case 'framework':
    case 'answer_key':
    case 'glossary':
    case 'index':
    case 'case': {
      // Neutral generic renderer — types unknown at compile time, cast safely
      // These block types come from the LLM and may have varied shapes
      if (block.content) {
        const heading: DocumentBlock = { type: 'heading', level: 3, content: block.label ?? block.type.replace('_', ' ') };
        ps = await renderBlock(ps, heading, content);
        const para: DocumentBlock = { type: 'paragraph', content: block.content ?? '' };
        ps = await renderBlock(ps, para, content);
      }
      if (Array.isArray(block.items) && block.items.length > 0) {
        const list: DocumentBlock = { type: 'bullets', items: block.items };
        ps = await renderBlock(ps, list, content);
      }
      if (Array.isArray(block.events) && block.events.length > 0) {
        const evList: DocumentBlock = { type: 'numbered', items: block.events.map((ev) => `${ev['date'] ?? ''}: ${ev['event'] ?? ''}`) };
        ps = await renderBlock(ps, evList, content);
      }
      if (Array.isArray(block.steps) && block.steps.length > 0) {
        const stpList: DocumentBlock = { type: 'numbered', items: block.steps.map((st) => `${st['name'] ?? ''}: ${st['description'] ?? ''}`) };
        ps = await renderBlock(ps, stpList, content);
      }
      if (Array.isArray(block.terms) && block.terms.length > 0) {
        const terms: DocumentBlock = { type: 'key_value', items: block.terms.map((tr) => `${tr['term'] ?? tr['label'] ?? ''}: ${tr['definition'] ?? tr['description'] ?? ''}`) };
        ps = await renderBlock(ps, terms, content);
      }
      if (Array.isArray(block.answers) && block.answers.length > 0) {
        const ans: DocumentBlock = { type: 'numbered', items: block.answers };
        ps = await renderBlock(ps, ans, content);
      }
      break;
    }

    case 'heading': {
      const lvl = block.level ?? 1;
      const size = lvl === 1 ? 16 : lvl === 2 ? 13 : 11;
      const color = lvl === 1 ? C_ACCENT : lvl === 2 ? C_DARK : C_MUTED;
      const lines = wrapLines(text, ps.bold, size, CW);
      const needed = lines.length * size * 1.5 + (lvl === 1 ? 16 : 10);
      if (!ensureSpace(ps, needed)) {
        footer(ps, content);
        ps = await newPage(ps.doc, ps.bold, ps.reg, content);
      }
      gap(ps, lvl === 1 ? 14 : 8);
      if (lvl === 1) {
        ps.page.drawRectangle({ x: ML - 4, y: ps.y - lines.length * size * 1.45 - 4, width: CW + 8, height: lines.length * size * 1.45 + 12, color: C_LIGHT });
      }
      drawLines(ps, lines, size, ps.bold, color);
      if (lvl === 1) hRule(ps, C_TEAL, 1.5);
      gap(ps, 4);
      break;
    }

    case 'paragraph': {
      const lines = wrapLines(text, ps.reg, 9.5, CW);
      const needed = lines.length * 9.5 * 1.45 + 12;
      if (!ensureSpace(ps, needed)) {
        footer(ps, content);
        ps = await newPage(ps.doc, ps.bold, ps.reg, content);
      }
      drawLines(ps, lines, 9.5, ps.reg);
      gap(ps, 6);
      break;
    }

    case 'bullets': {
      const items = block.items ?? (text ? [text] : []);
      const needed = items.length * 11 * 1.4 + 10;
      if (!ensureSpace(ps, needed)) {
        footer(ps, content);
        ps = await newPage(ps.doc, ps.bold, ps.reg, content);
      }
      for (const item of items) {
        const lines = wrapLines(`• ${item}`, ps.reg, 9.5, CW - 8);
        drawLines(ps, lines, 9.5, ps.reg, C_DARK, 8);
      }
      gap(ps, 6);
      break;
    }

    case 'numbered': {
      const items = block.items ?? (text ? [text] : []);
      if (!ensureSpace(ps, items.length * 11 * 1.4 + 10)) {
        footer(ps, content);
        ps = await newPage(ps.doc, ps.bold, ps.reg, content);
      }
      items.forEach((item, i) => {
        const lines = wrapLines(`${i + 1}. ${item}`, ps.reg, 9.5, CW - 12);
        drawLines(ps, lines, 9.5, ps.reg, C_DARK, 12);
      });
      gap(ps, 6);
      break;
    }

    case 'key_value': {
      const items = block.items ?? [];
      if (!ensureSpace(ps, items.length * 14 + 10)) {
        footer(ps, content);
        ps = await newPage(ps.doc, ps.bold, ps.reg, content);
      }
      const colW = CW * 0.30;
      for (let i = 0; i < items.length; i++) {
        const [k, ...rest] = items[i].split(':');
        const v = rest.join(':').trim();
        const bg = i % 2 === 0 ? C_LIGHT : C_WHITE;
        ps.page.drawRectangle({ x: ML, y: ps.y - 12, width: CW, height: 14, color: bg });
        ps.page.drawText(safe(k ?? '', 35), { x: ML + 4, y: ps.y - 10, size: 9, font: ps.bold, color: C_ACCENT });
        const vLines = wrapLines(v, ps.reg, 9, CW - colW - 8);
        ps.page.drawText(safe(vLines[0] ?? '', 80), { x: ML + colW, y: ps.y - 10, size: 9, font: ps.reg, color: C_DARK });
        ps.y -= 14;
      }
      gap(ps, 6);
      break;
    }

    case 'table': {
      const headers = block.headers ?? [];
      const rows = block.rows ?? [];
      const colW = headers.length > 0 ? CW / headers.length : CW;
      const totalH = (rows.length + 1) * 16 + 12;
      if (!ensureSpace(ps, Math.min(totalH, H / 2))) {
        footer(ps, content);
        ps = await newPage(ps.doc, ps.bold, ps.reg, content);
      }
      // Header row
      ps.page.drawRectangle({ x: ML, y: ps.y - 14, width: CW, height: 16, color: C_DARK });
      headers.forEach((h, i) => {
        ps.page.drawText(safe(h, 30), { x: ML + i * colW + 4, y: ps.y - 11, size: 8, font: ps.bold, color: C_WHITE });
      });
      ps.y -= 16;
      // Data rows
      for (let r = 0; r < rows.length; r++) {
        if (!ensureSpace(ps, 16)) {
          footer(ps, content);
          ps = await newPage(ps.doc, ps.bold, ps.reg, content);
        }
        const rowBg = r % 2 === 0 ? C_LIGHT : C_WHITE;
        ps.page.drawRectangle({ x: ML, y: ps.y - 14, width: CW, height: 16, color: rowBg });
        (rows[r] ?? []).forEach((cell, i) => {
          ps.page.drawText(safe(cell, 35), { x: ML + i * colW + 4, y: ps.y - 11, size: 8.5, font: ps.reg, color: C_DARK });
        });
        ps.y -= 16;
      }
      gap(ps, 8);
      break;
    }

    case 'callout':
    case 'exercise': {
      const label = block.label ?? (block.type === 'exercise' ? 'Ejercicio' : 'Nota');
      const bgColor = block.style === 'warning' ? C_WARN
                    : block.style === 'tip'     ? C_TIP
                    : C_LIGHT;
      const txtColor = block.style === 'tip' ? C_WHITE : C_DARK;
      const labelColor = block.style === 'tip' ? C_TEAL : C_ACCENT;
      const lines = wrapLines(text, ps.reg, 9.5, CW - 20);
      const boxH = lines.length * 9.5 * 1.45 + 28;
      if (!ensureSpace(ps, boxH + 8)) {
        footer(ps, content);
        ps = await newPage(ps.doc, ps.bold, ps.reg, content);
      }
      gap(ps, 4);
      ps.page.drawRectangle({ x: ML, y: ps.y - boxH + 8, width: CW, height: boxH, color: bgColor });
      ps.page.drawText(safe(label.toUpperCase(), 30), { x: ML + 8, y: ps.y - 12, size: 8, font: ps.bold, color: labelColor });
      ps.y -= 20;
      drawLines(ps, lines, 9.5, ps.reg, txtColor, 8);
      gap(ps, 8);
      break;
    }

    case 'quote': {
      const lines = wrapLines(text, ps.reg, 10, CW - 24);
      const needed = lines.length * 10 * 1.5 + 16;
      if (!ensureSpace(ps, needed)) {
        footer(ps, content);
        ps = await newPage(ps.doc, ps.bold, ps.reg, content);
      }
      ps.page.drawRectangle({ x: ML, y: ps.y - needed + 4, width: 3, height: needed, color: C_TEAL });
      drawLines(ps, lines, 10, ps.reg, C_MUTED, 12);
      gap(ps, 8);
      break;
    }

    case 'divider': {
      gap(ps, 6);
      hRule(ps, C_LIGHT, 0.5);
      gap(ps, 6);
      break;
    }

    case 'summary': {
      const lines = wrapLines(text, ps.reg, 9.5, CW - 16);
      const boxH = lines.length * 9.5 * 1.45 + 20;
      if (!ensureSpace(ps, boxH + 8)) {
        footer(ps, content);
        ps = await newPage(ps.doc, ps.bold, ps.reg, content);
      }
      gap(ps, 6);
      ps.page.drawRectangle({ x: ML, y: ps.y - boxH + 6, width: CW, height: boxH, color: C_LIGHT });
      drawLines(ps, lines, 9.5, ps.reg, C_DARK, 8);
      gap(ps, 8);
      break;
    }
  }

  return ps;
}

// ── Cover page ────────────────────────────────────────────────────────────────
async function renderCover(doc: PDFDocument, bold: PDFFont, reg: PDFFont, content: DocumentContent): Promise<void> {
  const cover = doc.addPage([W, H]);

  cover.drawRectangle({ x: 0, y: 0, width: W, height: H, color: C_DARK });
  cover.drawText('LINGORA', { x: ML, y: H - 80, size: 40, font: bold, color: C_WHITE });
  cover.drawText('AI Cultural Immersion Platform for Spanish', { x: ML, y: H - 102, size: 10, font: reg, color: C_TEAL });
  cover.drawRectangle({ x: ML, y: H - 116, width: CW, height: 1.5, color: C_TEAL });

  // Document type badge — uses epistemicNature if available, else documentType
  const badgeMap: Record<string, string> = {
    'language_course':       'Curso de idioma',
    'domain_theoretical':    'Curso teorico',
    'domain_practical':      'Guia practica',
    'reference_guide':       'Material de referencia',
    'exam_preparation':      'Preparacion de examen',
    'professional_training': 'Formacion profesional',
    'cultural_guide':        'Guia cultural',
    'mixed':                 'Material combinado',
  };
  const badgeText = content.epistemicNature
    ? (badgeMap[content.epistemicNature] ?? content.documentType)
    : content.documentType;
  if (badgeText) {
    const badge = safe(badgeText.toUpperCase(), 30);
    cover.drawText(badge, { x: ML, y: H - 144, size: 9, font: bold, color: C_TEAL });
  }

  // Title
  let y = H - 172;
  const titleLines = wrapLines(content.title, bold, 22, CW);
  for (const line of titleLines) {
    cover.drawText(safe(line), { x: ML, y, size: 22, font: bold, color: C_WHITE });
    y -= 28;
  }

  // Subtitle
  if (content.subtitle) {
    y -= 8;
    const subLines = wrapLines(content.subtitle, reg, 12, CW);
    for (const line of subLines) {
      cover.drawText(safe(line), { x: ML, y, size: 12, font: reg, color: C_MUTED });
      y -= 16;
    }
  }

  // Meta grid
  y -= 20;
  const meta = [
    content.level    ? ['Nivel',  content.level]    : null,
    content.mentorName ? ['Mentor', content.mentorName] : null,
    content.nativeLanguage ? ['Idioma', (content.nativeLanguage).toUpperCase()] : null,
    ['Bloques', String(content.blocks?.length ?? 0)],
  ].filter(Boolean) as [string, string][];

  const colW = CW / Math.min(meta.length, 4);
  meta.slice(0, 4).forEach(([k, v], i) => {
    const x = ML + i * colW;
    cover.drawRectangle({ x, y: y - 36, width: colW - 4, height: 36, color: rgb(0.12, 0.16, 0.28) });
    cover.drawText(safe(k), { x: x + 6, y: y - 16, size: 7.5, font: reg, color: C_TEAL });
    cover.drawText(safe(v, 18), { x: x + 6, y: y - 30, size: 12, font: bold, color: C_WHITE });
  });

  // Footer
  cover.drawText('Learn -> Connect -> Experience', { x: ML, y: 36, size: 9, font: reg, color: C_TEAL });
  cover.drawText(safe(`lingora.netlify.app - ${content.generatedAt}`, 60), { x: ML, y: 20, size: 8, font: reg, color: C_MUTED });
}

// ── Closing page ──────────────────────────────────────────────────────────────
async function renderClosing(ps: PS, content: DocumentContent): Promise<void> {
  if (!ensureSpace(ps, 100)) {
    footer(ps, content);
    ps = await newPage(ps.doc, ps.bold, ps.reg, content);
  }
  gap(ps, 16);
  hRule(ps, C_ACCENT, 1.5);
  gap(ps, 10);

  if (content.nextStep) {
    const lines = wrapLines(content.nextStep, ps.reg, 10, CW);
    drawLines(ps, lines, 10, ps.reg, C_MUTED);
    gap(ps, 12);
  }

  const summary = [
    content.studentName ? ['Estudiante', content.studentName] : null,
    content.level       ? ['Nivel',      content.level]       : null,
    ['Mentor',           content.mentorName],
    ['Bloques',          String(content.blocks?.length ?? 0)],
  ].filter(Boolean) as [string, string][];

  for (const [k, v] of summary) {
    ps.page.drawText(safe(`${k}:`), { x: ML, y: ps.y, size: 9, font: ps.bold, color: C_MUTED });
    ps.page.drawText(safe(v, 40),   { x: ML + 120, y: ps.y, size: 9, font: ps.reg, color: C_DARK });
    ps.y -= 14;
  }

  footer(ps, content);
}

// ── Main export ───────────────────────────────────────────────────────────────
// Called by pdf-generator.ts via:
//   const { renderCoursePdf } = await import('./pdf/generateCoursePdf');
//   pdfBytes = await renderCoursePdf(params.courseContent);
// The function signature is unchanged — backward compatible with existing callers.
export async function renderCoursePdf(content: DocumentContent): Promise<Uint8Array> {
  const doc  = await PDFDocument.create();
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const reg  = await doc.embedFont(StandardFonts.Helvetica);

  await renderCover(doc, bold, reg, content);

  let ps = await newPage(doc, bold, reg, content);

  for (const block of (content.blocks ?? [])) {
    ps = await renderBlock(ps, block, content);
  }

  await renderClosing(ps, content);

  return doc.save();
}
