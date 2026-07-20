# Jobs-hook Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden the oxi-remote-agents jobs-hook in the Ptylon fork — replace the single static admin token with per-client scoped tokens (TTL + audit-log), add a health endpoint, deliver a shell safety guard into the seat, and establish a vitest test harness that proves it all.

**Architecture:** The jobs-hook lives in a Next.js (App Router) app. Admin API routes under `src/app/api/admin/*` are gated by `src/lib/admin-auth.ts`. Today `verifyAdminRequest` compares one bearer token (`WEB_CONSOLE_ADMIN_TOKEN`) in constant time, with an `ADMIN_ALLOW_REMOTE` escape from the localhost-only posture. This plan generalizes that to a token *registry* (multiple clients, each with its own secret + optional expiry), records an append-only audit-log of admin calls, exposes host health for the client registry, and ships a minimal shell guard the engine sessions run under. All new logic is unit-tested with vitest.

**Tech Stack:** TypeScript, Next.js App Router (Next 16, route handlers use `await params`), Node 22, vitest (added by Task 1), pnpm.

## Global Constraints

- Do NOT weaken existing behavior by default: the single-token path (`WEB_CONSOLE_ADMIN_TOKEN`) and `ADMIN_ALLOW_REMOTE` must keep working when no token registry is configured. New behavior is additive and opt-in via env.
- Constant-time comparison for every token check (no early-length-leak beyond what exists; keep the timing-safe compare).
- Never log a token value. Audit-log records a token *label* (client name) and a masked fingerprint (first4…last4 of a SHA-256 hex), never the secret.
- All new files are TypeScript under `src/lib/` or `src/app/api/admin/`; tests are colocated `*.test.ts` run by vitest.
- Do not touch generated files, `node_modules`, or the engine launch specs in `src/lib/jobs.ts` ENGINES map (out of scope).
- Every task ends green: `pnpm vitest run` passes and `pnpm build` (typecheck) succeeds.

---

### Task 1: vitest harness + characterization test for current admin-auth

**Files:**
- Modify: `package.json` (add `vitest` devDependency + `"test": "vitest run"` script)
- Create: `vitest.config.ts`
- Create: `src/lib/admin-auth.test.ts`

**Interfaces:**
- Consumes: `verifyAdminRequest(req: NextRequest): NextResponse | null` from `src/lib/admin-auth.ts` (returns `null` when authorized, a `NextResponse` with a status when denied).
- Produces: a working `pnpm test` (vitest) command that later tasks extend.

- [ ] **Step 1: Add vitest to package.json**

Add to `devDependencies`: `"vitest": "^3.2.4"`. Add to `scripts`: `"test": "vitest run"`. Run `pnpm install` to update the lockfile.

- [ ] **Step 2: Create vitest.config.ts**

```ts
import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
});
```

- [ ] **Step 3: Write the failing characterization test**

`src/lib/admin-auth.test.ts` — build a minimal `NextRequest` with headers and assert current behavior:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { verifyAdminRequest } from '@/lib/admin-auth';

function req(headers: Record<string, string>): NextRequest {
  return new NextRequest('http://127.0.0.1/api/admin/ping', { headers });
}

describe('verifyAdminRequest (single-token, current behavior)', () => {
  beforeEach(() => {
    delete process.env.ADMIN_ALLOW_REMOTE;
    process.env.WEB_CONSOLE_ADMIN_TOKEN = 'test-token-1234567890';
  });

  it('authorizes a correct bearer token from loopback (no XFF)', () => {
    expect(verifyAdminRequest(req({ authorization: 'Bearer test-token-1234567890' }))).toBeNull();
  });

  it('rejects a wrong token with 401', () => {
    const res = verifyAdminRequest(req({ authorization: 'Bearer nope' }));
    expect(res?.status).toBe(401);
  });

  it('rejects a non-loopback XFF with 403 when ADMIN_ALLOW_REMOTE is off', () => {
    const res = verifyAdminRequest(req({ authorization: 'Bearer test-token-1234567890', 'x-forwarded-for': '10.0.0.5' }));
    expect(res?.status).toBe(403);
  });

  it('allows a non-loopback XFF when ADMIN_ALLOW_REMOTE=1', () => {
    process.env.ADMIN_ALLOW_REMOTE = '1';
    expect(verifyAdminRequest(req({ authorization: 'Bearer test-token-1234567890', 'x-forwarded-for': '10.0.0.5' }))).toBeNull();
  });
});
```

- [ ] **Step 4: Run tests — expect PASS (characterization of existing behavior)**

Run: `pnpm test`
Expected: 4 passing tests. (If any fail, the test encodes an assumption that does not match `admin-auth.ts` — fix the test to match real behavior, not the code.)

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml vitest.config.ts src/lib/admin-auth.test.ts
git commit -m "test(admin-auth): vitest harness + characterization of single-token auth"
```

