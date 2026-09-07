#!/usr/bin/env bash
# One-time setup from a fresh clone. Idempotent — safe to re-run.
#
# Everything gitignored gets rebuilt here: node_modules, .venv, .env,
# the Docker database, and the seed data. Nothing is hardcoded to a path, so
# this works wherever you clone it.
#
#   ./scripts/setup.sh            full setup
#   ./scripts/setup.sh --no-test  skip the test run at the end
set -uo pipefail
cd "$(dirname "$0")/.."
ROOT="$PWD"

C_OK=$'\033[32m'; C_WARN=$'\033[33m'; C_ERR=$'\033[31m'; C_DIM=$'\033[2m'; C_OFF=$'\033[0m'
ok(){   printf "  ${C_OK}✓${C_OFF} %s\n" "$1"; }
warn(){ printf "  ${C_WARN}!${C_OFF} %s\n" "$1"; }
err(){  printf "  ${C_ERR}✖${C_OFF} %s\n" "$1"; }
dim(){  printf "    ${C_DIM}%s${C_OFF}\n" "$1"; }

FAIL=0
RUN_TESTS=1
[ "${1:-}" = "--no-test" ] && RUN_TESTS=0

echo
echo "TradingMitra — setup"
echo "════════════════════"

# ---------------------------------------------------------------- prereqs ----
echo
echo "prerequisites"
need() {
  if command -v "$1" >/dev/null 2>&1; then
    ok "$1 $(eval "$2" 2>/dev/null | head -1)"
  else
    err "$1 not found — $3"
    FAIL=1
  fi
}
need node   "node --version"           "install Node 18 or newer"
need npm    "npm --version"            "ships with Node"
need python3 "python3 --version"       "install Python 3.10 or newer"
need docker "docker --version"         "install Docker Desktop or the engine"

if command -v docker >/dev/null 2>&1 && ! docker info >/dev/null 2>&1; then
  err "the Docker daemon is not running — start Docker and re-run"
  FAIL=1
fi
[ "$FAIL" = "1" ] && { echo; err "fix the above and re-run"; exit 1; }

# ---------------------------------------------------------------- secrets ----
echo
echo "configuration"
if [ ! -f backend/.env ]; then
  cp backend/.env.example backend/.env
  # A real secret generated here, so nobody ships the placeholder. openssl is
  # everywhere; node is the fallback since we already require it.
  SECRET=$(openssl rand -base64 48 2>/dev/null || node -e "console.log(require('crypto').randomBytes(48).toString('base64'))")
  if grep -q '^JWT_SECRET=' backend/.env; then
    # BSD and GNU sed disagree on -i, so rewrite the file instead.
    awk -v s="$SECRET" '/^JWT_SECRET=/{print "JWT_SECRET=" s; next} {print}' \
      backend/.env > backend/.env.tmp && mv backend/.env.tmp backend/.env
  else
    echo "JWT_SECRET=$SECRET" >> backend/.env
  fi
  ok "backend/.env created with a generated JWT_SECRET"
else
  ok "backend/.env already present (left alone)"
fi

for app in dashboard frontend; do
  if [ -f "$app/.env.example" ] && [ ! -f "$app/.env" ]; then
    cp "$app/.env.example" "$app/.env"; ok "$app/.env created"
  elif [ -f "$app/.env" ]; then
    ok "$app/.env already present"
  fi
done
# frontend keeps its example under src/ for historical reasons
if [ -f frontend/src/.env.example ] && [ ! -f frontend/.env ]; then
  cp frontend/src/.env.example frontend/.env; ok "frontend/.env created"
fi

# ------------------------------------------------------------ node deps ------
echo
echo "node dependencies"
for app in backend dashboard frontend; do
  if [ -d "$app/node_modules" ]; then
    ok "$app — already installed"
  else
    printf "    installing %s… " "$app"
    if ( cd "$app" && npm install --no-audit --no-fund > /tmp/npm-$app.log 2>&1 ); then
      echo "done"
    else
      echo; err "$app npm install failed — see /tmp/npm-$app.log"; FAIL=1
    fi
  fi
done

# ------------------------------------------------------------ python ---------
echo
echo "python environment"
if [ -x .venv/bin/python ]; then
  ok ".venv already present"
else
  python3 -m venv .venv && ok ".venv created"
