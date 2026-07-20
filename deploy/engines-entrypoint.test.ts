import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

import { describe, expect, it } from 'vitest';

const script = path.join(__dirname, 'engines-entrypoint.sh');

describe('deploy/engines-entrypoint.sh', () => {
  it('starts the daemon command without waiting for engine refresh', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'ptylon-entrypoint-'));
    const fakeBin = path.join(root, 'bin');
    const npmPrefix = path.join(root, 'npm-global');
    await mkdir(fakeBin);
    await mkdir(path.join(npmPrefix, 'bin'), { recursive: true });
    await writeFile(
      path.join(fakeBin, 'npm'),
      '#!/usr/bin/env bash\nsleep 5\nexit 0\n',
      { mode: 0o755 },
    );

    const startedAt = Date.now();
    const result = await new Promise<{ stdout: string; elapsedMs: number }>((resolve, reject) => {
      const child = spawn('bash', [script, 'bash', '-c', 'printf daemon-started'], {
        detached: true,
        env: {
          ...process.env,
          ENGINES: 'codex',
          INSTALL_ENGINES: '1',
          HOME: root,
          NPM_CONFIG_PREFIX: npmPrefix,
          PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
        },
      });
      let stdout = '';
      const timer = setTimeout(() => {
        if (child.pid) {
          try {
            process.kill(-child.pid, 'SIGTERM');
          } catch {
            // Process may have already exited.
          }
        }
        reject(new Error('daemon command did not start before refresh timeout'));
      }, 3000);
      child.stdout.on('data', (chunk) => {
        stdout += chunk;
        if (stdout.includes('daemon-started')) {
          clearTimeout(timer);
          if (child.pid) {
            try {
              process.kill(-child.pid, 'SIGTERM');
            } catch {
              // Process may have already exited.
            }
          }
          resolve({ stdout, elapsedMs: Date.now() - startedAt });
        }
      });
      child.on('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });

    expect(result.stdout).toBe('daemon-started');
    expect(result.elapsedMs).toBeLessThan(3000);
  });
});
