import fs from 'node:fs/promises';
import path from 'node:path';
import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminRequest } from '@/lib/admin-auth';
import { sendGatewayMessage } from '@/lib/admin-gateway';
import { sendGatewayRequest } from '@/lib/admin-gateway-request';
import { buildEnvFile, buildExecCommand, execEnvFilePath, execSessionRefPath, newExecId, validateExecRequest } from '@/lib/exec';
import { resolveSafePath } from '@/lib/fs-security';

// POST /api/admin/exec — run ONE argv to completion in a PTY bash session (headless engine
// invocation for an external pipeline; client contract in OXI-717/oxi-skills#1074). The
// caller's log_path/rc_path live on a filesystem shared with the seat (bind mount): stdout+
// stderr append to log_path, and on completion a wrapper writes {"rc": N, "nonce"} to
// rc_path — the CLIENT polls that file; this API only reports liveness (GET) and kills
// (DELETE). env values go through a 0600 file sourced by the session, NEVER onto the
// command line (the line lands in the attachable scrollback — a token there would leak).
export async function POST(req: NextRequest) {
  const denied = verifyAdminRequest(req);
  if (denied) return denied;
  try {
    let parsed;
    try {
      parsed = validateExecRequest(await req.json());
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : 'invalid request' }, { status: 400 });
    }

    const execId = newExecId();
    const envFilePath = resolveSafePath(execEnvFilePath(execId));
    await fs.mkdir(path.dirname(envFilePath), { recursive: true });
    await fs.writeFile(envFilePath, buildEnvFile(parsed.env), { encoding: 'utf8', mode: 0o600 });

    const created = await sendGatewayRequest(
      { type: 'create', cwd: parsed.cwd, cols: 200, rows: 50, name: execId },
      'created',
    );
    const sessionId = String(created.sessionId || '');
    if (!sessionId) {
      return NextResponse.json({ error: 'daemon did not return a sessionId' }, { status: 502 });
    }

    // Persist exec_id → session_id so GET (liveness) and DELETE (kill) can find the session.
    const refPath = resolveSafePath(execSessionRefPath(execId));
    await fs.writeFile(refPath, sessionId, 'utf8');

    await sendGatewayMessage({
      type: 'input',
      sessionId,
      data: buildExecCommand(parsed, envFilePath),
    });

    return NextResponse.json({ exec_id: execId, session_id: sessionId }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Server error' },
      { status: 500 },
    );
  }
}
