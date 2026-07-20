# Локальная проверка oxi-remote-agents (без Docker, всё на Mac)

Форк Ptylon гоняется локально тремя dev-сервисами; pty-daemon спавнит локальный bash.
Значит фейковый `claude` кладём в PATH — Docker не нужен.

## 0. Подготовка (один раз)

```bash
# зависимости форка (нужен Node 22+ и pnpm)
cd ~/cc/oxi/ptylon
git checkout feat/oxi-remote-agents-jobs-hook
pnpm install

# ⚠ macOS Apple Silicon: pnpm распаковывает arm64 spawn-helper node-pty БЕЗ exec-бита →
# node-pty падает posix_spawnp, daemon крашится. Одноразовый фикс:
chmod +x node_modules/.pnpm/node-pty@*/node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper

# .env для локали
cp verify/env.local.example .env
mkdir -p /tmp/ptylon-verify/workspace

# python-клиент
cd ~/cc/oxi/oxi-skills
pip install -e plugins/oxi-remote-agents      # даёт команду oxi-remote
cp ~/cc/oxi/ptylon/verify/agent-hosts.local.json ~/agent-hosts.json
```

## 1. Поднять Ptylon (3 терминала или tmux)

```bash
cd ~/cc/oxi/ptylon
pnpm build
node --env-file=.env server/pty-daemon.mjs      # :8792 (T1)
pnpm start:ws                                    # :8791 (T2)
pnpm start                                       # :8790 (T3)  (dev: pnpm dev)
```

## Стадия 1 — каркас (без движка)

```bash
cd ~/cc/oxi/ptylon
bash verify/smoke-stage1.sh
```
Ожидаем: `401` → `201 + job_id` → `404` (результата ещё нет) → status-JSON.
Ловит: bearer-auth, роутинг, gateway `create→created`(`_cid`), права `JOBS_ROOT`.

## Стадия 2 — весь путь через ФЕЙКОВЫЙ claude (не жжём настоящий)

```bash
# положить фейковый claude в PATH процесса pty-daemon: перезапусти daemon так:
cd ~/cc/oxi/ptylon
chmod +x verify/fake-claude
cp verify/fake-claude /tmp/ptylon-verify/claude
PATH="/tmp/ptylon-verify:$PATH" node --env-file=.env server/pty-daemon.mjs   # перезапуск T1 c fake claude в PATH

# клиент — реальный диспатч
cd ~/cc/oxi/oxi-skills
oxi-remote start --host local --engine claude \
  --repo /tmp/ptylon-verify/workspace \
  --task "review anything" --capture json --timeout 30 --poll-interval 1
```
Ожидаем на выходе:
```json
{"job_id":"...","status":"done","verdict":{"ok":true,"note":"fake-claude verify"},...}
```
→ **это зелёный весь путь**: create → inject → fake-claude пишет файл → host-local reader → вердикт.
Если `timeout`/`failed` — смотрим `ENGINE_STARTUP_MS` (в .env) и логи daemon/gateway.

## Стадия 3 — реальный claude

Убери fake из PATH, поставь настоящий залогиненный `claude` на хост (device-auth).
Повтори `oxi-remote start … --engine claude --task "review <файл в /tmp/ptylon-verify/workspace>"`.
Докрути `ENGINE_STARTUP_MS` (реальному TUI нужно больше времени на старт).

## Статус проверки (2026-07-16, локально на Mac arm64)

- **Стадия 1 — ✅ зелёная:** 401 → 201+job_id (gateway `create→created` работает) → 404 → status JSON с реальным pty_tail.
- **Стадия 2 (fake-claude) — ✅ зелёная:** `oxi-remote start` → `{"status":"done","verdict":{"ok":true,...}}`, exit 0. Весь путь create→inject→файл→reader→вердикт подтверждён.
- **Стадия 3 (реальный claude) — осталась:** перезапусти daemon БЕЗ `/tmp/ptylon-verify` в PATH (чтобы нашёлся настоящий `claude`), задай задачу-ревью реального файла в workspace, при `timeout` — подними `ENGINE_STARTUP_MS`.

Пойманные и исправленные живой проверкой баги: Next16 `await params` (jobs-hook), fake-claude line-buffered stdin, node-pty arm64 spawn-helper +x.

## Что мне прислать, если что-то не так
- Вывод `smoke-stage1.sh` (стадия 1).
- Вывод `oxi-remote start` + последние строки логов pty-daemon и ws-gateway.
- Я по ним поправлю jobs-hook/тайминг (это и есть живая докрутка PR OXI-717/ptylon#1).
