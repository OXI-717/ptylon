import path from 'node:path';
import { WORKSPACE_ROOT } from '@/lib/server-config';

// Full server access — single-user tool behind nginx basic_auth + JWT
// Deny-list protects critical system paths from accidental damage
const DENIED_PATHS = [
  '/proc', '/sys', '/dev', '/boot',
  '/root/.ssh', '/root/.gnupg', '/root/.claude.json',
  '/etc/shadow', '/etc/gshadow',
];

const FILE_ACCESS_ROOT = path.resolve(process.env.FILE_ACCESS_ROOT || WORKSPACE_ROOT);
const ALLOW_FULL_FILESYSTEM = process.env.ALLOW_FULL_FILESYSTEM === 'true';

export function resolveSafePath(inputPath: string): string {
  if (!inputPath) throw new Error('Path is required');
  const resolved = path.resolve(inputPath);
  if (resolved.includes('\0')) throw new Error('Invalid path');
  if (!ALLOW_FULL_FILESYSTEM && resolved !== FILE_ACCESS_ROOT && !resolved.startsWith(`${FILE_ACCESS_ROOT}/`)) {
    throw new Error(`Access denied: path is outside FILE_ACCESS_ROOT (${FILE_ACCESS_ROOT})`);
  }
  for (const denied of DENIED_PATHS) {
    if (resolved === denied || resolved.startsWith(`${denied}/`)) {
      throw new Error(`Access denied: ${denied} is protected`);
    }
  }
  return resolved;
}
