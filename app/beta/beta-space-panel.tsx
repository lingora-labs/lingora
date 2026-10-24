'use client'
// LINGORA 7.5 — the student's Space: conversations, instructions, sources, memory, immersion interest.
// Every destructive action takes two taps (no browser dialogs). Every refusal is shown in the notice line.
import React from 'react'
import type { Space } from '@/lib/space/model'
import { RETRIEVAL_TOKEN_BUDGET } from '@/lib/space/retrieve'
import { SPACE_RESOURCE_LIMITS } from '@/lib/space/model'

type Actions = {
  setInstructions: (text: string) => Promise<boolean>
  addSourceFile: (file: File) => Promise<boolean>
  removeSource: (id: string) => Promise<boolean>
  addFact: (key: string, value: string) => Promise<boolean>
  confirmFact: (id: string) => Promise<boolean>
  removeFact: (id: string) => Promise<boolean>
  recordInterest: (note: string) => Promise<boolean>
  clearNotice: () => void
}

const FACT_LABELS: Record<string, string> = { goal: 'Objetivo', result: 'Logro reconocido' }
const h: React.CSSProperties = { fontSize: 11, fontWeight: 800, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--teal)', margin: '18px 0 8px' }
const row: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--card)', marginBottom: 6 }
const small: React.CSSProperties = { fontSize: 11, color: 'var(--muted)' }
const btn: React.CSSProperties = { fontSize: 12, minHeight: 36, padding: '6px 10px', borderRadius: 999, border: '1px solid var(--border)', background: 'none', color: 'var(--silver)', cursor: 'pointer', flexShrink: 0 }
const field: React.CSSProperties = { width: '100%', background: 'var(--navy2)', border: '1px solid var(--border)', borderRadius: 10, padding: '8px 10px', fontSize: 13, color: 'var(--silver)', fontFamily: 'inherit' }

function TwoStep({ label, confirm, onConfirm, disabled }: { label: string; confirm: string; onConfirm: () => void; disabled?: boolean }) {
  const [armed, setArmed] = React.useState(false)
  React.useEffect(() => { if (!armed) return; const t = setTimeout(() => setArmed(false), 4000); return () => clearTimeout(t) }, [armed])
  return (
    <button type="button" disabled={disabled} onClick={() => { if (armed) { setArmed(false); onConfirm() } else setArmed(true) }}
      style={{ ...btn, color: armed ? 'var(--coral)' : 'var(--muted)', borderColor: armed ? 'var(--coral)' : 'var(--border)' }}>
      {armed ? confirm : label}
    </button>
  )
}

