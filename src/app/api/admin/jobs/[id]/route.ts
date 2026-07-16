import fs from 'node:fs/promises';
import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminRequest } from '@/lib/admin-auth';
import { sendGatewayRequest } from '@/lib/admin-gateway-request';
import { resolveSafePath } from '@/lib/fs-security';
import { sessionRefPath } from '@/lib/jobs';

const TAIL_CHARS = 4000;

// GET /api/admin/jobs/:id — liveness + recent PTY tail for the client dispatcher's
// classify(): { status, pty_tail, process_alive }. Liveness/tail come from attaching to the
// session (daemon returns `scrollback`); a missing session means the engine exited.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = verifyAdminRequest(req);
  if (denied) return denied;
  try {
    const { id } = await params;
    let sessionId: string;
    try {
      sessionId = (await fs.readFile(resolveSafePath(sessionRefPath(id)), 'utf8')).trim();
    } catch {
      return NextResponse.json({ status: 'unknown', pty_tail: '', process_alive: false });
    }

    try {
      const res = await sendGatewayRequest({ type: 'attach', sessionId }, 'scrollback');
      const data = typeof res.data === 'string' ? res.data : '';
      return NextResponse.json({
        status: 'running',
        pty_tail: data.slice(-TAIL_CHARS),
        process_alive: true,
      });
    } catch {
      // attach failed → session no longer exists → engine exited.
      return NextResponse.json({ status: 'exited', pty_tail: '', process_alive: false });
    }
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed' },
      { status: 400 },
    );
  }
}