fi
printf "    installing quant requirements… "
if .venv/bin/pip install -q --upgrade pip > /dev/null 2>&1 &&
   .venv/bin/pip install -q -r quant/requirements.txt > /tmp/pip.log 2>&1; then
  echo "done"
  ok "$(.venv/bin/python -c 'import pandas,numpy,lightgbm; print(f"pandas {pandas.__version__}, numpy {numpy.__version__}, lightgbm {lightgbm.__version__}")')"
else
  echo; err "pip install failed — see /tmp/pip.log"; FAIL=1
fi

# ------------------------------------------------------------ database -------
echo
echo "database"
# An already-running container is success, not failure. `container_name` is
# fixed, so a second checkout of this repo on the same machine collides with the
# first — report that clearly instead of as a generic compose error.
if docker ps --filter "name=tradingmitra-mongo" --filter "status=running" --format '{{.Names}}' \
     | grep -q tradingmitra-mongo; then
  ok "mongo container already running (reusing it)"
elif docker compose up -d > /tmp/compose.log 2>&1; then
  ok "mongo container started"
elif grep -q "already in use" /tmp/compose.log 2>/dev/null; then
  warn "a tradingmitra-mongo container exists from another checkout of this repo"
  dim "reusing it; 'docker rm -f tradingmitra-mongo' if you want a clean one"
else
  err "docker compose up failed — see /tmp/compose.log"; FAIL=1
fi
printf "    waiting for the replica set… "
for i in $(seq 1 60); do
  [ "$(docker inspect --format='{{.State.Health.Status}}' tradingmitra-mongo 2>/dev/null)" = "healthy" ] && break
  sleep 1
done
if [ "$(docker inspect --format='{{.State.Health.Status}}' tradingmitra-mongo 2>/dev/null)" = "healthy" ]; then
  echo "healthy"
  # Transactions are the whole reason for the replica set; verify rather than assume.
  if ( cd backend && MONGO_URL="mongodb://localhost:27017/tradingmitra?replicaSet=rs0" \
       node -e "
const m=require('mongoose');
(async()=>{ await m.connect(process.env.MONGO_URL,{serverSelectionTimeoutMS:8000});
  const s=await m.startSession(); s.startTransaction();
  await m.connection.db.collection('_probe').insertOne({t:1},{session:s});
  await s.abortTransaction(); await s.endSession(); await m.disconnect();
})();" >/dev/null 2>&1 ); then
    ok "transactions supported"
  else
    err "transactions NOT supported — the replica set did not initialise"
    dim "try: docker compose down -v && ./scripts/setup.sh"
    FAIL=1
  fi
else
  err "mongo did not become healthy — see /tmp/compose.log"; FAIL=1
fi

# ------------------------------------------------------------ migrate/seed ---
if [ "$FAIL" = "0" ]; then
  echo
  echo "schema and data"
  export MONGO_URL="mongodb://localhost:27017/tradingmitra?replicaSet=rs0"
  ( cd backend && node scripts/migrate.js > /tmp/migrate.log 2>&1 ) \
    && ok "migrations applied" || { err "migrations failed — see /tmp/migrate.log"; FAIL=1; }
  ( cd backend && node scripts/seed.js > /tmp/seed.log 2>&1 ) \
    && ok "seed data loaded" || warn "seed skipped (data may already exist)"
fi

# ------------------------------------------------------------ tests ----------
if [ "$FAIL" = "0" ] && [ "$RUN_TESTS" = "1" ]; then
  echo
  echo "tests"
  printf "    backend unit… "
  if ( cd backend && npm test > /tmp/test-backend.log 2>&1 ); then
    echo "$(grep -E '^ℹ pass' /tmp/test-backend.log | awk '{print $3}') passed"
  else
    echo; err "backend tests failed — see /tmp/test-backend.log"; FAIL=1
  fi
  printf "    quant causality… "
  if ( PYTHONPATH=quant .venv/bin/python quant/tests/test_causality.py > /tmp/test-quant.log 2>&1 ); then
    echo "no look-ahead"
  else
    echo; err "causality test FAILED — see /tmp/test-quant.log"; FAIL=1
  fi
fi

# ------------------------------------------------------------ done -----------
echo
if [ "$FAIL" = "0" ]; then
  cat <<BANNER
${C_OK}setup complete${C_OFF}

  start everything    ./scripts/dev.sh
  then open           http://localhost:3000   (sign up — you get a funded paper account)

  stop                ./scripts/dev.sh stop
  status              ./scripts/dev.sh status
  logs                .devlogs/

BANNER
else
  err "setup finished with errors — see the messages above"
  exit 1
fi
