'use client'

// ================================================
// LINGORA 10.2 — /beta — AI Tutor
// PRO MAX: Full parity with Netlify 9.18 + upgrade
// ─ COPY multilingual (10 langs, all strings)
// ─ Lang grid with flags (Netlify style)
// ─ Topic cards with localized descriptions
// ─ Mentor cards premium (code, bio, speciality)
// ─ LN Splash transition (1800ms/3600ms)
// ─ UNED-grade schema renderer
// ─ Export TXT + PDF client-side
// ─ Voice input, file upload, quiz interactivo
// ================================================

import { useState, useRef, useEffect, useCallback, useMemo } from 'react'

// ─── Types ───────────────────────────────────────
type MK = 'sarah' | 'alex' | 'nick'
type TK = 'conversation' | 'structured' | 'cervantes' | 'business' | 'travel' | 'course' | 'leveltest'
type Lang = 'es' | 'en' | 'no' | 'fr' | 'de' | 'it' | 'pt' | 'ar' | 'ja' | 'zh'
type Phase = 'onboarding' | 'splash' | 'chat'

interface Artifact {
  type: 'schema' | 'quiz' | 'illustration' | 'pdf' | 'audio'
  url?: string
  content?: Record<string, unknown>
  metadata?: Record<string, unknown>
}

interface Msg { id: string; sender: 'user' | MK | 'ln'; text: string; artifact?: Artifact | null; score?: number }
interface SS {
  lang: Lang; mentor: MK; topic: TK; level: string; tokens: number
  samples: string[]; sessionId: string; commercialOffers: unknown[]
  lastTask: string | null; lastArtifact: string | null
  // Tutor protocol fields — optional, sent back from route.ts
  tutorMode?:          string
  tutorPhase?:         string
  lessonIndex?:        number
  courseActive?:       boolean
  lastAction?:         string | null
  awaitingQuizAnswer?: boolean
}
interface TableRow { left: string; right: string }
interface QuizQ    { question: string; options: string[]; correct: number }
interface Sub      { title: string; content: string; keyTakeaway?: string }
interface Norm {
  title: string; objective: string; block: string; keyConcepts: string[]
  subtopics: Sub[]; quiz: QuizQ[]; tableRows: TableRow[]
  summary: string; examples: string[]
}

// ─── Static Data ─────────────────────────────────
const MENTOR_META: Record<MK, { emoji: string; name: string; code: string; color: string; bg: string; spec: string }> = {
  sarah: { emoji: '📚', name: 'Sarah', code: 'SR', color: '#7c3aed', bg: 'rgba(124,58,237,.14)', spec: 'Mentora académica · LINGORA' },
  alex:  { emoji: '🌍', name: 'Alex',  code: 'AX', color: '#0891b2', bg: 'rgba(8,145,178,.14)',  spec: 'Mentor cultural · LINGORA' },
  nick:  { emoji: '💼', name: 'Nick',  code: 'NK', color: '#d97706', bg: 'rgba(217,119,6,.14)',  spec: 'Mentor profesional · LINGORA' },
}

const TOPIC_META: Record<TK, { emoji: string }> = {
  conversation: { emoji: '💬' }, structured: { emoji: '📚' },
  cervantes:    { emoji: '🏛️' }, business:   { emoji: '💼' },
  travel:       { emoji: '✈️' }, course:     { emoji: '📖' },
  leveltest:    { emoji: '📊' },
}

const LANG_GRID: Array<{ value: Lang; flag: string; label: string; sub: string }> = [
  { value: 'es', flag: '🇪🇸', label: 'Español',   sub: 'Spanish' },
  { value: 'en', flag: '🇬🇧', label: 'English',   sub: 'English' },
  { value: 'no', flag: '🇳🇴', label: 'Norsk',     sub: 'Norwegian' },
  { value: 'fr', flag: '🇫🇷', label: 'Français',  sub: 'French' },
  { value: 'de', flag: '🇩🇪', label: 'Deutsch',   sub: 'German' },
  { value: 'it', flag: '🇮🇹', label: 'Italiano',  sub: 'Italian' },
  { value: 'pt', flag: '🇵🇹', label: 'Português', sub: 'Portuguese' },
  { value: 'ar', flag: '🇸🇦', label: 'العربية',  sub: 'Arabic' },
  { value: 'ja', flag: '🇯🇵', label: '日本語',   sub: 'Japanese' },
  { value: 'zh', flag: '🇨🇳', label: '中文',     sub: 'Chinese' },
]

