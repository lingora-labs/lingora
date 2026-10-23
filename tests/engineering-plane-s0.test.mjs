// 7.5 S0 — the engineering control plane is off unless the deployment opts in,
// writes to main are off unless opted in, and no endpoint answers "is this key valid?".
import assert from 'node:assert/strict'
import { load } from './_ts-loader.mjs'

const { NextRequest } = load('node_modules/next/server.js')
const policy = load('lib/engineering/policy.ts')
const mcp = load('app/api/mcp/route.ts')
const health = load('app/api/mcp/health/route.ts')

const KEYS = ['LINGORA_ENGINEERING_PLANE', 'LINGORA_ENGINEERING_MAIN_WRITE', 'LINGORA_ENGINEERING_QUERY_KEY', 'LINGORA_MCP_TOKEN', 'LINGORA_GROK_KEY']
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]))
const setEnv = (o) => { for (const k of KEYS) delete process.env[k]; Object.assign(process.env, o) }
const rpc = (method, { headers = {}, query = '' } = {}) => new NextRequest('https://x.test/api/mcp' + query, {
  method: 'POST', headers: { 'content-type': 'application/json', ...headers },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: { name: 'repo_status', arguments: {} } }),
})
const TOKEN = 'b'.repeat(40), KEY = 'k'.repeat(40)

try {
  // 1. Plane disabled (default): every method and the health probe are 404.
  setEnv({ LINGORA_MCP_TOKEN: TOKEN, LINGORA_GROK_KEY: KEY })
  for (const m of ['initialize', 'tools/list', 'tools/call'])
    assert.equal((await mcp.POST(rpc(m, { headers: { authorization: 'Bearer ' + TOKEN } }))).status, 404, m + ' must not exist when the plane is off')
  assert.equal((await mcp.GET(new NextRequest('https://x.test/api/mcp'))).status, 404)
  assert.equal((await health.GET()).status, 404)

  // 2. Plane enabled: no credential, wrong credential, wrong scheme → 401 on tools.
  setEnv({ LINGORA_ENGINEERING_PLANE: 'enabled', LINGORA_MCP_TOKEN: TOKEN, LINGORA_GROK_KEY: KEY })
  for (const headers of [{}, { authorization: 'Bearer ' + 'x'.repeat(40) }, { authorization: 'Basic ' + TOKEN }, { authorization: 'Bearer ' + TOKEN.slice(1) }])
    for (const m of ['tools/list', 'tools/call'])
      assert.equal((await mcp.POST(rpc(m, { headers }))).status, 401, m + ' must reject ' + JSON.stringify(Object.keys(headers)))

  // 3. ?key= channel is off unless separately opted in, even with the right key.
  assert.equal((await mcp.POST(rpc('tools/list', { query: '?key=' + KEY }))).status, 401)
  setEnv({ LINGORA_ENGINEERING_PLANE: 'enabled', LINGORA_ENGINEERING_QUERY_KEY: 'enabled', LINGORA_GROK_KEY: KEY })
  assert.equal((await mcp.POST(rpc('tools/list', { query: '?key=' + 'z'.repeat(40) }))).status, 401)
  assert.equal((await mcp.POST(rpc('tools/list', { query: '?key=' + KEY }))).status, 200, 'opted-in query key works')
  // Empty configured secrets never authorize.
  setEnv({ LINGORA_ENGINEERING_PLANE: 'enabled', LINGORA_ENGINEERING_QUERY_KEY: 'enabled', LINGORA_MCP_TOKEN: '', LINGORA_GROK_KEY: '' })
  assert.equal((await mcp.POST(rpc('tools/list', { headers: { authorization: 'Bearer ' }, query: '?key=' }))).status, 401)

  // 4. The public probe is not an oracle.
  setEnv({ LINGORA_ENGINEERING_PLANE: 'enabled', LINGORA_MCP_TOKEN: TOKEN })
  const probe = await (await mcp.GET(new NextRequest('https://x.test/api/mcp', { headers: { authorization: 'Bearer ' + TOKEN } }))).json()
  assert.equal('authenticated' in probe, false)

  // 5. Write policy: main is read-only unless opted in; branches are writable.
  assert.throws(() => policy.assertWritable('main', {}), /writes to main are disabled/)
  assert.throws(() => policy.assertWritable('refs/heads/main', {}), /writes to main are disabled/)
  assert.doesNotThrow(() => policy.assertWritable('release/7.5-canonical', {}))
  assert.doesNotThrow(() => policy.assertWritable('main', { LINGORA_ENGINEERING_MAIN_WRITE: 'enabled' }))
  assert.equal(policy.currentPolicy({}).mainWrite, false)
  for (const v of ['true', '1', 'yes', 'ENABLED']) assert.equal(policy.mainWritesAllowed({ LINGORA_ENGINEERING_MAIN_WRITE: v }), false, 'only the exact word enables writes')

  // 6. Every mutating tool goes through the guard before touching GitHub.
  const tools = (await import('node:fs')).readFileSync(new URL('../lib/engineering/tools.ts', import.meta.url), 'utf8')
  for (const fn of ['putBinaryFile', 'writeFile', 'writeFiles', 'deleteFile', 'rollbackCommit', 'mergePullRequest']) {
    const body = tools.slice(tools.indexOf(`function ${fn}(`), tools.indexOf(`function ${fn}(`) + 600)
    assert.match(body, /assertWritable\(/, fn + ' must call assertWritable')
  }
  console.log('engineering-plane-s0: OK')
} finally {
  setEnv(Object.fromEntries(Object.entries(saved).filter(([, v]) => v !== undefined)))
}
