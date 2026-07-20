import { describe, expect, it } from 'vitest';

import { enginesAvailable } from '@/lib/engine-availability';

const env = (values: Record<string, string>) => values as unknown as NodeJS.ProcessEnv;

describe('enginesAvailable', () => {
  it('splits ENGINES on whitespace', () => {
    expect(enginesAvailable(env({ ENGINES: 'codex claude opencode' }))).toEqual([
      'codex',
      'claude',
      'opencode',
    ]);
  });

  it('returns an empty list when ENGINES is unset', () => {
    expect(enginesAvailable({} as NodeJS.ProcessEnv)).toEqual([]);
  });
});