// Full multilingual COPY — ported from Netlify 9.18 cantera
const COPY: Record<Lang, { tg: string; l1: string; l2: string; l3: string; sb: string; lnw: string; hint: string; ph: string; tn: string[]; td: string[]; md: string[]; bio: string[] }> = {
  es: { tg: 'Instituto cultural · Aprende español con mentores reales.', l1: '1 · Elige tu idioma de interfaz', l2: '2 · ¿Qué quieres aprender?', l3: '3 · Elige tu mentor', sb: 'Comenzar →', lnw: 'Soy LINGORA, tu instituto cultural. Voy a presentarte a tu mentor especializado...', hint: 'Enter = nueva línea · Ctrl+Enter = enviar', ph: 'Escribe en tu idioma…', tn: ['Conversación', 'Lecciones estructuradas', 'Examen Cervantes', 'Español de negocios', 'Viajes e inmersión', 'Curso completo', 'Test de nivel'], td: ['Practica español de forma natural', 'Aprende con un plan paso a paso', 'Prepárate para DELE / CCSE', 'Comunicación profesional', 'Español para viajar y vivir', 'Currículum completo A0–C2', 'Descubre tu nivel real'], md: ['Gramática, exámenes, estructura y explicación precisa.', 'Conversación, viajes, confianza y cultura aplicada.', 'Negocios, entrevistas, reuniones y español profesional.'], bio: ['SR · Sarah está lista para acompañarte con rigor pedagógico.', 'AX · Alex te ayudará a ganar confianza real en español.', 'NK · Nick te preparará para el mundo profesional hispanohablante.'] },
  en: { tg: 'Cultural institute · Learn Spanish with real mentors.', l1: '1 · Choose your interface language', l2: '2 · What do you want to learn?', l3: '3 · Choose your mentor', sb: 'Start →', lnw: 'I am LINGORA, your cultural institute. Let me introduce you to your mentor...', hint: 'Enter = new line · Ctrl+Enter = send', ph: 'Write in your language…', tn: ['Conversation', 'Structured lessons', 'Cervantes exam', 'Business Spanish', 'Travel & immersion', 'Full course', 'Level test'], td: ['Practice Spanish naturally', 'Learn with a step-by-step plan', 'Prepare for DELE / CCSE', 'Professional communication', 'Spanish for travel and daily life', 'Complete curriculum A0–C2', 'Discover your real level'], md: ['Grammar, exams, structure and precise explanation.', 'Conversation, travel, confidence and applied culture.', 'Business, interviews, meetings and professional Spanish.'], bio: ['SR · Sarah is ready to guide you with pedagogical rigor.', 'AX · Alex will help you build real confidence in Spanish.', 'NK · Nick will prepare you for the Spanish-speaking professional world.'] },
  no: { tg: 'Kulturinstitutt · Lær spansk med ekte mentorer.', l1: '1 · Velg grensesnittspråket ditt', l2: '2 · Hva vil du lære?', l3: '3 · Velg din mentor', sb: 'Start →', lnw: 'Jeg er LINGORA, ditt kulturinstitutt. La meg presentere din spesialiserte mentor...', hint: 'Enter = ny linje · Ctrl+Enter = send', ph: 'Skriv på ditt språk…', tn: ['Samtale', 'Strukturerte leksjoner', 'Cervantes-eksamen', 'Forretningsspansk', 'Fordypning og reise', 'Strukturert kurs', 'Nivåtest'], td: ['Øv på spansk på en naturlig måte', 'Lær med en plan steg for steg', 'Forbered deg til DELE/CCSE', 'Profesjonell kommunikasjon', 'Spansk for reiser og hverdagsliv', 'Komplett kurs A0–C2', 'Finn ditt reelle spansknivå'], md: ['Grammatikk, eksamener, struktur og presis forklaring.', 'Samtale, reiser, selvtillit og anvendt kultur.', 'Forretninger, intervjuer, møter og profesjonell spansk.'], bio: ['SR · Sarah er klar til å veilede deg med pedagogisk nøyaktighet.', 'AX · Alex hjelper deg å bygge ekte selvtillit i spansk.', 'NK · Nick forbereder deg på det spansktalende næringslivet.'] },
  fr: { tg: "Institut culturel · Apprenez l'espagnol avec de vrais mentors.", l1: "1 · Choisissez votre langue d'interface", l2: '2 · Que voulez-vous apprendre?', l3: '3 · Choisissez votre mentor', sb: 'Commencer →', lnw: "Je suis LINGORA, votre institut culturel. Je vais vous présenter votre mentor...", hint: 'Entrée = nouvelle ligne · Ctrl+Entrée = envoyer', ph: 'Écrivez dans votre langue…', tn: ['Conversation', 'Leçons structurées', 'Examen Cervantes', 'Espagnol des affaires', 'Voyages et immersion', 'Cours complet', 'Test de niveau'], td: ["Pratiquez l'espagnol naturellement", 'Apprenez étape par étape', 'Préparez-vous au DELE/CCSE', 'Communication professionnelle', "L'espagnol pour voyager", 'Cursus complet A0–C2', 'Découvrez votre vrai niveau'], md: ['Grammaire, examens, structure et explication précise.', "Conversation, voyages, confiance et culture.", 'Affaires, entretiens, réunions et espagnol professionnel.'], bio: ['SR · Sarah est prête à vous guider avec rigueur pédagogique.', "AX · Alex vous aidera à gagner de la confiance en espagnol.", 'NK · Nick vous préparera au monde professionnel hispanophone.'] },
  de: { tg: 'Kulturinstitut · Spanisch lernen mit echten Mentoren.', l1: '1 · Wähle deine Schnittstellensprache', l2: '2 · Was möchtest du lernen?', l3: '3 · Wähle deinen Mentor', sb: 'Starten →', lnw: 'Ich bin LINGORA, dein Kulturinstitut. Ich stelle dir deinen Mentor vor...', hint: 'Enter = neue Zeile · Strg+Enter = senden', ph: 'Schreibe in deiner Sprache…', tn: ['Konversation', 'Strukturierter Unterricht', 'Cervantes-Prüfung', 'Geschäftsspanisch', 'Reisen & Immersion', 'Vollkurs', 'Stufentest'], td: ['Übe Spanisch natürlich', 'Lerne Schritt für Schritt', 'Bereite dich auf DELE/CCSE vor', 'Professionelle Kommunikation', 'Spanisch für Reisen', 'Vollständiger Lehrplan A0–C2', 'Entdecke dein echtes Niveau'], md: ['Grammatik, Prüfungen, Struktur und präzise Erklärung.', 'Konversation, Reisen, Selbstvertrauen und Kultur.', 'Business, Interviews, Meetings und professionelles Spanisch.'], bio: ['SR · Sarah führt dich mit pädagogischer Präzision.', 'AX · Alex hilft dir, echtes Selbstvertrauen auf Spanisch aufzubauen.', 'NK · Nick bereitet dich auf die spanischsprachige Geschäftswelt vor.'] },
  it: { tg: 'Istituto culturale · Impara lo spagnolo con veri mentori.', l1: "1 · Scegli la tua lingua di interfaccia", l2: '2 · Cosa vuoi imparare?', l3: '3 · Scegli il tuo mentore', sb: 'Inizia →', lnw: 'Sono LINGORA, il tuo istituto culturale. Ti presenterò il tuo mentore specializzato...', hint: 'Invio = nuova riga · Ctrl+Invio = invia', ph: 'Scrivi nella tua lingua…', tn: ['Conversazione', 'Lezioni strutturate', 'Esame Cervantes', 'Spagnolo commerciale', 'Viaggi e immersione', 'Corso completo', 'Test di livello'], td: ['Pratica lo spagnolo in modo naturale', 'Impara passo dopo passo', 'Preparati per DELE/CCSE', 'Comunicazione professionale', 'Spagnolo per viaggiare', 'Curriculum completo A0–C2', 'Scopri il tuo livello reale'], md: ['Grammatica, esami, struttura e spiegazione precisa.', 'Conversazione, viaggi, fiducia e cultura applicata.', 'Affari, colloqui, riunioni e spagnolo professionale.'], bio: ['SR · Sarah è pronta a guidarti con rigore pedagogico.', 'AX · Alex ti aiuterà a costruire vera fiducia in spagnolo.', 'NK · Nick ti preparerà per il mondo professionale ispanico.'] },
  pt: { tg: 'Instituto cultural · Aprenda espanhol com mentores reais.', l1: '1 · Escolha seu idioma de interface', l2: '2 · O que você quer aprender?', l3: '3 · Escolha seu mentor', sb: 'Começar →', lnw: 'Sou LINGORA, seu instituto cultural. Vou apresentar seu mentor especializado...', hint: 'Enter = nova linha · Ctrl+Enter = enviar', ph: 'Escreva no seu idioma…', tn: ['Conversação', 'Aulas estruturadas', 'Exame Cervantes', 'Espanhol de negócios', 'Viagens e imersão', 'Curso completo', 'Teste de nível'], td: ['Pratique espanhol de forma natural', 'Aprenda passo a passo', 'Prepare-se para DELE/CCSE', 'Comunicação profissional', 'Espanhol para viajar', 'Currículo completo A0–C2', 'Descubra seu nível real'], md: ['Gramática, exames, estrutura e explicação precisa.', 'Conversação, viagens, confiança e cultura.', 'Negócios, entrevistas, reuniões e espanhol profissional.'], bio: ['SR · Sarah está pronta para guiá-lo com rigor pedagógico.', 'AX · Alex vai ajudá-lo a construir confiança real em espanhol.', 'NK · Nick vai prepará-lo para o mundo profissional hispânico.'] },
  ar: { tg: 'معهد ثقافي · تعلم الإسبانية مع مرشدين حقيقيين.', l1: '١ · اختر لغة الواجهة', l2: '٢ · ماذا تريد أن تتعلم؟', l3: '٣ · اختر مرشدك', sb: 'ابدأ ←', lnw: 'أنا LINGORA، معهدك الثقافي. سأقدم لك مرشدك المتخصص...', hint: 'Enter = سطر جديد · Ctrl+Enter = إرسال', ph: 'اكتب بلغتك…', tn: ['المحادثة', 'دروس منظمة', 'امتحان سيرفانتس', 'الإسبانية التجارية', 'السفر والانغماس', 'دورة كاملة', 'اختبار المستوى'], td: ['تدرب على الإسبانية بشكل طبيعي', 'تعلم بخطة خطوة بخطوة', 'استعد لـ DELE/CCSE', 'التواصل المهني', 'الإسبانية للسفر', 'منهج كامل A0–C2', 'اكتشف مستواك الحقيقي'], md: ['القواعد والامتحانات والبنية والشرح الدقيق.', 'المحادثة والسفر والثقة الثقافية.', 'الأعمال والمقابلات والاجتماعات.'], bio: ['SR · سارة جاهزة لإرشادك بدقة تربوية.', 'AX · أليكس سيساعدك على بناء ثقة حقيقية.', 'NK · نيك سيعدك للعالم المهني الناطق بالإسبانية.'] },
  ja: { tg: '文化研究所 · 本物のメンターとスペイン語を学ぼう。', l1: '1 · インターフェース言語を選択', l2: '2 · 何を学びたいですか？', l3: '3 · メンターを選択', sb: '開始 →', lnw: '私はLINGORA、あなたの文化研究所です。専門メンターをご紹介します...', hint: 'Enter = 改行 · Ctrl+Enter = 送信', ph: 'あなたの言語で入力してください…', tn: ['会話', '構造化レッスン', 'セルバンテス試験', 'ビジネス スペイン語', '旅行と没入', '完全コース', 'レベルテスト'], td: ['自然な方法でスペイン語を練習', 'ステップバイステッププランで学ぶ', 'DELE/CCsEの準備', 'プロフェッショナルコミュニケーション', '旅行のためのスペイン語', 'A0からC2への完全カリキュラム', '本当のレベルを発見'], md: ['文法、試験、構造と正確な説明。', '会話、旅行、自信と文化。', 'ビジネス、面接、会議とプロのスペイン語。'], bio: ['SR · サラは教育的厳密さであなたを導きます。', 'AX · アレックスはスペイン語の自信を築くお手伝いをします。', 'NK · ニックはスペイン語圏のビジネス界に備えます。'] },
  zh: { tg: '文化学院 · 与真实导师一起学习西班牙语。', l1: '1 · 选择界面语言', l2: '2 · 您想学什么？', l3: '3 · 选择您的导师', sb: '开始 →', lnw: '我是LINGORA，您的文化学院。让我为您介绍您的专业导师...', hint: 'Enter = 新行 · Ctrl+Enter = 发送', ph: '用您的语言写作…', tn: ['对话', '结构化课程', '塞万提斯考试', '商务西班牙语', '旅游与沉浸', '完整课程', '水平测试'], td: ['以自然方式练习西班牙语', '按步骤计划学习', '为DELE/CCSE做准备', '专业沟通', '旅行西班牙语', '从A0到C2的完整课程', '发现您的真实水平'], md: ['语法、考试、结构和精确解释。', '对话、旅行、自信和应用文化。', '商务、面试、会议和专业西班牙语。'], bio: ['SR · 莎拉以教学严谨性准备好指导您。', 'AX · 亚历克斯将帮助您建立真正的西班牙语自信。', 'NK · 尼克为您准备进入西班牙语商业世界。'] },
}

