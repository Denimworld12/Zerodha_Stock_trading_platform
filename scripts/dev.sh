#!/usr/bin/env bash
# Start the whole stack locally, in dependency order, with health gates.
#
#   ./scripts/dev.sh          start everything
#   ./scripts/dev.sh stop     stop everything
#   ./scripts/dev.sh status   what is running
#
# Ctrl-C stops every service cleanly.
set -uo pipefail
cd "$(dirname "$0")/.."
ROOT="$PWD"
LOGS="$ROOT/.devlogs"
mkdir -p "$LOGS"

# Local dev database. Exported here so it beats the committed Atlas URL in
# backend/.env - dotenv does not overwrite variables that are already set.
# ?replicaSet=rs0 is required: transactions do not exist without it, and
# placing an order writes an order + a position + ledger rows atomically.
export MONGO_URL="${MONGO_URL:-mongodb://localhost:27017/tradingmitra?replicaSet=rs0}"
export PORT="${PORT:-3002}"
export SIGNAL_SERVICE_URL="${SIGNAL_SERVICE_URL:-http://localhost:8000}"
export SIGNAL_WEBHOOK_SECRET="${SIGNAL_WEBHOOK_SECRET:-local-dev-secret}"
# Real auth is on. Sign up at http://localhost:3000 (or :3001) to get an account.
export AUTH_DEV_BYPASS="${AUTH_DEV_BYPASS:-false}"

C_OK=$'\033[32m'; C_WARN=$'\033[33m'; C_ERR=$'\033[31m'; C_DIM=$'\033[2m'; C_OFF=$'\033[0m'
ok(){   printf "  ${C_OK}✓${C_OFF} %s\n" "$1"; }
warn(){ printf "  ${C_WARN}!${C_OFF} %s\n" "$1"; }
err(){  printf "  ${C_ERR}✖${C_OFF} %s\n" "$1"; }
dim(){  printf "    ${C_DIM}%s${C_OFF}\n" "$1"; }

PIDFILE="$LOGS/pids"

# Ports this stack owns. Teardown is driven by these rather than by process
# groups: `kill -- -PGID` also killed the caller's own shell when dev.sh was
# invoked from a session that shared the group. Killing whoever holds the port
# is precise, and the shell running this script never holds one.
DEV_PORTS="3002 8000 3000 3001"

port_pids() {  # pid(s) listening on $1
  ss -ltnpH "sport = :$1" 2>/dev/null | grep -oP 'pid=\K[0-9]+' | sort -u
}

stop_all() {
  echo "stopping services..."

  # 1. the processes we launched, plus anything they forked
  if [ -f "$PIDFILE" ]; then
    while read -r name pid; do
      [ -z "${pid:-}" ] && continue
      if kill -0 "$pid" 2>/dev/null; then
        pkill -P "$pid" 2>/dev/null
        kill "$pid" 2>/dev/null
        ok "stopped $name (pid $pid)"
      fi
    done < "$PIDFILE"
    rm -f "$PIDFILE"
  fi

  # 2. anything still holding one of our ports, whoever started it
  sleep 1
  for p in $DEV_PORTS; do
    for pid in $(port_pids "$p"); do
      kill "$pid" 2>/dev/null && warn "freed :$p (pid $pid)"
    done
  done

  # 3. escalate only for ports that survived a TERM
  sleep 1
  for p in $DEV_PORTS; do
    for pid in $(port_pids "$p"); do
      kill -9 "$pid" 2>/dev/null && warn "force-killed :$p (pid $pid)"
    done
  done

  # 4. verify rather than assume - reporting "stopped" over a still-bound port
  #    is the exact failure this function used to have
  local stuck=""
  for p in $DEV_PORTS; do
    ss -ltn 2>/dev/null | grep -q ":$p " && stuck="$stuck $p"
  done
  if [ -n "$stuck" ]; then
    err "ports still bound:$stuck"
  else
    ok "all ports released"
  fi
  echo "mongo container left running — 'docker compose down' to stop it"
}

status_all() {
  for p in 27017 3002 8000 3000 3001; do
    printf "  :%-6s " "$p"
    if ss -ltn 2>/dev/null | grep -q ":$p "; then printf "${C_OK}up${C_OFF}\n"; else printf "${C_DIM}down${C_OFF}\n"; fi
  done
}

case "${1:-start}" in
  stop)   stop_all; exit 0 ;;
  status) status_all; exit 0 ;;
esac

trap 'echo; stop_all; exit 0' INT TERM

