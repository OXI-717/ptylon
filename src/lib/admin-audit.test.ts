import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { appendAudit } from '@/lib/admin-audit';

describe('appendAudit', () => {
  let tempDir: string;
  let logPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), 'admin-audit-'));
    logPath = path.join(tempDir, 'admin-audit.log');
  });

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('writes one JSON line per entry', () => {
    appendAudit(
      {
        at: 1,
        client: 'seat-a',
        fingerprint: `${randomUUID().slice(0, 4)}…${randomUUID().slice(0, 4)}`,
        method: 'POST',
        route: '/api/admin/jobs',
        outcome: 'ok',
      },
      { path: logPath },
    );
    appendAudit(
      {
        at: 2,
        client: null,
        fingerprint: `${randomUUID().slice(0, 4)}…${randomUUID().slice(0, 4)}`,
        method: 'GET',
        route: '/api/admin/ping',
        outcome: 'denied',
      },
      { path: logPath },
    );

    const lines = readFileSync(logPath, 'utf8').trim().split('\n');

    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0])).toMatchObject({ at: 1, client: 'seat-a', outcome: 'ok' });
    expect(JSON.parse(lines[1])).toMatchObject({ at: 2, client: null, outcome: 'denied' });
  });

  it('does not throw on bad paths', () => {
    const blockedPath = path.join(tempDir, 'blocked');
    writeFileSync(blockedPath, 'not a directory');

    expect(() =>
      appendAudit(
        {
          at: Date.now(),
          client: null,
          fingerprint: 'dead…beef',
          method: 'GET',
          route: '/api/admin/ping',
          outcome: 'denied',
        },
        { path: path.join(blockedPath, 'admin-audit.log') },
      ),
    ).not.toThrow();
  });
});
