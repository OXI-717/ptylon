import fs from 'node:fs/promises';
import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminRequest } from '@/lib/admin-auth';
import { resolveSafePath } from '@/lib/fs-security';
import { jobResultPath } from '@/lib/jobs';

// GET /api/admin/jobs/:id/result — host-local reader. Returns the raw result.json bytes the
// engine wrote (out-of-band), or 404 if not yet present. Path is jailed via resolveSafePath,
// so JOBS_ROOT must live under FILE_ACCESS_ROOT.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = verifyAdminRequest(req);
  if (denied) return denied;
  try {
    const { id } = await params;
    const safe = resolveSafePath(jobResultPath(id));
    const buf = await fs.readFile(safe);
    return new NextResponse(buf, { headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
      return new NextResponse(null, { status: 404 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed' },
      { status: 400 },
    );
  }
}