const TOPIC_KEYS: TK[] = ['conversation', 'structured', 'cervantes', 'business', 'travel', 'course', 'leveltest']
const MENTOR_KEYS: MK[] = ['sarah', 'alex', 'nick']

// Real conversational greetings — warm, not institutional bios
const GREETINGS: Record<MK, Partial<Record<Lang, string>>> = {
  sarah: {
    es: '¡Hola! Soy Sarah. Cuéntame, ¿qué parte del español quieres trabajar hoy?',
    en: "Hi! I'm Sarah. Tell me — what part of Spanish would you like to work on today?",
    no: 'Hei! Jeg er Sarah. Fortell meg — hva av spansk vil du jobbe med i dag?',
    fr: 'Bonjour ! Je suis Sarah. Dites-moi, sur quelle partie de l\'espagnol voulez-vous travailler?',
    de: 'Hallo! Ich bin Sarah. Sag mir — welchen Teil des Spanischen möchtest du heute üben?',
    it: 'Ciao! Sono Sarah. Dimmi, su quale parte dello spagnolo vuoi lavorare oggi?',
    pt: 'Olá! Sou Sarah. Me diz — em que parte do espanhol você quer trabalhar hoje?',
    ar: 'مرحباً! أنا سارة. أخبرني، ما الجزء من الإسبانية الذي تريد العمل عليه اليوم؟',
    ja: 'こんにちは！サラです。今日はスペイン語のどの部分に取り組みたいですか？',
    zh: '你好！我是Sarah。告诉我，今天你想练习西班牙语的哪个部分？',
  },
  alex: {
    es: '¡Hola! Soy Alex. ¿Qué te trae por aquí hoy? Cuéntame qué quieres hacer con el español.',
    en: "Hey! I'm Alex. What brings you here today? Tell me what you want to do with Spanish.",
    no: 'Hei! Jeg er Alex. Hva bringer deg hit i dag? Fortell meg hva du vil gjøre med spansk.',
    fr: 'Salut ! Je suis Alex. Qu\'est-ce qui vous amène ici ? Dites-moi ce que vous voulez faire avec l\'espagnol.',
    de: 'Hey! Ich bin Alex. Was bringt dich heute her? Erzähl mir, was du mit Spanisch machen möchtest.',
    it: 'Ciao! Sono Alex. Cosa ti porta qui oggi? Dimmi cosa vuoi fare con lo spagnolo.',
    pt: 'Ei! Sou Alex. O que te traz aqui hoje? Me conta o que você quer fazer com o espanhol.',
    ar: 'مرحباً! أنا أليكس. ما الذي يجلبك هنا اليوم؟ أخبرني ماذا تريد أن تفعل مع الإسبانية.',
    ja: 'こんにちは！アレックスです。今日は何を目的に来ましたか？スペイン語で何をしたいか教えてください。',
    zh: '嘿！我是Alex。今天是什么让你来的？告诉我你想用西班牙语做什么。',
  },
  nick: {
    es: '¡Hola! Soy Nick. ¿Qué situación profesional tienes en mente para trabajar hoy?',
    en: "Hi! I'm Nick. What professional situation do you have in mind to work on today?",
    no: 'Hei! Jeg er Nick. Hvilken profesjonell situasjon har du i tankene å jobbe med i dag?',
    fr: 'Bonjour ! Je suis Nick. Quelle situation professionnelle avez-vous en tête pour aujourd\'hui?',
    de: 'Hallo! Ich bin Nick. Welche berufliche Situation möchtest du heute üben?',
    it: 'Ciao! Sono Nick. Quale situazione professionale hai in mente di lavorare oggi?',
    pt: 'Olá! Sou Nick. Qual situação profissional você tem em mente para trabalhar hoje?',
    ar: 'مرحباً! أنا نيك. ما الموقف المهني الذي تفكر فيه للعمل اليوم؟',
    ja: 'こんにちは！ニックです。今日取り組みたいプロフェッショナルな状況は何ですか？',
    zh: '你好！我是Nick。今天你想练习什么职业场景？',
  },
}

const TSYS: Record<TK, string> = {
  conversation: 'Focus on natural, fluid conversation. Correct gently. Use real cultural anecdotes. Be warm and engaging.',
  structured:   'Follow a clear pedagogical structure. Introduce concepts progressively with examples and mini-exercises.',
  cervantes:    'Prepare for DELE or CCSE exams. Use official terminology, exam-style questions, timed practice texts.',
  business:     'Professional Spanish: emails, meetings, presentations, negotiations, interviews. Formal register.',
  travel:       'Real travel situations: hotels, restaurants, transport, emergencies, shopping. Practical phrases.',
  course:       "Structured course from the user's level. Sequence grammar, vocabulary, culture. Advance systematically.",
  leveltest:    'Diagnostic evaluation. Ask progressively harder questions to determine CEFR level accurately.',
}

// ─── Utils ───────────────────────────────────────
const ss = (v: unknown): string => typeof v === 'string' ? v : ''
const sa = (v: unknown): string[] => Array.isArray(v) ? v.map(ss).filter(Boolean) : []

function normSchema(c?: Record<string, unknown>): Norm {
  const r = c ?? {}
  const subtopics: Sub[] = (Array.isArray(r.subtopics) ? r.subtopics : [])
    .map((i: unknown) => { const o = i as Record<string,unknown>; return { title: ss(o.title), content: ss(o.content), keyTakeaway: ss(o.keyTakeaway) } })
    .filter(s => s.title || s.content)
  const quiz: QuizQ[] = (Array.isArray(r.quiz) ? r.quiz : [])
    .map((i: unknown) => { const o = i as Record<string,unknown>; return { question: ss(o.question), options: Array.isArray(o.options) ? o.options.map(ss).filter(Boolean) : [], correct: typeof o.correct === 'number' ? o.correct : 0 } })
    .filter(q => q.question && q.options.length > 0)
  const rawRows = Array.isArray(r.tableRows) ? r.tableRows : Array.isArray(r.rows) ? r.rows : []
  let tableRows: TableRow[] = rawRows.map((i: unknown) => { const o = i as Record<string,unknown>; return { left: ss(o.left)||ss(o.label)||ss(o.persona)||ss(o.term), right: ss(o.right)||ss(o.value)||ss(o.forma)||ss(o.definition) } }).filter(r => r.left && r.right)
  if (tableRows.length === 0 && subtopics.length >= 3) {
    const inferred = subtopics.filter(s => s.title.length < 40 && s.content.length < 80).map(s => ({ left: s.title, right: s.content }))
    if (inferred.length >= 3) tableRows = inferred
  }
  return { title: ss(r.title) || 'LINGORA Schema', objective: ss(r.objective), block: ss(r.block) || 'LINGORA', keyConcepts: sa(r.keyConcepts), subtopics, quiz, tableRows, summary: ss(r.summary) || ss(r.globalTakeaway) || ss(r.keyTakeaway), examples: sa(r.examples) }
}

