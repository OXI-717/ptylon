#!/usr/bin/env bash
# Boot-time engine provisioning for the oxi-remote-agents jobs-hook.
#
# Mirrors the OpenMedia seat-entrypoint pattern: install/refresh the coding-agent
# CLIs to @latest on every container boot into a writable npm prefix, so a pinned
# image version never goes stale and the CLI stays self-updateable at runtime.
#
# Opt-in per service: only the `pty` service needs engine refresh. Refresh runs in the
# background so the daemon can start from the baked baseline and satisfy healthchecks.
#
# Non-fatal: a failed refresh (network flap) logs a warning and falls back to the
# baseline version baked into the image, so the container still boots and serves.
set -uo pipefail

log() { printf '[engines-entrypoint] %s\n' "$*" >&2; }

# opencode's npm wrapper (opencode-ai) fails to fetch its platform binary on some setups
# ("failed to install the right opencode CLI package" — an optionalDependencies bug), so we
# install the platform package directly and symlink `opencode` at its real binary. Keeps the
# per-boot @latest auto-update property through a channel that actually works.
refresh_opencode() {
    local plat bin
    case "$(uname -s)-$(uname -m)" in
        Linux-aarch64|Linux-arm64) plat="opencode-linux-arm64" ;;
        Linux-x86_64)              plat="opencode-linux-x64" ;;
        Darwin-arm64)              plat="opencode-darwin-arm64" ;;
        Darwin-x86_64)             plat="opencode-darwin-x64" ;;
        *) log "WARN: no opencode platform package for $(uname -s)-$(uname -m)"; return 0 ;;
    esac
    log "refreshing opencode (${plat}@latest)"
    if npm install -g --no-fund --no-audit "${plat}@latest" >&2; then
        bin="$(npm root -g)/${plat}/bin/opencode"
        if [ -x "${bin}" ]; then
            ln -sf "${bin}" "${NPM_CONFIG_PREFIX:-/usr/local}/bin/opencode"
            log "opencode linked → ${bin}"
        else
            log "WARN: opencode binary not found at ${bin}; keeping baked baseline"
        fi
    else
        log "WARN: opencode refresh failed (network?); keeping baked baseline"
    fi
}

# agy (Antigravity CLI) is a single Go binary, not an npm package: install via the official
# bootstrapper, which resolves platform (linux_arm64 etc.), verifies the checksum, and drops the
# binary into ~/.local/bin/agy. Auth is the mounted ~/.gemini/antigravity-cli/antigravity-oauth-token
# (file-based token is sufficient — no system keyring in the container).
refresh_agy() {
    log "refreshing agy (antigravity.google installer)"
    local bin="${HOME:-/home/ptylon}/.local/bin/agy"
    if curl -fsSL --max-time 120 https://antigravity.google/cli/install.sh | bash >&2; then
        log "agy refreshed to $("${bin}" --version 2>/dev/null | head -1 || echo '?')"
    else
        log "WARN: agy refresh failed (network?); keeping existing binary if any"
    fi
    # ~/.local/bin is not on the image PATH; expose agy through the npm prefix bin
    # (same trick as the opencode symlink) so non-interactive shells find it too.
    [ -x "${bin}" ] && ln -sf "${bin}" "${NPM_CONFIG_PREFIX:-/usr/local}/bin/agy"
}

install_engine() {
    local engine="$1" pkg
    case "${engine}" in
        codex)    pkg="@openai/codex@latest" ;;
        claude)   pkg="@anthropic-ai/claude-code@latest" ;;
        opencode) refresh_opencode; return 0 ;;
        agy)      refresh_agy; return 0 ;;
        *) log "unknown engine '${engine}', skipping"; return 0 ;;
    esac
    log "refreshing ${engine} (${pkg}) into ${NPM_CONFIG_PREFIX:-npm default}"
    if npm install -g --no-fund --no-audit "${pkg}" >&2; then
        log "${engine} refreshed to $(command -v "${engine}" >/dev/null 2>&1 && "${engine}" --version 2>/dev/null | head -1 || echo '?')"
    else
        log "WARN: ${engine} refresh failed (network?); keeping baked baseline"
    fi
}

