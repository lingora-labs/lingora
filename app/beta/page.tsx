'use client'

import { useState, useRef, useEffect, useCallback } from 'react'

// ─── Types ───────────────────────────────────────
type MentorKey = 'sarah' | 'alex' | 'nick'
type TopicKey =
  | 'conversation'
  | 'structured'
  | 'cervantes'
  | 'business'
  | 'travel'
  | 'course'
  | 'leveltest'
type Lang = 'en' | 'es' | 'no' | 'fr' | 'de' | 'it' | 'pt' | 'ar' | 'ja'
type Screen = 'lang' | 'mentor' | 'topic' | 'chat'

interface Artifact {
  type: 'schema' | 'illustration' | 'pdf' | 'audio'
  url?: string
  content?: Record<string, unknown>
  metadata?: Record<string, unknown>
}

interface Message {
  id: string
  sender: 'user' | MentorKey | 'ln'
  text: string
  artifact?: Artifact | null
  score?: number
}

interface SessionState {
  lang: Lang
  mentor: MentorKey
  topic: TopicKey
  level: string
  tokens: number
  samples: string[]
  sessionId: string
  commercialOffers: unknown[]
  lastTask: string | null
  lastArtifact: string | null
}

interface ApiResponse {
  message?: string
  reply?: string
  content?: string
  artifact?: Artifact | null
  pronunciationScore?: number
  diagnostic?: unknown
  state?: Partial<SessionState>
  transcription?: string
}

// ─── Static data ──────────────────────────────────
const MENTOR_META: Record<
  MentorKey,
  { emoji: string; name: string; spec: string; color: string }
> = {
  sarah: {
    emoji: '📚',
    name: 'Sarah',
    spec: 'Academic mentor · LINGORA',
    color: '#7c3aed',
  },
  alex: {
    emoji: '🌍',
    name: 'Alex',
    spec: 'Travel & conversation · LINGORA',
    color: '#0891b2',
  },
  nick: {
    emoji: '💼',
    name: 'Nick',
    spec: 'Business mentor · LINGORA',
    color: '#d97706',
  },
}

const TOPIC_META: Record<TopicKey, { emoji: string; label: string }> = {
  conversation: { emoji: '💬', label: 'Conversation' },
  structured: { emoji: '📖', label: 'Lessons' },
  cervantes: { emoji: '🏛️', label: 'Cervantes Exam' },
  business: { emoji: '🤝', label: 'Business' },
  travel: { emoji: '✈️', label: 'Travel' },
  course: { emoji: '🎓', label: 'Full Course' },
  leveltest: { emoji: '📊', label: 'Level Test' },
}

const LANGUAGES: { value: Lang; label: string }[] = [
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Español' },
  { value: 'no', label: 'Norsk' },
  { value: 'fr', label: 'Français' },
  { value: 'de', label: 'Deutsch' },
  { value: 'it', label: 'Italiano' },
  { value: 'pt', label: 'Português' },
  { value: 'ar', label: 'العربية' },
  { value: 'ja', label: '日本語' },
]

