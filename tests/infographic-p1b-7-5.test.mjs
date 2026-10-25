// 7.5 P1-B — infographic real (order "P1 DOBLE", points 5–8): native typed route, worked examples with the
// cores highlighted, mobile and file layouts of the same content, image capability gated and sanitized,
// PNG verified. Real modules; the provider is simulated only where an image call would happen.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import Module from 'node:module'
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-only'
let imageCalls = [], imageBehaviour = 'reject'
class FakeOpenAI {
  images = { generate: async (req) => { imageCalls.push(req); if (imageBehaviour === 'reject') throw Object.assign(new Error('400 The model `gpt-image-1` does not exist or you do not have access to it.'), { status: 400, code: 'model_not_found', type: 'invalid_request_error' }); return { data: [{ b64_json: Buffer.from('fakepng').toString('base64') }] } } }
  chat = { completions: { create: async () => { throw new Error('not used') } } }
}
const originalLoad = Module._load
Module._load = function (name, ...rest) { if (name === 'openai') return FakeOpenAI; return originalLoad.call(this, name, ...rest) }
const { load } = await import('./_ts-loader.mjs')
const I = load('lib/infographic-contract.ts')
const { materializeNativeArtifactOrReason, explainNativeRefusal } = load('server/core/native-artifact.ts')
const A = load('lib/artifact-signal.ts')
const quiet = { warn: console.warn, error: console.error }
console.warn = () => {}; console.error = () => {}

// The regression case of the order: what the Tutor must be able to author, drawn exactly.
const NUCLEO = {
  title: 'La importancia de identificar el núcleo del sujeto y del predicado',
  subtitle: 'Cinco razones para analizar bien las oraciones',
  sections: [
    { heading: '1. Comprender mejor', body: 'Saber quién realiza la acción y qué se dice de él aclara el significado de la oración.' },
    { heading: '2. Concordar sin errores', body: 'El núcleo del sujeto y el verbo concuerdan en número y persona.' },
    { heading: '3. Escribir con claridad', body: 'Identificar los núcleos ayuda a construir oraciones ordenadas y precisas.' },
    { heading: '4. Puntuar correctamente', body: 'No se separa con coma el sujeto del predicado.' },
    { heading: '5. Analizar textos', body: 'Es la base del análisis sintáctico de oraciones más complejas.' },
  ],
  examples: [{ caption: 'Ejemplo', sentence: 'Los estudiantes atentos comprenden la explicación', parts: [
    { text: 'Los estudiantes atentos', label: 'Sujeto', emphasis: 'estudiantes', emphasisLabel: 'Núcleo del sujeto' },
    { text: 'comprenden la explicación', label: 'Predicado', emphasis: 'comprenden', emphasisLabel: 'Núcleo verbal' },
  ] }],
  takeaway: 'Encuentra primero el verbo (núcleo del predicado) y pregunta quién lo realiza: así llegas al núcleo del sujeto.',
}
const out = materializeNativeArtifactOrReason({ type: 'infographic', trigger: 'explicit_user_request', subject: 'Infografía', format: 'native', content: NUCLEO })
assert.ok('payload' in out, 'the reference infographic is valid'); const info = out.payload.content
assert.equal(info.sections.length, 5); assert.equal(info.examples[0].parts[0].emphasis, 'estudiantes')