---

### Task 2: token registry — per-client scoped tokens with masked fingerprints

**Files:**
- Create: `src/lib/admin-tokens.ts`
- Create: `src/lib/admin-tokens.test.ts`

**Interfaces:**
- Produces:
  - `interface AdminClient { name: string; token: string; expiresAt?: number }` (expiresAt = epoch ms; absent = no expiry)
  - `loadAdminClients(env?: NodeJS.ProcessEnv): AdminClient[]` — parses `ADMIN_TOKENS` (JSON array of `{name, token, expiresAt?}`); falls back to a single `{name: 'default', token: WEB_CONSOLE_ADMIN_TOKEN || JWT_SECRET}` when `ADMIN_TOKENS` is unset/empty.
  - `matchClient(provided: string, clients: AdminClient[], nowMs: number): AdminClient | null` — constant-time compare against every client's token; returns the matching client if its token matches AND (`expiresAt` absent OR `expiresAt > nowMs`); else null.
  - `tokenFingerprint(token: string): string` — `sha256(token)` hex, masked as `first4…last4`.

- [ ] **Step 1: Write failing tests**

```ts
import { describe, it, expect } from 'vitest';
import { loadAdminClients, matchClient, tokenFingerprint } from '@/lib/admin-tokens';

describe('admin-tokens', () => {
  it('falls back to single default token from WEB_CONSOLE_ADMIN_TOKEN', () => {
    const clients = loadAdminClients({ WEB_CONSOLE_ADMIN_TOKEN: 'abc1234567890xyz' } as NodeJS.ProcessEnv);
    expect(clients).toEqual([{ name: 'default', token: 'abc1234567890xyz' }]);
  });

  it('parses ADMIN_TOKENS json array', () => {
    const env = { ADMIN_TOKENS: JSON.stringify([{ name: 'seat-a', token: 'tok-a-1234567890' }, { name: 'seat-b', token: 'tok-b-1234567890', expiresAt: 111 }]) } as NodeJS.ProcessEnv;
    const clients = loadAdminClients(env);
    expect(clients.map((c) => c.name)).toEqual(['seat-a', 'seat-b']);
  });

  it('matchClient returns the client on exact token, respecting expiry', () => {
    const clients = [{ name: 'seat-a', token: 'tok-a-1234567890' }, { name: 'seat-b', token: 'tok-b-1234567890', expiresAt: 100 }];
    expect(matchClient('tok-a-1234567890', clients, 50)?.name).toBe('seat-a');
    expect(matchClient('tok-b-1234567890', clients, 50)?.name).toBe('seat-b'); // not expired at t=50
    expect(matchClient('tok-b-1234567890', clients, 150)).toBeNull();          // expired at t=150
    expect(matchClient('wrong', clients, 50)).toBeNull();
  });

  it('tokenFingerprint masks the middle and never returns the raw token', () => {
    const fp = tokenFingerprint('supersecrettoken');
    expect(fp).toMatch(/^[0-9a-f]{4}…[0-9a-f]{4}$/);
    expect(fp).not.toContain('supersecret');
  });
});
```

- [ ] **Step 2: Run — expect FAIL (module not found)**

Run: `pnpm test src/lib/admin-tokens.test.ts`
Expected: FAIL — cannot find `@/lib/admin-tokens`.

