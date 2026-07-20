import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

import { JOBS_ROOT } from '@/lib/jobs';

export interface AuditEntry {
  at: number;
  client: string | null;
  fingerprint: string;
  method: string;
  route: string;
  outcome: 'ok' | 'denied';
}

function auditPath() {
  return process.env.ADMIN_AUDIT_LOG || path.join(JOBS_ROOT, 'admin-audit.log');
}

export function appendAudit(entry: AuditEntry, opts?: { path?: string }): void {
  const targetPath = opts?.path || auditPath();

  try {
    mkdirSync(path.dirname(targetPath), { recursive: true });
    appendFileSync(targetPath, `${JSON.stringify(entry)}\n`, 'utf8');
  } catch {
    // Best-effort logging: admin auth must never fail because the audit write did.
  }
}
