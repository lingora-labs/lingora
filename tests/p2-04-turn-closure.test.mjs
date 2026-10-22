// Execute: node tests/p2-04-turn-closure.test.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import Module from 'node:module'
import ts from 'typescript'
const filename = fileURLToPath(new URL('../lib/artifact-signal.ts', import.meta.url))
const js = ts.transpileModule(readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText
const m = new Module(filename)
m.filename = filename
m.paths = Module._nodeModulePaths(path.dirname(filename))
m._compile(js, filename)
const { parseClosedTutorTurn, streamedTutorReplyPrefix } = m.exports
const pdf = { type: 'emit_pdf', trigger: 'explicit_user_request', subject: 'SER y ESTAR', format: 'pdf_html' }
const greeting = { reply: 'Hola, ¿qué quieres aprender?', artifacts: [] }
assert.deepEqual(parseClosedTutorTurn(greeting), greeting)
// 7.4.1: the typed signal has an optional `content` slot (native artifacts); an absent one is `undefined`, not part of the contract.
const wire = (value) => JSON.parse(JSON.stringify(value))
assert.deepEqual(wire(parseClosedTutorTurn({ ...greeting, artifacts: [pdf] }).artifacts), [pdf])
assert.equal(Object.keys(wire(parseClosedTutorTurn({ ...greeting, artifacts: [pdf] }).artifacts[0])).sort().join(), 'format,subject,trigger,type', 'no field beyond the closed grammar crosses the wire')
assert.equal(parseClosedTutorTurn({ ...greeting, artifacts: [pdf, pdf] }).artifacts.length, 1)
assert.equal(parseClosedTutorTurn({ ...greeting, artifacts: [{ ...pdf, trigger: 'pedagogical_completion' }] }), null)
assert.equal(parseClosedTutorTurn({ reply: 'Sin cierre' }), null)
const reply = 'SER y ESTAR\n"Estoy bien" — مرحبا 😊'
const json = JSON.stringify({ reply, artifacts: [pdf] })
let before = ''
for (let i = 0; i <= json.length; i++) {
  const current = streamedTutorReplyPrefix(json.slice(0, i))
  assert.ok(reply.startsWith(current), 'Tool metadata leaked into visible content')
  assert.ok(current.startsWith(before), 'Streaming must be monotonic')
  before = current
}
assert.equal(before, reply)
console.log('PASS: structured tutor closure and partial JSON streaming')
