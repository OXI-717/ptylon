import path from 'node:path';

import { JOBS_ROOT } from './jobs';

// Admin exec — run ONE argv to completion inside a PTY bash session (headless engine calls
// from an external pipeline, e.g. the oxi-task-runner autopilot daemon; see
// OXI-717/oxi-skills#1074 for the client contract). Unlike jobs (task prompt → engine TUI /
// engine run → result.json), exec is engine-agnostic: the caller supplies the full argv and
// two host paths on a shared bind mount — a log file (stdout+stderr, append) and an rc file
// the wrapper writes `{"rc": N, "nonce": "..."}` to on completion. The caller polls the rc
// file on the shared filesystem; GET /api/admin/exec/:id only reports session liveness.

export const EXEC_ROOT = path.join(JOBS_ROOT, 'exec');

export function execSessionRefPath(execId: string): string {
  return path.join(EXEC_ROOT, execId, 'session.txt');
}

export function execEnvFilePath(execId: string): string {
  return path.join(EXEC_ROOT, execId, 'env.sh');
}

export function newExecId(): string {
  return `exec-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

// The nonce ends up inside a single-quoted shell word and a JSON string — restrict it to
// characters that are inert in both so it can never break out.
const NONCE_RE = /^[A-Za-z0-9_-]{1,128}$/;
// Env names go into `export NAME=...` lines — POSIX identifier only.
const ENV_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

export interface ExecRequest {
  argv: string[];
  cwd: string;
  env: Record<string, string>;
  log_path: string;
  rc_path: string;
  nonce: string;
}

export function validateExecRequest(body: unknown): ExecRequest {
  const b = (body ?? {}) as Record<string, unknown>;
  const argv = b.argv;
  if (!Array.isArray(argv) || argv.length === 0 || !argv.every((a) => typeof a === 'string' && a.length > 0)) {
    throw new Error('argv must be a non-empty array of non-empty strings');
  }
  const cwd = typeof b.cwd === 'string' ? b.cwd.trim() : '';
  if (!cwd || !path.isAbsolute(cwd)) throw new Error('cwd must be an absolute path');
  const logPath = typeof b.log_path === 'string' ? b.log_path.trim() : '';
  const rcPath = typeof b.rc_path === 'string' ? b.rc_path.trim() : '';
  if (!logPath || !path.isAbsolute(logPath)) throw new Error('log_path must be an absolute path');
  if (!rcPath || !path.isAbsolute(rcPath)) throw new Error('rc_path must be an absolute path');
  const nonce = typeof b.nonce === 'string' ? b.nonce : '';
  if (!NONCE_RE.test(nonce)) throw new Error('nonce must match [A-Za-z0-9_-]{1,128}');
  const envRaw = (b.env ?? {}) as Record<string, unknown>;
  if (typeof envRaw !== 'object' || Array.isArray(envRaw)) throw new Error('env must be an object');
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(envRaw)) {
    if (!ENV_NAME_RE.test(k)) throw new Error(`env name ${JSON.stringify(k)} is not a valid identifier`);
    if (typeof v !== 'string') throw new Error(`env value for ${k} must be a string`);
    env[k] = v;
  }
  return { argv, cwd, env, log_path: logPath, rc_path: rcPath, nonce };
}

// Single-quote a string for POSIX shell: close, escaped quote, reopen.
export function shq(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

// Env values NEVER go on the injected command line — the line lands in the PTY scrollback,
// which is attachable and logged; a GH_TOKEN there would leak. Instead the route writes the
// exports to a 0600 file and the command sources it.
export function buildEnvFile(env: Record<string, string>): string {
  const lines = Object.entries(env).map(([k, v]) => `export ${k}=${shq(v)}`);
  return lines.join('\n') + (lines.length ? '\n' : '');
}

// The one line typed into the PTY bash session. Runs the argv with stdout+stderr appended to
// log_path, then writes {"rc": N, "nonce": "..."} to rc_path (tmp+mv so the polling client
// never reads a torn write), then exits the session — session death is the liveness signal.
export function buildExecCommand(req: ExecRequest, envFilePath: string): string {
  const argv = req.argv.map(shq).join(' ');
  const log = shq(req.log_path);
  const rc = shq(req.rc_path);
  const rcTmp = shq(`${req.rc_path}.tmp`);
  const envf = shq(envFilePath);
  return (
    `set -a; . ${envf} 2>/dev/null; set +a; ` +
    `cd ${shq(req.cwd)} && ` +
    `${argv} >> ${log} 2>&1; ` +
    `_rc=$?; printf '{"rc": %d, "nonce": "${req.nonce}"}' "$_rc" > ${rcTmp} && mv ${rcTmp} ${rc}; ` +
    `exit\n`
  );
}
