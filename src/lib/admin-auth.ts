import { NextRequest, NextResponse } from 'next/server';

function isLoopback(value: string) {
  const host = value.trim().replace(/^::ffff:/, '');
  return host === '127.0.0.1' || host === '::1' || host === 'localhost';
}

export function verifyAdminRequest(req: NextRequest): NextResponse | null {
  const forwardedFor = req.headers.get('x-forwarded-for');
  if (forwardedFor) {
    const firstHop = forwardedFor.split(',')[0]?.trim();
    if (firstHop && !isLoopback(firstHop)) {
      return NextResponse.json({ error: 'Admin API is localhost-only' }, { status: 403 });
    }
  }

  const expected = process.env.WEB_CONSOLE_ADMIN_TOKEN || process.env.JWT_SECRET;
  if (!expected) return NextResponse.json({ error: 'Admin token is not configured' }, { status: 503 });

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
