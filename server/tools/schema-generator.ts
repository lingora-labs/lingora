// =============================================================================
// server/tools/schema-generator.ts
// LINGORA SEEK 3.9-c — Schema Content Generator
// =============================================================================
// SEEK 3.9-c CHANGES:
//   C2 — generateTableMatrixRich: explicit HTML prohibition in prompt.
//        Previous "no markdown" rule did not cover HTML. GPT-5.x still emitted
//        <span style="color:..."> inside text values by referencing session
//        history. Fix: explicit "NEVER use HTML in text values — tone field
//        controls color rendering via frontend MatrixTableBlock TONE_COLORS map."
// =============================================================================

import OpenAI from 'openai'
import type { SchemaContent } from '@/lib/contracts'
import { buildModelParams } from '../mentors/mentor-engine';

const RUNTIME_MODEL = process.env.OPENAI_MAIN_MODEL || 'gpt-4o-mini';
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

type SchemaKind = 'grammar' | 'conjugation' | 'comparison' | 'vocabulary' | 'culture' | 'cervantes' | 'general'

function classifyTopic(topic: string): SchemaKind {
  const t = topic.toLowerCase()
  if (/conjug|present|pasado|imperfect|futuro|subjuntiv|verbos?\s+(ser|estar|ir|haber|tener)|indicativ/i.test(t)) return 'conjugation'
  if (/vs\.?|versus|diferencia|comparar|contrast|ser.*estar|por.*para|since.*because/i.test(t)) return 'comparison'
  if (/vocabulario|lexico|lexic|palabras|sustantiv|adjetiv|adverb/i.test(t)) return 'vocabulary'
  if (/cultura|historia|arte|gastronomia|sociedad|tradicion|espana|mexico|colombia|cervantes.*cultura/i.test(t)) return 'culture'
  if (/dele|ccse|siele|cervantes.*examen|examen.*cervantes|oficial|certif/i.test(t)) return 'cervantes'
  if (/gramatica|gramatica|sintaxis|morfologia|fonetica|pronombre|articulo/i.test(t)) return 'grammar'
  return 'general'
}

function buildPrompt(topic: string, level: string, uiLanguage: string, kind: SchemaKind): string {
  const levelGuide: Record<string, string> = {
    A0: 'Vocabulario basico unicamente. Frases muy simples. Sin gramatica compleja.',
    A1: 'Frases simples. Presente de indicativo. Vocabulario cotidiano basico.',
    A2: 'Presente, pasado simple, vocabulario de situaciones cotidianas. Conectores basicos.',
    B1: 'Tiempos compuestos, subjuntivo introduccion, conectores variados, riqueza lexica media.',
    B2: 'Todos los tiempos verbales, subjuntivo complejo, estructuras perifrasticas, registro formal.',
    C1: 'Dominio avanzado: matices estilisticos, expresiones idiomaticas, gramatica contrastiva.',
    C2: 'Maestria: gramatica normativa completa, variacion dialectal, registro culto y literario.',
  }
  const levelInstructions = levelGuide[level] ?? levelGuide.B1
  const kindInstructions: Record<SchemaKind, string> = {
    conjugation: 'TIPO: CONJUGACION VERBAL\n- tableRows OBLIGATORIO: minimo 7 filas\n- examples: 6+ ejemplos reales\n- summary: regla de formacion en una frase memorable',
    comparison:  'TIPO: CONTRASTE\n- tableRows: izquierda = A, derecha = B (min 5 filas)\n- examples: 4 pares contrastivos\n- summary: diferencia clave en regla 80/20',
    vocabulary:  'TIPO: VOCABULARIO\n- tableRows: palabra -> definicion (min 6)\n- examples: 5+ oraciones en contexto\n- summary: las 3-5 palabras mas valiosas',
    culture:     'TIPO: CULTURA\n- keyConcepts: fenomenos culturales especificos\n- subtopics: profundidad historica y social real\n- summary: intuicion cultural mas importante',
    cervantes:   'TIPO: DELE/CCSE\n- tableRows: tarea -> estrategia -> error comun\n- quiz: preguntas tipo examen\n- summary: estrategia mas util',
    grammar:     'TIPO: GRAMATICA\n- tableRows: regla -> aplicacion / excepcion (min 5)\n- examples: 5+ correctos Y errores corregidos\n- summary: regla principal 80% casos',
    general:     'TIPO: GENERAL\n- Adaptar tableRows, subtopics y examples al contenido\n- summary: idea mas valiosa del tema',
  }
  return `Eres el generador de esquemas pedagogicos de LINGORA. Nivel: ${level}. Idioma interfaz: ${uiLanguage}.
INSTRUCCION NIVEL (${level}): ${levelInstructions}
${kindInstructions[kind]}
REGLAS: informacion 100% correcta, ejemplos naturales, quiz con opciones plausibles, nivel CEFR ${level}. CRITICO: NO usar HTML (<u><b><span>) ni markdown (**__##) en ningun campo JSON. Solo texto plano. El renderer gestiona la presentacion visual.
Genera esquema sobre: "${topic}"
Devuelve SOLO JSON valido:
{"title":"string","block":"string","objective":"string","keyConcepts":["x6"],"tableRows":[{"left":"","right":""}],"subtopics":[{"title":"","content":"","keyTakeaway":""}],"examples":["x6"],"summary":"string","quiz":[{"question":"","options":["x4"],"correct":0,"explanation":""}],"erroresFrecuentes":["x3"]}
REQUISITOS: keyConcepts=6, tableRows>=5, subtopics>=5 (content>=60 palabras), examples>=6, quiz=5 preguntas, erroresFrecuentes=3.`
}

