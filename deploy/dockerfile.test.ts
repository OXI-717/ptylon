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
});
