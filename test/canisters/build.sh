#!/usr/bin/env bash
# Builds everything the canister tests need into test/canisters/build/:
#   - sneed_lock.wasm (+ service.did.js) exactly as a release build does it
#     (dfx 0.28.0, moc 0.14.13, classic persistence)
#   - the test-only canisters (mock ICRC-1 ledger, mock ICPSwap pool, the
#     ICRC-3 library demo canister) compiled with the same moc
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
OUT="$HERE/build"
DFX_VERSION="${DFX_VERSION:-0.28.0}"
mkdir -p "$OUT"

cd "$ROOT"
echo "== sneed_lock (dfx +$DFX_VERSION build --network ic)"
dfx +"$DFX_VERSION" build --network ic sneed_lock 2>&1 | grep -iv "warning\|^ *$\|^\s*[0-9]* |\|^  \^\|Nat$\|bespoke" | tail -2
cp .dfx/ic/canisters/sneed_lock/sneed_lock.wasm "$OUT/sneed_lock.wasm"
cp .dfx/ic/canisters/sneed_lock/service.did.js "$OUT/sneed_lock.did.js"

MOC="$(dfx +"$DFX_VERSION" cache show)/moc"
PKGS="$(mops sources)"
for c in MockLedger MockSwapPool MockSnsGovernance MockCmc MockSnsWasm MockPremium Icrc3Demo; do
  echo "== $c"
  # shellcheck disable=SC2086
  "$MOC" -c $PKGS -o "$OUT/$c.wasm" "$HERE/canisters/$c.mo" 2>&1 | grep -i "error" -A5 || true
  test -s "$OUT/$c.wasm"
done
# the archive actor class on its own, as a DAO proposal would upgrade it
echo "== sneed_pad"
"$MOC" -c $PKGS -o "$OUT/sneed_pad.wasm" "$ROOT/src/sneed_pad/main.mo" 2>&1 | grep -i "error" -A5 || true
test -s "$OUT/sneed_pad.wasm"
echo "== ledger suite wasms (from the SNS wasm canister, needs network; skipped when present)"
if [ ! -s "$OUT/ledger.wasm.gz" ] || [ ! -s "$OUT/index.wasm.gz" ]; then
  node --import "$HERE/lib/loader-register.mjs" "$HERE/lib/fetch-ledger-suite.mjs" "$OUT" || echo "   (could not fetch; sneed_pad tests will be skipped)"
fi
echo "== Icrc3Archive"
# shellcheck disable=SC2086
"$MOC" -c $PKGS -o "$OUT/Icrc3Archive.wasm" "$ROOT/src/icrc3/Archive.mo" 2>&1 | grep -i "error" -A5 || true
test -s "$OUT/Icrc3Archive.wasm"
echo "== done: $(ls "$OUT" | tr '\n' ' ')"