function fmt(t: string): string {
  return ss(t)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>')
    .replace(/\*(.+?)\*/g,'<em>$1</em>')
    .replace(/`(.+?)`/g,'<code style="background:rgba(0,0,0,.35);padding:1px 5px;border-radius:4px;font-family:monospace;font-size:.88em">$1</code>')
    .replace(/\n/g,'<br>')
}

// ─── Design tokens ────────────────────────────────
const C = {
  navy:   '#080f1f', navy2: '#0d1828', navy3: '#132035',
  teal:   '#00c9a7', coral: '#ff6b6b', gold:  '#f5c842',
  silver: 'rgba(255,255,255,.88)', muted: 'rgba(255,255,255,.50)',
  dim:    'rgba(255,255,255,.22)', border: 'rgba(255,255,255,.08)',
  card:   'rgba(255,255,255,.04)',
}

// ─── Sub-components ───────────────────────────────
function Badge({ children, t = 'd' }: { children: React.ReactNode; t?: 'd'|'teal'|'gold'|'purple'|'coral' }) {
  const s = { d:{ color:'var(--muted)',bg:'var(--card)',br:'1px solid var(--border)'}, teal:{color:'var(--teal)',bg:'rgba(0,201,167,.1)',br:'1px solid rgba(0,201,167,.22)'}, gold:{color:'var(--gold)',bg:'rgba(245,200,66,.1)',br:'1px solid rgba(245,200,66,.22)'}, purple:{color:'#c4b5fd',bg:'rgba(124,58,237,.14)',br:'1px solid rgba(124,58,237,.24)'}, coral:{color:'var(--coral)',bg:'rgba(255,107,107,.1)',br:'1px solid rgba(255,107,107,.22)'} }[t]
  return <span style={{ fontSize:11, padding:'4px 10px', borderRadius:999, fontWeight:700, color:s.color, background:s.bg, border:s.br }}>{children}</span>
}

function SL({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize:11, fontWeight:800, letterSpacing:'.1em', textTransform:'uppercase', color:'var(--muted)', marginBottom:10 }}>{children}</div>
}

function TableBlock({ rows }: { rows: TableRow[] }) {
  if (!rows.length) return null
  return (
    <div style={{ border:'1px solid var(--border)', borderRadius:14, overflow:'hidden', background:'rgba(255,255,255,.02)' }}>
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1.4fr', background:'rgba(255,255,255,.03)', borderBottom:'1px solid var(--border)' }}>
        {['Forma','Valor'].map(h => <div key={h} style={{ padding:'8px 12px', fontSize:11, fontWeight:800, color:'var(--muted)', textTransform:'uppercase', letterSpacing:'.08em' }}>{h}</div>)}
      </div>
      {rows.map((r, i) => (
        <div key={i} style={{ display:'grid', gridTemplateColumns:'1fr 1.4fr', borderBottom: i < rows.length-1 ? '1px solid rgba(255,255,255,.04)' : 'none' }}>
          <div style={{ padding:'10px 12px', fontSize:14, fontWeight:700, color:'#fff' }}>{r.left}</div>
          <div style={{ padding:'10px 12px', fontSize:14, color:'var(--silver)' }}>{r.right}</div>
        </div>
      ))}
    </div>
  )
}

