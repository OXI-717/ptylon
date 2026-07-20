import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { loadAdminClients, matchClient, tokenFingerprint } from '@/lib/admin-tokens';

describe('loadAdminClients', () => {
  it('falls back to the default admin token when ADMIN_TOKENS is unset', () => {
    const fallbackToken = randomUUID();

    const clients = loadAdminClients({
      WEB_CONSOLE_ADMIN_TOKEN: fallbackToken,
      JWT_SECRET: '',
    });

    expect(clients).toEqual([{ name: 'default', token: fallbackToken }]);
  });

  it('returns no clients when no admin token is configured', () => {
    const clients = loadAdminClients({
      WEB_CONSOLE_ADMIN_TOKEN: '',
      JWT_SECRET: '',
    });

    expect(clients).toEqual([]);
  });

  it('parses ADMIN_TOKENS as JSON', () => {
    const token = randomUUID();

    const clients = loadAdminClients({
      ADMIN_TOKENS: JSON.stringify([{ name: 'seat-a', token, expiresAt: 123 }]),
      WEB_CONSOLE_ADMIN_TOKEN: '',
      JWT_SECRET: '',
    });

    expect(clients).toEqual([{ name: 'seat-a', token, expiresAt: 123 }]);
  });

  it('rejects empty client tokens in ADMIN_TOKENS', () => {
    const fallbackToken = randomUUID();

    const clients = loadAdminClients({
      ADMIN_TOKENS: JSON.stringify([{ name: 'seat-a', token: '' }]),
      WEB_CONSOLE_ADMIN_TOKEN: fallbackToken,
      JWT_SECRET: '',
    });

    expect(clients).toEqual([{ name: 'default', token: fallbackToken }]);
  });
});

describe('matchClient', () => {
  it('returns only a non-expired matching client', () => {
    const activeToken = randomUUID();
    const expiredToken = randomUUID();
    const nowMs = Date.now();

    const clients = [
      { name: 'expired', token: expiredToken, expiresAt: nowMs - 1 },
      { name: 'active', token: activeToken, expiresAt: nowMs + 1_000 },
    ];

    expect(matchClient(activeToken, clients, nowMs)).toEqual({
      name: 'active',
      token: activeToken,
      expiresAt: nowMs + 1_000,
    });
    expect(matchClient(expiredToken, clients, nowMs)).toBeNull();
    expect(matchClient(randomUUID(), clients, nowMs)).toBeNull();
  });

  it('rejects empty provided tokens', () => {
    const clients = [{ name: 'active', token: randomUUID() }];

    expect(matchClient('', clients, Date.now())).toBeNull();
  });
});

describe('tokenFingerprint', () => {
  it('masks the sha256 fingerprint to first4…last4', () => {
    const token = randomUUID();
    const fingerprint = tokenFingerprint(token);

    expect(fingerprint).toMatch(/^[0-9a-f]{4}…[0-9a-f]{4}$/);
    expect(fingerprint.length).toBe(9);
  });
});