const GREETINGS: Record<MentorKey, Partial<Record<Lang, string>>> = {
  sarah: {
    en: "Hi, I'm Sarah. I'll guide you with structure and clarity. What would you like to work on today?",
    es: 'Hola, soy Sarah. Te acompañaré con estructura y claridad. ¿Qué parte quieres trabajar hoy?',
    no: 'Hei, jeg er Sarah. Jeg skal hjelpe deg med struktur og klarhet. Hva vil du jobbe med i dag?',
    fr: 'Bonjour, je suis Sarah. Je vous accompagnerai avec structure et clarté. Sur quoi voulez-vous travailler?',
    de: 'Hallo, ich bin Sarah. Ich begleite Sie mit Struktur und Klarheit. Womit möchten Sie heute arbeiten?',
    it: 'Ciao, sono Sarah. Ti guiderò con struttura e chiarezza. Su cosa vuoi lavorare oggi?',
    pt: 'Olá, sou Sarah. Vou acompanhar você com estrutura e clareza. O que quer trabalhar hoje?',
    ar: 'مرحباً، أنا سارة. سأرشدك بهدوء ووضوح. ما الذي تريد العمل عليه اليوم؟',
    ja: 'こんにちは、サラです。構造と明確さをもって案内します。今日は何に取り組みたいですか？',
  },
  alex: {
    en: "Hi, I'm Alex. Let's start with something real: a trip, a culture, a concrete situation. Where shall we begin?",
    es: 'Hola, soy Alex. Empecemos con algo real: un viaje, una cultura, una situación concreta. ¿Por dónde empezamos?',
    no: 'Hei, jeg er Alex. La oss begynne med noe virkelig: en reise, en kultur, en konkret situasjon.',
    fr: 'Bonjour, je suis Alex. Commençons par quelque chose de concret: un voyage, une culture, une situation réelle.',
    de: 'Hallo, ich bin Alex. Fangen wir mit etwas Konkretem an: eine Reise, eine Kultur, eine echte Situation.',
    it: 'Ciao, sono Alex. Cominciamo con qualcosa di reale: un viaggio, una cultura, una situazione concreta.',
    pt: 'Olá, sou Alex. Vamos começar com algo real: uma viagem, uma cultura, uma situação concreta.',
    ar: 'مرحباً، أنا أليكس. لنبدأ بشيء واقعي: رحلة، ثقافة، موقف ملموس.',
    ja: 'こんにちは、アレックスです。旅や文化、現実の場面のような具体的なことから始めましょう。',
  },
  nick: {
    en: "Hi, I'm Nick. I'll help you with professional Spanish, interviews, and business communication. What do you need today?",
    es: 'Hola, soy Nick. Te ayudaré con el español que necesitas en entornos profesionales. ¿Qué situación tienes en mente?',
    no: 'Hei, jeg er Nick. Jeg hjelper deg med profesjonell spansk for intervjuer og forretningskommunikasjon.',
    fr: "Bonjour, je suis Nick. Je vous aiderai avec l'espagnol professionnel. De quoi avez-vous besoin?",
    de: 'Hallo, ich bin Nick. Ich helfe Ihnen mit professionellem Spanisch für Vorstellungsgespräche und Geschäftskommunikation.',
    it: 'Ciao, sono Nick. Ti aiuterò con lo spagnolo professionale per colloqui e comunicazione aziendale.',
    pt: 'Olá, sou Nick. Vou ajudar com espanhol profissional para entrevistas e comunicação empresarial.',
    ar: 'مرحباً، أنا نِك. سأساعدك في الإسبانية المهنية للمقابلات والتواصل في بيئة الأعمال.',
    ja: 'こんにちは、ニックです。面接やビジネスコミュニケーション向けの実務スペイン語を手伝います。',
  },
}

const TSYS: Record<TopicKey, string> = {
  conversation:
    'Focus on natural, fluid conversation. Correct gently. Use real cultural anecdotes. Be warm and engaging.',
  structured:
    'Follow a clear pedagogical structure. Introduce concepts progressively with examples and mini-exercises.',
  cervantes:
    'Prepare for DELE or CCSE exams. Use official terminology, exam-style questions, timed practice texts.',
  business:
    'Professional Spanish: emails, meetings, presentations, negotiations, interviews. Formal register. Corporate vocabulary.',
  travel:
    'Real travel situations: hotels, restaurants, transport, emergencies, shopping. Practical phrases and local customs.',
  course:
    "Structured course from the user's level. Sequence grammar, vocabulary, culture thematically. Advance systematically.",
  leveltest:
    'Diagnostic evaluation. Ask progressively harder questions to determine the user CEFR level accurately.',
}

// ─── Helpers ─────────────────────────────────────
function safeString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function formatBubbleText(t: string) {
  return safeString(t)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/\n/g, '<br>')
}

function createMessage(
  sender: 'user' | MentorKey | 'ln',
  text: string,
  artifact: Artifact | null = null,
  score?: number
): Message {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    sender,
    text,
    artifact,
    score,
  }
}

