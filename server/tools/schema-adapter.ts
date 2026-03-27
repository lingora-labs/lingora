// =============================================================================
// server/tools/schema-adapter.ts
// LINGORA SEEK 3.1 — SchemaContent → SchemaArtifact Adapter
// =============================================================================
// FIX-9F: quiz field now passes through as SchemaQuizItem[] (structured)
// instead of flattening to string[] — enables interactive QuizBlock renderer
// =============================================================================

import type {
  SchemaContent,
  SchemaArtifact,
  SchemaBlock,
  SchemaQuizItem,
  CEFRLevel,
} from '../../lib/contracts';

/**
 * adaptSchemaToArtifact
 * Converts SchemaContent → SchemaArtifact with full field mapping.
 */
export function adaptSchemaToArtifact(
  data: SchemaContent,
  level?: CEFRLevel,
): SchemaArtifact {
  const sections: SchemaBlock[] = [];

  if (data.keyConcepts?.length) {
    for (const concept of data.keyConcepts) {
      sections.push({ label: 'Concepto clave', content: concept });
    }
  }

  if (data.subtopics?.length) {
    for (const sub of data.subtopics) {
      const content = sub.keyTakeaway
        ? `${sub.content}\n→ ${sub.keyTakeaway}`
        : sub.content;
      sections.push({ label: sub.title, content });
    }
  }

  if (data.tableRows?.length) {
    for (const row of data.tableRows) {
      sections.push({ label: row.left, content: row.right });
    }
  }

  if (data.examples?.length) {
    for (const example of data.examples) {
      sections.push({ label: 'Ejemplo', content: example });
    }
  }

  if (data.summary) {
    sections.push({ label: 'Regla 80/20', content: data.summary, tone: 'highlight' });
  }

  // FIX-9F: preserve quiz as structured items — do NOT flatten to strings
  // SchemaContent.quiz = [{question, options:string[], correct:number}]
  // SchemaArtifact.quiz = Array<SchemaQuizItem | string> (updated in contracts)
  // normSchema reads these as QuizQ[] → QuizBlock renders interactive simulacro
  const quiz: SchemaQuizItem[] | undefined = data.quiz?.map(q => ({
    question: q.question,
    options:  q.options,
    correct:  typeof q.correct === 'number' ? q.correct : 0,
  }));

  return {
    type:      'schema',
    title:     data.title,
    objective: data.objective,
    level,
    sections,
    quiz,
  };
}
