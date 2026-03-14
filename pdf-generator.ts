import { PDFDocument, rgb, StandardFonts } from 'pdf-lib'
import { uploadToS3 } from './storage'

export async function generatePDF(params: {
  title: string
  content: string
  filename?: string
}): Promise<{ success: boolean; url?: string; method?: string; error?: string; message?: string }> {
  try {
    const { title, content, filename } = params
    const pdfDoc = await PDFDocument.create()
    const font   = await pdfDoc.embedFont(StandardFonts.Helvetica)
    const page   = pdfDoc.addPage([595.28, 841.89])
    const { height } = page.getSize()

    page.drawText(title.slice(0, 80), {
      x: 50, y: height - 60, size: 20, font,
      color: rgb(0.12, 0.2, 0.8),
    })

    const lines = String(content).split(/\n+/)
    let y = height - 110
    for (const rawLine of lines) {
      const line = rawLine.slice(0, 90)
      if (y < 60) break
      page.drawText(line, { x: 50, y, size: 12, font, color: rgb(0.1, 0.1, 0.1) })
      y -= 18
    }

    const bytes  = await pdfDoc.save()
    const buffer = Buffer.from(bytes)
    const key    = `pdfs/${filename || `lingora-${Date.now()}`}.pdf`

    const s3Url = await uploadToS3(buffer, key, 'application/pdf')
    if (s3Url) return { success: true, url: s3Url, method: 's3' }

    return {
      success: true,
      url:    `data:application/pdf;base64,${buffer.toString('base64')}`,
      method: 'dataurl',
    }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error('[PDF] Error:', msg)
    return { success: false, error: 'generation_failed', message: msg }
  }
}
