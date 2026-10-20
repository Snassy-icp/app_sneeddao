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

# sneed_lock as of v2a (dissolve delays, before lock creation times were kept), for the
# upgrade test that fills in creation times from the ICRC-3 log
PREV_COMMIT=7023ef32
echo "== sneed_lock at $PREV_COMMIT (moc, for the upgrade test)"
PREV_SRC="$(mktemp -d)"
git archive "$PREV_COMMIT" src/sneed_lock src/icrc3 src/PremiumClient.mo | tar -x -C "$PREV_SRC"
MOC="$(dfx +"$DFX_VERSION" cache show)/moc"
# shellcheck disable=SC2046
"$MOC" $(mops sources) "$PREV_SRC/src/sneed_lock/main.mo" -o "$OUT/sneed_lock_v2a.wasm" 2>&1 | grep -i "error" | head -5 || true
rm -rf "$PREV_SRC"
test -s "$OUT/sneed_lock_v2a.wasm"

# backend, sms and forum as production ran them from April to October 2026 ("persistent actors",
# enhanced orthogonal persistence), for the tests that rehearse upgrading production from there
LIVE_COMMIT=92eefd18
echo "== app_sneeddao_backend, sneed_sms, sneed_sns_forum at $LIVE_COMMIT (moc, EOP)"
LIVE_SRC="$(mktemp -d)"
git archive "$LIVE_COMMIT" src | tar -x -C "$LIVE_SRC"
for c in app_sneeddao_backend sneed_sms sneed_sns_forum; do
  # shellcheck disable=SC2046
  "$MOC" $(mops sources) --enhanced-orthogonal-persistence "$LIVE_SRC/src/$c/main.mo" -o "$OUT/${c}_april.wasm" 2>&1 | grep -i "error" | head -5 || true
  test -s "$OUT/${c}_april.wasm"
done
rm -rf "$LIVE_SRC"

echo "== sneed_guardian (dfx +$DFX_VERSION build --check: no canister id yet)"
dfx +"$DFX_VERSION" build --check sneed_guardian 2>&1 | grep -iv "warning\|^ *$\|^\s*[0-9]* |\|^  \^\|Nat$\|bespoke" | tail -2
cp .dfx/local/canisters/sneed_guardian/sneed_guardian.wasm "$OUT/sneed_guardian.wasm"
cp .dfx/local/canisters/sneed_guardian/service.did.js "$OUT/sneed_guardian.did.js"

# every other canister under test: a check build with the release toolchain (no canister id needed)
for c in app_sneeddao_backend sneedapp sneed_sns_forum sneed_sms sneed_premium rll sneed_pad sneed_icp_staking_bot sneed_trading_bot sneed_pid_names sneed_neuron_names sneed_pid_nicknames sneed_neuron_nicknames sneed_avatars sneed_profiles mr_sneed sneed_notifications; do
  echo "== $c (dfx +$DFX_VERSION build --check)"
  dfx +"$DFX_VERSION" build --check "$c" 2>&1 | grep -iv "warning\|^ *$\|^\s*[0-9]* |\|^  \^\|Nat$\|bespoke\|does not cover\|#Err\|#Ok" | tail -1
  cp ".dfx/local/canisters/$c/$c.wasm" "$OUT/$c.wasm"
  cp ".dfx/local/canisters/$c/service.did.js" "$OUT/$c.did.js"
done

echo "== sneedex (dfx +$DFX_VERSION build --network ic)"
dfx +"$DFX_VERSION" build --network ic sneedex 2>&1 | grep -iv "warning\|^ *$\|^\s*[0-9]* |\|^  \^\|Nat$\|bespoke" | tail -2
cp .dfx/ic/canisters/sneedex/sneedex.wasm "$OUT/sneedex.wasm"
cp .dfx/ic/canisters/sneedex/service.did.js "$OUT/sneedex.did.js"

MOC="$(dfx +"$DFX_VERSION" cache show)/moc"
PKGS="$(mops sources)"

# sneedex before per-asset settlement tracking (it marked offers Claimed/Reclaimed even when a
# hand-over failed), for the test that upgrades from it and recovers such an offer
SNEEDEX_PREV_COMMIT=aa73d9c2
echo "== sneedex at $SNEEDEX_PREV_COMMIT (moc, for the settlement upgrade test)"
PREV_SRC="$(mktemp -d)"
git archive "$SNEEDEX_PREV_COMMIT" src/sneedex src/PremiumClient.mo src/IngressGuard.mo | tar -x -C "$PREV_SRC"
# shellcheck disable=SC2086
"$MOC" $PKGS "$PREV_SRC/src/sneedex/main.mo" -o "$OUT/sneedex_prev.wasm" 2>&1 | grep -i "error" | head -5 || true
rm -rf "$PREV_SRC"
test -s "$OUT/sneedex_prev.wasm"

