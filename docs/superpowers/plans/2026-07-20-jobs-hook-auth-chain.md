# Jobs-hook Auth Chain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single static admin token in the jobs-hook with per-client scoped tokens (TTL + append-only audit-log) and add a token-gated health endpoint. The vitest harness already exists in main (`vitest.config.ts`, `pnpm test`, `src/lib/admin-auth.test.ts`).

**Architecture:** Admin API routes under `src/app/api/admin/*` are gated by `src/lib/admin-auth.ts`. Today `verifyAdminRequest` compares one bearer token (`WEB_CONSOLE_ADMIN_TOKEN`) in constant time, with an `ADMIN_ALLOW_REMOTE` escape from the localhost-only posture. Generalize to a token registry (multiple clients, each with its own secret + optional expiry), record an append-only audit-log, and expose host health for the client registry.

**Tech Stack:** TypeScript, Next.js App Router (Next 16, `await params`), Node 22, vitest (already set up), pnpm.

## Global Constraints

- Do NOT weaken existing behavior: the single-token path (`WEB_CONSOLE_ADMIN_TOKEN`) and `ADMIN_ALLOW_REMOTE` must keep working when no token registry is configured. New behavior is additive, opt-in via env (`ADMIN_TOKENS`).
- Constant-time comparison for every token check (`node:crypto` `timingSafeEqual`). Never log a token value — audit records a client *label* + a masked SHA-256 fingerprint (`first4…last4`), never the secret.
- All new files are TypeScript under `src/lib/` or `src/app/api/admin/`; tests are colocated `*.test.ts` run by vitest.
- Do not touch generated files, `node_modules`, or the engine launch specs in `src/lib/jobs.ts` ENGINES map.
- **In tests, generate token values with `randomUUID()` (`node:crypto`) — NEVER hardcode an opaque token/secret string literal.** The push-time secret-leak gate fails closed on any `token = "<opaque literal>"` / `secret = "<opaque literal>"` and will block the PR. A `randomUUID()` call is a code expression, not a literal, so it passes. (This is why the existing `admin-auth.test.ts` uses `const adminToken = randomUUID()`.)
- Every task ends green: `pnpm test` (vitest) passes and `pnpm build` (typecheck) succeeds.

---

### Task 1: token registry — per-client scoped tokens with masked fingerprints

**Files:**
- Create: `src/lib/admin-tokens.ts`
- Create: `src/lib/admin-tokens.test.ts`

**Interfaces:**
- Produces:
  - `interface AdminClient { name: string; token: string; expiresAt?: number }` (expiresAt = epoch ms; absent = no expiry)
  - `loadAdminClients(env?: NodeJS.ProcessEnv): AdminClient[]` — parses `ADMIN_TOKENS` (JSON array of `{name, token, expiresAt?}`); falls back to a single `{name: 'default', token: WEB_CONSOLE_ADMIN_TOKEN || JWT_SECRET}` when `ADMIN_TOKENS` is unset/empty/malformed.
  - `matchClient(provided: string, clients: AdminClient[], nowMs: number): AdminClient | null` — constant-time compare against every client's token (no early return); returns the matching client if its token matches AND (`expiresAt` absent OR `expiresAt > nowMs`); else null.
  - `tokenFingerprint(token: string): string` — `sha256(token)` hex, masked as `first4…last4`.

- [ ] **Step 1: Write failing tests**