- [ ] **Step 3: Implement `src/lib/admin-tokens.ts`**

```ts
import { createHash, timingSafeEqual } from 'node:crypto';

export interface AdminClient {
  name: string;
  token: string;
  expiresAt?: number; // epoch ms; absent = never expires
}

export function loadAdminClients(env: NodeJS.ProcessEnv = process.env): AdminClient[] {
  const raw = env.ADMIN_TOKENS?.trim();
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        return parsed
          .filter((c): c is AdminClient => !!c && typeof (c as AdminClient).name === 'string' && typeof (c as AdminClient).token === 'string')
          .map((c) => ({ name: c.name, token: c.token, ...(typeof c.expiresAt === 'number' ? { expiresAt: c.expiresAt } : {}) }));
      }
    } catch {
      // fall through to single-token fallback
    }
  }
  const single = env.WEB_CONSOLE_ADMIN_TOKEN || env.JWT_SECRET;
  return single ? [{ name: 'default', token: single }] : [];
}

function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function matchClient(provided: string, clients: AdminClient[], nowMs: number): AdminClient | null {
  let matched: AdminClient | null = null;
  // Scan ALL clients (no early return) to avoid leaking which token matched via timing.
  for (const c of clients) {
    const ok = constantTimeEqual(provided, c.token);
    const live = c.expiresAt === undefined || c.expiresAt > nowMs;
    if (ok && live) matched = c;
  }
  return matched;
}

export function tokenFingerprint(token: string): string {
  const hex = createHash('sha256').update(token).digest('hex');
  return `${hex.slice(0, 4)}…${hex.slice(-4)}`;
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `pnpm test src/lib/admin-tokens.test.ts`
Expected: 4 passing.

- [ ] **Step 5: Commit**

```bash
git add src/lib/admin-tokens.ts src/lib/admin-tokens.test.ts
git commit -m "feat(admin-auth): per-client scoped token registry with TTL + masked fingerprint"
```

---

### Task 3: wire the registry + append-only audit-log into verifyAdminRequest

**Files:**
- Create: `src/lib/admin-audit.ts`
- Create: `src/lib/admin-audit.test.ts`
- Modify: `src/lib/admin-auth.ts`
- Modify: `src/lib/admin-auth.test.ts`

**Interfaces:**
- Consumes: `loadAdminClients`, `matchClient`, `tokenFingerprint` from Task 2.
- Produces:
  - `appendAudit(entry: AuditEntry, opts?: { path?: string }): void` in `admin-audit.ts` where `interface AuditEntry { at: number; client: string | null; fingerprint: string; method: string; route: string; outcome: 'ok' | 'denied' }`. Writes one JSON line to `ADMIN_AUDIT_LOG` (default `${JOBS_ROOT}/admin-audit.log`); best-effort, never throws (catch `OSError`/`PermissionError` equivalent — wrap fs in try/catch).
  - Updated `verifyAdminRequest` that authorizes against the client registry (still honoring the single-token fallback + `ADMIN_ALLOW_REMOTE`) and records an audit entry for every admin call. Signature unchanged: `(req: NextRequest) => NextResponse | null`.

- [ ] **Step 1: Write failing audit test**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { appendAudit } from '@/lib/admin-audit';

describe('appendAudit', () => {
  let logPath: string;
  beforeEach(() => {
    const dir = mkdtempSync(path.join(tmpdir(), 'audit-'));
    logPath = path.join(dir, 'admin-audit.log');
  });

  it('appends one JSON line per entry, never throwing on a bad dir', () => {
    appendAudit({ at: 1, client: 'seat-a', fingerprint: 'aaaa…bbbb', method: 'POST', route: '/api/admin/jobs', outcome: 'ok' }, { path: logPath });
    appendAudit({ at: 2, client: null, fingerprint: 'cccc…dddd', method: 'GET', route: '/api/admin/ping', outcome: 'denied' }, { path: logPath });
    const lines = readFileSync(logPath, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).outcome).toBe('ok');
    expect(JSON.parse(lines[1]).client).toBeNull();
    // never throws on an unwritable path
    expect(() => appendAudit({ at: 3, client: null, fingerprint: 'x', method: 'GET', route: '/x', outcome: 'denied' }, { path: '/proc/nonexistent/x.log' })).not.toThrow();
    rmSync(path.dirname(logPath), { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm test src/lib/admin-audit.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lib/admin-audit.ts`**

