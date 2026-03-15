import { NextResponse } from 'next/server'

export const runtime = 'nodejs'

export async function GET() {
  return NextResponse.json({
    status:  'healthy',
    version: 'v10.1',
    system:  'LINGORA',
    platform: 'vercel-nextjs',
    timestamp: new Date().toISOString(),
    environment: {
      openAIConfigured:   Boolean(process.env.OPENAI_API_KEY),
      storageConfigured:  Boolean(process.env.S3_BUCKET),
      awsConfigured:      Boolean(process.env.AWS_ACCESS_KEY_ID),
      ttsEnabled:         process.env.LINGORA_TTS_ENABLED === 'true',
    },
  })
}
