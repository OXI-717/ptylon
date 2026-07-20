import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
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

  it('prepares claude + opencode seats declaratively (onboarding flags, key strip, model pin)', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'ptylon-seat-'));
    const fakeBin = path.join(root, 'bin');
    await mkdir(fakeBin, { recursive: true });
    // fast npm so the backgrounded refresh does not linger while we assert seat files.
    await writeFile(path.join(fakeBin, 'npm'), '#!/usr/bin/env bash\nexit 0\n', { mode: 0o755 });
    // opencode auth key persisted with a stray leading space (the live-deploy "Authentication
    // Failed" bug); seat prep must strip it.
    const ocAuthDir = path.join(root, '.local', 'share', 'opencode');
    await mkdir(ocAuthDir, { recursive: true });
    await writeFile(
      path.join(ocAuthDir, 'auth.json'),
      JSON.stringify({ zai: { type: 'api', key: ' sk-zai-secret' } }),
    );

    await new Promise<void>((resolve, reject) => {
      const child = spawn('bash', [script, 'bash', '-c', 'printf daemon-started'], {
        env: {
          ...process.env,
          ENGINES: 'claude opencode',
          INSTALL_ENGINES: '1',
          HOME: root,
          WORKSPACE_ROOT: '/workspace',
          OPENCODE_MODEL: 'zai/glm-5.2',
          OPENCODE_BASE_URL: 'https://api.z.ai/api/coding/paas/v4',
          NPM_CONFIG_PREFIX: path.join(root, 'npm-global'),
          PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
        },
      });
      child.on('exit', () => resolve());
      child.on('error', reject);
    });

    // claude: the top-level onboarding gate must be set so the TUI skips the login/theme wizard.
    const claudeJson = JSON.parse(await readFile(path.join(root, '.claude.json'), 'utf8'));
    expect(claudeJson.hasCompletedOnboarding).toBe(true);
    expect(claudeJson.bypassPermissionsModeAccepted).toBe(true);
    expect(claudeJson.fullscreenUpsellSeenCount).toBeGreaterThanOrEqual(1);
    expect(claudeJson.projects['/workspace'].hasTrustDialogAccepted).toBe(true);

    // opencode: stray whitespace stripped from the key; model + provider baseURL pinned.
    const ocAuth = JSON.parse(await readFile(path.join(ocAuthDir, 'auth.json'), 'utf8'));
    expect(ocAuth.zai.key).toBe('sk-zai-secret');
    const ocConfig = JSON.parse(
      await readFile(path.join(root, '.config', 'opencode', 'opencode.json'), 'utf8'),
    );
    expect(ocConfig.model).toBe('zai/glm-5.2');
    expect(ocConfig.provider.zai.options.baseURL).toBe('https://api.z.ai/api/coding/paas/v4');
  });
});