```ts
import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

export interface AuditEntry {
  at: number;
  client: string | null;
  fingerprint: string;
  method: string;
  route: string;
  outcome: 'ok' | 'denied';
}

function defaultPath(): string {
  const root = process.env.ADMIN_AUDIT_LOG || path.join(process.env.JOBS_ROOT || '/workspace/.agent-jobs', 'admin-audit.log');
  return root;
}

export function appendAudit(entry: AuditEntry, opts: { path?: string } = {}): void {
  const p = opts.path || defaultPath();
  try {
    mkdirSync(path.dirname(p), { recursive: true });
    appendFileSync(p, `${JSON.stringify(entry)}\n`, 'utf8');
  } catch {
    // audit is best-effort; a failed write must never break the request path
  }
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `pnpm test src/lib/admin-audit.test.ts`
Expected: PASS.

- [ ] **Step 5: Rewrite `src/lib/admin-auth.ts` to use the registry + audit**

Keep `isLoopback` and the `ADMIN_ALLOW_REMOTE`/XFF logic exactly as-is. Replace the single-token block with a registry match, and emit an audit entry on both outcomes. The 16-char floor stays for `ADMIN_ALLOW_REMOTE` (apply it to the matched client's token length). New shape:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { loadAdminClients, matchClient, tokenFingerprint } from '@/lib/admin-tokens';
import { appendAudit } from '@/lib/admin-audit';

function isLoopback(value: string) {
  const host = value.trim().replace(/^::ffff:/, '');
  return host === '127.0.0.1' || host === '::1' || host === 'localhost';
}

export function verifyAdminRequest(req: NextRequest): NextResponse | null {
  const route = req.nextUrl?.pathname || '';
  const method = req.method;
  const allowRemote = process.env.ADMIN_ALLOW_REMOTE === '1' || process.env.ADMIN_ALLOW_REMOTE === 'true';
  const deny = (status: number, error: string, client: string | null, fp: string): NextResponse => {
    appendAudit({ at: Date.now(), client, fingerprint: fp, method, route, outcome: 'denied' });
    return NextResponse.json({ error }, { status });
  };

  if (!allowRemote) {
    const xff = req.headers.get('x-forwarded-for');
    const firstHop = xff?.split(',')[0]?.trim();
    if (firstHop && !isLoopback(firstHop)) return deny(403, 'Admin API is localhost-only', null, '');
  }

  const clients = loadAdminClients();
  if (clients.length === 0) return deny(503, 'Admin token is not configured', null, '');

  const headerToken = req.headers.get('x-web-console-admin-token');
  const bearer = req.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
  const provided = headerToken || bearer || '';
  const client = matchClient(provided, clients, Date.now());
  const fp = provided ? tokenFingerprint(provided) : '';

  if (!client) return deny(401, 'Unauthorized', null, fp);
  if (allowRemote && client.token.length < 16) return deny(503, 'ADMIN_ALLOW_REMOTE requires an admin token of at least 16 chars', client.name, fp);

  appendAudit({ at: Date.now(), client: client.name, fingerprint: fp, method, route, outcome: 'ok' });
  return null;
}
```

- [ ] **Step 6: Extend `src/lib/admin-auth.test.ts` with registry + audit cases**

Add a describe block: with `ADMIN_TOKENS` set to two clients, a request bearing `seat-b`'s token authorizes; an expired client's token → 401; assert an audit line is written (point `ADMIN_AUDIT_LOG` at a temp file in `beforeEach`, read it after). Keep the existing single-token block green (fallback path).

- [ ] **Step 7: Run all tests + typecheck**

