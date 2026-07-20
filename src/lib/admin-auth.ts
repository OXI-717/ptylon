import { NextRequest, NextResponse } from 'next/server';

function isLoopback(value: string) {
  const host = value.trim().replace(/^::ffff:/, '');
  return host === '127.0.0.1' || host === '::1' || host === 'localhost';
}

export function verifyAdminRequest(req: NextRequest): NextResponse | null {
  // By default the admin API is localhost-only (Ptylon's web-console posture): a request
  // whose x-forwarded-for first hop is non-loopback is rejected. For the oxi-remote-agents
  // seat model the security boundary is the admin token itself (each seat holds its own), and
  // the dispatcher reaches the container over the network — so ADMIN_ALLOW_REMOTE=1 drops the
  // loopback requirement and relies solely on the constant-time token compare below. Left off
  // by default so existing/upstream deployments keep the stricter localhost posture.
  const allowRemote = process.env.ADMIN_ALLOW_REMOTE === '1' || process.env.ADMIN_ALLOW_REMOTE === 'true';
  if (!allowRemote) {
    const forwardedFor = req.headers.get('x-forwarded-for');
    if (forwardedFor) {
      const firstHop = forwardedFor.split(',')[0]?.trim();
      if (firstHop && !isLoopback(firstHop)) {
        return NextResponse.json({ error: 'Admin API is localhost-only' }, { status: 403 });
      }
    }
  }

  const expected = process.env.WEB_CONSOLE_ADMIN_TOKEN || process.env.JWT_SECRET;
  if (!expected) return NextResponse.json({ error: 'Admin token is not configured' }, { status: 503 });
  // Token-only remote access makes the token the sole boundary — refuse a weak secret.
  if (allowRemote && expected.length < 16) {
    return NextResponse.json(
      { error: 'ADMIN_ALLOW_REMOTE requires an admin token of at least 16 chars' },
      { status: 503 },
    );
  }

  const headerToken = req.headers.get('x-web-console-admin-token');
  const bearer = req.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
  const provided = headerToken || bearer || '';
  if (provided.length !== expected.length) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) {
    diff |= expected.charCodeAt(i) ^ provided.charCodeAt(i);
  }
  return diff === 0 ? null : NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}
