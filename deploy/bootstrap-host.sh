#!/usr/bin/env bash
# Bootstrap Ptylon on a Linux host that already has Docker and docker compose.
set -euo pipefail

log() { printf '[bootstrap-host] %s\n' "$*" >&2; }
fail() { log "ERROR: $*"; exit 1; }

usage() {
  cat <<'EOF'
Usage: sudo deploy/bootstrap-host.sh [--rotate-token] [--render-only]

Environment:
  AUTH_PASSWORD          Required on first run unless already present in .env.
  PTYLON_INSTALL_ROOT    Default: /opt/ptylon
  PTYLON_REPO_DIR        Default: repository root containing docker-compose.yml
  PTYLON_SYSTEMD_DIR     Default: /etc/systemd/system
  PTYLON_APP_BIND        Default: 127.0.0.1
  PTYLON_APP_PORT        Default: 8790
  PTYLON_WS_BIND         Default: 127.0.0.1
  PTYLON_WS_PORT         Default: 8791
EOF
}

rotate_token=0
render_only=0
while (($#)); do
  case "$1" in
    --rotate-token) rotate_token=1; shift ;;
    --render-only) render_only=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; fail "unknown option: $1" ;;
  esac
done

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
repo_dir=${PTYLON_REPO_DIR:-$(cd "${script_dir}/.." && pwd)}
install_root=${PTYLON_INSTALL_ROOT:-/opt/ptylon}
systemd_dir=${PTYLON_SYSTEMD_DIR:-/etc/systemd/system}
service_name=${PTYLON_SERVICE_NAME:-ptylon.service}
compose_file=${PTYLON_COMPOSE_FILE:-${repo_dir}/docker-compose.yml}
env_file=${PTYLON_ENV_FILE:-${install_root}/.env}
token_file=${PTYLON_ADMIN_TOKEN_FILE:-${install_root}/admin-token}
seats_root=${PTYLON_SEATS_ROOT:-${install_root}/seats}
engines=${ENGINES:-codex claude opencode agy}
app_bind=${PTYLON_APP_BIND:-127.0.0.1}
app_port=${PTYLON_APP_PORT:-8790}
ws_bind=${PTYLON_WS_BIND:-127.0.0.1}
ws_port=${PTYLON_WS_PORT:-8791}
smoke_retries=${PTYLON_SMOKE_RETRIES:-30}
smoke_delay=${PTYLON_SMOKE_DELAY:-2}
smoke_timeout=${PTYLON_SMOKE_TIMEOUT:-5}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "$1 is required"
}

