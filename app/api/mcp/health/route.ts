import { NextResponse } from 'next/server';
import { githubConfigured } from '@/lib/engineering/github-app';

export const runtime = 'nodejs';

export async function GET() {
  const gh = githubConfigured();

  return NextResponse.json({
    service: 'lingora-engineering-write',
    version: 'seek-5.0-main-write',
    repository: 'lingora-labs/lingora',
    githubAppConfigured: gh.githubAppConfigured,
    installationConfigured: gh.installationConfigured,
    privateKeyConfigured: gh.privateKeyConfigured,
    mcpTokenConfigured: Boolean(process.env.LINGORA_MCP_TOKEN),
    mainWritePolicy: 'enabled',
    rollback: 'revert-commit',
    mcpAuthentication: 'required',
    note: 'Flags report configuration presence only. Functional auth is proven by tools/call.',
  });
}
