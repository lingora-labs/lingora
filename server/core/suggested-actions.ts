// =============================================================================
// server/core/suggested-actions.ts
// SEEK 5.0 P18 (continuation) — CONTEXTUAL ACTION BAR.
// Root gap found in production: the blocking path's buildSuggestedActions()
// unconditionally pushed export_chat_pdf as the LAST action on every turn,
// and only ever offered start_quiz/start_course/next_module/show_schema
// beyond that — table, practice, pronunciation, correction never fired.
// The streaming path (now the dominant path for ordinary conversation,
// after P18's first-turn fix) was even thinner: it only attached
// suggestedActions when an artifact existed, hardcoded to export_chat_pdf
// alone. With no backend actions, the frontend's own fallback
// (use-beta-page.ts) silently defaulted to a single "Export PDF" button —
// so almost every substantive conversational turn showed exactly one
// button, always the same one, regardless of what was actually useful.
//
// Fix: one shared contextual builder, called from both paths (blocking and
// streaming), so behavior is identical regardless of which transport a
// turn happens to use. For substantive teaching/conversation turns with no
// artifact of their own, offers 2-3 actions drawn from each mentor's own
// specialty (Sarah=academic → table/schema/correction, Alex=travel →
// examples/pronunciation/continue, Nick=business → correction/exercise/
// explanation) — this is a platform mechanism (same function, same
// trigger conditions for all three), not a persona-specific branch; only
// the WHICH actions differ, matching each mentor's already-established
// specialty (see MENTOR_PROFILES in contracts.ts). Every action type used
// here was already wired end-to-end on the frontend (use-beta-page.ts's
// actionMessages map) — this only makes the backend actually emit them.
// =============================================================================
import type {
  ArtifactType,
  PedagogicalAction,
  SuggestedAction,
  SuggestedActionType,
} from '../../lib/contracts';

const LABELS: Record<string, Record<string, string>> = {
  start_quiz:            { en: 'Start quiz',              es: 'Empezar quiz',              no: 'Start quiz' },
  export_chat_pdf:       { en: 'Export as PDF',           es: 'Exportar a PDF',            no: 'Eksporter som PDF' },
  next_module:           { en: 'Next module',             es: 'Siguiente módulo',          no: 'Neste modul' },
  start_course:          { en: 'Start course',            es: 'Empezar curso',             no: 'Start kurs' },
  show_schema:           { en: 'Show schema',              es: 'Ver esquema',               no: 'Vis skjema' },
  show_table:            { en: 'Show table',               es: 'Ver tabla',                 no: 'Vis tabell' },
  retry_quiz:            { en: 'Try again',                es: 'Intentar de nuevo',          no: 'Prøv igjen' },
  request_correction:    { en: 'Correct my Spanish',        es: 'Corrige mi español',        no: 'Rett spansken min' },
  choose_examples:       { en: 'More examples',             es: 'Más ejemplos',              no: 'Flere eksempler' },
  choose_exercise:       { en: 'Practice exercise',         es: 'Ejercicio práctico',        no: 'Øvelse' },
  request_pronunciation: { en: 'Practice pronunciation',    es: 'Practicar pronunciación',   no: 'Øv uttale' },
  continue_lesson:       { en: 'Continue',                  es: 'Continuar',                 no: 'Fortsett' },
  request_explanation:   { en: 'Explain more',              es: 'Explica más',               no: 'Forklar mer' },
};

function getLabel(type: string, lang: string): string {
  return LABELS[type]?.[lang] ?? LABELS[type]?.['en'] ?? type;
}

export interface ContextualActionsParams {
  pedagogicalAction?: PedagogicalAction;
  artifactType?: ArtifactType;
  mentorProfile?: string;
  interfaceLanguage?: string;
  hasErrorText?: boolean;
  activeMode?: string;
}

export function buildContextualActions(params: ContextualActionsParams): SuggestedAction[] {
  const { pedagogicalAction, artifactType, mentorProfile, interfaceLanguage, hasErrorText, activeMode } = params;
  const lang = interfaceLanguage ?? 'en';

  // Honest error with no artifact: no actions imply success. Unchanged
  // rule from the prior implementation.
  if (hasErrorText && !artifactType) return [];

  const push = (type: SuggestedActionType) => ({ type, label: getLabel(type, lang) });
  const actions: SuggestedAction[] = [];

  if (artifactType === 'quiz')    actions.push(push('start_quiz'));
  if (artifactType === 'roadmap') actions.push(push('start_course'));
  if (artifactType && (['schema', 'schema_pro', 'table', 'table_matrix'] as ArtifactType[]).includes(artifactType)) {
    actions.push(push('export_chat_pdf'));
  }
  if (pedagogicalAction === 'feedback' && activeMode === 'structured') {
    actions.push(push('next_module'));
  }

  // Substantive teaching/conversation turn — offer the mentor-specialty
  // action set unless the artifact THIS turn produced already comes with
  // its own dedicated action above (quiz/roadmap/schema/table).
  //
  // ROOT CAUSE (found via production SSE trace, P18 continuation):
  // this previously read `!artifactType`, treating the mere PRESENCE of
  // any artifact as "already resolved, no further actions needed." But
  // nearly every substantive mentor-first answer also emits a generic
  // 'pdf' artifact via signal_artifact (the model documenting what it
  // just taught) — a type not in ARTIFACT_TYPES_WITH_OWN_ACTION and not
  // matched by any push() above either. So `artifactType` was truthy
  // ('pdf') → isSubstantive was false → the mentor-specialty branch never
  // ran → zero actions, matching what both execution paths' SSE payload
  // showed (`suggestedActions: []`) on Sarah and Alex's real replies. Not
  // a transport or frontend bug — the backend was genuinely sending an
  // empty array. Fix: only artifact types that already have a specific
  // action pushed above should suppress the generic set; a plain 'pdf'
  // (or any other side artifact) does not preclude offering practice/
  // table/schema/correction on the SAME turn.
  const ARTIFACT_TYPES_WITH_OWN_ACTION = new Set<ArtifactType>(['quiz', 'roadmap', 'schema', 'schema_pro', 'table', 'table_matrix']);
  const isSubstantive = (!artifactType || !ARTIFACT_TYPES_WITH_OWN_ACTION.has(artifactType))
    && (pedagogicalAction === 'lesson' || pedagogicalAction === 'conversation' || pedagogicalAction === 'guide');
  if (isSubstantive) {
    const mentor = (mentorProfile ?? 'Alex').toLowerCase();
    if (mentor === 'sarah') {
      actions.push(push('show_table'), push('show_schema'), push('request_correction'));
    } else if (mentor === 'alex') {
      actions.push(push('choose_examples'), push('request_pronunciation'), push('continue_lesson'));
    } else {
      actions.push(push('request_correction'), push('choose_exercise'), push('request_explanation'));
    }
  }

  const deduped = actions.filter((a, i, arr) => arr.findIndex((b) => b.type === a.type) === i);
  return deduped.slice(0, 4);
}
