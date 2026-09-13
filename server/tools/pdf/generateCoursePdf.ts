// =============================================================================
// server/tools/pdf/generateCoursePdf.ts
// LINGORA SEEK 4.1a — Document Composer + Neutral Renderer
// P12-A+B (10 sep 2026): table and key_value blocks used to hard-truncate
// content via safe(cell,35)/safe(h,30) and by drawing only vLines[0]. That
// destroyed real pedagogical content (confirmed: table cells and glossary
// entries stored truncated strings inside the PDF, not just visually
// clipped). Fixed by wrapping every header/cell/key/value at its real column
// width, computing dynamic row height from the tallest wrapped cell, drawing
// ALL wrapped lines, and page-breaking safely (repeating the header row on
// tables) before any row that doesn't fit. No content-length caps remain in
// either block type. Verified with deterministic PDF fixtures (long cells,
// forced multi-page table, short-table regression) — see tests/p12-fixtures.ts.
//
// P13-B+C (10 sep 2026): ARTIFACT_TYPE_BADGE gives the cover page a closed,
// truthful set of type labels (see composeArtifactDocument.ts's
// normalizeArtifactType) instead of echoing whatever free text the composer
// wrote. "Nivel" renamed to "Nivel de español" on cover and closing summary —
// it always meant the student's Spanish proficiency (E-11: languageProficiency
// ≠ domainProficiency), never the domain's own level, but the generic label
// let a domain-general artifact (e.g. acupuncture) read as if the SUBJECT
// were classified A1. No new fields, no ContextPack changes — label only.
// =============================================================================
import { PDFDocument, PDFPage, PDFFont, rgb, StandardFonts } from 'pdf-lib';
import { CANONICAL_PRODUCT_URL } from '../../../lib/product';
import { BRAND, INTENT_KICKER, type DocumentIntent } from './brand';

export type DocumentBlockType =
  | 'heading'
  | 'paragraph'
  | 'bullets'
  | 'numbered'
  | 'table'
  | 'callout'
  | 'quote'
  | 'divider'
  | 'key_value'
  | 'exercise'
  | 'answer_key'
  | 'case'
  | 'timeline'
  | 'comparison'
  | 'framework'
  | 'glossary'
  | 'index'
  | 'summary';

export interface DocumentBlock {
  type: DocumentBlockType;
  level?: 1 | 2 | 3;
  content?: string;
  items?: string[];
  headers?: string[];
  rows?: string[][];
  label?: string;
  style?: 'info' | 'warning' | 'exercise' | 'quote' | 'tip';
  events?: Array<Record<string, string>>;
  steps?: Array<Record<string, string>>;
  terms?: Array<Record<string, string>>;
  answers?: string[];
}

export type EpistemicNature =
  | 'language_course'
  | 'domain_theoretical'
  | 'domain_practical'
  | 'reference_guide'
  | 'exam_preparation'
  | 'professional_training'
  | 'cultural_guide'
  | 'mixed';

export interface DocumentContent {
  title: string;
  subtitle?: string;
  documentType: string;
  level?: string;
  mentorName: string;
  nativeLanguage?: string;
  studentName?: string;
  blocks: DocumentBlock[];
  nextStep?: string;
  generatedAt: string;
  epistemicNature?: EpistemicNature;
  // P19-B — the broader classification documentType always should have sat
  // under. See brand.ts for the rationale. Defaults to 'learning' when
  // absent so every artifact generated before this field existed keeps
  // rendering exactly as before — purely additive.
  documentIntent?: DocumentIntent;
}

export type CourseContent = DocumentContent;

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

// P19 — PREMIUMIZATION. Root gap: content.mentorName arrives as whatever
// case the caller sent (state.mentorProfile is often lowercase — 'sarah',
// 'alex', 'nick' — from frontend session state), and every render site
// echoed it verbatim, showing "sarah" instead of "Sarah" on covers, page
// headers and closing summaries.
function capitalizeMentor(name: string | undefined): string {
  const n = (name ?? '').trim();
  return n ? n.charAt(0).toUpperCase() + n.slice(1).toLowerCase() : n;
}

