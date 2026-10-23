// Shared loader for behavioural tests: TypeScript via the repo's compiler, `@/` alias.
import fs from 'node:fs'
import path from 'node:path'
import Module, { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const compile = (file) => ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  fileName: file,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (mod, file) => mod._compile(compile(file), file)
const resolve = Module._resolveFilename
Module._resolveFilename = function (request, parent, ...rest) {
  if (request.startsWith('@/')) request = path.join(ROOT, request.slice(2))
  return resolve.call(this, request, parent, ...rest)
}
export const load = (relative) => require(path.join(ROOT, relative))
