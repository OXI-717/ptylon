/**
 * PTY Manager — manages persistent terminal sessions
 * Each terminal = own node-pty process, no tmux
 * Sessions survive browser disconnect, reconnect by ID
 */

import { spawn } from 'node-pty';
import { execFile } from 'child_process';
import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';

const SCROLLBACK_MAX_CHARS = 2_000_000; // ~2MB raw terminal data
const DEFAULT_IDLE_TIMEOUT_HOURS = 168; // 7 days
const MIN_IDLE_TIMEOUT_HOURS = 48;
const DEFAULT_CWD = process.env.WORKSPACE_ROOT || process.cwd();
const ALLOWED_CWD_ROOT = process.env.ALLOWED_CWD_ROOT || DEFAULT_CWD;
const execFileAsync = promisify(execFile);

function realpathOrFallback(target, fallback) {
  try {
    return fs.realpathSync.native(path.resolve(target));
  } catch {
    return fallback;
  }
}

const SAFE_CWD_ROOT = realpathOrFallback(ALLOWED_CWD_ROOT, process.cwd());

function resolveSafeCwd(inputCwd = DEFAULT_CWD) {
  const resolved = realpathOrFallback(inputCwd, SAFE_CWD_ROOT);
  const relative = path.relative(SAFE_CWD_ROOT, resolved);
  if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) {
    return resolved;
  }
  return SAFE_CWD_ROOT;
}

function parseIdleTimeoutHours(value) {
  if (value === undefined || value === '') return DEFAULT_IDLE_TIMEOUT_HOURS;

  const hours = Number(value);
  if (!Number.isFinite(hours) || hours <= 0) {
    console.warn(`[PTY] Invalid PTY_IDLE_TIMEOUT_HOURS=${JSON.stringify(value)}; using ${DEFAULT_IDLE_TIMEOUT_HOURS}h`);
    return DEFAULT_IDLE_TIMEOUT_HOURS;
  }

  if (hours < MIN_IDLE_TIMEOUT_HOURS) {
    console.warn(`[PTY] PTY_IDLE_TIMEOUT_HOURS=${hours}h is below minimum ${MIN_IDLE_TIMEOUT_HOURS}h; using ${MIN_IDLE_TIMEOUT_HOURS}h`);
    return MIN_IDLE_TIMEOUT_HOURS;
  }

  return hours;
}

const IDLE_TIMEOUT_HOURS = parseIdleTimeoutHours(process.env.PTY_IDLE_TIMEOUT_HOURS);
const IDLE_TIMEOUT_MS = IDLE_TIMEOUT_HOURS * 60 * 60 * 1000;

async function execFileLimited(file, args, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs || 800);
  try {
    return await execFileAsync(file, args, {
      cwd: options.cwd,
      signal: controller.signal,
      maxBuffer: options.maxBuffer || 256 * 1024,
    });
  } finally {
    clearTimeout(timer);
  }
}

function readProcessCwd(pid, fallback) {
  try {
    return fs.realpathSync.native(`/proc/${pid}/cwd`);
  } catch {
    return fallback;
  }
}

