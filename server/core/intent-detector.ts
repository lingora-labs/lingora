export type IntentType = 'pronunciation' | 'pdf' | 'illustration' | 'schema' | 'conversation'

export function detectIntent(message: string): { type: IntentType } {
  const lower = String(message || '').toLowerCase()
  console.log('[INTENT] message=' + lower.slice(0, 80))

  if (['pronuncia','pronunciation','how do i say','como se dice','how to pronounce','phonetic','fonetica','accent','acento','corrige mi pronunciacion'].some(p => lower.includes(p))) {
    console.log('[INTENT] detected=pronunciation'); return { type: 'pronunciation' }
  }
  if (['pdf','documento','descargable','study guide','guia de estudio','material de estudio','create a doc','make a document','download','descargar'].some(p => lower.includes(p))) {
    console.log('[INTENT] detected=pdf'); return { type: 'pdf' }
  }
  if (['imagen','image','picture','photo','dibuja','dibujo','draw','ilustra','ilustracion','illustration','infografia','infographic','generate an image','genera una imagen','create an image','mapa visual'].some(p => lower.includes(p))) {
    console.log('[INTENT] detected=illustration'); return { type: 'illustration' }
  }
  if (['esquema','schema','mapa conceptual','concept map','diagram','diagrama','resumen visual','visual summary','mind map','cuadro','overview','genera un esquema','create a schema','make a schema','generate a schema','haz un esquema','crea un esquema','lesson plan','course outline','tabla resumen'].some(p => lower.includes(p))) {
    console.log('[INTENT] detected=schema'); return { type: 'schema' }
  }
  console.log('[INTENT] detected=conversation')
  return { type: 'conversation' }
}
