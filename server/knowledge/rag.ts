// ================================================
// LINGORA 10.0 — RAG ENGINE
// Migrated from engine/rag.js
// Hybrid: semantic-local + lexical fallback
// ================================================

import fs   from 'fs'
import path from 'path'

const DATA = path.resolve(process.cwd(), 'data')

function loadJson(name: string): unknown | null {
  const file = path.join(DATA, name)
  try {
    if (!fs.existsSync(file)) return null
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    console.warn(`[RAG] Could not load ${name}: ${msg}`)
    return null
  }
}

// Loaded once at module init
const EMBEDDED_CORPUS = loadJson('rag_embeddings.json') as EmbeddedEntry[] | null
const RAW_CORPUS      = loadJson('rag_corpus.json')     as CorpusEntry[]   | null
const VECTORIZER      = loadJson('rag_vectorizer.json') as Vectorizer      | null

interface CorpusEntry {
  id?: string
  title?: string
  text: string
  source?: string
  url?: string
  category?: string
  keywords?: string[]
}

interface EmbeddedEntry extends CorpusEntry {
  embedding: number[]
}

interface Vectorizer {
  vocabulary: string[]
  idf: number[]
}

// ─── Weighted terms (from cantera rag.js) ────────
const WEIGHTED_TERMS: Record<string, number> = {
  'dele':5,'ccse':5,'siele':5,'diploma de espanol':5,'certificacion oficial':5,
  'titulo oficial':4,'certificacion':4,'acreditacion':4,'examen oficial':5,'examen':3,
  'prueba de nivel':3,'competencia linguistica':4,'diploma':4,'cervantes':5,
  'instituto cervantes':5,'centro cervantes':4,'a1':3,'a2':3,'b1':3,'b2':3,'c1':3,'c2':3,
  'mcer':4,'marco europeo':4,'marco comun':4,'cultura':3,'cultura hispana':4,
  'cultura espanola':4,'diversidad':2,'gastronomia':2,'tapas':2,'paella':2,
  'espana':3,'madrid':2,'barcelona':2,'sevilla':2,'granada':2,'mexico':3,
  'oaxaca':4,'ciudad de mexico':3,'colombia':3,'bogota':2,'cartagena':3,
  'argentina':3,'buenos aires':2,'inmersion':5,'presencial':3,'familia anfitriona':4,
  'homestay':4,'experiencia cultural':4,'programa lingora':5,'viajar':3,'viaje':3,
  'destino':2,'negocios':4,'entrevista':4,'corporativo':3,'reunion de trabajo':4,
  'comunicacion profesional':4,'metodologia':3,'lingora':4,'aprender espanol':3,
  'fluidez':3,'hablar espanol':2,'nacionalidad':4,'ciudadania':4,
}

const TRIGGER_TERMS = Object.keys(WEIGHTED_TERMS)

function normalize(text: string): string {
  return (text || '').toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '')
}

function tokenize(text: string): string[] {
  const stop = new Set([
    'de','la','el','los','las','y','en','un','una','unos','unas','del','al',
    'por','para','con','sin','sobre','que','es','son','se','su','sus','como',
    'a','o','u','e','lo','le','les','ya','muy','pero','si','no','mi','mis',
    'tu','tus','the','and','of','to','for','in','on','at','from','is','are',
    'be','this','that','it','as','an','or','by','about','over',
  ])
  const toks = normalize(text).match(/[a-z0-9]+/g) || []
  const filtered = toks.filter(t => t.length >= 2 && !stop.has(t))
  return [
    ...filtered,
    ...filtered.slice(0, -1).map((t, i) => `${t}_${filtered[i + 1]}`),
  ]
}

function lexicalTriggerScore(message: string): number {
  const q = normalize(message)
  return TRIGGER_TERMS.reduce((sum, term) =>
    q.includes(normalize(term)) ? sum + (WEIGHTED_TERMS[term] || 1) : sum, 0
  )
}