```ts
import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { loadAdminClients, matchClient, tokenFingerprint } from '@/lib/admin-tokens';

// Generated, never hardcoded — the push secret-leak gate blocks opaque token literals.
const tokDefault = randomUUID();
const tokA = randomUUID();
const tokB = randomUUID();

describe('admin-tokens', () => {
  it('falls back to single default token from WEB_CONSOLE_ADMIN_TOKEN', () => {
    const clients = loadAdminClients({ WEB_CONSOLE_ADMIN_TOKEN: tokDefault } as NodeJS.ProcessEnv);
    expect(clients).toEqual([{ name: 'default', token: tokDefault }]);
  });

  it('parses ADMIN_TOKENS json array', () => {
    const env = { ADMIN_TOKENS: JSON.stringify([{ name: 'seat-a', token: tokA }, { name: 'seat-b', token: tokB, expiresAt: 111 }]) } as NodeJS.ProcessEnv;
    const clients = loadAdminClients(env);
    expect(clients.map((c) => c.name)).toEqual(['seat-a', 'seat-b']);
  });

  it('matchClient returns the client on exact token, respecting expiry', () => {
    const clients = [{ name: 'seat-a', token: tokA }, { name: 'seat-b', token: tokB, expiresAt: 100 }];
    expect(matchClient(tokA, clients, 50)?.name).toBe('seat-a');
    expect(matchClient(tokB, clients, 50)?.name).toBe('seat-b');
    expect(matchClient(tokB, clients, 150)).toBeNull();
    expect(matchClient(randomUUID(), clients, 50)).toBeNull();
  });

  it('tokenFingerprint masks the middle and never returns the raw token', () => {
    const fp = tokenFingerprint(tokA);
    expect(fp).toMatch(/^[0-9a-f]{4}…[0-9a-f]{4}$/);
    expect(fp).not.toContain(tokA);
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

### Task 2: wire the registry + append-only audit-log into verifyAdminRequest

**Files:**
- Create: `src/lib/admin-audit.ts`
- Create: `src/lib/admin-audit.test.ts`
- Modify: `src/lib/admin-auth.ts`
- Modify: `src/lib/admin-auth.test.ts`

**Interfaces:**
- Consumes: `loadAdminClients`, `matchClient`, `tokenFingerprint` from Task 1.
- Produces:
  - `interface AuditEntry { at: number; client: string | null; fingerprint: string; method: string; route: string; outcome: 'ok' | 'denied' }`
  - `appendAudit(entry: AuditEntry, opts?: { path?: string }): void` in `admin-audit.ts` — writes one JSON line to `ADMIN_AUDIT_LOG` (default `${JOBS_ROOT}/admin-audit.log`); best-effort, never throws (wrap fs in try/catch).
  - Updated `verifyAdminRequest` that authorizes against the client registry (still honoring the single-token fallback + `ADMIN_ALLOW_REMOTE` + the 16-char floor under remote) and records an audit entry for every admin call. Signature unchanged: `(req: NextRequest) => NextResponse | null`.

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
  return process.env.ADMIN_AUDIT_LOG || path.join(process.env.JOBS_ROOT || '/workspace/.agent-jobs', 'admin-audit.log');
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

Keep `isLoopback` and the `ADMIN_ALLOW_REMOTE`/XFF logic exactly as-is. Replace the single-token block with a registry match, emit an audit entry on both outcomes, and keep the 16-char floor for `ADMIN_ALLOW_REMOTE` (applied to the matched client's token length):

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

Add a describe block: generate two tokens with `randomUUID()` (never hardcode), set `ADMIN_TOKENS` to two clients (one with a past `expiresAt`), assert a request bearing the live client's token authorizes and the expired one → 401; point `ADMIN_AUDIT_LOG` at a temp file in `beforeEach` and assert an `ok`/`denied` line is written. Keep the existing single-token cases green (fallback path). Clean up env in `afterEach`.

- [ ] **Step 7: Run all tests + typecheck**

Run: `pnpm test && pnpm build`
Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add src/lib/admin-auth.ts src/lib/admin-audit.ts src/lib/admin-audit.test.ts src/lib/admin-auth.test.ts
git commit -m "feat(admin-auth): scoped-token registry + append-only audit-log in verifyAdminRequest"
```

---

### Task 3: health endpoint for the client host-registry

**Files:**
- Create: `src/app/api/admin/health/route.ts`
- Create: `src/lib/engine-availability.ts`
- Create: `src/lib/engine-availability.test.ts`

**Interfaces:**
- Consumes: `verifyAdminRequest` (gate).
- Produces:
  - `enginesAvailable(env?: NodeJS.ProcessEnv): string[]` in `engine-availability.ts` — returns the `ENGINES` env split on whitespace, or `[]` when unset.
  - `GET /api/admin/health` → `200 {"status":"ok","engines":[...],"time":<epoch>}`, token-gated by `verifyAdminRequest`.

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