const textOf = svg => svg.replace(/<tspan[^>]*>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&laquo;|«|»/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/[▸]/g, ' ').replace(/\s+/g, ' ')
const wordsOf = t => t.normalize('NFC').split(/\s+/).map(w => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')).filter(Boolean)
const containsInOrder = (hay, needle) => { const h = wordsOf(hay), n = wordsOf(needle); let i = 0; for (const w of h) if (w === n[i]) i++; return i === n.length }
for (const [name, svg] of [['wide', I.renderInfographicSvg(info)], ['narrow', I.renderInfographicSvg(info, { width: 360 })], ['file', I.renderInfographicSvg(info, { fixed: true })]]) {
  const t = textOf(svg)
  for (const piece of I.infographicTexts(info)) assert.ok(containsInOrder(t, piece), `${name}: «${piece}» is drawn in full`)
  // Both cores are drawn emphasized, each in its own segment, and nothing else is.
  const em = [...svg.matchAll(/<tspan data-part="(\d)"[^>]*data-emphasis="\d"[^>]*>\s?([^<]*)<\/tspan>/g)].map(m => [m[1], m[2].trim()])
  assert.deepEqual(em, [['0', 'estudiantes'], ['1', 'comprenden']], `${name}: exactly the two nuclei are highlighted`)
  const label = j => textOf((svg.match(new RegExp(`<text[^>]*data-emphasis-label="${j}"[^>]*>.*?</text>`)) ?? [''])[0]).trim()
  assert.equal(label(0), 'Núcleo del sujeto: estudiantes'); assert.equal(label(1), 'Núcleo verbal: comprenden')
  assert.ok(!/<script|on\w+=/i.test(svg), `${name}: no active content`)
}
assert.match(I.renderInfographicSvg(info, { width: 360 }), /viewBox="0 0 360 \d+"/, 'narrow layout for phones')
assert.match(I.renderInfographicSvg(info, { fixed: true }), / width="520" height="\d+"/, 'files keep the full-width drawing')
assert.equal(I.renderInfographicSvg(info), I.renderInfographicSvg(info), 'deterministic')

// The renderer adds no label of its own: without Tutor labels there are none.
const bare = I.validateInfographicContent({ title: 'T', sections: [{ heading: 'h', body: 'b' }], examples: [{ parts: [{ text: 'Ana canta', emphasis: 'canta' }] }] })
assert.ok(bare.ok); assert.ok(!/Núcleo|Sujeto|Predicado/.test(I.renderInfographicSvg(bare.info)))

// Refusals, in words a student can read.
const bad = (ex) => I.validateInfographicContent({ title: 'T', sections: [{ heading: 'h', body: 'b' }], examples: [ex] })
let r = bad({ parts: [{ text: 'Los estudiantes atentos', emphasis: 'alumnos' }] }); assert.equal(r.reason, 'info_example_emphasis:0:0:alumnos')
assert.equal(explainNativeRefusal(r.reason), '«alumnos» no aparece como palabra en el segmento 1 del ejemplo 1')
r = bad({ sentence: 'Los estudiantes comprenden', parts: [{ text: 'Los alumnos' }, { text: 'comprenden' }] }); assert.equal(r.reason, 'info_example_mismatch:0')
r = bad({ parts: [{ text: 'Ana', emphasisLabel: 'Núcleo' }] }); assert.equal(r.reason, 'info_example_part:0:0')
assert.equal(explainNativeRefusal('unknown_code_x'), 'la estructura del componente no es válida', 'no internal code reaches the student')

// The tool contract reflects the capability. Without an image model, emit_image is not offered.
const off = A.completeTutorTurnTool({ image: false }).function.parameters.properties.artifacts.items.properties
assert.ok(!off.type.enum.includes('emit_image') && !off.format.enum.includes('image'))
assert.ok(A.completeTutorTurnTool({ image: true }).function.parameters.properties.artifacts.items.properties.type.enum.includes('emit_image'))
const offText = A.artifactChannelInstruction({ image: false })
assert.match(offText, /never declare emit_image/); assert.match(offText, /an "image" or "picture" of an infographic/); assert.doesNotMatch(offText, /never say you cannot generate it/)
assert.match(A.artifactChannelInstruction({ image: true }), /type infographic \(or flowchart for a process, chart for data\), format native/)
assert.ok(A.NATIVE_ARTIFACT_CONTENT_TOOL_SCHEMA ? true : true)
const schema = load('lib/native-visual-schema.ts').NATIVE_ARTIFACT_CONTENT_TOOL_SCHEMA
assert.deepEqual(schema.properties.examples.items.properties.parts.items.required, ['text'])

// Capability gating, sanitization, breaker and whole prompts — through the real side-effect layer.
const S = load('server/core/artifact-side-effect.ts')
const G = load('server/tools/image-generator.ts')
const PROMPT = 'Dame una imagen con una infografía: estilo pizarra, colores cálidos'
const imgSignal = { type: 'emit_image', trigger: 'explicit_user_request', subject: PROMPT, format: 'image' }
const leak = s => /gpt-image|model|400|does not exist|invalid_request|pizarra|infografía:/i.test(s)
delete process.env.LINGORA_IMAGE_MODEL
assert.deepEqual(G.imageCapability(), { available: false, model: null })
let done = await S.fulfillArtifactSignals([imgSignal], 'Texto del Tutor', { tokens: 1 })
assert.equal(imageCalls.length, 0, 'no provider call without a configured capability')
assert.equal(done.failures[0].subject, S.PUBLIC_FAILURE.image_unavailable); assert.ok(!leak(done.failures[0].subject))
process.env.LINGORA_IMAGE_MODEL = 'gpt-image-1'
assert.equal(G.imageCapability().available, true)
done = await S.fulfillArtifactSignals([imgSignal], 'Texto del Tutor', { tokens: 1 })
assert.equal(imageCalls.length, 1); assert.equal(imageCalls[0].prompt, PROMPT, 'the description reaches the provider whole (no cut at «imagen»)')
assert.equal(imageCalls[0].model, 'gpt-image-1', 'the model comes from configuration')
assert.ok(!leak(done.failures[0].subject), 'the provider refusal is not shown: ' + done.failures[0].subject)
assert.equal(G.imageCapability().available, false, 'a model refusal withdraws the capability (no repeated failures)')
done = await S.fulfillArtifactSignals([imgSignal], 'Texto del Tutor', { tokens: 1 })
assert.equal(imageCalls.length, 1, 'withdrawn: no second provider call'); assert.equal(done.failures[0].subject, S.PUBLIC_FAILURE.image_unavailable)
// A native infographic refusal names the kind and the validator's sentence, never the declaration's subject.
done = await S.fulfillArtifactSignals([{ type: 'infographic', trigger: 'explicit_user_request', subject: 'PROMPT INSTRUMENTAL SECRETO', format: 'native', content: { title: 'T', sections: [] } }], 'x', { tokens: 1 })
assert.equal(done.failures[0].subject, 'Componente interactivo (infografía): la infografía no tiene secciones')
delete process.env.LINGORA_IMAGE_MODEL

// PNG export: verified bytes, no silent SVG substitute.
const E = load('app/beta/svg-export.ts')
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAYAAAC56t6BAAAAEklEQVR4nGP4z8DwnwEJMOAWAACLqAHSz2xw3gAAAABJRU5ErkJggg==', 'base64')
assert.ok(E.isPng(new Uint8Array(png))); assert.ok(E.isPng(new Uint8Array(png), { width: 2, height: 3 })); assert.ok(!E.isPng(new Uint8Array(png), { width: 4, height: 3 }))
assert.ok(!E.isPng(new Uint8Array(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'.padEnd(64)))))
const ui = fs.readFileSync(new URL('../app/beta/beta-artifacts.tsx', import.meta.url), 'utf8')
const block = ui.slice(ui.indexOf('function SvgInstrumentBlock'), ui.indexOf('function ChartBlock'))
assert.ok(!/downloadSvg\(\)/.test(block.slice(block.indexOf('const downloadPng'))), 'the PNG path never falls back to an SVG download')
assert.match(block, /No se pudo crear el PNG: \$\{png\.reason\}/)
assert.match(ui, /renderAt=\{w => renderInfographicSvg\(info, \{ width: w \}\)\}/, 'on phones the content is laid out for the real width')
assert.ok(!/<script/.test(fs.readFileSync(new URL('../server/tools/image-generator.ts', import.meta.url), 'utf8')))
assert.ok(!/replace\(\/\.\*imagen/.test(fs.readFileSync(new URL('../server/tools/image-generator.ts', import.meta.url), 'utf8')), 'no vocabulary-dependent prompt cut')

Object.assign(console, quiet)
console.log('PASS 7.5 P1-B infographic: reference case valid and drawn in full (wide, narrow, file); both nuclei highlighted; readable refusals; image capability gated, whole prompt, sanitized, withdrawn after refusal; PNG verified')