Run: `pnpm test && pnpm build`
Expected: all green; `pnpm build` typechecks with no errors.

- [ ] **Step 8: Commit**

```bash
git add src/lib/admin-auth.ts src/lib/admin-audit.ts src/lib/admin-audit.test.ts src/lib/admin-auth.test.ts
git commit -m "feat(admin-auth): scoped-token registry + append-only audit-log in verifyAdminRequest"
```

---

### Task 4: health endpoint for the client host-registry

**Files:**
- Create: `src/app/api/admin/health/route.ts`
- Create: `src/lib/engine-availability.ts`
- Create: `src/lib/engine-availability.test.ts`

**Interfaces:**
- Consumes: `verifyAdminRequest` (gate), `engineSpec`/`ENGINES` are NOT imported (out of scope); instead read a static list.
- Produces:
  - `enginesAvailable(env?: NodeJS.ProcessEnv): string[]` in `engine-availability.ts` — returns the `ENGINES` env split on whitespace (the same list the seat installs), or `[]` when unset.
  - `GET /api/admin/health` → `200 {"status":"ok","engines":[...],"time":<epoch>}`, token-gated by `verifyAdminRequest`. This is what the client host-registry health-check probes.

- [ ] **Step 1: Failing test for enginesAvailable**

```ts
import { describe, it, expect } from 'vitest';
import { enginesAvailable } from '@/lib/engine-availability';

describe('enginesAvailable', () => {
  it('splits ENGINES on whitespace', () => {
    expect(enginesAvailable({ ENGINES: 'codex claude opencode' } as NodeJS.ProcessEnv)).toEqual(['codex', 'claude', 'opencode']);
  });
  it('returns [] when unset', () => {
    expect(enginesAvailable({} as NodeJS.ProcessEnv)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm test src/lib/engine-availability.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lib/engine-availability.ts`**

```ts
export function enginesAvailable(env: NodeJS.ProcessEnv = process.env): string[] {
  return (env.ENGINES || '').split(/\s+/).filter(Boolean);
}
```

- [ ] **Step 4: Implement `src/app/api/admin/health/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminRequest } from '@/lib/admin-auth';
import { enginesAvailable } from '@/lib/engine-availability';

export async function GET(req: NextRequest) {
  const denied = verifyAdminRequest(req);
  if (denied) return denied;
  return NextResponse.json({ status: 'ok', engines: enginesAvailable(), time: Date.now() });
}
```

- [ ] **Step 5: Run tests + typecheck**