// P19 — hoisted out of renderCover so the compact header (short documents)
// can share the exact same badge text instead of duplicating the map.
const EPISTEMIC_BADGE_MAP: Record<string, string> = {
  'language_course':       'Curso de idioma',
  'domain_theoretical':    'Curso teorico',
  'domain_practical':      'Guia practica',
  'reference_guide':       'Material de referencia',
  'exam_preparation':      'Preparacion de examen',
  'professional_training': 'Formacion profesional',
  'cultural_guide':        'Guia cultural',
  'mixed':                 'Material combinado',
};

const W = BRAND.page.width, H = BRAND.page.height;
const ML = BRAND.page.marginLeft, MR = BRAND.page.marginRight;
const CW = W - ML - MR;
const MB = BRAND.page.marginBottom;

const C_DARK   = BRAND.colors.dark;
const C_TEAL   = BRAND.colors.teal;
const C_ACCENT = BRAND.colors.accent;
const C_MUTED  = BRAND.colors.muted;
const C_WHITE  = BRAND.colors.white;
const C_LIGHT  = BRAND.colors.light;
const C_TIP    = BRAND.colors.tip;
const C_WARN   = BRAND.colors.warn;

interface PS {
  doc: PDFDocument;
  page: PDFPage;
  bold: PDFFont;
  reg: PDFFont;
  y: number;
}

async function newPage(doc: PDFDocument, bold: PDFFont, reg: PDFFont, doc_content: DocumentContent): Promise<PS> {
  const page = doc.addPage([W, H]);
  page.drawRectangle({ x: 0, y: H - 38, width: W, height: 38, color: C_DARK });
  page.drawText(BRAND.name, { x: ML, y: H - 24, size: 11, font: bold, color: C_WHITE });
  const sub = safe(`${capitalizeMentor(doc_content.mentorName)} - ${doc_content.level ?? ''} - ${doc_content.title}`, 90);
  page.drawText(sub, { x: ML, y: H - 34, size: 7, font: reg, color: C_TEAL });
  return { doc, page, bold, reg, y: H - 52 };
}

function ensureSpace(ps: PS, needed: number): boolean {
  return ps.y - needed >= MB;
}

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
  ps.page.drawText(`${CANONICAL_PRODUCT_URL.replace('https://', '')} - ${BRAND.footerLine}`, { x: ML, y, size: 7, font: ps.reg, color: C_MUTED });
  ps.page.drawText(safe(content.generatedAt, 40), { x: W - MR - 90, y, size: 7, font: ps.reg, color: C_MUTED });
}

interface RenderHints {
  isKpiStrip?: boolean;
  isComparisonMatrix?: boolean;
}

