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
    expect(dockerfile).toContain('*.tar.gz*) tar -xzf /tmp/agy-payload -C /tmp antigravity');
    expect(dockerfile).toContain('/home/ptylon/.local/bin/agy');
    expect(dockerfile).toContain('/home/ptylon/.npm-global/bin/agy');
  });
});
