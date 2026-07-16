import fs from 'node:fs/promises';
import path from 'node:path';
import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminRequest } from '@/lib/admin-auth';
import { sendGatewayRequest } from '@/lib/admin-gateway-request';
import { sendGatewayMessage } from '@/lib/admin-gateway';
import { resolveSafePath } from '@/lib/fs-security';
import { buildJobPrompt, engineSpec, jobResultPath, newJobId, sessionRefPath } from '@/lib/jobs';

// POST /api/admin/jobs — create a PTY session in `cwd`, start the engine interactively,
// inject the task with the out-of-band result tail. Returns { job_id, session_id }.
// The verdict is fetched later from GET /api/admin/jobs/:id/result (host-local reader).
//
// NOTE (needs live tuning on a real deployment): the delay between starting the engine and
// injecting the prompt is a fixed heuristic — a TUI engine (claude) must be ready to accept
// input. Tune ENGINE_STARTUP_MS per engine/host.
const ENGINE_STARTUP_MS = Number(process.env.ENGINE_STARTUP_MS || 6000);
// Live-tuned on real claude (2026-07-16): the engine first-run shows a folder-trust dialog
// that --dangerously-skip-permissions does NOT bypass, and its TUI uses bracketed paste, so
// an injected trailing \n does not submit. So: after startup, send Enter to accept trust;
// after pasting the task, send a separate Enter to submit.
const TRUST_SETTLE_MS = Number(process.env.TRUST_SETTLE_MS || 4000);
const SUBMIT_DELAY_MS = Number(process.env.SUBMIT_DELAY_MS || 1500);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
    const spec = engineSpec(engine); // throws on unknown engine
    const launch = spec.launch;

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

    // Start the engine.
    await sendGatewayMessage({ type: 'input', sessionId, data: `${launch}\n` });
    await sleep(ENGINE_STARTUP_MS);
    // Accept the folder-trust dialog (Enter = "Yes") only for engines that show one — an extra
    // Enter on codex/opencode would submit an empty turn.
    if (spec.needsTrustAccept) {
      await sendGatewayMessage({ type: 'input', sessionId, data: '\r' });
      await sleep(TRUST_SETTLE_MS);
    }
    // Paste the task+tail, then submit with a separate Enter (bracketed paste).
    const prompt = buildJobPrompt(task, jobResultPath(jobId), nonce);
    await sendGatewayMessage({ type: 'input', sessionId, data: prompt });
    await sleep(SUBMIT_DELAY_MS);
    await sendGatewayMessage({ type: 'input', sessionId, data: '\r' });

    return NextResponse.json({ job_id: jobId, session_id: sessionId }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Server error' },
      { status: 500 },
    );
  }
}
