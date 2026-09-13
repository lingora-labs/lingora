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
//
// P19-D — NEUTRAL CSS TOKENS. Root gap: the web surface needs the same
// palette but pdf-lib's rgb() objects (0-1 floats packed into an opaque
// PDFColor) aren't usable as CSS values. Rather than hand-maintain a
// second hex palette that could drift from the PDF one, PALETTE below is
// the single source of truth (plain 0-1 RGB triples); both BRAND.colors
// (pdf-lib rgb()) and BRAND.cssColors (hex strings) are derived from it.
// Changing the brand palette in one place updates both surfaces.
// =============================================================================
import { rgb } from 'pdf-lib';

const PALETTE = {
  dark:       [0.08, 0.09, 0.18],
  teal:       [0.00, 0.74, 0.78],
  accent:     [0.22, 0.32, 0.72],
  muted:      [0.42, 0.47, 0.58],
  white:      [1, 1, 1],
  light:      [0.95, 0.96, 0.98],
  tip:        [0.08, 0.12, 0.24],
  warn:       [0.96, 0.94, 0.88],
  metaCardBg: [0.12, 0.16, 0.28],
} as const;

function toHex([r, g, b]: readonly [number, number, number] | number[]): string {
  const c = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

type PaletteKey = keyof typeof PALETTE;
const cssColors = Object.fromEntries(
  (Object.keys(PALETTE) as PaletteKey[]).map((k) => [k, toHex(PALETTE[k])]),
) as Record<PaletteKey, string>;

export const BRAND = {
  name: 'LINGORA',
  tagline: 'AI Cultural Immersion Platform for Spanish',
  footerLine: 'Learn -> Connect -> Experience',
  colors: {
    dark:       rgb(...PALETTE.dark),
    teal:       rgb(...PALETTE.teal),
    accent:     rgb(...PALETTE.accent),
    muted:      rgb(...PALETTE.muted),
    white:      rgb(...PALETTE.white),
    light:      rgb(...PALETTE.light),
    tip:        rgb(...PALETTE.tip),
    warn:       rgb(...PALETTE.warn),
    metaCardBg: rgb(...PALETTE.metaCardBg),
  },
  // P19-D — hex equivalents for the web renderer. Same numbers as `colors`
  // above, just expressed as CSS-usable strings instead of pdf-lib's
  // opaque PDFColor objects.
  cssColors,
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
