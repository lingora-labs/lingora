'use client'
import React from 'react'
import { NORWEGIAN_LABELS, UI_LABEL_KEYS } from './seed-locale-data'

/** Static user-interface chrome is distinct from Tutor text, student exercises and artifact content.
 * No client-side language detector or per-language routing brain exists here. */
export const SeedLocaleContext = React.createContext<string>('es')
const UiLabelsContext = React.createContext<Record<string, string>>({})
const cached = new Map<string, Record<string, string>>()
const PACK_VERSION = '7.6-intent-1'
const codePattern = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8}){0,3}$/

function readCached(lang: string): Record<string, string> | null {
  if (lang === 'no' || lang.startsWith('no-')) return NORWEGIAN_LABELS
  if (lang === 'es' || lang.startsWith('es-')) return {}
  if (cached.has(lang)) return cached.get(lang)!
  try {
    const raw = localStorage.getItem('lingora-ui-' + PACK_VERSION + '-' + lang)
    if (!raw) return null
    const pack = JSON.parse(raw) as Record<string, string>
    if (UI_LABEL_KEYS.every(k => typeof pack[k] === 'string' && pack[k].length > 0)) {
      cached.set(lang, pack); return pack
    }
  } catch { /* storage can be unavailable; network is still an option */ }
  return null
}

export function SeedLocaleProvider({ lang, children }: { lang: string; children: React.ReactNode }) {
  const locale = typeof lang === 'string' && codePattern.test(lang) ? lang : 'en'
  const [result, setResult] = React.useState<{ lang: string; labels: Record<string, string>; failed: boolean }>(() =>
    ({ lang: locale, labels: typeof window === 'undefined' ? (locale === 'no' ? NORWEGIAN_LABELS : {}) : readCached(locale) ?? {}, failed: false }))
  React.useEffect(() => {
    let alive = true
    const found = readCached(locale)
    if (found) {
      setResult({ lang: locale, labels: found, failed: false })
      return () => { alive = false }
    }
    if (locale.startsWith('es-') || locale === 'es') {
      setResult({ lang: locale, labels: {}, failed: false })
      return () => { alive = false }
    }
    setResult({ lang: locale, labels: {}, failed: false })
    void fetch('/api/ui-labels', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ language: locale }),
    }).then(async r => {
      if (!r.ok) throw Error('locale service ' + r.status)
      const data = await r.json()
      const pack = data.labels as Record<string, string>
      if (!pack || !UI_LABEL_KEYS.every(k => typeof pack[k] === 'string' && pack[k].length > 0)) throw Error('incomplete locale')
      cached.set(locale, pack)
      try { localStorage.setItem('lingora-ui-' + PACK_VERSION + '-' + locale, JSON.stringify(pack)) } catch {}
      if (alive) setResult({ lang: locale, labels: pack, failed: false })
    }).catch(() => { if (alive) setResult({ lang: locale, labels: {}, failed: true }) })
    return () => { alive = false }
  }, [locale])
  const labels = result.lang === locale ? result.labels : (locale.startsWith('no') ? NORWEGIAN_LABELS : {})
  return (
    <SeedLocaleContext.Provider value={locale}>
      <UiLabelsContext.Provider value={labels}>
        {result.lang === locale && result.failed && <span role="status" data-testid="ui-locale-warning"
          style={{ position: 'fixed', top: 0, right: 0, zIndex: 100, background: '#501e24', color: 'white', fontSize: 12, padding: 6 }}>
          Interface translation unavailable for {locale}; original labels shown.
        </span>}
        {children}
      </UiLabelsContext.Provider>
    </SeedLocaleContext.Provider>
  )
}
export const seedText = (lang: string, label: string) => lang.startsWith('no') ? NORWEGIAN_LABELS[label] ?? label : label
export const useSeedUi = () => {
  const lang = React.useContext(SeedLocaleContext)
  const translated = React.useContext(UiLabelsContext)
  return (label: string) => (lang.startsWith('es') ? label : (translated[label] ?? seedText(lang, label)))
}
