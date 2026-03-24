// =============================================================================
// server/tools/schema-adapter.ts
// LINGORA SEEK 3.0 — SchemaContent → SchemaArtifact Adapter
// =============================================================================
// Purpose  : Explicit, formal translation from the rich SchemaContent produced
//            by schema-generator.ts into the SchemaArtifact shape consumed by
//            the frontend renderer. Single authoritative adapter — no other
//            module may perform this translation inline.
// =============================================================================

import type {
  SchemaContent,
  SchemaArtifact,
  SchemaBlock,
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
    sections.push({ label: 'Resumen', content: data.summary, tone: 'highlight' });
  }

  const quiz = data.quiz?.map(q => {
    const letters = ['A', 'B', 'C', 'D'];
    const opts = q.options.map((o, i) => `${letters[i]}) ${o}`).join('  ');
    return `${q.question} — ${opts}`;
  });

  return {
    type:      'schema',
    title:     data.title,
    objective: data.objective,
    level,
    sections,
    quiz,
  };
}

