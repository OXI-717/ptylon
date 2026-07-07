import fs from 'node:fs/promises';
import path from 'node:path';
import { NextRequest, NextResponse } from 'next/server';
import { verifyToken } from '@/lib/auth';
import { resolveSafePath } from '@/lib/fs-security';

export async function POST(req: NextRequest) {
  const token = req.cookies.get('wc-token')?.value;
  if (!token || !verifyToken(token)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const { path: filePath, content } = await req.json();
    if (!filePath || typeof content !== 'string') return NextResponse.json({ error: 'path and content required' }, { status: 400 });
    const safePath = resolveSafePath(filePath);
    await fs.mkdir(path.dirname(safePath), { recursive: true });
    await fs.writeFile(safePath, content, 'utf8');
    return NextResponse.json({ ok: true, path: safePath });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed' }, { status: 400 });
  }
}
