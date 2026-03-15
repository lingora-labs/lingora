import { NextRequest, NextResponse } from 'next/server'
import { getRagContext, getRagStats } from '@/server/knowledge/rag'

export const runtime = 'nodejs'

export async function GET() {
  const stats = await getRagStats()
  return NextResponse.json({ status: 'ok', ...stats })
}

export async function POST(req: NextRequest) {
  try {
    const { query } = await req.json()
    if (!query) return NextResponse.json({ error: 'query required' }, { status: 400 })
    const context = await getRagContext(query)
    return NextResponse.json({ context, found: Boolean(context) })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
