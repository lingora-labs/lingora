// =============================================================================
// server/tools/web/renderArtifactHtml.ts
// P19-D — WEB SURFACE. Same semantic document plan the PDF renderer already
// consumes (DocumentContent / DocumentBlock from generateCoursePdf.ts) — no
// second model, no second source of truth, no HTML reconstructed from PDF
// bytes. This function is the second MATERIALIZATION of the same plan: one
// composer (composeArtifactDocument.ts) decides content once; PDF and web
// are two independent renderers reading the same structured object.
//
// SECURITY: every piece of text that could originate from the model (title,
// headings, paragraph/bullet/table content, callout labels, etc.) goes
// through esc() before it reaches the HTML string. Nothing from
// DocumentBlock is ever treated as markup — the block TYPE selects which
// safe template to use; the block's own strings are always data, never
// code. There is no path from LLM output to <script>, event handlers, or
// unescaped tags. This mirrors the same closed-grammar guarantee the PDF
// renderer already relies on (VALID_BLOCK_TYPES in composeArtifactDocument.ts).
//
// P19-G3 — PURPOSE-AWARE VISUAL AUTHORSHIP (increment 1: scientific chapter
// rhythm). Root gap: documentIntent already changed the cover kicker/badge
// and (for executive/comparative) triggered a KPI strip / matrix band, but
// every level-1 heading and every paragraph rendered identically regardless
// of purpose — a scientific dossier's chapters looked exactly like a
// learning lesson's section headers. This is the specific capability named
// by product review as the visible gap: "abstract" and "chapter rhythm" for
// scientific intent. Reuses the EXISTING heading/paragraph block types (no
// composer schema change, no new block grammar) — only the RENDER TREATMENT
// changes, computed from documentIntent + block position, the same pattern
// P19-C already established for the KPI strip and comparison matrix.
// Two real, visible differences for documentIntent === 'scientific':
//   1. The first paragraph block (the composer's own "abstract/summary"
//      paragraph per its system prompt) renders as a distinct bordered
//      abstract panel — light background, left accent bar, italic —
//      instead of a plain paragraph indistinguishable from body text.
//   2. Level-1 headings render as numbered chapter openers ("Capítulo N")
//      with larger type and more vertical rhythm, instead of the compact
//      accent-underline treatment learning/comparative/executive keep.
// Learning, executive and comparative are visually unchanged by this
// commit — their existing treatments (P19-B/C) are untouched.
// =============================================================================
import type { DocumentContent, DocumentBlock } from '../pdf/generateCoursePdf';
import { BRAND, INTENT_KICKER, type DocumentIntent } from '../pdf/brand';

function esc(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Minimal, safe **bold** / _italic_ handling for prose blocks — same
// markers the mentor already uses in chat text. Operates only on already-
// escaped text, and only recognizes these two fixed patterns; nothing
// else in the string can become a tag.
function inline(v: unknown): string {
  return esc(v)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(?<!_)_(?!_)(.+?)(?<!_)_(?!_)/g, '<em>$1</em>');
}

const ARTIFACT_TYPE_BADGE: Record<string, string> = {
  lesson: 'LECCIÓN', study_guide: 'GUÍA DE ESTUDIO', course: 'CURSO',
  worksheet: 'FICHA DE EJERCICIOS', reference: 'MATERIAL DE REFERENCIA',
  assessment: 'EVALUACIÓN', learning_plan: 'PLAN DE APRENDIZAJE',
  dossier: 'DOSSIER', executive_brief: 'DOCUMENTO EJECUTIVO',
  comparative_brief: 'ANÁLISIS COMPARATIVO',
};

function capitalizeMentor(name: string | undefined): string {
  const n = (name ?? '').trim();
  return n ? n.charAt(0).toUpperCase() + n.slice(1).toLowerCase() : n;
}

