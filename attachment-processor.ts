import { RekognitionClient, DetectTextCommand } from '@aws-sdk/client-rekognition'
import { uploadToS3 } from './storage'

function getRekognition(): RekognitionClient | null {
  if (!process.env.AWS_REGION || !process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
    return null
  }
  return new RekognitionClient({
    region: process.env.AWS_REGION,
    credentials: {
      accessKeyId:     process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
  })
}

async function ocrImage(buffer: Buffer): Promise<{ text: string; available: boolean }> {
  const client = getRekognition()
  if (!client) return { text: '', available: false }
  try {
    const cmd  = new DetectTextCommand({ Image: { Bytes: buffer } })
    const resp = await client.send(cmd)
    if (!resp.TextDetections?.length) return { text: '', available: true }
    const text = resp.TextDetections
      .filter(d => d.Type === 'LINE' && (d.Confidence || 0) > 70)
      .sort((a, b) => (a.Geometry?.BoundingBox?.Top || 0) - (b.Geometry?.BoundingBox?.Top || 0))
      .map(d => d.DetectedText)
      .join('\n')
    return { text, available: true }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[OCR] Rekognition error:', msg)
    return { text: '', available: false }
  }
}

function extractPdfText(buffer: Buffer): string {
  try {
    const raw = buffer.toString('latin1')
    const blocks: string[] = []
    const btEt = /BT([\s\S]*?)ET/g
    let m
    while ((m = btEt.exec(raw)) !== null) {
      const block = m[1]
      const tj   = block.match(/\(([^)]{1,300})\)\s*Tj/g) || []
      const tj2  = block.match(/\[([^\]]*)\]\s*TJ/g) || []
      for (const s of tj) {
        const inner = s.match(/\(([^)]+)\)/)?.[1]
        if (inner) blocks.push(inner.replace(/\\n/g, '\n').trim())
      }
      for (const s of tj2) {
        const parts = s.match(/\(([^)]+)\)/g) || []
        const joined = parts.map(p => p.slice(1, -1)).join('')
        if (joined) blocks.push(joined.trim())
      }
    }
    if (blocks.length > 2) {
      return blocks.filter(t => t.length > 1).join(' ').replace(/\s{2,}/g, ' ').trim().slice(0, 3000)
    }
    // Fallback
    return (raw.match(/\(([^)]{3,200})\)/g) || [])
      .map(c => c.slice(1, -1)).join(' ').replace(/\s+/g, ' ').trim().slice(0, 3000)
  } catch {
    return ''
  }
}

export interface ProcessedAttachment {
  name: string
  type: string
  size: number
  url: string | null
  extractedText: string
  extractionMethod: string
  ocrAvailable: boolean | null
}

export async function processAttachment(
  files: Array<{ name: string; type: string; data: string; size?: number }>,
  state: Record<string, unknown> = {}
) {
  const results: ProcessedAttachment[] = []
  const names: string[] = []

  for (const file of files) {
    const buffer  = Buffer.from(file.data, 'base64')
    const type    = (file.type || '').toLowerCase()
    const name    = file.name || 'unnamed'
    const key     = `attachments/${Date.now()}_${name}`
    const url     = await uploadToS3(buffer, key, type || 'application/octet-stream').catch(() => null)

    let extractedText    = ''
    let extractionMethod = 'none'
    let ocrAvailable: boolean | null = null

    if (type === 'application/pdf') {
      extractedText    = extractPdfText(buffer)
      extractionMethod = 'pdf-heuristic'

    } else if (type.startsWith('image/')) {
      const ocr = await ocrImage(buffer)
      ocrAvailable = ocr.available
      if (ocr.text?.length > 3) {
        extractedText    = ocr.text
        extractionMethod = 'rekognition'
      } else if (!ocr.available) {
        extractedText    = '[OCR not available: AWS Rekognition is not configured. File received but text cannot be extracted from the image.]'
        extractionMethod = 'unavailable'
      } else {
        extractedText    = '[No text detected in the image.]'
        extractionMethod = 'rekognition-empty'
      }

    } else if (type.startsWith('text/') || ['application/json','text/csv','text/plain','text/markdown'].includes(type)) {
      extractedText    = buffer.toString('utf-8').slice(0, 3000)
      extractionMethod = 'raw-text'

    } else {
      extractedText    = `[Unsupported file type for text extraction: ${type}. File received successfully.]`
      extractionMethod = 'unsupported'
    }

    results.push({ name, type, size: file.size || buffer.length, url, extractedText: extractedText.slice(0, 3000), extractionMethod, ocrAvailable })
    names.push(name)
  }

  const withAttachments = { ...state, attachments: [...(Array.isArray(state.attachments) ? state.attachments : []), ...results] }

  return {
    success:        true,
    names,
    urls:           results.map(r => r.url).filter(Boolean) as string[],
    extractedTexts: results.map(r => r.extractedText).filter(Boolean),
    files:          results,
    state:          withAttachments,
  }
}
