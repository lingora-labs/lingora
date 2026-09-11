// P14-C — CASE D1-D4 contract tests. Deterministic fault injection: no
// OpenAI calls, no PDF rendering. Tests the pure decision function
// (buildFulfillmentEntry) and the UI-side resolvers directly.
import { buildFulfillmentEntry } from '../server/core/artifact-side-effect'
import { resolveMsgArtifacts, resolveMsgArtifactFailures, type Msg, type Artifact } from '../app/beta/beta-model'

let failures = 0
function check(name: string, cond: boolean, detail?: string) {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`)
  if (!cond) failures++
}

// D1 — one requested artifact, renderer forced failure.
{
  const entry = buildFulfillmentEntry(
    'Curso de español A1',
    'LINGORA — Curso de español A1',
    { ok: true, content: {} },
    { success: false }, // forced renderer failure — no url
  )
  check('D1_kind_is_failure', entry.kind === 'failure')
  check('D1_subject_present', entry.kind === 'failure' && entry.failure.subject === 'Curso de español A1')
  check('D1_no_internal_detail_leaked', entry.kind === 'failure' && Object.keys(entry.failure).length === 1,
    `keys=${entry.kind === 'failure' ? Object.keys(entry.failure).join(',') : 'n/a'}`)
}

// D2 — two artifacts, A succeeds / B fails.
{
  const a = buildFulfillmentEntry('Español A1', 'Título A',
    { ok: true, content: {} },
    { success: true, url: 'data:application/pdf;base64,AAA', pdfSha256: 'hashA' })
  const b = buildFulfillmentEntry('Acupuntura', 'Título B',
    { ok: true, content: {} },
    { success: false })

  const artifacts = [a, b].filter(e => e.kind === 'artifact').map(e => (e as { kind: 'artifact'; payload: Artifact }).payload)
  const fails = [a, b].filter(e => e.kind === 'failure').map(e => (e as { kind: 'failure'; failure: { subject: string } }).failure)

  check('D2_A_preserved', artifacts.length === 1 && artifacts[0].url === 'data:application/pdf;base64,AAA')
  check('D2_B_failure_independent', fails.length === 1 && fails[0].subject === 'Acupuntura')
  check('D2_no_collapse_no_cross_contamination', artifacts.length + fails.length === 2)
}

// D3 — normal success path, no regression.
{
  const a = buildFulfillmentEntry('Español A1', 'Título A',
    { ok: true, content: {} },
    { success: true, url: 'data:application/pdf;base64,AAA' })
  const b = buildFulfillmentEntry('Acupuntura', 'Título B',
    { ok: true, content: {} },
    { success: true, url: 'data:application/pdf;base64,BBB' })
  const artifacts = [a, b].filter(e => e.kind === 'artifact')
  const fails = [a, b].filter(e => e.kind === 'failure')
  check('D3_both_succeed_no_failures', artifacts.length === 2 && fails.length === 0)
}

// D4 — legacy response without failure field: UI must remain functional.
{
  const legacyMsg: Msg = { id: 'm1', sender: 'sarah', text: 'hola', artifacts: [{ type: 'pdf', url: 'x' }] }
  // no artifactFailures key at all — simulates an old SSE payload / old cached message
  const arts = resolveMsgArtifacts(legacyMsg)
  const fails = resolveMsgArtifactFailures(legacyMsg)
  check('D4_artifacts_still_resolve', arts.length === 1)
  check('D4_failures_empty_not_throw', Array.isArray(fails) && fails.length === 0)
}

// Mixed message: artifacts + failures coexist without collapsing cardinality.
{
  const mixedMsg: Msg = {
    id: 'm2', sender: 'sarah', text: 'hola',
    artifacts: [{ type: 'pdf', url: 'x' }],
    artifactFailures: [{ subject: 'Acupuntura' }],
  }
  check('MIXED_1_artifact_1_failure', resolveMsgArtifacts(mixedMsg).length === 1 && resolveMsgArtifactFailures(mixedMsg).length === 1)
}

if (failures > 0) {
  console.error(`\n${failures} test(s) FAILED`)
  process.exit(1)
} else {
  console.log('\nAll P14-C contract tests PASSED')
}