async function renderBlock(ps: PS, block: DocumentBlock, content: DocumentContent, hints: RenderHints = {}): Promise<PS> {
  const text = block.content ?? '';

  switch (block.type) {
    case 'timeline':
    case 'comparison':
    case 'framework':
    case 'answer_key':
    case 'glossary':
    case 'index':
    case 'case': {
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

      // P19-C — KPI STRIP. Root gap: an executive brief's KPIs were rendered
      // as the same two-column key:value rows used for a glossary entry —
      // visually identical to any other list, regardless of what kind of
      // document it lived in. This is a real compositional difference, not
      // a label change: 2-4 KPIs render as horizontal stat cards (same
      // visual language as the cover's meta cards, reused here inside the
      // page body) instead of stacked rows. Only fires once per document,
      // for the FIRST key_value block, and only when documentIntent is
      // 'executive' — every other key_value block (glossaries, terminology
      // in a learning document, etc.) renders exactly as before.
      if (hints.isKpiStrip && items.length >= 2 && items.length <= 5) {
        const n = items.length;
        const gapW = 6;
        const cardW = (CW - gapW * (n - 1)) / n;
        const cardH = 54;
        if (!ensureSpace(ps, cardH + 10)) {
          footer(ps, content);
          ps = await newPage(ps.doc, ps.bold, ps.reg, content);
        }
        gap(ps, 4);
        items.forEach((raw, i) => {
          const [k, ...rest] = raw.split(':');
          const v = rest.join(':').trim();
          const x = ML + i * (cardW + gapW);
          ps.page.drawRectangle({ x, y: ps.y - cardH, width: cardW, height: cardH, color: C_DARK });
          ps.page.drawRectangle({ x, y: ps.y - 3, width: cardW, height: 3, color: C_TEAL });
          const valLines = wrapLines(v || raw, ps.bold, 15, cardW - 12).slice(0, 2);
          let vy = ps.y - 22;
          for (const line of valLines) {
            ps.page.drawText(safe(line), { x: x + 8, y: vy, size: 15, font: ps.bold, color: C_WHITE });
            vy -= 17;
          }
          const keyLines = wrapLines(k ?? '', ps.reg, 7, cardW - 12).slice(0, 2);
          keyLines.forEach((line, li) => {
            ps.page.drawText(safe(line), { x: x + 8, y: ps.y - cardH + 10 - li * 9 + (keyLines.length - 1) * 9, size: 7, font: ps.reg, color: C_TEAL });
          });
        });
        ps.y -= cardH;
        gap(ps, 10);
        break;
      }

      const colW = CW * 0.30;
      const cellPad = 4;
      const keyLineH = 9 * 1.3;
      const valLineH = 9 * 1.3;
      const rowVPad = 6;

      for (let i = 0; i < items.length; i++) {
        const [k, ...rest] = items[i].split(':');
        const v = rest.join(':').trim();
        const keyLines = wrapLines(k ?? '', ps.bold, 9, colW - cellPad * 2);
        const valLines = wrapLines(v, ps.reg, 9, CW - colW - cellPad * 2);
        const lineCount = Math.max(keyLines.length, valLines.length, 1);
        const rowH = lineCount * Math.max(keyLineH, valLineH) + rowVPad;

        if (!ensureSpace(ps, rowH)) {
          footer(ps, content);
          ps = await newPage(ps.doc, ps.bold, ps.reg, content);
        }

        const bg = i % 2 === 0 ? C_LIGHT : C_WHITE;
        ps.page.drawRectangle({ x: ML, y: ps.y - rowH, width: CW, height: rowH, color: bg });
        keyLines.forEach((line, li) => {
          ps.page.drawText(safe(line), { x: ML + cellPad, y: ps.y - (li + 1) * keyLineH + 2, size: 9, font: ps.bold, color: C_ACCENT });
        });
        valLines.forEach((line, li) => {
          ps.page.drawText(safe(line), { x: ML + colW, y: ps.y - (li + 1) * valLineH + 2, size: 9, font: ps.reg, color: C_DARK });
        });
        ps.y -= rowH;
      }
      gap(ps, 6);
      break;
    }

    case 'table': {
      const headers = block.headers ?? [];
      const rows = block.rows ?? [];
      const nCols = headers.length > 0 ? headers.length : (rows[0]?.length ?? 1);
      const colW = nCols > 0 ? CW / nCols : CW;
      const cellPad = 4;
      const headerLineH = 8 * 1.3;
      const rowLineH = 8.5 * 1.3;
      const rowVPad = 6;

      // P19-C — COMPARISON MATRIX LABEL. Root gap: a comparative brief's
      // core table (the actual decision instrument) rendered identically
      // to any incidental table in a lesson. A real compositional signal —
      // not just a badge — for the FIRST table in a comparative-intent
      // document: a labeled accent band directly above it, naming it as
      // the matrix it functionally is.
      if (hints.isComparisonMatrix) {
        const labelH = 18;
        if (!ensureSpace(ps, labelH + 20)) {
          footer(ps, content);
          ps = await newPage(ps.doc, ps.bold, ps.reg, content);
        }
        gap(ps, 4);
        ps.page.drawRectangle({ x: ML, y: ps.y - labelH, width: CW, height: labelH, color: C_ACCENT });
        ps.page.drawText('MATRIZ COMPARATIVA', { x: ML + 8, y: ps.y - 13, size: 8, font: ps.bold, color: C_WHITE });
        ps.y -= labelH;
      }

      const drawHeaderRow = (): void => {
        if (headers.length === 0) return;
        const headerWrapped = headers.map((h) => wrapLines(h, ps.bold, 8, colW - cellPad * 2));
        const headerLineCount = Math.max(1, ...headerWrapped.map((l) => l.length));
        const headerH = headerLineCount * headerLineH + rowVPad;
        ps.page.drawRectangle({ x: ML, y: ps.y - headerH, width: CW, height: headerH, color: C_DARK });
        headerWrapped.forEach((lines, i) => {
          lines.forEach((line, li) => {
            ps.page.drawText(safe(line), { x: ML + i * colW + cellPad, y: ps.y - (li + 1) * headerLineH + 2, size: 8, font: ps.bold, color: C_WHITE });
          });
        });
        ps.y -= headerH;
      };

      if (headers.length > 0) {
        const headerWrapped = headers.map((h) => wrapLines(h, ps.bold, 8, colW - cellPad * 2));
        const headerLineCount = Math.max(1, ...headerWrapped.map((l) => l.length));
        const headerH = headerLineCount * headerLineH + rowVPad;
        if (!ensureSpace(ps, headerH)) {
          footer(ps, content);
          ps = await newPage(ps.doc, ps.bold, ps.reg, content);
        }
        drawHeaderRow();
      }

      for (let r = 0; r < rows.length; r++) {
        const row = rows[r] ?? [];
        const wrapped = row.map((cell) => wrapLines(cell, ps.reg, 8.5, colW - cellPad * 2));
        const lineCount = Math.max(1, ...wrapped.map((l) => l.length));
        const rowH = lineCount * rowLineH + rowVPad;

        if (!ensureSpace(ps, rowH)) {
          footer(ps, content);
          ps = await newPage(ps.doc, ps.bold, ps.reg, content);
          drawHeaderRow();
        }

        const rowBg = r % 2 === 0 ? C_LIGHT : C_WHITE;
        ps.page.drawRectangle({ x: ML, y: ps.y - rowH, width: CW, height: rowH, color: rowBg });
        wrapped.forEach((lines, i) => {
          lines.forEach((line, li) => {
            ps.page.drawText(safe(line), { x: ML + i * colW + cellPad, y: ps.y - (li + 1) * rowLineH + 2, size: 8.5, font: ps.reg, color: C_DARK });
          });
        });
        ps.y -= rowH;
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

// P13-B — closed artifact-type taxonomy display labels (Spanish), keyed on
// the canonical slugs normalized in composeArtifactDocument.ts. Replaces the
// old free-text documentType badge, which let title/type/content each say
// something different. Falls back to the raw value (existing behavior) for
// any legacy/unrecognized type, so nothing already in flight breaks.
const ARTIFACT_TYPE_BADGE: Record<string, string> = {
  lesson: 'LECCIÓN',
  study_guide: 'GUÍA DE ESTUDIO',
  course: 'CURSO',
  worksheet: 'FICHA DE EJERCICIOS',
  reference: 'MATERIAL DE REFERENCIA',
  assessment: 'EVALUACIÓN',
  learning_plan: 'PLAN DE APRENDIZAJE',
  // P19-B — non-pedagogical slugs (see composeArtifactDocument.ts)
  dossier: 'DOSSIER',
  executive_brief: 'DOCUMENTO EJECUTIVO',
  comparative_brief: 'ANÁLISIS COMPARATIVO',
};

async function renderCover(doc: PDFDocument, bold: PDFFont, reg: PDFFont, content: DocumentContent): Promise<void> {
  const cover = doc.addPage([W, H]);
  const intent = content.documentIntent ?? 'learning';

  cover.drawRectangle({ x: 0, y: 0, width: W, height: H, color: C_DARK });
  cover.drawText(BRAND.name, { x: ML, y: H - 80, size: 40, font: bold, color: C_WHITE });
  cover.drawText(BRAND.tagline, { x: ML, y: H - 102, size: 10, font: reg, color: C_TEAL });
  cover.drawRectangle({ x: ML, y: H - 116, width: CW, height: 1.5, color: C_TEAL });

  // P19-B — INTENT KICKER. Root gap: every artifact, regardless of subject
  // or purpose, opened with the exact same cover treatment — a scientific
  // dossier and a Spanish lesson were visually indistinguishable beyond the
  // badge text. This one line, drawn from the same brand palette (no new
  // colors), is the minimum honest signal that the document knows what
  // kind of document it is before the reader reaches the title.
  cover.drawText(safe(INTENT_KICKER[intent], 40), { x: ML, y: H - 130, size: 8, font: bold, color: C_MUTED });

  const badgeText = content.epistemicNature
    ? (EPISTEMIC_BADGE_MAP[content.epistemicNature] ?? content.documentType)
    : (ARTIFACT_TYPE_BADGE[content.documentType] ?? content.documentType);
  if (badgeText) {
    const badge = safe(badgeText.toUpperCase(), 30);
    cover.drawText(badge, { x: ML, y: H - 148, size: 9, font: bold, color: C_TEAL });
  }

  let y = H - 176;
  const titleLines = wrapLines(content.title, bold, 22, CW);
  for (const line of titleLines) {
    cover.drawText(safe(line), { x: ML, y, size: 22, font: bold, color: C_WHITE });
    y -= 28;
  }

  if (content.subtitle) {
    y -= 8;
    const subLines = wrapLines(content.subtitle, reg, 12, CW);
    for (const line of subLines) {
      cover.drawText(safe(line), { x: ML, y, size: 12, font: reg, color: C_MUTED });
      y -= 16;
    }
  }

  y -= 20;
  // P19 — METADATA HYGIENE. Root gap: "Bloques: N" and "Idioma: ES" are
  // backend/internal facts with zero value to the student reading a
  // downloaded document — they described the document's own construction,
  // not its content. Removed. Level (when actually confirmed) and mentor
  // (now properly capitalized) remain — both are genuinely useful context.
  const meta = [
    content.level ? ['Nivel de español', content.level] : null,
    content.mentorName ? ['Mentor', capitalizeMentor(content.mentorName)] : null,
  ].filter(Boolean) as [string, string][];

  const colW = CW / Math.max(1, Math.min(meta.length, 4));
  meta.slice(0, 4).forEach(([k, v], i) => {
    const x = ML + i * colW;
    cover.drawRectangle({ x, y: y - 36, width: colW - 4, height: 36, color: BRAND.colors.metaCardBg });
    cover.drawText(safe(k), { x: x + 6, y: y - 16, size: 7.5, font: reg, color: C_TEAL });
    cover.drawText(safe(v, 18), { x: x + 6, y: y - 30, size: 12, font: bold, color: C_WHITE });
  });

  cover.drawText(BRAND.footerLine, { x: ML, y: 36, size: 9, font: reg, color: C_TEAL });
  cover.drawText(safe(`${CANONICAL_PRODUCT_URL.replace('https://', '')} - ${content.generatedAt}`, 60), { x: ML, y: 20, size: 8, font: reg, color: C_MUTED });
}

// P19 — ADAPTIVE COVER. Root gap: renderCover() always consumed a full
// dedicated page — for a short artifact (a single table, a quick schema:
// a handful of blocks) that meant a nearly-empty premium page followed by
// the actual content, which read as padding rather than design. This
// compact variant draws the same visual language (dark band, badge,
// title, mentor) directly at the top of the FIRST CONTENT page instead of
// spending a whole page on it — content begins immediately below. Reuses
// the exact same colors/fonts/badge map as the full cover; no new design
// language, no new renderer, just a condensed placement for short docs.
async function newPageWithCompactHeader(doc: PDFDocument, bold: PDFFont, reg: PDFFont, content: DocumentContent): Promise<PS> {
  const page = doc.addPage([W, H]);
  const intent = content.documentIntent ?? 'learning';
  const headerH = 116;
  page.drawRectangle({ x: 0, y: H - headerH, width: W, height: headerH, color: C_DARK });
  page.drawText(BRAND.name, { x: ML, y: H - 26, size: 13, font: bold, color: C_WHITE });
  page.drawText(safe(INTENT_KICKER[intent], 40), { x: ML, y: H - 38, size: 6.5, font: reg, color: C_MUTED });

  const badgeText = content.epistemicNature
    ? (EPISTEMIC_BADGE_MAP[content.epistemicNature] ?? content.documentType)
    : (ARTIFACT_TYPE_BADGE[content.documentType] ?? content.documentType);
  if (badgeText) {
    page.drawText(safe(badgeText.toUpperCase(), 30), { x: ML, y: H - 50, size: 8, font: bold, color: C_TEAL });
  }

  let y = H - 68;
  const titleLines = wrapLines(content.title, bold, 16, CW).slice(0, 2);
  for (const line of titleLines) {
    page.drawText(safe(line), { x: ML, y, size: 16, font: bold, color: C_WHITE });
    y -= 19;
  }

  const metaLine = [capitalizeMentor(content.mentorName), content.level].filter(Boolean).join('   ·   ');
  if (metaLine) {
    page.drawText(safe(metaLine, 70), { x: ML, y: H - headerH + 14, size: 8, font: reg, color: C_TEAL });
  }

  return { doc, page, bold, reg, y: H - headerH - 18 };
}

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

  // P19 — METADATA HYGIENE. Root gap: "Estudiante: Estudiante" (the
  // generic placeholder name is never replaced with a real one anywhere
  // upstream, so this row always read as a literal duplicate) and
  // "Bloques: N" (an internal construction count) carried no value for
  // the student closing the document. Removed. Mentor name capitalized.
  const summary = [
    content.level ? ['Nivel de español', content.level] : null,
    ['Mentor', capitalizeMentor(content.mentorName)],
  ].filter(Boolean) as [string, string][];

  for (const [k, v] of summary) {
    ps.page.drawText(safe(`${k}:`), { x: ML, y: ps.y, size: 9, font: ps.bold, color: C_MUTED });
    ps.page.drawText(safe(v, 40),   { x: ML + 120, y: ps.y, size: 9, font: ps.reg, color: C_DARK });
    ps.y -= 14;
  }

  footer(ps, content);
}

export async function renderCoursePdf(content: DocumentContent): Promise<Uint8Array> {
  const doc  = await PDFDocument.create();
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const reg  = await doc.embedFont(StandardFonts.Helvetica);

  // P19 — ADAPTIVE COVER DENSITY. A dedicated full cover page is worth its
  // page for a real course/lesson/study guide; for a short artifact (a
  // quick table, a compact schema — a handful of blocks) it was mostly
  // empty space ahead of the actual content. Threshold matches the
  // observed shape of short vs long artifacts in production (a single
  // table/schema/key_value delivery is typically 1-4 blocks; a real
  // lesson or study guide is consistently well above that).
  const isShort = (content.blocks?.length ?? 0) <= 4;

  let ps: PS;
  if (isShort) {
    ps = await newPageWithCompactHeader(doc, bold, reg, content);
  } else {
    await renderCover(doc, bold, reg, content);
    ps = await newPage(doc, bold, reg, content);
  }

  const blocks = content.blocks ?? [];
  // P19-C — computed ONCE before the render loop (not tracked as mutable PS
  // state) so the hint survives page breaks correctly: PS is replaced
  // wholesale on every page break (newPage() returns a fresh object), so
  // any flag stored on PS itself would silently reset mid-document.
  const firstKvIndex = content.documentIntent === 'executive'
    ? blocks.findIndex((b) => b.type === 'key_value') : -1;
  const firstTableIndex = content.documentIntent === 'comparative'
    ? blocks.findIndex((b) => b.type === 'table') : -1;

  for (let i = 0; i < blocks.length; i++) {
    ps = await renderBlock(ps, blocks[i], content, {
      isKpiStrip: i === firstKvIndex,
      isComparisonMatrix: i === firstTableIndex,
    });
  }

  await renderClosing(ps, content);

  return doc.save();
}
