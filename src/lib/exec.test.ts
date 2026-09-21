import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildEnvFile, buildExecCommand, EXEC_ENV_GRACE_MS, removeExecEnvFile, shq, sweepExecEnvFiles, validateExecRequest, writeExecEnvFile } from './exec';

const goodBody = {
  argv: ['claude', '-p', '--dangerously-skip-permissions'],
  cwd: '/opt/autopilot/repos/oxi-skills/.worktrees/task-1',
  env: { GH_TOKEN: 'tok-secret', PYTHONUNBUFFERED: '1' },
  log_path: '/opt/autopilot/state/logs/task-1.log',
  rc_path: '/opt/autopilot/state/logs/task-1.rc',
  nonce: 'abc-123_XY',
};

describe('validateExecRequest', () => {
  it('accepts a well-formed body', () => {
    const r = validateExecRequest(goodBody);
    expect(r.argv[0]).toBe('claude');
    expect(r.env.GH_TOKEN).toBe('tok-secret');
  });

  it.each([
    [{ ...goodBody, argv: [] }, /argv/],
    [{ ...goodBody, argv: ['ok', 42] }, /argv/],
    [{ ...goodBody, cwd: 'relative/path' }, /cwd/],
    [{ ...goodBody, log_path: '' }, /log_path/],
    [{ ...goodBody, rc_path: 'no/abs' }, /rc_path/],
    [{ ...goodBody, nonce: 'bad nonce with spaces' }, /nonce/],
    [{ ...goodBody, nonce: "x'; rm -rf /" }, /nonce/],
    [{ ...goodBody, env: { 'BAD-NAME': 'v' } }, /identifier/],
    [{ ...goodBody, env: { OK: 7 } }, /string/],
  ])('rejects malformed body %#', (body, re) => {
    expect(() => validateExecRequest(body)).toThrow(re);
  });
});

describe('shq', () => {
  it('quotes shell metacharacters inert', () => {
    expect(shq(`a'b; rm -rf $HOME`)).toBe(`'a'\\''b; rm -rf $HOME'`);
  });
});

describe('buildEnvFile', () => {
  it('exports each variable single-quoted', () => {
    const f = buildEnvFile({ GH_TOKEN: `t'ok`, A: 'b' });
    expect(f).toContain(`export GH_TOKEN='t'\\''ok'`);
    expect(f).toContain(`export A='b'`);
  });
});

describe('buildExecCommand', () => {
  const cmd = buildExecCommand(validateExecRequest(goodBody), '/workspace/.agent-jobs/exec/e1/env.sh');

  it('sources the env file instead of inlining values (secrets must not hit scrollback)', () => {
    expect(cmd).toContain(`. '/workspace/.agent-jobs/exec/e1/env.sh'`);
    expect(cmd).not.toContain('tok-secret');
  });

  it('removes the env file right after sourcing, before the argv runs', () => {
    const envf = '/workspace/.agent-jobs/exec/e1/env.sh';
    const sourceIdx = cmd.indexOf(`. '${envf}'`);
    const rmIdx = cmd.indexOf(`rm -f -- '${envf}'`);
    expect(sourceIdx).toBeGreaterThanOrEqual(0);
    expect(rmIdx).toBeGreaterThan(sourceIdx);
    expect(rmIdx).toBeLessThan(cmd.indexOf('cd '));
  });

  it('runs the argv in cwd with output appended to log_path', () => {
    expect(cmd).toContain(`cd '/opt/autopilot/repos/oxi-skills/.worktrees/task-1' && `);
    expect(cmd).toContain(`'claude' '-p' '--dangerously-skip-permissions' >> '/opt/autopilot/state/logs/task-1.log' 2>&1`);
  });

  it('writes {"rc", "nonce"} atomically (tmp+mv) and exits the session', () => {
    expect(cmd).toContain(`printf '{"rc": %d, "nonce": "abc-123_XY"}' "$_rc"`);
    expect(cmd).toContain(`.rc.tmp'`);
    expect(cmd).toContain(` && mv `);
    expect(cmd.trimEnd().endsWith('exit')).toBe(true);
  });

  it('keeps a quoted argv word intact', () => {
    const r = validateExecRequest({ ...goodBody, argv: ['sh', '-c', `echo 'x y'; true`] });
    const c = buildExecCommand(r, '/workspace/.agent-jobs/exec/e2/env.sh');
    expect(c).toContain(`'sh' '-c' 'echo '\\''x y'\\''; true'`);
  });
});

