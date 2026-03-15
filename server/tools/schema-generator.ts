import OpenAI from 'openai'
import type { SchemaContent } from '@/lib/contracts'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

export async function generateSchemaContent(params: {
  topic: string
  level?: string
  uiLanguage?: string
}): Promise<SchemaContent> {
  const { topic, level = 'A1', uiLanguage = 'en' } = params

  const prompt = `Genera un esquema de estudio sobre "${topic}" (nivel ${level}) con este formato JSON EXACTO:
{
  "title": "Titulo principal",
  "block": "Bloque tematico",
  "objective": "Objetivo pedagogico claro",
  "keyConcepts": ["concepto1", "concepto2", "concepto3", "concepto4", "concepto5"],
  "subtopics": [
    {
      "title": "Subtema 1",
      "content": "Explicacion del subtema...",
      "keyTakeaway": "80/20 parcial de este subtema"
    }
  ],
  "globalTakeaway": "80/20 global del tema",
  "quiz": [
    {
      "question": "Pregunta de examen",
      "options": ["Opcion A", "Opcion B", "Opcion C"],
      "correct": 0
    }
  ]
}
REGLAS:
- El usuario habla en ${uiLanguage}. El contenido en espanol.
- Incluye 3 subtemas minimo
- Incluye 5 preguntas de examen
- Maxima claridad pedagogica`

  const completion = await openai.chat.completions.create({
    model:           'gpt-4o',
    messages:        [{ role: 'system', content: prompt }],
    temperature:     0.3,
    response_format: { type: 'json_object' },
  })

  return JSON.parse(completion.choices[0].message.content!) as SchemaContent
}
