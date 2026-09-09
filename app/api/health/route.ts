import { NextResponse } from 'next/server'
import { CANONICAL_PRODUCT_URL, RUNTIME_BASELINE, RUNTIME_EXPERIMENT } from '../../../lib/product'

export const runtime = 'nodejs'

export async function GET() {
  const storageConfigured = Boolean(process.env.S3_BUCKET)
  const awsConfigured = Boolean(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY)
  const ttsEnabled = process.env.LINGORA_TTS_ENABLED === 'true'

  return NextResponse.json({
    status:  'healthy',
    version: 'v10.1',
    system:  'LINGORA',
    platform: 'vercel-nextjs',
    runtimeBaseline: RUNTIME_BASELINE,
    experiment: RUNTIME_EXPERIMENT,
    canonicalProductUrl: CANONICAL_PRODUCT_URL,
    timestamp: new Date().toISOString(),
    environment: {
      openAIConfigured:   Boolean(process.env.OPENAI_API_KEY),
      storageConfigured,
      awsConfigured,
      ttsEnabled,
    },
    capabilityTruth: {
      persistentStorage: storageConfigured && awsConfigured,
      tts: ttsEnabled,
    },
  })
}
