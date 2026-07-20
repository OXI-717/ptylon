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
export interface EngineSpec {
  // shell command that starts the engine in the session cwd
  launch: string;
  // "interactive": start the TUI, then inject the task (claude/codex/agy).
  // "headless": run once with the prompt as a command argument (opencode run).
  mode: 'interactive' | 'headless';
  // interactive only: engine shows a first-run folder-trust dialog to accept with Enter before
  // the task (claude/agy). codex does not — an extra Enter would submit an empty turn.
  needsTrustAccept: boolean;
}

const ENGINES: Record<string, EngineSpec> = {
  // claude runs headless: `claude -p "<prompt>"` executes the task to completion (edits +
  // Bash + writes the verdict file) and exits, with no TUI dialogs. The interactive TUI adds
  // fragile, version-dependent gates — folder-trust AND a "Bypass Permissions mode" accept
  // prompt (default = exit) that --dangerously-skip-permissions triggers — which -p avoids.
  claude: {
    launch: 'claude -p --dangerously-skip-permissions',
    mode: 'headless',
    needsTrustAccept: false,
  },
  // codex asks for approval before writing files; bypass it. No folder-trust dialog.
  codex: {
    launch: 'codex --dangerously-bypass-approvals-and-sandbox',
    mode: 'interactive',
    needsTrustAccept: false,
  },
  // agy is claude-structured (interactive + --dangerously-skip-permissions, folder-trust).
  // Quirk: agy may ignore cwd, so the result path in the prompt is absolute (jobResultPath).
  agy: {
    launch: 'agy --dangerously-skip-permissions',
    mode: 'interactive',
    needsTrustAccept: true,
  },
  // opencode's interactive TUI gates file writes behind a permission prompt with no CLI bypass;
  // its headless `run` form takes --dangerously-skip-permissions and the prompt as an argument.
  opencode: {
    launch: 'opencode run --dangerously-skip-permissions',
    mode: 'headless',
    needsTrustAccept: false,
  },
};

export function engineSpec(engine: string): EngineSpec {
  const spec = ENGINES[engine];
  if (!spec) throw new Error(`unknown engine: ${engine}`);
  return spec;
}

export function promptRefPath(jobId: string): string {
  return path.join(JOBS_ROOT, jobId, 'prompt.txt');
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
