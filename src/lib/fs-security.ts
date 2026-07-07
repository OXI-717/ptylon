import path from 'node:path';

// Full server access — single-user tool behind nginx basic_auth + JWT
// Deny-list protects critical system paths from accidental damage
const DENIED_PATHS = [
  '/proc', '/sys', '/dev', '/boot',
  '/root/.ssh', '/root/.gnupg', '/root/.claude.json',
  '/etc/shadow', '/etc/gshadow',
];

export function resolveSafePath(inputPath: string): string {
  if (!inputPath) throw new Error('Path is required');
  const resolved = path.resolve(inputPath);
  if (resolved.includes('\0')) throw new Error('Invalid path');
  for (const denied of DENIED_PATHS) {
    if (resolved === denied || resolved.startsWith(`${denied}/`)) {
      throw new Error(`Access denied: ${denied} is protected`);
    }
  }
  return resolved;
}
