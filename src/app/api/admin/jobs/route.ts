import fs from 'node:fs/promises';
import path from 'node:path';
import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminRequest } from '@/lib/admin-auth';
import { sendGatewayRequest } from '@/lib/admin-gateway-request';
import { sendGatewayMessage } from '@/lib/admin-gateway';
import { resolveSafePath } from '@/lib/fs-security';
import { buildJobPrompt, engineLaunchCommand, jobResultPath, newJobId, sessionRefPath } from '@/lib/jobs';

// POST /api/admin/jobs — create a PTY session in `cwd`, start the engine interactively,
// inject the task with the out-of-band result tail. Returns { job_id, session_id }.
// The verdict is fetched later from GET /api/admin/jobs/:id/result (host-local reader).
//
// NOTE (needs live tuning on a real deployment): the delay between starting the engine and
// injecting the prompt is a fixed heuristic — a TUI engine (claude) must be ready to accept
// input. Tune ENGINE_STARTUP_MS per engine/host.
const ENGINE_STARTUP_MS = Number(process.env.ENGINE_STARTUP_MS || 2500);

export async function POST(req: NextRequest) {
  const denied = verifyAdminRequest(req);
  if (denied) return denied;
  try {
    const body = await req.json();
    const engine = String(body?.engine || '').trim();
    const cwd = String(body?.cwd || '').trim();
    const task = String(body?.task || '');
    const nonce = String(body?.nonce || '').trim();
    if (!engine || !cwd || !task || !nonce) {
      return NextResponse.json({ error: 'engine, cwd, task, nonce are required' }, { status: 400 });
    }

    const jobId = newJobId();
    const launch = engineLaunchCommand(engine); // throws on unknown engine

    const created = await sendGatewayRequest(
      { type: 'create', cwd, cols: 200, rows: 50, name: jobId },
      'created',
    );
    const sessionId = String(created.sessionId || '');
    if (!sessionId) {
      return NextResponse.json({ error: 'daemon did not return a sessionId' }, { status: 502 });
    }

    // Persist job_id → session_id so the status endpoint can attach for liveness/pty tail.
    const refPath = resolveSafePath(sessionRefPath(jobId));
    await fs.mkdir(path.dirname(refPath), { recursive: true });
    await fs.writeFile(refPath, sessionId, 'utf8');

    // Start the engine, then inject the task+tail after it is ready.
    await sendGatewayMessage({ type: 'input', sessionId, data: `${launch}\n` });
    await new Promise((r) => setTimeout(r, ENGINE_STARTUP_MS));
    const prompt = buildJobPrompt(task, jobResultPath(jobId), nonce);
    await sendGatewayMessage({ type: 'input', sessionId, data: `${prompt}\n` });

    return NextResponse.json({ job_id: jobId, session_id: sessionId }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Server error' },
      { status: 500 },
    );
  }
}