function renderBlock(
  block: DocumentBlock,
  hints: { isKpiStrip?: boolean; isComparisonMatrix?: boolean; isAbstract?: boolean; chapterNumber?: number },
): string {
  switch (block.type) {
    case 'timeline':
    case 'comparison':
    case 'framework':
    case 'answer_key':
    case 'glossary':
    case 'index':
    case 'case': {
      const parts: string[] = [];
      if (block.content) {
        parts.push(`<h3 class="ln-h3">${esc(block.label ?? block.type.replace('_', ' '))}</h3>`);
        parts.push(`<p class="ln-p">${inline(block.content)}</p>`);
      }
      if (Array.isArray(block.items) && block.items.length) {
        parts.push(renderBlock({ type: 'bullets', items: block.items }, {}));
      }
      if (Array.isArray(block.events) && block.events.length) {
        parts.push(renderBlock({ type: 'numbered', items: block.events.map((ev) => `${ev['date'] ?? ''}: ${ev['event'] ?? ''}`) }, {}));
      }
      if (Array.isArray(block.steps) && block.steps.length) {
        parts.push(renderBlock({ type: 'numbered', items: block.steps.map((st) => `${st['name'] ?? ''}: ${st['description'] ?? ''}`) }, {}));
      }
      if (Array.isArray(block.terms) && block.terms.length) {
        parts.push(renderBlock({ type: 'key_value', items: block.terms.map((tr) => `${tr['term'] ?? tr['label'] ?? ''}: ${tr['definition'] ?? tr['description'] ?? ''}`) }, {}));
      }
      if (Array.isArray(block.answers) && block.answers.length) {
        parts.push(renderBlock({ type: 'numbered', items: block.answers }, {}));
      }
      return parts.join('\n');
    }

    case 'heading': {
      const lvl = block.level ?? 1;
      // P19-G3 — scientific chapter rhythm: a level-1 heading gets a
      // numbered "Capítulo N" opener instead of the compact accent-
      // underline treatment. Only applies when the caller supplied a
      // chapterNumber (i.e. documentIntent === 'scientific' AND lvl === 1);
      // every other intent/level keeps the existing P19-B/C markup exactly.
      if (lvl === 1 && hints.chapterNumber) {
        return `<div class="ln-chapter"><div class="ln-chapter-num">Capítulo ${hints.chapterNumber}</div><h2 class="ln-chapter-title">${inline(block.content)}</h2></div>`;
      }
      const tag = lvl === 1 ? 'h2' : lvl === 2 ? 'h3' : 'h4';
      const cls = lvl === 1 ? 'ln-h1' : lvl === 2 ? 'ln-h2' : 'ln-h3';
      return `<${tag} class="${cls}">${inline(block.content)}</${tag}>`;
    }

    case 'paragraph':
      // P19-G3 — scientific abstract: the composer's own opening summary
      // paragraph (per its system prompt) rendered as a distinct bordered
      // panel instead of plain body text — the reader can tell "this is
      // the abstract" without reading a label.
      if (hints.isAbstract) {
        return `<div class="ln-abstract"><div class="ln-abstract-label">Resumen</div><p class="ln-abstract-body">${inline(block.content)}</p></div>`;
      }
      return `<p class="ln-p">${inline(block.content)}</p>`;

    case 'bullets': {
      const items = block.items ?? (block.content ? [block.content] : []);
      return `<ul class="ln-list">${items.map((it) => `<li>${inline(it)}</li>`).join('')}</ul>`;
    }

    case 'numbered': {
      const items = block.items ?? (block.content ? [block.content] : []);
      return `<ol class="ln-list">${items.map((it) => `<li>${inline(it)}</li>`).join('')}</ol>`;
    }

    case 'key_value': {
      const items = block.items ?? [];
      if (hints.isKpiStrip && items.length >= 2 && items.length <= 5) {
        const cards = items.map((raw) => {
          const [k, ...rest] = raw.split(':');
          const v = rest.join(':').trim();
          return `<div class="ln-kpi-card"><div class="ln-kpi-value">${esc(v || raw)}</div><div class="ln-kpi-label">${esc(k ?? '')}</div></div>`;
        }).join('');
        return `<div class="ln-kpi-strip">${cards}</div>`;
      }
      const rows = items.map((raw) => {
        const [k, ...rest] = raw.split(':');
        const v = rest.join(':').trim();
        return `<div class="ln-kv-row"><div class="ln-kv-key">${esc(k ?? '')}</div><div class="ln-kv-val">${inline(v)}</div></div>`;
      }).join('');
      return `<div class="ln-kv">${rows}</div>`;
    }

    case 'table': {
      const headers = block.headers ?? [];
      const rows = block.rows ?? [];
      const label = hints.isComparisonMatrix ? `<div class="ln-matrix-label">MATRIZ COMPARATIVA</div>` : '';
      const thead = headers.length ? `<thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>` : '';
      const tbody = `<tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${inline(cell)}</td>`).join('')}</tr>`).join('')}</tbody>`;
      // Horizontal scroll wrapper — the clean, standard solution for a
      // table that can't fit a narrow viewport without losing columns or
      // truncating cell content.
      return `${label}<div class="ln-table-scroll"><table class="ln-table">${thead}${tbody}</table></div>`;
    }

    case 'callout':
    case 'exercise': {
      const label = block.label ?? (block.type === 'exercise' ? 'Ejercicio' : 'Nota');
      const style = block.style === 'warning' ? 'warn' : block.style === 'tip' ? 'tip' : 'info';
      return `<div class="ln-callout ln-callout-${style}"><div class="ln-callout-label">${esc(label)}</div><div class="ln-callout-body">${inline(block.content)}</div></div>`;
    }

    case 'quote':
      return `<blockquote class="ln-quote">${inline(block.content)}</blockquote>`;

    case 'divider':
      return `<hr class="ln-divider" />`;

    case 'summary':
      return `<div class="ln-summary">${inline(block.content)}</div>`;

    default:
      return '';
  }
}

