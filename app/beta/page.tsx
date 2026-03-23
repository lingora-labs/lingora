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

import React, { useState, useRef, useEffect, useCallback, useMemo, type ReactNode, type ChangeEvent } from 'react'

// ─── Types ───────────────────────────────────────
type MK = 'sarah' | 'alex' | 'nick'
type TK = 'conversation' | 'structured' | 'cervantes' | 'business' | 'travel' | 'course' | 'leveltest'
type Lang = 'es' | 'en' | 'no' | 'fr' | 'de' | 'it' | 'pt' | 'ar' | 'ja' | 'zh'
type Phase = 'onboarding' | 'splash' | 'mode' | 'chat'

interface Artifact {
  type: 'schema' | 'quiz' | 'table' | 'table_matrix' | 'schema_pro' |
        'illustration' | 'pdf' | 'course_pdf' | 'pdf_chat' | 'audio' |
        'pronunciation_report' | 'simulacro_result' | 'audio_transcript' |
        'roadmap' | 'score_report' | 'lesson_module' | 'pdf_assignment' | 'submission_feedback'
  url?: string
  content?: Record<string, unknown>
  metadata?: Record<string, unknown>
}

interface Msg {
  id: string; sender: 'user' | MK | 'ln'; text: string
  artifact?: Artifact | null; score?: number
  audioUrl?: string   // post-send audio playback URL
  imageUrl?: string   // inline image from user upload
  suggestedActions?: SuggestedAction[]
}
type ActiveMode = 'interact' | 'structured' | 'pdf_course' | 'free'

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
  // Sprint 2.3 guided modes
  activeMode?:     ActiveMode
  learningStage?:  string
  currentModule?:  number
  score?:          number
  pdfCourseActive?: boolean
}
interface TableRow { left: string; right: string }
interface QuizQ    { question: string; options: string[]; correct: number; explanation?: string }
interface Sub      { title: string; content: string; keyTakeaway?: string }
interface Norm {
  title: string; objective: string; block: string; keyConcepts: string[]
  subtopics: Sub[]; quiz: QuizQ[]; tableRows: TableRow[]
  summary: string; examples: string[]; errors: string[]
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
    es: '¡Hola! Soy Sarah. Ya sé que quieres trabajar en este tema — empecemos. ¿Qué sabes ya sobre el español?',
    en: "Hi, I'm Sarah. You've chosen your topic — let's get started. What do you already know about Spanish?",
    no: 'Hei! Jeg er Sarah. Du har valgt ditt tema — la oss begynne. Hva vet du allerede om spansk?',
    fr: "Bonjour ! Je suis Sarah. Vous avez choisi votre sujet — commençons. Que savez-vous déjà de l'espagnol?",
    de: 'Hallo! Ich bin Sarah. Du hast dein Thema gewählt — fangen wir an. Was weißt du schon über Spanisch?',
    it: 'Ciao! Sono Sarah. Hai scelto il tuo argomento — iniziamo. Cosa sai già dello spagnolo?',
    pt: 'Olá! Sou Sarah. Você escolheu seu tema — vamos começar. O que você já sabe sobre o espanhol?',
    ar: 'مرحباً! أنا سارة. لقد اخترت موضوعك — لنبدأ. ماذا تعرف بالفعل عن الإسبانية؟',
    ja: 'こんにちは！サラです。テーマを選びましたね — 始めましょう。スペイン語について何を知っていますか？',
    zh: '你好！我是Sarah。你已经选好主题了 — 开始吧。你对西班牙语已经了解多少？',
  },
  alex: {
    es: '¡Hola! Soy Alex. Perfecto, ya tenemos el tema. ¿Has tenido alguna experiencia práctica con el español antes?',
    en: "Hey, I'm Alex. Topic set — let's dive in. Have you had any real experience with Spanish before?",
    no: 'Hei! Jeg er Alex. Tema valgt — la oss dykke inn. Har du hatt noen praktisk erfaring med spansk?',
    fr: "Salut ! Je suis Alex. Sujet choisi — plongeons-y. Avez-vous déjà eu une expérience pratique avec l'espagnol?",
    de: 'Hey! Ich bin Alex. Thema steht — los geht es. Hast du schon praktische Erfahrung mit Spanisch?',
    it: "Ciao! Sono Alex. Argomento scelto — iniziamo. Hai già avuto qualche esperienza pratica con lo spagnolo?",
    pt: 'Ei! Sou Alex. Tema escolhido — vamos lá. Você já teve alguma experiência prática com o espanhol?',
    ar: 'مرحباً! أنا أليكس. تم اختيار الموضوع — لنبدأ. هل لديك أي خبرة عملية سابقة في الإسبانية؟',
    ja: 'こんにちは！アレックスです。テーマ決定 — 始めましょう。スペイン語の実践経験はありますか？',
    zh: '嘿！我是Alex。主题已定 — 开始吧。你以前有西班牙语实践经验吗？',
  },
  nick: {
    es: '¡Hola! Soy Nick. Bien, ya tenemos el tema. ¿Qué situación concreta te gustaría practicar primero?',
    en: "Hi, I'm Nick. Good — topic is set. What specific situation would you like to practice first?",
    no: 'Hei! Jeg er Nick. Bra — tema er satt. Hvilken konkret situasjon vil du øve på først?',
    fr: 'Bonjour ! Je suis Nick. Bien — sujet défini. Quelle situation concrète souhaitez-vous pratiquer en premier?',
    de: 'Hallo! Ich bin Nick. Gut — Thema steht. Welche konkrete Situation möchtest du zuerst üben?',
    it: 'Ciao! Sono Nick. Bene — argomento definito. Quale situazione concreta vorresti esercitare prima?',
    pt: 'Olá! Sou Nick. Certo — tema definido. Que situação concreta você gostaria de praticar primeiro?',
    ar: 'مرحباً! أنا نيك. جيد — الموضوع محدد. ما الموقف المحدد الذي تريد التدرب عليه أولاً؟',
    ja: 'こんにちは！ニックです。テーマ確定 — まず最初にどんな具体的な場面を練習しますか？',
    zh: '你好！我是Nick。好的 — 主题已定。你想先练习什么具体场景？',
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
  const errors: string[] = Array.isArray(r.errors) ? r.errors.map(ss).filter(Boolean) : []
  return { title: ss(r.title) || 'LINGORA Schema', objective: ss(r.objective), block: ss(r.block) || 'LINGORA', keyConcepts: sa(r.keyConcepts), subtopics, quiz, tableRows, summary: ss(r.summary) || ss(r.globalTakeaway) || ss(r.keyTakeaway), examples: sa(r.examples), errors }
}

