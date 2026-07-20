import { createHash, timingSafeEqual } from 'node:crypto';

export interface AdminClient {
  name: string;
  token: string;
  expiresAt?: number;
}

function sha256Buffer(value: string) {
  return createHash('sha256').update(value).digest();
}

function isValidAdminClient(value: unknown): value is AdminClient {
  if (!value || typeof value !== 'object') return false;

  const client = value as Record<string, unknown>;
  if (typeof client.name !== 'string' || typeof client.token !== 'string') return false;
  if (client.expiresAt !== undefined && (typeof client.expiresAt !== 'number' || !Number.isFinite(client.expiresAt))) {
    return false;
  }

  return true;
}

export function loadAdminClients(env: NodeJS.ProcessEnv = process.env): AdminClient[] {
  const fallbackToken = env.WEB_CONSOLE_ADMIN_TOKEN || env.JWT_SECRET || '';
  const raw = env.ADMIN_TOKENS?.trim();

  if (!raw) {
    return [{ name: 'default', token: fallbackToken }];
  }

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0 || !parsed.every(isValidAdminClient)) {
      return [{ name: 'default', token: fallbackToken }];
    }

    return parsed;
  } catch {
    return [{ name: 'default', token: fallbackToken }];
  }
}

export function matchClient(provided: string, clients: AdminClient[], nowMs: number): AdminClient | null {
  const providedHash = sha256Buffer(provided);
  let matched: AdminClient | null = null;

  for (const client of clients) {
    const clientHash = sha256Buffer(client.token);
    const isMatch = timingSafeEqual(providedHash, clientHash);
    const isExpired = client.expiresAt !== undefined && client.expiresAt <= nowMs;

    if (isMatch && !isExpired && matched === null) {
      matched = client;
    }
  }

  return matched;
}

export function tokenFingerprint(token: string): string {
  const hex = createHash('sha256').update(token).digest('hex');
  return `${hex.slice(0, 4)}…${hex.slice(-4)}`;
}
