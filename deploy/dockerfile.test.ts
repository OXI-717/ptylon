import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '..');
const dockerfilePath = path.join(repoRoot, 'deploy', 'Dockerfile');

describe('deploy/Dockerfile', () => {
  it('selects the baked opencode baseline package from the build target architecture', async () => {
    const dockerfile = await readFile(dockerfilePath, 'utf8');

    expect(dockerfile).toContain('ARG TARGETARCH');
    expect(dockerfile).toMatch(/amd64\|x86_64\) opencode_package="opencode-linux-x64"/);
    expect(dockerfile).toMatch(/arm64\|aarch64\) opencode_package="opencode-linux-arm64"/);
    expect(dockerfile).toContain('${opencode_package}@latest');
    expect(dockerfile).toContain('$(npm root -g)/${opencode_package}/bin/opencode');
  });

  it('bakes the agy baseline for linux amd64 and arm64 images', async () => {
    const dockerfile = await readFile(dockerfilePath, 'utf8');

    expect(dockerfile).toMatch(/amd64\|x86_64\)[\s\S]*agy_platform="linux_amd64"/);
    expect(dockerfile).toMatch(/arm64\|aarch64\)[\s\S]*agy_platform="linux_arm64"/);
    expect(dockerfile).toContain('https://antigravity-cli-auto-updater-974169037036.us-central1.run.app');
    expect(dockerfile).toContain('/manifests/${agy_platform}.json');
    expect(dockerfile).toContain('sha512sum -c -');
    expect(dockerfile).toContain('install -d -o ptylon -g ptylon /home/ptylon/.npm-global /home/ptylon/.npm-global/bin');
    expect(dockerfile).toContain('*.tar.gz*) tar -xzf /tmp/agy-payload -C /tmp antigravity');
    expect(dockerfile).toContain('install -m 0755 -o ptylon -g ptylon /tmp/antigravity /home/ptylon/.npm-global/bin/agy');
    expect(dockerfile).not.toContain('/home/ptylon/.local/bin/agy');
    expect(dockerfile).not.toContain('ln -sf /home/ptylon/.local/bin/agy');
  });

  it('bakes the test-gate toolchain a job needs to verify its own work', async () => {
    const dockerfile = await readFile(dockerfilePath, 'utf8');
    // Strip comments: a package name mentioned in prose must not satisfy this check.
    const instructions = dockerfile
      .split('\n')
      .filter((line) => !line.trim().startsWith('#'))
      .join('\n');

    // A repo's `make test` runs its Python suite and then `bats`. Without bats the gate
    // exits 127 and the job reports a red verify that says nothing about the code.
    expect(instructions).toMatch(/apt-get install[\s\S]*\bbats\b/);
  });

  it('installs uv outside ~/.local, which the opencode seat mount would hide', async () => {
    const dockerfile = await readFile(dockerfilePath, 'utf8');

    // Same constraint that puts agy in npm-global/bin: pty mounts a seat over ~/.local.
    expect(dockerfile).toContain('UV_UNMANAGED_INSTALL=/usr/local/bin');
    expect(dockerfile).toContain('https://astral.sh/uv/install.sh');
    // The setting must reach the shell that RUNS the script, not the curl that fetches it:
    // `VAR=x curl … | sh` puts VAR in curl's environment and the installer falls back to
    // its default target, which is exactly how the first build failed (uv: not found).
    expect(dockerfile).toMatch(/export UV_UNMANAGED_INSTALL=\/usr\/local\/bin/);
    expect(dockerfile).not.toMatch(/UV_INSTALL_DIR=\/home\/ptylon\/\.local/);
    expect(dockerfile).not.toMatch(/UV_UNMANAGED_INSTALL=\/home\/ptylon\/\.local/);
    // The installer treats UV_UNMANAGED_INSTALL as a directory, not a boolean.
    expect(dockerfile).not.toMatch(/UV_UNMANAGED_INSTALL=(1|true)\b/);
  });
});