function QuizBlock({ quiz, deferCorrection = false }: { quiz: QuizQ[]; deferCorrection?: boolean }) {
  const [ans, setAns] = useState<Record<number, number|null>>({})
  if (!quiz.length) return null
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
      {quiz.map((q, qi) => {
        const sel = ans[qi] ?? null; const done = sel !== null
        return (
          <div key={qi} style={{ border:'1px solid var(--border)', borderRadius:14, padding:14, background:'rgba(255,255,255,.02)' }}>
            <div style={{ fontSize:14, fontWeight:700, color:'#fff', marginBottom:10, lineHeight:1.5 }}>{qi+1}. {q.question}</div>
            <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
              {q.options.map((opt, oi) => {
                const isSel = oi === sel
                let bg='transparent', bc='var(--border)', col='var(--silver)'
                if (done && deferCorrection) {
                  // Backend quiz (parseQuizFromText): neutral blue for selected, defer scoring to mentor response
                  if (isSel) { bg='rgba(56,189,248,.10)'; bc='#38bdf8'; col='#38bdf8' }
                } else if (done) {
                  // Schema quiz: local scoring is valid (schema generator produces real correct index)
                  const isOk = oi === q.correct
                  if (isOk)           { bg='rgba(0,201,167,.12)'; bc='var(--teal)'; col='var(--teal)' }
                  if (isSel && !isOk) { bg='rgba(255,107,107,.1)'; bc='var(--coral)'; col='var(--coral)' }
                }
                return <button key={oi} disabled={done} onClick={() => setAns(p => ({...p,[qi]:oi}))} style={{ textAlign:'left', padding:'9px 12px', borderRadius:10, border:`1px solid ${bc}`, background:bg, color:col, cursor:done?'default':'pointer', fontSize:13, fontWeight:600 }}>{'ABCD'[oi]}) {opt}</button>
              })}
            </div>
            {done && deferCorrection && (
              <div style={{ marginTop:8, fontSize:12, color:'#38bdf8', fontWeight:600 }}>
                Seleccionada · escribe tu respuesta al tutor para continuar
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function SchemaBlock({ content }: { content: Record<string, unknown> }) {
  const s = useMemo(() => normSchema(content), [content])

  const exportTxt = () => {
    const lines = ['LINGORA Schema', s.title, '', s.objective, '', s.keyConcepts.length ? 'Conceptos: ' + s.keyConcepts.join(', ') : '', '', ...s.tableRows.map(r => `${r.left}: ${r.right}`), '', ...s.subtopics.map(sub => `${sub.title}\n${sub.content}${sub.keyTakeaway ? '\n80/20: ' + sub.keyTakeaway : ''}`), '', ...s.examples, '', s.summary ? '80/20: ' + s.summary : '', '', '--- SIMULACRO ---', ...s.quiz.map((q,i) => `${i+1}. ${q.question}\n${q.options.map((o,oi) => `  ${'ABCD'[oi]}) ${o}${oi===q.correct?' ✓':''}`).join('\n')}`)].filter(Boolean)
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([lines.join('\n')],{type:'text/plain'})); a.download = 'lingora-schema.txt'; a.click()
  }

  return (
    <div style={{ marginTop:10, width:'100%', maxWidth:580, borderRadius:20, overflow:'hidden', background:'linear-gradient(180deg,rgba(255,255,255,.035),rgba(255,255,255,.018))', border:'1px solid var(--border)', boxShadow:'0 12px 36px rgba(0,0,0,.22)' }}>
      {/* Header row */}
      <div style={{ padding:'12px 16px', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center', justifyContent:'space-between', gap:10, background:'rgba(255,255,255,.02)' }}>
        <Badge t="purple">{s.block}</Badge>
        <div style={{ display:'flex', gap:5 }}>
          {s.tableRows.length > 0 && <Badge t="gold">Tabla</Badge>}
          {s.quiz.length > 0      && <Badge t="teal">Simulacro</Badge>}
          {s.examples.length > 0  && <Badge t="d">Ejemplos</Badge>}
        </div>
      </div>

      <div style={{ padding:16, display:'flex', flexDirection:'column', gap:16 }}>
        {/* Title */}
        <div>
          <div style={{ fontSize:21, fontWeight:800, color:'#fff', marginBottom:6, lineHeight:1.15, fontFamily:'"DM Serif Display",serif' }}>{s.title}</div>
          {s.objective && <div style={{ fontSize:14, lineHeight:1.65, color:'var(--muted)' }}>{s.objective}</div>}
        </div>

        {/* Concepts */}
        {s.keyConcepts.length > 0 && <div><SL>Conceptos clave</SL><div style={{ display:'flex', flexWrap:'wrap', gap:5 }}>{s.keyConcepts.map((c,i) => <Badge key={i} t="teal">{c}</Badge>)}</div></div>}

        {/* Table */}
        {s.tableRows.length > 0 && <div><SL>Cuadro visual</SL><TableBlock rows={s.tableRows} /></div>}

        {/* Subtopics */}
        {s.subtopics.length > 0 && (
          <div>
            <SL>Desarrollo</SL>
            <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
              {s.subtopics.map((sub, i) => (
                <div key={i} style={{ border:'1px solid var(--border)', borderRadius:14, padding:14, background:'rgba(255,255,255,.02)' }}>
                  <div style={{ fontSize:14, fontWeight:800, color:'#fff', marginBottom:5 }}>{sub.title}</div>
                  <div style={{ fontSize:14, lineHeight:1.65, color:'var(--silver)' }}>{sub.content}</div>
                  {sub.keyTakeaway && <div style={{ marginTop:7, fontSize:12, color:'var(--teal)', fontWeight:700 }}>🎯 80/20: {sub.keyTakeaway}</div>}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Examples */}
        {s.examples.length > 0 && (
          <div>
            <SL>Ejemplos</SL>
            <div style={{ display:'flex', flexDirection:'column', gap:7 }}>
              {s.examples.map((ex, i) => <div key={i} style={{ fontSize:14, lineHeight:1.6, color:'#fff', padding:'9px 12px', borderRadius:12, background:'rgba(255,255,255,.03)', border:'1px solid rgba(255,255,255,.05)' }}>{ex}</div>)}
            </div>
          </div>
        )}

        {/* 80/20 Summary */}
        {s.summary && (
          <div style={{ background:'linear-gradient(180deg,rgba(0,201,167,.09),rgba(0,201,167,.04))', border:'1px solid rgba(0,201,167,.22)', borderRadius:14, padding:14 }}>
            <SL>Regla 80/20</SL>
            <div style={{ fontSize:14, lineHeight:1.6, color:'#fff' }}>🧠 {s.summary}</div>
          </div>
        )}

        {/* Quiz */}
        {s.quiz.length > 0 && <div><SL>Simulacro interactivo</SL><QuizBlock quiz={s.quiz} /></div>}

        {/* Export */}
        <div style={{ paddingTop:4, borderTop:'1px solid rgba(255,255,255,.05)' }}>
          <button onClick={exportTxt} style={{ background:'none', border:'none', color:'var(--teal)', fontWeight:700, fontSize:13, cursor:'pointer', padding:0 }}>↓ Exportar esquema (.txt)</button>
        </div>
      </div>
    </div>
  )
}

function ArtifactRender({ a }: { a: Artifact }) {
  if (a.type === 'schema' && a.content) return <SchemaBlock content={a.content} />
  if (a.type === 'quiz' && a.content) {
    const qc = a.content as { title: string; questions: Array<{ question: string; options: string[]; correct: number }> }
    return (
      <div style={{ marginTop:10, width:'100%', maxWidth:540, borderRadius:16, border:'1px solid rgba(0,201,167,.25)', background:'rgba(0,201,167,.05)', overflow:'hidden' }}>
        <div style={{ padding:'10px 14px', borderBottom:'1px solid rgba(0,201,167,.15)', display:'flex', alignItems:'center', gap:8 }}>
          <span style={{ fontSize:11, fontWeight:800, letterSpacing:'.1em', textTransform:'uppercase', color:'var(--teal)' }}>Simulacro</span>
          <span style={{ fontSize:12, color:'var(--muted)', marginLeft:'auto' }}>{qc.title}</span>
        </div>
        <div style={{ padding:14 }}>
          <QuizBlock quiz={qc.questions} deferCorrection={true} />
        </div>
      </div>
    )
  }
  if (a.type === 'illustration' && a.url) return (
    <div style={{ marginTop:8 }}>
      <img src={a.url} alt="LINGORA visual" style={{ maxWidth:'100%', borderRadius:14, display:'block', border:'1px solid var(--border)' }} />
      <a href={a.url} download target="_blank" rel="noopener" style={{ display:'inline-block', marginTop:5, fontSize:12, color:'var(--teal)', fontWeight:700 }}>↓ Descargar imagen</a>
    </div>
  )
  if (a.type === 'pdf' && a.url) return (
    <a href={a.url} download="lingora.pdf" target="_blank" rel="noopener" style={{ display:'inline-flex', alignItems:'center', gap:6, marginTop:6, padding:'9px 13px', borderRadius:10, textDecoration:'none', background:'rgba(245,200,66,.1)', border:'1px solid rgba(245,200,66,.22)', color:'var(--gold)', fontSize:13, fontWeight:700 }}>📄 Descargar PDF</a>
  )
  if (a.type === 'audio' && a.url) return <audio controls src={a.url} style={{ marginTop:8, width:'100%', borderRadius:10 }} />
  return null
}

function Bubble({ msg, mc }: { msg: Msg; mc: string }) {
  const isUser = msg.sender === 'user'
  return (
    <div style={{ display:'flex', alignItems:'flex-end', gap:8, maxWidth:'88%', ...(isUser?{flexDirection:'row-reverse',marginLeft:'auto'}:{}) }}>
      <div style={{ width:28, height:28, borderRadius:'50%', display:'flex', alignItems:'center', justifyContent:'center', fontSize:11, fontWeight:700, flexShrink:0, background: isUser ? 'var(--teal)' : mc, color:'#fff' }}>
        {isUser ? 'YOU' : msg.sender.toUpperCase().slice(0,2)}
      </div>
      <div style={{ display:'flex', flexDirection:'column', gap:6, maxWidth:'100%' }}>
        <div style={{ padding:'10px 14px', borderRadius:16, fontSize:14, lineHeight:1.6, ...(isUser ? { background:'var(--teal)', color:'var(--navy)', fontWeight:500, borderBottomRightRadius:4 } : { background:'var(--navy2)', border:'1px solid var(--border)', color:'var(--silver)', borderBottomLeftRadius:4 }) }}
          dangerouslySetInnerHTML={{ __html: fmt(msg.text || '') }} />
        {msg.artifact && <ArtifactRender a={msg.artifact} />}
        {msg.score !== undefined && <div style={{ fontSize:12, color:'var(--gold)', fontWeight:700 }}>Puntuación: {msg.score}/10</div>}
      </div>
    </div>
  )
}

function Typing({ mc }: { mc: string }) {
  return (
    <div style={{ display:'flex', alignItems:'flex-end', gap:8, maxWidth:'88%' }}>
      <div style={{ width:28, height:28, borderRadius:'50%', background:mc, display:'flex', alignItems:'center', justifyContent:'center', fontSize:11, fontWeight:700, color:'#fff' }}>LN</div>
      <div style={{ padding:'10px 14px', background:'var(--navy2)', border:'1px solid var(--border)', borderRadius:16, borderBottomLeftRadius:4, display:'flex', gap:4, alignItems:'center' }}>
        {[0,150,300].map(d => <span key={d} style={{ width:5, height:5, borderRadius:'50%', background:'var(--teal)', display:'inline-block', animation:`tdot 1.2s ${d}ms infinite` }} />)}
      </div>
    </div>
  )
}

// ─── Export helpers ───────────────────────────────
function doExportTxt(msgs: Msg[]) {
  const ts = new Date().toISOString().slice(0,10)
  const lines = [`LINGORA Chat Export — ${ts}`, '─'.repeat(42), '', ...msgs.map(m => `[${m.sender.toUpperCase()}]  ${m.text}`), '']
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([lines.join('\n')],{type:'text/plain'})); a.download = `lingora-${ts}.txt`; a.click()
}

function doExportPdf(msgs: Msg[], ss_: SS) {
  const ts = new Date().toLocaleString()
  const rows = msgs.map(m => {
    const who = m.sender === 'user' ? 'You' : m.sender.charAt(0).toUpperCase() + m.sender.slice(1)
    const bg = m.sender === 'user' ? '#e0fdf4' : '#f1f5f9'
    return `<div style="margin:8px 0;padding:10px 14px;border-radius:10px;background:${bg};font-size:13px;line-height:1.6"><strong>${who}:</strong><br>${m.text.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</div>`
  }).join('')
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>LINGORA</title><style>body{font-family:sans-serif;max-width:680px;margin:0 auto;padding:20px}h1{font-size:20px;color:#0d1828}p.meta{font-size:11px;color:#888;margin-bottom:16px;border-bottom:1px solid #eee;padding-bottom:10px}@media print{body{padding:10px}}</style></head><body><h1>LINGORA · Chat Export</h1><p class="meta">${ts} · Nivel: ${ss_.level} · Tokens: ${ss_.tokens} · Mentor: ${ss_.mentor}</p>${rows}</body></html>`
  const w = window.open('','_blank'); if (!w) return; w.document.write(html); w.document.close(); w.focus(); setTimeout(() => { w.print(); w.close() }, 400)
}

// ─── Main ─────────────────────────────────────────
export default function BetaPage() {
  const [phase,      setPhase]      = useState<Phase>('onboarding')
  const [splashMsg,  setSplashMsg]  = useState('')
  const [splashRev,  setSplashRev]  = useState(false)
  const [lang,       setLang]       = useState<Lang>('en')
  const [mentor,     setMentor]     = useState<MK>('sarah')
  const [topic,      setTopic]      = useState<TK>('conversation')
  const [msgs,       setMsgs]       = useState<Msg[]>([])
  const [input,      setInput]      = useState('')
  const [loading,    setLoading]    = useState(false)
  const [recording,  setRecording]  = useState(false)
  const [showExport, setShowExport] = useState(false)

  const [session, setSession] = useState<SS>({
    lang: 'en', mentor: 'sarah', topic: 'conversation',
    level: 'A0', tokens: 0, samples: [],
    sessionId: 's'+Math.random().toString(36).slice(2),
    commercialOffers: [], lastTask: null, lastArtifact: null,
  })

  const sessionRef  = useRef<SS>(session)
  const mentorRef   = useRef<MK>(mentor)
  const langRef     = useRef<Lang>(lang)
  const topicRef    = useRef<TK>(topic)
  const msgsEndRef  = useRef<HTMLDivElement>(null)
  const taRef       = useRef<HTMLTextAreaElement>(null)
  const mrRef       = useRef<MediaRecorder|null>(null)
  const chunksRef   = useRef<Blob[]>([])

  const mm = useMemo(() => MENTOR_META[mentor], [mentor])
  const copy = useMemo(() => COPY[lang] ?? COPY.en, [lang])

  useEffect(() => { sessionRef.current = session }, [session])
  useEffect(() => { mentorRef.current = mentor },   [mentor])
  useEffect(() => { langRef.current   = lang },     [lang])
  useEffect(() => { topicRef.current  = topic },    [topic])
  useEffect(() => { msgsEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [msgs, loading])

  // Persist
  useEffect(() => {
    try { const sv = localStorage.getItem('lng1010'); if (sv) { const p = JSON.parse(sv) as Partial<SS>; setSession(s => ({...s,...p,sessionId:'s'+Math.random().toString(36).slice(2)})); if (p.lang) setLang(p.lang); if (p.mentor) setMentor(p.mentor as MK); if (p.topic) setTopic(p.topic as TK) } } catch {}
  }, [])
  useEffect(() => { try { localStorage.setItem('lng1010', JSON.stringify(session)) } catch {} }, [session])

  const addMsg = useCallback((m: Omit<Msg,'id'>) => {
    setMsgs(prev => [...prev, { ...m, id: Date.now()+'-'+Math.random().toString(36).slice(2) }])
  }, [])

  // Core API call
  const callAPI = useCallback(async (payload: Record<string, unknown>) => {
    setLoading(true)
    try {
      const ctrl = new AbortController()
      const to = setTimeout(() => ctrl.abort(), 25000)
      const res = await fetch('/api/chat', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ ...payload, state: { ...sessionRef.current, mentor: mentorRef.current, lang: langRef.current, topic: topicRef.current, activeMentor: mentorRef.current, topicSystemPrompt: TSYS[topicRef.current] } }), signal: ctrl.signal })
      clearTimeout(to)
      const data = await res.json()
      if (data.state) setSession(s => { const n = {...s,...data.state,samples:s.samples,sessionId:s.sessionId}; sessionRef.current = n; return n })
      if (data.diagnostic) { addMsg({ sender:'ln', text:'```\n'+JSON.stringify(data.diagnostic,null,2)+'\n```' }); return }
      const text: string = data.reply ?? data.message ?? data.content ?? ''
      if (!text && !data.artifact) { addMsg({ sender:'ln', text:'No se recibió respuesta. Intenta de nuevo.' }); return }
      // Token count comes from server state — do NOT increment here
      // route.ts is the authoritative source to avoid double counting
      addMsg({ sender: mentorRef.current, text: text || 'Material listo:', artifact: data.artifact ?? null, score: data.pronunciationScore })
    } catch (e) {
      const m = e instanceof Error ? e.message : ''
      addMsg({ sender:'ln', text: m.includes('abort') ? 'El tutor tardó demasiado. Intenta de nuevo.' : 'Error de conexión. Intenta de nuevo.' })
    } finally { setLoading(false) }
  }, [addMsg])

  const sendText = useCallback(async () => {
    const msg = input.trim(); if (!msg || loading) return
    setInput(''); if (taRef.current) taRef.current.style.height = 'auto'
    addMsg({ sender:'user', text: msg })
    setSession(s => { const n = {...s, samples:[...s.samples,msg]}; sessionRef.current = n; return n })
    await callAPI({ message: msg })
  }, [input, loading, addMsg, callAPI])

  // Splash + start chat
  const startChat = useCallback((m: MK, t: TK, l: Lang) => {
    setMentor(m); setTopic(t); setLang(l)
    mentorRef.current = m; topicRef.current = t; langRef.current = l
    setSession(s => { const n = {...s, mentor:m, topic:t, lang:l}; sessionRef.current = n; return n })
    const c = COPY[l] ?? COPY.en
    setSplashMsg(c.lnw)
    setSplashRev(false)
    setPhase('splash')

    // 1800ms: reveal mentor
    setTimeout(() => { setSplashRev(true) }, 1800)
    // 3600ms: enter chat
    setTimeout(() => {
      setPhase('chat')
      const greeting = GREETINGS[m][l] ?? GREETINGS[m].en ?? GREETINGS[m].es ?? ''
      setMsgs([{ id:'init', sender:m, text: greeting }])
    }, 3600)
  }, [])

  // Voice
  const toggleRec = useCallback(async () => {
    if (recording) { mrRef.current?.stop(); setRecording(false); return }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      chunksRef.current = []
      const rec = new MediaRecorder(stream)
      rec.ondataavailable = e => chunksRef.current.push(e.data)
      rec.onstop = async () => {
        stream.getTracks().forEach(t => t.stop())
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
        const b64 = await new Promise<string>(res => { const r = new FileReader(); r.onload = () => res((r.result as string).split(',')[1]||''); r.readAsDataURL(blob) })
        addMsg({ sender:'user', text:'🎤 Audio enviado' })
        await callAPI({ audio: { data: b64, format: 'webm' } })
      }
      rec.start(); mrRef.current = rec; setRecording(true)
    } catch (e) { addMsg({ sender:'ln', text:`Micrófono no disponible: ${e instanceof Error ? e.message : String(e)}` }) }
  }, [recording, addMsg, callAPI])

  const handleFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return
    const r = new FileReader()
    r.onload = async () => { const b64 = (r.result as string).split(',')[1]||''; addMsg({ sender:'user', text:`📎 ${f.name}` }); await callAPI({ files: [{ name:f.name, type:f.type, data:b64, size:f.size }] }) }
    r.readAsDataURL(f); e.target.value = ''
  }, [addMsg, callAPI])

  // ─── Render ──────────────────────────────────────
  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=DM+Sans:wght@300;400;500;600;700;800&display=swap');
        :root {
          --navy:#080f1f; --navy2:#0d1828; --navy3:#132035;
          --teal:#00c9a7; --coral:#ff6b6b; --gold:#f5c842;
          --silver:rgba(255,255,255,.88); --muted:rgba(255,255,255,.50);
          --dim:rgba(255,255,255,.22); --border:rgba(255,255,255,.08); --card:rgba(255,255,255,.04);
        }
        *, *::before, *::after { box-sizing:border-box; margin:0; padding:0 }
        html, body { height:100%; overflow:hidden }
        body { font-family:'DM Sans',system-ui,sans-serif; background:radial-gradient(circle at top,#0a1730 0%,#081120 55%,#050b15 100%); color:var(--silver); }
        @keyframes tdot { 0%,60%,100%{opacity:.3;transform:translateY(0)} 30%{opacity:1;transform:translateY(-4px)} }
        @keyframes fadeUp { from{opacity:0;transform:translateY(16px)} to{opacity:1;transform:translateY(0)} }
        @keyframes fadeIn { from{opacity:0} to{opacity:1} }
        @keyframes pulse { 0%,100%{opacity:.6} 50%{opacity:1} }
        .fade-up { animation: fadeUp .5s cubic-bezier(.22,1,.36,1) both }
        ::-webkit-scrollbar { width:5px } ::-webkit-scrollbar-thumb { background:var(--border); border-radius:999px }
        textarea:focus, button:focus, input:focus, select:focus { outline:none }
      `}</style>

      {/* ── ONBOARDING ─────────────────────────────── */}
      {phase === 'onboarding' && (
        <div style={{ position:'fixed', inset:0, overflowY:'auto', display:'flex', justifyContent:'center', padding:'32px 20px 48px' }}>
          <div style={{ width:'100%', maxWidth:620, animation:'fadeIn .4s ease both' }}>

            {/* Logo */}
            <div style={{ textAlign:'center', marginBottom:32, paddingTop:8 }}>
              <div style={{ fontFamily:'"DM Serif Display",serif', fontSize:'clamp(2.5rem,6vw,3.8rem)', fontWeight:400, letterSpacing:'-.03em', background:'linear-gradient(135deg,#fff 38%,var(--teal))', WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent', marginBottom:8 }}>
                LINGORA
              </div>
              <div style={{ fontSize:13, color:'var(--muted)', letterSpacing:'.04em' }}>{copy.tg}</div>
            </div>

            <div style={{ background:'rgba(255,255,255,.03)', border:'1px solid var(--border)', borderRadius:24, padding:'28px 24px', display:'flex', flexDirection:'column', gap:28 }}>

              {/* Step 1: Language grid */}
              <div>
                <div style={{ fontSize:11, fontWeight:800, letterSpacing:'.1em', textTransform:'uppercase', color:'var(--teal)', marginBottom:14 }}>{copy.l1}</div>
                <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(100px,1fr))', gap:8 }}>
                  {LANG_GRID.map(l => (
                    <button key={l.value} onClick={() => setLang(l.value)}
                      style={{ background: lang === l.value ? 'rgba(0,201,167,.12)' : 'var(--card)', border:`1px solid ${lang===l.value?'var(--teal)':'var(--border)'}`, borderRadius:12, padding:'12px 8px', cursor:'pointer', textAlign:'center', transition:'all .18s', boxShadow: lang===l.value?'0 0 0 1px var(--teal) inset':'none' }}>
                      <div style={{ fontSize:22, marginBottom:4 }}>{l.flag}</div>
                      <div style={{ fontSize:12, fontWeight:700, color: lang===l.value ? 'var(--teal)' : '#fff' }}>{l.label}</div>
                      <div style={{ fontSize:10, color:'var(--dim)' }}>{l.sub}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Step 2: Topics */}
              <div>
                <div style={{ fontSize:11, fontWeight:800, letterSpacing:'.1em', textTransform:'uppercase', color:'var(--teal)', marginBottom:14 }}>{copy.l2}</div>
                <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                  {TOPIC_KEYS.map((tk, i) => (
                    <button key={tk} onClick={() => setTopic(tk)}
                      style={{ background: topic===tk ? 'rgba(0,201,167,.08)' : 'var(--card)', border:`1px solid ${topic===tk?'var(--teal)':'var(--border)'}`, borderRadius:14, padding:'14px 16px', cursor:'pointer', display:'flex', alignItems:'center', gap:14, transition:'all .18s', textAlign:'left' }}>
                      <span style={{ fontSize:22, flexShrink:0 }}>{TOPIC_META[tk].emoji}</span>
                      <div>
                        <div style={{ fontWeight:700, fontSize:14, color: topic===tk ? 'var(--teal)' : '#fff', marginBottom:2 }}>{copy.tn[i]}</div>
                        <div style={{ fontSize:12, color:'var(--muted)' }}>{copy.td[i]}</div>
                      </div>
                      {topic===tk && <span style={{ marginLeft:'auto', color:'var(--teal)', fontSize:16 }}>✓</span>}
                    </button>
                  ))}
                </div>
              </div>

              {/* Step 3: Mentors */}
              <div>
                <div style={{ fontSize:11, fontWeight:800, letterSpacing:'.1em', textTransform:'uppercase', color:'var(--teal)', marginBottom:14 }}>{copy.l3}</div>
                <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:10 }}>
                  {MENTOR_KEYS.map((mk, i) => {
                    const m = MENTOR_META[mk]; const sel = mentor === mk
                    return (
                      <button key={mk} onClick={() => setMentor(mk)}
                        style={{ background: sel ? m.bg : 'var(--card)', border:`2px solid ${sel?m.color:'var(--border)'}`, borderRadius:18, padding:'18px 12px', cursor:'pointer', textAlign:'left', transition:'all .2s', boxShadow: sel ? `0 0 0 1px ${m.color}22, 0 6px 20px ${m.color}18` : 'none' }}>
                        <div style={{ fontSize:26, marginBottom:8 }}>{m.emoji}</div>
                        <div style={{ fontSize:10, fontWeight:800, letterSpacing:'.1em', textTransform:'uppercase', color: sel ? m.color : 'var(--dim)', marginBottom:3 }}>{m.code}</div>
                        <div style={{ fontWeight:800, fontSize:14, color:'#fff', marginBottom:4 }}>{m.name}</div>
                        <div style={{ fontSize:11, color:'var(--muted)', lineHeight:1.45 }}>{copy.md[i]}</div>
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Start button */}
              <button onClick={() => startChat(mentor, topic, lang)} disabled={!lang || !topic || !mentor}
                style={{ background:'var(--teal)', color:'var(--navy)', fontWeight:800, fontSize:16, padding:15, borderRadius:999, border:'none', cursor:'pointer', transition:'all .2s', opacity: (!lang||!topic||!mentor) ? .5 : 1 }}>
                {copy.sb}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── SPLASH ─────────────────────────────────── */}
      {phase === 'splash' && (
        <div style={{ position:'fixed', inset:0, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:'2rem', animation:'fadeIn .4s ease both' }}>
          {/* LN identity */}
          <div style={{ marginBottom:28, display:'flex', flexDirection:'column', alignItems:'center', gap:12 }}>
            <div style={{ width:64, height:64, borderRadius:'50%', background:'linear-gradient(135deg,var(--teal),#0891b2)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:11, fontWeight:800, color:'var(--navy)', letterSpacing:'.05em', boxShadow:'0 0 32px rgba(0,201,167,.3)' }}>LN</div>
            <div style={{ fontFamily:'"DM Serif Display",serif', fontSize:22, color:'#fff', fontWeight:400 }}>LINGORA</div>
          </div>
          <p style={{ fontSize:16, color:'var(--muted)', textAlign:'center', maxWidth:400, lineHeight:1.7, marginBottom:40 }}>{splashMsg}</p>

          {/* Mentor reveal */}
          {splashRev && (
            <div style={{ animation:'fadeUp .5s ease both', textAlign:'center', display:'flex', flexDirection:'column', alignItems:'center', gap:10 }}>
              <div style={{ width:72, height:72, borderRadius:'50%', background:mm.bg, border:`2px solid ${mm.color}`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:28, boxShadow:`0 0 28px ${mm.color}44` }}>
                {mm.emoji}
              </div>
              <div style={{ fontSize:11, fontWeight:800, letterSpacing:'.1em', textTransform:'uppercase', color:mm.color }}>{mm.code} · LINGORA</div>
              <div style={{ fontFamily:'"DM Serif Display",serif', fontSize:24, color:'#fff' }}>{mm.name}</div>
              <div style={{ fontSize:13, color:'var(--muted)', maxWidth:300, lineHeight:1.6 }}>
                {copy.bio[MENTOR_KEYS.indexOf(mentor)] ?? mm.spec}
              </div>
            </div>
          )}

          {/* Animated dots */}
          <div style={{ position:'absolute', bottom:40, display:'flex', gap:6 }}>
            {[0,200,400].map(d => <span key={d} style={{ width:6, height:6, borderRadius:'50%', background:'var(--teal)', display:'inline-block', animation:`pulse 1.4s ${d}ms infinite` }} />)}
          </div>
        </div>
      )}

      {/* ── CHAT ───────────────────────────────────── */}
      {phase === 'chat' && (
        <div style={{ display:'flex', flexDirection:'column', height:'100dvh', maxWidth:760, margin:'0 auto' }}>

          {/* Header */}
          <div style={{ padding:'13px 18px', background:'rgba(8,17,32,.86)', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center', gap:12, flexShrink:0, backdropFilter:'blur(12px)' }}>
            <div style={{ width:42, height:42, borderRadius:'50%', background:mm.bg, border:`1.5px solid ${mm.color}44`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:18, flexShrink:0 }}>{mm.emoji}</div>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontWeight:800, fontSize:15, color:'#fff', display:'flex', alignItems:'center', gap:6 }}>
                {mm.name}
                <span style={{ fontSize:10, fontWeight:700, padding:'2px 7px', borderRadius:999, background:mm.bg, color:mm.color, border:`1px solid ${mm.color}33` }}>{mm.code}</span>
              </div>
              <div style={{ fontSize:11, color:'var(--muted)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                {copy.tn[TOPIC_KEYS.indexOf(topic)]} · LINGORA
              </div>
            </div>
            <div style={{ display:'flex', gap:5, alignItems:'center', flexWrap:'wrap' }}>
              <Badge>{session.level}</Badge>
              <Badge t="gold">{session.tokens}</Badge>

              {/* Export dropdown */}
              <div style={{ position:'relative' }}>
                <button onClick={() => setShowExport(v => !v)} style={{ fontSize:11, padding:'5px 10px', borderRadius:999, border:'1px solid var(--border)', background:'none', color:'var(--muted)', cursor:'pointer' }}>📋 ▾</button>
                {showExport && (
                  <div style={{ position:'absolute', top:'115%', right:0, background:'var(--navy2)', border:'1px solid var(--border)', borderRadius:12, padding:'5px 0', zIndex:50, minWidth:160, boxShadow:'0 8px 24px rgba(0,0,0,.45)' }}
                    onMouseLeave={() => setShowExport(false)}>
                    <button onClick={() => { doExportTxt(msgs); setShowExport(false) }} style={{ display:'block', width:'100%', textAlign:'left', padding:'9px 16px', background:'none', border:'none', color:'var(--silver)', fontSize:13, cursor:'pointer', fontWeight:600 }}>📄 Exportar TXT</button>
                    <button onClick={() => { doExportPdf(msgs, session); setShowExport(false) }} style={{ display:'block', width:'100%', textAlign:'left', padding:'9px 16px', background:'none', border:'none', color:'var(--silver)', fontSize:13, cursor:'pointer', fontWeight:600 }}>🖨️ Exportar PDF</button>
                  </div>
                )}
              </div>

              <button onClick={() => { setMsgs([]); setSession(s => ({...s,tokens:0,level:'A0',samples:[],lastTask:null,lastArtifact:null})); setPhase('onboarding') }} style={{ fontSize:11, padding:'5px 10px', borderRadius:999, border:'1px solid var(--border)', background:'none', color:'var(--muted)', cursor:'pointer' }}>↺</button>
            </div>
          </div>

          {/* Messages */}
          <div style={{ flex:1, overflowY:'auto', padding:'20px 16px', display:'flex', flexDirection:'column', gap:14 }} onClick={() => showExport && setShowExport(false)}>
            {msgs.map(m => <Bubble key={m.id} msg={m} mc={mm.color} />)}
            {loading && <Typing mc={mm.color} />}
            <div ref={msgsEndRef} />
          </div>

          {/* Hint */}
          <div style={{ textAlign:'center', fontSize:11, color:'var(--dim)', padding:'3px 0', flexShrink:0 }}>{copy.hint}</div>

          {/* Input bar */}
          <div style={{ padding:'9px 12px 13px', borderTop:'1px solid var(--border)', display:'flex', alignItems:'flex-end', gap:8, background:'rgba(8,17,32,.9)', backdropFilter:'blur(10px)', flexShrink:0 }}>
            <button onClick={toggleRec} title={recording?'Detener grabación':'Grabar audio'} style={{ width:38, height:38, borderRadius:'50%', border:`1px solid ${recording?'var(--coral)':'var(--border)'}`, background: recording?'rgba(255,107,107,.1)':'transparent', color: recording?'var(--coral)':'var(--muted)', fontSize:15, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, transition:'all .2s' }}>🎤</button>
            <label title="Adjuntar archivo" style={{ width:38, height:38, borderRadius:'50%', border:'1px solid var(--border)', background:'transparent', color:'var(--muted)', fontSize:15, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
              📎<input type="file" accept="image/*,application/pdf,text/*" onChange={handleFile} style={{ display:'none' }} />
            </label>
            <textarea ref={taRef} value={input}
              onChange={e => { setInput(e.target.value); e.target.style.height='auto'; e.target.style.height=Math.min(e.target.scrollHeight,120)+'px' }}
              onKeyDown={e => { if ((e.ctrlKey||e.metaKey) && e.key==='Enter') { e.preventDefault(); void sendText() } }}
              placeholder={copy.ph} rows={1}
              style={{ flex:1, background:'var(--navy2)', border:'1px solid var(--border)', borderRadius:14, padding:'10px 14px', fontSize:14, color:'var(--silver)', resize:'none', maxHeight:120, lineHeight:1.5, fontFamily:'inherit', transition:'border-color .2s' }}
              onFocus={e => e.target.style.borderColor='rgba(0,201,167,.4)'}
              onBlur={e => e.target.style.borderColor='var(--border)'}
            />
            <button onClick={() => void sendText()} disabled={loading || !input.trim()} title="Enviar" style={{ width:38, height:38, borderRadius:'50%', background: loading||!input.trim()?'var(--navy3)':'var(--teal)', color: loading||!input.trim()?'var(--muted)':'var(--navy)', border:'none', fontSize:16, cursor: loading||!input.trim()?'default':'pointer', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, transition:'all .2s' }}>▶</button>
          </div>
        </div>
      )}
    </>
  )
}