// Full markdown renderer — produces React-compatible HTML string
// Supports: headers, bold, italic, code, inline-code, tables, ordered/unordered lists
// No dangerouslySetInnerHTML risk: output is sanitized before all markdown parsing
function fmt(t: string): string {
  if (!t) return ''

  // 1. Sanitize first (before any HTML injection point)
  let s = t
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

  // 2. Markdown tables  |col|col|\n|---|---|\n|cell|cell|
  s = s.replace(
    /\|(.+)\|\n\|([-| :]+)\|\n((?:\|.+\|\n?)+)/g,
    (_match, header, _sep, body) => {
      const ths = header.split('|').filter((c: string) => c.trim())
        .map((h: string) => `<th style="padding:6px 10px;text-align:left;font-size:11px;font-weight:800;color:var(--teal);letter-spacing:.06em;text-transform:uppercase;border-bottom:1px solid rgba(0,201,167,.2);white-space:nowrap">${h.trim()}</th>`).join('')
      const trs = body.trim().split('\n').map((row: string) => {
        const cells = row.split('|').filter((c: string) => c !== undefined && row.includes('|'))
          .filter((_: string, i: number, arr: string[]) => i > 0 && i < arr.length)
          .map((c: string) => `<td style="padding:7px 10px;color:var(--silver);border-bottom:1px solid rgba(255,255,255,.04)">${c.trim()}</td>`).join('')
        return `<tr>${cells}</tr>`
      }).join('')
      return `<div style="overflow-x:auto;margin:8px 0"><table style="width:100%;border-collapse:collapse;font-size:13px;background:rgba(255,255,255,.02);border-radius:10px;overflow:hidden"><thead><tr>${ths}</tr></thead><tbody>${trs}</tbody></table></div>`
    }
  )

  // 3. Headers (### ## #)
  s = s.replace(/^### (.+)$/gm, '<div style="font-size:13px;font-weight:800;color:var(--teal);margin:10px 0 4px;letter-spacing:.04em;text-transform:uppercase">$1</div>')
  s = s.replace(/^## (.+)$/gm,  '<div style="font-size:15px;font-weight:800;color:#fff;margin:12px 0 6px">$1</div>')
  s = s.replace(/^# (.+)$/gm,   '<div style="font-size:17px;font-weight:800;color:#fff;margin:14px 0 8px">$1</div>')

  // 4. Unordered lists — group consecutive - lines
  s = s.replace(/((?:^- .+\n?)+)/gm, (block) => {
    const items = block.trim().split('\n')
      .map((line: string) => `<li style="margin:3px 0;color:var(--silver)">${line.replace(/^- /, '')}</li>`).join('')
    return `<ul style="margin:6px 0 6px 16px;padding:0;list-style:none">${items}</ul>`
  })

  // 5. Ordered lists — group consecutive N. lines
  s = s.replace(/((?:^\d+\. .+\n?)+)/gm, (block) => {
    let n = 0
    const items = block.trim().split('\n')
      .map((line: string) => { n++; return `<li style="margin:3px 0;color:var(--silver)"><span style="color:var(--teal);font-weight:700;margin-right:6px">${n}.</span>${line.replace(/^\d+\. /, '')}</li>` }).join('')
    return `<ol style="margin:6px 0 6px 8px;padding:0;list-style:none">${items}</ol>`
  })

  // 6. Inline: bold, italic, inline code
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong style="color:#fff;font-weight:700">$1</strong>')
  s = s.replace(/\*(.+?)\*/g,     '<em style="color:var(--silver);font-style:italic">$1</em>')
  s = s.replace(/`(.+?)`/g,       '<code style="background:rgba(0,0,0,.4);padding:1px 6px;border-radius:4px;font-family:monospace;font-size:.86em;color:#7dd3fc">$1</code>')

  // 7. Horizontal rules
  s = s.replace(/^---+$/gm, '<hr style="border:none;border-top:1px solid var(--border);margin:10px 0">')

  // 8. Line breaks (last — after all block-level replacements)
  s = s.replace(/\n/g, '<br>')

  return s
}

// ─── Design tokens ────────────────────────────────

// ─── Sub-components ───────────────────────────────
function Badge({ children, t = 'd' }: { children: ReactNode; t?: 'd'|'teal'|'gold'|'purple'|'coral' }) {
  const s = { d:{ color:'var(--muted)',bg:'var(--card)',br:'1px solid var(--border)'}, teal:{color:'var(--teal)',bg:'rgba(0,201,167,.1)',br:'1px solid rgba(0,201,167,.22)'}, gold:{color:'var(--gold)',bg:'rgba(245,200,66,.1)',br:'1px solid rgba(245,200,66,.22)'}, purple:{color:'#c4b5fd',bg:'rgba(124,58,237,.14)',br:'1px solid rgba(124,58,237,.24)'}, coral:{color:'var(--coral)',bg:'rgba(255,107,107,.1)',br:'1px solid rgba(255,107,107,.22)'} }[t]
  return <span style={{ fontSize:11, padding:'4px 10px', borderRadius:999, fontWeight:700, color:s.color, background:s.bg, border:s.br }}>{children}</span>
}

function SL({ children }: { children: ReactNode }) {
  return <div style={{ fontSize:11, fontWeight:800, letterSpacing:'.1em', textTransform:'uppercase', color:'var(--muted)', marginBottom:10 }}>{children}</div>
}

function TableBlock({ rows }: { rows: TableRow[] }) {
  if (!rows.length) return null
  // Unified: route through TableArtifactBlock — one renderer for all tables
  const content = {
    columns: ['Forma', 'Valor'],
    rows:    rows.map(r => [r.left, r.right]),
    tone:    'comparison' as const,
  }
  return <TableArtifactBlock content={content} />
}

function QuizBlock({ quiz }: { quiz: QuizQ[] }) {
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
                if (done) {
                  // Schema quiz: local scoring is valid (schema generator produces real correct index)
                  const isOk = oi === q.correct
                  if (isOk)           { bg='rgba(0,201,167,.12)'; bc='var(--teal)'; col='var(--teal)' }
                  if (isSel && !isOk) { bg='rgba(255,107,107,.1)'; bc='var(--coral)'; col='var(--coral)' }
                }
                return <button key={oi} disabled={done} onClick={() => setAns(p => ({...p,[qi]:oi}))} style={{ textAlign:'left', padding:'9px 12px', borderRadius:10, border:`1px solid ${bc}`, background:bg, color:col, cursor:done?'default':'pointer', fontSize:13, fontWeight:600 }}>{'ABCD'[oi]}) {opt}</button>
              })}
            </div>
            {done && (
              <div style={{ marginTop:8, fontSize:12, fontWeight:700, display:'flex', flexDirection:'column', gap:4 }}>
                {sel === q.correct
                  ? <span style={{ color:'var(--teal)' }}>✅ Correcto</span>
                  : <span style={{ color:'var(--coral)' }}>❌ Incorrecto — la respuesta correcta es: <strong style={{ color:'#fff' }}>{q.options[q.correct]}</strong></span>
                }
                {(q as QuizQ & { explanation?: string }).explanation && (
                  <span style={{ color:'var(--muted)', fontWeight:400, fontSize:11 }}>
                    {(q as QuizQ & { explanation?: string }).explanation}
                  </span>
                )}
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

        {/* Errores frecuentes — explicit errors[] from schema data takes priority */}
        {(s.errors?.length > 0 || s.keyConcepts.some(c => c.toLowerCase().includes('error'))) && (
          <div style={{ background:'linear-gradient(180deg,rgba(255,107,107,.09),rgba(255,107,107,.04))', border:'1px solid rgba(255,107,107,.22)', borderRadius:14, padding:14 }}>
            <SL>⚠️ Errores frecuentes</SL>
            <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
              {(s.errors?.length > 0
                ? s.errors
                : s.keyConcepts.filter(c => c.toLowerCase().includes('error'))
              ).map((e: string, i: number) => (
                <div key={i} style={{ fontSize:13, color:'var(--coral)', display:'flex', gap:6, alignItems:'flex-start' }}>
                  <span style={{ flexShrink:0 }}>❌</span><span>{e}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Subtopic error detection */}
        {s.subtopics.some(sub => sub.title.toLowerCase().includes('error') || sub.content.toLowerCase().includes('❌')) && (
          <div style={{ background:'rgba(255,107,107,.06)', border:'1px solid rgba(255,107,107,.18)', borderRadius:14, padding:14 }}>
            <SL>⚠️ Errores frecuentes</SL>
            <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
              {s.subtopics.filter(sub => sub.title.toLowerCase().includes('error') || sub.content.toLowerCase().includes('❌')).map((sub,i) => (
                <div key={i}>
                  <div style={{ fontSize:13, fontWeight:700, color:'var(--coral)', marginBottom:3 }}>{sub.title}</div>
                  <div style={{ fontSize:13, color:'var(--silver)', lineHeight:1.5 }}>{sub.content}</div>
                </div>
              ))}
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

function TableArtifactBlock({ content }: { content: Record<string, unknown> }) {
  const c = content as { title?: string; subtitle?: string; columns: string[]; rows: string[][]; tone?: string }
  if (!c.columns?.length || !c.rows?.length) return null

  const toneColors: Record<string, string> = {
    comparison:   '#0891b2',
    conjugation:  '#7c3aed',
    vocabulary:   '#00c9a7',
    exam:         '#d97706',
  }
  const accentColor = toneColors[c.tone ?? 'comparison'] ?? 'var(--teal)'

  return (
    <div style={{ marginTop:10, width:'100%', maxWidth:580, borderRadius:16, overflow:'hidden', border:`1px solid ${accentColor}33`, background:'rgba(255,255,255,.03)' }}>
      {/* Header */}
      {(c.title || c.subtitle) && (
        <div style={{ padding:'10px 14px', borderBottom:`1px solid ${accentColor}22`, background:`${accentColor}0d` }}>
          {c.title   && <div style={{ fontSize:14, fontWeight:800, color:'#fff' }}>{c.title}</div>}
          {c.subtitle && <div style={{ fontSize:12, color:'var(--muted)', marginTop:2 }}>{c.subtitle}</div>}
        </div>
      )}
      {/* Table */}
      <div style={{ overflowX:'auto' }}>
        <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
          <thead>
            <tr style={{ background:`${accentColor}15` }}>
              {c.columns.map((col, i) => (
                <th key={i} style={{ padding:'8px 12px', textAlign:'left', fontWeight:700, color:accentColor, fontSize:11, letterSpacing:'.06em', textTransform:'uppercase', borderBottom:`1px solid ${accentColor}22`, whiteSpace:'nowrap' }}>
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {c.rows.map((row, ri) => (
              <tr key={ri} style={{ borderBottom: ri < c.rows.length - 1 ? '1px solid rgba(255,255,255,.04)' : 'none', background: ri % 2 === 0 ? 'transparent' : 'rgba(255,255,255,.02)' }}>
                {row.map((cell, ci) => (
                  <td key={ci} style={{ padding:'9px 12px', color: ci === 0 ? 'var(--silver)' : 'var(--muted)', fontWeight: ci === 0 ? 600 : 400, verticalAlign:'top' }}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── MatrixTableBlock: rich cells with tone/icon/bold ─
function MatrixTableBlock({ content }: { content: Record<string, unknown> }) {
  type RCell = { text: string; icon?: string; tone?: string; bold?: boolean; align?: string }
  const c = content as { title?: string; subtitle?: string; layout?: string; columns: Array<{key:string;label:string;width?:string}>; rows: RCell[][] }
  if (!c.columns?.length || !c.rows?.length) return null

  const toneStyle: Record<string, { color: string; bg: string }> = {
    ok:      { color: '#00c9a7', bg: 'rgba(0,201,167,.1)' },
    warn:    { color: '#f5c842', bg: 'rgba(245,200,66,.1)' },
    danger:  { color: '#ff6b6b', bg: 'rgba(255,107,107,.1)' },
    info:    { color: '#38bdf8', bg: 'rgba(56,189,248,.1)' },
    neutral: { color: 'var(--silver)', bg: 'transparent' },
  }

  return (
    <div style={{ marginTop:10, width:'100%', maxWidth:620, borderRadius:16, overflow:'hidden', border:'1px solid var(--border)', background:'rgba(255,255,255,.02)' }}>
      {(c.title || c.subtitle) && (
        <div style={{ padding:'10px 14px', borderBottom:'1px solid var(--border)', background:'rgba(255,255,255,.03)' }}>
          {c.title    && <div style={{ fontSize:14, fontWeight:800, color:'#fff' }}>{c.title}</div>}
          {c.subtitle && <div style={{ fontSize:12, color:'var(--muted)', marginTop:2 }}>{c.subtitle}</div>}
        </div>
      )}
      <div style={{ overflowX:'auto' }}>
        <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
          <thead>
            <tr style={{ background:'rgba(255,255,255,.04)' }}>
              {c.columns.map((col, i) => (
                <th key={i} style={{ padding:'8px 12px', textAlign:'left', fontWeight:700, color:'var(--teal)', fontSize:11, letterSpacing:'.06em', textTransform:'uppercase', borderBottom:'1px solid var(--border)', whiteSpace:'nowrap', width: col.width }}>
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {c.rows.map((row, ri) => (
              <tr key={ri} style={{ borderBottom: ri < c.rows.length-1 ? '1px solid rgba(255,255,255,.04)' : 'none', background: ri%2===0?'transparent':'rgba(255,255,255,.015)' }}>
                {row.map((cell, ci) => {
                  const ts = toneStyle[cell.tone ?? 'neutral'] ?? toneStyle.neutral
                  return (
                    <td key={ci} style={{ padding:'9px 12px', color: ts.color, background: ts.bg || 'transparent', fontWeight: cell.bold ? 700 : ci===0 ? 600 : 400, verticalAlign:'top', textAlign: (cell.align as 'left'|'center'|'right') ?? 'left' }}>
                      {cell.icon && <span style={{ marginRight:5 }}>{cell.icon}</span>}
                      {cell.text}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── SchemaProBlock: block-based visual schema ────────
// Uses SchemaBlock discriminated union from contracts.ts — NO unknown casts

// Import-compatible type mirror (contracts.ts types not importable in 'use client' without re-export)
// These mirror SchemaBlock exactly — kept in sync with contracts.ts
type SBConcept    = { type: 'concept';    title: string; body: string; tone?: string }
type SBBullets    = { type: 'bullets';    title: string; items: string[] }
type SBHighlight  = { type: 'highlight';  text: string;  tone?: string; label?: string }
type SBFlow       = { type: 'flow';       steps: string[] }
type SBComparison = { type: 'comparison'; left: string;  right: string; label?: string }
type SBTable      = { type: 'table';      columns: string[]; rows: string[][] }
type SBlock = SBConcept | SBBullets | SBHighlight | SBFlow | SBComparison | SBTable


function renderSBlock(b: SBlock, i: number): ReactNode {
  switch (b.type) {
    case 'concept':
      return (
        <div key={i} style={{ border:'1px solid var(--border)', borderRadius:14, padding:14, background:'rgba(255,255,255,.02)' }}>
          <div style={{ fontSize:13, fontWeight:800, color:'var(--teal)', textTransform:'uppercase', letterSpacing:'.06em', marginBottom:6 }}>{b.title}</div>
          <div style={{ fontSize:14, color:'var(--silver)', lineHeight:1.65 }}>{b.body}</div>
        </div>
      )
    case 'bullets':
      return (
        <div key={i} style={{ border:'1px solid var(--border)', borderRadius:14, padding:14, background:'rgba(255,255,255,.02)' }}>
          <div style={{ fontSize:13, fontWeight:800, color:'var(--muted)', textTransform:'uppercase', letterSpacing:'.06em', marginBottom:8 }}>{b.title}</div>
          <div style={{ display:'flex', flexDirection:'column', gap:5 }}>
            {b.items.map((item, ii) => (
              <div key={ii} style={{ display:'flex', gap:8, alignItems:'flex-start', fontSize:14, color:'var(--silver)' }}>
                <span style={{ color:'var(--teal)', flexShrink:0, marginTop:1 }}>›</span>
                <span>{item}</span>
              </div>
            ))}
          </div>
        </div>
      )
    case 'highlight': {
      const toneMap: Record<string, { bg: string; border: string; color: string; icon: string }> = {
        ok:        { bg:'rgba(0,201,167,.09)',  border:'rgba(0,201,167,.22)',  color:'var(--teal)',  icon:'🧠' },
        warn:      { bg:'rgba(245,200,66,.09)', border:'rgba(245,200,66,.22)', color:'var(--gold)',  icon:'⚠️' },
        danger:    { bg:'rgba(255,107,107,.09)',border:'rgba(255,107,107,.22)',color:'var(--coral)', icon:'❌' },
        info:      { bg:'rgba(56,189,248,.09)', border:'rgba(56,189,248,.22)', color:'#38bdf8',     icon:'💡' },
        highlight: { bg:'rgba(196,181,253,.09)',border:'rgba(196,181,253,.22)',color:'#c4b5fd',     icon:'🎯' },
      }
      const ts = toneMap[b.tone ?? 'ok'] ?? toneMap.ok
      return (
        <div key={i} style={{ background:`linear-gradient(180deg,${ts.bg},${ts.bg.replace('.09','.04')})`, border:`1px solid ${ts.border}`, borderRadius:14, padding:14 }}>
          {b.label && <div style={{ fontSize:11, fontWeight:800, color:ts.color, textTransform:'uppercase', letterSpacing:'.08em', marginBottom:5 }}>{b.label}</div>}
          <div style={{ fontSize:14, color:'#fff', lineHeight:1.6, fontWeight:600 }}>
            {ts.icon} {b.text}
          </div>
        </div>
      )
    }
    case 'comparison':
      return (
        <div key={i} style={{ border:'1px solid var(--border)', borderRadius:14, overflow:'hidden' }}>
          {b.label && <div style={{ padding:'7px 12px', background:'rgba(255,255,255,.03)', fontSize:11, fontWeight:800, color:'var(--muted)', textTransform:'uppercase', letterSpacing:'.06em', borderBottom:'1px solid var(--border)' }}>{b.label}</div>}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr' }}>
            <div style={{ padding:12, borderRight:'1px solid var(--border)' }}>
              <div style={{ fontSize:11, fontWeight:800, color:'var(--teal)', marginBottom:5, textTransform:'uppercase' }}>A</div>
              <div style={{ fontSize:14, color:'var(--silver)' }}>{b.left}</div>
            </div>
            <div style={{ padding:12 }}>
              <div style={{ fontSize:11, fontWeight:800, color:'#c4b5fd', marginBottom:5, textTransform:'uppercase' }}>B</div>
              <div style={{ fontSize:14, color:'var(--silver)' }}>{b.right}</div>
            </div>
          </div>
        </div>
      )
    case 'flow':
      return (
        <div key={i} style={{ display:'flex', flexDirection:'column', gap:0 }}>
          {b.steps.map((step, si) => (
            <div key={si} style={{ display:'flex', gap:10, alignItems:'flex-start' }}>
              <div style={{ display:'flex', flexDirection:'column', alignItems:'center', flexShrink:0 }}>
                <div style={{ width:26, height:26, borderRadius:'50%', background:'rgba(0,201,167,.15)', border:'1px solid var(--teal)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:11, fontWeight:800, color:'var(--teal)' }}>{si+1}</div>
                {si < b.steps.length-1 && <div style={{ width:1, height:16, background:'rgba(0,201,167,.2)', margin:'2px 0' }} />}
              </div>
              <div style={{ paddingTop:4, fontSize:14, color:'var(--silver)', lineHeight:1.5, paddingBottom:si < b.steps.length-1 ? 4 : 0 }}>{step}</div>
            </div>
          ))}
        </div>
      )
    case 'table':
      return <TableArtifactBlock key={i} content={{ columns: b.columns, rows: b.rows, tone: 'vocabulary' }} />
    default:
      return null
  }
}

function isValidSBlock(raw: unknown): raw is SBlock {
  if (!raw || typeof raw !== 'object') return false
  const b = raw as Record<string, unknown>
  return typeof b.type === 'string' &&
    ['concept','bullets','highlight','flow','comparison','table'].includes(b.type)
}

function SchemaProBlock({ content }: { content: Record<string, unknown> }) {
  const rawBlocks = Array.isArray(content.blocks) ? content.blocks : []
  const blocks    = rawBlocks.filter(isValidSBlock)

  if (!blocks.length) return null

  const title    = typeof content.title    === 'string' ? content.title    : 'Schema'
  const subtitle = typeof content.subtitle === 'string' ? content.subtitle : undefined
  const level    = typeof content.level    === 'string' ? content.level    : undefined

  return (
    <div style={{ marginTop:10, width:'100%', maxWidth:580, borderRadius:20, overflow:'hidden', background:'linear-gradient(180deg,rgba(255,255,255,.035),rgba(255,255,255,.018))', border:'1px solid var(--border)', boxShadow:'0 12px 36px rgba(0,0,0,.22)' }}>
      <div style={{ padding:'12px 16px', borderBottom:'1px solid var(--border)', background:'rgba(255,255,255,.02)', display:'flex', alignItems:'center', gap:8 }}>
        <span style={{ fontSize:10, fontWeight:800, letterSpacing:'.1em', textTransform:'uppercase', color:'var(--teal)' }}>Schema Pro</span>
        {level && <span style={{ fontSize:10, padding:'2px 7px', borderRadius:999, background:'rgba(0,201,167,.1)', border:'1px solid rgba(0,201,167,.2)', color:'var(--teal)', marginLeft:'auto' }}>{level}</span>}
      </div>
      <div style={{ padding:16, display:'flex', flexDirection:'column', gap:12 }}>
        <div>
          <div style={{ fontSize:20, fontWeight:800, color:'#fff', lineHeight:1.2, fontFamily:'"DM Serif Display",serif' }}>{title}</div>
          {subtitle && <div style={{ fontSize:13, color:'var(--muted)', marginTop:4 }}>{subtitle}</div>}
        </div>
        {blocks.map((b, i) => renderSBlock(b, i))}
      </div>
    </div>
  )
}


// ─── SuggestedActionBar ───────────────────────────
// Renders interactive next-step buttons after tutor responses.
// Actions are dispatched as synthetic messages to callAPI.
type SuggestedAction = {
  id:      string
  label:   string
  action:  string
  payload?: Record<string, unknown>
  tone?:   'primary' | 'secondary' | 'warning'
  emoji?:  string
}

function SuggestedActionBar({
  actions,
  onAction,
}: {
  actions:  SuggestedAction[]
  onAction: (action: SuggestedAction) => void
}) {
  if (!actions?.length) return null
  const toneStyle = (tone?: string) => {
    if (tone === 'primary')   return { bg: 'rgba(0,201,167,.15)', border: 'rgba(0,201,167,.35)', color: 'var(--teal)' }
    if (tone === 'warning')   return { bg: 'rgba(255,107,107,.1)', border: 'rgba(255,107,107,.3)', color: 'var(--coral)' }
    return { bg: 'rgba(255,255,255,.05)', border: 'var(--border)', color: 'var(--muted)' }
  }
  return (
    <div style={{ display:'flex', flexWrap:'wrap', gap:6, marginTop:8, paddingLeft:36 }}>
      {actions.map(a => {
        const s = toneStyle(a.tone)
        return (
          <button
            key={a.id}
            onClick={() => onAction(a)}
            style={{
              display:'flex', alignItems:'center', gap:5,
              padding:'5px 11px', borderRadius:20,
              border:`1px solid ${s.border}`, background:s.bg,
              color:s.color, fontSize:12, fontWeight:600, cursor:'pointer',
              transition:'all .15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.opacity = '0.85' }}
            onMouseLeave={e => { e.currentTarget.style.opacity = '1' }}
          >
            {a.emoji && <span style={{ fontSize:13 }}>{a.emoji}</span>}
            {a.label}
          </button>
        )
      })}
    </div>
  )
}

// ─── CopyBlock ────────────────────────────────────
// Wraps any structured content with a copy-to-clipboard button.
// Auto-triggers on: markdown tables, code blocks, lists 3+ items, conjugations.
// Never needs to be requested — appears automatically.
function CopyBlock({ text, children }: { text: string; children: React.ReactNode }) {
  const [copied, setCopied] = React.useState(false)
  const copy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    }).catch(() => {})
  }
  return (
    <div style={{ position:'relative', width:'100%' }}>
      {children}
      <button
        onClick={copy}
        title="Copiar"
        style={{
          position:'absolute', top:6, right:6,
          padding:'3px 8px', borderRadius:6, border:'1px solid rgba(0,201,167,.3)',
          background:'rgba(0,201,167,.08)', color:'var(--teal)',
          fontSize:11, fontWeight:700, cursor:'pointer', lineHeight:1.4,
          transition:'all .15s', opacity: copied ? 1 : 0.7,
        }}
      >
        {copied ? '✓ Copiado' : '⎘ Copiar'}
      </button>
    </div>
  )
}

// Determines if a message deserves a copy block
// Criteria: markdown tables, conjugations, structured lists (3+ items), exercises
function isCopyable(text: string): boolean {
  const t = text.toLowerCase()
  return (
    text.includes('|---') ||                          // markdown table
    (text.match(/^\|/m) !== null && text.includes('|')) || // table rows
    (text.match(/^#{1,3} /m) !== null && text.length > 200) || // headers + content
    (text.match(/^\d+\. /gm) ?? []).length >= 3 ||   // ordered list 3+
    (text.match(/^- /gm) ?? []).length >= 3 ||        // bullet list 3+
    t.includes('yo ') && t.includes('tú ') ||         // conjugation pattern
    t.includes('conjugac') ||
    t.includes('vocabulario') ||
    text.length > 400                                  // long content always copyable
  )
}


function ArtifactRender({ a }: { a: Artifact }) {
  if (a.type === 'schema'       && a.content) return <SchemaBlock content={a.content} />
  if (a.type === 'schema_pro'   && a.content) return <SchemaProBlock content={a.content} />
  if (a.type === 'table'        && a.content) return <TableArtifactBlock content={a.content} />
  if (a.type === 'table_matrix' && a.content) return <MatrixTableBlock content={a.content} />
  if (a.type === 'quiz' && a.content) {
    const qc = a.content as { title: string; questions: Array<{ question: string; options: string[]; correct: number }> }
    return (
      <div style={{ marginTop:10, width:'100%', maxWidth:540, borderRadius:16, border:'1px solid rgba(0,201,167,.25)', background:'rgba(0,201,167,.05)', overflow:'hidden' }}>
        <div style={{ padding:'10px 14px', borderBottom:'1px solid rgba(0,201,167,.15)', display:'flex', alignItems:'center', gap:8 }}>
          <span style={{ fontSize:11, fontWeight:800, letterSpacing:'.1em', textTransform:'uppercase', color:'var(--teal)' }}>Simulacro</span>
          <span style={{ fontSize:12, color:'var(--muted)', marginLeft:'auto' }}>{qc.title}</span>
        </div>
        <div style={{ padding:14 }}>
          <QuizBlock quiz={qc.questions} />
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
  if (a.type === 'course_pdf') {
    const cp = a as unknown as { url: string; title?: string; modules?: string[] | number }
    const mods = Array.isArray(cp.modules) ? cp.modules as string[] : []
    return (
      <div style={{ marginTop:10, maxWidth:480, borderRadius:16, overflow:'hidden', border:'1px solid rgba(245,200,66,.25)', background:'rgba(245,200,66,.05)' }}>
        <div style={{ padding:'10px 14px', borderBottom:'1px solid rgba(245,200,66,.15)', display:'flex', alignItems:'center', gap:8 }}>
          <span>📚</span>
          <div>
            <div style={{ fontSize:13, fontWeight:800, color:'#fff' }}>{cp.title ?? 'Curso PDF'}</div>
            <div style={{ fontSize:11, color:'var(--muted)' }}>Documento descargable</div>
          </div>
        </div>
        <div style={{ padding:'12px 14px', display:'flex', flexDirection:'column', gap:8 }}>
          {mods.slice(0, 6).map((m: string, i: number) => (
            <div key={i} style={{ fontSize:12, color:'var(--silver)' }}>• {m}</div>
          ))}
          <a href={cp.url} download target="_blank" rel="noopener"
            style={{ display:'inline-flex', alignItems:'center', gap:6, marginTop:4, padding:'9px 13px', borderRadius:10, textDecoration:'none', background:'rgba(245,200,66,.12)', border:'1px solid rgba(245,200,66,.22)', color:'var(--gold)', fontSize:13, fontWeight:700, width:'fit-content' }}>
            📄 Descargar curso PDF
          </a>
        </div>
      </div>
    )
  }
  if (a.type === 'pdf_chat' && a.url) return (
    <a href={a.url} download={`lingora-chat-${Date.now()}.pdf`} target="_blank" rel="noopener" style={{ display:'inline-flex', alignItems:'center', gap:6, marginTop:6, padding:'9px 13px', borderRadius:10, textDecoration:'none', background:'rgba(245,200,66,.1)', border:'1px solid rgba(245,200,66,.22)', color:'var(--gold)', fontSize:13, fontWeight:700 }}>📋 Descargar historial PDF</a>
  )
  if (a.type === 'audio' && a.url) return (
    <div style={{ marginTop:8, display:'flex', flexDirection:'column', gap:4 }}>
      <div style={{ fontSize:11, fontWeight:700, color:'var(--teal)', letterSpacing:'.06em', textTransform:'uppercase' }}>🔊 Respuesta de audio</div>
      <audio controls autoPlay src={a.url} style={{ width:'100%', borderRadius:10, outline:'none', accentColor:'var(--teal)' }} />
    </div>
  )

  // ── Simulacro Result ──────────────────────────────
  if (a.type === 'simulacro_result' && a.content) {
    const r = a.content as { score: number; total: number; feedback: string; recommendation: string; retry?: boolean }
    const pct = Math.round((r.score / (r.total || 10)) * 100)
    const color = pct >= 80 ? 'var(--teal)' : pct >= 60 ? 'var(--gold)' : 'var(--coral)'
    return (
      <div style={{ marginTop:10, maxWidth:480, borderRadius:16, overflow:'hidden', border:`1px solid ${color}33`, background:`${color}0a` }}>
        <div style={{ padding:'12px 16px', borderBottom:`1px solid ${color}22`, display:'flex', alignItems:'center', gap:12 }}>
          <div style={{ fontSize:28, fontWeight:800, color, lineHeight:1 }}>{r.score}<span style={{ fontSize:14, color:'var(--muted)' }}>/{r.total}</span></div>
          <div style={{ flex:1 }}>
            <div style={{ height:6, borderRadius:99, background:'rgba(255,255,255,.08)', overflow:'hidden' }}>
              <div style={{ height:'100%', width:`${pct}%`, background:color, borderRadius:99, transition:'width .6s ease' }} />
            </div>
            <div style={{ fontSize:11, color:'var(--muted)', marginTop:3 }}>{pct}% correcto</div>
          </div>
        </div>
        <div style={{ padding:'12px 16px', display:'flex', flexDirection:'column', gap:8 }}>
          <div style={{ fontSize:13, color:'var(--silver)', lineHeight:1.6 }}>{r.feedback}</div>
          {r.recommendation && (
            <div style={{ fontSize:12, color:color, fontWeight:700, display:'flex', gap:6, alignItems:'flex-start' }}>
              <span>💡</span><span>{r.recommendation}</span>
            </div>
          )}
        </div>
      </div>
    )
  }

  // ── Pronunciation Report ──────────────────────────
  if (a.type === 'pronunciation_report' && a.content) {
    const r = a.content as { transcribed: string; score: number; feedback: string; correction?: string; target?: string }
    const scoreColor = r.score >= 8 ? 'var(--teal)' : r.score >= 5 ? 'var(--gold)' : 'var(--coral)'
    return (
      <div style={{ marginTop:10, maxWidth:480, borderRadius:16, border:'1px solid var(--border)', background:'rgba(255,255,255,.02)', overflow:'hidden' }}>
        <div style={{ padding:'10px 14px', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center', gap:10 }}>
          <span style={{ fontSize:11, fontWeight:800, color:'var(--muted)', textTransform:'uppercase', letterSpacing:'.08em' }}>Pronunciación</span>
          <span style={{ marginLeft:'auto', fontSize:18, fontWeight:800, color:scoreColor }}>{r.score}<span style={{ fontSize:11, color:'var(--muted)' }}>/10</span></span>
        </div>
        <div style={{ padding:'12px 14px', display:'flex', flexDirection:'column', gap:8 }}>
          {r.target && <div style={{ fontSize:12, color:'var(--muted)' }}>Frase objetivo: <em style={{ color:'var(--silver)' }}>{r.target}</em></div>}
          <div style={{ fontSize:12, color:'var(--muted)' }}>Lo que se detectó: <em style={{ color:'var(--silver)' }}>{r.transcribed}</em></div>
          <div style={{ fontSize:13, color:'var(--silver)', lineHeight:1.6 }}>{r.feedback}</div>
          {r.correction && <div style={{ fontSize:12, color:'var(--teal)', fontWeight:700 }}>✓ {r.correction}</div>}
        </div>
      </div>
    )
  }

  // ── Audio Transcript ──────────────────────────────
  if (a.type === 'audio_transcript' && a.content) {
    const r = a.content as { text: string; language?: string; url?: string }
    return (
      <div style={{ marginTop:10, maxWidth:480, borderRadius:14, border:'1px solid var(--border)', background:'rgba(255,255,255,.02)', padding:'12px 14px' }}>
        <div style={{ fontSize:11, fontWeight:800, color:'var(--muted)', textTransform:'uppercase', letterSpacing:'.08em', marginBottom:6 }}>
          🎤 Transcripción{r.language ? ` · ${r.language}` : ''}
        </div>
        <div style={{ fontSize:14, color:'var(--silver)', lineHeight:1.65, fontStyle:'italic' }}>"{r.text}"</div>
        {r.url && <audio controls src={r.url} style={{ marginTop:8, width:'100%', height:28, borderRadius:8 }} />}
      </div>
    )
  }

  // ── Roadmap ───────────────────────────────────────
  if (a.type === 'roadmap' && a.content) {
    const r = a.content as { mode: string; mentor: string; topic: string; level: string; steps: string[]; first: string }
    const modeEmoji: Record<string, string> = { interact:'🧠', structured:'🎓', pdf_course:'📄', free:'💬' }
    const modeLabel: Record<string, string> = { interact:'Interacción inteligente', structured:'Curso estructurado', pdf_course:'Curso PDF', free:'Conversación libre' }
    return (
      <div style={{ marginTop:10, maxWidth:480, borderRadius:16, overflow:'hidden', border:'1px solid rgba(0,201,167,.25)', background:'rgba(0,201,167,.05)' }}>
        <div style={{ padding:'10px 14px', borderBottom:'1px solid rgba(0,201,167,.15)', display:'flex', alignItems:'center', gap:8 }}>
          <span style={{ fontSize:16 }}>{modeEmoji[r.mode] ?? '🎓'}</span>
          <div>
            <div style={{ fontSize:13, fontWeight:800, color:'#fff' }}>{modeLabel[r.mode] ?? r.mode}</div>
            <div style={{ fontSize:11, color:'var(--muted)' }}>{r.mentor?.toUpperCase()} · {r.topic} · {r.level}</div>
          </div>
        </div>
        <div style={{ padding:'12px 14px' }}>
          <div style={{ fontSize:11, fontWeight:800, color:'var(--teal)', textTransform:'uppercase', letterSpacing:'.06em', marginBottom:8 }}>Ruta de hoy</div>
          <div style={{ display:'flex', flexDirection:'column', gap:5 }}>
            {(r.steps ?? []).map((step: string, i: number) => (
              <button
                key={i}
                onClick={() => {
                  const evt = new CustomEvent('lingora-step-select', { detail: { step, index: i } })
                  window.dispatchEvent(evt)
                }}
                style={{ display:'flex', gap:8, alignItems:'center', fontSize:13, color:'var(--silver)', background:'transparent', border:'none', cursor:'pointer', textAlign:'left', padding:'4px 0', width:'100%', transition:'color .15s' }}
                onMouseEnter={e => (e.currentTarget.style.color = 'var(--teal)')}
                onMouseLeave={e => (e.currentTarget.style.color = 'var(--silver)')}
              >
                <span style={{ width:20, height:20, borderRadius:'50%', background:'rgba(0,201,167,.15)', border:'1px solid var(--teal)', display:'inline-flex', alignItems:'center', justifyContent:'center', fontSize:10, fontWeight:800, color:'var(--teal)', flexShrink:0 }}>{i+1}</span>
                {step}
                <span style={{ marginLeft:'auto', fontSize:11, color:'var(--teal)', opacity:.6 }}>›</span>
              </button>
            ))}
          </div>
          {r.first && <div style={{ marginTop:10, fontSize:13, color:'var(--teal)', fontWeight:700 }}>→ {r.first}</div>}
        </div>
      </div>
    )
  }

  // ── Score Report ──────────────────────────────────
  if (a.type === 'score_report' && a.content) {
    const r = a.content as { score: number; total: number; feedback: string; recommendation: string; nextStep: string }
    const pct = Math.round(((r.score ?? 0) / Math.max(r.total ?? 10, 1)) * 100)
    const col = pct >= 80 ? 'var(--teal)' : pct >= 60 ? 'var(--gold)' : 'var(--coral)'
    return (
      <div style={{ marginTop:10, maxWidth:440, borderRadius:16, overflow:'hidden', border:`1px solid ${col}33`, background:`${col}0a` }}>
        <div style={{ padding:'12px 14px', borderBottom:`1px solid ${col}22`, display:'flex', alignItems:'center', gap:12 }}>
          <div style={{ fontSize:26, fontWeight:800, color:col, lineHeight:1 }}>{r.score}<span style={{ fontSize:13, color:'var(--muted)', fontWeight:400 }}>/{r.total}</span></div>
          <div style={{ flex:1 }}>
            <div style={{ height:5, borderRadius:99, background:'rgba(255,255,255,.08)' }}>
              <div style={{ height:'100%', width:`${pct}%`, background:col, borderRadius:99, transition:'width .6s' }} />
            </div>
            <div style={{ fontSize:11, color:'var(--muted)', marginTop:3 }}>{pct}%</div>
          </div>
        </div>
        <div style={{ padding:'12px 14px', display:'flex', flexDirection:'column', gap:8 }}>
          <div style={{ fontSize:13, color:'var(--silver)', lineHeight:1.6 }}>{r.feedback}</div>
          {r.recommendation && <div style={{ fontSize:12, color:col, fontWeight:700 }}>💡 {r.recommendation}</div>}
          {r.nextStep && <div style={{ fontSize:12, color:'var(--muted)' }}>→ {r.nextStep}</div>}
        </div>
      </div>
    )
  }

  // ── Lesson Module ─────────────────────────────────
  if (a.type === 'lesson_module' && a.content) {
    const r = a.content as { module: number; title: string; stage: string }
    const stageLabel: Record<string, string> = { diagnosis:'Diagnóstico', schema:'Esquema', examples:'Ejemplos', quiz:'Simulacro', score:'Puntuación', next:'Siguiente' }
    return (
      <div style={{ marginTop:6, padding:'8px 12px', borderRadius:10, border:'1px solid rgba(0,201,167,.2)', background:'rgba(0,201,167,.05)', display:'flex', alignItems:'center', gap:10 }}>
        <span style={{ fontSize:11, fontWeight:800, color:'var(--teal)', textTransform:'uppercase', letterSpacing:'.06em' }}>Módulo {r.module}</span>
        <span style={{ fontSize:11, color:'var(--muted)' }}>·</span>
        <span style={{ fontSize:11, color:'var(--muted)' }}>{r.title}</span>
        <span style={{ marginLeft:'auto', fontSize:11, padding:'2px 7px', borderRadius:999, background:'rgba(0,201,167,.1)', color:'var(--teal)', fontWeight:700 }}>{stageLabel[r.stage] ?? r.stage}</span>
      </div>
    )
  }

  // ── PDF Assignment ────────────────────────────────
  if (a.type === 'pdf_assignment' && a.content) {
    const r = a.content as { title: string; instructions: string; url?: string; exercises?: string[] }
    return (
      <div style={{ marginTop:10, maxWidth:460, borderRadius:16, overflow:'hidden', border:'1px solid rgba(245,200,66,.25)', background:'rgba(245,200,66,.05)' }}>
        <div style={{ padding:'10px 14px', borderBottom:'1px solid rgba(245,200,66,.15)', display:'flex', alignItems:'center', gap:8 }}>
          <span style={{ fontSize:14 }}>📄</span>
          <div>
            <div style={{ fontSize:13, fontWeight:800, color:'#fff' }}>{r.title}</div>
            <div style={{ fontSize:11, color:'var(--muted)' }}>Tarea para entregar</div>
          </div>
          {r.url && <a href={r.url} download style={{ marginLeft:'auto', fontSize:11, padding:'4px 10px', borderRadius:8, background:'rgba(245,200,66,.15)', color:'var(--gold)', fontWeight:700, textDecoration:'none' }}>↓ PDF</a>}
        </div>
        <div style={{ padding:'12px 14px', display:'flex', flexDirection:'column', gap:8 }}>
          <div style={{ fontSize:13, color:'var(--silver)' }}>{r.instructions}</div>
          {(r.exercises ?? []).length > 0 && (
            <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
              {(r.exercises ?? []).map((ex: string, i: number) => (
                <div key={i} style={{ fontSize:12, color:'var(--muted)' }}>• {ex}</div>
              ))}
            </div>
          )}
        </div>
      </div>
    )
  }

  // ── Submission Feedback ───────────────────────────
  if (a.type === 'submission_feedback' && a.content) {
    const r = a.content as { score: number; corrections: string[]; feedback: string; nextAssignment: string }
    const col = (r.score ?? 0) >= 8 ? 'var(--teal)' : (r.score ?? 0) >= 5 ? 'var(--gold)' : 'var(--coral)'
    return (
      <div style={{ marginTop:10, maxWidth:460, borderRadius:16, overflow:'hidden', border:`1px solid ${col}33`, background:`${col}0a` }}>
        <div style={{ padding:'10px 14px', borderBottom:`1px solid ${col}22`, display:'flex', alignItems:'center', gap:10 }}>
          <span style={{ fontSize:11, fontWeight:800, color:col, textTransform:'uppercase', letterSpacing:'.06em' }}>Corrección</span>
          <span style={{ marginLeft:'auto', fontSize:18, fontWeight:800, color:col }}>{r.score}<span style={{ fontSize:11, fontWeight:400, color:'var(--muted)' }}>/10</span></span>
        </div>
        <div style={{ padding:'12px 14px', display:'flex', flexDirection:'column', gap:8 }}>
          {(r.corrections ?? []).length > 0 && (
            <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
              {(r.corrections ?? []).map((c: string, i: number) => (
                <div key={i} style={{ fontSize:12, color:'var(--silver)' }}>✗ {c}</div>
              ))}
            </div>
          )}
          <div style={{ fontSize:13, color:'var(--silver)', lineHeight:1.6 }}>{r.feedback}</div>
          {r.nextAssignment && <div style={{ fontSize:12, color:col, fontWeight:700 }}>→ {r.nextAssignment}</div>}
        </div>
      </div>
    )
  }

  return null
}

function Bubble({ msg, mc }: { msg: Msg; mc: string }) {
  const isUser = msg.sender === 'user'
  return (
    <>
      <div style={{ display:'flex', alignItems:'flex-end', gap:8, maxWidth:'88%', ...(isUser?{flexDirection:'row-reverse',marginLeft:'auto'}:{}) }}>
        <div style={{ width:28, height:28, borderRadius:'50%', display:'flex', alignItems:'center', justifyContent:'center', fontSize:11, fontWeight:700, flexShrink:0, background: isUser ? 'var(--teal)' : mc, color:'#fff' }}>
          {isUser ? 'YOU' : msg.sender.toUpperCase().slice(0,2)}
        </div>
        <div style={{ display:'flex', flexDirection:'column', gap:6, maxWidth:'100%' }}>
          {msg.text && (
            !isUser && isCopyable(msg.text) ? (
              <CopyBlock text={msg.text}>
                <div style={{ padding:'10px 14px', paddingTop:34, borderRadius:16, fontSize:14, lineHeight:1.6, background:'var(--navy2)', border:'1px solid var(--border)', color:'var(--silver)', borderBottomLeftRadius:4 }}
                  dangerouslySetInnerHTML={{ __html: fmt(msg.text || '') }} />
              </CopyBlock>
            ) : (
              <div style={{ padding:'10px 14px', borderRadius:16, fontSize:14, lineHeight:1.6, ...(isUser ? { background:'var(--teal)', color:'var(--navy)', fontWeight:500, borderBottomRightRadius:4 } : { background:'var(--navy2)', border:'1px solid var(--border)', color:'var(--silver)', borderBottomLeftRadius:4 }) }}
                dangerouslySetInnerHTML={{ __html: fmt(msg.text || '') }} />
            )
          )}
          {msg.imageUrl && (
            <div style={{ marginTop:4, borderRadius:12, overflow:'hidden', maxWidth:280, border:'1px solid var(--border)' }}>
              <img src={msg.imageUrl} alt="Adjunto" style={{ width:'100%', display:'block', borderRadius:12 }} />
            </div>
          )}
          {msg.audioUrl && (
            <div style={{ display:'flex', alignItems:'center', gap:8, padding:'6px 10px', borderRadius:10, background:'rgba(0,201,167,.06)', border:'1px solid rgba(0,201,167,.15)', maxWidth:280 }}>
              <span style={{ fontSize:12 }}>🎤</span>
              <audio controls src={msg.audioUrl} style={{ flex:1, height:24, minWidth:0 }} />
            </div>
          )}
          {msg.artifact && <ArtifactRender a={msg.artifact} />}
          {msg.score !== undefined && <div style={{ fontSize:12, color:'var(--gold)', fontWeight:700 }}>Puntuación: {msg.score}/10</div>}
        </div>
      </div>
      {!isUser && (msg.suggestedActions?.length ?? 0) > 0 && (
        <SuggestedActionBar
          actions={msg.suggestedActions!}
          onAction={(a) => {
            const evt = new CustomEvent('lingora-suggested-action', { detail: a })
            window.dispatchEvent(evt)
          }}
        />
      )}
    </>
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

// PDF export via backend — real document, not window.print()
async function doExportPdfBackend(msgs: Msg[], ss: SS) {
  if (!msgs.length) return
  const lines = msgs
    .map(m => ({
      sender: m.sender === 'user' ? 'Student' : m.sender.toUpperCase(),
      text:   (m.text || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
    }))
    .filter(l => l.text.length > 0)

  // Prefix with 'pdf' to guarantee detectIntent → pdf branch in route.ts
  const transcript = lines.map(l => `[${l.sender}]: ${l.text}`).join('\n\n')
  const exportMessage = `pdf: Genera el documento PDF de esta sesión de tutoría LINGORA.\nMentor: ${ss.mentor} · Nivel: ${ss.level} · Tema: ${ss.topic}\n\n${transcript}`

  try {
    const res = await fetch('/api/chat', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        message:    exportMessage,
        exportPdf:  true,   // explicit flag for future route handling
        state:      { ...ss, mentor: ss.mentor, lang: ss.lang, topic: ss.topic },
      }),
    })
    const data = await res.json()
    if (data.artifact?.type === 'pdf' && data.artifact?.url) {
      const a = document.createElement('a')
      a.href = data.artifact.url
      a.download = `lingora-session-${Date.now()}.pdf`
      a.click()
      return
    }
    doExportTxt(msgs)  // fallback: clean TXT if PDF generation fails
  } catch {
    doExportTxt(msgs)
  }
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
  const [activeMode, setActiveMode] = useState<ActiveMode>('interact')

  // Unified composer state — pending items wait for explicit send
  const [pendingAudioBlob, setPendingAudioBlob] = useState<Blob | null>(null)
  const [pendingAudioUrl,  setPendingAudioUrl]  = useState<string | null>(null)
  const [pendingFiles,     setPendingFiles]      = useState<Array<{ name: string; type: string; data: string; size: number }>>([])
  const fileInputRef = useRef<HTMLInputElement>(null)

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
    try { const sv = localStorage.getItem('lng1010'); if (sv) { const p = JSON.parse(sv) as Partial<SS>; setSession(s => ({...s,...p,sessionId:'s'+Math.random().toString(36).slice(2)})); if (p.lang) setLang(p.lang); if (p.mentor) setMentor(p.mentor as MK); if (p.topic) setTopic(p.topic as TK); if (p.activeMode) setActiveMode(p.activeMode as ActiveMode) } } catch {}
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
      const to = setTimeout(() => ctrl.abort(), 30000)
      const res = await fetch('/api/chat', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ ...payload, ttsRequested: true, state: { ...sessionRef.current, mentor: mentorRef.current, lang: langRef.current, topic: topicRef.current, activeMentor: mentorRef.current, topicSystemPrompt: TSYS[topicRef.current], activeMode: sessionRef.current.activeMode } }), signal: ctrl.signal })
      clearTimeout(to)

      // ── STREAMING path (SSE) ──────────────────────────────────
      const contentType = res.headers.get('content-type') ?? ''
      if (contentType.includes('text/event-stream')) {
        const reader = res.body!.getReader()
        const decoder = new TextDecoder()
        // Add placeholder message for streaming — capture generated id
        const streamId = Date.now()+'-stream'
        setMsgs(prev => [...prev, { id: streamId, sender: mentorRef.current, text: '', artifact: null }])
        let accumulated = ''
        let sseBuffer = ''
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          sseBuffer += decoder.decode(value, { stream: true })
          const sseLines = sseBuffer.split('\n')
          sseBuffer = sseLines.pop() ?? ''
          for (const line of sseLines) {
            if (!line.startsWith('data: ')) continue
            try {
              const parsed = JSON.parse(line.slice(6))
              if (parsed.delta) {
                accumulated += parsed.delta
                setMsgs(prev => prev.map(m => m.id === streamId ? { ...m, text: accumulated } : m))
              }
              if (parsed.done) {
                if (parsed.state) setSession((s) => { const n = {...s,...parsed.state,samples:[...(s.samples??[]),...((parsed.state?.samples??[]).filter((x:string)=>!(s.samples??[]).includes(x)))],sessionId:s.sessionId}; sessionRef.current = n; return n })
                if (parsed.artifact || parsed.suggestedActions) {
                  setMsgs(prev => prev.map(m => m.id === streamId ? { ...m, artifact: parsed.artifact ?? null, suggestedActions: parsed.suggestedActions } : m))
                }
              }
            } catch { /* partial chunk — buffer handles it */ }
          }
        }
        return  // body consumed by SSE reader — do not fall through to res.json()
      }

      // ── Non-streaming path (JSON) ─────────────────────────────
      const data = await res.json()
      if (data.state) setSession((s) => { const n = {...s,...data.state,samples:[...(s.samples??[]),...((data.state?.samples??[]).filter((x:string)=>!(s.samples??[]).includes(x)))],sessionId:s.sessionId}; sessionRef.current = n; return n })
      if (data.diagnostic) { addMsg({ sender:'ln', text: JSON.stringify(data.diagnostic,null,2) }); return }
      const text: string = data.reply ?? data.message ?? data.content ?? ''
      if (!text && !data.artifact) { addMsg({ sender:'ln', text:'No se recibió respuesta. Intenta de nuevo.' }); return }
      addMsg({ sender: mentorRef.current, text: text || 'Material listo:', artifact: data.artifact ?? null, score: data.pronunciationScore, suggestedActions: data.suggestedActions ?? undefined })
    } catch (e) {
      const m = e instanceof Error ? e.message : ''
      addMsg({ sender:'ln', text: m.includes('abort') ? 'El tutor tardó demasiado. Intenta de nuevo.' : 'Error de conexión. Intenta de nuevo.' })
    } finally { setLoading(false) }
  }, [addMsg, setMsgs])

  // Suggested action tap — converts action type to callAPI call
  useEffect(() => {
    const handler = (e: Event) => {
      const a = (e as CustomEvent).detail as { action: string; label: string; payload?: Record<string, unknown> }
      if (!a || loading) return
      const actionMessages: Record<string, string> = {
        show_schema:         'Hazme un esquema completo de este tema',
        show_table:          'Hazme una tabla comparativa de este tema',
        show_matrix:         'Hazme una matriz de análisis',
        start_quiz:          'Hazme un simulacro de este tema',
        retry_quiz:          'Dame otro simulacro más difícil',
        practice_examples:   'Dame 3 ejemplos guiados para practicar',
        pronunciation_drill: 'Quiero practicar la pronunciación',
        deepen_topic:        'Profundiza más en este tema',
        next_module:         'Siguiente bloque',
        switch_mode:         'Cambiar a curso estructurado',
        download_pdf:        'Genera el PDF de este material',
        review_errors:       'Repasa mis errores recurrentes',
        hear_audio:          'Lee esto en voz alta',
        show_image:          'Genera un diagrama visual de este tema',
        continue_lesson:     'Continúa con la lección',
        start_course:        'Empezamos el curso',
        export_chat_pdf:     'Exporta esta conversación a PDF',
        download_course_pdf: 'Descarga el curso completo en PDF',
        submit_assignment:   'Enviar tarea',
        choose_examples:     'Ver ejemplos reales',
        choose_exercise:     'Hacer un ejercicio',
        choose_conversation: 'Practicar en conversación libre',
        start_pronunciation: 'Practicar pronunciación ahora',
      }
      const msg = actionMessages[a.action] ?? a.label
      addMsg({ sender: 'user', text: msg })
      callAPI({ message: msg })
    }
    window.addEventListener('lingora-suggested-action', handler)
    return () => window.removeEventListener('lingora-suggested-action', handler)
  }, [loading, addMsg, callAPI])

  // Roadmap step tap — sends the step as a message to trigger that stage
  useEffect(() => {
    const handler = (e: Event) => {
      const step = (e as CustomEvent).detail?.step as string
      if (!step || loading) return
      addMsg({ sender: 'user', text: step })
      callAPI({ message: step })
    }
    window.addEventListener('lingora-step-select', handler)
    return () => window.removeEventListener('lingora-step-select', handler)
  }, [loading, addMsg, callAPI])

  // ── Unified send: text + pending audio + pending files ──
  const sendComposer = useCallback(async () => {
    const msg        = input.trim()
    const hasText    = msg.length > 0
    const hasAudio   = pendingAudioBlob !== null
    const hasFiles   = pendingFiles.length > 0
    if (!hasText && !hasAudio && !hasFiles) return
    if (loading) return

    setInput(''); if (taRef.current) taRef.current.style.height = 'auto'

    // Build display label and samples
    if (hasText) {
      addMsg({ sender:'user', text: msg })
      setSession(s => { const n = {...s, samples:[...s.samples,msg]}; sessionRef.current = n; return n })
    }

    // Assemble payload — audio, files, and/or text can coexist
    const payload: Record<string, unknown> = {}
    if (hasText)  payload.message = msg

    // pronunciationTarget: only sent when user is explicitly requesting pronunciation eval
    // NOT on every audio — that would hijack normal voice conversation
    // Explicit signals: message contains evaluation keywords, OR session is in pronunciation phase
    if (hasAudio) {
      const evalKeywords = ['pronuncia', 'pronunciación', 'pronunciacion', 'califica mi', 'evalúa mi', 'evalua mi', 'cómo sueno', 'como sueno', 'corrige mi pronunciación']
      const inPronMode   = sessionRef.current.tutorPhase === 'pronunciation' || sessionRef.current.lastAction === 'pronunciation'
      const userWantsEval = evalKeywords.some(k => msg.toLowerCase().includes(k))

      if ((inPronMode || userWantsEval) && msgs.length > 0) {
        const lastMentorMsg = [...msgs].reverse().find(m => m.sender !== 'user' && m.sender !== 'ln' && m.text?.length > 10)
        if (lastMentorMsg?.text) {
          const rawTarget     = lastMentorMsg.text.replace(/<[^>]+>/g, '').trim()
          const firstSentence = rawTarget.split(/[.!?]/)[0]?.trim()
          const target        = firstSentence && firstSentence.length > 5 && firstSentence.length < 120
            ? firstSentence
            : rawTarget.slice(0, 120)
          if (target.length > 5) payload.pronunciationTarget = target
        }
      }
    }

    if (hasAudio && pendingAudioBlob) {
      if (!hasText) addMsg({ sender:'user', text:'🎤 Audio enviado', audioUrl: pendingAudioUrl ?? undefined })
      else setMsgs(prev => prev.map(m => m.id === prev[prev.length-1]?.id ? { ...m, audioUrl: pendingAudioUrl ?? undefined } : m))
      const b64 = await new Promise<string>(res => {
        const r = new FileReader()
        r.onload = () => res((r.result as string).split(',')[1] || '')
        r.readAsDataURL(pendingAudioBlob)
      })
      payload.audio = { data: b64, format: 'webm' }
    }

    if (hasFiles) {
      const imageFile = pendingFiles.find(f => f.type.startsWith('image/'))
      const imageUrl  = imageFile ? `data:${imageFile.type};base64,${imageFile.data}` : undefined
      if (!hasText && !hasAudio) addMsg({ sender:'user', text:`📎 ${pendingFiles.map(f=>f.name).join(', ')}`, imageUrl })
      else if (imageUrl) {
        // Attach imageUrl to the already-added text message
        setMsgs(prev => prev.map((m, i) => i === prev.length-1 ? { ...m, imageUrl } : m))
      }
      payload.files = pendingFiles
    }

    // Clear pending state before API call
    // IMPORTANT: do NOT revoke pendingAudioUrl here if it was attached to a message.
    // The objectURL lives in the message bubble until the session ends.
    // Only clear the React state pointer — the URL itself stays alive for playback.
    setPendingAudioBlob(null)
    setPendingAudioUrl(null)   // clear pointer — but don't revoke if used in message
    setPendingFiles([])

    await callAPI(payload)
  }, [input, loading, pendingAudioBlob, pendingAudioUrl, pendingFiles, addMsg, callAPI])


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
    // 3600ms: enter mode chooser
    // Greeting fires after mode selection (with roadmap), not here
    setTimeout(() => {
      setPhase('mode')
    }, 3600)
  }, [])

  // Mode chooser — fires after splash, before chat
  const selectMode = useCallback((mode: ActiveMode) => {
    setActiveMode(mode)
    // Update session with chosen mode
    setSession(s => {
      const n = { ...s, activeMode: mode }
      sessionRef.current = n
      return n
    })
    // Transition to chat — first message triggers roadmap via route.ts
    setPhase('chat')
    // First message to route.ts: special mode-start signal
    // This triggers the roadmap response in route.ts (isFirstMessage + isGuidedMode)
    const m   = mentorRef.current
    const l   = langRef.current
    const modeLabels: Record<ActiveMode, string> = {
      interact:   '🧠 Interacción inteligente',
      structured: '🎓 Curso estructurado',
      pdf_course: '📄 Curso PDF',
      free:       '💬 Conversación libre',
    }
    if (mode === 'structured' || mode === 'pdf_course') {
      // Send a silent "start" message to trigger roadmap from route.ts
      // Show a brief greeting while roadmap loads
      setMsgs([{ id:'init', sender:m, text:`${modeLabels[mode]} activado. Preparando tu ruta...` }])
      // Trigger roadmap call
      setTimeout(() => {
        const topicLabel = topicRef.current
        callAPI({ message: `Modo seleccionado: ${modeLabels[mode]}. Tema: ${topicLabel}. Nivel: ${sessionRef.current.level ?? 'A1'}. Por favor muestra la hoja de ruta.`, activeMode: mode })
      }, 400)
    } else {
      // Modes that start conversationally — show greeting directly
      const greeting = GREETINGS[m][l] ?? GREETINGS[m].en ?? GREETINGS[m].es ?? ''
      const modeNote = mode === 'free'
        ? ''
        : '\n\n_Modo interacción inteligente activo — respondo con tablas y esquemas cuando el contenido lo merece._'
      setMsgs([{ id:'init', sender:m, text: greeting + (mode !== 'free' ? modeNote : '') }])
    }
  }, [callAPI])

  // Voice: Record → Preview → Send (via sendComposer)
  const toggleRec = useCallback(async () => {
    if (recording) {
      mrRef.current?.stop()  // triggers onstop → sets pendingAudioBlob
      setRecording(false)
      return
    }
    // Clear any previous pending audio before new recording
    if (pendingAudioUrl) { URL.revokeObjectURL(pendingAudioUrl); setPendingAudioUrl(null) }
    setPendingAudioBlob(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      chunksRef.current = []
      const rec = new MediaRecorder(stream)
      rec.ondataavailable = e => chunksRef.current.push(e.data)
      rec.onstop = () => {
        stream.getTracks().forEach(t => t.stop())
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
        const url  = URL.createObjectURL(blob)
        setPendingAudioBlob(blob)   // stage — not sent yet
        setPendingAudioUrl(url)     // for preview player
      }
      rec.start(); mrRef.current = rec; setRecording(true)
    } catch (e) { addMsg({ sender:'ln', text:`Micrófono no disponible: ${e instanceof Error ? e.message : String(e)}` }) }
  }, [recording, pendingAudioUrl, addMsg])

  // File: select → stage preview (not auto-send)
  const handleFile = useCallback(async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return
    const r = new FileReader()
    r.onload = () => {
      const b64 = (r.result as string).split(',')[1] || ''
      setPendingFiles(prev => [...prev, { name: file.name, type: file.type, data: b64, size: file.size }])
    }
    r.readAsDataURL(file)
    e.target.value = ''
  }, [])

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

            {/* ── MODE CHOOSER ────────────────────────────── */}
      {phase === 'mode' && (
        <div style={{ flex:1, overflowY:'auto', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:'32px 20px', gap:24 }}>
          <div style={{ display:'flex', alignItems:'center', gap:10 }}>
            <div style={{ width:42, height:42, borderRadius:'50%', background:mm.color, display:'flex', alignItems:'center', justifyContent:'center', fontSize:16, fontWeight:800, color:'#fff' }}>
              {mm.code}
            </div>
            <div>
              <div style={{ fontSize:16, fontWeight:800, color:'#fff' }}>{mm.name}</div>
              <div style={{ fontSize:12, color:'var(--muted)' }}>{mm.spec}</div>
            </div>
          </div>
          <div style={{ textAlign:'center' }}>
            <div style={{ fontSize:20, fontWeight:800, color:'#fff', marginBottom:6 }}>¿Cómo quieres aprender?</div>
            <div style={{ fontSize:13, color:'var(--muted)' }}>Elige el modo. El tutor se adapta desde el primer mensaje.</div>
          </div>
          <div style={{ display:'flex', flexDirection:'column', gap:10, width:'100%', maxWidth:420 }}>
            {([
              { key:'interact'   as ActiveMode, emoji:'🧠', title:'Interacción inteligente', desc:'Respuestas ricas con tablas, esquemas y explicación accionable.' },
              { key:'structured' as ActiveMode, emoji:'🎓', title:'Curso estructurado',       desc:'Esquema → ejemplos → simulacro → puntuación. Guiado por el tutor.' },
              { key:'pdf_course' as ActiveMode, emoji:'📄', title:'Curso PDF con entregas',   desc:'Material descargable. Entregas y corrección por el tutor.' },
              { key:'free'       as ActiveMode, emoji:'💬', title:'Conversación libre',       desc:'Habla con naturalidad. Correcciones oportunistas.' },
            ] as Array<{key:ActiveMode;emoji:string;title:string;desc:string}>).map(({ key, emoji, title, desc }) => (
              <button
                key={key}
                onClick={() => selectMode(key)}
                style={{
                  display:'flex', alignItems:'center', gap:14, padding:'14px 16px',
                  borderRadius:16,
                  border: activeMode === key ? '1px solid rgba(0,201,167,.4)' : '1px solid var(--border)',
                  background: activeMode === key ? 'rgba(0,201,167,.1)' : 'rgba(255,255,255,.02)',
                  cursor:'pointer', textAlign:'left', transition:'all .15s', width:'100%',
                }}
              >
                <span style={{ fontSize:22, flexShrink:0 }}>{emoji}</span>
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:14, fontWeight:700, color:'#fff', marginBottom:2 }}>{title}</div>
                  <div style={{ fontSize:12, color:'var(--muted)', lineHeight:1.5 }}>{desc}</div>
                </div>
                <span style={{ fontSize:16, color:'var(--muted)', flexShrink:0 }}>›</span>
              </button>
            ))}
          </div>
        </div>
      )}


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
              {/* Lesson progress bar */}
              {(() => {
                const tok    = session.tokens ?? 0
                const lesson = (session.lessonIndex ?? 0) + 1
                const inLesson = tok % 10
                const pct    = Math.min(100, Math.round((inLesson / 10) * 100))
                const phase  = session.tutorPhase ?? 'guide'
                return (
                  <div style={{ marginTop:4 }}>
                    <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:3 }}>
                      <span style={{ fontSize:10, color:'var(--muted)' }}>Lección {lesson} · {inLesson}/10</span>
                      <span style={{ fontSize:10, color:'var(--dim)', marginLeft:'auto' }}>{phase}</span>
                    </div>
                    <div style={{ height:3, borderRadius:99, background:'rgba(255,255,255,.08)', overflow:'hidden' }}>
                      <div style={{ height:'100%', width:`${pct}%`, background:`linear-gradient(90deg,${mm.color},var(--teal))`, borderRadius:99, transition:'width .4s ease' }} />
                    </div>
                  </div>
                )
              })()}
            </div>
            <div style={{ display:'flex', gap:5, alignItems:'center', flexShrink:0 }}>
              {/* Level badge with phase indicator */}
              <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:1 }}>
                <span style={{ fontSize:12, fontWeight:800, color:'var(--teal)', lineHeight:1 }}>{session.level}</span>
                <span style={{ fontSize:9, color:'var(--dim)', letterSpacing:'.04em' }}>nivel</span>
              </div>

              {/* Export dropdown */}
              <div style={{ position:'relative' }}>
                <button onClick={() => setShowExport(v => !v)} style={{ fontSize:11, padding:'5px 10px', borderRadius:999, border:'1px solid var(--border)', background:'none', color:'var(--muted)', cursor:'pointer' }}>📋 ▾</button>
                {showExport && (
                  <div style={{ position:'absolute', top:'115%', right:0, background:'var(--navy2)', border:'1px solid var(--border)', borderRadius:12, padding:'5px 0', zIndex:50, minWidth:160, boxShadow:'0 8px 24px rgba(0,0,0,.45)' }}
                    onMouseLeave={() => setShowExport(false)}>
                    <button onClick={() => { doExportTxt(msgs); setShowExport(false) }} style={{ display:'block', width:'100%', textAlign:'left', padding:'9px 16px', background:'none', border:'none', color:'var(--silver)', fontSize:13, cursor:'pointer', fontWeight:600 }}>📄 Exportar TXT</button>
                    <button onClick={() => { void doExportPdfBackend(msgs, session); setShowExport(false) }} style={{ display:'block', width:'100%', textAlign:'left', padding:'9px 16px', background:'none', border:'none', color:'var(--silver)', fontSize:13, cursor:'pointer', fontWeight:600 }}>🖨️ Exportar PDF</button>
                  </div>
                )}
              </div>

              <button onClick={() => { setMsgs([]); setSession(s => ({...s,tokens:0,level:'A0',samples:[],lastTask:null,lastArtifact:null,tutorPhase:'idle',lessonIndex:0,courseActive:false,lastAction:null,awaitingQuizAnswer:false,activeMode:undefined,learningStage:undefined,currentModule:undefined,score:undefined,pdfCourseActive:false})); setActiveMode('interact'); setPhase('onboarding') }} style={{ fontSize:11, padding:'5px 10px', borderRadius:999, border:'1px solid var(--border)', background:'none', color:'var(--muted)', cursor:'pointer' }}>↺</button>
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

          {/* Composer: preview area + input bar */}
          <div style={{ borderTop:'1px solid var(--border)', background:'rgba(8,17,32,.9)', backdropFilter:'blur(10px)', flexShrink:0 }}>

            {/* Pending items preview — shown only when something is staged */}
            {(pendingAudioUrl || pendingFiles.length > 0) && (
              <div style={{ padding:'8px 12px 0', display:'flex', flexDirection:'column', gap:6 }}>
                {/* Audio preview player */}
                {pendingAudioUrl && (
                  <div style={{ display:'flex', alignItems:'center', gap:8, padding:'6px 10px', borderRadius:10, background:'rgba(0,201,167,.08)', border:'1px solid rgba(0,201,167,.2)' }}>
                    <span style={{ fontSize:13 }}>🎤</span>
                    <audio controls src={pendingAudioUrl} style={{ flex:1, height:28, minWidth:0 }} />
                    <button onClick={() => { URL.revokeObjectURL(pendingAudioUrl!); setPendingAudioUrl(null); setPendingAudioBlob(null) }}
                      style={{ width:22, height:22, borderRadius:'50%', border:'none', background:'rgba(255,107,107,.2)', color:'var(--coral)', fontSize:12, cursor:'pointer', flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center' }}>✕</button>
                  </div>
                )}
                {/* File chips */}
                {pendingFiles.length > 0 && (
                  <div style={{ display:'flex', flexWrap:'wrap', gap:5 }}>
                    {pendingFiles.map((f, i) => (
                      <div key={i} style={{ display:'flex', alignItems:'center', gap:5, padding:'4px 10px', borderRadius:999, background:'rgba(255,255,255,.06)', border:'1px solid var(--border)', fontSize:12, color:'var(--silver)' }}>
                        <span>📎</span>
                        <span style={{ maxWidth:120, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{f.name}</span>
                        <button onClick={() => setPendingFiles(prev => prev.filter((_,j) => j !== i))}
                          style={{ border:'none', background:'none', color:'var(--muted)', cursor:'pointer', fontSize:12, padding:0, lineHeight:1 }}>✕</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Input row */}
            <div style={{ padding:'9px 12px 13px', display:'flex', alignItems:'flex-end', gap:8 }}>
              {/* Mic button */}
              <button onClick={toggleRec} title={recording ? 'Detener grabación' : 'Grabar audio'}
                style={{ width:38, height:38, borderRadius:'50%', border:`1px solid ${recording ? 'var(--coral)' : 'var(--border)'}`, background: recording ? 'rgba(255,107,107,.1)' : 'transparent', color: recording ? 'var(--coral)' : 'var(--muted)', fontSize:15, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, transition:'all .2s' }}>
                {recording ? '⏹' : '🎤'}
              </button>
              {/* Attach button */}
              <label title="Adjuntar archivo"
                style={{ width:38, height:38, borderRadius:'50%', border:'1px solid var(--border)', background:'transparent', color:'var(--muted)', fontSize:15, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                📎
                <input ref={fileInputRef} type="file" accept="image/*,application/pdf,text/*,audio/*" onChange={handleFile} style={{ display:'none' }} />
              </label>
              {/* Text input */}
              <textarea ref={taRef} value={input}
                onChange={e => { setInput(e.target.value); e.target.style.height='auto'; e.target.style.height=Math.min(e.target.scrollHeight,120)+'px' }}
                onKeyDown={e => { if ((e.ctrlKey||e.metaKey) && e.key==='Enter') { e.preventDefault(); void sendComposer() } }}
                placeholder={copy.ph} rows={1}
                style={{ flex:1, background:'var(--navy2)', border:'1px solid var(--border)', borderRadius:14, padding:'10px 14px', fontSize:14, color:'var(--silver)', resize:'none', maxHeight:120, lineHeight:1.5, fontFamily:'inherit', transition:'border-color .2s' }}
                onFocus={e => (e.target.style.borderColor = 'rgba(0,201,167,.4)')}
                onBlur={e  => (e.target.style.borderColor = 'var(--border)')}
              />
              {/* Unified send button — handles text + audio + files */}
              <button
                onClick={() => void sendComposer()}
                disabled={loading || (!input.trim() && !pendingAudioBlob && pendingFiles.length === 0)}
                title="Enviar"
                style={{ width:38, height:38, borderRadius:'50%', border:'none', fontSize:16, cursor: loading || (!input.trim() && !pendingAudioBlob && pendingFiles.length === 0) ? 'default' : 'pointer', background: loading || (!input.trim() && !pendingAudioBlob && pendingFiles.length === 0) ? 'var(--navy3)' : 'var(--teal)', color: loading || (!input.trim() && !pendingAudioBlob && pendingFiles.length === 0) ? 'var(--muted)' : 'var(--navy)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, transition:'all .2s' }}>
                ▶
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