export async function generateSchemaContent(params: {
  topic: string; level?: string; uiLanguage?: string;
}): Promise<SchemaContent> {
  const { topic, level = 'B1', uiLanguage = 'en' } = params
  const kind = classifyTopic(topic)
  const prompt = buildPrompt(topic, level, uiLanguage, kind)
  const completion = await openai.chat.completions.create({
    ...buildModelParams(RUNTIME_MODEL, 3500, 0.2),
    messages: [{ role: 'system', content: prompt }],
    response_format: { type: 'json_object' }
  })
  const raw = completion.choices[0].message.content!
  let parsed: SchemaContent
  try { parsed = JSON.parse(raw) as SchemaContent }
  catch { throw new Error('Schema generator returned invalid JSON') }
  if (!parsed.title?.trim()) throw new Error('Schema missing title')
  if (!parsed.quiz || parsed.quiz.length === 0) throw new Error('Schema missing quiz')
  if (!parsed.keyConcepts || parsed.keyConcepts.length === 0) throw new Error('Schema missing keyConcepts')
  return parsed
}

export async function generateTableMatrixRich(params: {
  topic: string; level?: string; uiLanguage?: string;
}): Promise<import('@/lib/contracts').TableMatrixArtifact | null> {
  const { topic, level = 'B1', uiLanguage = 'en' } = params;
  // SEEK 3.9-c — C2: EXPLICIT HTML ban in table matrix prompt.
  // Previous prompt said "no markdown" but allowed HTML implicitly.
  // GPT-5.x would emit <span style="color:..."> inside text values because
  // earlier turns in the same conversation had used that pattern.
  // Fix: prohibit HTML and color instructions explicitly, delegate all
  // color rendering to the tone field which the frontend MatrixTableBlock
  // already handles via TONE_COLORS map. The LLM must NOT embed style.
  const prompt = `You are LINGORA's table generator. Generate a COLOR-CODED comparison table for: "${topic}"
Student level: ${level}. Interface language: ${uiLanguage}.

CRITICAL FORMAT RULES — violations break the UI:
- Return ONLY valid JSON. No markdown. No extra text before or after.
- NEVER use HTML in text values: no <span>, no <u>, no <b>, no style attributes.
- NEVER use markdown in text values: no **, no __, no #.
- Text values must be PLAIN TEXT ONLY. The frontend renders colors via the "tone" field.
- Tone values control color: ok=green, danger=red, warn=yellow, info=blue, neutral=gray.
- Use "icon" for visual markers: "OK" renders ✅, "ERR" renders ❌, "TIP" renders ⚠️.

Return ONLY this JSON structure (no markdown wrapper, no extra keys):
{"title":"string","columns":[{"key":"concepto","label":"CONCEPTO"},{"key":"uso_correcto","label":"USO CORRECTO"},{"key":"error_comun","label":"ERROR COMUN"},{"key":"nota","label":"NOTA"}],"rows":[[{"text":"plain text only — NO HTML","tone":"info","bold":true},{"text":"plain text only — NO HTML","tone":"ok","icon":"OK"},{"text":"plain text only — NO HTML","tone":"danger","icon":"ERR"},{"text":"plain text only — NO HTML","tone":"warn","icon":"TIP"}]]}

Rules: minimum 6 rows, maximum 10 rows. Each row covers one distinct concept. CEFR ${level} appropriate.`;
  const completion = await openai.chat.completions.create({
    ...buildModelParams(RUNTIME_MODEL, 2000, 0.1),
    messages: [{ role: 'system', content: prompt }],
    response_format: { type: 'json_object' },
  });
  const raw = completion.choices[0].message.content!;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed.columns?.length || !parsed.rows?.length) return null;
    return { type: 'table_matrix' as const, title: parsed.title ?? topic, columns: parsed.columns, rows: parsed.rows };
  } catch { return null; }
}
