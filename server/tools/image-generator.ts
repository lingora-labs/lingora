// LINGORA 7.5 P1-B — free illustration generation is a CAPABILITY, not a hard-coded model.
// It exists only when a provider image model is configured for the deployment (LINGORA_IMAGE_MODEL) and
// the provider has not rejected it. The Tutor is offered emit_image only while it exists; academic visuals
// with exact text (infographics, diagrams, charts) never come from here: they are native components.
// The Tutor's description reaches the provider whole (7.4 cut it at the words "imagen"/"image").
// Errors are classified for safe logs; the student never sees a model id, an HTTP error or the prompt.
import OpenAI from 'openai'
import { uploadToS3 } from './storage'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

/** After the provider refuses the configured model, the capability is withdrawn for this instance. */
const REJECTION_COOLDOWN_MS = 30 * 60 * 1000
let unavailableUntil = 0
let lastRejection: string | null = null

export function imageCapability(): { available: boolean; model: string | null } {
  const model = process.env.LINGORA_IMAGE_MODEL?.trim() || null
  return { available: Boolean(model && process.env.OPENAI_API_KEY && Date.now() >= unavailableUntil), model }
}

export type ImageFailure = 'image_unavailable' | 'image_rejected' | 'image_failed' | 'image_empty'
export async function generateImage(
  prompt: string,
): Promise<{ success: true; url: string; method: string; model: string } | { success: false; error: ImageFailure }> {
  const cap = imageCapability()
  if (!cap.available || !cap.model) {
    console.warn('[image]', JSON.stringify({ outcome: 'unavailable', configured: Boolean(cap.model), cooling: Date.now() < unavailableUntil, lastRejection }))
    return { success: false, error: 'image_unavailable' }
  }
  const description = String(prompt || '').trim()
  if (!description) return { success: false, error: 'image_empty' }
  try {
    const result = await openai.images.generate({ model: cap.model, prompt: description, n: 1, size: '1024x1024' })
    const encoded = result.data?.[0]?.b64_json
    if (!encoded) { console.warn('[image]', JSON.stringify({ outcome: 'no_bytes', model: cap.model })); return { success: false, error: 'image_failed' } }
    const buffer = Buffer.from(encoded, 'base64')
    const s3Url = await uploadToS3(buffer, `images/${Date.now()}.png`, 'image/png')
    if (s3Url) return { success: true, url: s3Url, method: 's3', model: cap.model }
    return { success: true, url: `data:image/png;base64,${buffer.toString('base64')}`, method: 'dataurl', model: cap.model }
  } catch (error: unknown) {
    const e = error && typeof error === 'object' ? error as { status?: number; code?: string | null; type?: string | null; name?: string } : {}
    // A refusal of the model itself (unknown model, not enabled for the organization) withdraws the capability.
    const rejected = e.status === 400 || e.status === 403 || e.status === 404 || (typeof e.code === 'string' && /model/i.test(e.code))
    if (rejected) { unavailableUntil = Date.now() + REJECTION_COOLDOWN_MS; lastRejection = `${e.status ?? ''}:${e.code ?? ''}` }
    console.error('[image]', JSON.stringify({ outcome: rejected ? 'rejected' : 'failed', model: cap.model, status: e.status ?? null, code: e.code ?? null, type: e.type ?? null, class: e.name ?? 'Error' }))
    return { success: false, error: rejected ? 'image_rejected' : 'image_failed' }
  }
}
