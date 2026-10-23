// LINGORA 7.5: retired acceptance runner.
// Its global OpenAI SDK method interception was unsafe in concurrent runtimes.
// Product acceptance is performed through the normal /beta UI and /api/chat.
// Deliberately fail closed on every environment. No credentials, no side effects.
import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export function GET() {
  return new NextResponse('Not found', { status: 404 })
}
export function POST() {
  return new NextResponse('Not found', { status: 404 })
}
