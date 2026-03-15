import { NextRequest, NextResponse } from 'next/server'
import { generatePDF } from '@/server/tools/pdf-generator'
import OpenAI from 'openai'

export const runtime = 'nodejs'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

export async function POST(req: NextRequest) {
  try {
    const { topic, content, title, state = {} } = await req.json()
    const requestText = topic || content || ''

    if (!requestText) {
      return NextResponse.json({ error: 'topic or content required' }, { status: 400 })
    }

    // Generate real content via model if only topic given
    let pdfContent = content || ''
    if (!pdfContent || pdfContent.length < 50) {
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: 'Eres un asistente pedagogico de LINGORA. Genera contenido educativo estructurado en espanol sobre el tema pedido. Empieza con el titulo en la primera linea, luego secciones separadas por linea en blanco. Maximo 600 palabras. Texto limpio sin markdown especial.',
          },
          { role: 'user', content: requestText },
        ],
        temperature: 0.4,
        max_tokens:  800,
      })
      pdfContent = completion.choices?.[0]?.message?.content || requestText
    }

    const titleLine = (title || pdfContent.split('\n')[0]).slice(0, 80).trim()
    const pdf = await generatePDF({ title: titleLine || 'Material LINGORA', content: pdfContent, filename: 'lingora-' + Date.now() })

    if (!pdf.success || !pdf.url) {
      return NextResponse.json({ message: 'Could not generate PDF: ' + (pdf.message || 'unknown'), artifact: null, state })
    }

    return NextResponse.json({
      message:  'PDF generated:',
      artifact: { type: 'pdf', url: pdf.url },
      state:    { ...state, lastTask: 'pdf', lastArtifact: 'pdf:' + titleLine },
    })

  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[PDF ROUTE] Fatal:', msg)
    return NextResponse.json({ message: 'PDF generation error: ' + msg }, { status: 500 })
  }
}