read_env_value() {
  local key="$1"
  [ -f "$env_file" ] || return 0
  local line value
  line=$(grep -E "^${key}=" "$env_file" | tail -n 1 || true)
  [ -n "$line" ] || return 0
  value=${line#*=}
  value=${value%$'\r'}
  if [[ "$value" == \"*\" && "$value" == *\" ]]; then
    value=${value:1:${#value}-2}
  fi
  printf '%s' "$value"
}

random_url_token() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -base64 32 | tr '+/' '-_' | tr -d '=\n'
  elif command -v python3 >/dev/null 2>&1; then
    python3 - <<'PY'
import secrets
print(secrets.token_urlsafe(32))
PY
  else
    fail "openssl or python3 is required to generate secrets"
  fi
}

random_hex_secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
  elif command -v python3 >/dev/null 2>&1; then
    python3 - <<'PY'
import secrets
print(secrets.token_hex(32))
PY
  else
    fail "openssl or python3 is required to generate secrets"
  fi
}

quote_env() {
  local value="$1"
  value=${value//\\/\\\\}
  value=${value//\"/\\\"}
  printf '"%s"' "$value"
}

[ -d "$repo_dir" ] || fail "repository directory does not exist: $repo_dir"
[ -f "$compose_file" ] || fail "docker compose file does not exist: $compose_file"

existing_auth=$(read_env_value AUTH_PASSWORD)
existing_jwt=$(read_env_value JWT_SECRET)
auth_password=${AUTH_PASSWORD:-$existing_auth}
jwt_secret=${JWT_SECRET:-$existing_jwt}

[ -n "$auth_password" ] || fail "AUTH_PASSWORD is required (set env var or keep it in ${env_file})"
[ "$auth_password" != "replace-with-a-strong-password" ] || fail "AUTH_PASSWORD must be changed from the placeholder"

install -d -m 0750 "$install_root"
install -d -m 0750 "$seats_root"
install -d -m 0755 "$systemd_dir"

codex_home=${PTYLON_CODEX_HOME:-${seats_root}/codex-home}
claude_home=${PTYLON_CLAUDE_HOME:-${seats_root}/claude-home}
opencode_home=${PTYLON_OPENCODE_HOME:-${seats_root}/opencode-home}
agy_home=${PTYLON_AGY_HOME:-${seats_root}/agy-home}
for dir in "$codex_home" "$claude_home" "$opencode_home" "$agy_home"; do
  install -d -m 0700 "$dir"
done

if [ -f "$token_file" ] && [ "$rotate_token" -eq 0 ]; then
  admin_token=$(tr -d '\r\n' < "$token_file")
  [ -n "$admin_token" ] || fail "admin token file is empty: $token_file"
else
  admin_token=$(random_url_token)
  umask 077
  printf '%s\n' "$admin_token" > "$token_file"
  chmod 0600 "$token_file"
fi

[ ${#admin_token} -ge 43 ] || fail "admin token entropy is too low"
[ -n "$jwt_secret" ] || jwt_secret=$(random_hex_secret)

umask 077
cat > "$env_file" <<EOF
AUTH_PASSWORD=$(quote_env "$auth_password")
JWT_SECRET=$jwt_secret
WEB_CONSOLE_ADMIN_TOKEN=$admin_token
ENGINES=$(quote_env "$engines")
INSTALL_ENGINES=1
PTYLON_APP_BIND=$app_bind
PTYLON_APP_PORT=$app_port
PTYLON_WS_BIND=$ws_bind
PTYLON_WS_PORT=$ws_port
PTYLON_CODEX_HOME=$codex_home
PTYLON_CLAUDE_HOME=$claude_home
PTYLON_OPENCODE_HOME=$opencode_home
PTYLON_AGY_HOME=$agy_home
PTY_IDLE_TIMEOUT_HOURS=168
EOF
chmod 0600 "$env_file"

unit_path="${systemd_dir}/${service_name}"
cat > "$unit_path" <<EOF
[Unit]
Description=Ptylon Docker Compose stack
Requires=docker.service
After=docker.service network-online.target
Wants=network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=${repo_dir}
Environment=COMPOSE_HTTP_TIMEOUT=120
ExecStart=/usr/bin/env docker compose --env-file ${env_file} -f ${compose_file} up -d
ExecStop=/usr/bin/env docker compose --env-file ${env_file} -f ${compose_file} down
TimeoutStartSec=180
TimeoutStopSec=120
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF
chmod 0644 "$unit_path"

if [ "$render_only" -eq 1 ]; then
  log "rendered ${env_file}, ${token_file}, ${unit_path}"
  exit 0
fi

require_command docker
require_command curl
require_command systemctl

systemctl daemon-reload
systemctl enable "$service_name"
docker compose --env-file "$env_file" -f "$compose_file" up -d

health_url="http://${app_bind}:${app_port}/api/admin/health"
for ((attempt = 1; attempt <= smoke_retries; attempt++)); do
  if curl --fail --silent --show-error --max-time "$smoke_timeout" \
    -H "Authorization: Bearer ${admin_token}" "$health_url" >/dev/null; then
    log "health check passed: ${health_url}"
    exit 0
  fi
  sleep "$smoke_delay"
done

fail "health check failed after ${smoke_retries} attempts: ${health_url}"
