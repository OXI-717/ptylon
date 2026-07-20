#!/usr/bin/env bash
# Stage 1 smoke — jobs-hook is up, no engine yet. Verifies auth + routing + create + reader.
set -uo pipefail
BASE="${BASE:-http://127.0.0.1:8790}"
TOKEN="${TOKEN:-local-verify-token}"
AUTH="Authorization: Bearer ${TOKEN}"

echo "== 1. unauthorized create → expect 401 =="
curl -s -o /dev/null -w "  HTTP %{http_code}\n" -X POST "$BASE/api/admin/jobs" \
  -H "Content-Type: application/json" -d '{"engine":"claude","cwd":"/tmp","task":"t","nonce":"n"}'

echo "== 2. authorized create in a real cwd → expect 201 + job_id =="
CWD="${CWD:-/tmp/ptylon-verify/workspace}"
mkdir -p "$CWD"
RESP=$(curl -s -X POST "$BASE/api/admin/jobs" -H "$AUTH" -H "Content-Type: application/json" \
  -d "{\"engine\":\"claude\",\"cwd\":\"$CWD\",\"task\":\"echo smoke\",\"nonce\":\"smoke-nonce\"}")
echo "  resp: $RESP"
JOB=$(printf '%s' "$RESP" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("job_id",""))' 2>/dev/null)
echo "  job_id: ${JOB:-<none>}"

echo "== 3. result before engine writes → expect 404 =="
curl -s -o /dev/null -w "  HTTP %{http_code}\n" "$BASE/api/admin/jobs/${JOB:-x}/result" -H "$AUTH"

echo "== 4. status → expect JSON {status,pty_tail,process_alive} =="
curl -s "$BASE/api/admin/jobs/${JOB:-x}" -H "$AUTH"; echo

echo
echo "Stage 1 OK if: 401, then 201+job_id, then 404, then a status JSON."
