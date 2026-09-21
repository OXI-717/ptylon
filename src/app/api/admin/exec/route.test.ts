import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/admin-auth', () => ({ verifyAdminRequest: vi.fn(() => null) }));
vi.mock('@/lib/admin-gateway', () => ({ sendGatewayMessage: vi.fn() }));
vi.mock('@/lib/admin-gateway-request', () => ({ sendGatewayRequest: vi.fn() }));

import { sendGatewayMessage } from '@/lib/admin-gateway';
import { sendGatewayRequest } from '@/lib/admin-gateway-request';
import { EXEC_ENV_GRACE_MS } from '@/lib/exec';

const SECRET = 'zai-secret-route-value';

let tempDir: string;
let execRoot: string;
let POST: (req: NextRequest) => Promise<Response>;

function requestBody(): Record<string, unknown> {
  return {
    argv: ['true'],
    cwd: tempDir,
    env: { ZAI_API_KEY: SECRET },
    log_path: path.join(tempDir, 'run.log'),
    rc_path: path.join(tempDir, 'run.rc'),
    nonce: 'nonce-route',
  };
}

function post(body: unknown): Promise<Response> {
  return POST(
    new NextRequest('http://localhost/api/admin/exec', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  );
}

function envFilesUnderExecRoot(): string[] {
  if (!existsSync(execRoot)) return [];
  return readdirSync(execRoot)
    .map((d) => path.join(execRoot, d, 'env.sh'))
    .filter((p) => existsSync(p));
}

beforeEach(async () => {
  tempDir = mkdtempSync(path.join(tmpdir(), 'exec-route-'));
  execRoot = path.join(tempDir, 'jobs', 'exec');
  process.env.JOBS_ROOT = path.join(tempDir, 'jobs');
  process.env.WORKSPACE_ROOT = tempDir;
  process.env.FILE_ACCESS_ROOT = tempDir;
  vi.resetModules();
  ({ POST } = await import('./route'));
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.JOBS_ROOT;
  delete process.env.WORKSPACE_ROOT;
  delete process.env.FILE_ACCESS_ROOT;
  rmSync(tempDir, { recursive: true, force: true });
});

describe('POST /api/admin/exec env.sh lifecycle (OXI-717/oxi-skills#2974)', () => {
  it('happy path: env.sh waits for the handoff, the injected line sources then removes it', async () => {
    vi.mocked(sendGatewayRequest).mockResolvedValue({ sessionId: 'sess-1' });
    vi.mocked(sendGatewayMessage).mockResolvedValue(undefined);

    const res = await post(requestBody());

    expect(res.status).toBe(201);
    const { exec_id } = (await res.json()) as { exec_id: string };
    const envPath = path.join(execRoot, exec_id, 'env.sh');
    // env.sh must exist until the session sources it — and only as 0600 exports
    expect(statSync(envPath).mode & 0o777).toBe(0o600);
    expect(readFileSync(path.join(execRoot, exec_id, 'session.txt'), 'utf8')).toBe('sess-1');
    const input = vi.mocked(sendGatewayMessage).mock.calls[0][0] as { data: string };
    const sourceIdx = input.data.indexOf(`. '${envPath}'`);
    const rmIdx = input.data.indexOf(`rm -f -- '${envPath}'`);
    expect(sourceIdx).toBeGreaterThanOrEqual(0);
    expect(rmIdx).toBeGreaterThan(sourceIdx);
    // the typed line carries no secret material
    expect(input.data).not.toContain(SECRET);
  });

  it('gateway create failure: the new env.sh is removed with the failed handoff', async () => {
    vi.mocked(sendGatewayRequest).mockRejectedValue(new Error('gateway down'));

    const res = await post(requestBody());

    expect(res.status).toBe(500);
    expect(envFilesUnderExecRoot()).toEqual([]);
  });

  it('missing sessionId: 502 and env.sh removed', async () => {
    vi.mocked(sendGatewayRequest).mockResolvedValue({});

    const res = await post(requestBody());

    expect(res.status).toBe(502);
    expect(envFilesUnderExecRoot()).toEqual([]);
  });

  it('input injection failure: env.sh removed even though the session exists', async () => {
    vi.mocked(sendGatewayRequest).mockResolvedValue({ sessionId: 'sess-1' });
    vi.mocked(sendGatewayMessage).mockRejectedValue(new Error('ws closed'));

    const res = await post(requestBody());

    expect(res.status).toBe(500);
    expect(envFilesUnderExecRoot()).toEqual([]);
  });

  it('bounded sweep on POST: drops stale env.sh of never-started execs, keeps fresh ones', async () => {
    const staleDir = path.join(execRoot, 'exec-stale');
    const freshDir = path.join(execRoot, 'exec-fresh');
    mkdirSync(staleDir, { recursive: true });
    mkdirSync(freshDir, { recursive: true });
    writeFileSync(path.join(staleDir, 'env.sh'), 'export OLD=1\n', { mode: 0o600 });
    writeFileSync(path.join(freshDir, 'env.sh'), 'export NEW=1\n', { mode: 0o600 });
    const past = new Date(Date.now() - EXEC_ENV_GRACE_MS - 60_000);
    utimesSync(path.join(staleDir, 'env.sh'), past, past);
    vi.mocked(sendGatewayRequest).mockRejectedValue(new Error('gateway down'));

    await post(requestBody());

    expect(existsSync(path.join(staleDir, 'env.sh'))).toBe(false);
    expect(existsSync(path.join(freshDir, 'env.sh'))).toBe(true);
  });
});
