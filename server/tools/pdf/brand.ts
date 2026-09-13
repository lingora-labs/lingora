// =============================================================================
// server/tools/pdf/brand.ts
// P19-B — BRAND CONFIG. Root gap: colors, name and tagline were literal
// constants duplicated inside generateCoursePdf.ts with no single source of
// truth — a future rename or palette change would mean hunting through the
// renderer. This is the minimum viable centralization: one module, one
// export, consumed wherever brand identity needs to render. Not a theming
// engine — just the handful of tokens that actually vary across surfaces
// today (PDF cover/header/footer). Extend here first if a future surface
// (HTML) needs the same identity.
// =============================================================================
import { rgb } from 'pdf-lib';

export const BRAND = {
  name: 'LINGORA',
  tagline: 'AI Cultural Immersion Platform for Spanish',
  footerLine: 'Learn -> Connect -> Experience',
  colors: {
    dark:   rgb(0.08, 0.09, 0.18),
    teal:   rgb(0.00, 0.74, 0.78),
    accent: rgb(0.22, 0.32, 0.72),
    muted:  rgb(0.42, 0.47, 0.58),
    white:  rgb(1, 1, 1),
    light:  rgb(0.95, 0.96, 0.98),
    tip:    rgb(0.08, 0.12, 0.24),
    warn:   rgb(0.96, 0.94, 0.88),
    metaCardBg: rgb(0.12, 0.16, 0.28),
  },
  page: {
    width: 595.28,
    height: 841.89,
    marginLeft: 48,
    marginRight: 48,
    marginBottom: 52,
  },
} as const;

// P19-B — DOCUMENT INTENT. Root gap: composeArtifactDocument.ts's
// documentType taxonomy (lesson/study_guide/course/worksheet/reference/
// assessment/learning_plan) is exclusively pedagogical — every artifact,
// regardless of subject, was forced into a learning-shaped label. A serious
// scientific dossier on acupuncture and a Spanish lesson got the same
// visual treatment because the classification layer had no vocabulary for
// "this is not a lesson." documentIntent is the broader classification
// documentType always should have sat under; documentType keeps its
// existing pedagogical meaning for intent='learning' and gains a small
// parallel vocabulary for the other intents (see INTENT_TYPE_LABELS).
export type DocumentIntent =
  | 'learning'
  | 'scientific'
  | 'executive'
  | 'comparative'
  | 'reference';

export const INTENT_KICKER: Record<DocumentIntent, string> = {
  learning:    'MATERIAL DE APRENDIZAJE',
  scientific:  'DOSSIER EXPLICATIVO',
  executive:   'DOCUMENTO EJECUTIVO',
  comparative: 'ANALISIS COMPARATIVO',
  reference:   'MATERIAL DE REFERENCIA',
};
