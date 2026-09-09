// SEEK 5.0 S1 E-07
// Chrome may not present Lección N · x/10 · [nivel] before the model
// has processed at least 2 turns or has confirmed level.
// Onboarding A1 is a preference, not a diagnosed competence.

export function chromeReady(tokens: number | undefined, levelConfirmed?: boolean): boolean {
  return levelConfirmed === true || (tokens ?? 0) >= 2;
}

export function chromeLessonLabel(
  tokens: number | undefined,
  lessonIndex: number | undefined,
  levelConfirmed?: boolean,
): string {
  if (!chromeReady(tokens, levelConfirmed)) return 'Sesión';
  const lesson = (lessonIndex ?? 0) + 1;
  const inLesson = (tokens ?? 0) % 10;
  return `Lección ${lesson} · ${inLesson}/10`;
}

export function chromeLevelLabel(
  tokens: number | undefined,
  level: string | undefined,
  levelConfirmed?: boolean,
): string {
  if (!chromeReady(tokens, levelConfirmed)) return '—';
  return level ?? '—';
}
