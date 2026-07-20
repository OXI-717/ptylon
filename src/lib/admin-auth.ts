import { NextRequest, NextResponse } from 'next/server';
import { appendAudit } from '@/lib/admin-audit';
import { loadAdminClients, matchClient, tokenFingerprint } from '@/lib/admin-tokens';

function isLoopback(value: string) {
  const host = value.trim().replace(/^::ffff:/, '');
  return host === '127.0.0.1' || host === '::1' || host === 'localhost';
}

export function verifyAdminRequest(req: NextRequest): NextResponse | null {
  const at = Date.now();
  const route = req.nextUrl.pathname;
  const method = req.method;
  const allowRemote = process.env.ADMIN_ALLOW_REMOTE === '1' || process.env.ADMIN_ALLOW_REMOTE === 'true';

  const deny = (status: number, error: string, client: string | null, fingerprint: string): NextResponse => {
    appendAudit({ at, client, fingerprint, method, route, outcome: 'denied' });
    return NextResponse.json({ error }, { status });
  };

  if (!allowRemote) {
    const forwardedFor = req.headers.get('x-forwarded-for');
    if (forwardedFor) {
      const firstHop = forwardedFor.split(',')[0]?.trim();
      if (firstHop && !isLoopback(firstHop)) {
        return deny(403, 'Admin API is localhost-only', null, '');
      }
    }
  }

  const clients = loadAdminClients();
  if (clients.length === 0) {
    return deny(503, 'Admin token is not configured', null, '');
  }

  const headerToken = req.headers.get('x-web-console-admin-token');
  const bearer = req.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
  const provided = headerToken || bearer || '';
  const fingerprint = provided ? tokenFingerprint(provided) : '';
  const client = matchClient(provided, clients, at);

  if (!client) {
    return deny(401, 'Unauthorized', null, fingerprint);
  }

  if (allowRemote && client.token.length < 16) {
    return deny(
      503,
      'ADMIN_ALLOW_REMOTE requires an admin token of at least 16 chars',
      client.name,
      fingerprint,
    );
  }

  appendAudit({ at, client: client.name, fingerprint, method, route, outcome: 'ok' });
  return null;
}
