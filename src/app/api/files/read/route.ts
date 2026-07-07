import fs from 'node:fs/promises';
import { NextRequest, NextResponse } from 'next/server';
import { verifyToken } from '@/lib/auth';
import { resolveSafePath } from '@/lib/fs-security';

export async function GET(req: NextRequest) {
  const token = req.cookies.get('wc-token')?.value;
  if (!token || !verifyToken(token)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const reqPath = req.nextUrl.searchParams.get('path');
    if (!reqPath) return NextResponse.json({ error: 'path required' }, { status: 400 });
    const safePath = resolveSafePath(reqPath);
    const raw = req.nextUrl.searchParams.get('raw') === '1';
    if (raw) {
      const buf = await fs.readFile(safePath);
      const l = safePath.toLowerCase();
      const type = l.endsWith('.png') ? 'image/png' : l.endsWith('.jpg') || l.endsWith('.jpeg') ? 'image/jpeg' :
        l.endsWith('.gif') ? 'image/gif' : l.endsWith('.webp') ? 'image/webp' : l.endsWith('.svg') ? 'image/svg+xml' :
        l.endsWith('.pdf') ? 'application/pdf' : 'application/octet-stream';
      return new NextResponse(buf, { headers: { 'Content-Type': type } });
    }
    const content = await fs.readFile(safePath, 'utf8');
    return NextResponse.json({ path: safePath, content });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed' }, { status: 400 });
  }
}
