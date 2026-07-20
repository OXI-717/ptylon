import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '..');
const script = path.join(__dirname, 'bootstrap-host.sh');
const composePath = path.join(repoRoot, 'docker-compose.yml');

async function renderCompose(env: Record<string, string> = {}) {
  const composeText = await readFile(composePath, 'utf8');
  return composeText.replace(/\$\{([A-Z0-9_]+):-([^}]+)\}/g, (_match, key: string, fallback: string) => {
    return env[key] ?? fallback;
  });
}

async function runComposeConfig(env: Record<string, string> = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'ptylon-compose-'));
  const envPath = path.join(root, '.env');
  await writeFile(
    envPath,
    [
      'AUTH_PASSWORD=test-password-change-me',
      'JWT_SECRET=test-jwt-secret',
      'WEB_CONSOLE_ADMIN_TOKEN=abcdefghijklmnop',
      ...Object.entries(env).map(([key, value]) => `${key}=${value}`),
      '',
    ].join('\n'),
  );

  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
    const child = spawn('docker', ['compose', '--env-file', envPath, '-f', composePath, 'config'], {
      cwd: repoRoot,
      env: process.env,
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
}

function serviceBlock(composeText: string, service: 'app' | 'ws' | 'pty') {
  const nextService = service === 'app' ? 'ws' : service === 'ws' ? 'pty' : null;
  const start = composeText.indexOf(`  ${service}:\n`);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = nextService ? composeText.indexOf(`\n  ${nextService}:\n`, start + 1) : composeText.indexOf('\nvolumes:', start + 1);
  expect(end).toBeGreaterThan(start);
  return composeText.slice(start, end);
}

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
    expect(envText).toContain('COMPOSE_PROJECT_NAME=autopilot');
    expect(envText).toContain('ADMIN_ALLOW_REMOTE=1');
    expect(envText).toContain('PTYLON_MEM_APP=512m');
    expect(envText).toContain('PTYLON_MEM_WS=256m');
    expect(envText).toContain('PTYLON_MEM_PTY=1g');
    expect(envText).toContain('PTYLON_OOM_ADJ=500');
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

  it('allows bootstrap resource defaults to be overridden by env', async () => {
    const result = await runBootstrap({
      COMPOSE_PROJECT_NAME: 'custom-project',
      PTYLON_MEM_APP: '768m',
      PTYLON_MEM_WS: '384m',
      PTYLON_MEM_PTY: '2g',
      PTYLON_OOM_ADJ: '650',
    });

    expect(result.code, result.stderr).toBe(0);
    const envText = await readFile(path.join(result.installRoot, '.env'), 'utf8');
    expect(envText).toContain('COMPOSE_PROJECT_NAME=custom-project');
    expect(envText).toContain('PTYLON_MEM_APP=768m');
    expect(envText).toContain('PTYLON_MEM_WS=384m');
    expect(envText).toContain('PTYLON_MEM_PTY=2g');
    expect(envText).toContain('PTYLON_OOM_ADJ=650');
  });

  it('fails closed when AUTH_PASSWORD is missing', async () => {
    const result = await runBootstrap({ AUTH_PASSWORD: '' });

    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('AUTH_PASSWORD is required');
  });

  it('wires engine inventory and persistent auth mounts in compose', async () => {
    const composeText = await readFile(composePath, 'utf8');

    expect(serviceBlock(composeText, 'app')).toContain('HOSTNAME: 0.0.0.0');
    expect(serviceBlock(composeText, 'app')).toContain('ADMIN_ALLOW_REMOTE: ${ADMIN_ALLOW_REMOTE:-0}');
    expect(composeText).toMatch(/app:[\s\S]*ENGINES: \${ENGINES:-codex}/);
    expect(composeText).toContain('${PTYLON_OPENCODE_HOME:-/opt/ptylon/seats/opencode-home}:/home/ptylon/.local');
    expect(composeText).toContain('${PTYLON_CLAUDE_JSON:-/opt/ptylon/seats/claude-home/.claude.json}:/home/ptylon/.claude.json');
  });

  it('renders app bind and admin remote mode through docker compose config', async () => {
    const result = await runComposeConfig();

    expect(result.code, result.stderr).toBe(0);
    const appBlock = serviceBlock(result.stdout, 'app');
    expect(appBlock).toContain('HOSTNAME: 0.0.0.0');
    expect(appBlock).toContain('ADMIN_ALLOW_REMOTE: "0"');

    const sharedHost = await runComposeConfig({ ADMIN_ALLOW_REMOTE: '1' });
    expect(sharedHost.code, sharedHost.stderr).toBe(0);
    expect(serviceBlock(sharedHost.stdout, 'app')).toContain('ADMIN_ALLOW_REMOTE: "1"');
  });

  it('renders shared-host compose memory limits, OOM guard, and project name from env', async () => {
    const rendered = await renderCompose({
      COMPOSE_PROJECT_NAME: 'autopilot',
      PTYLON_MEM_APP: '512m',
      PTYLON_MEM_WS: '256m',
      PTYLON_MEM_PTY: '1g',
      PTYLON_OOM_ADJ: '500',
    });

    expect(rendered).toMatch(/^name: autopilot$/m);
    expect(serviceBlock(rendered, 'app')).toMatch(/mem_limit: 512m[\s\S]*oom_score_adj: 500/);
    expect(serviceBlock(rendered, 'ws')).toMatch(/mem_limit: 256m[\s\S]*oom_score_adj: 500/);
    expect(serviceBlock(rendered, 'pty')).toMatch(/mem_limit: 1g[\s\S]*oom_score_adj: 500/);
  });

  it('renders local compose defaults as unlimited memory, neutral OOM score, and ptylon project', async () => {
    const rendered = await renderCompose();

    expect(rendered).toMatch(/^name: ptylon$/m);
    expect(serviceBlock(rendered, 'app')).toMatch(/mem_limit: 0[\s\S]*oom_score_adj: 0/);
    expect(serviceBlock(rendered, 'ws')).toMatch(/mem_limit: 0[\s\S]*oom_score_adj: 0/);
    expect(serviceBlock(rendered, 'pty')).toMatch(/mem_limit: 0[\s\S]*oom_score_adj: 0/);
  });
});
