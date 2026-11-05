#!/bin/sh
set -e

# On Render both processes live in one container. The collector talks to the
# local empire-api through the same path secret the public API uses.
if [ -z "$GGE_API_URL" ] && [ -n "$API_PATH_SECRET" ]; then
  export GGE_API_URL="http://127.0.0.1:${PORT:-3000}/${API_PATH_SECRET}"
fi

node apps/empire-api/server.js &
API_PID=$!
node apps/collector/dist/index.js &
COLLECTOR_PID=$!

term() {
  kill "$API_PID" "$COLLECTOR_PID" 2>/dev/null || true
}
trap term TERM INT

wait -n 2>/dev/null || wait
term
