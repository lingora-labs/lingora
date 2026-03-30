// =============================================================================
// server/tools/pdf/generateLessonPdf.ts
// LINGORA SEEK 3.4 — Lesson PDF Generator (HTML → PDF)
// =============================================================================
// Layout: Business Spanish A0/A1 (Sara format)
// Sections: HEADER · DEL 1 · DEL 2 · DEL 3 · DEL 4 · DEL 5 · FASIT
//
// CONTRACT: LLM provides structured JSON. This generator renders fixed layout.
// No LLM improvisation of section count or structure.
// =============================================================================

import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

export interface LessonContent {
  mentorName: string;
  level: string;
  topicTitle: string;
  nativeLanguage: string;
  interfaceLanguage: string;
  keyPhrases: Array<[string, string]>;
  buildSlots: Array<{ label: string; prefix: string }>;
  gapFill: Array<{ sentence: string; answer: string; wordBank: string[] }>;
  translations: Array<{ native: string; spanish: string }>;
  roleplay: { scenario: string; question: string };
  fasit: {
    del3: string[];
    del4: string[];
  };
}

function escapeHtml(input: string): string {
  return String(input)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderLessonHtml(content: LessonContent): string {
  const nativeLabel =
    content.nativeLanguage === 'no'
      ? 'Norsk'
      : content.nativeLanguage
      ? content.nativeLanguage.toUpperCase()
      : 'Norsk';

  const keyRows = content.keyPhrases
    .map(
      ([esp, nat]) => `
        <tr>
          <td>${escapeHtml(esp)}</td>
          <td>${escapeHtml(nat)}</td>
        </tr>
      `
    )
    .join('');

  const buildRows = content.buildSlots
    .map(
      (slot, i) => `
        <div class="line-item">
          <span class="line-label">${i + 1}. ${escapeHtml(slot.label)}:</span>
          <span class="line-prefix">${escapeHtml(slot.prefix || '')}</span>
          <span class="write-line"></span>
        </div>
      `
    )
    .join('');

  const wordBank = content.gapFill[0]?.wordBank ?? [];
  const gapRows = content.gapFill
    .map(
      (item, i) => `
        <div class="exercise-item">
          <span class="exercise-index">${i + 1}.</span>
          <span>${escapeHtml(item.sentence)}</span>
        </div>
      `
    )
    .join('');

  const transRows = content.translations
    .map(
      (item, i) => `
        <div class="translate-item">
          <div class="translate-source">${i + 1}. ${escapeHtml(item.native)}</div>
          <div class="translate-answer">→ <span class="write-line long"></span></div>
        </div>
      `
    )
    .join('');

  const fasitDel3 = content.fasit.del3
    .map((a, i) => `${i + 1}. ${escapeHtml(a)}`)
    .join(' &nbsp;&nbsp; ');

  const fasitDel4 = content.fasit.del4
    .map((a, i) => `<div class="fasit-item">${i + 1}. ${escapeHtml(a)}</div>`)
    .join('');

  return `
  <!doctype html>
  <html lang="es">
    <head>
      <meta charset="utf-8" />
      <style>
        @page {
          size: A4;
          margin: 0;
        }

        * { box-sizing: border-box; }

        body {
          margin: 0;
          font-family: Arial, Helvetica, sans-serif;
          color: #334155;
          background: #ffffff;
        }

        .page {
          width: 210mm;
          min-height: 297mm;
          padding: 0;
          position: relative;
          background: #fff;
        }

        .header {
          background: #0f172a;
          color: #fff;
          padding: 18mm 16mm 12mm 16mm;
          position: relative;
          border-top: 4px solid #14b8a6;
        }

        .brand {
          font-size: 28px;
          font-weight: 800;
          letter-spacing: 0.5px;
          margin-bottom: 4px;
        }

        .meta {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          gap: 12px;
          font-size: 12px;
          color: #99f6e4;
          margin-bottom: 8px;
        }

        .topic {
          font-size: 20px;
          font-weight: 700;
          color: #ffffff;
        }

        .content {
          padding: 12mm 16mm 14mm 16mm;
        }

        .section {
          margin-bottom: 12mm;
          break-inside: avoid;
        }

        .section-title {
          display: flex;
          align-items: baseline;
          gap: 8px;
          margin-bottom: 7px;
          font-weight: 700;
          color: #0f172a;
        }

        .section-title .tag {
          color: #14b8a6;
          font-size: 14px;
          text-transform: uppercase;
          letter-spacing: 0.3px;
        }

        .section-title .label {
          font-size: 16px;
        }

        .lead {
          font-size: 12px;
          line-height: 1.55;
          color: #475569;
          margin-bottom: 8px;
        }

        table {
          width: 100%;
          border-collapse: collapse;
          table-layout: fixed;
          font-size: 12px;
        }

        thead th {
          background: #0f172a;
          color: #ffffff;
          padding: 10px 12px;
          text-align: left;
          font-size: 12px;
        }

        tbody td {
          padding: 10px 12px;
          border-bottom: 1px solid #dbe4ee;
          vertical-align: top;
        }

        tbody tr:nth-child(odd) td {
          background: #f8fafc;
        }

        .line-item,
        .exercise-item,
        .translate-item {
          font-size: 12px;
          line-height: 1.65;
          margin-bottom: 8px;
        }

        .line-label {
          font-weight: 700;
          color: #334155;
          margin-right: 6px;
        }

        .line-prefix {
          color: #475569;
          margin-right: 4px;
        }

        .write-line {
          display: inline-block;
          min-width: 120px;
          border-bottom: 1px solid #94a3b8;
          transform: translateY(-2px);
        }

        .write-line.long {
          min-width: 290px;
        }

        .wordbank {
          background: #f1f5f9;
          color: #334155;
          border-left: 4px solid #14b8a6;
          padding: 10px 12px;
          margin-bottom: 8px;
          font-size: 12px;
        }

        .exercise-index {
          font-weight: 700;
          margin-right: 6px;
        }

        .rolebox {
          background: #f8fafc;
          border-left: 4px solid #14b8a6;
          padding: 10px 12px;
          margin-bottom: 8px;
          font-size: 12px;
          line-height: 1.6;
        }

        .role-q {
          color: #0f172a;
          font-weight: 700;
          margin-top: 6px;
        }

        .fasit {
          margin-top: 6mm;
          border-top: 2px solid #14b8a6;
          padding-top: 6mm;
        }

        .fasit-title {
          font-size: 18px;
          font-weight: 800;
          color: #0f172a;
          margin-bottom: 10px;
        }

        .fasit-block {
          margin-bottom: 10px;
          font-size: 12px;
          line-height: 1.65;
        }

        .fasit-label {
          font-weight: 700;
          color: #0f172a;
          margin-bottom: 4px;
        }

        .footer {
          position: absolute;
          left: 0;
          right: 0;
          bottom: 0;
          background: #0f172a;
          color: #cbd5e1;
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 8px 16mm;
          font-size: 10px;
        }

        .footer strong {
          color: #99f6e4;
        }

        .page-break {
          page-break-before: always;
        }
      </style>
    </head>
    <body>
      <div class="page">
        <div class="header">
          <div class="brand">LINGORA</div>
          <div class="meta">
            <div>${escapeHtml(content.mentorName)} · Nivel ${escapeHtml(content.level)}</div>
            <div>lingora.netlify.app</div>
          </div>
          <div class="topic">${escapeHtml(content.topicTitle)}</div>
        </div>

        <div class="content">
          <div class="section">
            <div class="section-title">
              <span class="tag">DEL 1</span>
              <span class="label">Frases clave / Key phrases</span>
            </div>
            <div class="lead">Disse setningene er grunnlaget for alle profesjonelle introduksjoner på spansk.</div>
            <table>
              <thead>
                <tr>
                  <th>Español</th>
                  <th>${escapeHtml(nativeLabel)}</th>
                </tr>
              </thead>
              <tbody>${keyRows}</tbody>
            </table>
          </div>

          <div class="section">
            <div class="section-title">
              <span class="tag">DEL 2</span>
              <span class="label">Construye tu presentación</span>
            </div>
            ${buildRows}
          </div>

          <div class="section">
            <div class="section-title">
              <span class="tag">DEL 3</span>
              <span class="label">Completa los espacios</span>
            </div>
            ${
              wordBank.length
                ? `<div class="wordbank">[ ${wordBank.map(escapeHtml).join(' / ')} ]</div>`
                : ''
            }
            ${gapRows}
          </div>

          <div class="section page-break">
            <div class="section-title">
              <span class="tag">DEL 4</span>
              <span class="label">Traduce al español</span>
            </div>
            ${transRows}
          </div>

          <div class="section">
            <div class="section-title">
              <span class="tag">DEL 5</span>
              <span class="label">Práctica de roleplay</span>
            </div>
            <div class="rolebox">
              <div>${escapeHtml(content.roleplay.scenario)}</div>
              <div class="role-q">"${escapeHtml(content.roleplay.question)}"</div>
            </div>
            <div class="line-item">
              <span class="line-label">Tu respuesta:</span>
              <span class="write-line long"></span>
            </div>
            <div class="line-item">
              <span class="write-line long"></span>
            </div>
          </div>

          <div class="fasit">
            <div class="fasit-title">FASIT</div>
            <div class="fasit-block">
              <div class="fasit-label">DEL 3</div>
              <div>${fasitDel3}</div>
            </div>
            <div class="fasit-block">
              <div class="fasit-label">DEL 4</div>
              ${fasitDel4}
            </div>
          </div>
        </div>

        <div class="footer">
          <div>lingora.netlify.app · ${escapeHtml(content.topicTitle)} · ${escapeHtml(content.mentorName)} ${escapeHtml(content.level)}</div>
          <div><strong>1 / 2</strong></div>
        </div>
      </div>
    </body>
  </html>
  `;
}

async function renderHtmlToPdf(html: string): Promise<Uint8Array> {
  const browser = await puppeteer.launch({
    args: chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath: await chromium.executablePath(),
    headless: true
  });

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });

    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true
    });

    return Uint8Array.from(pdf);
  } finally {
    await browser.close();
  }
}

export async function generateLessonPdf(content: LessonContent): Promise<Uint8Array> {
  const html = renderLessonHtml(content);
  return renderHtmlToPdf(html);
}