export function renderArtifactHtml(content: DocumentContent): string {
  const intent: DocumentIntent = content.documentIntent ?? 'learning';
  const blocks = content.blocks ?? [];
  const firstKvIndex = intent === 'executive' ? blocks.findIndex((b) => b.type === 'key_value') : -1;
  const firstTableIndex = intent === 'comparative' ? blocks.findIndex((b) => b.type === 'table') : -1;
  // P19-G3 — scientific chapter rhythm/abstract are opt-in by index, same
  // pattern as the KPI strip / matrix band above: computed once before the
  // render loop, index-based (not mutable state), survives fine across the
  // single-pass render. First paragraph in a scientific doc = abstract;
  // every level-1 heading after it gets a sequential chapter number.
  const firstParagraphIndex = intent === 'scientific' ? blocks.findIndex((b) => b.type === 'paragraph') : -1;
  let chapterCounter = 0;

  const badgeText = ARTIFACT_TYPE_BADGE[content.documentType] ?? content.documentType;
  const kicker = INTENT_KICKER[intent];

  const bodyHtml = blocks.map((b, i) => {
    const isChapterHeading = intent === 'scientific' && b.type === 'heading' && (b.level ?? 1) === 1;
    if (isChapterHeading) chapterCounter += 1;
    return renderBlock(b, {
      isKpiStrip: i === firstKvIndex,
      isComparisonMatrix: i === firstTableIndex,
      isAbstract: i === firstParagraphIndex,
      chapterNumber: isChapterHeading ? chapterCounter : undefined,
    });
  }).join('\n');

  const metaLine = [
    content.level ? `Nivel de español: ${esc(content.level)}` : null,
    content.mentorName ? `Mentor: ${esc(capitalizeMentor(content.mentorName))}` : null,
  ].filter(Boolean).join(' &nbsp;·&nbsp; ');

  const c = BRAND.cssColors;

  // Single self-contained document: no external stylesheet fetch, no
  // script tags, no inline event handlers. Opened as a data: URL, this
  // gets its own opaque browser origin — it cannot read the app's
  // cookies/session even though it renders in the same tab group.
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(content.title)} — ${esc(BRAND.name)}</title>
<style>
  :root {
    --ln-dark: ${c.dark}; --ln-teal: ${c.teal}; --ln-accent: ${c.accent};
    --ln-muted: ${c.muted}; --ln-white: ${c.white}; --ln-light: ${c.light};
    --ln-tip: ${c.tip}; --ln-warn: ${c.warn};
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
    color: #1a1d29; background: #f4f5f7; line-height: 1.6;
  }
  .ln-header {
    background: var(--ln-dark); color: var(--ln-white); padding: 28px 20px 22px;
  }
  .ln-brand { font-size: 20px; font-weight: 800; letter-spacing: .02em; }
  .ln-tagline { font-size: 12px; color: var(--ln-teal); margin-top: 2px; }
  .ln-kicker { font-size: 11px; font-weight: 700; color: #9aa3b8; margin-top: 14px; letter-spacing: .04em; }
  .ln-badge { display: inline-block; font-size: 11px; font-weight: 700; color: var(--ln-teal); margin-top: 4px; letter-spacing: .04em; }
  .ln-title { font-size: 24px; font-weight: 800; margin-top: 10px; line-height: 1.25; }
  .ln-subtitle { font-size: 14px; color: #b7bdd0; margin-top: 6px; }
  .ln-meta { font-size: 12px; color: var(--ln-teal); margin-top: 14px; }
  .ln-container { max-width: 720px; margin: 0 auto; padding: 28px 20px 60px; }
  .ln-h1 { font-size: 20px; font-weight: 800; color: var(--ln-accent); margin: 28px 0 10px; padding-bottom: 8px; border-bottom: 2px solid var(--ln-teal); }
  .ln-h2 { font-size: 17px; font-weight: 800; color: #1a1d29; margin: 22px 0 8px; }
  .ln-h3 { font-size: 14px; font-weight: 700; color: var(--ln-muted); margin: 18px 0 6px; }
  .ln-p { font-size: 15px; margin: 0 0 12px; color: #2a2e3d; }
  .ln-list { margin: 0 0 14px; padding-left: 22px; font-size: 15px; color: #2a2e3d; }
  .ln-list li { margin-bottom: 6px; }
  .ln-abstract { background: var(--ln-light); border-left: 4px solid var(--ln-accent); border-radius: 4px; padding: 14px 18px; margin: 4px 0 24px; }
  .ln-abstract-label { font-size: 10.5px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; color: var(--ln-accent); margin-bottom: 6px; }
  .ln-abstract-body { font-size: 15px; font-style: italic; color: #2a2e3d; margin: 0; }
  .ln-chapter { margin: 36px 0 14px; padding-top: 10px; border-top: 1px solid #e4e6ed; }
  .ln-chapter-num { font-size: 11px; font-weight: 800; letter-spacing: .1em; text-transform: uppercase; color: var(--ln-teal); margin-bottom: 4px; }
  .ln-chapter-title { font-size: 22px; font-weight: 800; color: var(--ln-dark); margin: 0; line-height: 1.3; }
  .ln-kpi-strip { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 8px; margin: 16px 0; }
  .ln-kpi-card { background: var(--ln-dark); border-radius: 10px; padding: 14px 12px; }
  .ln-kpi-card::before { content: ''; display: block; width: 24px; height: 3px; background: var(--ln-teal); border-radius: 2px; margin-bottom: 10px; }
  .ln-kpi-value { font-size: 19px; font-weight: 800; color: var(--ln-white); line-height: 1.2; }
  .ln-kpi-label { font-size: 10.5px; color: var(--ln-teal); margin-top: 4px; }
  .ln-kv { margin: 12px 0; border-radius: 10px; overflow: hidden; border: 1px solid #e4e6ed; }
  .ln-kv-row { display: flex; padding: 9px 12px; font-size: 14px; }
  .ln-kv-row:nth-child(odd) { background: #f7f8fa; }
  .ln-kv-key { flex: 0 0 34%; font-weight: 700; color: var(--ln-accent); }
  .ln-kv-val { flex: 1; color: #2a2e3d; }
  .ln-matrix-label { display: inline-block; background: var(--ln-accent); color: #fff; font-size: 11px; font-weight: 700; letter-spacing: .04em; padding: 6px 10px; border-radius: 6px 6px 0 0; }
  .ln-table-scroll { overflow-x: auto; margin: 0 0 16px; -webkit-overflow-scrolling: touch; }
  .ln-table { border-collapse: collapse; width: 100%; min-width: 420px; font-size: 13.5px; }
  .ln-table th { background: var(--ln-dark); color: #fff; text-align: left; padding: 8px 10px; font-weight: 700; }
  .ln-table td { padding: 8px 10px; border-bottom: 1px solid #eceef2; vertical-align: top; }
  .ln-table tr:nth-child(even) td { background: #f7f8fa; }
  .ln-callout { border-radius: 10px; padding: 14px 16px; margin: 14px 0; }
  .ln-callout-info { background: var(--ln-light); }
  .ln-callout-warn { background: var(--ln-warn); }
  .ln-callout-tip { background: var(--ln-tip); color: #fff; }
  .ln-callout-tip .ln-p, .ln-callout-tip .ln-callout-body { color: #fff; }
  .ln-callout-label { font-size: 11px; font-weight: 800; letter-spacing: .05em; text-transform: uppercase; margin-bottom: 6px; color: var(--ln-accent); }
  .ln-callout-tip .ln-callout-label { color: var(--ln-teal); }
  .ln-callout-body { font-size: 14.5px; }
  .ln-quote { border-left: 3px solid var(--ln-teal); margin: 14px 0; padding: 4px 0 4px 14px; color: var(--ln-muted); font-size: 14.5px; }
  .ln-divider { border: none; border-top: 1px solid #e4e6ed; margin: 20px 0; }
  .ln-summary { background: var(--ln-light); border-radius: 10px; padding: 12px 16px; font-size: 14px; margin: 14px 0; }
  .ln-next { border-top: 2px solid var(--ln-accent); margin-top: 28px; padding-top: 16px; font-size: 14px; color: var(--ln-muted); }
  .ln-footer { text-align: center; font-size: 11.5px; color: #9aa3b8; padding: 20px; }
  @media (max-width: 480px) {
    .ln-title { font-size: 20px; }
    .ln-container { padding: 20px 14px 48px; }
    .ln-kpi-strip { grid-template-columns: repeat(2, 1fr); }
  }
</style>
</head>
<body>
  <div class="ln-header">
    <div class="ln-brand">${esc(BRAND.name)}</div>
    <div class="ln-tagline">${esc(BRAND.tagline)}</div>
    <div class="ln-kicker">${esc(kicker)}</div>
    <div class="ln-badge">${esc(badgeText.toUpperCase())}</div>
    <div class="ln-title">${esc(content.title)}</div>
    ${content.subtitle ? `<div class="ln-subtitle">${esc(content.subtitle)}</div>` : ''}
    ${metaLine ? `<div class="ln-meta">${metaLine}</div>` : ''}
  </div>
  <div class="ln-container">
    ${bodyHtml}
    ${content.nextStep ? `<div class="ln-next">${inline(content.nextStep)}</div>` : ''}
  </div>
  <div class="ln-footer">${esc(BRAND.footerLine)} · ${esc(content.generatedAt)}</div>
</body>
</html>`;
}
