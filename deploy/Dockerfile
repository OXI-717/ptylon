# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS build

WORKDIR /app

# node-pty and better-sqlite3 have native components.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile

COPY . ./
RUN pnpm build && pnpm prune --prod


FROM node:22-bookworm-slim AS runtime

ARG TARGETARCH

# Base runtime + a common toolbox the coding-agent engines expect for real work: python3
# (with pip/venv + build tooling for C-extensions), plus the everyday CLIs agents reach for
# (curl/wget/jq/ripgrep/less/ps/unzip/ssh). Keep --no-install-recommends to bound image size.
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
       bash ca-certificates tini git \
       python3 python3-pip python3-venv build-essential \
       curl wget jq ripgrep less procps unzip openssh-client \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --system ptylon \
  && useradd --system --gid ptylon --create-home --home-dir /home/ptylon --shell /bin/bash ptylon \
  && install -d -o ptylon -g ptylon /app /data /workspace /workspace/uploads

# Coding-agent engines for the oxi-remote-agents jobs-hook. The engines are installed into
# a writable, ptylon-owned npm prefix so the boot entrypoint (deploy/engines-entrypoint.sh)
# can refresh them to @latest on every start — a pinned image version never goes stale, and
# the CLI stays self-updateable at runtime. A baked baseline keeps the container usable when
# a boot-time refresh fails (network flap). codex uses file-based auth (~/.codex/auth.json),
# mounted at runtime; add claude/opencode via the ENGINES env of the pty service.
ENV NPM_CONFIG_PREFIX=/home/ptylon/.npm-global \
    PATH=/home/ptylon/.npm-global/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
# Baked baselines for all three engines so a boot-time refresh flap never leaves an engine
# missing. codex/claude via npm; opencode via its platform package (npm wrapper is broken) with
# an `opencode` symlink at the real binary. The boot entrypoint refreshes each to @latest.
RUN set -eu; \
  case "${TARGETARCH:-$(uname -m)}" in \
    amd64|x86_64) opencode_package="opencode-linux-x64" ;; \
    arm64|aarch64) opencode_package="opencode-linux-arm64" ;; \
    *) echo "unsupported opencode target architecture: ${TARGETARCH:-$(uname -m)}" >&2; exit 1 ;; \
  esac; \
  install -d -o ptylon -g ptylon /home/ptylon/.npm-global \
  && su ptylon -s /bin/bash -c "\
       npm install -g --no-fund --no-audit \
         @openai/codex@latest @anthropic-ai/claude-code@latest ${opencode_package}@latest \
       && ln -sf \"\$(npm root -g)/${opencode_package}/bin/opencode\" /home/ptylon/.npm-global/bin/opencode"

COPY --chmod=755 deploy/engines-entrypoint.sh /usr/local/bin/engines-entrypoint.sh

WORKDIR /app

COPY --from=build --chown=ptylon:ptylon /app/.next/standalone ./
COPY --from=build --chown=ptylon:ptylon /app/.next/static ./.next/static
COPY --from=build --chown=ptylon:ptylon /app/public ./public
COPY --from=build --chown=ptylon:ptylon /app/server ./server
COPY --from=build --chown=ptylon:ptylon /app/node_modules ./node_modules

ENV NODE_ENV=production \
    PORT=8790 \
    WS_PORT=8791 \
    WS_HOST=0.0.0.0 \
    PTY_DAEMON_HOST=0.0.0.0 \
    PTY_DAEMON_PORT=8792 \
    PTY_DAEMON_URL=ws://pty:8792 \
    WEB_CONSOLE_DB_PATH=/data/web-console.db \
    WORKSPACE_ROOT=/workspace \
    FILE_ACCESS_ROOT=/workspace \
    ALLOWED_CWD_ROOT=/workspace \
    JOBS_ROOT=/workspace/.agent-jobs \
    ENGINE_STARTUP_MS=6000 \
    TRUST_SETTLE_MS=4000 \
    SUBMIT_DELAY_MS=1500 \
    UPLOAD_DIR=/workspace/uploads \
    PIP_BREAK_SYSTEM_PACKAGES=1 \
    NEXT_PUBLIC_WORKSPACE_ROOT=/workspace \
    NEXT_PUBLIC_UPLOAD_DIR=/workspace

USER ptylon
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/engines-entrypoint.sh"]
CMD ["node", "server.js"]
