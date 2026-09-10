// P12-A+B — deterministic fixtures. Generates PDFs directly via renderCoursePdf
// (no WILLY, no OpenAI call) and writes them to disk for text-integrity
// verification with an independent parser (pypdf, run separately).
import { renderCoursePdf, type DocumentContent } from '../server/tools/pdf/generateCoursePdf';
import { writeFileSync } from 'fs';

const LONG_HEADER = 'Pregunta clínica completa que excede el límite antiguo de 30 caracteres';
const LONG_CELL_A = 'Esta celda contiene una frase completa que definitivamente supera los treinta y cinco caracteres del límite anterior y debe sobrevivir íntegra';
const LONG_CELL_B = 'Segunda columna con otro fragmento de texto igualmente largo que también debe preservarse por completo sin cortes a mitad de palabra';
const TAIL_TOKEN_TABLE = 'SOBREVIVIR-TABLA-TOKEN-FINAL';

async function tableFixture(): Promise<DocumentContent> {
  const rows: string[][] = [];
  for (let i = 0; i < 3; i++) {
    rows.push([`${LONG_CELL_A} fila${i}`, `${LONG_CELL_B} fila${i} ${TAIL_TOKEN_TABLE}`]);
  }
  return {
    title: 'P12-A Table Fixture',
    documentType: 'test',
    mentorName: 'sarah',
    blocks: [
      { type: 'heading', level: 1, content: 'Tabla larga' },
      { type: 'table', headers: [LONG_HEADER, 'Respuesta prudente y extensa que también excede el límite viejo'], rows },
    ],
    generatedAt: '2026-09-10',
  };
}

const LONG_KEY = 'Término técnico compuesto que excede el límite antiguo de treinta y cinco caracteres';
const LONG_VALUE = 'Definición extensa que debe preservarse íntegra, con múltiples líneas de texto envuelto y un token final identificable';
const TAIL_TOKEN_KV = 'SOBREVIVIR-KV-TOKEN-FINAL';

async function keyValueFixture(): Promise<DocumentContent> {
  return {
    title: 'P12-B KeyValue Fixture',
    documentType: 'test',
    mentorName: 'sarah',
    blocks: [
      { type: 'heading', level: 1, content: 'Glosario largo' },
      { type: 'key_value', items: [`${LONG_KEY}: ${LONG_VALUE} ${TAIL_TOKEN_KV}`, 'corto: valor breve'] },
    ],
    generatedAt: '2026-09-10',
  };
}

async function multipageTableFixture(): Promise<DocumentContent> {
  const rows: string[][] = [];
  for (let i = 0; i < 40; i++) {
    rows.push([`Fila ${i} con texto largo que ocupa varias líneas dentro de la celda para forzar altura extra`, `Valor columna 2 fila ${i} también extenso`]);
  }
  rows.push(['MARCADOR-ULTIMA-FILA', `${TAIL_TOKEN_TABLE}-MULTIPAGE`]);
  return {
    title: 'P12-Multipage Table Fixture',
    documentType: 'test',
    mentorName: 'sarah',
    blocks: [
      { type: 'heading', level: 1, content: 'Tabla multipágina' },
      { type: 'table', headers: ['Columna A', 'Columna B'], rows },
    ],
    generatedAt: '2026-09-10',
  };
}

async function regressionFixture(): Promise<DocumentContent> {
  return {
    title: 'P12-Regression Short Table',
    documentType: 'test',
    mentorName: 'sarah',
    blocks: [
      { type: 'heading', level: 1, content: 'Tabla corta normal' },
      { type: 'table', headers: ['A', 'B'], rows: [['x', 'y'], ['1', '2']] },
      { type: 'key_value', items: ['clave: valor'] },
    ],
    generatedAt: '2026-09-10',
  };
}

async function main() {
  writeFileSync('/tmp/p12_table.pdf', await renderCoursePdf(await tableFixture()));
  writeFileSync('/tmp/p12_keyvalue.pdf', await renderCoursePdf(await keyValueFixture()));
  writeFileSync('/tmp/p12_multipage.pdf', await renderCoursePdf(await multipageTableFixture()));
  writeFileSync('/tmp/p12_regression.pdf', await renderCoursePdf(await regressionFixture()));
  console.log('Fixtures written.');
  console.log('TAIL_TOKEN_TABLE=' + TAIL_TOKEN_TABLE);
  console.log('TAIL_TOKEN_KV=' + TAIL_TOKEN_KV);
  console.log('LONG_CELL_A=' + LONG_CELL_A);
  console.log('LONG_CELL_B=' + LONG_CELL_B);
  console.log('LONG_KEY=' + LONG_KEY);
  console.log('LONG_VALUE=' + LONG_VALUE);
}

main();
