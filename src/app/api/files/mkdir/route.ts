import fs from 'node:fs/promises';
import { NextRequest, NextResponse } from 'next/server';
import { verifyToken } from '@/lib/auth';
import { resolveSafePath } from '@/lib/fs-security';

export async function POST(req: NextRequest) {
  const token = req.cookies.get('wc-token')?.value;
  if (!token || !verifyToken(token)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const { path: dirPath } = await req.json();
    if (!dirPath) return NextResponse.json({ error: 'path required' }, { status: 400 });
    const safePath = resolveSafePath(dirPath);
    await fs.mkdir(safePath, { recursive: true });
    return NextResponse.json({ ok: true, path: safePath });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed' }, { status: 400 });
  }
}
