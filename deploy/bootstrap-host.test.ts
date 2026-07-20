import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '..');
const script = path.join(__dirname, 'bootstrap-host.sh');
const composePath = path.join(repoRoot, 'docker-compose.yml');

async function runBootstrap(extraEnv: Record<string, string> = {}, args: string[] = ['--render-only']) {
  const root = await mkdtemp(path.join(tmpdir(), 'ptylon-bootstrap-'));
  const installRoot = path.join(root, 'install');
  const systemdDir = path.join(root, 'systemd');

  const result = await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
    const child = spawn('bash', [script, ...args], {
      cwd: repoRoot,
      env: {
        ...process.env,
        AUTH_PASSWORD: 'test-password-change-me',
        PTYLON_INSTALL_ROOT: installRoot,
        PTYLON_SYSTEMD_DIR: systemdDir,
        PTYLON_REPO_DIR: repoRoot,
        ...extraEnv,
      },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });

  return { ...result, root, installRoot, systemdDir };
}

describe('deploy/bootstrap-host.sh', () => {
  it('renders .env, admin token, seat homes, and systemd unit without external services', async () => {
    const result = await runBootstrap();

    expect(result.code, result.stderr).toBe(0);

    const envPath = path.join(result.installRoot, '.env');
    const tokenPath = path.join(result.installRoot, 'admin-token');
    const unitPath = path.join(result.systemdDir, 'ptylon.service');
    const envText = await readFile(envPath, 'utf8');
    const token = (await readFile(tokenPath, 'utf8')).trim();
    const unitText = await readFile(unitPath, 'utf8');

    expect(envText).toContain('ENGINES="codex claude opencode agy"');
    expect(envText).toContain(`WEB_CONSOLE_ADMIN_TOKEN=${token}`);
    expect(envText).toContain('PTYLON_APP_PORT=8790');
    expect(envText).toContain('PTYLON_WS_PORT=8791');
    expect(envText).toContain(`PTYLON_CODEX_HOME=${result.installRoot}/seats/codex-home`);
    expect(envText).toContain(`PTYLON_AGY_HOME=${result.installRoot}/seats/agy-home`);
    expect(envText).toContain(`PTYLON_CLAUDE_JSON=${result.installRoot}/seats/claude-home/.claude.json`);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43,}$/);
    expect((await stat(envPath)).mode & 0o777).toBe(0o600);
    expect((await stat(tokenPath)).mode & 0o777).toBe(0o600);
    expect((await stat(path.join(result.installRoot, 'seats', 'codex-home'))).isDirectory()).toBe(true);
    expect((await stat(path.join(result.installRoot, 'seats', 'claude-home'))).isDirectory()).toBe(true);
    expect((await stat(path.join(result.installRoot, 'seats', 'opencode-home'))).isDirectory()).toBe(true);
    expect((await stat(path.join(result.installRoot, 'seats', 'agy-home'))).isDirectory()).toBe(true);
    expect((await stat(path.join(result.installRoot, 'seats', 'claude-home', '.claude.json'))).isFile()).toBe(true);
    expect(unitText).toContain(`WorkingDirectory=${repoRoot}`);
    expect(unitText).toContain(`docker compose --env-file ${envPath} -f ${path.join(repoRoot, 'docker-compose.yml')} up -d`);
    expect(unitText).toContain('Restart=on-failure');
  });

  it('is idempotent and keeps the admin token unless explicitly rotated', async () => {
    const first = await runBootstrap();
    expect(first.code, first.stderr).toBe(0);
    const tokenPath = path.join(first.installRoot, 'admin-token');
    const originalToken = (await readFile(tokenPath, 'utf8')).trim();

    const second = await runBootstrap(
      {
        AUTH_PASSWORD: 'test-password-change-me',
        PTYLON_INSTALL_ROOT: first.installRoot,
        PTYLON_SYSTEMD_DIR: first.systemdDir,
        PTYLON_REPO_DIR: repoRoot,
      },
      ['--render-only'],
    );
    expect(second.code, second.stderr).toBe(0);
    expect((await readFile(tokenPath, 'utf8')).trim()).toBe(originalToken);

    const rotated = await runBootstrap(
      {
        AUTH_PASSWORD: 'test-password-change-me',
        PTYLON_INSTALL_ROOT: first.installRoot,
        PTYLON_SYSTEMD_DIR: first.systemdDir,
        PTYLON_REPO_DIR: repoRoot,
      },
      ['--render-only', '--rotate-token'],
    );
    expect(rotated.code, rotated.stderr).toBe(0);
    expect((await readFile(tokenPath, 'utf8')).trim()).not.toBe(originalToken);
  });

  it('preserves quoted AUTH_PASSWORD values across idempotent runs', async () => {
    const authPassword = 'pass"with\\slashes';
    const first = await runBootstrap({ AUTH_PASSWORD: authPassword });
    expect(first.code, first.stderr).toBe(0);
    const envPath = path.join(first.installRoot, '.env');
    const firstEnv = await readFile(envPath, 'utf8');
    expect(firstEnv).toContain('AUTH_PASSWORD="pass\\"with\\\\slashes"');

    const second = await runBootstrap(
      {
        AUTH_PASSWORD: '',
        PTYLON_INSTALL_ROOT: first.installRoot,
        PTYLON_SYSTEMD_DIR: first.systemdDir,
        PTYLON_REPO_DIR: repoRoot,
      },
      ['--render-only'],
    );

    expect(second.code, second.stderr).toBe(0);
    expect(await readFile(envPath, 'utf8')).toContain('AUTH_PASSWORD="pass\\"with\\\\slashes"');
  });

  it('fails closed when AUTH_PASSWORD is missing', async () => {
    const result = await runBootstrap({ AUTH_PASSWORD: '' });

    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('AUTH_PASSWORD is required');
  });

  it('wires engine inventory and persistent auth mounts in compose', async () => {
    const composeText = await readFile(composePath, 'utf8');

    expect(composeText).toMatch(/app:[\s\S]*ENGINES: \${ENGINES:-codex}/);
    expect(composeText).toContain('${PTYLON_OPENCODE_HOME:-/opt/ptylon/seats/opencode-home}:/home/ptylon/.local');
    expect(composeText).toContain('${PTYLON_CLAUDE_JSON:-/opt/ptylon/seats/claude-home/.claude.json}:/home/ptylon/.claude.json');
  });
});
