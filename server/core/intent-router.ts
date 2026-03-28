// =============================================================================
// server/core/intent-router.ts
// LINGORA SEEK 3.2 — Deterministic Intent Classifier
// =============================================================================
// Purpose  : Classify user intent deterministically before orchestration.
//            Returns an IntentResult that the orchestrator uses to choose
//            the correct execution branch.
//
//            THIS MODULE:
//            ✅ Classifies intent
//            ✅ Returns IntentResult
//            ❌ Does NOT execute anything
//            ❌ Does NOT call any LLM
//            ❌ Does NOT produce artifacts
//            ❌ Does NOT route to mentors or tools
//            ❌ Does NOT modify state
//
// Performance target : < 10ms per classification (rule-based, no I/O)
//
// Riesgo principal   : Pattern drift — new user phrases not covered by rules
//                      fall through to 'conversation' (safe default). Review
//                      patterns after each sprint based on real usage logs.
//
// Dependencia        : lib/contracts.ts (IntentResult, IntentType, SessionState)
//
// Commit   : feat(intent-router): SEEK 3.0 — deterministic intent classification,
//            no LLM, no side effects, < 10ms
// =============================================================================

import {
  IntentResult,
  IntentType,
  IntentSubtype,
  SessionState,
  ActiveMode,
} from '../../lib/contracts';

// ─────────────────────────────────────────────────────────────────────────────
// PATTERN DEFINITIONS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * PatternRule — a single classification rule.
 * Evaluated in priority order. First match wins.
 */
interface PatternRule {
  type: IntentType;
  subtype?: IntentSubtype;
  /** Confidence to assign on match (0.0–1.0) */
  confidence: number;
  /** If true, the intent was explicitly stated by the user */
  explicit: boolean;
  /** Regex patterns tested against normalized message (lowercase, trimmed) */
  patterns: RegExp[];
  /** Optional: only apply this rule in these active modes */
  onlyInModes?: ActiveMode[];
  /** Optional: do NOT apply this rule in these active modes */
  notInModes?: ActiveMode[];
}

// ─────────────────────────────────────────────────────────────────────────────
// HARD OVERRIDE PATTERNS — highest priority, bypass all pedagogy
// ─────────────────────────────────────────────────────────────────────────────

