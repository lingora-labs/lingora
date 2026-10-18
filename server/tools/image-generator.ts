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
      model:   'gpt-image-1',
      prompt:  finalPrompt,
      n:       1,
      size:    '1024x1024',
      quality: 'medium',
    })

    // GPT Image returns image bytes directly, rather than a hosted URL.
    // Preserve the existing S3 upload and PNG data-URL fallback below.
    const encoded = result.data?.[0]?.b64_json
    if (!encoded) throw new Error('No image bytes returned from GPT Image')

    const buffer = Buffer.from(encoded, 'base64')
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