// ─── Schema Renderer ─────────────────────────────
function SchemaArtifact({ content }: { content: Record<string, unknown> }) {
  const [answers, setAnswers] = useState<Record<number, boolean | null>>({})

  const quiz = Array.isArray(content.quiz)
    ? (content.quiz as Array<{
        question: string
        options: string[]
        correct: number
      }>)
    : []

  const concepts = Array.isArray(content.keyConcepts)
    ? (content.keyConcepts as string[])
    : []

  const subtopics = Array.isArray(content.subtopics)
    ? (content.subtopics as Array<{
        title: string
        content: string
        keyTakeaway?: string
      }>)
    : []

  const exportSchema = () => {
    const lines = [
      'LINGORA Schema',
      String(content.title ?? ''),
      '',
      String(content.objective ?? ''),
      '',
      'Key concepts: ' + concepts.join(', '),
      '',
      ...subtopics.map((s) => `${s.title}\n${s.content}`),
    ]
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'lingora-schema.txt'
    a.click()
  }

  return (
    <div
      style={{
        background: 'var(--navy3)',
        border: '1px solid var(--border)',
        borderRadius: 16,
        marginTop: 10,
        overflow: 'hidden',
        width: '100%',
        maxWidth: 520,
      }}
    >
      <div
        style={{
          padding: '12px 16px',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            color: 'var(--teal)',
            background: 'rgba(0,201,167,.1)',
            border: '1px solid rgba(0,201,167,.2)',
            padding: '2px 10px',
            borderRadius: 999,
          }}
        >
          {String(content.block ?? 'LINGORA')}
        </span>
      </div>

      <div style={{ padding: '12px 16px 8px' }}>
        <div
          style={{
            fontSize: 16,
            fontWeight: 700,
            color: '#fff',
            marginBottom: 4,
          }}
        >
          {String(content.title ?? '')}
        </div>
        <div
          style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 12 }}
        >
          {String(content.objective ?? '')}
        </div>

        {concepts.length > 0 && (
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 5,
              marginBottom: 12,
            }}
          >
            {concepts.map((c, i) => (
              <span
                key={i}
                style={{
                  fontSize: 11,
                  padding: '2px 9px',
                  borderRadius: 999,
                  background: 'var(--card)',
                  border: '1px solid var(--border)',
                  color: 'var(--muted)',
                }}
              >
                {c}
              </span>
            ))}
          </div>
        )}
      </div>

      {subtopics.length > 0 && (
        <div style={{ padding: '0 16px 8px' }}>
          {subtopics.map((s, i) => (
            <div
              key={i}
              style={{
                padding: '10px 0',
                borderBottom:
                  i < subtopics.length - 1
                    ? '1px solid rgba(255,255,255,.04)'
                    : 'none',
              }}
            >
              <div
                style={{
                  fontWeight: 700,
                  fontSize: 13,
                  color: '#fff',
                  marginBottom: 3,
                }}
              >
                {s.title}
              </div>
              <div
                style={{
                  fontSize: 13,
                  color: 'var(--muted)',
                  lineHeight: 1.55,
                }}
              >
                {s.content}
              </div>
              {s.keyTakeaway && (
                <div
                  style={{
                    fontSize: 12,
                    color: 'var(--teal)',
                    marginTop: 3,
                  }}
                >
                  80/20: {s.keyTakeaway}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {quiz.length > 0 && (
        <div style={{ padding: '8px 16px 12px' }}>
          {quiz.map((q, qi) => (
            <div key={qi} style={{ marginBottom: 10 }}>
              <div
                style={{
                  fontWeight: 600,
                  fontSize: 13,
                  color: '#fff',
                  marginBottom: 5,
                }}
              >
                {qi + 1}. {q.question}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {q.options.map((opt, oi) => {
                  const answered = answers[qi] !== undefined
                  const isCorrect = oi === q.correct
                  let bg = 'transparent'
                  let borderCol = 'var(--border)'
                  let col = 'var(--muted)'

                  if (answered) {
                    if (isCorrect) {
                      bg = 'rgba(0,201,167,.12)'
                      borderCol = 'var(--teal)'
                      col = 'var(--teal)'
                    } else if (answers[qi] === false && oi !== q.correct) {
                      bg = 'rgba(255,107,107,.1)'
                      borderCol = 'var(--coral)'
                      col = 'var(--coral)'
                    }
                  }

                  return (
                    <button
                      key={oi}
                      disabled={answered}
                      onClick={() =>
                        setAnswers((prev) => ({
                          ...prev,
                          [qi]: oi === q.correct,
                        }))
                      }
                      style={{
                        fontSize: 12,
                        padding: '6px 10px',
                        borderRadius: 8,
                        border: `1px solid ${borderCol}`,
                        background: bg,
                        color: col,
                        cursor: answered ? 'default' : 'pointer',
                        textAlign: 'left',
                      }}
                    >
                      {'ABCDE'[oi]}) {opt}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      <div
        style={{
          padding: '8px 16px 12px',
          borderTop: '1px solid var(--border)',
        }}
      >
        <button
          onClick={exportSchema}
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: 'var(--teal)',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: 0,
          }}
        >
          ↓ Download schema (.txt)
        </button>
      </div>
    </div>
  )
}

// ─── Artifact Renderer ────────────────────────────
function ArtifactRenderer({ artifact }: { artifact: Artifact }) {
  if (artifact.type === 'schema' && artifact.content) {
    return <SchemaArtifact content={artifact.content} />
  }

  if (artifact.type === 'illustration' && artifact.url) {
    return (
      <div>
        <img
          src={artifact.url}
          alt="LINGORA visual"
          style={{
            maxWidth: '100%',
            borderRadius: 12,
            display: 'block',
          }}
        />
        <a
          href={artifact.url}
          download
          target="_blank"
          rel="noopener"
          style={{
            fontSize: 12,
            color: 'var(--teal)',
            display: 'block',
            marginTop: 4,
            fontWeight: 600,
          }}
        >
          ↓ Download image
        </a>
      </div>
    )
  }

  if (artifact.type === 'pdf' && artifact.url) {
    return (
      <a
        href={artifact.url}
        download="lingora.pdf"
        target="_blank"
        rel="noopener"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          background: 'rgba(245,200,66,.1)',
          border: '1px solid rgba(245,200,66,.25)',
          color: 'var(--gold)',
          borderRadius: 8,
          padding: '8px 14px',
          fontSize: 13,
          fontWeight: 600,
          textDecoration: 'none',
          marginTop: 4,
        }}
      >
        📄 Download PDF
      </a>
    )
  }

  if (artifact.type === 'audio' && artifact.url) {
    return (
      <audio
        controls
        src={artifact.url}
        style={{ marginTop: 6, width: '100%', borderRadius: 8 }}
      />
    )
  }

  return null
}

// ─── Message Bubble ───────────────────────────────
function Bubble({
  msg,
  mentorColor,
}: {
  msg: Message
  mentorColor: string
}) {
  const isUser = msg.sender === 'user'

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-end',
        gap: 8,
        maxWidth: '88%',
        ...(isUser
          ? { flexDirection: 'row-reverse', marginLeft: 'auto' }
          : {}),
      }}
    >
      <div
        style={{
          width: 28,
          height: 28,
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 11,
          fontWeight: 700,
          flexShrink: 0,
          background: isUser ? 'var(--teal)' : mentorColor,
          color: '#fff',
        }}
      >
        {isUser ? 'YOU' : msg.sender.toUpperCase().slice(0, 2)}
      </div>

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
          maxWidth: '100%',
        }}
      >
        <div
          style={{
            padding: '10px 14px',
            borderRadius: 16,
            fontSize: 14,
            lineHeight: 1.6,
            ...(isUser
              ? {
                  background: 'var(--teal)',
                  color: 'var(--navy)',
                  fontWeight: 500,
                  borderBottomRightRadius: 4,
                }
              : {
                  background: 'var(--navy2)',
                  border: '1px solid var(--border)',
                  color: 'var(--silver)',
                  borderBottomLeftRadius: 4,
                }),
          }}
          dangerouslySetInnerHTML={{
            __html: formatBubbleText(msg.text || ''),
          }}
        />
        {msg.artifact && <ArtifactRenderer artifact={msg.artifact} />}
        {msg.score !== undefined && (
          <div
            style={{
              fontSize: 12,
              color: 'var(--gold)',
              fontWeight: 600,
            }}
          >
            Pronunciation score: {msg.score}/10
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Typing indicator ────────────────────────────
function TypingIndicator({ color }: { color: string }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-end',
        gap: 8,
        maxWidth: '88%',
      }}
    >
      <div
        style={{
          width: 28,
          height: 28,
          borderRadius: '50%',
          background: color,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 11,
          fontWeight: 700,
          color: '#fff',
        }}
      >
        LN
      </div>
      <div
        style={{
          padding: '10px 14px',
          background: 'var(--navy2)',
          border: '1px solid var(--border)',
          borderRadius: 16,
          borderBottomLeftRadius: 4,
          display: 'flex',
          gap: 4,
          alignItems: 'center',
        }}
      >
        {[0, 150, 300].map((delay) => (
          <span
            key={delay}
            style={{
              width: 5,
              height: 5,
              borderRadius: '50%',
              background: 'var(--teal)',
              display: 'inline-block',
              animation: `tdot 1.2s ${delay}ms infinite`,
            }}
          />
        ))}
      </div>
    </div>
  )
}

// ─── Main component ───────────────────────────────
export default function BetaPage() {
  const [screen, setScreen] = useState<Screen>('lang')
  const [lang, setLang] = useState<Lang>('en')
  const [mentor, setMentor] = useState<MentorKey>('sarah')
  const [topic, setTopic] = useState<TopicKey>('conversation')
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isRecording, setIsRecording] = useState(false)

  const [session, setSession] = useState<SessionState>({
    lang: 'en',
    mentor: 'sarah',
    topic: 'conversation',
    level: 'A0',
    tokens: 0,
    samples: [],
    sessionId: 's' + Math.random().toString(36).slice(2),
    commercialOffers: [],
    lastTask: null,
    lastArtifact: null,
  })

  const sessionRef = useRef<SessionState>(session)
  const msgsEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])

  useEffect(() => {
    sessionRef.current = session
  }, [session])

  useEffect(() => {
    try {
      const saved = localStorage.getItem('lng1010')
      if (saved) {
        const parsed = JSON.parse(saved) as Partial<SessionState>
        setSession((s) => ({
          ...s,
          ...parsed,
          sessionId: 's' + Math.random().toString(36).slice(2),
        }))
        if (parsed.lang) setLang(parsed.lang)
        if (parsed.mentor) setMentor(parsed.mentor)
        if (parsed.topic) setTopic(parsed.topic)
      }
    } catch {}
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem('lng1010', JSON.stringify(session))
    } catch {}
  }, [session])

  useEffect(() => {
    msgsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isLoading])

  const addMsg = useCallback((msg: Omit<Message, 'id'>) => {
    setMessages((prev) => [...prev, { ...msg, id: createMessage(msg.sender, msg.text).id }])
  }, [])

  const callAPI = useCallback(
    async (
      payload: Record<string, unknown>,
      options?: { rewardToken?: boolean }
    ) => {
      const rewardToken = options?.rewardToken ?? true
      setIsLoading(true)

      try {
        const currentSession = sessionRef.current

        const body = {
          ...payload,
          state: {
            ...currentSession,
            mentor,
            lang,
            activeMentor: mentor,
            topic,
            topicSystemPrompt: TSYS[topic],
          },
        }

        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(25000),
        })

        const data = (await res.json()) as ApiResponse

        if (data.state) {
          setSession((s) => {
            const merged: SessionState = {
              ...s,
              ...data.state,
              samples: s.samples,
              sessionId: s.sessionId,
            }
            sessionRef.current = merged
            return merged
          })
        }

        if (data.diagnostic) {
          addMsg({
            sender: 'ln',
            text: JSON.stringify(data.diagnostic, null, 2),
            artifact: null,
          })
          return
        }

        const text = safeString(data.reply ?? data.message ?? data.content ?? '')

        if (!text) {
          addMsg({
            sender: 'ln',
            text: 'No response received. Please try again.',
            artifact: null,
          })
          return
        }

        let updatedTokenCount = sessionRef.current.tokens ?? 0

        if (rewardToken) {
          setSession((s) => {
            const nextTokens = (s.tokens ?? 0) + 1
            updatedTokenCount = nextTokens
            const nextSession = { ...s, tokens: nextTokens }
            sessionRef.current = nextSession
            return nextSession
          })
        }

        addMsg({
          sender: mentor as MentorKey,
          text,
          artifact: data.artifact ?? null,
          score: data.pronunciationScore,
        })

        if (
          rewardToken &&
          updatedTokenCount > 0 &&
          updatedTokenCount % 5 === 0 &&
          !data.artifact
        ) {
          void callAPI(
            {
              message: 'Generate a compact reinforcement schema based on the last learning milestone.',
              autoSchema: true,
            },
            { rewardToken: false }
          )
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error'
        if (
          msg.includes('AbortError') ||
          msg.includes('timeout') ||
          msg.includes('signal')
        ) {
          addMsg({
            sender: 'ln',
            text: 'Response took too long. Please try again.',
            artifact: null,
          })
        } else {
          addMsg({
            sender: 'ln',
            text: 'Connection error. Check your network and try again.',
            artifact: null,
          })
        }
      } finally {
        setIsLoading(false)
      }
    },
    [mentor, lang, topic, addMsg]
  )

  const sendText = useCallback(async () => {
    const msg = input.trim()
    if (!msg || isLoading) return

    setInput('')
    if (textareaRef.current) textareaRef.current.style.height = 'auto'

    addMsg({ sender: 'user', text: msg, artifact: null })

    setSession((s) => {
      const next = { ...s, samples: [...s.samples, msg] }
      sessionRef.current = next
      return next
    })

    await callAPI({ message: msg })
  }, [input, isLoading, addMsg, callAPI])

  const startChat = useCallback(
    (m: MentorKey, t: TopicKey, l: Lang) => {
      setMentor(m)
      setTopic(t)
      setLang(l)

      setSession((s) => {
        const next = { ...s, mentor: m, topic: t, lang: l }
        sessionRef.current = next
        return next
      })

      const greeting = GREETINGS[m][l] ?? GREETINGS[m].en ?? ''
      setMessages([createMessage(m, greeting, null)])
      setScreen('chat')
    },
    []
  )

  const toggleRecording = useCallback(async () => {
    if (isRecording) {
      mediaRecorderRef.current?.stop()
      setIsRecording(false)
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      chunksRef.current = []

      const rec = new MediaRecorder(stream)

      rec.ondataavailable = (e) => chunksRef.current.push(e.data)

      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop())

        const blob = new Blob(chunksRef.current, { type: 'audio/webm' })

        const b64 = await new Promise<string>((res) => {
          const reader = new FileReader()
          reader.onload = () => res((reader.result as string).split(',')[1] || '')
          reader.readAsDataURL(blob)
        })

        addMsg({ sender: 'user', text: '🎤 Audio sent', artifact: null })

        await callAPI({
          audio: { data: b64, format: 'webm' },
        })
      }

      rec.start()
      mediaRecorderRef.current = rec
      setIsRecording(true)
    } catch (e) {
      addMsg({
        sender: 'ln',
        text: `Microphone not available: ${
          e instanceof Error ? e.message : String(e)
        }`,
        artifact: null,
      })
    }
  }, [isRecording, addMsg, callAPI])

  const handleFile = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (!file) return

      const reader = new FileReader()
      reader.onload = async () => {
        const result = reader.result as string
        const b64 = result.split(',')[1] || ''
        addMsg({ sender: 'user', text: `📎 ${file.name}`, artifact: null })
        await callAPI({
          files: [
            {
              name: file.name,
              type: file.type,
              data: b64,
              size: file.size,
            },
          ],
        })
      }

      reader.readAsDataURL(file)
      e.target.value = ''
    },
    [addMsg, callAPI]
  )

  const exportChat = useCallback(() => {
    const lines = messages.map((m) => `${m.sender.toUpperCase()}: ${m.text}`)
    const blob = new Blob([lines.join('\n\n')], { type: 'text/plain' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'lingora-chat.txt'
    a.click()
  }, [messages])

  const mentorMeta = MENTOR_META[mentor]
  const progress =
    screen === 'lang' ? 1 : screen === 'mentor' ? 2 : screen === 'topic' ? 3 : 3

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=DM+Sans:wght@300;400;500;600;700&display=swap');

        :root {
          --navy: #080f1f;
          --navy2: #0d1828;
          --navy3: #132035;
          --navy4: #1a2a42;
          --teal: #00c9a7;
          --coral: #ff6b6b;
          --gold: #f5c842;
          --silver: rgba(255,255,255,.88);
          --muted: rgba(255,255,255,.45);
          --dim: rgba(255,255,255,.22);
          --border: rgba(255,255,255,.08);
          --card: rgba(255,255,255,.04);
        }

        *, *::before, *::after {
          box-sizing: border-box;
          margin: 0;
          padding: 0;
        }

        html, body {
          height: 100%;
          overflow: hidden;
        }

        body {
          font-family: 'DM Sans', system-ui, sans-serif;
          background: var(--navy);
          color: var(--silver);
        }

        @keyframes tdot {
          0%,60%,100% { opacity:.3; transform:translateY(0) }
          30% { opacity:1; transform:translateY(-4px) }
        }

        @keyframes fadeUp {
          from { opacity:0; transform:translateY(16px) }
          to { opacity:1; transform:translateY(0) }
        }

        ::-webkit-scrollbar {
          width: 4px;
        }

        ::-webkit-scrollbar-thumb {
          background: var(--border);
          border-radius: 4px;
        }

        textarea:focus, button:focus, input:focus, select:focus {
          outline: none;
        }
      `}</style>

      {screen !== 'chat' && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'var(--navy)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '2rem',
            zIndex: 100,
          }}
        >
          <div style={{ display: 'flex', gap: 6, marginBottom: 36 }}>
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                style={{
                  height: 3,
                  width: i <= progress ? 32 : 20,
                  borderRadius: 3,
                  background: i <= progress ? 'var(--teal)' : 'var(--border)',
                  transition: 'all .3s',
                }}
              />
            ))}
          </div>

          {screen === 'lang' && (
            <div
              style={{
                width: '100%',
                maxWidth: 440,
                animation: 'fadeUp .4s ease both',
              }}
            >
              <h1
                style={{
                  fontFamily: '"DM Serif Display", Georgia, serif',
                  fontSize: 'clamp(2.5rem,6vw,4rem)',
                  fontWeight: 400,
                  letterSpacing: '-.03em',
                  background: 'linear-gradient(135deg,#fff 40%,var(--teal))',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  marginBottom: '1rem',
                  textAlign: 'center',
                }}
              >
                LINGORA
              </h1>

              <p
                style={{
                  textAlign: 'center',
                  color: 'var(--muted)',
                  marginBottom: '2rem',
                  lineHeight: 1.7,
                }}
              >
                Learn Spanish. Live the culture.
              </p>

              <label
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: '.1em',
                  textTransform: 'uppercase',
                  color: 'var(--muted)',
                  display: 'block',
                  marginBottom: 8,
                }}
              >
                Select your language
              </label>

              <select
                value={lang}
                onChange={(e) => setLang(e.target.value as Lang)}
                style={{
                  width: '100%',
                  background: 'var(--navy2)',
                  border: '1px solid var(--border)',
                  borderRadius: 12,
                  padding: '13px 16px',
                  fontSize: 15,
                  color: 'var(--silver)',
                  marginBottom: 24,
                }}
              >
                {LANGUAGES.map((l) => (
                  <option key={l.value} value={l.value}>
                    {l.label}
                  </option>
                ))}
              </select>

              <button
                onClick={() => setScreen('mentor')}
                style={{
                  width: '100%',
                  background: 'var(--teal)',
                  color: 'var(--navy)',
                  fontWeight: 700,
                  fontSize: 15,
                  padding: '14px',
                  borderRadius: 999,
                  border: 'none',
                  cursor: 'pointer',
                }}
              >
                Continue →
              </button>
            </div>
          )}

          {screen === 'mentor' && (
            <div
              style={{
                width: '100%',
                maxWidth: 480,
                animation: 'fadeUp .4s ease both',
              }}
            >
              <h2
                style={{
                  fontFamily: '"DM Serif Display", serif',
                  fontSize: 'clamp(1.8rem,4vw,2.8rem)',
                  color: '#fff',
                  textAlign: 'center',
                  marginBottom: 8,
                  fontWeight: 400,
                }}
              >
                Choose your mentor
              </h2>

              <p
                style={{
                  textAlign: 'center',
                  color: 'var(--muted)',
                  marginBottom: 28,
                  fontSize: 14,
                }}
              >
                Each mentor brings a different approach.
              </p>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(3,1fr)',
                  gap: 12,
                  marginBottom: 28,
                }}
              >
                {(
                  Object.entries(MENTOR_META) as [
                    MentorKey,
                    (typeof MENTOR_META)[MentorKey]
                  ][]
                ).map(([key, m]) => (
                  <button
                    key={key}
                    onClick={() => {
                      setMentor(key)
                      setScreen('topic')
                    }}
                    style={{
                      background: 'var(--navy2)',
                      border: `2px solid ${
                        mentor === key ? 'var(--teal)' : 'var(--border)'
                      }`,
                      borderRadius: 16,
                      padding: '20px 12px',
                      cursor: 'pointer',
                      textAlign: 'left',
                      transition: 'all .2s',
                    }}
                  >
                    <div style={{ fontSize: 28, marginBottom: 8 }}>{m.emoji}</div>
                    <div
                      style={{
                        fontWeight: 700,
                        fontSize: 14,
                        color: '#fff',
                        marginBottom: 3,
                      }}
                    >
                      {m.name}
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        color: 'var(--muted)',
                        lineHeight: 1.4,
                      }}
                    >
                      {m.spec.split(' · ')[0]}
                    </div>
                  </button>
                ))}
              </div>

              <button
                onClick={() => setScreen('lang')}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--muted)',
                  fontSize: 13,
                  cursor: 'pointer',
                  display: 'block',
                  margin: '0 auto',
                }}
              >
                ← Back
              </button>
            </div>
          )}

          {screen === 'topic' && (
            <div
              style={{
                width: '100%',
                maxWidth: 480,
                animation: 'fadeUp .4s ease both',
              }}
            >
              <h2
                style={{
                  fontFamily: '"DM Serif Display", serif',
                  fontSize: 'clamp(1.8rem,4vw,2.8rem)',
                  color: '#fff',
                  textAlign: 'center',
                  marginBottom: 8,
                  fontWeight: 400,
                }}
              >
                What do you want to work on?
              </h2>

              <p
                style={{
                  textAlign: 'center',
                  color: 'var(--muted)',
                  marginBottom: 24,
                  fontSize: 14,
                }}
              >
                Select a topic to get started.
              </p>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(2,1fr)',
                  gap: 10,
                  marginBottom: 24,
                }}
              >
                {(
                  Object.entries(TOPIC_META) as [
                    TopicKey,
                    { emoji: string; label: string }
                  ][]
                ).map(([key, t]) => (
                  <button
                    key={key}
                    onClick={() => {
                      setTopic(key)
                      startChat(mentor, key, lang)
                    }}
                    style={{
                      background: 'var(--navy2)',
                      border: `1px solid ${
                        topic === key ? 'var(--teal)' : 'var(--border)'
                      }`,
                      borderRadius: 14,
                      padding: '16px 14px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      transition: 'all .2s',
                    }}
                  >
                    <span style={{ fontSize: 22 }}>{t.emoji}</span>
                    <span
                      style={{
                        fontWeight: 600,
                        fontSize: 14,
                        color: '#fff',
                      }}
                    >
                      {t.label}
                    </span>
                  </button>
                ))}
              </div>

              <button
                onClick={() => setScreen('mentor')}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--muted)',
                  fontSize: 13,
                  cursor: 'pointer',
                  display: 'block',
                  margin: '0 auto',
                }}
              >
                ← Back
              </button>
            </div>
          )}
        </div>
      )}

      {screen === 'chat' && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            height: '100dvh',
            maxWidth: 720,
            margin: '0 auto',
          }}
        >
          <div
            style={{
              padding: '14px 20px',
              background: 'var(--navy2)',
              borderBottom: '1px solid var(--border)',
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              flexShrink: 0,
            }}
          >
            <div
              style={{
                width: 42,
                height: 42,
                borderRadius: '50%',
                background: mentorMeta.color,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 18,
                flexShrink: 0,
              }}
            >
              {mentorMeta.emoji}
            </div>

            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{ fontWeight: 700, fontSize: 15, color: '#fff' }}
              >
                {mentorMeta.name}
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: 'var(--muted)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {mentorMeta.spec}
              </div>
            </div>

            <div
              style={{
                display: 'flex',
                gap: 6,
                alignItems: 'center',
                flexWrap: 'wrap',
              }}
            >
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  padding: '4px 10px',
                  borderRadius: 999,
                  border: '1px solid var(--border)',
                  color: 'var(--muted)',
                }}
              >
                {session.level}
              </span>

              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  padding: '4px 10px',
                  borderRadius: 999,
                  background: 'rgba(245,200,66,.15)',
                  color: 'var(--gold)',
                  border: '1px solid rgba(245,200,66,.25)',
                }}
              >
                {session.tokens}
              </span>

              <button
                onClick={exportChat}
                style={{
                  fontSize: 11,
                  padding: '5px 10px',
                  borderRadius: 999,
                  border: '1px solid var(--border)',
                  background: 'none',
                  color: 'var(--muted)',
                  cursor: 'pointer',
                }}
              >
                📋 Export
              </button>

              <button
                onClick={() => {
                  setMessages([])
                  const resetState: SessionState = {
                    ...sessionRef.current,
                    tokens: 0,
                    level: 'A0',
                    samples: [],
                    lastTask: null,
                    lastArtifact: null,
                  }
                  setSession(resetState)
                  sessionRef.current = resetState
                  setScreen('lang')
                }}
                style={{
                  fontSize: 11,
                  padding: '5px 10px',
                  borderRadius: 999,
                  border: '1px solid var(--border)',
                  background: 'none',
                  color: 'var(--muted)',
                  cursor: 'pointer',
                }}
              >
                ↺ Reset
              </button>
            </div>
          </div>

          <div
            style={{
              flex: 1,
              overflowY: 'auto',
              padding: '20px 16px',
              display: 'flex',
              flexDirection: 'column',
              gap: 14,
            }}
          >
            {messages.map((msg) => (
              <Bubble key={msg.id} msg={msg} mentorColor={mentorMeta.color} />
            ))}
            {isLoading && <TypingIndicator color={mentorMeta.color} />}
            <div ref={msgsEndRef} />
          </div>

          <div
            style={{
              textAlign: 'center',
              fontSize: 11,
              color: 'var(--dim)',
              padding: '4px 0',
              flexShrink: 0,
            }}
          >
            Enter = new line · Ctrl+Enter = send
          </div>

          <div
            style={{
              padding: '10px 14px 14px',
              borderTop: '1px solid var(--border)',
              display: 'flex',
              alignItems: 'flex-end',
              gap: 8,
              background: 'var(--navy)',
              flexShrink: 0,
            }}
          >
            <button
              onClick={toggleRecording}
              style={{
                width: 38,
                height: 38,
                borderRadius: '50%',
                border: `1px solid ${
                  isRecording ? 'var(--coral)' : 'var(--border)'
                }`,
                background: isRecording
                  ? 'rgba(255,107,107,.1)'
                  : 'transparent',
                color: isRecording ? 'var(--coral)' : 'var(--muted)',
                fontSize: 15,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              🎤
            </button>

            <label
              style={{
                width: 38,
                height: 38,
                borderRadius: '50%',
                border: '1px solid var(--border)',
                background: 'transparent',
                color: 'var(--muted)',
                fontSize: 15,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              📎
              <input
                type="file"
                accept="image/*,application/pdf,text/*"
                onChange={handleFile}
                style={{ display: 'none' }}
              />
            </label>

            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => {
                setInput(e.target.value)
                e.target.style.height = 'auto'
                e.target.style.height =
                  Math.min(e.target.scrollHeight, 120) + 'px'
              }}
              onKeyDown={(e) => {
                if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                  e.preventDefault()
                  void sendText()
                }
              }}
              placeholder="Write in your language..."
              rows={1}
              style={{
                flex: 1,
                background: 'var(--navy2)',
                border: '1px solid var(--border)',
                borderRadius: 14,
                padding: '10px 14px',
                fontSize: 14,
                color: 'var(--silver)',
                resize: 'none',
                maxHeight: 120,
                lineHeight: 1.5,
                fontFamily: 'inherit',
                transition: 'border-color .2s',
              }}
              onFocus={(e) => {
                e.target.style.borderColor = 'rgba(0,201,167,.4)'
              }}
              onBlur={(e) => {
                e.target.style.borderColor = 'var(--border)'
              }}
            />

            <button
              onClick={() => void sendText()}
              disabled={isLoading || !input.trim()}
              style={{
                width: 38,
                height: 38,
                borderRadius: '50%',
                background:
                  isLoading || !input.trim() ? 'var(--navy3)' : 'var(--teal)',
                color:
                  isLoading || !input.trim() ? 'var(--muted)' : 'var(--navy)',
                border: 'none',
                fontSize: 16,
                cursor:
                  isLoading || !input.trim() ? 'default' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                transition: 'all .2s',
              }}
            >
              ▶
            </button>
          </div>
        </div>
      )}
    </>
  )
}
