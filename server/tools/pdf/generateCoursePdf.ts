// =============================================================================
// server/tools/pdf/generateCoursePdf.ts
// LINGORA SEEK 3.4 — Course PDF Generator (HTML → PDF)
// =============================================================================
// Layout: Zakia extended format
// Structure: PORTADA · OBJETIVO · ROADMAP · MÓDULOS · CIERRE
//
// CONTRACT: LLM provides structured JSON. This generator renders fixed layout.
// =============================================================================

import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

export interface CourseModule {
  index: number;
  title: string;
  vocabulary: Array<[string, string]>;
  grammar: string;
  exercise: string;
  communicativeFunction: string;
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
  nextStep: string;
  generatedAt: string;
}

function escapeHtml(input: string): string {
  return String(input)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderCourseHtml(content: CourseContent): string {
  const roadmap = content.modules
    .slice(0, 12)
    .map(
      (mod) => `
        <div class="roadmap-card">
          <div class="roadmap-index">M${mod.index}</div>
          <div class="roadmap-title">${escapeHtml(mod.title)}</div>
        </div>
      `
    )
    .join('');

  const modulesHtml = content.modules
    .map((mod, idx) => {
      const vocabRows = mod.vocabulary
        .map(
          ([word, meaning]) => `
            <tr>
              <td>${escapeHtml(word)}</td>
              <td>${escapeHtml(meaning)}</td>
            </tr>
          `
        )
        .join('');

      return `
        <section class="module ${idx > 0 ? 'page-break' : ''}">
          <div class="module-band">
            <div class="module-kicker">MÓDULO ${mod.index}</div>
            <div class="module-title">${escapeHtml(mod.title)}</div>
          </div>

          <div class="subsection">
            <div class="sub-title">📚 VOCABULARIO</div>
            <table class="vocab-table">
              <tbody>${vocabRows}</tbody>
            </table>
          </div>

          <div class="subsection">
            <div class="sub-title">📐 GRAMÁTICA — REGLA 80/20</div>
            <div class="rule-box">${escapeHtml(mod.grammar)}</div>
          </div>

          <div class="subsection">
            <div class="sub-title">✏️ EJERCICIO DE PRODUCCIÓN</div>
            <div class="exercise-box">${escapeHtml(mod.exercise)}</div>
            <div class="answer-line"><span>Tu respuesta:</span><span class="line"></span></div>
          </div>

          <div class="subsection">
            <div class="sub-title">💬 FUNCIÓN COMUNICATIVA</div>
            <div class="comm-box">✓ ${escapeHtml(mod.communicativeFunction)}</div>
          </div>

          <div class="tip-box">
            <div class="tip-label">💡 CONSEJO</div>
            <div class="tip-text">${escapeHtml(mod.tip)}</div>
          </div>
        </section>
      `;
    })
    .join('');

  const summary = [
    ['Módulos completados', String(content.totalModules)],
    ['Nivel alcanzado', content.level],
    ['Mentor', content.mentorName],
    ['Estudiante', content.studentName]
  ]
    .map(
      ([k, v]) => `
        <div class="summary-card">
          <div class="summary-key">${escapeHtml(k)}</div>
          <div class="summary-value">${escapeHtml(v)}</div>
        </div>
      `
    )
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

        .page,
        .module,
        .closing-page {
          width: 210mm;
          min-height: 297mm;
          position: relative;
          background: #fff;
        }

        .cover {
          min-height: 297mm;
          background: #0f172a;
          color: #fff;
          padding: 18mm 16mm;
          position: relative;
          border-top: 4px solid #14b8a6;
          border-bottom: 4px solid #14b8a6;
        }

        .brand {
          font-size: 42px;
          font-weight: 800;
          margin: 0 0 4px 0;
          letter-spacing: 0.6px;
        }

        .brand-sub {
          color: #99f6e4;
          font-size: 12px;
          margin-bottom: 10px;
        }

        .cover-rule {
          height: 1px;
          background: #14b8a6;
          margin: 10px 0 20px 0;
        }

        .cover-title {
          font-size: 26px;
          line-height: 1.25;
          font-weight: 800;
          margin-bottom: 10px;
        }

        .cover-objective {
          color: #cbd5e1;
          font-size: 13px;
          line-height: 1.6;
          max-width: 86%;
          margin-bottom: 18px;
        }

        .student-box {
          background: rgba(255,255,255,0.07);
          padding: 12px 14px;
          border-left: 4px solid #14b8a6;
          margin-bottom: 18px;
        }

        .student-label {
          font-size: 11px;
          color: #99f6e4;
          font-weight: 700;
          margin-bottom: 2px;
        }

        .student-main {
          font-size: 16px;
          font-weight: 700;
          margin-bottom: 5px;
        }

        .student-meta {
          font-size: 11px;
          color: #cbd5e1;
        }

        .roadmap-title {
          color: #99f6e4;
          font-size: 12px;
          font-weight: 800;
          margin: 12px 0 8px 0;
        }

        .roadmap-grid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 8px;
        }

        .roadmap-card {
          background: rgba(255,255,255,0.07);
          border: 1px solid rgba(153,246,228,0.15);
          border-radius: 10px;
          padding: 8px;
          min-height: 54px;
        }

        .roadmap-index {
          font-size: 11px;
          font-weight: 800;
          color: #99f6e4;
          margin-bottom: 4px;
        }

        .roadmap-title {
          font-size: 10px;
          line-height: 1.35;
          color: #e2e8f0;
          margin: 0;
        }

        .cover-footer {
          position: absolute;
          left: 16mm;
          right: 16mm;
          bottom: 12mm;
          color: #94a3b8;
          font-size: 10px;
          display: flex;
          justify-content: space-between;
        }

        .inner-header {
          background: #0f172a;
          color: #fff;
          padding: 9mm 16mm 7mm 16mm;
          border-top: 4px solid #14b8a6;
        }

        .inner-header-row {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          gap: 12px;
        }

        .inner-brand {
          font-size: 18px;
          font-weight: 800;
        }

        .inner-course {
          font-size: 11px;
          color: #99f6e4;
        }

        .inner-content {
          padding: 12mm 16mm 16mm 16mm;
        }

        .main-title {
          font-size: 18px;
          font-weight: 800;
          color: #0f172a;
          margin-bottom: 8px;
        }

        .accent {
          width: 42px;
          height: 3px;
          background: #14b8a6;
          margin-bottom: 12px;
        }

        .objective-box,
        .rule-box,
        .exercise-box {
          background: #f8fafc;
          border-left: 4px solid #14b8a6;
          padding: 12px 14px;
          font-size: 13px;
          line-height: 1.65;
          color: #334155;
        }

        .module-band {
          background: #132436;
          color: #fff;
          padding: 10px 14px;
          border-radius: 10px;
          margin-bottom: 14px;
        }

        .module-kicker {
          font-size: 11px;
          font-weight: 800;
          color: #99f6e4;
          margin-bottom: 4px;
        }

        .module-title {
          font-size: 18px;
          font-weight: 800;
        }

        .subsection {
          margin-bottom: 14px;
        }

        .sub-title {
          font-size: 12px;
          font-weight: 800;
          color: #14b8a6;
          margin-bottom: 8px;
        }

        .vocab-table {
          width: 100%;
          border-collapse: collapse;
          table-layout: fixed;
          font-size: 12px;
        }

        .vocab-table td {
          padding: 9px 10px;
          border-bottom: 1px solid #dbe4ee;
        }

        .vocab-table tr:nth-child(odd) td {
          background: #f8fafc;
        }

        .vocab-table td:first-child {
          width: 38%;
          font-weight: 700;
          color: #0f172a;
        }

        .answer-line {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-top: 8px;
          font-size: 12px;
        }

        .answer-line .line {
          flex: 1;
          border-bottom: 1px solid #94a3b8;
          height: 1px;
          transform: translateY(2px);
        }

        .comm-box {
          background: #ecfdf5;
          padding: 10px 12px;
          border-left: 4px solid #14b8a6;
          font-size: 12px;
          color: #0f172a;
        }

        .tip-box {
          background: #132436;
          color: #cbd5e1;
          padding: 12px 14px;
          border-left: 4px solid #14b8a6;
          border-radius: 6px;
          margin-top: 14px;
        }

        .tip-label {
          color: #99f6e4;
          font-size: 11px;
          font-weight: 800;
          margin-bottom: 5px;
        }

        .tip-text {
          font-size: 12px;
          line-height: 1.55;
        }

        .summary-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 10px;
          margin-top: 12px;
        }

        .summary-card {
          background: #f8fafc;
          border-left: 4px solid #14b8a6;
          padding: 12px 14px;
        }

        .summary-key {
          font-size: 11px;
          color: #64748b;
          margin-bottom: 4px;
        }

        .summary-value {
          font-size: 16px;
          color: #0f172a;
          font-weight: 800;
        }

        .footer {
          position: absolute;
          left: 0;
          right: 0;
          bottom: 0;
          background: #0f172a;
          color: #cbd5e1;
          padding: 8px 16mm;
          font-size: 10px;
          display: flex;
          justify-content: space-between;
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
      <section class="cover">
        <div class="brand">LINGORA</div>
        <div class="brand-sub">AI Cultural Immersion Platform for Spanish</div>
        <div class="cover-rule"></div>

        <div class="cover-title">${escapeHtml(content.courseTitle)}</div>
        <div class="cover-objective">${escapeHtml(content.objective)}</div>

        <div class="student-box">
          <div class="student-label">Estudiante</div>
          <div class="student-main">${escapeHtml(content.studentName)}</div>
          <div class="student-meta">
            Nivel: ${escapeHtml(content.level)} · Mentor: ${escapeHtml(content.mentorName)} · ${content.totalModules} módulos
          </div>
          <div class="student-meta" style="margin-top:4px;">
            Idioma origen: ${escapeHtml(content.nativeLanguage.toUpperCase())} · Generado: ${escapeHtml(content.generatedAt)}
          </div>
        </div>

        <div class="roadmap-title">ROADMAP DEL CURSO</div>
        <div class="roadmap-grid">${roadmap}</div>

        <div class="cover-footer">
          <div>lingora.netlify.app</div>
          <div>Learn → Connect → Experience</div>
        </div>
      </section>

      <section class="page-break page">
        <div class="inner-header">
          <div class="inner-header-row">
            <div class="inner-brand">LINGORA</div>
            <div class="inner-course">${escapeHtml(content.courseTitle)}</div>
          </div>
        </div>
        <div class="inner-content">
          <div class="main-title">OBJETIVO GENERAL DEL CURSO</div>
          <div class="accent"></div>
          <div class="objective-box">${escapeHtml(content.objective)}</div>
        </div>
        <div class="footer">
          <div>lingora.netlify.app · ${escapeHtml(content.courseTitle)} · ${escapeHtml(content.studentName)} · Nivel ${escapeHtml(content.level)}</div>
          <div><strong>2 / ${content.modules.length + 2}</strong></div>
        </div>
      </section>

      ${modulesHtml}

      <section class="closing-page page-break">
        <div class="inner-header">
          <div class="inner-header-row">
            <div class="inner-brand">LINGORA</div>
            <div class="inner-course">${escapeHtml(content.courseTitle)}</div>
          </div>
        </div>
        <div class="inner-content">
          <div class="main-title">CIERRE Y PRÓXIMOS PASOS</div>
          <div class="accent"></div>
          <div class="objective-box">${escapeHtml(content.nextStep)}</div>

          <div class="main-title" style="margin-top:18px;">RESUMEN DEL CURSO</div>
          <div class="summary-grid">${summary}</div>
        </div>
        <div class="footer">
          <div>lingora.netlify.app · ${escapeHtml(content.courseTitle)} · ${escapeHtml(content.studentName)} · Nivel ${escapeHtml(content.level)}</div>
          <div><strong>${content.modules.length + 2} / ${content.modules.length + 2}</strong></div>
        </div>
      </section>
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

export async function generateCoursePdf(content: CourseContent): Promise<Uint8Array> {
  const html = renderCourseHtml(content);
  return renderHtmlToPdf(html);
}