# Prepare the seat's project folder so claude/agy start with NO first-run dialog: mark the
# workspace trusted and record acceptance of "Bypass Permissions mode". This is the declarative
# equivalent of clicking through the dialogs once — the jobs-hook then just pastes the task into a
# clean interactive TUI (which bills the subscription). Idempotent; never touches credentials.
prepare_claude_seat() {
    local home="${HOME:-/home/ptylon}" ws="${WORKSPACE_ROOT:-/workspace}"
    command -v python3 >/dev/null 2>&1 || { log "python3 missing; skipping claude seat prep"; return 0; }
    python3 - "$home" "$ws" <<'PY' && log "claude seat prepared (trust ${ws} + skip bypass prompt)" || log "WARN: claude seat prep failed"
import json, os, sys
home, ws = sys.argv[1], sys.argv[2]
# settings.json: accept bypass-permissions mode up front.
sp = os.path.join(home, ".claude", "settings.json")
os.makedirs(os.path.dirname(sp), exist_ok=True)
try:
    s = json.load(open(sp))
except Exception:
    s = {}
s.setdefault("permissions", {})["defaultMode"] = "bypassPermissions"
s["skipDangerousModePermissionPrompt"] = True
json.dump(s, open(sp, "w"), indent=2)
# ~/.claude.json: trust the workspace cwd (per-project flag).
cp = os.path.join(home, ".claude.json")
try:
    c = json.load(open(cp))
except Exception:
    c = {}
proj = c.setdefault("projects", {}).setdefault(ws, {})
proj["hasTrustDialogAccepted"] = True
proj["hasCompletedProjectOnboarding"] = True
json.dump(c, open(cp, "w"), indent=2)
PY
}

# agy first-run shows an interactive onboarding wizard (color scheme + ToS) and then a
# folder-trust dialog — both swallow any injected prompt. Declaratively write the two state
# files agy itself persists after clicking through (cache/onboarding.json + settings.json
# trustedWorkspaces), so the TUI boots straight to the prompt. Idempotent; never touches
# credentials (auth = mounted ~/.gemini/antigravity-cli/antigravity-oauth-token).
prepare_agy_seat() {
    local root="${HOME:-/home/ptylon}/.gemini/antigravity-cli" ws="${WORKSPACE_ROOT:-/workspace}"
    command -v python3 >/dev/null 2>&1 || { log "python3 missing; skipping agy seat prep"; return 0; }
    python3 - "$root" "$ws" <<'PY' && log "agy seat prepared (onboarding complete + trust ${ws})" || log "WARN: agy seat prep failed"
import json, os, sys
root, ws = sys.argv[1], sys.argv[2]
# cache/onboarding.json: skip the color-scheme + ToS wizard.
op = os.path.join(root, "cache", "onboarding.json")
os.makedirs(os.path.dirname(op), exist_ok=True)
try:
    o = json.load(open(op))
except Exception:
    o = {}
o.setdefault("consumerOnboardingComplete", True)
o["onboardingComplete"] = True
json.dump(o, open(op, "w"), indent=2)
# settings.json: trust the workspace folder.
sp = os.path.join(root, "settings.json")
try:
    s = json.load(open(sp))
except Exception:
    s = {}
tw = s.setdefault("trustedWorkspaces", [])
if ws not in tw:
    tw.append(ws)
json.dump(s, open(sp, "w"), indent=2)
PY
}

refresh_engines() {
    for engine in ${ENGINES:-codex}; do
        install_engine "${engine}"
    done
    printf '{"engines":"%s","refreshed_at":"%s"}\n' \
        "${ENGINES:-codex}" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
        > "${HOME:-/home/ptylon}/.engines-bootstrap.json" 2>/dev/null || true
}

if [ "${INSTALL_ENGINES:-0}" = "1" ] || [ "${INSTALL_ENGINES:-}" = "true" ]; then
    case " ${ENGINES:-codex} " in *" claude "*|*" agy "*) prepare_claude_seat ;; esac
    case " ${ENGINES:-codex} " in *" agy "*) prepare_agy_seat ;; esac
    log "INSTALL_ENGINES enabled; refreshing engines in background"
    refresh_engines &
else
    log "INSTALL_ENGINES not set; skipping engine refresh"
fi

exec "$@"
