import path from 'node:path';

// JOBS_ROOT MUST live under ALLOWED_CWD_ROOT / FILE_ACCESS_ROOT so the daemon can create
// sessions there and the host-local reader can read results (see oxi-remote-agents spec §8).
const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT || '/workspace';
export const JOBS_ROOT = path.resolve(process.env.JOBS_ROOT || `${WORKSPACE_ROOT}/.agent-jobs`);

export function jobResultPath(jobId: string): string {
  return path.join(JOBS_ROOT, jobId, 'result.json');
}

export function sessionRefPath(jobId: string): string {
  return path.join(JOBS_ROOT, jobId, 'session.txt');
}

export function newJobId(): string {
  return `job-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

// Interactive launch command per engine. Kept minimal; a real deployment may template model
// and flags. The engine is started in the session's bash, then the task is injected.
const ENGINE_COMMANDS: Record<string, string> = {
  claude: 'claude --dangerously-skip-permissions',
  // codex asks for approval before writing files; bypass it (codex equivalent of claude's
  // --dangerously-skip-permissions). NOTE: codex's TUI submit/composer differs from claude —
  // the trust/submit injection timing still needs live tuning (not yet verified end-to-end).
  codex: 'codex --dangerously-bypass-approvals-and-sandbox',
};

export function engineLaunchCommand(engine: string): string {
  const cmd = ENGINE_COMMANDS[engine];
  if (!cmd) throw new Error(`unknown engine: ${engine}`);
  return cmd;
}

// Out-of-band result-capture tail — the client oxi-remote-agents reads the verdict from the
// file, never from the PTY. Phrasing validated live on claude (oxi-skills Wave 0 spike).
export function buildJobPrompt(task: string, resultPath: string, nonce: string): string {
  return (
    `${task}\n\nWhen finished, write ONLY the final verdict as JSON to the file ` +
    `${resultPath} (create directories if needed). The JSON MUST contain the field ` +
    `"nonce":"${nonce}". Do NOT print the verdict to the terminal.`
  );
}
