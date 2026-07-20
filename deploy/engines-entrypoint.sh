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

install_engine() {
    local engine="$1" pkg
    case "${engine}" in
        codex)    pkg="@openai/codex@latest" ;;
        claude)   pkg="@anthropic-ai/claude-code@latest" ;;
        opencode) refresh_opencode; return 0 ;;
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
