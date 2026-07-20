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
  // "interactive": start the TUI, then inject the task (claude/codex/agy). This is deliberate:
  // an interactive TUI session bills the Claude/Codex SUBSCRIPTION, whereas headless `claude -p`
  // / the Agent SDK bill a separate credit pool — driving a real PTY spends subscription limits.
  // Never switch an interactive engine to a `-p`/print form to dodge a dialog; pre-prepare the
  // seat instead (see acceptSequence + deploy/engines-entrypoint.sh).
  // "headless": run once with the prompt as a command argument (opencode run).
  mode: 'interactive' | 'headless';
  // interactive only: keystrokes to send after startup to clear any first-run dialog BEFORE the
  // task is pasted. Order matters — a blind Enter hits a dialog's default (often "exit"), and a
  // stray key when there is NO dialog goes straight into the prompt. Normally EMPTY: the seat is
  // pre-prepared (folder-trust + skipDangerousModePermissionPrompt) so no dialog appears. This is
  // an escape hatch for an engine/host that cannot be pre-prepared.
  acceptSequence: string[];
}

const ENGINES: Record<string, EngineSpec> = {
  // claude: interactive TUI (subscription billing — NOT `claude -p`, which bills the separate
  // Agent SDK credit pool). --dangerously-skip-permissions would show a "Bypass Permissions mode"
  // accept dialog, but the seat is pre-prepared (deploy/engines-entrypoint.sh writes
  // ~/.claude/settings.json skipDangerousModePermissionPrompt=true + trusts the cwd), so the TUI
  // starts with NO dialog — acceptSequence stays empty (a stray keystroke would go into the prompt).
  claude: {
    launch: 'claude --dangerously-skip-permissions',
    mode: 'interactive',
    acceptSequence: [],
  },
  // codex asks for approval before writing files; bypass it. No startup dialog to clear.
  codex: {
    launch: 'codex --dangerously-bypass-approvals-and-sandbox',
    mode: 'interactive',
    acceptSequence: [],
  },
  // agy is claude-structured (same bypass dialog) — also pre-prepared by the seat entrypoint.
  // Quirk: agy may ignore cwd, so the result path in the prompt is absolute (jobResultPath).
  agy: {
    launch: 'agy --dangerously-skip-permissions',
    mode: 'interactive',
    acceptSequence: [],
  },
  // opencode's interactive TUI gates file writes behind a permission prompt with no CLI bypass;
  // its headless `run` form takes --dangerously-skip-permissions and the prompt as an argument.
  opencode: {
    launch: 'opencode run --dangerously-skip-permissions',
    mode: 'headless',
    acceptSequence: [],
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
