import fs from 'node:fs/promises';
import path from 'node:path';
import { NextRequest, NextResponse } from 'next/server';
import { verifyToken } from '@/lib/auth';
import { resolveSafePath } from '@/lib/fs-security';
import { WORKSPACE_ROOT } from '@/lib/server-config';

function checkAuth(req: NextRequest): boolean {
  const token = req.cookies.get('wc-token')?.value;
  return !!token && verifyToken(token);
}

export async function GET(req: NextRequest) {
  if (!checkAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const reqPath = req.nextUrl.searchParams.get('path') ?? WORKSPACE_ROOT;
    const safePath = resolveSafePath(reqPath);
    const entries = await fs.readdir(safePath, { withFileTypes: true });
    const data = await Promise.all(entries.map(async (entry) => {
      const fullPath = path.join(safePath, entry.name);
      try {
        const st = await fs.stat(fullPath);
        return { name: entry.name, path: fullPath, type: entry.isDirectory() ? 'dir' : 'file', size: st.size, mtime: st.mtime.toISOString() };
      } catch {
        return { name: entry.name, path: fullPath, type: 'file', size: 0, mtime: '' };
      }
    }));
    data.sort((a, b) => a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1);
    return NextResponse.json({ path: safePath, entries: data });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed' }, { status: 400 });
  }
}

export async function DELETE(req: NextRequest) {
  if (!checkAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const reqPath = req.nextUrl.searchParams.get('path');
    if (!reqPath) return NextResponse.json({ error: 'path required' }, { status: 400 });
    const safePath = resolveSafePath(reqPath);
    const st = await fs.stat(safePath);
    if (st.isDirectory()) await fs.rm(safePath, { recursive: true });
    else await fs.unlink(safePath);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed' }, { status: 400 });
  }
}
