import { describe, expect, it } from 'vitest';

import { buildEnvFile, buildExecCommand, shq, validateExecRequest } from './exec';

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
