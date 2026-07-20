import { describe, expect, it } from 'vitest';

import { buildJobPrompt } from './jobs';

describe('buildJobPrompt', () => {
  it('pins an explicit {verdict, nonce} schema so every engine writes a consistent result', () => {
    const prompt = buildJobPrompt(
      'fix the failing test',
      '/workspace/.agent-jobs/job-1/result.json',
      'abc123',
    );
    expect(prompt).toContain('fix the failing test');
    expect(prompt).toContain('/workspace/.agent-jobs/job-1/result.json');
    // Both required fields must be named explicitly — engines otherwise improvise the shape
    // (observed live: claude wrote {"status":...} and opencode omitted the verdict entirely).
    expect(prompt).toContain('"verdict"');
    expect(prompt).toContain('"nonce": "abc123"');
    expect(prompt).toContain('Do NOT print the verdict to the terminal');
  });
});