async function processRows() {
  try {
    const { stdout } = await execFileLimited('ps', ['-eo', 'pid=,ppid=,stat=,comm=,args='], { timeoutMs: 800 });
    return stdout.split(/\r?\n/)
      .map((line) => line.match(/^\s*(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s*(.*)$/))
      .filter(Boolean)
      .map((match) => ({
        pid: Number(match[1]),
        ppid: Number(match[2]),
        stat: match[3],
        comm: match[4],
        args: match[5] || match[4],
      }));
  } catch {
    return [];
  }
}

function descendantsOf(rows, rootPid) {
  const childrenByParent = new Map();
  for (const row of rows) {
    if (!childrenByParent.has(row.ppid)) childrenByParent.set(row.ppid, []);
    childrenByParent.get(row.ppid).push(row);
  }

  const result = [];
  const stack = [...(childrenByParent.get(rootPid) || [])];
  while (stack.length > 0) {
    const row = stack.shift();
    result.push(row);
    stack.push(...(childrenByParent.get(row.pid) || []));
  }
  return result;
}

function activeProcessForSession(rows, shellPid) {
  const shell = rows.find((row) => row.pid === shellPid) || null;
  const descendants = descendantsOf(rows, shellPid).filter((row) => !row.stat.includes('Z'));
  return descendants.at(-1) || shell || { pid: shellPid, comm: 'bash', args: 'bash' };
}

async function gitMetadata(cwd) {
  try {
    const inside = await execFileLimited('git', ['-C', cwd, 'rev-parse', '--is-inside-work-tree'], { timeoutMs: 700 });
    if (inside.stdout.trim() !== 'true') return null;
    const [root, branch, dirty] = await Promise.all([
      execFileLimited('git', ['-C', cwd, 'rev-parse', '--show-toplevel'], { timeoutMs: 700 }),
      execFileLimited('git', ['-C', cwd, 'branch', '--show-current'], { timeoutMs: 700 }),
      execFileLimited('git', ['-C', cwd, 'status', '--porcelain'], { timeoutMs: 1000, maxBuffer: 1024 * 1024 }),
    ]);
    return {
      root: root.stdout.trim(),
      branch: branch.stdout.trim() || 'detached',
      dirty: dirty.stdout.trim().length > 0,
    };
  } catch {
    return null;
  }
}

class PtyManager {
  constructor() {
    /** @type {Map<string, {pty: any, scrollback: string[], cwd: string, createdAt: number, lastActivity: number, cols: number, rows: number, name: string, color: string}>} */
    this.sessions = new Map();
    this._cleanupInterval = setInterval(() => this._cleanupIdle(), 60 * 60 * 1000);
  }

  /**
   * Create a new PTY session
   */
  create({ cols = 120, rows = 30, cwd = DEFAULT_CWD, name = 'Terminal', color = '#40E0D0' } = {}) {
    const sessionId = randomUUID();
    const safeCwd = resolveSafeCwd(cwd);
    const pty = spawn('/bin/bash', [], {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: safeCwd,
      env: {
        ...process.env,
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
        LANG: 'en_US.UTF-8',
        // Помечаем что это web-console PTY
        WEB_CONSOLE_SESSION: sessionId,
      },
    });

    const session = {
      pty,
      scrollback: [],
      scrollbackSize: 0,
      cwd: safeCwd,
      createdAt: Date.now(),
      lastActivity: Date.now(),
      cols,
      rows,
      name,
      color,
      pid: pty.pid,
    };

    // Collect scrollback as raw chunks — store exactly what PTY sends
    pty.onData((data) => {
      session.lastActivity = Date.now();
      session.scrollback.push(data);
      session.scrollbackSize += data.length;
      // Trim oldest chunks when exceeding char limit
      while (session.scrollbackSize > SCROLLBACK_MAX_CHARS && session.scrollback.length > 0) {
        const removed = session.scrollback.shift();
        session.scrollbackSize -= removed.length;
      }
    });

    pty.onExit(({ exitCode }) => {
      console.log(`[PTY] Session ${sessionId} exited with code ${exitCode}`);
      this.sessions.delete(sessionId);
    });

    this.sessions.set(sessionId, session);
    console.log(`[PTY] Created session ${sessionId} (pid=${pty.pid}, cwd=${safeCwd})`);
    return sessionId;
  }

  /**
   * Get session by ID
   */
  get(sessionId) {
    return this.sessions.get(sessionId) || null;
  }

  /**
   * Mark a session as active without writing to the PTY.
   */
  touch(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    session.lastActivity = Date.now();
    return true;
  }

  /**
   * Write to PTY stdin
   */
  write(sessionId, data) {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    if (typeof data !== 'string') return false;
    session.pty.write(data);
    session.lastActivity = Date.now();
    return true;
  }

  /**
   * Resize PTY
   */
  resize(sessionId, cols, rows) {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    if (!Number.isFinite(cols) || !Number.isFinite(rows)) return false;
    if (cols < 2 || rows < 1 || cols > 1000 || rows > 500) return false;
    cols = Math.floor(cols);
    rows = Math.floor(rows);
    session.pty.resize(cols, rows);
    session.cols = cols;
    session.rows = rows;
    session.lastActivity = Date.now();
    return true;
  }

  /**
   * Get scrollback buffer for reconnect
   */
  getScrollback(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    return session.scrollback.join('');
  }

  /**
   * Kill a session
   */
  kill(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    session.pty.kill();
    this.sessions.delete(sessionId);
    console.log(`[PTY] Killed session ${sessionId}`);
    return true;
  }

  /**
   * Update session metadata
   */
  update(sessionId, { name, color }) {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    if (name !== undefined) session.name = name;
    if (color !== undefined) session.color = color;
    session.lastActivity = Date.now();
    return true;
  }

  /**
   * List all active sessions
   */
  list() {
    const result = [];
    for (const [id, s] of this.sessions) {
      result.push({
        id,
        name: s.name,
        color: s.color,
        cwd: s.cwd,
        pid: s.pid,
        cols: s.cols,
        rows: s.rows,
        createdAt: s.createdAt,
        lastActivity: s.lastActivity,
        scrollbackChunks: s.scrollback.length,
        scrollbackBytes: s.scrollbackSize,
      });
    }
    return result;
  }

  /**
   * Get memory usage stats
   */
  stats() {
    const mem = process.memoryUsage();
    return {
      sessions: this.sessions.size,
      heapUsedMB: Math.round(mem.heapUsed / 1024 / 1024),
      rssMB: Math.round(mem.rss / 1024 / 1024),
      idleTimeoutHours: IDLE_TIMEOUT_HOURS,
    };
  }

  /**
   * Get live metadata for active sessions without writing to their PTYs.
   */
  async metadata() {
    const rows = await processRows();
    const entries = [];
    for (const [id, session] of this.sessions) {
      const active = activeProcessForSession(rows, session.pid);
      const cwd = readProcessCwd(active.pid, readProcessCwd(session.pid, session.cwd));
      entries.push({
        id,
        sessionId: id,
        pid: session.pid,
        activePid: active.pid,
        activeCommand: active.comm,
        activeArgs: active.args,
        cwd,
        git: await gitMetadata(cwd),
        updatedAt: Date.now(),
      });
    }
    return entries;
  }

  /**
   * Cleanup idle sessions (>24h no activity)
   */
  _cleanupIdle() {
    const now = Date.now();
    for (const [id, session] of this.sessions) {
      if (now - session.lastActivity > IDLE_TIMEOUT_MS) {
        console.log(`[PTY] Cleaning up idle session ${id} (inactive ${Math.round((now - session.lastActivity) / 3600000)}h)`);
        session.pty.kill();
        this.sessions.delete(id);
      }
    }
  }

  /**
   * Graceful shutdown
   */
  destroy() {
    clearInterval(this._cleanupInterval);
    for (const session of this.sessions.values()) {
      session.pty.kill();
    }
    this.sessions.clear();
    console.log('[PTY] All sessions destroyed');
  }
}

// Singleton
export const ptyManager = new PtyManager();
export default ptyManager;
