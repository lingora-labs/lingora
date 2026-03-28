// =============================================================================
// server/tools/schema-generator.ts
// LINGORA SEEK 3.2 — Schema Content Generator
// No changes from live version — preserved as delivered.
// =============================================================================

import OpenAI from 'openai'
import type { SchemaContent } from '@/lib/contracts'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

type SchemaKind = 'grammar' | 'conjugation' | 'comparison' | 'vocabulary' | 'culture' | 'cervantes' | 'general'

function classifyTopic(topic: string): SchemaKind {
  const t = topic.toLowerCase()
  if (/conjug|present|pasado|imperfect|futuro|subjuntiv|verbos?\s+(ser|estar|ir|haber|tener)|indicativ/i.test(t)) return 'conjugation'
  if (/vs\.?|versus|diferencia|comparar|contrast|ser.*estar|por.*para|since.*because/i.test(t)) return 'comparison'
  if (/vocabulario|léxico|lexic|palabras|sustantiv|adjetiv|adverb/i.test(t)) return 'vocabulary'
  if (/cultura|historia|arte|gastronomía|sociedad|tradicion|españa|mexico|colombia|cervantes.*cultura/i.test(t)) return 'culture'
  if (/dele|ccse|siele|cervantes.*examen|examen.*cervantes|oficial|certif/i.test(t)) return 'cervantes'
  if (/gramática|gramatica|sintaxis|morfología|fonética|pronombre|artículo/i.test(t)) return 'grammar'
  return 'general'
}

function buildPrompt(topic: string, level: string, uiLanguage: string, kind: SchemaKind): string {
  const levelGuide: Record<string, string> = {
    A0: 'Vocabulario básico únicamente. Frases muy simples. Sin gramática compleja.',
    A1: 'Frases simples. Presente de indicativo. Vocabulario cotidiano básico.',
    A2: 'Presente, pasado simple, vocabulario de situaciones cotidianas. Conectores básicos.',
    B1: 'Tiempos compuestos, subjuntivo introducción, conectores variados, riqueza léxica media.',
    B2: 'Todos los tiempos verbales, subjuntivo complejo, estructuras perifrásticas, registro formal.',
    C1: 'Dominio avanzado: matices estilísticos, expresiones idiomáticas, gramática contrastiva.',
    C2: 'Maestría: gramática normativa completa, variación dialectal, registro culto y literario.',
  }

  const levelInstructions = levelGuide[level] ?? levelGuide.B1

  const kindInstructions: Record<SchemaKind, string> = {
    conjugation: `
TIPO: CONJUGACIÓN VERBAL
- tableRows OBLIGATORIO: mínimo 7 filas (yo/tú/él/nosotros/vosotros/ellos + ejemplo con frase)
- examples: 6+ ejemplos reales de uso en contexto natural
- summary: la regla de formación en una frase memorable`,
    comparison: `
TIPO: CONTRASTE / COMPARACIÓN
- tableRows: izquierda = concepto A, derecha = concepto B (mínimo 5 filas)
- examples: 4 pares de ejemplos contrastivos reales
- summary: la diferencia clave en una regla 80/20 aplicable`,
    vocabulary: `
TIPO: VOCABULARIO TEMÁTICO
- tableRows: palabra → definición/uso (mínimo 6 palabras clave)
- examples: 5+ oraciones reales mostrando el vocabulario en contexto
- summary: las 3-5 palabras más valiosas primero`,
    culture: `
TIPO: CULTURA E INMERSIÓN
- keyConcepts: fenómenos culturales específicos, no genéricos
- subtopics: profundidad histórica y social real
- examples: anécdotas, situaciones reales
- summary: la intuición cultural más importante`,
    cervantes: `
TIPO: PREPARACIÓN DELE/CCSE
- tableRows: tipo de tarea → estrategia → error común
- quiz: preguntas tipo examen DELE/CCSE con opciones plausibles
- summary: la estrategia más útil para este componente`,
    grammar: `
TIPO: GRAMÁTICA
- tableRows: regla → aplicación / excepción (mínimo 5 filas)
- examples: 5+ ejemplos correctos Y errores comunes corregidos
- summary: la regla principal que cubre el 80% de los casos`,
    general: `
TIPO: GENERAL
- Adaptar tableRows, subtopics y examples al contenido específico
- summary: la idea más valiosa del tema en una frase concreta`,
  }

  return `Eres el generador de esquemas pedagógicos de LINGORA. Nivel del estudiante: ${level}.
El usuario interactúa en: ${uiLanguage}.

INSTRUCCIÓN DE NIVEL (${level}): ${levelInstructions}

${kindInstructions[kind]}

REGLAS ABSOLUTAS:
✅ Toda información gramatical debe ser 100% correcta en español
✅ Los ejemplos deben ser frases reales y naturales
✅ El quiz debe tener respuestas incorrectas plausibles
✅ Adaptar el nivel de vocabulario y gramática al nivel CEFR indicado
❌ No errores gramaticales
❌ No ejemplos artificiales

Genera un esquema de estudio sobre: "${topic}"

Devuelve SOLO JSON válido, sin texto extra, sin markdown:
{
  "title": "Título pedagógico preciso del tema",
  "block": "Bloque temático (ej: Verbos / Gramática / Cultura / DELE)",
  "objective": "Objetivo de aprendizaje en una frase directa",
  "keyConcepts": ["concepto1", "concepto2", "concepto3", "concepto4", "concepto5"],
  "tableRows": [{ "left": "Elemento", "right": "Valor" }],
  "subtopics": [{
    "title": "Nombre del subtema",
    "content": "Explicación clara en 2-4 frases",
    "keyTakeaway": "Lo esencial en una frase"
  }],
  "examples": ["Ejemplo 1", "Ejemplo 2"],
  "summary": "Regla 80/20: la idea más valiosa del tema",
  "quiz": [{
    "question": "Pregunta tipo examen",
    "options": ["Opción A", "Opción B", "Opción C", "Opción D"],
    "correct": 0,
    "explanation": "Por qué esta opción es correcta"
  }],
  "erroresFrecuentes": [
    "❌ Error: [incorrecto] → ✅ Correcto: [correcto] — Motivo: [explicación breve]"
  ]
}

REQUISITOS (FORMATO UNED — OBLIGATORIO):
- keyConcepts: exactamente 6, con concepto clave subrayado semánticamente en el JSON
- tableRows: mínimo 5 filas — columnas izquierda/derecha con terminología precisa
- subtopics: mínimo 5 secciones, cada content de mínimo 60 palabras, cada keyTakeaway en formato "Regla: [regla concisa]"
- examples: mínimo 6 ejemplos naturales en contexto real, no aislados
- quiz: exactamente 5 preguntas con opciones plausibles y explanation en cada una
- erroresFrecuentes: exactamente 3 errores típicos con formato "❌ Error: [incorrecto] → ✅ Correcto: [correcto]"
- summary: regla 80/20 en una frase memorable, máximo 20 palabras
- El JSON debe incluir el campo erroresFrecuentes (array de strings)\`
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
    model: 'gpt-4o',
    messages: [{ role: 'system', content: prompt }],
    temperature: 0.2,
    response_format: { type: 'json_object' },
    max_tokens: 3500, // P4: UNED format requires more tokens
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

