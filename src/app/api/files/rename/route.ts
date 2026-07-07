import fs from 'node:fs/promises';
import path from 'node:path';
import { NextRequest, NextResponse } from 'next/server';
import { verifyToken } from '@/lib/auth';
import { resolveSafePath } from '@/lib/fs-security';

export async function POST(req: NextRequest) {
  const token = req.cookies.get('wc-token')?.value;
  if (!token || !verifyToken(token)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const { oldPath, newPath } = await req.json();
    if (!oldPath || !newPath) return NextResponse.json({ error: 'oldPath and newPath required' }, { status: 400 });
    const safeOld = resolveSafePath(oldPath);
    const safeNew = resolveSafePath(newPath);
    await fs.mkdir(path.dirname(safeNew), { recursive: true });
    await fs.rename(safeOld, safeNew);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed' }, { status: 400 });
  }
}
