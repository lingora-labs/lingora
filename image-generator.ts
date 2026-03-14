import OpenAI from 'openai'
import { uploadToS3 } from './storage'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

export async function generateImage(
  prompt: string
): Promise<{ success: boolean; url?: string; method?: string; error?: string; message?: string }> {
  try {
    const finalPrompt = String(prompt || '')
      .replace(/.*imagen/i, '')
      .replace(/.*image/i, '')
      .trim() || 'Educational Spanish learning illustration'

    const result = await openai.images.generate({
      model:   'dall-e-3',
      prompt:  finalPrompt,
      n:       1,
      size:    '1024x1024',
      quality: 'standard',
    })

    const remoteUrl = result.data?.[0]?.url
    if (!remoteUrl) throw new Error('No image URL returned from DALL-E')

    const response = await fetch(remoteUrl)
    if (!response.ok) throw new Error(`Image download failed: ${response.status}`)

    const buffer = Buffer.from(await response.arrayBuffer())
    const key    = `images/${Date.now()}.png`

    const s3Url = await uploadToS3(buffer, key, 'image/png')
    if (s3Url) return { success: true, url: s3Url, method: 's3' }

    return {
      success: true,
      url:    `data:image/png;base64,${buffer.toString('base64')}`,
      method: 'dataurl',
    }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error('[IMAGE] Error:', msg)
    return { success: false, error: 'generation_failed', message: msg }
  }
}
