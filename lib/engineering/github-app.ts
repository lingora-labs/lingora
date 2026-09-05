/**
 * GitHub App installation Octokit-equivalent (fetch + RS256 JWT).
 * Secrets stay server-side. Token never logged or returned.
 */
import { createSign } from 'crypto';

const API = 'https://api.github.com';
const UA = 'LINGORA-Engineering-Write/seek-5.0';

export const ALLOWED_OWNER = 'lingora-labs';
export const ALLOWED_REPO = 'lingora';

function requiredEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not configured`);
  return v;
}

function normalizePem(raw: string): string {
  return raw.replace(/\\n/g, '\n').trim();
}

function b64url(input: Buffer | string): string {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  return buf.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function appJwt(): string {
  const appId = requiredEnv('GITHUB_APP_ID');
  const pem = normalizePem(requiredEnv('GITHUB_PRIVATE_KEY'));
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({ iat: now - 30, exp: now + 540, iss: appId }));
  const data = `${header}.${payload}`;
  const signer = createSign('RSA-SHA256');
  signer.update(data);
  const sig = b64url(signer.sign(pem));
  return `${data}.${sig}`;
}

let cachedToken: { token: string; expiresAt: number } | null = null;

export async function getInstallationToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt - 60_000 > now) return cachedToken.token;

  const installationId = requiredEnv('GITHUB_INSTALLATION_ID');
  const jwt = appJwt();
  const res = await fetch(`${API}/app/installations/${installationId}/access_tokens`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${jwt}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': UA,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub App token failed: ${res.status} ${text.slice(0, 200)}`);
  }
  const body = (await res.json()) as { token: string; expires_at: string };
  cachedToken = { token: body.token, expiresAt: Date.parse(body.expires_at) };
  return body.token;
}

export async function gh<T = unknown>(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; data: T }> {
  const token = await getInstallationToken();
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': UA,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: T;
  try {
    data = text ? (JSON.parse(text) as T) : ({} as T);
  } catch {
    data = { raw: text } as T;
  }
  return { status: res.status, data };
}

export function assertRepo(owner: string, repo: string) {
  if (owner !== ALLOWED_OWNER || repo !== ALLOWED_REPO) {
    throw new Error(`Policy: only ${ALLOWED_OWNER}/${ALLOWED_REPO} is allowed`);
  }
}

export function githubConfigured(): {
  githubAppConfigured: boolean;
  installationConfigured: boolean;
  privateKeyConfigured: boolean;
} {
  return {
    githubAppConfigured: Boolean(process.env.GITHUB_APP_ID),
    installationConfigured: Boolean(process.env.GITHUB_INSTALLATION_ID),
    privateKeyConfigured: Boolean(process.env.GITHUB_PRIVATE_KEY),
  };
}
