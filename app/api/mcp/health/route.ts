import { NextResponse } from 'next/server';
import { githubConfigured } from '@/lib/engineering/github-app';
import { currentPolicy, planeEnabled } from '@/lib/engineering/policy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  if (!planeEnabled()) return new NextResponse('Not found', { status: 404 });
  const gh = githubConfigured();
  const policy = currentPolicy();

  return NextResponse.json({
    service: 'lingora-engineering-write',
    repository: 'lingora-labs/lingora',
    githubAppConfigured: gh.githubAppConfigured,
    installationConfigured: gh.installationConfigured,
    privateKeyConfigured: gh.privateKeyConfigured,
    mcpTokenConfigured: Boolean(process.env.LINGORA_MCP_TOKEN),
    mainWritePolicy: policy.mainWrite ? 'enabled' : 'disabled',
    queryKeyChannel: policy.queryKeyChannel ? 'enabled' : 'disabled',
    rollback: policy.rollback,
    mcpAuthentication: 'required',
    note: 'Flags report configuration presence only. Functional auth is proven by tools/call.',
  });
}
