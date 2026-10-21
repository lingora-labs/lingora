// DIAGNOSTIC 7.3.3e — same runner, but outbound fetches are never cached or deduplicated.
export const runtime = 'nodejs'
export const maxDuration = 300
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'
export { GET } from '../gate-runner/route'
