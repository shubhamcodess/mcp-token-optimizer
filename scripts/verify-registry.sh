#!/usr/bin/env bash
# Proves that what is on the npm registry installs and runs.
#   scripts/verify-registry.sh <package-name> <version> [tries]
# Waits for the version to appear (10 s per try, default 30 tries), installs it into an empty prefix and checks
# the CLI, the regression examples and the dashboard. VERIFY_PROVENANCE=1 also requires a provenance attestation.
set -euo pipefail
NAME="${1:?usage: verify-registry.sh <name> <version> [tries]}"
VERSION="${2:?usage: verify-registry.sh <name> <version> [tries]}"
TRIES="${3:-30}"
PORT="${VERIFY_PORT:-18789}"

for i in $(seq 1 "$TRIES"); do
  if [ "$(npm view "$NAME@$VERSION" version 2>/dev/null || true)" = "$VERSION" ]; then break; fi
  [ "$i" = "$TRIES" ] && { echo "FAIL $NAME@$VERSION did not appear on the registry"; exit 1; }
  sleep 10
done
echo "ok   $NAME@$VERSION is on the registry"

if [ "${VERIFY_PROVENANCE:-0}" = "1" ]; then
  ATT="$(npm view "$NAME@$VERSION" --json dist.attestations 2>/dev/null || true)"
  [ -n "$ATT" ] && [ "$ATT" != "undefined" ] || { echo "FAIL no provenance attestation on $NAME@$VERSION"; exit 1; }
  echo "ok   provenance attestation present"
fi

P="$(mktemp -d)"
npm install -g --prefix "$P" "$NAME@$VERSION" >/dev/null
export MTO_HOME="$P/home" MTO_NO_DAEMON=1
[ "$("$P/bin/mto" --version)" = "$VERSION" ] || { echo "FAIL mto --version is not $VERSION"; exit 1; }
echo "ok   mto --version"
"$P/bin/mto" eval --examples --fail-under lossless=100 >/dev/null || { echo "FAIL mto eval --examples"; exit 1; }
echo "ok   mto eval --examples (lossless 100%)"

"$P/bin/mto" serve --port "$PORT" > "$P/serve.log" 2>&1 &
PID=$!
trap 'kill $PID 2>/dev/null || true' EXIT
for i in $(seq 1 30); do curl -sf "http://127.0.0.1:$PORT/health" >/dev/null && break; sleep 0.5; done
curl -sf "http://127.0.0.1:$PORT/" | grep -q 'mto dashboard' || { echo "FAIL dashboard not served"; exit 1; }
curl -s -D - -o /dev/null "http://127.0.0.1:$PORT/" | grep -qi "content-security-policy: default-src 'none'" || { echo "FAIL missing CSP header"; exit 1; }
[ "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/api/status")" = "401" ] || { echo "FAIL /api/status should be 401 without a token"; exit 1; }
echo "ok   dashboard served, CSP set, API needs a token"
echo "VERIFIED $NAME@$VERSION"
