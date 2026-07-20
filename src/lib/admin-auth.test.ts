import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';

import { verifyAdminRequest } from '@/lib/admin-auth';

const adminToken = randomUUID();

function makeRequest(headers: HeadersInit = {}) {
  return new NextRequest('http://localhost/api/admin', { headers });
}

function setAdminEnv({ allowRemote = false }: { allowRemote?: boolean } = {}) {
  process.env.WEB_CONSOLE_ADMIN_TOKEN = adminToken;
  process.env.JWT_SECRET = '';
  if (allowRemote) {
    process.env.ADMIN_ALLOW_REMOTE = '1';
  } else {
    delete process.env.ADMIN_ALLOW_REMOTE;
  }
}

beforeEach(() => {
  setAdminEnv();
});

afterEach(() => {
  delete process.env.ADMIN_ALLOW_REMOTE;
  delete process.env.WEB_CONSOLE_ADMIN_TOKEN;
  delete process.env.JWT_SECRET;
});

describe('verifyAdminRequest', () => {
  it('authorizes a correct bearer token from loopback', () => {
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
  });

  it('rejects a non-loopback x-forwarded-for when ADMIN_ALLOW_REMOTE is off', () => {
    const response = verifyAdminRequest(
      makeRequest({
        authorization: `Bearer ${adminToken}`,
        'x-forwarded-for': '203.0.113.42',
      }),
    );

    expect(response).not.toBeNull();
    expect(response?.status).toBe(403);
  });

  it('allows a non-loopback x-forwarded-for when ADMIN_ALLOW_REMOTE=1', () => {
    setAdminEnv({ allowRemote: true });

    const response = verifyAdminRequest(
      makeRequest({
        authorization: `Bearer ${adminToken}`,
        'x-forwarded-for': '203.0.113.42',
      }),
    );

    expect(response).toBeNull();
  });
});