describe('env.sh lifecycle (OXI-717/oxi-skills#2974)', () => {
  const SECRET = 'zai-secret-unit-value';
  let tempDir: string;
  let execRoot: string;

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), 'exec-env-'));
    execRoot = path.join(tempDir, 'exec');
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  function runExec(body: Record<string, unknown>, envFilePath: string): string {
    const cmd = buildExecCommand(validateExecRequest(body), envFilePath);
    execFileSync('bash', ['-c', cmd], { stdio: 'pipe' });
    return cmd;
  }

  it('writeExecEnvFile writes the exports 0600 under exec/<id>/env.sh', async () => {
    const p = await writeExecEnvFile('exec-p', { TEST_TOKEN: SECRET, A: '1' }, execRoot);
    expect(p).toBe(path.join(execRoot, 'exec-p', 'env.sh'));
    expect(statSync(p).mode & 0o777).toBe(0o600);
    expect(readFileSync(p, 'utf8')).toBe(buildEnvFile({ TEST_TOKEN: SECRET, A: '1' }));
  });

  it('successful session: env reaches the argv, env.sh is removed, rc is written', async () => {
    const envFilePath = await writeExecEnvFile('exec-ok', { TEST_TOKEN: SECRET }, execRoot);
    const logPath = path.join(tempDir, 'ok.log');
    const rcPath = path.join(tempDir, 'ok.rc');
    const cmd = runExec(
      {
        argv: ['sh', '-c', 'echo "${#TEST_TOKEN}"'],
        cwd: tempDir,
        env: {},
        log_path: logPath,
        rc_path: rcPath,
        nonce: 'nonce-ok',
      },
      envFilePath,
    );
    expect(cmd).not.toContain(SECRET);
    expect(existsSync(envFilePath)).toBe(false);
    expect(JSON.parse(readFileSync(rcPath, 'utf8'))).toEqual({ rc: 0, nonce: 'nonce-ok' });
    const log = readFileSync(logPath, 'utf8');
    // the value arrived intact (length printed) without the secret hitting output/logs
    expect(log.trim()).toBe(String(SECRET.length));
    expect(log).not.toContain(SECRET);
  });

  it('failed session (argv exits non-zero): env.sh is still removed, rc reports the code', async () => {
    const envFilePath = await writeExecEnvFile('exec-fail', { TEST_TOKEN: SECRET }, execRoot);
    const rcPath = path.join(tempDir, 'fail.rc');
    runExec(
      {
        argv: ['sh', '-c', 'exit 3'],
        cwd: tempDir,
        env: {},
        log_path: path.join(tempDir, 'fail.log'),
        rc_path: rcPath,
        nonce: 'nonce-fail',
      },
      envFilePath,
    );
    expect(existsSync(envFilePath)).toBe(false);
    expect(JSON.parse(readFileSync(rcPath, 'utf8')).rc).toBe(3);
  });

  it('removeExecEnvFile unlinks the file and tolerates a missing one', async () => {
    const p = await writeExecEnvFile('exec-rm', { A: '1' }, execRoot);
    await removeExecEnvFile('exec-rm', execRoot);
    expect(existsSync(p)).toBe(false);
    await expect(removeExecEnvFile('exec-rm', execRoot)).resolves.toBeUndefined();
  });
});

describe('sweepExecEnvFiles', () => {
  let tempDir: string;
  let execRoot: string;

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), 'exec-sweep-'));
    execRoot = path.join(tempDir, 'exec');
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('removes stale env.sh of never-started execs, keeps fresh ones, isolates other files', async () => {
    const stale = await writeExecEnvFile('exec-old', { T: 's' }, execRoot);
    const fresh = await writeExecEnvFile('exec-new', { T: 's' }, execRoot);
    writeFileSync(path.join(execRoot, 'exec-old', 'session.txt'), 'sess-old');
    writeFileSync(path.join(execRoot, 'stray-file'), 'x');
    mkdirSync(path.join(execRoot, 'exec-foreign', 'env.sh'), { recursive: true });
    const past = new Date(Date.now() - EXEC_ENV_GRACE_MS - 60_000);
    utimesSync(stale, past, past);

    const res = await sweepExecEnvFiles(Date.now(), execRoot);

    expect(res.removed).toEqual([stale]);
    expect(res.kept).toEqual([fresh]);
    expect(existsSync(stale)).toBe(false);
    // fresh env.sh stays: an in-flight session still needs it for its one startup source
    expect(existsSync(fresh)).toBe(true);
    // unrelated exec artifacts and foreign entries are untouched
    expect(existsSync(path.join(execRoot, 'exec-old', 'session.txt'))).toBe(true);
    expect(existsSync(path.join(execRoot, 'stray-file'))).toBe(true);
    expect(statSync(path.join(execRoot, 'exec-foreign', 'env.sh')).isDirectory()).toBe(true);
    // sweep reports paths only — never file contents
    expect(readdirSync(execRoot)).not.toContain('env.sh');
  });

  it('is a no-op when the exec root does not exist', async () => {
    await expect(sweepExecEnvFiles(Date.now(), path.join(tempDir, 'missing'))).resolves.toEqual({
      removed: [],
      kept: [],
    });
  });
});
