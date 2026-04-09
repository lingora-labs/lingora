'use client'

// =============================================================================
// app/beta/page.tsx
// LINGORA SEEK 4.1b — app/beta/page.tsx (no artificial timeout, honest error classification)— Beta Tutor Interface
// =============================================================================
// FIX LOG:
//   FIX-1    sendComposer: audio payload aligned with SEEK 3.0 route.ts.
//   FIX-1B   audio artifact renderer: supports root-level dataUrl.
//   FIX-1C   SuggestedActionBar: accepts both legacy action and SEEK 3.0 type.
//   FIX-8A   SEEK 3.1 Fase 0-A: SS type extended with semantic state fields.
//   FIX-8B   SEEK 3.1 Fase 0-A: callAPI sends currentLessonTopic,
//            currentExercise, expectedResponseMode, _exerciseAttemptCount
//            so the orchestrator exercise lock receives correct state.
//   FIX-8C   SEEK 3.1 Fase 0-A: reset button clears Fase 0-A fields to
//            prevent stale exercise state contaminating new sessions.
//   FIX-8D   SEEK 3.1 Fase 0-A: ArtifactRender roadmap case updated to
//            handle RoadmapBlock contract (modules[]) from execution-engine,
//            with backward-compatible fallback for legacy steps[] shape.
//   FIX-TRANSCRIPT-A  SEEK 3.9: export_chat_pdf suggested action now injects
//            exportTranscript from msgs array so backend PDF contains real
//            chat history (not just the trigger phrase).
//   FIX-TRANSCRIPT-B  SEEK 3.9: sendComposer detects typed export intent and
//            injects exportTranscript so PDF contains real chat history.
// =============================================================================

import React, { useState, useRef, useEffect, useCallback, useMemo, type ReactNode, type ChangeEvent } from 'react'


// FIX-6: map UI langs not in InterfaceLanguage contract to 'en'
// ar, ja, zh are valid UI display langs but not yet in backend InterfaceLanguage
const BACKEND_LANG = (l: Lang): string =>
  (['ar', 'ja', 'zh'] as Lang[]).includes(l) ? 'en' : l

// ─── Types ───────────────────────────────────────
type MK = 'sarah' | 'alex' | 'nick'
type TK = 'conversation' | 'structured' | 'cervantes' | 'business' | 'travel' | 'course' | 'leveltest'
type Lang = 'es' | 'en' | 'no' | 'fr' | 'de' | 'it' | 'pt' | 'ar' | 'ja' | 'zh'
type Phase = 'onboarding' | 'splash' | 'mode' | 'chat'

interface Artifact {
  type: 'schema' | 'quiz' | 'table' | 'table_matrix' | 'schema_pro' |
        'illustration' | 'pdf' | 'course_pdf' | 'pdf_chat' | 'audio' |
        'pronunciation_report' | 'simulacro_result' | 'audio_transcript' |
        'roadmap' | 'score_report' | 'lesson_module' | 'pdf_assignment' | 'submission_feedback' |
        // IS-C2: types present in backend contracts but missing from frontend union
        'diagnostic_report' | 'rich_content'
  url?: string
  dataUrl?: string
  content?: Record<string, unknown>
  metadata?: Record<string, unknown>
}

interface Msg {
  id: string; sender: 'user' | MK | 'ln'; text: string
  artifact?: Artifact | null; score?: number
  audioUrl?: string
  imageUrl?: string
  suggestedActions?: SuggestedAction[]
}
type ActiveMode = 'interact' | 'structured' | 'pdf_course' | 'free'

// FIX-8A: extended with SEEK 3.1 Fase 0-A semantic state fields
interface SS {
  lang: Lang; mentor: MK; topic: TK; level: string; tokens: number
  samples: string[]; sessionId: string; commercialOffers: unknown[]
  lastTask: string | null; lastArtifact: string | null
  tutorMode?:          string
  tutorPhase?:         string
  lessonIndex?:        number
  courseActive?:       boolean
  lastAction?:         string | null
  awaitingQuizAnswer?: boolean
  activeMode?:         ActiveMode
  learningStage?:      string
  currentModule?:      number
  score?:              number
  pdfCourseActive?:    boolean
  // SEEK 3.1 Fase 0-A — semantic state fields
  currentLessonTopic?:    string
  currentExercise?:       string
  expectedResponseMode?:  'exercise_answer' | 'free' | 'quiz_answer'
  _exerciseAttemptCount?: number
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
  // FIX-9E: read 'sections' (SchemaArtifact contract) as fallback for subtopics
  const rawSubtopics = Array.isArray(r.subtopics) ? r.subtopics
    : Array.isArray(r.sections) ? r.sections : []
  const subtopics: Sub[] = rawSubtopics
    .map((i: unknown) => {
      const o = i as Record<string,unknown>
      return { title: ss(o.title) || ss(o.label), content: ss(o.content) || ss(o.body), keyTakeaway: ss(o.keyTakeaway) }
    })
    .filter(s => s.title || s.content)
  const quiz: QuizQ[] = (Array.isArray(r.quiz) ? r.quiz : [])
    .map((i: unknown) => { const o = i as Record<string,unknown>; return { question: ss(o.question), options: Array.isArray(o.options) ? o.options.map(ss).filter(Boolean) : [], correct: typeof o.correct === 'number' ? o.correct : 0, explanation: ss(o.explanation) || undefined } })
    .filter(q => q.question && q.options.length > 0)
  const rawRows = Array.isArray(r.tableRows) ? r.tableRows : Array.isArray(r.rows) ? r.rows : []
  let tableRows: TableRow[] = rawRows.map((i: unknown) => { const o = i as Record<string,unknown>; return { left: ss(o.left)||ss(o.label)||ss(o.persona)||ss(o.term), right: ss(o.right)||ss(o.value)||ss(o.forma)||ss(o.definition) } }).filter(r => r.left && r.right)
  if (tableRows.length === 0 && subtopics.length >= 3) {
    const inferred = subtopics.filter(s => s.title.length < 40 && s.content.length < 80).map(s => ({ left: s.title, right: s.content }))
    if (inferred.length >= 3) tableRows = inferred
  }
  const errors: string[] = Array.isArray(r.errors) ? r.errors.map(ss).filter(Boolean) : Array.isArray(r.erroresFrecuentes) ? (r.erroresFrecuentes as unknown[]).map(ss).filter(Boolean) : []
  return { title: ss(r.title) || 'LINGORA Schema', objective: ss(r.objective), block: ss(r.block) || 'LINGORA', keyConcepts: sa(r.keyConcepts), subtopics, quiz, tableRows, summary: ss(r.summary) || ss(r.globalTakeaway) || ss(r.keyTakeaway), examples: sa(r.examples), errors }
}

