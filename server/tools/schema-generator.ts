// =============================================================================
// server/tools/schema-generator.ts
// LINGORA SEEK 3.8 -- Schema Content Generator
// No changes from live version -- preserved as delivered.
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
    conjugation: `
TIPO: CONJUGACION VERBAL
- tableRows OBLIGATORIO: minimo 7 filas (yo/tu/el/nosotros/vosotros/ellos + ejemplo con frase)
- examples: 6+ ejemplos reales de uso en contexto natural
- summary: la regla de formacion en una frase memorable`,
    comparison: `
TIPO: CONTRASTE / COMPARACION
- tableRows: izquierda = concepto A, derecha = concepto B (minimo 5 filas)
- examples: 4 pares de ejemplos contrastivos reales
- summary: la diferencia clave en una regla 80/20 aplicable`,
    vocabulary: `
TIPO: VOCABULARIO TEMATICO
- tableRows: palabra -> definicion/uso (minimo 6 palabras clave)
- examples: 5+ oraciones reales mostrando el vocabulario en contexto
- summary: las 3-5 palabras mas valiosas primero`,
    culture: `
TIPO: CULTURA E INMERSION
- keyConcepts: fenomenos culturales especificos, no genericos
- subtopics: profundidad historica y social real
- examples: anecdotas, situaciones reales
- summary: la intuicion cultural mas importante`,
    cervantes: `
TIPO: PREPARACION DELE/CCSE
- tableRows: tipo de tarea -> estrategia -> error comun
- quiz: preguntas tipo examen DELE/CCSE con opciones plausibles
- summary: la estrategia mas util para este componente`,
    grammar: `
TIPO: GRAMATICA
- tableRows: regla -> aplicacion / excepcion (minimo 5 filas)
- examples: 5+ ejemplos correctos Y errores comunes corregidos
- summary: la regla principal que cubre el 80% de los casos`,
    general: `
TIPO: GENERAL
- Adaptar tableRows, subtopics y examples al contenido especifico
- summary: la idea mas valiosa del tema en una frase concreta`,
  }

  return `Eres el generador de esquemas pedagogicos de LINGORA. Nivel del estudiante: ${level}.
El usuario interactua en: ${uiLanguage}.

INSTRUCCION DE NIVEL (${level}): ${levelInstructions}

${kindInstructions[kind]}

REGLAS ABSOLUTAS:
[OK] Toda informacion gramatical debe ser 100% correcta en espanol
[OK] Los ejemplos deben ser frases reales y naturales
[OK] El quiz debe tener respuestas incorrectas plausibles
[OK] Adaptar el nivel de vocabulario y gramatica al nivel CEFR indicado
[X] No errores gramaticales
[X] No ejemplos artificiales

Genera un esquema de estudio sobre: "${topic}"

Devuelve SOLO JSON valido, sin texto extra, sin markdown:
{
  "title": "Titulo pedagogico preciso del tema",
  "block": "Bloque tematico (ej: Verbos / Gramatica / Cultura / DELE)",
  "objective": "Objetivo de aprendizaje en una frase directa",
  "keyConcepts": ["concepto1", "concepto2", "concepto3", "concepto4", "concepto5"],
  "tableRows": [{ "left": "Elemento", "right": "Valor" }],
  "subtopics": [{
    "title": "Nombre del subtema",
    "content": "Explicacion clara en 2-4 frases",
    "keyTakeaway": "Lo esencial en una frase"
  }],
  "examples": ["Ejemplo 1", "Ejemplo 2"],
  "summary": "Regla 80/20: la idea mas valiosa del tema",
  "quiz": [{
    "question": "Pregunta tipo examen",
    "options": ["Opcion A", "Opcion B", "Opcion C", "Opcion D"],
    "correct": 0,
    "explanation": "Por que esta opcion es correcta"
  }],
  "erroresFrecuentes": [
    "[X] Error: [incorrecto] -> [OK] Correcto: [correcto] -- Motivo: [explicacion breve]"
  ]
}

REQUISITOS DE FORMATO (OBLIGATORIO):
- keyConcepts: exactamente 6, con concepto clave subrayado semanticamente en el JSON
- tableRows: minimo 5 filas -- columnas izquierda/derecha con terminologia precisa
- subtopics: minimo 5 secciones, cada content de minimo 60 palabras, cada keyTakeaway en formato "Regla: [regla concisa]"
- examples: minimo 6 ejemplos naturales en contexto real, no aislados
- quiz: exactamente 5 preguntas con opciones plausibles y explanation en cada una
- erroresFrecuentes: exactamente 3 errores tipicos con formato "[X] Error: [incorrecto] -> [OK] Correcto: [correcto]"
- summary: regla 80/20 en una frase memorable, maximo 20 palabras
- El JSON debe incluir el campo erroresFrecuentes (array de strings)`
}

export async function generateSchemaContent(params: {
  topic: string
  level?: string
  uiLanguage?: string
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
  try {
    parsed = JSON.parse(raw) as SchemaContent
  } catch {
    throw new Error('Schema generator returned invalid JSON')
  }

  if (!parsed.title?.trim()) throw new Error('Schema missing title')
  if (!parsed.quiz || parsed.quiz.length === 0) throw new Error('Schema missing quiz')
  if (!parsed.keyConcepts || parsed.keyConcepts.length === 0) throw new Error('Schema missing keyConcepts')

  return parsed
}


// =============================================================================
// SEEK 3.4 -- generateTableMatrixRich
// Produces a TableMatrixArtifact with semantic tone per cell (ok/warn/danger/info)
// so the MatrixTableBlock renderer shows colors as in LINGORA 2.6
// =============================================================================

export async function generateTableMatrixRich(params: {
  topic: string;
  level?: string;
  uiLanguage?: string;
}): Promise<import('@/lib/contracts').TableMatrixArtifact | null> {
  const { topic, level = 'B1', uiLanguage = 'en' } = params;

  const prompt = `You are LINGORA's table generator. Generate a COLOR-CODED comparison table for: "${topic}"
Student level: ${level}. Interface language: ${uiLanguage}.

Return ONLY valid JSON with this exact structure - no markdown, no extra text:
{
  "title": "Table title",
  "columns": [
    {"key": "concepto", "label": "CONCEPTO"},
    {"key": "uso_correcto", "label": "USO CORRECTO"},
    {"key": "error_comun", "label": "ERROR COMUN"},
    {"key": "nota", "label": "NOTA"}
  ],
  "rows": [
    [
      {"text": "concept name", "tone": "info", "bold": true},
      {"text": "correct usage or form", "tone": "ok", "icon": "OK"},
      {"text": "common error to avoid", "tone": "danger", "icon": "ERR"},
      {"text": "key tip or rule", "tone": "warn", "icon": "TIP"}
    ]
  ]
}

RULES:
- tone values: ok (correct/good), danger (error/wrong), warn (caution/note), info (neutral concept), neutral (plain)
- minimum 6 rows, maximum 10 rows
- each row covers one distinct concept/verb/rule/structure
- use the tone to make the table visually meaningful
- do NOT use markdown in text values
- columns must match the columns array keys`;

  const completion = await openai.chat.completions.create({
    ...buildModelParams(RUNTIME_MODEL, 2000, 0.1),
    messages: [{ role: 'system', content: prompt }],
    response_format: { type: 'json_object' },
  });

  const raw = completion.choices[0].message.content!;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed.columns?.length || !parsed.rows?.length) return null;
    return {
      type: 'table_matrix' as const,
      title: parsed.title ?? topic,
      columns: parsed.columns,
      rows: parsed.rows,
    };
  } catch {
    return null;
  }
}
