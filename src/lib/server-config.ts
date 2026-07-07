import path from 'node:path';

export const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT || process.cwd();
export const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(WORKSPACE_ROOT, 'uploads');
