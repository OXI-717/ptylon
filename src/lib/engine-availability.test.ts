import { describe, expect, it } from 'vitest';

import { enginesAvailable } from '@/lib/engine-availability';

describe('enginesAvailable', () => {
  it('splits ENGINES on whitespace', () => {
    expect(enginesAvailable({ ENGINES: 'codex claude opencode' } as NodeJS.ProcessEnv)).toEqual([
      'codex',
      'claude',
      'opencode',
    ]);
  });

  it('returns an empty list when ENGINES is unset', () => {
    expect(enginesAvailable({} as NodeJS.ProcessEnv)).toEqual([]);
  });
});