function fmt(t: string): string {
  if (!t) return ''
  let s = t
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
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
  s = s.replace(/^### (.+)$/gm, '<div style="font-size:13px;font-weight:800;color:var(--teal);margin:10px 0 4px;letter-spacing:.04em;text-transform:uppercase">$1</div>')
  s = s.replace(/^## (.+)$/gm,  '<div style="font-size:15px;font-weight:800;color:#fff;margin:12px 0 6px">$1</div>')
  s = s.replace(/^# (.+)$/gm,   '<div style="font-size:17px;font-weight:800;color:#fff;margin:14px 0 8px">$1</div>')
  s = s.replace(/((?:^- .+\n?)+)/gm, (block) => {
    const items = block.trim().split('\n')
      .map((line: string) => `<li style="margin:3px 0;color:var(--silver)">${line.replace(/^- /, '')}</li>`).join('')
    return `<ul style="margin:6px 0 6px 16px;padding:0;list-style:none">${items}</ul>`
  })
  s = s.replace(/((?:^\d+\. .+\n?)+)/gm, (block) => {
    let n = 0
    const items = block.trim().split('\n')
      .map((line: string) => { n++; return `<li style="margin:3px 0;color:var(--silver)"><span style="color:var(--teal);font-weight:700;margin-right:6px">${n}.</span>${line.replace(/^\d+\. /, '')}</li>` }).join('')
    return `<ol style="margin:6px 0 6px 8px;padding:0;list-style:none">${items}</ol>`
  })
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong style="color:#fff;font-weight:700">$1</strong>')
  s = s.replace(/\*(.+?)\*/g,     '<em style="color:var(--silver);font-style:italic">$1</em>')
  s = s.replace(/`(.+?)`/g,       '<code style="background:rgba(0,0,0,.4);padding:1px 6px;border-radius:4px;font-family:monospace;font-size:.86em;color:#7dd3fc">$1</code>')
  s = s.replace(/^---+$/gm, '<hr style="border:none;border-top:1px solid var(--border);margin:10px 0">')
  s = s.replace(/\n/g, '<br>')
  return s
}

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
  const content = { columns: ['Forma', 'Valor'], rows: rows.map(r => [r.left, r.right]), tone: 'comparison' as const }
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
                {q.explanation && <span style={{ color:'var(--muted)', fontWeight:400, fontSize:11 }}>{q.explanation}</span>}
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
      <div style={{ padding:'12px 16px', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center', justifyContent:'space-between', gap:10, background:'rgba(255,255,255,.02)' }}>
        <Badge t="purple">{s.block}</Badge>
        <div style={{ display:'flex', gap:5 }}>
          {s.tableRows.length > 0 && <Badge t="gold">Tabla</Badge>}
          {s.quiz.length > 0      && <Badge t="teal">Simulacro</Badge>}
          {s.examples.length > 0  && <Badge t="d">Ejemplos</Badge>}
        </div>
      </div>
      <div style={{ padding:16, display:'flex', flexDirection:'column', gap:16 }}>
        <div>
          <div style={{ fontSize:21, fontWeight:800, color:'#fff', marginBottom:6, lineHeight:1.15, fontFamily:'"DM Serif Display",serif' }}>{s.title}</div>
          {s.objective && <div style={{ fontSize:14, lineHeight:1.65, color:'var(--muted)' }}>{s.objective}</div>}
        </div>
        {s.keyConcepts.length > 0 && <div><SL>Conceptos clave</SL><div style={{ display:'flex', flexWrap:'wrap', gap:5 }}>{s.keyConcepts.map((c,i) => <Badge key={i} t="teal">{c}</Badge>)}</div></div>}
        {s.tableRows.length > 0 && <div><SL>Cuadro visual</SL><TableBlock rows={s.tableRows} /></div>}
        {s.subtopics.length > 0 && (
          <div><SL>Desarrollo</SL>
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
        {s.examples.length > 0 && (
          <div><SL>Ejemplos</SL>
            <div style={{ display:'flex', flexDirection:'column', gap:7 }}>
              {s.examples.map((ex, i) => <div key={i} style={{ fontSize:14, lineHeight:1.6, color:'#fff', padding:'9px 12px', borderRadius:12, background:'rgba(255,255,255,.03)', border:'1px solid rgba(255,255,255,.05)' }}>{ex}</div>)}
            </div>
          </div>
        )}
        {s.errors?.length > 0 && (
          <div style={{ background:'linear-gradient(180deg,rgba(255,107,107,.09),rgba(255,107,107,.04))', border:'1px solid rgba(255,107,107,.22)', borderRadius:14, padding:14 }}>
            <SL>⚠️ Errores frecuentes</SL>
            <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
              {s.errors.map((e, i) => (
                <div key={i} style={{ fontSize:13, color:'var(--coral)', display:'flex', gap:6, alignItems:'flex-start' }}>
                  <span style={{ flexShrink:0 }}>❌</span><span>{e}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {s.summary && (
          <div style={{ background:'linear-gradient(180deg,rgba(0,201,167,.09),rgba(0,201,167,.04))', border:'1px solid rgba(0,201,167,.22)', borderRadius:14, padding:14 }}>
            <SL>Regla 80/20</SL>
            <div style={{ fontSize:14, lineHeight:1.6, color:'#fff' }}>🧠 {s.summary}</div>
          </div>
        )}
        {s.quiz.length > 0 && <div><SL>Simulacro interactivo</SL><QuizBlock quiz={s.quiz} /></div>}
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
  const toneColors: Record<string, string> = { comparison:'#0891b2', conjugation:'#7c3aed', vocabulary:'#00c9a7', exam:'#d97706' }
  const accentColor = toneColors[c.tone ?? 'comparison'] ?? 'var(--teal)'
  return (
    <div style={{ marginTop:10, width:'100%', maxWidth:580, borderRadius:16, overflow:'hidden', border:`1px solid ${accentColor}33`, background:'rgba(255,255,255,.03)' }}>
      {(c.title || c.subtitle) && (
        <div style={{ padding:'10px 14px', borderBottom:`1px solid ${accentColor}22`, background:`${accentColor}0d` }}>
          {c.title   && <div style={{ fontSize:14, fontWeight:800, color:'#fff' }}>{c.title}</div>}
          {c.subtitle && <div style={{ fontSize:12, color:'var(--muted)', marginTop:2 }}>{c.subtitle}</div>}
        </div>
      )}
      <div style={{ overflowX:'auto' }}>
        <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
          <thead>
            <tr style={{ background:`${accentColor}15` }}>
              {c.columns.map((col, i) => (
                <th key={i} style={{ padding:'8px 12px', textAlign:'left', fontWeight:700, color:accentColor, fontSize:11, letterSpacing:'.06em', textTransform:'uppercase', borderBottom:`1px solid ${accentColor}22`, whiteSpace:'nowrap' }}>{col}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {c.rows.map((row, ri) => (
              <tr key={ri} style={{ borderBottom: ri < c.rows.length - 1 ? '1px solid rgba(255,255,255,.04)' : 'none', background: ri % 2 === 0 ? 'transparent' : 'rgba(255,255,255,.02)' }}>
                {row.map((cell, ci) => (
                  <td key={ci} style={{ padding:'9px 12px', color: ci === 0 ? 'var(--silver)' : 'var(--muted)', fontWeight: ci === 0 ? 600 : 400, verticalAlign:'top' }}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function MatrixTableBlock({ content }: { content: Record<string, unknown> }) {
  type RCell = { text: string; icon?: string; tone?: string; bold?: boolean; align?: string }
  const c = content as { title?: string; subtitle?: string; columns: Array<{key:string;label:string;width?:string}>; rows: RCell[][] }
  if (!c.columns?.length || !c.rows?.length) return null
  const toneStyle: Record<string, { color: string; bg: string }> = {
    ok:     { color:'#00c9a7', bg:'rgba(0,201,167,.1)' },
    warn:   { color:'#f5c842', bg:'rgba(245,200,66,.1)' },
    danger: { color:'#ff6b6b', bg:'rgba(255,107,107,.1)' },
    info:   { color:'#38bdf8', bg:'rgba(56,189,248,.1)' },
    neutral:{ color:'var(--silver)', bg:'transparent' },
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
                <th key={i} style={{ padding:'8px 12px', textAlign:'left', fontWeight:700, color:'var(--teal)', fontSize:11, letterSpacing:'.06em', textTransform:'uppercase', borderBottom:'1px solid var(--border)', whiteSpace:'nowrap', width: col.width }}>{col.label}</th>
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
          <div style={{ fontSize:14, color:'#fff', lineHeight:1.6, fontWeight:600 }}>{ts.icon} {b.text}</div>
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
  return typeof b.type === 'string' && ['concept','bullets','highlight','flow','comparison','table'].includes(b.type)
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
type SuggestedAction = {
  id?:      string
  label:    string
  action:   string
  type?:    string
  payload?: Record<string, unknown>
  tone?:    'primary' | 'secondary' | 'warning'
  emoji?:   string
}

function SuggestedActionBar({ actions, onAction }: { actions: SuggestedAction[]; onAction: (action: SuggestedAction) => void }) {
  if (!actions?.length) return null
  const toneStyle = (tone?: string) => {
    if (tone === 'primary') return { bg: 'rgba(0,201,167,.15)', border: 'rgba(0,201,167,.35)', color: 'var(--teal)' }
    if (tone === 'warning') return { bg: 'rgba(255,107,107,.1)', border: 'rgba(255,107,107,.3)', color: 'var(--coral)' }
    return { bg: 'rgba(255,255,255,.05)', border: 'var(--border)', color: 'var(--muted)' }
  }
  return (
    <div style={{ display:'flex', flexWrap:'wrap', gap:6, marginTop:8, paddingLeft:36 }}>
      {actions.map((a, idx) => {
        const s = toneStyle(a.tone)
        return (
          <button key={a.id ?? idx} onClick={() => onAction(a)}
            style={{ display:'flex', alignItems:'center', gap:5, padding:'5px 11px', borderRadius:20, border:`1px solid ${s.border}`, background:s.bg, color:s.color, fontSize:12, fontWeight:600, cursor:'pointer', transition:'all .15s' }}
            onMouseEnter={e => { e.currentTarget.style.opacity = '0.85' }}
            onMouseLeave={e => { e.currentTarget.style.opacity = '1' }}>
            {a.emoji && <span style={{ fontSize:13 }}>{a.emoji}</span>}
            {a.label}
          </button>
        )
      })}
    </div>
  )
}

// ─── CopyBlock ────────────────────────────────────
function CopyBlock({ text, children }: { text: string; children: React.ReactNode }) {
  const [copied, setCopied] = React.useState(false)
  const copy = () => {
    navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1800) }).catch(() => {})
  }
  return (
    <div style={{ position:'relative', width:'100%' }}>
      {children}
      <button onClick={copy} title="Copiar"
        style={{ position:'absolute', top:6, right:6, padding:'3px 8px', borderRadius:6, border:'1px solid rgba(0,201,167,.3)', background:'rgba(0,201,167,.08)', color:'var(--teal)', fontSize:11, fontWeight:700, cursor:'pointer', lineHeight:1.4, transition:'all .15s', opacity: copied ? 1 : 0.7 }}>
        {copied ? '✓ Copiado' : '⎘ Copiar'}
      </button>
    </div>
  )
}

function isCopyable(text: string): boolean {
  const t = text.toLowerCase()
  return (
    text.includes('|---') ||
    (text.match(/^\|/m) !== null && text.includes('|')) ||
    (text.match(/^#{1,3} /m) !== null && text.length > 200) ||
    (text.match(/^\d+\. /gm) ?? []).length >= 3 ||
    (text.match(/^- /gm) ?? []).length >= 3 ||
    t.includes('yo ') && t.includes('tú ') ||
    t.includes('conjugac') ||
    t.includes('vocabulario') ||
    text.length > 400
  )
}

function ArtifactRender({ a }: { a: Artifact }) {
  // FIX-9D: SchemaArtifact/TableArtifact/QuizArtifact carry their data at top level
  // NOT in a.content — pass the artifact itself as the data source.
  if (a.type === 'schema') return <SchemaBlock content={a as unknown as Record<string, unknown>} />
  if (a.type === 'schema_pro') return <SchemaProBlock content={(a.content ?? a) as Record<string, unknown>} />
  if (a.type === 'table') return <TableArtifactBlock content={a as unknown as Record<string, unknown>} />
  if (a.type === 'table_matrix') return <MatrixTableBlock content={a as unknown as Record<string, unknown>} />
  if (a.type === 'quiz') {
    type QuizOption   = string | { text: string; correct?: boolean }
    type QuizQuestion = { question: string; options: QuizOption[]; correct?: number }
    type QuizArtifactShape = { title?: string; questions?: QuizQuestion[]; content?: Record<string, unknown> }

    const qa          = a as unknown as QuizArtifactShape
    const contentObj  = qa.content && typeof qa.content === 'object' ? qa.content : undefined

    const rawQuestionsUnknown =
      qa.questions ??
      (Array.isArray(contentObj?.questions) ? (contentObj?.questions as unknown[]) : [])

    const questions = (rawQuestionsUnknown as QuizQuestion[]).map(q => ({
      question: typeof q.question === 'string' ? q.question : '',
      options: Array.isArray(q.options)
        ? q.options.map((o: unknown) =>
            typeof o === 'object' && o !== null && 'text' in o
              ? String((o as {text: string}).text)
              : String(o)
          )
        : [],
      correct:
        typeof q.correct === 'number'
          ? q.correct
          : Array.isArray(q.options)
            ? q.options.findIndex(
                (o: unknown) =>
                  typeof o === 'object' && o !== null &&
                  'correct' in o && Boolean((o as {correct?: boolean}).correct)
              )
            : 0,
    }))

    const qc: { title: string; questions: QuizQ[] } = {
      title:
        typeof qa.title === 'string'
          ? qa.title
          : typeof contentObj?.title === 'string'
            ? contentObj.title
            : 'Simulacro',
      questions,
    }
    return (
      <div style={{ marginTop:10, width:'100%', maxWidth:540, borderRadius:16, border:'1px solid rgba(0,201,167,.25)', background:'rgba(0,201,167,.05)', overflow:'hidden' }}>
        <div style={{ padding:'10px 14px', borderBottom:'1px solid rgba(0,201,167,.15)', display:'flex', alignItems:'center', gap:8 }}>
          <span style={{ fontSize:11, fontWeight:800, letterSpacing:'.1em', textTransform:'uppercase', color:'var(--teal)' }}>Simulacro</span>
          <span style={{ fontSize:12, color:'var(--muted)', marginLeft:'auto' }}>{qc.title}</span>
        </div>
        <div style={{ padding:14 }}><QuizBlock quiz={qc.questions} /></div>
      </div>
    )
  }
  if (a.type === 'illustration' && a.url) return (
    <div style={{ marginTop:8 }}>
      <img src={a.url} alt="LINGORA visual" style={{ maxWidth:'100%', borderRadius:14, display:'block', border:'1px solid var(--border)' }} />
      <a href={a.url} download target="_blank" rel="noopener" style={{ display:'inline-block', marginTop:5, fontSize:12, color:'var(--teal)', fontWeight:700 }}>↓ Descargar imagen</a>
    </div>
  )
  // FIX-PAGE-B: accept any PDF artifact with a url — covers fallback from execution-engine
  if ((a.type === 'pdf' || a.type === 'pdf_chat' || a.type === 'course_pdf') && (a.url || (a as unknown as {url?:string}).url)) {
    const pdfUrl = a.url ?? (a as unknown as {url:string}).url
    const isPdfChat   = a.type === 'pdf_chat'
    const isCoursePdf = a.type === 'course_pdf'
    if (isCoursePdf) {
      const cp = a as unknown as { url: string; title?: string; modules?: string[] }
      const mods = Array.isArray(cp.modules) ? cp.modules : []
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
            {mods.slice(0, 6).map((m: string, i: number) => <div key={i} style={{ fontSize:12, color:'var(--silver)' }}>• {m}</div>)}
            <a href={pdfUrl} download target="_blank" rel="noopener"
              style={{ display:'inline-flex', alignItems:'center', gap:6, marginTop:4, padding:'9px 13px', borderRadius:10, textDecoration:'none', background:'rgba(245,200,66,.12)', border:'1px solid rgba(245,200,66,.22)', color:'var(--gold)', fontSize:13, fontWeight:700, width:'fit-content' }}>
              📄 Descargar curso PDF
            </a>
          </div>
        </div>
      )
    }
    if (isPdfChat) return (
      <a href={pdfUrl} download={`lingora-chat-${Date.now()}.pdf`} target="_blank" rel="noopener" style={{ display:'inline-flex', alignItems:'center', gap:6, marginTop:6, padding:'9px 13px', borderRadius:10, textDecoration:'none', background:'rgba(245,200,66,.1)', border:'1px solid rgba(245,200,66,.22)', color:'var(--gold)', fontSize:13, fontWeight:700 }}>📋 Descargar historial PDF</a>
    )
    return (
      <a href={pdfUrl} download="lingora.pdf" target="_blank" rel="noopener" style={{ display:'inline-flex', alignItems:'center', gap:6, marginTop:6, padding:'9px 13px', borderRadius:10, textDecoration:'none', background:'rgba(245,200,66,.1)', border:'1px solid rgba(245,200,66,.22)', color:'var(--gold)', fontSize:13, fontWeight:700 }}>📄 Descargar PDF</a>
    )
  }
  // course_pdf and pdf_chat handled in unified PDF block above
  if (a.type === 'audio' && (a.dataUrl || a.url || (a.content as Record<string,unknown>)?.dataUrl)) {
    const src = a.dataUrl ?? a.url ?? (a.content as Record<string,unknown>)?.dataUrl as string
    return (
      <div style={{ marginTop:8, display:'flex', flexDirection:'column', gap:6 }}>
        <div style={{ fontSize:11, fontWeight:700, color:'var(--teal)', letterSpacing:'.06em', textTransform:'uppercase' }}>🔊 Respuesta de audio</div>
        <div style={{ display:'flex', alignItems:'center', gap:8, padding:'8px 12px', borderRadius:12, background:'rgba(0,201,167,.08)', border:'1px solid rgba(0,201,167,.2)' }}>
          <button
            onClick={() => { const el = document.getElementById('audio-'+src.slice(-8)); if (el) (el as HTMLAudioElement).play().catch(() => {}) }}
            style={{ flexShrink:0, width:32, height:32, borderRadius:'50%', border:'none', background:'var(--teal)', color:'var(--navy)', fontSize:14, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' }}>▶</button>
          <audio id={'audio-'+src.slice(-8)} controls src={src} style={{ flex:1, height:28, minWidth:0, borderRadius:8, outline:'none', accentColor:'var(--teal)' }}
            onError={() => {}} />
        </div>
      </div>
    )
  }
  if (a.type === 'simulacro_result' && a.content) {
    const r = a.content as { score: number; total: number; feedback: string; recommendation: string }
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
          {r.recommendation && <div style={{ fontSize:12, color, fontWeight:700, display:'flex', gap:6, alignItems:'flex-start' }}><span>💡</span><span>{r.recommendation}</span></div>}
        </div>
      </div>
    )
  }
  if (a.type === 'pronunciation_report') {
    // G1: read from top-level fields (PronunciationReport contract) with a.content fallback
    const raw = (a.content ?? a) as Record<string, unknown>
    const score    = (raw.score    ?? 70) as number
    const feedback = (raw.feedback ?? '') as string
    const tip      = (raw.tip      ?? '') as string
    const errors   = Array.isArray(raw.errors) ? raw.errors as string[] : []
    // score is 0-100 in contract
    const scoreColor = score >= 75 ? 'var(--teal)' : score >= 50 ? 'var(--gold)' : 'var(--coral)'
    const pct = Math.min(100, Math.max(0, score))
    return (
      <div style={{ marginTop:10, maxWidth:480, borderRadius:16, border:`1px solid ${scoreColor}33`, background:`${scoreColor}08`, overflow:'hidden' }}>
        <div style={{ padding:'10px 14px', borderBottom:`1px solid ${scoreColor}22`, display:'flex', alignItems:'center', gap:10 }}>
          <span style={{ fontSize:11, fontWeight:800, color:'var(--muted)', textTransform:'uppercase', letterSpacing:'.08em' }}>Pronunciación</span>
          <div style={{ flex:1, marginLeft:8 }}>
            <div style={{ height:4, borderRadius:99, background:'rgba(255,255,255,.08)', overflow:'hidden' }}>
              <div style={{ height:'100%', width:`${pct}%`, background:scoreColor, borderRadius:99, transition:'width .6s' }} />
            </div>
          </div>
          <span style={{ fontSize:18, fontWeight:800, color:scoreColor, flexShrink:0 }}>{pct}<span style={{ fontSize:11, fontWeight:400, color:'var(--muted)' }}>/100</span></span>
        </div>
        <div style={{ padding:'12px 14px', display:'flex', flexDirection:'column', gap:8 }}>
          {feedback && <div style={{ fontSize:13, color:'var(--silver)', lineHeight:1.6 }}>{feedback}</div>}
          {errors.length > 0 && (
            <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
              {errors.map((e, i) => <div key={i} style={{ fontSize:12, color:'var(--coral)' }}>⚠ {e}</div>)}
            </div>
          )}
          {tip && <div style={{ fontSize:12, color:'var(--teal)', fontWeight:700 }}>💡 {tip}</div>}
        </div>
      </div>
    )
  }
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

  // FIX-8D: Updated roadmap renderer — handles RoadmapBlock (modules[]) from execution-engine
  // with backward-compatible fallback for legacy steps[] shape.
  if (a.type === 'roadmap') {
    // FIX-PAGE-A: RoadmapBlock arrives with fields at top level — not inside a.content
    const r = (a.content ?? a) as {
      title?: string
      modules?: Array<{ index: number; title: string; focus: string; completed: boolean; current: boolean }>
      // legacy shape fallback
      steps?: string[]
      first?: string
      mode?: string
      mentor?: string
      topic?: string
      level?: string
    }
    const hasModules = Array.isArray(r.modules) && r.modules.length > 0
    const hasSteps   = Array.isArray(r.steps)   && r.steps.length   > 0
    if (!hasModules && !hasSteps) return null
    return (
      <div style={{ marginTop:10, maxWidth:480, borderRadius:16, overflow:'hidden', border:'1px solid rgba(0,201,167,.25)', background:'rgba(0,201,167,.05)' }}>
        <div style={{ padding:'10px 14px', borderBottom:'1px solid rgba(0,201,167,.15)', display:'flex', alignItems:'center', gap:8 }}>
          <span style={{ fontSize:16 }}>🎓</span>
          <div>
            <div style={{ fontSize:13, fontWeight:800, color:'#fff' }}>{r.title ?? r.topic ?? 'Ruta de aprendizaje'}</div>
            <div style={{ fontSize:11, color:'var(--muted)' }}>
              {hasModules ? `${r.modules!.length} módulos` : `${r.steps!.length} pasos`}
              {r.mentor && ` · ${r.mentor.toUpperCase()}`}
              {r.level  && ` · ${r.level}`}
            </div>
          </div>
        </div>
        <div style={{ padding:'12px 14px' }}>
          <div style={{ fontSize:11, fontWeight:800, color:'var(--teal)', textTransform:'uppercase', letterSpacing:'.06em', marginBottom:8 }}>
            {hasModules ? 'Módulos' : 'Ruta de hoy'}
          </div>
          <div style={{ display:'flex', flexDirection:'column', gap:5 }}>
            {hasModules
              ? r.modules!.map((mod, i) => (
                  <button key={i}
                    onClick={() => window.dispatchEvent(new CustomEvent('lingora-step-select', { detail: { step: mod.title, index: mod.index } }))}
                    style={{ display:'flex', gap:8, alignItems:'center', fontSize:13, color: mod.current ? 'var(--teal)' : mod.completed ? 'var(--muted)' : 'var(--silver)', background:'transparent', border:'none', cursor:'pointer', textAlign:'left', padding:'4px 0', width:'100%', transition:'color .15s' }}>
                    <span style={{ width:20, height:20, borderRadius:'50%', background: mod.completed ? 'rgba(0,201,167,.3)' : mod.current ? 'rgba(0,201,167,.15)' : 'rgba(255,255,255,.06)', border:`1px solid ${mod.current ? 'var(--teal)' : 'var(--border)'}`, display:'inline-flex', alignItems:'center', justifyContent:'center', fontSize:10, fontWeight:800, color: mod.completed ? '#fff' : 'var(--teal)', flexShrink:0 }}>
                      {mod.completed ? '✓' : mod.index + 1}
                    </span>
                    <span style={{ flex:1 }}>{mod.title}</span>
                    {mod.focus && <span style={{ fontSize:11, color:'var(--muted)', marginLeft:4, flexShrink:0 }}>{mod.focus}</span>}
                    <span style={{ marginLeft:'auto', fontSize:11, color:'var(--teal)', opacity:.6 }}>›</span>
                  </button>
                ))
              : r.steps!.map((step, i) => (
                  <button key={i}
                    onClick={() => window.dispatchEvent(new CustomEvent('lingora-step-select', { detail: { step, index: i } }))}
                    style={{ display:'flex', gap:8, alignItems:'center', fontSize:13, color:'var(--silver)', background:'transparent', border:'none', cursor:'pointer', textAlign:'left', padding:'4px 0', width:'100%', transition:'color .15s' }}
                    onMouseEnter={e => (e.currentTarget.style.color = 'var(--teal)')}
                    onMouseLeave={e => (e.currentTarget.style.color = 'var(--silver)')}>
                    <span style={{ width:20, height:20, borderRadius:'50%', background:'rgba(0,201,167,.15)', border:'1px solid var(--teal)', display:'inline-flex', alignItems:'center', justifyContent:'center', fontSize:10, fontWeight:800, color:'var(--teal)', flexShrink:0 }}>{i+1}</span>
                    {step}
                    <span style={{ marginLeft:'auto', fontSize:11, color:'var(--teal)', opacity:.6 }}>›</span>
                  </button>
                ))
            }
          </div>
          {r.first && <div style={{ marginTop:10, fontSize:13, color:'var(--teal)', fontWeight:700 }}>→ {r.first}</div>}
        </div>
      </div>
    )
  }

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
  if (a.type === 'lesson_module') {
    // IS-C3: aligned with LessonModule contract: moduleIndex, title, content, examples[]
    // also supports legacy shape: module, title, stage (backward compat)
    const raw = (a.content ?? a) as Record<string, unknown>
    const moduleNum = (raw.moduleIndex ?? raw.module ?? 0) as number
    const title     = (raw.title ?? '') as string
    const content   = (raw.content ?? '') as string
    const examples  = Array.isArray(raw.examples) ? raw.examples as string[] : []
    return (
      <div style={{ marginTop:8, borderRadius:14, border:'1px solid rgba(0,201,167,.2)', background:'rgba(0,201,167,.04)', overflow:'hidden' }}>
        <div style={{ padding:'8px 12px', display:'flex', alignItems:'center', gap:8 }}>
          <span style={{ fontSize:11, fontWeight:800, color:'var(--teal)', textTransform:'uppercase', letterSpacing:'.06em', flexShrink:0 }}>Módulo {moduleNum + 1}</span>
          <span style={{ fontSize:11, color:'var(--muted)', flex:1 }}>{title}</span>
        </div>
        {content && (
          <div style={{ padding:'0 12px 10px', fontSize:13, color:'var(--silver)', lineHeight:1.6 }}>{content}</div>
        )}
        {examples.length > 0 && (
          <div style={{ padding:'0 12px 10px', display:'flex', flexDirection:'column', gap:4 }}>
            {examples.slice(0, 3).map((ex, i) => (
              <div key={i} style={{ fontSize:12, color:'var(--muted)' }}>• {ex}</div>
            ))}
          </div>
        )}
      </div>
    )
  }
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
              {(r.exercises ?? []).map((ex, i) => <div key={i} style={{ fontSize:12, color:'var(--muted)' }}>• {ex}</div>)}
            </div>
          )}
        </div>
      </div>
    )
  }
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
              {r.corrections.map((c, i) => <div key={i} style={{ fontSize:12, color:'var(--silver)' }}>✗ {c}</div>)}
            </div>
          )}
          <div style={{ fontSize:13, color:'var(--silver)', lineHeight:1.6 }}>{r.feedback}</div>
          {r.nextAssignment && <div style={{ fontSize:12, color:col, fontWeight:700 }}>→ {r.nextAssignment}</div>}
        </div>
      </div>
    )
  }
  // G3: diagnostic_report — shows CEFR level estimate from accumulative diagnosis
  if (a.type === 'diagnostic_report') {
    const raw = (a.content ?? a) as Record<string, unknown>
    const level   = (raw.estimatedLevel ?? raw.level ?? '?') as string
    const conf    = (raw.confidence ?? 'low') as string
    const count   = (raw.sampleCount ?? 0) as number
    const obs     = Array.isArray(raw.observations) ? raw.observations as string[] : []
    const confColor = conf === 'high' ? 'var(--teal)' : conf === 'medium' ? 'var(--gold)' : 'var(--muted)'
    return (
      <div style={{ marginTop:10, maxWidth:440, borderRadius:16, border:'1px solid rgba(0,201,167,.25)', background:'rgba(0,201,167,.05)', overflow:'hidden' }}>
        <div style={{ padding:'10px 14px', borderBottom:'1px solid rgba(0,201,167,.15)', display:'flex', alignItems:'center', gap:12 }}>
          <span style={{ fontSize:28, fontWeight:800, color:'var(--teal)', lineHeight:1 }}>{level}</span>
          <div>
            <div style={{ fontSize:13, fontWeight:800, color:'#fff' }}>Nivel estimado CEFR</div>
            <div style={{ fontSize:11, color:confColor }}>Confianza: {conf} · {count} muestras</div>
          </div>
        </div>
        {obs.length > 0 && (
          <div style={{ padding:'12px 14px', display:'flex', flexDirection:'column', gap:5 }}>
            {obs.map((o, i) => <div key={i} style={{ fontSize:12, color:'var(--silver)' }}>• {o}</div>)}
          </div>
        )}
      </div>
    )
  }

  // G4: rich_content — general-purpose rich text artifact
  if (a.type === 'rich_content') {
    const raw  = (a.content ?? a) as Record<string, unknown>
    const title = (raw.title ?? '') as string
    const body  = (raw.body  ?? '') as string
    if (!body) return null
    return (
      <div style={{ marginTop:10, maxWidth:560, borderRadius:14, border:'1px solid var(--border)', background:'rgba(255,255,255,.02)', padding:'14px 16px' }}>
        {title && <div style={{ fontSize:14, fontWeight:800, color:'#fff', marginBottom:8 }}>{title}</div>}
        <div style={{ fontSize:14, color:'var(--silver)', lineHeight:1.65 }}
          dangerouslySetInnerHTML={{ __html: fmt(body) }} />
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
          {msg.artifact && <div className="artifact-in"><ArtifactRender a={msg.artifact} /></div>}
          {msg.score !== undefined && <div style={{ fontSize:12, color:'var(--gold)', fontWeight:700 }}>Puntuación: {msg.score}/10</div>}
        </div>
      </div>
      {!isUser && (msg.suggestedActions?.length ?? 0) > 0 && (
        <SuggestedActionBar actions={msg.suggestedActions!}
          onAction={(a) => window.dispatchEvent(new CustomEvent('lingora-suggested-action', { detail: a }))} />
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

async function doExportPdfBackend(msgs: Msg[], ss: SS) {
  if (!msgs.length) return
  const lines = msgs
    .map(m => ({ sender: m.sender === 'user' ? 'Student' : m.sender.toUpperCase(), text: (m.text || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() }))
    .filter(l => l.text.length > 0)
  const transcript = lines.map(l => `[${l.sender}]: ${l.text}`).join('\n\n')
  // FIX-PAGE-C: align with SEEK 3.1 intent-router — use a phrase that classifies
  // as hard_override:export_chat_pdf via the pattern /exporta esta conversaci[oó]n/i
  // Pass transcript as a dedicated field so execution-engine can use it directly
  try {
    const res = await fetch('/api/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'Exporta esta conversación a PDF',
        exportTranscript: transcript,
        state: {
          ...trimStateForPayload(ss as unknown as Record<string, unknown>),
          mentor: ss.mentor,
          lang: ss.lang,
          topic: ss.topic,
          interfaceLanguage: BACKEND_LANG(ss.lang),
        },
      }),
    })
    // SEEK 4.1b — guard before json() (PDF export path)
    if (!res.ok) {
      if (res.status === 413) {
        doExportTxt(msgs) // fallback to text export if PDF payload too large
        return
      }
      throw new Error(`PDF export failed: HTTP ${res.status}`)
    }
    const data = await res.json()
    const artifactUrl = data.artifact?.url
    if (artifactUrl && ['pdf', 'pdf_chat'].includes(data.artifact?.type)) {
      const a = document.createElement('a'); a.href = artifactUrl; a.download = `lingora-session-${Date.now()}.pdf`; a.click()
      return
    }
    doExportTxt(msgs)
  } catch { doExportTxt(msgs) }
}


// ─── SEEK 4.1b: trimStateForPayload ─────────────────────────────────────────
// Removes heavy memory fields before sending state to backend.
// Prevents HTTP 413 from Vercel when sessions grow large (artifacts, curriculum).
// Rule: send operational state only — never memory/payload blobs.
function trimStateForPayload(state: Record<string, unknown>): Record<string, unknown> {
  const trimmed = { ...state };
  // Remove heaviest fields — not needed by backend per-request
  delete trimmed['artifactRegistry'];  // full ArtifactPayload blobs — heaviest field
  // Trim curriculumPlan.modules to last 3 (current + next) to cap plan size
  if (trimmed['curriculumPlan'] && typeof trimmed['curriculumPlan'] === 'object') {
    const cp = trimmed['curriculumPlan'] as Record<string, unknown>;
    if (Array.isArray(cp['modules'])) {
      trimmed['curriculumPlan'] = { ...cp, modules: (cp['modules'] as unknown[]).slice(-3) };
    }
  }
  // Omit masteryByModule in non-structured modes (not needed for conversation)
  if (trimmed['activeMode'] !== 'structured' && trimmed['activeMode'] !== 'pdf_course') {
    delete trimmed['masteryByModule'];
  }
  return trimmed;
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

  const [pendingAudioBlob, setPendingAudioBlob] = useState<Blob | null>(null)
  const [pendingAudioUrl,  setPendingAudioUrl]  = useState<string | null>(null)
  const [pendingFiles,     setPendingFiles]      = useState<Array<{ name: string; type: string; base64: string; size: number }>>([])
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

  const mm   = useMemo(() => MENTOR_META[mentor], [mentor])
  const copy = useMemo(() => COPY[lang] ?? COPY.en, [lang])

  useEffect(() => { sessionRef.current = session }, [session])
  useEffect(() => { mentorRef.current = mentor },   [mentor])
  useEffect(() => { langRef.current   = lang },     [lang])
  useEffect(() => { topicRef.current  = topic },    [topic])
  useEffect(() => { msgsEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [msgs, loading])

  useEffect(() => {
    // SEEK 3.9-c — C3: Selective state restoration from localStorage.
    // BUG: Previous code spread ALL persisted state (...p) including
    // lastConcept, lastUserGoal, curriculumPlan, lastMistake, errorMemory,
    // lastUserAudioTranscript, etc. from a previous session.
    // This caused "ghost memory": Sarah would reference topics from an older
    // session (e.g. "mi amigo el ratón") because lastConcept from that session
    // was being injected into the new session's state payload.
    //
    // LINGORA is stateless by design (Vercel serverless destroys context
    // between invocations). Persistence is intentional only for user
    // PREFERENCES (lang, mentor, topic, activeMode) — not for pedagogical
    // context (lastConcept, curriculumPlan, tokens, etc.).
    //
    // Fix: restore ONLY preference fields. Never restore pedagogical context
    // from localStorage. Each session starts with a clean pedagogical slate.
    try {
      const sv = localStorage.getItem('lng1010')
      if (sv) {
        const p = JSON.parse(sv) as Partial<SS>
        // Restore preferences only — no pedagogical state crosses session boundary
        if (p.lang)       setLang(p.lang)
        if (p.mentor)     setMentor(p.mentor as MK)
        if (p.topic)      setTopic(p.topic as TK)
        if (p.activeMode) setActiveMode(p.activeMode as ActiveMode)
        // Session state starts fresh — only carry forward UI preferences
        // SEEK 3.9-c — C3 FIX (IS build-safe): reset only fields declared in SS.
        // Backend fields (lastConcept, curriculumPlan, errorMemory, etc.) live in
        // SessionState (lib/contracts.ts), not in the frontend SS type. Assigning
        // them here caused TypeScript to reject the updater as incompatible with SS.
        // The ghost-memory fix is achieved by NOT restoring them — they default to
        // undefined/0 when the new session payload reaches the backend with tokens=0.
        setSession(s => ({
          ...s,
          // Preferences — restored selectively (safe to persist across sessions)
          lang:       p.lang       ?? s.lang,
          mentor:     p.mentor     ?? s.mentor,
          topic:      p.topic      ?? s.topic,
          activeMode: (p.activeMode ?? s.activeMode) as ActiveMode | undefined,
          // Pedagogical state — always reset to clean slate (SS-declared fields only)
          tokens:         0,
          level:          'A0',
          samples:        [],
          tutorPhase:     'guide',
          tutorMode:      undefined,
          lessonIndex:    undefined,
          courseActive:   false,
          lastAction:     null,
          awaitingQuizAnswer: false,
          learningStage:  undefined,
          currentModule:  0,
          score:          undefined,
          pdfCourseActive: false,
          currentLessonTopic: undefined,
          currentExercise:    undefined,
          expectedResponseMode: undefined,
          _exerciseAttemptCount: undefined,
          lastTask:       null,
          lastArtifact:   null,
          commercialOffers: [],
          sessionId:      's'+Math.random().toString(36).slice(2),
        }))
      }
    } catch {}
  }, [])
  useEffect(() => { try { localStorage.setItem('lng1010', JSON.stringify(session)) } catch {} }, [session])

  const addMsg = useCallback((m: Omit<Msg,'id'>) => {
    setMsgs(prev => [...prev, { ...m, id: Date.now()+'-'+Math.random().toString(36).slice(2) }])
  }, [])

  const callAPI = useCallback(async (payload: Record<string, unknown>) => {
    setLoading(true)
    try {
      // SEEK 4.1b — no artificial timeout: backend maxDuration=300s, frontend waits
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...payload,
          state: {
            ...trimStateForPayload(sessionRef.current as unknown as Record<string, unknown>),
            mentor:            mentorRef.current,
            lang:              langRef.current,
            topic:             topicRef.current,
            activeMentor:      mentorRef.current,
            topicSystemPrompt: TSYS[topicRef.current],
            activeMode:        sessionRef.current.activeMode,
            // SEEK 3.0 fields
            mentorProfile:     mentorRef.current,
            interfaceLanguage: BACKEND_LANG(langRef.current),
            // FIX-8B: SEEK 3.1 Fase 0-A — semantic state must travel with every request
            // so the orchestrator exercise lock has currentExercise and expectedResponseMode
            currentLessonTopic:    sessionRef.current.currentLessonTopic,
            currentExercise:       sessionRef.current.currentExercise,
            expectedResponseMode:  sessionRef.current.expectedResponseMode,
            _exerciseAttemptCount: sessionRef.current._exerciseAttemptCount,
          }
        }),
      })

      // ── STREAMING path (SSE) ──────────────────────────────────────────────
      const contentType = res.headers.get('content-type') ?? ''
      if (contentType.includes('text/event-stream')) {
        const reader = res.body!.getReader()
        const decoder = new TextDecoder()
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
                if (parsed.state) {
                  setSession(s => {
                    const n = { ...s, ...parsed.state, samples: [...(s.samples ?? []), ...((parsed.state?.samples ?? []).filter((x: string) => !(s.samples ?? []).includes(x)))], sessionId: s.sessionId }
                    sessionRef.current = n
                    return n
                  })
                }
                // F3 — SEEK 3.4: always update artifact and suggestedActions on done.
                const defaultActions = [{ type: 'export_chat_pdf', action: 'export_chat_pdf', label: '📄 Exportar PDF', tone: 'secondary' as const }];
                const finalActions = (parsed.suggestedActions && parsed.suggestedActions.length > 0)
                  ? parsed.suggestedActions
                  : defaultActions;
                setMsgs(prev => prev.map(m => m.id === streamId
                  ? { ...m, artifact: parsed.artifact ?? m.artifact ?? null, suggestedActions: finalActions }
                  : m))
              }
            } catch { /* partial chunk */ }
          }
        }
        return
      }

      // ── Non-streaming path (JSON) ─────────────────────────────────────────
      // SEEK 4.1b — FIX A: guard before json() prevents SyntaxError on non-JSON responses
      if (!res.ok) {
        if (res.status === 413) {
          // FIX B: human message — session stays alive, no reload required
          const lang = langRef.current ?? 'en'
          const msg413 = lang === 'es' || lang === 'no'
            ? 'La sesión acumuló demasiados materiales para esta operación. Continúa con normalidad — el tutor sigue aquí.'
            : 'The session accumulated too much material for this operation. Continue normally — the tutor is still here.'
          addMsg({ sender: mentorRef.current ?? 'ln', text: msg413 })
          // FIX C: trim heavy state locally to break the latch on next request
          setSession(prev => {
            const trimmed = { ...prev }
            delete (trimmed as Record<string, unknown>)['artifactRegistry']
            const patched = { ...trimmed } as typeof prev
            sessionRef.current = patched
            return patched
          })
          return
        }
        // Other non-ok responses
        throw new Error(`HTTP_ERROR_${res.status}`)
      }
      const data = await res.json()
      if (data.state) {
        setSession(s => {
          const n = { ...s, ...data.state, samples: [...(s.samples ?? []), ...((data.state?.samples ?? []).filter((x: string) => !(s.samples ?? []).includes(x)))], sessionId: s.sessionId }
          sessionRef.current = n
          return n
        })
      }
      if (data.diagnostic) { addMsg({ sender:'ln', text: JSON.stringify(data.diagnostic,null,2) }); return }
      const text: string = data.reply ?? data.message ?? data.content ?? ''
      if (!text && !data.artifact) { addMsg({ sender:'ln', text:'No se recibió respuesta. Intenta de nuevo.' }); return }
      addMsg({ sender: mentorRef.current, text: text || 'Material listo:',
        artifact: data.artifact ?? null, score: data.pronunciationScore,
        suggestedActions: (data.suggestedActions && data.suggestedActions.length > 0)
          ? data.suggestedActions
          : [{ type: 'export_chat_pdf', action: 'export_chat_pdf', label: '📄 Exportar PDF', tone: 'secondary' }] })
    } catch (e) {
      // SEEK 4.1b — honest error classification. No abort branch. No raw stack traces.
      const m = e instanceof Error ? e.message : String(e)
      const lang = langRef.current ?? 'en'
      let msg: string
      if (m.includes('429')) {
        msg = 'El servicio está temporalmente ocupado (cuota de API). Espera unos segundos.'
      } else if (m.startsWith('HTTP_ERROR_413')) {
        // Should not reach here (handled above), but belt-and-suspenders
        msg = lang === 'es' || lang === 'no'
          ? 'La sesión es demasiado larga para esta operación. Continúa con normalidad.'
          : 'Session too large for this operation. Continue normally.'
      } else if (m.includes('Failed to fetch') || m.includes('NetworkError') || m.includes('Load failed')) {
        msg = 'No se pudo conectar con el servidor. Verifica tu conexión a internet.'
      } else {
        // Unknown error — show category, not raw exception
        msg = lang === 'es' ? 'Ocurrió un error inesperado. El tutor sigue activo.' : 'An unexpected error occurred. The tutor is still active.'
      }
      addMsg({ sender: mentorRef.current ?? 'ln', text: msg })
    } finally { setLoading(false) }
  }, [addMsg, setMsgs])

  // Suggested action handler
  useEffect(() => {
    const handler = (e: Event) => {
      const a = (e as CustomEvent).detail as { action: string; type?: string; label: string; payload?: Record<string, unknown> }
      if (!a || loading) return
      const actionMessages: Record<string, string> = {
        show_schema: 'Hazme un esquema completo de este tema', show_table: 'Hazme una tabla comparativa de este tema',
        show_matrix: 'Hazme una matriz de análisis', start_quiz: 'Hazme un simulacro de este tema',
        retry_quiz: 'Dame otro simulacro más difícil', retry_module: 'Repite este módulo',
        practice_examples: 'Dame 3 ejemplos guiados para practicar', pronunciation_drill: 'Quiero practicar la pronunciación',
        request_pronunciation: 'Evalúa mi pronunciación', deepen_topic: 'Profundiza más en este tema',
        request_explanation: 'Explícame esto con más detalle', next_module: 'Siguiente bloque',
        continue_lesson: 'Continúa con la lección', switch_mode: 'Cambiar a curso estructurado',
        switch_mentor: 'Cambiar de mentor', change_depth: 'Cambia la profundidad',
        download_pdf: 'Genera el PDF de este material', export_chat_pdf: 'Exporta esta conversación a PDF',
        download_course_pdf: 'Descarga el curso completo en PDF', review_errors: 'Repasa mis errores recurrentes',
        request_correction: 'Corrige lo que he escrito', request_translation: 'Traduce esto',
        hear_audio: 'Lee esto en voz alta', show_schema_pro: 'Hazme un esquema avanzado',
        show_image: 'Genera un diagrama visual de este tema', start_course: 'Empezamos el curso',
        resume_course: 'Continúa el curso donde lo dejamos', choose_examples: 'Ver ejemplos reales',
        choose_exercise: 'Hacer un ejercicio', request_immersion: 'Cuéntame sobre la inmersión',
        diagnostic_start: 'Evalúa mi nivel de español',
      }
      const actionKey = a.action ?? a.type ?? ''
      const msg = actionMessages[actionKey] ?? a.label
      addMsg({ sender: 'user', text: msg })
      // FIX-TRANSCRIPT-A — SEEK 3.9: export_chat_pdf via suggested action button
      // must include exportTranscript so the backend PDF contains the real chat
      // history. Without this, only the trigger phrase arrives at the backend.
      if (actionKey === 'export_chat_pdf') {
        const transcript = msgs
          .map(m => ({
            sender: m.sender === 'user' ? 'Student' : m.sender.toUpperCase(),
            text: (m.text || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
          }))
          .filter(l => l.text.length > 0)
          .map(l => `[${l.sender}]: ${l.text}`)
          .join('\n\n')
        callAPI({ message: msg, exportTranscript: transcript })
      } else {
        callAPI({ message: msg })
      }
    }
    window.addEventListener('lingora-suggested-action', handler)
    return () => window.removeEventListener('lingora-suggested-action', handler)
  }, [loading, addMsg, callAPI, msgs])

  // Roadmap step handler
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

  // ── Unified send ──────────────────────────────────────────────────────────
  const sendComposer = useCallback(async () => {
    const msg      = input.trim()
    const hasText  = msg.length > 0
    const hasAudio = pendingAudioBlob !== null
    const hasFiles = pendingFiles.length > 0
    if (!hasText && !hasAudio && !hasFiles) return
    if (loading) return

    setInput('')
    if (taRef.current) taRef.current.style.height = 'auto'

    if (hasText) {
      addMsg({ sender:'user', text: msg })
      setSession(s => { const n = {...s, samples:[...s.samples,msg]}; sessionRef.current = n; return n })
    }

    const payload: Record<string, unknown> = {}
    if (hasText) payload.message = msg
    // FIX-TRANSCRIPT-B — SEEK 3.9: detect export intent from typed message and
    // inject exportTranscript so the backend PDF contains the real chat history.
    // Without this, typing "Exporta esta conversación a PDF" produces an empty PDF.
    const EXPORT_RE = /\bexport(a|ar)?\b.*\bpdf\b|\bexporta\b|export.*chat/i
    if (hasText && EXPORT_RE.test(msg)) {
      const transcript = msgs
        .map(m => ({
          sender: m.sender === 'user' ? 'Student' : m.sender.toUpperCase(),
          text: (m.text || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
        }))
        .filter(l => l.text.length > 0)
        .map(l => `[${l.sender}]: ${l.text}`)
        .join('\n\n')
      payload.exportTranscript = transcript
    }

    if (hasAudio) {
      const evalKeywords = ['pronuncia', 'pronunciación', 'pronunciacion', 'califica mi', 'evalúa mi', 'evalua mi', 'cómo sueno', 'como sueno', 'corrige mi pronunciación']
      const inPronMode   = sessionRef.current.tutorPhase === 'pronunciation' || sessionRef.current.lastAction === 'pronunciation'
      const userWantsEval = evalKeywords.some(k => msg.toLowerCase().includes(k))
      if ((inPronMode || userWantsEval) && msgs.length > 0) {
        const lastMentorMsg = [...msgs].reverse().find(m => m.sender !== 'user' && m.sender !== 'ln' && m.text?.length > 10)
        if (lastMentorMsg?.text) {
          const rawTarget     = lastMentorMsg.text.replace(/<[^>]+>/g, '').trim()
          const firstSentence = rawTarget.split(/[.!?]/)[0]?.trim()
          const target        = firstSentence && firstSentence.length > 5 && firstSentence.length < 120 ? firstSentence : rawTarget.slice(0, 120)
          if (target.length > 5) payload.pronunciationTarget = target
        }
      }
    }

    if (hasAudio && pendingAudioBlob) {
      if (!hasText) addMsg({ sender:'user', text:'🎤 Audio enviado', audioUrl: pendingAudioUrl ?? undefined })
      else setMsgs(prev => prev.map(m => m.id === prev[prev.length-1]?.id ? { ...m, audioUrl: pendingAudioUrl ?? undefined } : m))
      const audioDataUrl = await new Promise<string>(res => {
        const r = new FileReader(); r.onload = () => res(r.result as string); r.readAsDataURL(pendingAudioBlob)
      })
      payload.audioDataUrl  = audioDataUrl
      payload.audioMimeType = pendingAudioBlob.type || 'audio/webm'
    }

    if (hasFiles) {
      const imageFile = pendingFiles.find(f => f.type.startsWith('image/'))
      const imageUrl  = imageFile ? `data:${imageFile.type};base64,${imageFile.base64}` : undefined
      if (!hasText && !hasAudio) addMsg({ sender:'user', text:`📎 ${pendingFiles.map(f=>f.name).join(', ')}`, imageUrl })
      else if (imageUrl) setMsgs(prev => prev.map((m, i) => i === prev.length-1 ? { ...m, imageUrl } : m))
      payload.files = pendingFiles
    }

    setPendingAudioBlob(null); setPendingAudioUrl(null); setPendingFiles([])
    await callAPI(payload)
  }, [input, loading, pendingAudioBlob, pendingAudioUrl, pendingFiles, msgs, addMsg, callAPI])

  const startChat = useCallback((m: MK, t: TK, l: Lang) => {
    setMentor(m); setTopic(t); setLang(l)
    mentorRef.current = m; topicRef.current = t; langRef.current = l
    setSession(s => { const n = {...s, mentor:m, topic:t, lang:l}; sessionRef.current = n; return n })
    const c = COPY[l] ?? COPY.en
    setSplashMsg(c.lnw); setSplashRev(false); setPhase('splash')
    setTimeout(() => setSplashRev(true), 1800)
    setTimeout(() => setPhase('mode'), 3600)
  }, [])

  const selectMode = useCallback((mode: ActiveMode) => {
    setActiveMode(mode)
    setSession(s => { const n = { ...s, activeMode: mode }; sessionRef.current = n; return n })
    setPhase('chat')
    const m = mentorRef.current; const l = langRef.current
    const modeLabels: Record<ActiveMode, string> = {
      interact: '🧠 Interacción inteligente', structured: '🎓 Curso estructurado', pdf_course: '📄 Curso PDF', free: '💬 Conversación libre',
    }
    if (mode === 'structured' || mode === 'pdf_course') {
      setMsgs([{ id:'init', sender:m, text:`${modeLabels[mode]} activado. Preparando tu ruta...` }])
      setTimeout(() => {
        const topicLabel = topicRef.current
        callAPI({ message: `Modo seleccionado: ${modeLabels[mode]}. Tema: ${topicLabel}. Nivel: ${sessionRef.current.level ?? 'A1'}. Por favor muestra la hoja de ruta.`, activeMode: mode })
      }, 400)
    } else {
      const greeting = GREETINGS[m][l] ?? GREETINGS[m].en ?? GREETINGS[m].es ?? ''
      const modeNote = mode === 'free' ? '' : '\n\n_Modo interacción inteligente activo — respondo con tablas y esquemas cuando el contenido lo merece._'
      setMsgs([{ id:'init', sender:m, text: greeting + (mode !== 'free' ? modeNote : '') }])
    }
  }, [callAPI])

  const toggleRec = useCallback(async () => {
    if (recording) { mrRef.current?.stop(); setRecording(false); return }
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
        setPendingAudioBlob(blob); setPendingAudioUrl(url)
      }
      rec.start(); mrRef.current = rec; setRecording(true)
    } catch (e) { addMsg({ sender:'ln', text:`Micrófono no disponible: ${e instanceof Error ? e.message : String(e)}` }) }
  }, [recording, pendingAudioUrl, addMsg])

  const handleFile = useCallback(async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return
    const r = new FileReader()
    r.onload = () => { const b64 = (r.result as string).split(',')[1] || ''; setPendingFiles(prev => [...prev, { name: file.name, type: file.type, base64: b64, size: file.size }]) }
    r.readAsDataURL(file); e.target.value = ''
  }, [])

  // ─── Render ──────────────────────────────────────
  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=DM+Sans:wght@300;400;500;600;700;800&display=swap');
        :root { --navy:#080f1f; --navy2:#0d1828; --navy3:#132035; --teal:#00c9a7; --coral:#ff6b6b; --gold:#f5c842; --silver:rgba(255,255,255,.88); --muted:rgba(255,255,255,.50); --dim:rgba(255,255,255,.22); --border:rgba(255,255,255,.08); --card:rgba(255,255,255,.04); }
        *, *::before, *::after { box-sizing:border-box; margin:0; padding:0 }
        html, body { height:100%; overflow:hidden }
        body { font-family:'DM Sans',system-ui,sans-serif; background:radial-gradient(circle at top,#0a1730 0%,#081120 55%,#050b15 100%); color:var(--silver); }
        @keyframes tdot { 0%,60%,100%{opacity:.3;transform:translateY(0)} 30%{opacity:1;transform:translateY(-4px)} }
        @keyframes fadeUp { from{opacity:0;transform:translateY(16px)} to{opacity:1;transform:translateY(0)} }
        @keyframes fadeIn { from{opacity:0} to{opacity:1} }
        @keyframes pulse { 0%,100%{opacity:.6} 50%{opacity:1} }
        @keyframes artifactIn { from{opacity:0;transform:translateY(12px) scale(.98)} to{opacity:1;transform:translateY(0) scale(1)} }
        .fade-up { animation: fadeUp .5s cubic-bezier(.22,1,.36,1) both }
        .artifact-in { animation: artifactIn .4s cubic-bezier(.22,1,.36,1) both }
        ::-webkit-scrollbar { width:5px } ::-webkit-scrollbar-thumb { background:var(--border); border-radius:999px }
        textarea:focus, button:focus, input:focus, select:focus { outline:none }
      `}</style>

      {/* ── MODE CHOOSER ─────────────────────────────────────────────────── */}
      {phase === 'mode' && (
        <div style={{ flex:1, overflowY:'auto', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:'32px 20px', gap:24 }}>
          <div style={{ display:'flex', alignItems:'center', gap:10 }}>
            <div style={{ width:42, height:42, borderRadius:'50%', background:mm.color, display:'flex', alignItems:'center', justifyContent:'center', fontSize:16, fontWeight:800, color:'#fff' }}>{mm.code}</div>
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
              <button key={key} onClick={() => selectMode(key)}
                style={{ display:'flex', alignItems:'center', gap:14, padding:'14px 16px', borderRadius:16, border: activeMode === key ? '1px solid rgba(0,201,167,.4)' : '1px solid var(--border)', background: activeMode === key ? 'rgba(0,201,167,.1)' : 'rgba(255,255,255,.02)', cursor:'pointer', textAlign:'left', transition:'all .15s', width:'100%' }}>
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

      {/* ── ONBOARDING ───────────────────────────────────────────────────── */}
      {phase === 'onboarding' && (
        <div style={{ position:'fixed', inset:0, overflowY:'auto', display:'flex', justifyContent:'center', padding:'32px 20px 48px' }}>
          <div style={{ width:'100%', maxWidth:620, animation:'fadeIn .4s ease both' }}>
            <div style={{ textAlign:'center', marginBottom:32, paddingTop:8 }}>
              <div style={{ fontFamily:'"DM Serif Display",serif', fontSize:'clamp(2.5rem,6vw,3.8rem)', fontWeight:400, letterSpacing:'-.03em', background:'linear-gradient(135deg,#fff 38%,var(--teal))', WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent', marginBottom:8 }}>LINGORA</div>
              <div style={{ fontSize:13, color:'var(--muted)', letterSpacing:'.04em' }}>{copy.tg}</div>
            </div>
            <div style={{ background:'rgba(255,255,255,.03)', border:'1px solid var(--border)', borderRadius:24, padding:'28px 24px', display:'flex', flexDirection:'column', gap:28 }}>
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
              <button onClick={() => startChat(mentor, topic, lang)} disabled={!lang || !topic || !mentor}
                style={{ background:'var(--teal)', color:'var(--navy)', fontWeight:800, fontSize:16, padding:15, borderRadius:999, border:'none', cursor:'pointer', transition:'all .2s', opacity: (!lang||!topic||!mentor) ? .5 : 1 }}>
                {copy.sb}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── SPLASH ──────────────────────────────────────────────────────── */}
      {phase === 'splash' && (
        <div style={{ position:'fixed', inset:0, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:'2rem', animation:'fadeIn .4s ease both' }}>
          <div style={{ marginBottom:28, display:'flex', flexDirection:'column', alignItems:'center', gap:12 }}>
            <div style={{ width:64, height:64, borderRadius:'50%', background:'linear-gradient(135deg,var(--teal),#0891b2)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:11, fontWeight:800, color:'var(--navy)', letterSpacing:'.05em', boxShadow:'0 0 32px rgba(0,201,167,.3)' }}>LN</div>
            <div style={{ fontFamily:'"DM Serif Display",serif', fontSize:22, color:'#fff', fontWeight:400 }}>LINGORA</div>
          </div>
          <p style={{ fontSize:16, color:'var(--muted)', textAlign:'center', maxWidth:400, lineHeight:1.7, marginBottom:40 }}>{splashMsg}</p>
          {splashRev && (
            <div style={{ animation:'fadeUp .5s ease both', textAlign:'center', display:'flex', flexDirection:'column', alignItems:'center', gap:10 }}>
              <div style={{ width:72, height:72, borderRadius:'50%', background:mm.bg, border:`2px solid ${mm.color}`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:28, boxShadow:`0 0 28px ${mm.color}44` }}>{mm.emoji}</div>
              <div style={{ fontSize:11, fontWeight:800, letterSpacing:'.1em', textTransform:'uppercase', color:mm.color }}>{mm.code} · LINGORA</div>
              <div style={{ fontFamily:'"DM Serif Display",serif', fontSize:24, color:'#fff' }}>{mm.name}</div>
              <div style={{ fontSize:13, color:'var(--muted)', maxWidth:300, lineHeight:1.6 }}>{copy.bio[MENTOR_KEYS.indexOf(mentor)] ?? mm.spec}</div>
            </div>
          )}
          <div style={{ position:'absolute', bottom:40, display:'flex', gap:6 }}>
            {[0,200,400].map(d => <span key={d} style={{ width:6, height:6, borderRadius:'50%', background:'var(--teal)', display:'inline-block', animation:`pulse 1.4s ${d}ms infinite` }} />)}
          </div>
        </div>
      )}

      {/* ── CHAT ────────────────────────────────────────────────────────── */}
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
              {(() => {
                const tok = session.tokens ?? 0; const lesson = (session.lessonIndex ?? 0) + 1
                const inLesson = tok % 10; const pct = Math.min(100, Math.round((inLesson / 10) * 100))
                const ph = session.tutorPhase ?? 'guide'
                return (
                  <div style={{ marginTop:4 }}>
                    <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:3 }}>
                      <span style={{ fontSize:10, color:'var(--muted)' }}>Lección {lesson} · {inLesson}/10</span>
                      <span style={{ fontSize:10, color:'var(--dim)', marginLeft:'auto' }}>{ph}</span>
                    </div>
                    <div style={{ height:3, borderRadius:99, background:'rgba(255,255,255,.08)', overflow:'hidden' }}>
                      <div style={{ height:'100%', width:`${pct}%`, background:`linear-gradient(90deg,${mm.color},var(--teal))`, borderRadius:99, transition:'width .4s ease' }} />
                    </div>
                  </div>
                )
              })()}
            </div>
            <div style={{ display:'flex', gap:5, alignItems:'center', flexShrink:0 }}>
              <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:1 }}>
                <span style={{ fontSize:12, fontWeight:800, color:'var(--teal)', lineHeight:1 }}>{session.level}</span>
                <span style={{ fontSize:9, color:'var(--dim)', letterSpacing:'.04em' }}>nivel</span>
              </div>
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
              {/* FIX-8C: reset clears SEEK 3.1 Fase 0-A semantic state fields */}
              <button onClick={() => {
                setMsgs([])
                setSession(s => ({
                  ...s,
                  tokens:0, level:'A0', samples:[], lastTask:null, lastArtifact:null,
                  tutorPhase:'guide', lessonIndex:0, courseActive:false, lastAction:null,
                  awaitingQuizAnswer:false, activeMode:'interact' as ActiveMode, learningStage:undefined,
                  currentModule:undefined, score:undefined, pdfCourseActive:false,
                  // SEEK 3.1 Fase 0-A — must be cleared to prevent stale exercise state
                  currentLessonTopic:   undefined,
                  currentExercise:      undefined,
                  expectedResponseMode: undefined,
                  _exerciseAttemptCount:undefined,
                }))
                setActiveMode('interact')
                setPhase('onboarding')
              }} style={{ fontSize:11, padding:'5px 10px', borderRadius:999, border:'1px solid var(--border)', background:'none', color:'var(--muted)', cursor:'pointer' }}>↺</button>
            </div>
          </div>

          {/* Messages */}
          <div style={{ flex:1, overflowY:'auto', padding:'20px 16px', display:'flex', flexDirection:'column', gap:14 }} onClick={() => showExport && setShowExport(false)}>
            {msgs.map(m => <Bubble key={m.id} msg={m} mc={mm.color} />)}
            {loading && <Typing mc={mm.color} />}
            <div ref={msgsEndRef} />
          </div>

          <div style={{ textAlign:'center', fontSize:11, color:'var(--dim)', padding:'3px 0', flexShrink:0 }}>{copy.hint}</div>

          {/* Composer */}
          <div style={{ borderTop:'1px solid var(--border)', background:'rgba(8,17,32,.9)', backdropFilter:'blur(10px)', flexShrink:0 }}>
            {(pendingAudioUrl || pendingFiles.length > 0) && (
              <div style={{ padding:'8px 12px 0', display:'flex', flexDirection:'column', gap:6 }}>
                {pendingAudioUrl && (
                  <div style={{ display:'flex', alignItems:'center', gap:8, padding:'6px 10px', borderRadius:10, background:'rgba(0,201,167,.08)', border:'1px solid rgba(0,201,167,.2)' }}>
                    <span style={{ fontSize:13 }}>🎤</span>
                    <audio controls src={pendingAudioUrl} style={{ flex:1, height:28, minWidth:0 }} />
                    <button onClick={() => { URL.revokeObjectURL(pendingAudioUrl!); setPendingAudioUrl(null); setPendingAudioBlob(null) }}
                      style={{ width:22, height:22, borderRadius:'50%', border:'none', background:'rgba(255,107,107,.2)', color:'var(--coral)', fontSize:12, cursor:'pointer', flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center' }}>✕</button>
                  </div>
                )}
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
            <div style={{ padding:'9px 12px 13px', display:'flex', alignItems:'flex-end', gap:8 }}>
              <button onClick={toggleRec} title={recording ? 'Detener grabación' : 'Grabar audio'}
                style={{ width:38, height:38, borderRadius:'50%', border:`1px solid ${recording ? 'var(--coral)' : 'var(--border)'}`, background: recording ? 'rgba(255,107,107,.1)' : 'transparent', color: recording ? 'var(--coral)' : 'var(--muted)', fontSize:15, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, transition:'all .2s' }}>
                {recording ? '⏹' : '🎤'}
              </button>
              <label title="Adjuntar archivo"
                style={{ width:38, height:38, borderRadius:'50%', border:'1px solid var(--border)', background:'transparent', color:'var(--muted)', fontSize:15, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                📎
                <input ref={fileInputRef} type="file" accept="image/*,application/pdf,text/*,audio/*" onChange={handleFile} style={{ display:'none' }} />
              </label>
              <textarea ref={taRef} value={input}
                onChange={e => { setInput(e.target.value); e.target.style.height='auto'; e.target.style.height=Math.min(e.target.scrollHeight,120)+'px' }}
                onKeyDown={e => { if ((e.ctrlKey||e.metaKey) && e.key==='Enter') { e.preventDefault(); void sendComposer() } }}
                placeholder={copy.ph} rows={1}
                style={{ flex:1, background:'var(--navy2)', border:'1px solid var(--border)', borderRadius:14, padding:'10px 14px', fontSize:14, color:'var(--silver)', resize:'none', maxHeight:120, lineHeight:1.5, fontFamily:'inherit', transition:'border-color .2s' }}
                onFocus={e => (e.target.style.borderColor = 'rgba(0,201,167,.4)')}
                onBlur={e  => (e.target.style.borderColor = 'var(--border)')}
              />
              <button onClick={() => void sendComposer()}
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
