import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import Module, { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const ts = require('typescript')
const root = fileURLToPath(new URL('../', import.meta.url))
const mentorSource = fs.readFileSync(new URL('../server/mentors/mentor-engine.ts', import.meta.url), 'utf8')
const streamSource = fs.readFileSync(new URL('../server/core/execution-engine-stream.ts', import.meta.url), 'utf8')

assert.match(mentorSource, /export const PRODUCT_MODEL = 'gpt-5\.6-sol'/)
assert.doesNotMatch(mentorSource, /OPENAI_MAIN_MODEL\s*\|\|\s*['"]gpt-4o-mini['"]/)
assert.match(mentorSource, /configured && configured !== PRODUCT_MODEL/)
assert.match(mentorSource, /Modelo incorrecto: se sirvió \$\{served\}, el producto es \$\{PRODUCT_MODEL\}\./)
assert.match(streamSource, /servedModel: stream\.servedModel/)
assert.match(streamSource, /stream\.deliveryFailure === 'model_mismatch' \? 'failed'/)

const originalResolve = Module._resolveFilename
const originalLoad = Module._load
Module._resolveFilename = function (name, ...rest) {
  return originalResolve.call(this, name.startsWith('@/') ? path.join(root, name.slice(2)) : name, ...rest)
}
let providerCalls = 0
class FakeOpenAI {
  chat = { completions: { create: async () => { providerCalls += 1; throw new Error('provider must not be called') } } }
}
Module._load = function (name, ...rest) {
  if (name === 'openai') return FakeOpenAI
  return originalLoad.call(this, name, ...rest)
}
require.extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
}).outputText, file)

process.env.OPENAI_MAIN_MODEL = 'gpt-4o-mini'
const { getMentorResponseStream } = require('../server/mentors/mentor-engine.ts')
const rejected = await getMentorResponseStream({ request: { message: 'Hola' }, state: {} })
let visible = ''
for await (const delta of rejected) visible += delta

assert.equal(providerCalls, 0, 'a mismatched configured model must fail before the provider call')
assert.equal(visible, 'Modelo incorrecto: se sirvió gpt-4o-mini, el producto es gpt-5.6-sol.')
assert.equal(rejected.servedModel, 'gpt-4o-mini')
assert.equal(rejected.deliveryFailure, 'model_mismatch')

delete process.env.OPENAI_MAIN_MODEL
Module._resolveFilename = originalResolve
Module._load = originalLoad

console.log('PASS product model is pinned; mismatches fail visibly before provider use; SSE done exposes servedModel')