Run: `pnpm test && pnpm build`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add src/lib/engine-availability.ts src/lib/engine-availability.test.ts src/app/api/admin/health/route.ts
git commit -m "feat(jobs-hook): token-gated GET /api/admin/health (status + engines)"
```

---

### Task 5: deliver + arm a minimal shell safety guard for engine sessions

**Files:**
- Create: `deploy/seat-guard.sh`
- Modify: `deploy/Dockerfile` (copy the guard into the image)
- Modify: `deploy/engines-entrypoint.sh` (export a guard hook the engines' bash sessions source)
- Create: `deploy/seat-guard.test.sh` (bats-free plain bash assertions)

**Interfaces:**
- Produces: `deploy/seat-guard.sh` — a `bash` function `oxi_guard_check "<command>"` that returns non-zero (blocks) when the command matches a destructive pattern OUTSIDE the workspace: `rm -rf /`, `rm -rf ~`, `rm -rf $HOME`, writes to `/etc`, `mkfs`, `:(){ :|:& };:` fork-bomb. Fail-safe: on any doubt, block. Scoped to the seat (the engines run destructive-but-legit commands inside `/workspace`, which must be allowed).

- [ ] **Step 1: Write the failing guard test**

`deploy/seat-guard.test.sh`:

```bash
#!/usr/bin/env bash
set -uo pipefail
source "$(dirname "$0")/seat-guard.sh"
fail=0
expect_block() { oxi_guard_check "$1" && { echo "FAIL: should block: $1"; fail=1; } || echo "ok block: $1"; }
expect_allow() { oxi_guard_check "$1" || { echo "FAIL: should allow: $1"; fail=1; } ; echo "ok allow: $1"; }
expect_block 'rm -rf /'
expect_block 'rm -rf $HOME'
expect_block 'rm -rf ~'
expect_block ':(){ :|:& };:'
expect_block 'mkfs.ext4 /dev/sda'
expect_allow 'rm -rf /workspace/build'
expect_allow 'python3 -c "print(1+1)"'
expect_allow 'git commit -m x'
exit $fail
```

- [ ] **Step 2: Run — expect FAIL (seat-guard.sh missing)**

Run: `bash deploy/seat-guard.test.sh`
Expected: FAIL — `seat-guard.sh` not found / function undefined.

- [ ] **Step 3: Implement `deploy/seat-guard.sh`**

```bash
#!/usr/bin/env bash
# Minimal fail-safe guard for engine bash sessions in a seat. Blocks a destructive command
# OUTSIDE the workspace; allows legit work inside /workspace. Coarse by design: on doubt, block.
oxi_guard_check() {
  local cmd="$1"
  # fork bomb
  case "$cmd" in *':|:&'*|*':(){'*) return 1 ;; esac
  # filesystem format
  case "$cmd" in *'mkfs'*) return 1 ;; esac
  # rm -rf targeting home/root/etc (allow /workspace/*)
  if printf '%s' "$cmd" | grep -Eq 'rm[[:space:]]+-[a-z]*r[a-z]*f?[[:space:]]+(/|~|\$HOME|/etc)([[:space:]]|$)'; then
    return 1
  fi
  # writes into /etc
  case "$cmd" in *'> /etc/'*|*'>> /etc/'*) return 1 ;; esac
  return 0
}
# When sourced with an argument, run the check (for use as a hook).
if [ "${1:-}" != "" ] && [ "${BASH_SOURCE[0]}" != "${0}" ]; then :; fi
```

- [ ] **Step 4: Run the guard test — expect PASS**

Run: `bash deploy/seat-guard.test.sh`
Expected: all `ok ...` lines, exit 0.

- [ ] **Step 5: Deliver into the image + arm it**

In `deploy/Dockerfile`, after the engines-entrypoint COPY, add:
```dockerfile
COPY --chmod=755 deploy/seat-guard.sh /usr/local/bin/seat-guard.sh
```
In `deploy/engines-entrypoint.sh`, inside `prepare_claude_seat` (or a new `prepare_seat` always run when INSTALL_ENGINES=1), write a bash env file the sessions source, e.g. append to `${HOME}/.bashrc`:
```bash
grep -q 'seat-guard.sh' "${HOME}/.bashrc" 2>/dev/null || echo '[ -f /usr/local/bin/seat-guard.sh ] && source /usr/local/bin/seat-guard.sh' >> "${HOME}/.bashrc"
```
(Arming is best-effort; the guard function becomes available in interactive bash. Enforcement wiring into a DEBUG trap is a follow-up — do NOT add a trap here, it risks breaking the PTY sessions.)

- [ ] **Step 6: Typecheck the app is unaffected**

Run: `pnpm build`
Expected: green (no TS touched).

- [ ] **Step 7: Commit**

```bash
git add deploy/seat-guard.sh deploy/seat-guard.test.sh deploy/Dockerfile deploy/engines-entrypoint.sh
git commit -m "feat(seat): ship + arm a fail-safe shell guard for engine sessions"
```

---

## Out of scope (owner-gated — NOT for autonomous workers)

These remaining roadmap items require real hosts, credentials, or deploys and must be done by the owner, not this plan:
- Multi-host deploy to ≥2 real hosts + cross-host e2e (Wave 3).
- Real secrets provisioning (Coolify-style) instead of staged copies (Wave 3/4).
- OpenMedia seat deploy + seat-auth + repo provisioning + OAuth keepalive daemon on real seats (Wave 4).
- Cockpit: live attach, Ptylon UI/continuity, browser-loop/CDP (Wave 5).
- Export cleanliness (#645) + upstreaming the generic jobs-hook (Wave 6).
