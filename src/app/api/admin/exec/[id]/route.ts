import fs from 'node:fs/promises';
import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminRequest } from '@/lib/admin-auth';
import { sendGatewayMessage } from '@/lib/admin-gateway';
import { sendGatewayRequest } from '@/lib/admin-gateway-request';
import { execSessionRefPath } from '@/lib/exec';
import { resolveSafePath } from '@/lib/fs-security';

async function readSessionId(execId: string): Promise<string | null> {
  try {
    return (await fs.readFile(resolveSafePath(execSessionRefPath(execId)), 'utf8')).trim() || null;
  } catch {
    return null;
  }
}

// GET /api/admin/exec/:id — session liveness for the polling client: { alive }. The exec
// command ends with `exit`, so session death == the argv finished (the client then trusts
// the rc file it polls on the shared filesystem; a dead session WITHOUT an rc file means
// the process was killed / the seat died — the client classifies that as an engine failure).
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = verifyAdminRequest(req);
  if (denied) return denied;
  const { id } = await params;
  const sessionId = await readSessionId(id);
  if (!sessionId) return NextResponse.json({ alive: false, status: 'unknown' });
  try {
    await sendGatewayRequest({ type: 'attach', sessionId }, 'scrollback');
    return NextResponse.json({ alive: true, status: 'running' });
  } catch {
    return NextResponse.json({ alive: false, status: 'exited' });
  }
}

// DELETE /api/admin/exec/:id — kill the session (the daemon SIGHUPs the PTY child tree).
// Idempotent: a missing/already-dead session is a success, not an error.
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = verifyAdminRequest(req);
  if (denied) return denied;
  const { id } = await params;
  const sessionId = await readSessionId(id);
  if (!sessionId) return NextResponse.json({ killed: false, status: 'unknown' });
  try {
    await sendGatewayMessage({ type: 'kill', sessionId });
    return NextResponse.json({ killed: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed' },
      { status: 500 },
    );
  }
}
