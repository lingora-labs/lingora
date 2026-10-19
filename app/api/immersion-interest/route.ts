import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { uploadToS3, hasPersistentPrivateStorage } from '@/server/tools/storage'

export async function GET() {
  return NextResponse.json({ available:hasPersistentPrivateStorage() }, { headers:{'Cache-Control':'no-store'} })
}

export async function POST(req: NextRequest) {
  // This is a real, persisted interest request, never a booking or payment.
  // Fail closed if private storage is unavailable; no false confirmation.
  const origin = req.headers.get('origin')
  if (origin) {
    try { if (new URL(origin).host !== req.nextUrl.host) return NextResponse.json({error:'Origen no autorizado'}, {status:403}) }
    catch { return NextResponse.json({error:'Origen no válido'}, {status:403}) }
  }
  if (!hasPersistentPrivateStorage())
    return NextResponse.json({error:'La recepción de solicitudes aún no está habilitada. No se registró ninguna reserva.'},{status:503})
  if (Number(req.headers.get('content-length') ?? 0) > 8192)
    return NextResponse.json({error:'Solicitud demasiado grande'}, {status:413})
  let input: Record<string,unknown>
  try { input = await req.json() }
  catch { return NextResponse.json({error:'Solicitud inválida'}, {status:400}) }
  if (input.website) return NextResponse.json({ok:true}) // honeypot: no storage
  const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : ''
  const objective = typeof input.objective === 'string' ? input.objective.trim() : ''
  if (!/^[^\s@]{1,64}@[^\s@]{1,250}\.[^\s@]{2,24}$/u.test(email)
      || objective.length < 8 || objective.length > 1200 || input.consent !== true)
    return NextResponse.json({error:'Correo, objetivo o consentimiento no válido'}, {status:400})
  const record = { email, objective, consent:true, receivedAt:new Date().toISOString(), channel:'lingora-immersion' }
  const saved = await uploadToS3(
    Buffer.from(JSON.stringify(record),'utf8'),
    'immersion-leads/' + new Date().toISOString().slice(0,10) + '/' + randomUUID() + '.json',
    'application/json',
  )
  if (!saved) {
    console.error('[immersion-lead] private persistence unavailable')
    return NextResponse.json({error:'No se pudo registrar tu solicitud. No se ha confirmado ninguna reserva.'},{status:503})
  }
  return NextResponse.json({ok:true, message:'Interés registrado. No constituye una reserva.'}, {status:201})
}