const HARD_OVERRIDE_RULES: PatternRule[] = [
  // Translation
  {
    type: 'hard_override',
    subtype: 'translate',
    confidence: 0.99,
    explicit: true,
    patterns: [
      /^traduc[ei]/i,
      /\btraduc[ei]\b/i,
      /\btranslat[ei]\b/i,
      /^translat[ei]/i,
      /\bhow do (you |we )?say\b/i,
      /\bwhat (does|is) .{1,60} in (english|spanish|español|inglés)\b/i,
      /\bcómo se dice\b/i,
    ],
  },
  // Correction
  {
    type: 'hard_override',
    subtype: 'correct',
    confidence: 0.99,
    explicit: true,
    patterns: [
      /^corrige\b/i,
      /\bcorrige (esto|este|esta|mi)\b/i,
      /\bcorrect (this|my|the following)\b/i,
      /\bcheck my\b/i,
      /\bfix (this|my)\b/i,
      /\b(what'?s|what is) wrong with\b/i,
      /\berrors? in\b/i,
      /\bgrammar check\b/i,
      /\bpor favor corrige\b/i,
    ],
  },
  // Transcription
  {
    type: 'hard_override',
    subtype: 'transcribe',
    confidence: 0.98,
    explicit: true,
    patterns: [
      /\btranscri(be|bir|beme|be this)\b/i,
      /\bwhat did (i|she|he) say\b/i,
      /\bconvert (audio|voice|recording) to text\b/i,
    ],
  },
  // Export chat PDF
  {
    type: 'hard_override',
    subtype: 'export_chat_pdf',
    confidence: 0.99,
    explicit: true,
    patterns: [
      /\bexport(a|ar)?\b.*\bpdf\b/i,
      /\bdescargar?\b.*\bconversaci[oó]n\b/i,
      /\bguardar?\b.*\bchat\b/i,
      /\bsave (this )?(chat|conversation)\b/i,
      /\bpdf (of |del )?(this |esta )?(chat|conversation|conversaci[oó]n)\b/i,
      /exporta esta conversaci[oó]n/i,
    ],
  },
  // Generate course PDF
  {
    type: 'hard_override',
    subtype: 'generate_course_pdf',
    confidence: 0.99,
    explicit: true,
    patterns: [
      /\bdescargar?\b.*\bcurso\b/i,
      /\bcourse pdf\b/i,
      /\bgenera(te)?\b.*\bcourse\b.*\bpdf\b/i,
      /\bexport(a|ar)?\b.*\bcurso\b/i,
      // FIX-9C: user asks for a lesson/content in PDF format
      /\b(lecci[oó]n|material|contenido).*\bpdf\b/i,
      /\bpdf\b.*(lecci[oó]n|material|completo|nivel)/i,
      /\ben pdf\b/i,
      /\b(dame|quiero|genera|crea)\b.*\bpdf\b/i,
    ],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// DIAGNOSTIC PATTERNS
// ─────────────────────────────────────────────────────────────────────────────

const DIAGNOSTIC_RULES: PatternRule[] = [
  {
    type: 'diagnostic',
    confidence: 0.95,
    explicit: true,
    patterns: [
      /\beval[uú]a(me|r)?\b.*\bnivel\b/i,
      /\bwhat (is|'?s) my (level|spanish level)\b/i,
      /\bcheck my (level|spanish)\b/i,
      /\btest my (level|spanish|knowledge)\b/i,
      /\bcefr (level|test)\b/i,
      /\b(determine|assess) my level\b/i,
      /\bdónde estoy\b.*\bespañol\b/i,
    ],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// CURRICULUM REQUEST PATTERNS — strong course requests
// ─────────────────────────────────────────────────────────────────────────────

const LEARN_RULES: PatternRule[] = [
  // Strong curriculum request
  {
    type: 'learn',
    subtype: 'curriculum_request',
    confidence: 0.95,
    explicit: true,
    patterns: [
      /\bcu(r|rs)so completo\b/i,
      /\bcomplete course\b/i,
      /\bdesde cero hasta\b/i,
      /\bfrom (zero|scratch|beginner) to (expert|advanced|fluent)\b/i,
      /\bens[eé][ñn]ame .{3,60} (desde cero|completo|curso)/i,
      /\bquiero aprender .{3,60} de (cero|principio|nada)\b/i,
      /\bi want (a|to learn a?) (full|complete|structured) course\b/i,
      /\bcreate (a )?course (on|about|for)\b/i,
      /\bgenera (un )?curso\b/i,
    ],
  },
  // Topic lesson request
  {
    type: 'learn',
    subtype: 'topic_lesson',
    confidence: 0.85,
    explicit: true,
    patterns: [
      /\bexplica(me)?\b/i,
      /\bexplain\b/i,
      /\bhow (does|do|to use)\b.{3,60}\bwork\b/i,
      /\bteach me\b/i,
      /\bens[eé][ñn]ame\b/i,
      /\bwhat (is|are)\b.{2,40}\bin spanish\b/i,
      /\bwhat does\b.{2,40}\bmean\b/i,
      /\bqué (es|significa|son)\b/i,
    ],
  },
  // Grammar explanation
  {
    type: 'learn',
    subtype: 'grammar_explanation',
    confidence: 0.90,
    explicit: true,
    patterns: [
      /\bsubjunctive\b/i,
      /\bsubjuntivo\b/i,
      /\bconjugat(e|ion|ions)\b/i,
      /\bconjuga(r|ción)\b/i,
      /\bser vs estar\b/i,
      /\bpor vs para\b/i,
      /\b(preterite|imperfect|conditional|future) (tense|form)\b/i,
      /\b(pretérito|imperfecto|condicional|futuro)\b/i,
      /\bgrammar\b/i,
      /\bgramática\b/i,
      /\bregla(s)?\b.*\besp/i,
    ],
  },
  // Vocabulary request
  {
    type: 'learn',
    subtype: 'vocabulary_request',
    confidence: 0.85,
    explicit: true,
    patterns: [
      /\bvocabulary\b/i,
      /\bvocabulario\b/i,
      /\bwords? for\b/i,
      /\bpalab(ra|ras)\b/i,
      /\bhow (do you|do i|to) say\b/i,
      /\bwhat('?s| is) the (word|expression|phrase) for\b/i,
    ],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// PRACTICE PATTERNS
// ─────────────────────────────────────────────────────────────────────────────

const PRACTICE_RULES: PatternRule[] = [
  {
    type: 'practice',
    confidence: 0.90,
    explicit: true,
    patterns: [
      /\bpractice\b/i,
      /\bpractica(r|me)?\b/i,
      /\bquiz\b/i,
      /\btest me\b/i,
      /\bej[eé]rcicio(s)?\b/i,
      /\bexercise(s)?\b/i,
      /\bdr[ií]ll(s)?\b/i,
      /\blet('?s)? practice\b/i,
      /\bpong(ame|áme|ame) a prueba\b/i,
    ],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// ARTIFACT REQUEST PATTERNS
// ─────────────────────────────────────────────────────────────────────────────

const ARTIFACT_RULES: PatternRule[] = [
  {
    type: 'artifact',
    subtype: 'table_matrix',
    confidence: 0.95,
    explicit: true,
    patterns: [
      /\bmatriz\b/i,
      /\bmatrix\b/i,
      /\bcomparison matrix\b/i,
      /\btabla (comparativa|de comparaci[oó]n)\b/i,
    ],
  },
  {
    type: 'artifact',
    subtype: 'schema_pro',
    confidence: 0.92,
    explicit: true,
    patterns: [
      /\bschema pro\b/i,
      /\besquema (pro|avanzado|completo|detallado)\b/i,
      /\bvisual schema\b/i,
      /\bvisual (summary|resumen)\b/i,
    ],
  },
  {
    type: 'artifact',
    subtype: 'schema',
    confidence: 0.90,
    explicit: true,
    patterns: [
      /\besquema\b/i,
      /\bschema\b/i,
      /\bsummary (card|chart)\b/i,
      /\bresumen visual\b/i,
      /\bcheat sheet\b/i,
    ],
  },
  {
    type: 'artifact',
    subtype: 'table',
    confidence: 0.90,
    explicit: true,
    patterns: [
      /\btabla\b/i,
      /\b(comparison |conjugation )?table\b/i,
      /\bcomparar\b/i,
      /\bconjugation chart\b/i,
      /\btabla de conjugaci[oó]n\b/i,
    ],
  },
  {
    type: 'artifact',
    subtype: 'roadmap',
    confidence: 0.90,
    explicit: true,
    patterns: [
      /\broadmap\b/i,
      /\blearning path\b/i,
      /\bcourse map\b/i,
      /\bmapa (del curso|de aprendizaje)\b/i,
    ],
  },
  {
    type: 'artifact',
    subtype: 'illustration',
    confidence: 0.88,
    explicit: true,
    patterns: [
      /\billustration\b/i,
      /\binfographic\b/i,
      /\bimage (of|for|showing)\b/i,
      /\bdraw\b/i,
      /\bvisual(iza|ize)\b/i,
      /\bcrea (una )?imagen\b/i,
    ],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// ALL RULES IN PRIORITY ORDER
// ─────────────────────────────────────────────────────────────────────────────

const ALL_RULES: PatternRule[] = [
  ...HARD_OVERRIDE_RULES,   // priority 1 — always checked first
  ...DIAGNOSTIC_RULES,       // priority 2
  ...LEARN_RULES,            // priority 3
  ...ARTIFACT_RULES,         // priority 4
  ...PRACTICE_RULES,         // priority 5
  // conversation is the fallthrough default — no patterns needed
];

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * classifyIntent
 * ──────────────────────────────────────────────────────────────────────────
 * Deterministically classifies the user's intent from the message text
 * and current session state. No LLM. No async. No side effects.
 *
 * Algorithm:
 * 1. Normalize message (lowercase, trim)
 * 2. Evaluate rules in priority order
 * 3. First matching rule wins
 * 4. If no rule matches, return 'conversation' (safe default)
 *
 * @param message   Raw user message text
 * @param state     Current session state (used for mode-specific rules)
 * @param hasFiles  True if the request includes file attachments
 * @param hasAudio  True if the request includes audio input
 */
export function classifyIntent(
  message: string,
  state: SessionState,
  hasFiles: boolean = false,
  hasAudio: boolean = false,
): IntentResult {
  const normalized = message.toLowerCase().trim();

  // ── Special case: audio input without text ────────────────────────────────
  // Audio without message = transcription request
  if (hasAudio && (!message || message.trim() === '')) {
    return {
      type: 'hard_override',
      subtype: 'transcribe',
      explicit: true,
      confidence: 0.99,
      matchedPattern: 'audio_without_text',
    };
  }

  // ── Special case: SEEK diagnostic trigger ────────────────────────────────
  if (normalized === '*1357*#') {
    return {
      type: 'diagnostic',
      explicit: true,
      confidence: 1.0,
      matchedPattern: 'seek_diagnostic_trigger',
    };
  }

  // ── Evaluate all rules in order ───────────────────────────────────────────
  for (const rule of ALL_RULES) {
    // Skip if mode restriction applies
    if (rule.onlyInModes && !rule.onlyInModes.includes(state.activeMode)) {
      continue;
    }
    if (rule.notInModes && rule.notInModes.includes(state.activeMode)) {
      continue;
    }

    // Test each pattern
    for (const pattern of rule.patterns) {
      if (pattern.test(normalized)) {
        return {
          type: rule.type,
          subtype: rule.subtype,
          explicit: rule.explicit,
          confidence: rule.confidence,
          matchedPattern: pattern.source,
        };
      }
    }
  }

  // ── Default: conversation fallthrough ─────────────────────────────────────
  // ── P1: PRONUNCIATION EVALUATION ────────────────────────────────────────
  // Must be checked before conversation fallback.
  // evaluatePronunciation is a hard_override — blocks all pedagogy.
  const pronunciationPatterns = [
    /\bcalifica?\s+(mi\s+)?pronunciaci[oó]n\b/i,
    /\bc[oó]mo\s+(sueno|pronuncio)\b/i,
    /\beval[uú]a\s+(mi\s+)?(pronunciaci[oó]n|acento)\b/i,
    /\bcorrige\s+mi\s+pronunciaci[oó]n\b/i,
    /\b(pronunciation|pronounce)\s+(check|eval|feedback)\b/i,
    /\bhow\s+(do\s+i\s+sound|is\s+my\s+pronunciation)\b/i,
    /\brate\s+my\s+(pronunciation|accent)\b/i,
    /\bvurder\s+uttalen?\s+(min(e)?)\b/i,
  ];
  if (pronunciationPatterns.some(p => p.test(message))) {
    return {
      type: 'hard_override',
      subtype: 'pronunciation_eval',
      explicit: true,
      confidence: 0.93,
      matchedPattern: 'pronunciation_eval',
    };
  }

  // ── P3: RICH TABLE / TABLE_MATRIX ────────────────────────────────────────
  // "tabla de 8 columnas", "tabla con emojis/vectores", verb conjugation tables
  // Must be checked BEFORE the generic 'table' artifact rule above.
  const richTablePatterns = [
    /\btabla\b.*\b\d+\s*colum/i,
    /\btabla\b.*(emoji|vector|color|icon)/i,
    /\btabla\b.*(irregulares|irregular|conjugaci)/i,
    /\btabla\b.*(personas|yo.*t[uú].*[eé]l)/i,
    /\btabla\b.*(completa|completo|todas\s+las\s+personas)/i,
    /\bmatriz\s+(de\s+)?(verbos?|tiempos?|conjugaci)/i,
  ];
  if (richTablePatterns.some(p => p.test(message))) {
    return {
      type: 'artifact',
      subtype: 'table_matrix',
      explicit: true,
      confidence: 0.95,
      matchedPattern: 'rich_table_matrix',
    };
  }

  // Safe default. Orchestrator handles context-based routing from here.
  return {
    type: 'conversation',
    explicit: false,
    confidence: 0.5,
    matchedPattern: 'fallthrough_default',
  };
}

/**
 * isHardOverride
 * Convenience predicate for route.ts and orchestrator.
 */
export function isHardOverride(intent: IntentResult): boolean {
  return intent.type === 'hard_override';
}

/**
 * isStrongCurriculumRequest
 * ──────────────────────────────────────────────────────────────────────────
 * Returns true when the intent signals a full course generation request.
 * Used by orchestrator step 3 check.
 * Preserved from SEEK 2.6 isStrongCourseRequest() for compatibility.
 */
export function isStrongCurriculumRequest(intent: IntentResult): boolean {
  return (
    intent.type === 'learn' &&
    intent.subtype === 'curriculum_request' &&
    intent.confidence >= 0.9
  );
}

/**
 * isFastPathArtifact
 * Returns true when intent signals a direct artifact request.
 * Orchestrator uses this for step 4 fast-path evaluation.
 */
export function isFastPathArtifact(intent: IntentResult): boolean {
  return intent.type === 'artifact' && intent.confidence >= 0.85;
}
