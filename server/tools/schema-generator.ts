import OpenAI from 'openai'
import type { SchemaContent } from '@/lib/contracts'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

// Classify the schema type to adapt the prompt
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
- Incluir todas las personas gramaticales correctas
- examples: 6+ ejemplos reales de uso en contexto natural (no frases artificiales de manual)
- Incluir irregularidades y excepciones si las hay
- summary: la regla de formación en una frase memorable`,

    comparison: `
TIPO: CONTRASTE / COMPARACIÓN
- tableRows: izquierda = concepto A, derecha = concepto B (mínimo 5 filas de contraste)
- keyConcepts: los criterios de distinción más importantes
- examples: 4 pares de ejemplos contrastivos reales
- summary: la diferencia clave en una regla 80/20 aplicable`,

    vocabulary: `
TIPO: VOCABULARIO TEMÁTICO
- tableRows: palabra → definición/uso/equivalente (mínimo 6 palabras clave)
- examples: 5+ oraciones reales mostrando el vocabulario en contexto
- subtopics: categorías semánticas del vocabulario
- summary: las 3-5 palabras que más valen la pena memorizar primero`,

    culture: `
TIPO: CULTURA E INMERSIÓN
- keyConcepts: fenómenos culturales específicos, no genéricos
- subtopics: desarrollar con profundidad histórica y social real
- examples: anécdotas, situaciones reales, expresiones propias de esa cultura
- tableRows: solo si aplica (línea del tiempo, comparación regional, etc.)
- summary: la intuición cultural más importante para alguien que va a viajar`,

    cervantes: `
TIPO: PREPARACIÓN DELE/CCSE
- Estructura orientada al examen oficial
- tableRows: tipo de tarea → estrategia → error común a evitar
- quiz: preguntas tipo examen DELE/CCSE con opciones plausibles
- examples: fragmentos de texto similares a los del examen real
- summary: la estrategia más útil para este componente del examen`,

    grammar: `
TIPO: GRAMÁTICA
- tableRows: regla → aplicación / excepción (mínimo 5 filas)
- examples: 5+ ejemplos correctos Y errores comunes corregidos
- subtopics: subdivisiones gramaticales relevantes
- summary: la regla principal que cubre el 80% de los casos`,

    general: `
TIPO: GENERAL
- Adaptar tableRows, subtopics y examples al contenido específico
- Priorizar practicidad y claridad pedagógica
- summary: la idea más valiosa del tema en una frase concreta`,
  }

  return `Eres el generador de esquemas pedagógicos de LINGORA. Nivel del estudiante: ${level}.
El usuario interactúa en: ${uiLanguage}.

INSTRUCCIÓN DE NIVEL (${level}): ${levelInstructions}

${kindInstructions[kind]}

REGLAS ABSOLUTAS DE CALIDAD:
✅ Toda información gramatical debe ser 100% correcta en español
✅ Los ejemplos deben ser frases reales y naturales, no oraciones de manual artificial
✅ Cada subtema debe aportar valor pedagógico real, no repetir otros
✅ El summary debe ser una regla 80/20 verdaderamente útil y aplicable
✅ El quiz debe tener respuestas incorrectas plausibles (no obviamente falsas)
✅ Adaptar el nivel de vocabulario y gramática al nivel CEFR indicado

PROHIBIDO ABSOLUTAMENTE:
❌ Errores gramaticales en cualquier campo
❌ Explicaciones vagas o circulares ("es importante porque es importante")
❌ Ejemplos artificiales que nadie diría en conversación real
❌ Relleno o redundancia entre subtemas
❌ Pseudopedagogía (parecer educativo sin aportar valor real)

Genera un esquema de estudio sobre: "${topic}"

Devuelve SOLO JSON válido, sin texto extra, sin markdown, con esta estructura EXACTA:
{
  "title": "Título pedagógico preciso del tema",
  "block": "Bloque temático (ej: Verbos / Gramática / Cultura / DELE)",
  "objective": "Objetivo de aprendizaje en una frase directa y verificable",
  "keyConcepts": ["concepto1", "concepto2", "concepto3", "concepto4", "concepto5"],
  "tableRows": [
    { "left": "Elemento o forma", "right": "Valor o explicación" }
  ],
  "subtopics": [
    {
      "title": "Nombre del subtema",
      "content": "Explicación clara en 2-4 frases con precisión ${level === 'C1' || level === 'C2' ? 'avanzada' : 'apropiada al nivel'}",
      "keyTakeaway": "Lo esencial de este subtema en una frase"
    }
  ],
  "examples": [
    "Ejemplo 1: frase real completa con contexto natural",
    "Ejemplo 2: frase real completa con contexto natural"
  ],
  "summary": "Regla 80/20: la idea más valiosa del tema que cubre la mayoría de los casos reales",
  "quiz": [
    {
      "question": "Pregunta tipo examen (DELE/UNED si aplica)",
      "options": ["Opción A", "Opción B", "Opción C", "Opción D"],
      "correct": 0
    }
  ]
}

REQUISITOS FINALES:
- tableRows: mínimo 4 filas (más si el tema lo requiere)
- subtopics: mínimo 3, máximo 6
- examples: mínimo 4, máximo 8
- quiz: exactamente 5 preguntas, cada una con 4 opciones, correct es el índice correcto (0-3)
- keyConcepts: exactamente 5`
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
    max_tokens: 2400,
  })

  const raw = completion.choices[0].message.content!

  let parsed: SchemaContent
  try {
    parsed = JSON.parse(raw) as SchemaContent
  } catch {
    throw new Error('Schema generator returned invalid JSON')
  }

  // Validate required fields
  if (!parsed.title?.trim()) throw new Error('Schema missing title')
  if (!parsed.quiz || parsed.quiz.length === 0) throw new Error('Schema missing quiz')
  if (!parsed.keyConcepts || parsed.keyConcepts.length === 0) throw new Error('Schema missing keyConcepts')

  return parsed
}

