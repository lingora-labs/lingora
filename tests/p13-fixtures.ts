// P13-B+C — deterministic fixtures for artifact type badge coherence and
// "Nivel de español" metadata disambiguation. No WILLY, no OpenAI call.
import { renderCoursePdf, type DocumentContent } from '../server/tools/pdf/generateCoursePdf';
import { writeFileSync } from 'fs';

async function lessonFixture(): Promise<DocumentContent> {
  return {
    title: 'Introducción seria a la acupuntura china',
    documentType: 'lesson',
    level: 'A1',
    mentorName: 'sarah',
    nativeLanguage: 'es',
    studentName: 'Estudiante',
    blocks: [
      { type: 'heading', level: 1, content: 'Tradición, hipótesis y evidencia' },
      { type: 'paragraph', content: 'Contenido de una sola lección sobre acupuntura.' },
    ],
    generatedAt: '2026-09-10',
  };
}

async function courseFixture(): Promise<DocumentContent> {
  return {
    title: 'Curso de español A1: módulos completos',
    documentType: 'course',
    level: 'A1',
    mentorName: 'sarah',
    nativeLanguage: 'es',
    studentName: 'Estudiante',
    blocks: [
      { type: 'heading', level: 1, content: 'Módulo 1' },
      { type: 'paragraph', content: 'Contenido de un curso estructurado.' },
    ],
    generatedAt: '2026-09-10',
  };
}

async function unknownTypeFixture(): Promise<DocumentContent> {
  return {
    title: 'Documento de tipo no reconocido',
    documentType: 'resumen tematico', // legacy free-text value, pre-P13-B
    level: 'B1',
    mentorName: 'sarah',
    blocks: [
      { type: 'heading', level: 1, content: 'Fallback' },
      { type: 'paragraph', content: 'Debe caer al texto crudo, no romper.' },
    ],
    generatedAt: '2026-09-10',
  };
}

async function main() {
  writeFileSync('/tmp/p13_lesson.pdf', await renderCoursePdf(await lessonFixture()));
  writeFileSync('/tmp/p13_course.pdf', await renderCoursePdf(await courseFixture()));
  writeFileSync('/tmp/p13_unknown.pdf', await renderCoursePdf(await unknownTypeFixture()));
  console.log('P13 fixtures written.');
}

main();