# sneedex before the ICRC-3 log, for the test that upgrades from it and starts an empty log
SNEEDEX_PRE_ICRC3_COMMIT=b483932c
echo "== sneedex at $SNEEDEX_PRE_ICRC3_COMMIT (moc, for the ICRC-3 upgrade test)"
PREV_SRC="$(mktemp -d)"
git archive "$SNEEDEX_PRE_ICRC3_COMMIT" src/sneedex src/PremiumClient.mo src/IngressGuard.mo | tar -x -C "$PREV_SRC"
# shellcheck disable=SC2086
"$MOC" $PKGS "$PREV_SRC/src/sneedex/main.mo" -o "$OUT/sneedex_preicrc3.wasm" 2>&1 | grep -i "error" | head -5 || true
rm -rf "$PREV_SRC"
test -s "$OUT/sneedex_preicrc3.wasm"

# sneedex as production runs it (ICRC-3 log, no EXT assets; wasm c20305b8), for the test that
# upgrades from it to EXT NFT assets
SNEEDEX_PROD_COMMIT=0775f9ac
echo "== sneedex at $SNEEDEX_PROD_COMMIT (moc, for the EXT upgrade test)"
PREV_SRC="$(mktemp -d)"
git archive "$SNEEDEX_PROD_COMMIT" src/sneedex src/PremiumClient.mo src/IngressGuard.mo src/icrc3 | tar -x -C "$PREV_SRC"
# shellcheck disable=SC2086
"$MOC" $PKGS "$PREV_SRC/src/sneedex/main.mo" -o "$OUT/sneedex_prod.wasm" 2>&1 | grep -i "error" | head -5 || true
rm -rf "$PREV_SRC"
test -s "$OUT/sneedex_prod.wasm"

# sneedapp from before the user wallet (bookmarks in the legacy userRegistrations map) and as it was
# before the 2026-10-20 fixes (legacy staking bots filed under "icp-staking-bot"), for the tests that
# upgrade from them
for pair in 0532de6d:prewallet e6e01c4e:prev; do
  commit="${pair%%:*}"; tag="${pair##*:}"
  echo "== sneedapp at $commit (moc, for the upgrade tests)"
  PREV_SRC="$(mktemp -d)"
  git archive "$commit" src | tar -x -C "$PREV_SRC"
  # shellcheck disable=SC2086
  "$MOC" $PKGS "$PREV_SRC/src/sneedapp/main.mo" -o "$OUT/sneedapp_$tag.wasm" 2>&1 | grep -i "error" | head -5 || true
  rm -rf "$PREV_SRC"
  test -s "$OUT/sneedapp_$tag.wasm"
done
# sneed_pid_names as production runs it (ICRC-7 NFT avatars only), for the test that upgrades
# from it to EXT avatars (enhanced orthogonal persistence, as dfx.json builds it)
PID_NAMES_PROD_COMMIT=75cef0a7
echo "== sneed_pid_names at $PID_NAMES_PROD_COMMIT (moc, EOP, for the upgrade test)"
PREV_SRC="$(mktemp -d)"
git archive "$PID_NAMES_PROD_COMMIT" src | tar -x -C "$PREV_SRC"
# shellcheck disable=SC2086
"$MOC" $PKGS --enhanced-orthogonal-persistence "$PREV_SRC/src/sneed_pid_names/main.mo" -o "$OUT/sneed_pid_names_prod.wasm" 2>&1 | grep -i "error" | head -5 || true
rm -rf "$PREV_SRC"
test -s "$OUT/sneed_pid_names_prod.wasm"
for c in MockLedger MockLedgerV2 MockLedgerFaulty MockRejectLedger MockSwapPool MockDexPool MockIcpswapFactory MockKongSwap \
         MockSnsGovernance MockSnsNeurons MockHubSns MockForumGovernance MockForumSnsW MockRllGovernance MockNnsGovernance \
         MockCmc MockSnsWasm MockPremium MockSneedApp MockIcpSwapList MockIcpSwapTokenList MockNamesModerator MockIcpLedger MockMrSneedGov MockNotifySender MockExt Icrc3Demo; do
  echo "== $c"
  # shellcheck disable=SC2086
  "$MOC" -c $PKGS -o "$OUT/$c.wasm" "$HERE/canisters/$c.mo" 2>&1 | grep -i "error" -A5 || true
  test -s "$OUT/$c.wasm"
done
# the archive actor class on its own, as a DAO proposal would upgrade it
echo "== icrc7_demo"
"$MOC" -c $PKGS -o "$OUT/Icrc7Demo.wasm" "$ROOT/src/icrc7_demo/main.mo" 2>&1 | grep -i "error" -A5 || true
test -s "$OUT/Icrc7Demo.wasm"
echo "== ledger suite wasms (from the SNS wasm canister, needs network; skipped when present)"
if [ ! -s "$OUT/ledger.wasm.gz" ] || [ ! -s "$OUT/index.wasm.gz" ]; then
  node --import "$HERE/lib/loader-register.mjs" "$HERE/lib/fetch-ledger-suite.mjs" "$OUT" || echo "   (could not fetch; sneed_pad tests will be skipped)"
fi
echo "== Icrc3Archive"
# shellcheck disable=SC2086
"$MOC" -c $PKGS -o "$OUT/Icrc3Archive.wasm" "$ROOT/src/icrc3/Archive.mo" 2>&1 | grep -i "error" -A5 || true
test -s "$OUT/Icrc3Archive.wasm"
echo "== done: $(ls "$OUT" | tr '\n' ' ')"