export function SpacePanel(props: {
  space: Space; activeConversationId: string | null; notice: string | null; busy: boolean
  actions: Actions
  onClose: () => void
  onNewConversation: () => void; onOpenConversation: (id: string) => void
  onDeleteConversation: (id: string) => void; onDeleteSpace: () => void
}) {
  const { space, actions, busy } = props
  const [instructions, setInstructionsDraft] = React.useState(space.instructions)
  const [factKey, setFactKey] = React.useState('')
  const [factValue, setFactValue] = React.useState('')
  const [interestNote, setInterestNote] = React.useState('')
  const fileRef = React.useRef<HTMLInputElement>(null)
  React.useEffect(() => { setInstructionsDraft(space.instructions) }, [space.id, space.instructions])
  const confirmed = space.memory.filter(f => f.kind === 'confirmed')
  const inferred = space.memory.filter(f => f.kind === 'inferred')
  const dirty = instructions !== space.instructions
  return (
    <div role="dialog" aria-label="Tu espacio" style={{ position: 'fixed', inset: 0, zIndex: 80, background: 'rgba(3,8,16,.6)', display: 'flex', justifyContent: 'flex-end' }}
      onClick={e => { if (e.target === e.currentTarget) props.onClose() }}>
      <div style={{ width: '100%', maxWidth: 440, height: '100%', overflowY: 'auto', background: 'var(--navy)', borderLeft: '1px solid var(--border)', padding: '16px 16px 40px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 800, fontSize: 16, color: '#fff' }}>Tu espacio</div>
            <div style={small}>Guardado en este navegador. No se sincroniza entre dispositivos.</div>
          </div>
          <button type="button" onClick={props.onClose} style={btn} aria-label="Cerrar">Cerrar</button>
        </div>
        {props.notice && (
          <div role="status" aria-live="polite" style={{ marginTop: 10, fontSize: 12, color: 'var(--gold)', display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <span style={{ flex: 1 }}>{props.notice}</span>
            <button type="button" onClick={actions.clearNotice} style={{ ...btn, minHeight: 28, padding: '2px 8px' }}>OK</button>
          </div>
        )}

        <div style={h}>Conversaciones ({space.conversations.length})</div>
        <div style={{ ...small, marginBottom: 8 }}>Cada conversación es independiente: ninguna lee los mensajes de otra.</div>
        {space.conversations.map(c => {
          const active = c.id === props.activeConversationId
          return (
            <div key={c.id} style={{ ...row, borderColor: active ? 'var(--teal)' : 'var(--border)' }}>
              <button type="button" disabled={busy || active} onClick={() => props.onOpenConversation(c.id)}
                style={{ flex: 1, minWidth: 0, textAlign: 'left', background: 'none', border: 'none', color: active ? 'var(--teal)' : '#fff', cursor: active ? 'default' : 'pointer', padding: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} dir="auto">{c.title}</div>
                <div style={small}>{active ? 'Abierta · ' : ''}{new Date(c.updatedAt).toLocaleString()}</div>
              </button>
              <TwoStep label="Borrar" confirm="¿Borrar?" disabled={busy} onConfirm={() => props.onDeleteConversation(c.id)} />
            </div>
          )
        })}
        <button type="button" disabled={busy} onClick={props.onNewConversation} style={{ ...btn, width: '100%', marginTop: 4, color: 'var(--teal)', borderColor: 'rgba(0,201,167,.4)' }}>+ Nueva conversación</button>

        <div style={h}>Instrucciones del espacio</div>
        <div style={{ ...small, marginBottom: 6 }}>Tu tutor las recibe en cada conversación de este espacio.</div>
        <textarea value={instructions} onChange={e => setInstructionsDraft(e.target.value)} rows={4} dir="auto"
          placeholder="Ej.: Explícame en inglés. Me preparo para el DELE B2. Corrígeme siempre los acentos."
          style={{ ...field, resize: 'vertical' }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
          <span style={{ ...small, flex: 1, color: instructions.length > SPACE_RESOURCE_LIMITS.instructionsChars ? 'var(--coral)' : 'var(--muted)' }}>{instructions.length}/{SPACE_RESOURCE_LIMITS.instructionsChars}</span>
          <button type="button" disabled={!dirty} onClick={() => void actions.setInstructions(instructions)} style={{ ...btn, opacity: dirty ? 1 : .5 }}>Guardar</button>
        </div>

        <div style={h}>Fuentes ({space.sources.length})</div>
        <div style={{ ...small, marginBottom: 8 }}>Texto que aportas. En cada turno tu tutor recibe solo los pasajes que comparten palabras con tu mensaje (hasta {RETRIEVAL_TOKEN_BUDGET} tokens), con su identificador.</div>
        {space.sources.map(src => (
          <div key={src.id} style={row}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} dir="auto">{src.name}</div>
              <div style={small} title={src.sha256}>{(src.text.length / 1000).toFixed(1)} k car. · SHA-256 {src.sha256.slice(0, 12)}… · {new Date(src.addedAt).toLocaleDateString()}</div>
            </div>
            <TwoStep label="Quitar" confirm="¿Quitar?" onConfirm={() => void actions.removeSource(src.id)} />
          </div>
        ))}
        <button type="button" onClick={() => fileRef.current?.click()} style={{ ...btn, width: '100%' }}>Añadir fuente de texto</button>
        <input ref={fileRef} type="file" accept=".txt,.md,.markdown,.csv,.json,.html,.htm,.xml,.srt,.vtt,text/*" style={{ display: 'none' }}
          onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void actions.addSourceFile(f) }} />

        <div style={h}>Memoria confirmada ({confirmed.length})</div>
        <div style={{ ...small, marginBottom: 8 }}>Datos que tú das por ciertos. Son los únicos que pasan de una conversación a otra.</div>
        {confirmed.map(f => (
          <div key={f.id} style={row}>
            <div style={{ flex: 1, minWidth: 0, fontSize: 13 }} dir="auto">
              {f.key === 'immersion_declined'
                ? <><b>Inmersión:</b> dijiste que no ({new Date(f.value).toLocaleDateString()}). Tu tutor no la propondrá; quítalo para reabrir el tema.</>
                : <><b>{FACT_LABELS[f.key] ?? f.key}:</b> {f.value}</>}
              {f.provenance && <div style={small} title={f.provenance.evidence}>Reconocido por tu tutor a partir de tus palabras: «{f.provenance.evidence.length > 80 ? f.provenance.evidence.slice(0, 77) + '…' : f.provenance.evidence}»</div>}
            </div>
            <TwoStep label="Quitar" confirm="¿Quitar?" onConfirm={() => void actions.removeFact(f.id)} />
          </div>
        ))}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <input value={factKey} onChange={e => setFactKey(e.target.value)} placeholder="Dato (ej. objetivo)" style={{ ...field, flex: '1 1 120px' }} dir="auto" />
          <input value={factValue} onChange={e => setFactValue(e.target.value)} placeholder="Valor (ej. DELE B2 en junio)" style={{ ...field, flex: '2 1 180px' }} dir="auto" />
          <button type="button" disabled={!factKey.trim() || !factValue.trim()}
            onClick={() => void actions.addFact(factKey, factValue).then(ok => { if (ok) { setFactKey(''); setFactValue('') } })} style={btn}>Añadir</button>
        </div>

        <div style={h}>Lo que anotó tu tutor ({inferred.length})</div>
        <div style={{ ...small, marginBottom: 8 }}>Inferencias de cada conversación. No llegan a las demás hasta que las confirmes.</div>
        {inferred.length === 0 && <div style={small}>Nada todavía.</div>}
        {inferred.map(f => (
          <div key={f.id} style={row}>
            <div style={{ flex: 1, minWidth: 0, fontSize: 13 }} dir="auto"><span style={small}>{f.key} · </span>{f.value}</div>
            <button type="button" onClick={() => void actions.confirmFact(f.id)} style={{ ...btn, color: 'var(--teal)' }}>Confirmar</button>
            <TwoStep label="Descartar" confirm="¿Descartar?" onConfirm={() => void actions.removeFact(f.id)} />
          </div>
        ))}

        <div style={h}>Interés en inmersión</div>
        <div style={{ ...small, marginBottom: 8 }}>Se guarda en tu espacio, en este navegador; LINGORA aún no lo recibe. No es una reserva ni un pago, y no hay fechas, plazas ni precios.</div>
        {space.interest.map((i, n) => (
          <div key={n} style={{ ...row, display: 'block' }}>
            <div style={small}>{new Date(i.at).toLocaleString()}</div>
            {i.note && <div style={{ fontSize: 13 }} dir="auto">{i.note}</div>}
          </div>
        ))}
        <textarea value={interestNote} onChange={e => setInterestNote(e.target.value)} rows={2} dir="auto" placeholder="Qué te gustaría vivir en español (opcional)" style={{ ...field, resize: 'vertical' }} />
        <button type="button" onClick={() => void actions.recordInterest(interestNote).then(ok => { if (ok) setInterestNote('') })} style={{ ...btn, width: '100%', marginTop: 6 }}>Guardar mi interés</button>

        <div style={{ ...h, color: 'var(--coral)' }}>Borrar espacio</div>
        <div style={{ ...small, marginBottom: 8 }}>Elimina de este navegador todas las conversaciones, fuentes, memoria e interés. Reset solo vacía la conversación abierta.</div>
        <TwoStep label="Borrar espacio" confirm="Pulsa otra vez para borrarlo todo" disabled={busy} onConfirm={props.onDeleteSpace} />
      </div>
    </div>
  )
}
