'use client'

// ================================================
// LINGORA 10.2 — /beta — AI Tutor
// Full beta UI
// ================================================

import { useState, useRef, useEffect, useCallback, useMemo } from 'react'

// ─── Types ───────────────────────────────────────
type MK = 'sarah' | 'alex' | 'nick'
type TK = 'conversation' | 'structured' | 'cervantes' | 'business' | 'travel' | 'course' | 'leveltest'
type Lang = 'es' | 'en' | 'no' | 'fr' | 'de' | 'it' | 'pt' | 'ar' | 'ja' | 'zh'
type Phase = 'onboarding' | 'splash' | 'chat'

interface Artifact {
  type: 'schema' | 'quiz' | 'table' | 'illustration' | 'pdf' | 'audio'
  url?: string
  content?: Record<string, unknown>
  metadata?: Record<string, unknown>
}

interface Msg {
  id: string
  sender: 'user' | MK | 'ln'
  text: string
  artifact?: Artifact | null
  score?: number
}

interface SS {
  lang: Lang
  mentor: MK
  topic: TK
  level: string
  tokens: number
  samples: string[]
  sessionId: string
  commercialOffers: unknown[]
  lastTask: string | null
  lastArtifact: string | null
  tutorMode?: string
  tutorPhase?: string
  lessonIndex?: number
  courseActive?: boolean
  lastAction?: string | null
  awaitingQuizAnswer?: boolean
}

interface TableRow {
  left: string
  right: string
}

interface QuizQ {
  question: string
  options: string[]
  correct: number
}

interface Sub {
  title: string
  content: string
  keyTakeaway?: string
}

interface Norm {
  title: string
  objective: string
  block: string
  keyConcepts: string[]
  subtopics: Sub[]
  quiz: QuizQ[]
  tableRows: TableRow[]
  summary: string
  examples: string[]
}

// ─── Static Data ─────────────────────────────────
const MENTOR_META: Record<MK, { emoji: string; name: string; code: string; color: string; bg: string; spec: string }> = {
  sarah: { emoji: '📚', name: 'Sarah', code: 'SR', color: '#7c3aed', bg: 'rgba(124,58,237,.14)', spec: 'Mentora académica · LINGORA' },
  alex: { emoji: '🌍', name: 'Alex', code: 'AX', color: '#0891b2', bg: 'rgba(8,145,178,.14)', spec: 'Mentor cultural · LINGORA' },
  nick: { emoji: '💼', name: 'Nick', code: 'NK', color: '#d97706', bg: 'rgba(217,119,6,.14)', spec: 'Mentor profesional · LINGORA' },
}

const TOPIC_META: Record<TK, { emoji: string }> = {
  conversation: { emoji: '💬' },
  structured: { emoji: '📚' },
  cervantes: { emoji: '🏛️' },
  business: { emoji: '💼' },
  travel: { emoji: '✈️' },
  course: { emoji: '📖' },
  leveltest: { emoji: '📊' },
}

const LANG_GRID: Array<{ value: Lang; flag: string; label: string; sub: string }> = [
  { value: 'es', flag: '🇪🇸', label: 'Español', sub: 'Spanish' },
  { value: 'en', flag: '🇬🇧', label: 'English', sub: 'English' },
  { value: 'no', flag: '🇳🇴', label: 'Norsk', sub: 'Norwegian' },
  { value: 'fr', flag: '🇫🇷', label: 'Français', sub: 'French' },
  { value: 'de', flag: '🇩🇪', label: 'Deutsch', sub: 'German' },
  { value: 'it', flag: '🇮🇹', label: 'Italiano', sub: 'Italian' },
  { value: 'pt', flag: '🇵🇹', label: 'Português', sub: 'Portuguese' },
  { value: 'ar', flag: '🇸🇦', label: 'العربية', sub: 'Arabic' },
  { value: 'ja', flag: '🇯🇵', label: '日本語', sub: 'Japanese' },
  { value: 'zh', flag: '🇨🇳', label: '中文', sub: 'Chinese' },
]

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
    it: 'Ciao! Sono Alex. Argomento scelto — iniziamo. Hai già avuto qualche esperienza pratica con lo spagnolo?',
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
    ja: 'こんにちは！ニックです。テーマ確定 — まず最初にどんな具体的な場面を練習