# Refuse to start a second copy rather than fight over ports.
if [ -f "$PIDFILE" ] && ss -ltn 2>/dev/null | grep -q ":$PORT "; then
  err "something is already listening on :$PORT"
  dim "run './scripts/dev.sh stop' first"
  exit 1
fi
: > "$PIDFILE"

wait_http() {  # name url timeout_s
  local name="$1" url="$2" limit="${3:-60}" i=0
  while [ "$i" -lt "$limit" ]; do
    if curl -sf -o /dev/null --max-time 3 "$url"; then ok "$name ready"; return 0; fi
    sleep 1; i=$((i+1))
  done
  err "$name did not come up in ${limit}s"
  dim "check $LOGS/$name.log"
  return 1
}

launch() {  # name dir command...
  local name="$1" dir="$2"; shift 2
  # `exec` matters: without it the subshell stays alive as the parent of the
  # real process, $! records the WRAPPER's pid, and `dev.sh stop` kills the
  # wrapper while the server keeps holding the port. exec replaces the subshell
  # so the pid we record is the pid we can actually kill.
  ( cd "$dir" && exec "$@" ) > "$LOGS/$name.log" 2>&1 &
  echo "$name $!" >> "$PIDFILE"
}

echo
echo "TradingMitra — local stack"
echo "──────────────────────────"

# 1. database ---------------------------------------------------------------
echo "database"
if ! docker compose ps --status running 2>/dev/null | grep -q tradingmitra-mongo; then
  docker compose up -d > "$LOGS/mongo.log" 2>&1 || { err "docker compose up failed"; exit 1; }
fi
for i in $(seq 1 40); do
  [ "$(docker inspect --format='{{.State.Health.Status}}' tradingmitra-mongo 2>/dev/null)" = "healthy" ] && break
  sleep 1
done
if [ "$(docker inspect --format='{{.State.Health.Status}}' tradingmitra-mongo 2>/dev/null)" = "healthy" ]; then
  ok "mongo healthy on :27017"
else
  err "mongo unhealthy — see $LOGS/mongo.log"; exit 1
fi

# 2. migrations -------------------------------------------------------------
# Run before anything serves traffic: a process querying a collection whose
# indexes do not exist yet will work, slowly, and then fail a uniqueness
# guarantee it was relying on.
echo "migrations"
if ( cd "$ROOT/backend" && node scripts/migrate.js > "$LOGS/migrate.log" 2>&1 ); then
  ok "schema up to date"
  grep -E "^  ✓" "$LOGS/migrate.log" | sed 's/^/    /' || true
else
  err "migrations failed — see $LOGS/migrate.log"
  tail -3 "$LOGS/migrate.log" | sed 's/^/    /'
  exit 1
fi

# 3. backend ----------------------------------------------------------------
echo "services"
launch backend "$ROOT/backend" node index.js
wait_http backend "http://localhost:$PORT/" 40 || true

# 4. quant signal service (optional — the app works without it) --------------
if [ -x "$ROOT/.venv/bin/uvicorn" ]; then
  launch quant "$ROOT/quant" env PYTHONPATH=. SIGNAL_WEBHOOK_SECRET="$SIGNAL_WEBHOOK_SECRET" \
      "$ROOT/.venv/bin/uvicorn" qsmc.service.api:app --port 8000 --log-level warning
  wait_http quant "http://localhost:8000/health" 45 || warn "quant service down — Signals tab will show an error, rest of the app is fine"
else
  warn "no .venv — skipping quant service"
  dim "python3 -m venv .venv && .venv/bin/pip install -r quant/requirements.txt"
fi

# 5. react apps -------------------------------------------------------------
launch dashboard "$ROOT/dashboard" env BROWSER=none PORT=3000 npm start
launch frontend  "$ROOT/frontend"  env BROWSER=none PORT=3001 npm start
wait_http dashboard "http://localhost:3000" 120 || true
wait_http frontend  "http://localhost:3001" 120 || true

cat <<BANNER

  ${C_OK}running${C_OFF}
    dashboard   http://localhost:3000     trading UI — sign up here
    landing     http://localhost:3001     marketing site + login/signup
    api         http://localhost:3002     express
    signals     http://localhost:8000/docs   quant service (OpenAPI)
    mongo       mongodb://localhost:27017/tradingmitra

  logs   $LOGS/*.log
  stop   Ctrl-C, or ./scripts/dev.sh stop

BANNER

# Hold the terminal so Ctrl-C reaches the trap.
while true; do sleep 3600; done
