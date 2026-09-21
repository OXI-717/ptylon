import fs from 'node:fs/promises';
import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminRequest } from '@/lib/admin-auth';
import { sendGatewayMessage } from '@/lib/admin-gateway';
import { sendGatewayRequest } from '@/lib/admin-gateway-request';
import { buildExecCommand, execEnvFilePath, execSessionRefPath, newExecId, removeExecEnvFile, sweepExecEnvFiles, validateExecRequest, writeExecEnvFile } from '@/lib/exec';
import { resolveSafePath } from '@/lib/fs-security';

// POST /api/admin/exec — run ONE argv to completion in a PTY bash session (headless engine
// invocation for an external pipeline; client contract in OXI-717/oxi-skills#1074). The
// caller's log_path/rc_path live on a filesystem shared with the seat (bind mount): stdout+
// stderr append to log_path, and on completion a wrapper writes {"rc": N, "nonce"} to
// rc_path — the CLIENT polls that file; this API only reports liveness (GET) and kills
// (DELETE). env values go through a 0600 file sourced by the session, NEVER onto the
// command line (the line lands in the attachable scrollback — a token there would leak).
// env.sh must not outlive the startup handoff: the injected command removes it right after
// sourcing, a failed handoff unlinks it below, and the sweep drops files of execs that
// never started (OXI-717/oxi-skills#2974).
export async function POST(req: NextRequest) {
  const denied = verifyAdminRequest(req);
  if (denied) return denied;
  // Bounded fallback cleanup for stale env.sh files of execs that failed or never started.
  // Best-effort and path-only — contents are never read, so no secret material is touched.
  await sweepExecEnvFiles().catch(() => undefined);
  try {
    let parsed;
    try {
      parsed = validateExecRequest(await req.json());
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : 'invalid request' }, { status: 400 });
    }

    const execId = newExecId();
    const envFilePath = resolveSafePath(execEnvFilePath(execId));

    let sessionId: string;
    try {
      await writeExecEnvFile(execId, parsed.env);
      const created = await sendGatewayRequest(
        { type: 'create', cwd: parsed.cwd, cols: 200, rows: 50, name: execId },
        'created',
      );
      sessionId = String(created.sessionId || '');
      if (!sessionId) {
        await removeExecEnvFile(execId).catch(() => undefined);
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
    } catch (handoffError) {
      // The session will never source env.sh — do not leave provider secrets on disk.
      await removeExecEnvFile(execId).catch(() => undefined);
      throw handoffError;
    }

    return NextResponse.json({ exec_id: execId, session_id: sessionId }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Server error' },
      { status: 500 },
    );
  }
}
