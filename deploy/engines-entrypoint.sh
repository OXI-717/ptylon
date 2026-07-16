#!/usr/bin/env bash
# Boot-time engine provisioning for the oxi-remote-agents jobs-hook.
#
# Mirrors the OpenMedia seat-entrypoint pattern: install/refresh the coding-agent
# CLIs to @latest on every container boot into a writable npm prefix, so a pinned
# image version never goes stale and the CLI stays self-updateable at runtime.
#
# Opt-in per service: only the `pty` service (which spawns the engine bash sessions)
# sets INSTALL_ENGINES=1; app/ws skip the install and just exec their command.
#
# Non-fatal: a failed refresh (network flap) logs a warning and falls back to the
# baseline version baked into the image, so the container still boots and serves.
set -uo pipefail

log() { printf '[engines-entrypoint] %s\n' "$*" >&2; }

install_engine() {
    local engine="$1" pkg
    case "${engine}" in
        codex)    pkg="@openai/codex@latest" ;;
        claude)   pkg="@anthropic-ai/claude-code@latest" ;;
        opencode) pkg="opencode-ai@latest" ;;
        *) log "unknown engine '${engine}', skipping"; return 0 ;;
    esac
    log "refreshing ${engine} (${pkg}) into ${NPM_CONFIG_PREFIX:-npm default}"
    if npm install -g --no-fund --no-audit "${pkg}" >&2; then
        log "${engine} refreshed to $(command -v "${engine}" >/dev/null 2>&1 && "${engine}" --version 2>/dev/null | head -1 || echo '?')"
    else
        log "WARN: ${engine} refresh failed (network?); keeping baked baseline"
    fi
}

if [ "${INSTALL_ENGINES:-0}" = "1" ] || [ "${INSTALL_ENGINES:-}" = "true" ]; then
    for engine in ${ENGINES:-codex}; do
        install_engine "${engine}"
    done
    printf '{"engines":"%s","refreshed_at":"%s"}\n' \
        "${ENGINES:-codex}" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
        > "${HOME:-/home/ptylon}/.engines-bootstrap.json" 2>/dev/null || true
else
    log "INSTALL_ENGINES not set; skipping engine refresh"
fi

exec "$@"