function lexicalChunkScore(message: string, entry: CorpusEntry): number {
  const q = normalize(message)
  const t = normalize(
    `${entry.title || ''} ${entry.category || ''} ${(entry.keywords || []).join(' ')} ${entry.text}`
  )
  let score = 0
  for (const [term, weight] of Object.entries(WEIGHTED_TERMS)) {
    if (q.includes(normalize(term)) && t.includes(normalize(term.split(' ')[0]))) {
      score += weight
    }
  }
  return score
}

function cosine(a: number[], b: number[]): number {
  if (!a || !b || a.length !== b.length) return 0
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) { dot += a[i]*b[i]; na += a[i]*a[i]; nb += b[i]*b[i] }
  return na === 0 || nb === 0 ? 0 : dot / (Math.sqrt(na) * Math.sqrt(nb))
}

function embedQuery(message: string): number[] | null {
  if (!VECTORIZER?.vocabulary || !VECTORIZER?.idf) return null
  const { vocabulary, idf } = VECTORIZER
  const idx = Object.fromEntries(vocabulary.map((t: string, i: number) => [t, i]))
  const tf: Record<string, number> = {}
  for (const tok of tokenize(message)) {
    if (idx[tok] !== undefined) tf[tok] = (tf[tok] || 0) + 1
  }
  const vec = new Array(vocabulary.length).fill(0)
  const counts = Object.values(tf)
  if (!counts.length) return vec
  const maxTf = Math.max(...counts)
  let norm = 0
  for (const [tok, count] of Object.entries(tf)) {
    const i = idx[tok]
    const val = (0.5 + 0.5 * (count / maxTf)) * idf[i]
    vec[i] = val
    norm += val * val
  }
  norm = Math.sqrt(norm) || 1
  return vec.map((v: number) => v / norm)
}

interface RagResult {
  text: string
  sources: Array<{ title?: string; source?: string; url?: string; category?: string }>
  mode: string
}

function format(results: CorpusEntry[], mode: string): RagResult | null {
  if (!results?.length) return null
  return {
    text: results.map(r => `[${r.source}] ${String(r.text).slice(0, 500)}\nFuente: ${r.url}`).join('\n\n'),
    sources: results.map(r => ({ title: r.title, source: r.source, url: r.url, category: r.category })),
    mode,
  }
}

function semanticLocal(message: string): RagResult | null {
  if (!EMBEDDED_CORPUS?.length) return null
  const qv = embedQuery(message)
  if (!qv) return null
  const ranked = EMBEDDED_CORPUS
    .map(entry => ({
      ...entry,
      totalScore: cosine(qv, entry.embedding) * 0.7 +
                  Math.min(lexicalChunkScore(message, entry) / 20, 1) * 0.3,
    }))
    .sort((a, b) => b.totalScore - a.totalScore)
    .slice(0, 3)
  if (!ranked.length || ranked[0].totalScore < 0.14) return null
  return format(ranked, 'semantic-local')
}

function lexicalFallback(message: string): RagResult | null {
  if (!RAW_CORPUS?.length) return null
  const ranked = RAW_CORPUS
    .map(entry => ({ ...entry, score: lexicalChunkScore(message, entry) }))
    .filter(e => e.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
  return ranked.length ? format(ranked, 'lexical-fallback') : null
}

export async function getRagContext(message: string): Promise<RagResult | null> {
  if (lexicalTriggerScore(message) < 2) return null
  try {
    const semantic = semanticLocal(message)
    if (semantic) return semantic
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    console.warn('[RAG] semantic-local failed:', msg)
  }
  return lexicalFallback(message)
}

export async function getRagStats() {
  return {
    staticCorpus:    RAW_CORPUS      ? RAW_CORPUS.length      : 0,
    embeddedCorpus:  EMBEDDED_CORPUS ? EMBEDDED_CORPUS.length : 0,
    weightedTerms:   TRIGGER_TERMS.length,
    sources:         RAW_CORPUS ? [...new Set(RAW_CORPUS.map(e => e.source))] : [],
    categories:      RAW_CORPUS ? [...new Set(RAW_CORPUS.map(e => e.category))] : [],
    mode:            EMBEDDED_CORPUS && VECTORIZER ? 'hybrid-local-ready' : 'lexical-only',
  }
}
