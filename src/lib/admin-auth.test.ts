import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';

import { verifyAdminRequest } from '@/lib/admin-auth';

function makeRequest(headers: HeadersInit = {}) {
  return new NextRequest('http://localhost/api/admin', { headers });
}

let tempDir: string;
let auditLogPath: string;

function setLegacyAdminEnv({ allowRemote = false }: { allowRemote?: boolean } = {}) {
  process.env.WEB_CONSOLE_ADMIN_TOKEN = randomUUID();
  process.env.JWT_SECRET = '';
  delete process.env.ADMIN_TOKENS;
  if (allowRemote) {
    process.env.ADMIN_ALLOW_REMOTE = '1';
  } else {
    delete process.env.ADMIN_ALLOW_REMOTE;
  }
}

beforeEach(() => {
  tempDir = mkdtempSync(path.join(tmpdir(), 'admin-auth-'));
  auditLogPath = path.join(tempDir, 'admin-audit.log');
  process.env.ADMIN_AUDIT_LOG = auditLogPath;
  setLegacyAdminEnv();
});

afterEach(() => {
  delete process.env.ADMIN_ALLOW_REMOTE;
  delete process.env.WEB_CONSOLE_ADMIN_TOKEN;
  delete process.env.JWT_SECRET;
  delete process.env.ADMIN_TOKENS;
  delete process.env.ADMIN_AUDIT_LOG;
  rmSync(tempDir, { recursive: true, force: true });
});

describe('verifyAdminRequest', () => {
  it('authorizes a correct bearer token from loopback', () => {
    const adminToken = process.env.WEB_CONSOLE_ADMIN_TOKEN as string;

    const response = verifyAdminRequest(
      makeRequest({
        authorization: `Bearer ${adminToken}`,
      }),
    );

    expect(response).toBeNull();
  });

  it('rejects a wrong token with 401', () => {
    const response = verifyAdminRequest(
      makeRequest({
        authorization: 'Bearer not-the-token',
      }),
    );

    expect(response).not.toBeNull();
    expect(response?.status).toBe(401);
    expect(JSON.parse(readFileSync(auditLogPath, 'utf8').trim())).toMatchObject({ outcome: 'denied' });
  });

  it('rejects a non-loopback x-forwarded-for when ADMIN_ALLOW_REMOTE is off', () => {
    const response = verifyAdminRequest(
      makeRequest({
        authorization: `Bearer ${process.env.WEB_CONSOLE_ADMIN_TOKEN as string}`,
        'x-forwarded-for': '203.0.113.42',
      }),
    );

    expect(response).not.toBeNull();
    expect(response?.status).toBe(403);
    expect(JSON.parse(readFileSync(auditLogPath, 'utf8').trim())).toMatchObject({ outcome: 'denied' });
  });

  it('allows a non-loopback x-forwarded-for when ADMIN_ALLOW_REMOTE=1', () => {
    setLegacyAdminEnv({ allowRemote: true });

    const response = verifyAdminRequest(
      makeRequest({
        authorization: `Bearer ${process.env.WEB_CONSOLE_ADMIN_TOKEN as string}`,
        'x-forwarded-for': '203.0.113.42',
      }),
    );

    expect(response).toBeNull();
    expect(JSON.parse(readFileSync(auditLogPath, 'utf8').trim())).toMatchObject({ outcome: 'ok' });
  });

  it('authorizes a live registry token and denies an expired one', () => {
    const liveToken = randomUUID();
    const expiredToken = randomUUID();
    process.env.ADMIN_TOKENS = JSON.stringify([
      { name: 'live-seat', token: liveToken, expiresAt: Date.now() + 10_000 },
      { name: 'expired-seat', token: expiredToken, expiresAt: Date.now() - 10_000 },
    ]);
    delete process.env.WEB_CONSOLE_ADMIN_TOKEN;

    const okResponse = verifyAdminRequest(
      makeRequest({
        authorization: `Bearer ${liveToken}`,
      }),
    );

    const deniedResponse = verifyAdminRequest(
      makeRequest({
        authorization: `Bearer ${expiredToken}`,
      }),
    );

    expect(okResponse).toBeNull();
    expect(deniedResponse).not.toBeNull();
    expect(deniedResponse?.status).toBe(401);

    const lines = readFileSync(auditLogPath, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0])).toMatchObject({ client: 'live-seat', outcome: 'ok' });
    expect(JSON.parse(lines[1])).toMatchObject({ client: null, outcome: 'denied' });
  });

  it('rejects a live registry token shorter than 16 chars when ADMIN_ALLOW_REMOTE is enabled', () => {
    setLegacyAdminEnv({ allowRemote: true });

    const shortToken = randomUUID().replace(/-/g, '').slice(0, 12);
    process.env.ADMIN_TOKENS = JSON.stringify([{ name: 'short-seat', token: shortToken }]);
    delete process.env.WEB_CONSOLE_ADMIN_TOKEN;

    const response = verifyAdminRequest(
      makeRequest({
        authorization: `Bearer ${shortToken}`,
        'x-forwarded-for': '203.0.113.42',
      }),
    );

    expect(response).not.toBeNull();
    expect(response?.status).toBe(503);
    expect(JSON.parse(readFileSync(auditLogPath, 'utf8').trim())).toMatchObject({
      client: 'short-seat',
      outcome: 'denied',
    });
  });
});
