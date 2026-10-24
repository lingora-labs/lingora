'use client'
import { useEffect, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { spaceStore } from '../beta/beta-session'
import { isRefusal, recordInterest } from '@/lib/space/model'

export default function ImmersionPage() {
  const [email,setEmail]=useState('')
  const [objective,setObjective]=useState('')
  const [consent,setConsent]=useState(false)
  const [pending,setPending]=useState(false)
  const [available,setAvailable]=useState<boolean|null>(null)
  useEffect(()=>{
    let active=true
    fetch('/api/immersion-interest',{cache:'no-store'})
      .then(r=>r.ok?r.json():{available:false})
      .then(data=>{if(active)setAvailable(data.available===true)})
      .catch(()=>{if(active)setAvailable(false)})
    return ()=>{active=false}
  },[])
  const [notice,setNotice]=useState('')
  // 7.5: with the server channel closed (DAE privacy gate), interest is recorded in the student's own Space.
  const [localNote,setLocalNote]=useState('')
  const [localStatus,setLocalStatus]=useState<{ok:boolean;text:string}|null>(null)
  async function saveLocal(e:FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const out=await spaceStore.mutate(sp=>{const r=recordInterest(sp,sp.activeConversationId||null,localNote);return isRefusal(r)?{refusal:r.message}:{space:r,result:true}})
    if(!out.ok){setLocalStatus({ok:false,text:out.message});return}
    setLocalNote('');setLocalStatus({ok:true,text:'Guardado en tu espacio de este navegador. Tu tutor lo tendrá en cuenta. LINGORA no lo recibe todavía; no es una reserva.'})
  }
  const [success,setSuccess]=useState(false)
  async function submit(e:FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if(pending||available!==true)return
    setPending(true);setNotice('')
    try {
      const res=await fetch('/api/immersion-interest',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({email,objective,consent}),
      })
      const data=await res.json()
      if(!res.ok || !data.ok)throw Error(String(data.error??'No se pudo registrar la solicitud'))
      setSuccess(true);setNotice('Recibimos tu interés. Esto no es una reserva ni un pago.')
    } catch(err) {setNotice(err instanceof Error?err.message:'No se pudo enviar. No se registró ninguna reserva.')}
    finally {setPending(false)}
  }
  const field={padding:13,borderRadius:10,border:'1px solid #667386',background:'#101c32',color:'white',width:'100%',boxSizing:'border-box' as const,font:'inherit'}
  return <main style={{maxWidth:670,margin:'0 auto',padding:'55px 22px 80px',lineHeight:1.6}}>
    <Link href="/beta" style={{color:'#b1c8e9'}}>← Volver a LINGORA</Link>
    <h1 style={{fontSize:'clamp(30px,6vw,46px)',lineHeight:1.15,marginTop:30}}>Del español que aprendes al español que vives.</h1>
    <p>Las experiencias de inmersión cultural pueden ser un siguiente paso cuando encajan con tus objetivos. Cuéntanos qué te gustaría vivir y qué español necesitas usar.</p>
    <p style={{color:'#b1c8e9'}}>Esta página registra interés. No publica precios, plazas ni fechas no confirmadas, y no formaliza una reserva.</p>
    {available===false&&<>
      <p role="status" style={{color:'#ffd19b'}}>El envío de solicitudes a LINGORA no está habilitado en este entorno: no se toma tu correo ni se confirma ninguna reserva. Puedes guardar tu interés en tu espacio, en este navegador.</p>
      <form onSubmit={saveLocal} style={{display:'grid',gap:12,marginTop:20}}>
        <label style={{display:'grid',gap:5}}>¿Qué te gustaría vivir en español? (opcional)
          <textarea rows={4} maxLength={2000} value={localNote} onChange={e=>setLocalNote(e.target.value)} dir="auto" style={{...field,resize:'vertical'}}/>
        </label>
        <button type="submit" style={{background:'#e8b76e',color:'#101b2c',border:0,borderRadius:10,padding:14,font:'inherit',fontWeight:700,cursor:'pointer'}}>Guardar mi interés en mi espacio</button>
        {localStatus&&<p role="status" style={{color:localStatus.ok?'#9ee1b6':'#ffd19b',margin:0}}>{localStatus.text}</p>}
      </form>
    </>}
    {available!==false&&<form onSubmit={submit} style={{display:'grid',gap:16,marginTop:30}}>
      <label style={{display:'grid',gap:5}}>Tu correo
        <input required type="email" autoComplete="email" maxLength={255} value={email} onChange={e=>setEmail(e.target.value)} style={field}/>
      </label>
      <label style={{display:'grid',gap:5}}>¿Qué quieres conseguir con una experiencia de inmersión?
        <textarea required rows={5} minLength={8} maxLength={1200} value={objective} onChange={e=>setObjective(e.target.value)} style={{...field,resize:'vertical'}}/>
      </label>
      <label style={{display:'flex',alignItems:'start',gap:10}}>
        <input required type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)} style={{marginTop:7}}/>
        Acepto que LINGORA registre estos datos exclusivamente para responder a mi interés en inmersión.
      </label>
      <input name="website" autoComplete="off" tabIndex={-1} aria-hidden="true" style={{position:'absolute',left:'-9999px'}}/>
      <button type="submit" disabled={pending||success||available!==true} style={{background:pending||success?'#46556d':'#e8b76e',color:'#101b2c',border:0,borderRadius:10,padding:14,font:'inherit',fontWeight:700,cursor:'pointer'}}>
        {pending?'Enviando…':success?'Solicitud recibida':available===null?'Comprobando disponibilidad…':'Enviar interés'}
      </button>
      {notice&&<p role="status" style={{color:success?'#9ee1b6':'#ffd19b',margin:0}}>{notice}</p>}
    </form>}
  </main>
}
