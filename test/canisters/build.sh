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

# sneed_lock as production runs it (proposal #451; `dfx +0.28.0 build --network ic sneed_lock` of this
# code at /home/snassy/app_sneeddao gives the production module hash f5919527…), before the support
# fixes of spec/support_audit.md P1-9/12/14: for their fail-before runs
# (SNEED_LOCK_WASM=sneed_lock_preaudit) and the upgrade test from production
LOCK_PREAUDIT_COMMIT=c860d472
echo "== sneed_lock at $LOCK_PREAUDIT_COMMIT (moc, sneed_lock_preaudit)"
PREV_SRC="$(mktemp -d)"
git archive "$LOCK_PREAUDIT_COMMIT" src | tar -x -C "$PREV_SRC"
# shellcheck disable=SC2046
"$MOC" $(mops sources) "$PREV_SRC/src/sneed_lock/main.mo" -o "$OUT/sneed_lock_preaudit.wasm" 2>&1 | grep -i "error" | head -5 || true
rm -rf "$PREV_SRC"
test -s "$OUT/sneed_lock_preaudit.wasm"

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
for c in app_sneeddao_backend sneedapp sneed_sns_forum sneed_sms sneed_premium rll sneed_pad sneed_icp_staking_bot sneed_trading_bot sneed_pid_names sneed_neuron_names sneed_pid_nicknames sneed_neuron_nicknames sneed_avatars sneed_profiles mr_sneed sneed_notifications sneed_mon sneed_proxy; do
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

# sneedex before the 2026-10-21 support fixes (stake caching and escrow writing back a stale offer,
# adminReclaimStuckTokens without a state guard), for the fail-before runs of
# sneedex-support.test.js (SNEEDEX_WASM=sneedex_prefix); and as production runs it now (EXT assets,
# no special prices; proposal #442), for the upgrade test there; and before the support-audit fixes
# (aab11a93, what production runs since #449, wasm 2cd4eb78), for the fail-before runs and the
# upgrade test of sneedex-support-audit.test.js (SNEEDEX_WASM=sneedex_preaudit)
for pair in 9415d517:prefix ab7da0ad:prod442 aab11a93:preaudit; do
  commit="${pair%%:*}"; tag="${pair##*:}"
  echo "== sneedex at $commit (moc, sneedex_$tag)"
  PREV_SRC="$(mktemp -d)"
  git archive "$commit" src | tar -x -C "$PREV_SRC"
  # shellcheck disable=SC2086
  "$MOC" $PKGS "$PREV_SRC/src/sneedex/main.mo" -o "$OUT/sneedex_$tag.wasm" 2>&1 | grep -i "error" | head -5 || true
  rm -rf "$PREV_SRC"
  test -s "$OUT/sneedex_$tag.wasm"
done

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
# sneed_premium and sneedapp before the support-audit self-service fixes (spec/support_audit.md P1-9,
# P1-12, P2-17): src/sneed_premium and src/sneedapp at d20ab1bf are what production runs (premium
# #452, a17b23d2…, source d4eed88c; sneedapp #450, f0121a0f…, source c860d472; unchanged since), for
# the fail-before runs of premium-support.test.js / sneedapp-support.test.js
# (PREMIUM_WASM=sneed_premium_preaudit, SNEEDAPP_WASM=sneedapp_preaudit) and their upgrade tests
SUPPORT_PREAUDIT_COMMIT=d20ab1bf
echo "== sneed_premium, sneedapp at $SUPPORT_PREAUDIT_COMMIT (moc, *_preaudit)"
PREV_SRC="$(mktemp -d)"
git archive "$SUPPORT_PREAUDIT_COMMIT" src | tar -x -C "$PREV_SRC"
for c in sneed_premium sneedapp; do
  # shellcheck disable=SC2086
  "$MOC" $PKGS "$PREV_SRC/src/$c/main.mo" -o "$OUT/${c}_preaudit.wasm" 2>&1 | grep -i "error" | head -5 || true
  test -s "$OUT/${c}_preaudit.wasm"
done
rm -rf "$PREV_SRC"
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
# sneed_pid_names as production runs it now (proposal #441, EXT avatars): `dfx +0.28.0 build --network
# ic sneed_pid_names` of commit 2a989d5d at /home/snassy/app_sneeddao gives the live module hash
# 6653ee81… (checked 2026-10-23). Here built with moc from the same source (same code, other hash), for
# the hotkey-paging upgrade test (naming-paging-rate-limits.test.js) with keep
PID_NAMES_441_COMMIT=2a989d5d
echo "== sneed_pid_names at $PID_NAMES_441_COMMIT (moc, EOP, sneed_pid_names_441)"
PREV_SRC="$(mktemp -d)"
git archive "$PID_NAMES_441_COMMIT" src | tar -x -C "$PREV_SRC"
# shellcheck disable=SC2086
"$MOC" $PKGS --enhanced-orthogonal-persistence "$PREV_SRC/src/sneed_pid_names/main.mo" -o "$OUT/sneed_pid_names_441.wasm" 2>&1 | grep -i "error" | head -5 || true
rm -rf "$PREV_SRC"
test -s "$OUT/sneed_pid_names_441.wasm"
# sneed_pid_nicknames as production runs it (`dfx +0.28.0 build --network ic sneed_pid_nicknames` of
# this code at /home/snassy/app_sneeddao gives the live module hash 1d48a9e5…), for the test that
# upgrades from it with keep to account nicknames and pockets (EOP, as dfx.json builds it)
NICK_PROD_COMMIT=25b88246
echo "== sneed_pid_nicknames at $NICK_PROD_COMMIT (moc, EOP, for the account-nicknames upgrade test)"
PREV_SRC="$(mktemp -d)"
git archive "$NICK_PROD_COMMIT" src | tar -x -C "$PREV_SRC"
# shellcheck disable=SC2086
"$MOC" $PKGS --enhanced-orthogonal-persistence "$PREV_SRC/src/sneed_pid_nicknames/main.mo" -o "$OUT/sneed_pid_nicknames_prod.wasm" 2>&1 | grep -i "error" | head -5 || true
rm -rf "$PREV_SRC"
test -s "$OUT/sneed_pid_nicknames_prod.wasm"
# sneed_sns_forum as production and staging run it (upgrade proposal #423: tips checked on the ledger,
# no ICRC-3 log; `dfx build --network ic sneed_sns_forum` of this code gives their module hash
# 89d0f0e7…), for the test that upgrades from it and starts an empty log (enhanced orthogonal
# persistence, as dfx.json builds it)
FORUM_PROD_COMMIT=b483932c
echo "== sneed_sns_forum at $FORUM_PROD_COMMIT (moc, EOP, for the ICRC-3 upgrade test)"
PREV_SRC="$(mktemp -d)"
git archive "$FORUM_PROD_COMMIT" src | tar -x -C "$PREV_SRC"
# shellcheck disable=SC2086
"$MOC" $PKGS --enhanced-orthogonal-persistence "$PREV_SRC/src/sneed_sns_forum/main.mo" -o "$OUT/sneed_sns_forum_prod.wasm" 2>&1 | grep -i "error" | head -5 || true
rm -rf "$PREV_SRC"
test -s "$OUT/sneed_sns_forum_prod.wasm"
# sneed_sms as production runs it (preview clipped at 100 characters, no ICRC-3 log;
# `dfx build --network ic sneed_sms` of this code gives the production module hash de51e8a5…), for
# the fail-before run of the preview fix (SMS_WASM=sneed_sms_prod) and the test that upgrades from
# it with keep and starts an empty log (enhanced orthogonal persistence, as dfx.json builds it)
SMS_PROD_COMMIT=e832eeac
echo "== sneed_sms at $SMS_PROD_COMMIT (moc, EOP, for the ICRC-3 upgrade test)"
PREV_SRC="$(mktemp -d)"
git archive "$SMS_PROD_COMMIT" src | tar -x -C "$PREV_SRC"
# shellcheck disable=SC2086
"$MOC" $PKGS --enhanced-orthogonal-persistence "$PREV_SRC/src/sneed_sms/main.mo" -o "$OUT/sneed_sms_prod.wasm" 2>&1 | grep -i "error" | head -5 || true
rm -rf "$PREV_SRC"
test -s "$OUT/sneed_sms_prod.wasm"
# sneed_sms as production runs it since the ICRC-3 log (`dfx +0.28.0 build --network ic sneed_sms` of
# this code at /home/snassy/app_sneeddao gives the production module hash b1356256…), for the test
# that upgrades from it with keep to the build with the incremental reads (sms-incremental.test.js)
SMS_LIVE_COMMIT=11416b2e
echo "== sneed_sms at $SMS_LIVE_COMMIT (moc, EOP, for the incremental-reads upgrade test)"
PREV_SRC="$(mktemp -d)"
git archive "$SMS_LIVE_COMMIT" src | tar -x -C "$PREV_SRC"
# shellcheck disable=SC2086
"$MOC" $PKGS --enhanced-orthogonal-persistence "$PREV_SRC/src/sneed_sms/main.mo" -o "$OUT/sneed_sms_live.wasm" 2>&1 | grep -i "error" | head -5 || true
rm -rf "$PREV_SRC"
test -s "$OUT/sneed_sms_live.wasm"
# sneed_sns_forum and sneed_sms before the paging fixes and rate limits (spec/paging_audit.md S3-S5 and
# the forum's per-user items): their source at 1788bfee (HEAD then; src/sneed_sns_forum unchanged since
# 1d5cd986, what production runs; src/sneed_sms with the undeployed paged inbox reads of 2a0164bc). For
# the fail-before runs (FORUM_WASM=sneed_sns_forum_prepaging, SMS_WASM=sneed_sms_prepaging) and the
# upgrades with keep; the *_seed builds (this source and the current one) add a test-only method
# (canisters/forum_seed_posts.mo.part) that writes many posts at once, for the large-forum tests
FS_PREPAGING_COMMIT=1788bfee
echo "== sneed_sns_forum, sneed_sms at $FS_PREPAGING_COMMIT (moc, EOP, *_prepaging) and the forum seed builds"
PREV_SRC="$(mktemp -d)"
git archive "$FS_PREPAGING_COMMIT" src | tar -x -C "$PREV_SRC"
for c in sneed_sns_forum sneed_sms; do
  # shellcheck disable=SC2086
  "$MOC" $PKGS --enhanced-orthogonal-persistence "$PREV_SRC/src/$c/main.mo" -o "$OUT/${c}_prepaging.wasm" 2>&1 | grep -i "error" | head -5 || true
  test -s "$OUT/${c}_prepaging.wasm"
done
SEED_SRC="$(mktemp -d)"
tar -C "$ROOT" --exclude=src/app_sneeddao_frontend --exclude=src/declarations -cf - src | tar -x -C "$SEED_SRC" # the current source, without the frontend
for pair in "$PREV_SRC:sneed_sns_forum_prepaging_seed" "$SEED_SRC:sneed_sns_forum_seed"; do
  dir="${pair%%:*}"; out="${pair##*:}"
  SEED_MAIN="$dir/src/sneed_sns_forum/main.mo"
  sed -i 's/^        #verify_tip : Any;$/        #verify_tip : Any;\n        #test_seed_posts : Any;/' "$SEED_MAIN"
  grep -q '#test_seed_posts : Any;' "$SEED_MAIN"
  sed -i '$ d' "$SEED_MAIN" # the actor's closing brace
  { cat "$HERE/canisters/forum_seed_posts.mo.part"; echo "};"; } >> "$SEED_MAIN"
  # shellcheck disable=SC2086
  "$MOC" $PKGS --enhanced-orthogonal-persistence "$SEED_MAIN" -o "$OUT/$out.wasm" 2>&1 | grep -i "error" -A5 | head -10 || true
  test -s "$OUT/$out.wasm"
done
rm -rf "$PREV_SRC" "$SEED_SRC"
# sneed_sns_forum as production runs it since proposal #469 (per-user paged reads, rate limits; the
# source of d1784166, unchanged since), for the fail-before runs of the forum bug pass
# (FORUM_WASM=sneed_sns_forum_p469) and the upgrade test of reactions, thread tips and thread votes;
# its .most is what `moc --stable-compatible` checks the current build against
FORUM_P469_COMMIT=d1784166
echo "== sneed_sns_forum at $FORUM_P469_COMMIT (moc, EOP, sneed_sns_forum_p469)"
PREV_SRC="$(mktemp -d)"
git archive "$FORUM_P469_COMMIT" src | tar -x -C "$PREV_SRC"
# shellcheck disable=SC2086
"$MOC" $PKGS --enhanced-orthogonal-persistence --stable-types "$PREV_SRC/src/sneed_sns_forum/main.mo" -o "$OUT/sneed_sns_forum_p469.wasm" 2>&1 | grep -i "error" | head -5 || true
rm -rf "$PREV_SRC"
test -s "$OUT/sneed_sns_forum_p469.wasm"
# sneed_mon as staging runs it (step 1, app "Sneed Hub", SNS watches only), for the test that
# upgrades from it (enhanced orthogonal persistence, as dfx.json builds it)
MON_STAGING_COMMIT=1bbee49a
echo "== sneed_mon at $MON_STAGING_COMMIT (moc, EOP, for the upgrade test)"
PREV_SRC="$(mktemp -d)"
git archive "$MON_STAGING_COMMIT" src | tar -x -C "$PREV_SRC"
# shellcheck disable=SC2086
"$MOC" $PKGS --enhanced-orthogonal-persistence "$PREV_SRC/src/sneed_mon/main.mo" -o "$OUT/sneed_mon_1bbee49a.wasm" 2>&1 | grep -i "error" | head -5 || true
rm -rf "$PREV_SRC"
test -s "$OUT/sneed_mon_1bbee49a.wasm"
# sneed_notifications as production and staging run it (bootstrap admin, no revenue forwarding;
# `dfx build --network ic sneed_notifications` of this code at /home/snassy/app_sneeddao gives their
# module hash 59e473d5…), for the test that upgrades from it and measures the fee backlog
# (enhanced orthogonal persistence, as dfx.json builds it)
NOTIF_PROD_COMMIT=e9fc4804
echo "== sneed_notifications at $NOTIF_PROD_COMMIT (moc, EOP, for the fee-forwarding upgrade test)"
PREV_SRC="$(mktemp -d)"
git archive "$NOTIF_PROD_COMMIT" src | tar -x -C "$PREV_SRC"
# shellcheck disable=SC2086
"$MOC" $PKGS --enhanced-orthogonal-persistence "$PREV_SRC/src/sneed_notifications/main.mo" -o "$OUT/sneed_notifications_prod.wasm" 2>&1 | grep -i "error" | head -5 || true
rm -rf "$PREV_SRC"
test -s "$OUT/sneed_notifications_prod.wasm"
# rll as production runs it (no ICRC-3 log; `dfx build --network ic rll` of this code gives the
# production module hash 2d7e3f23…; src/sneed_rewards unchanged from 25b88246 to 75cef0a7), for
# the test that upgrades from it and starts an empty log (classic persistence, as dfx.json builds it)
RLL_PROD_COMMIT=75cef0a7
echo "== rll at $RLL_PROD_COMMIT (moc, for the ICRC-3 upgrade test)"
PREV_SRC="$(mktemp -d)"
git archive "$RLL_PROD_COMMIT" src/sneed_rewards src/IngressGuard.mo | tar -x -C "$PREV_SRC"
# shellcheck disable=SC2086
"$MOC" $PKGS "$PREV_SRC/src/sneed_rewards/main.mo" -o "$OUT/rll_prod.wasm" 2>&1 | grep -i "error" | head -5 || true
rm -rf "$PREV_SRC"
test -s "$OUT/rll_prod.wasm"
# the same production source plus a test-only method that seeds a large synthetic event history
# (canisters/rll_seed_events.mo.part), for the event-statistics tests: the old full-scan
# get_event_statistics over a production-sized history, then the upgrade that rebuilds counters
echo "== rll at $RLL_PROD_COMMIT + test_seed_events (moc, test only)"
PREV_SRC="$(mktemp -d)"
git archive "$RLL_PROD_COMMIT" src/sneed_rewards src/IngressGuard.mo | tar -x -C "$PREV_SRC"
SEED_MAIN="$PREV_SRC/src/sneed_rewards/main.mo"
sed -i 's/^    #get_api_doc : Any;$/    #get_api_doc : Any;\n    #test_seed_events : Any;/' "$SEED_MAIN"
grep -q '#test_seed_events : Any;' "$SEED_MAIN"
sed -i '$ d' "$SEED_MAIN" # the actor's closing brace
{ cat "$HERE/canisters/rll_seed_events.mo.part"; echo "};"; } >> "$SEED_MAIN"
# shellcheck disable=SC2086
"$MOC" $PKGS "$SEED_MAIN" -o "$OUT/rll_prod_seed.wasm" 2>&1 | grep -i "error" -A5 | head -10 || true
rm -rf "$PREV_SRC"
test -s "$OUT/rll_prod_seed.wasm"
# rll with the ICRC-3 log (commit 2d6abe89, upgrade proposal #443), for the test that upgrades
# from it to the event-statistics counters
RLL_ICRC3_COMMIT=2d6abe89
echo "== rll at $RLL_ICRC3_COMMIT (moc, for the event-statistics upgrade test)"
PREV_SRC="$(mktemp -d)"
git archive "$RLL_ICRC3_COMMIT" src/sneed_rewards src/IngressGuard.mo src/icrc3 | tar -x -C "$PREV_SRC"
# shellcheck disable=SC2086
"$MOC" $PKGS "$PREV_SRC/src/sneed_rewards/main.mo" -o "$OUT/rll_icrc3.wasm" 2>&1 | grep -i "error" | head -5 || true
rm -rf "$PREV_SRC"
test -s "$OUT/rll_icrc3.wasm"
# rll as production runs it now (commit ea66c7eb, event-statistics counters; `dfx +0.28.0 build
# --network ic rll` of this code gives the production module hash c5e52913…), before the paging
# fixes of spec/paging_audit.md (U1, U2, S1, S2): rll_prepaging for the fail-before runs
# (RLL_WASM=rll_prepaging) and the upgrade test from production; rll_prepaging_seed adds the
# test-only seeding methods (canisters/rll_seed_events.mo.part, canisters/rll_seed_votes.mo.part)
RLL_PREPAGING_COMMIT=ea66c7eb
echo "== rll at $RLL_PREPAGING_COMMIT (moc, rll_prepaging and rll_prepaging_seed)"
PREV_SRC="$(mktemp -d)"
git archive "$RLL_PREPAGING_COMMIT" src/sneed_rewards src/IngressGuard.mo src/icrc3 | tar -x -C "$PREV_SRC"
# shellcheck disable=SC2086
"$MOC" $PKGS "$PREV_SRC/src/sneed_rewards/main.mo" -o "$OUT/rll_prepaging.wasm" 2>&1 | grep -i "error" | head -5 || true
SEED_MAIN="$PREV_SRC/src/sneed_rewards/main.mo"
sed -i 's/^    #get_api_doc : Any;$/    #get_api_doc : Any;\n    #test_seed_events : Any;\n    #test_seed_neurons : Any;\n    #test_seed_proposals : Any;/' "$SEED_MAIN"
grep -q '#test_seed_proposals : Any;' "$SEED_MAIN"
sed -i '$ d' "$SEED_MAIN" # the actor's closing brace
{ cat "$HERE/canisters/rll_seed_events.mo.part" "$HERE/canisters/rll_seed_votes.mo.part"; echo "};"; } >> "$SEED_MAIN"
# shellcheck disable=SC2086
"$MOC" $PKGS "$SEED_MAIN" -o "$OUT/rll_prepaging_seed.wasm" 2>&1 | grep -i "error" -A5 | head -10 || true
rm -rf "$PREV_SRC"
test -s "$OUT/rll_prepaging.wasm"
test -s "$OUT/rll_prepaging_seed.wasm"
# sneed_premium as production and staging run it (no ICRC-3 log; `dfx build --network ic
# sneed_premium` of this code gives their module hash 1c403b42…; src/sneed_premium unchanged
# from 25b88246 until the log), for the test that upgrades from it and starts an empty log
# (classic persistence, as dfx.json builds it)
PREMIUM_PROD_COMMIT=25b88246
echo "== sneed_premium at $PREMIUM_PROD_COMMIT (moc, for the ICRC-3 upgrade test)"
PREV_SRC="$(mktemp -d)"
git archive "$PREMIUM_PROD_COMMIT" src/sneed_premium src/IngressGuard.mo | tar -x -C "$PREV_SRC"
# shellcheck disable=SC2086
"$MOC" $PKGS "$PREV_SRC/src/sneed_premium/main.mo" -o "$OUT/sneed_premium_prod.wasm" 2>&1 | grep -i "error" | head -5 || true
rm -rf "$PREV_SRC"
test -s "$OUT/sneed_premium_prod.wasm"
# sneedapp as production and staging run it (no ICRC-3 log; `dfx build --network ic sneedapp` of
# this code gives their module hash 96f4f055…; src/sneedapp unchanged from 25b88246 until the log),
# for the test that upgrades from it and starts an empty log (classic persistence, as dfx.json builds it)
SNEEDAPP_PROD_COMMIT=25b88246
echo "== sneedapp at $SNEEDAPP_PROD_COMMIT (moc, for the ICRC-3 upgrade test)"
PREV_SRC="$(mktemp -d)"
git archive "$SNEEDAPP_PROD_COMMIT" src | tar -x -C "$PREV_SRC"
# shellcheck disable=SC2086
"$MOC" $PKGS "$PREV_SRC/src/sneedapp/main.mo" -o "$OUT/sneedapp_prod.wasm" 2>&1 | grep -i "error" | head -5 || true
rm -rf "$PREV_SRC"
test -s "$OUT/sneedapp_prod.wasm"
# every charging canister as of f9d8db0b, before special prices (spec/special_prices.md): for
# sneedex, sneedapp, sneed_lock, sneed_premium and app_sneeddao_backend this source is what
# production runs (`dfx build --network ic` of it at /home/snassy/app_sneeddao gives the live
# module hashes f789d6dd…, dac5cd66…, ea866993…, ba260de0…, 41826a2e…); sneed_pad, sneed_guardian
# and sneed_mon are on staging only. For the tests that upgrade from it (and that run the
# special-price tests against it to see them fail). EOP for backend and sneed_mon, as dfx.json builds them.
PRESP_COMMIT=f9d8db0b
echo "== charging canisters at $PRESP_COMMIT (moc, for the special-prices upgrade tests)"
PREV_SRC="$(mktemp -d)"
git archive "$PRESP_COMMIT" src | tar -x -C "$PREV_SRC"
for c in sneedex sneedapp sneed_lock sneed_premium sneed_pad sneed_guardian app_sneeddao_backend sneed_mon; do
  EOP=""; case "$c" in app_sneeddao_backend|sneed_mon) EOP="--enhanced-orthogonal-persistence" ;; esac
  # shellcheck disable=SC2086
  "$MOC" $PKGS $EOP "$PREV_SRC/src/$c/main.mo" -o "$OUT/${c}_presp.wasm" 2>&1 | grep -i "error" | head -5 || true
  test -s "$OUT/${c}_presp.wasm"
done
rm -rf "$PREV_SRC"
# app_sneeddao_backend as production runs it since proposal #453 (special prices, no ICRC-3 log;
# `dfx +0.28.0 build --network ic app_sneeddao_backend` of this code gives the production module
# hash 91d76948…), for the fail-before run of the log tests (BACKEND_WASM=app_sneeddao_backend_prod)
# and the test that upgrades from it with keep and starts an empty log (EOP, as dfx.json builds it)
BACKEND_PROD_COMMIT=cd8d6d3e
echo "== app_sneeddao_backend at $BACKEND_PROD_COMMIT (moc, EOP, for the ICRC-3 upgrade test)"
PREV_SRC="$(mktemp -d)"
git archive "$BACKEND_PROD_COMMIT" src | tar -x -C "$PREV_SRC"
# shellcheck disable=SC2086
"$MOC" $PKGS --enhanced-orthogonal-persistence "$PREV_SRC/src/app_sneeddao_backend/main.mo" -o "$OUT/app_sneeddao_backend_prod.wasm" 2>&1 | grep -i "error" | head -5 || true
rm -rf "$PREV_SRC"
test -s "$OUT/app_sneeddao_backend_prod.wasm"
# sneed_mon before auto top-up (ICRC-2 pulls from the user's wallet), for the test that upgrades
# from it (and that runs the auto top-up tests against it to see them fail)
MON_PRE_ATU_COMMIT=6cfabb63
echo "== sneed_mon at $MON_PRE_ATU_COMMIT (moc, EOP, for the auto top-up upgrade test)"
PREV_SRC="$(mktemp -d)"
git archive "$MON_PRE_ATU_COMMIT" src | tar -x -C "$PREV_SRC"
# shellcheck disable=SC2086
"$MOC" $PKGS --enhanced-orthogonal-persistence "$PREV_SRC/src/sneed_mon/main.mo" -o "$OUT/sneed_mon_preatu.wasm" 2>&1 | grep -i "error" | head -5 || true
rm -rf "$PREV_SRC"
test -s "$OUT/sneed_mon_preatu.wasm"
# sneed_notifications and sneed_mon before their ICRC-3 logs: sneed_notifications as production and
# staging run it (#448, fee forwarding; `dfx +0.28.0 build --network ic sneed_notifications` of this code
# at /home/snassy/app_sneeddao gives their module hash 7dae6ac1…), sneed_mon as staging runs it (`dfx
# +0.28.0 build --network staging sneed_mon` gives ab310a51…). For the fail-before runs of the log tests
# (NOTIF_WASM=sneed_notifications_preicrc3, MON_WASM=sneed_mon_preicrc3) and the upgrades with keep
PREICRC3_COMMIT=5f62b7d5
echo "== sneed_notifications, sneed_mon at $PREICRC3_COMMIT (moc, EOP, for the ICRC-3 upgrade tests)"
PREV_SRC="$(mktemp -d)"
git archive "$PREICRC3_COMMIT" src | tar -x -C "$PREV_SRC"
for c in sneed_notifications sneed_mon; do
  # shellcheck disable=SC2086
  "$MOC" $PKGS --enhanced-orthogonal-persistence "$PREV_SRC/src/$c/main.mo" -o "$OUT/${c}_preicrc3.wasm" 2>&1 | grep -i "error" | head -5 || true
  test -s "$OUT/${c}_preicrc3.wasm"
done
rm -rf "$PREV_SRC"
for c in MockLedger MockLedgerV2 MockLedgerFaulty MockRejectLedger MockSwapPool MockDexPool MockIcpswapFactory MockKongSwap \
         MockSnsGovernance MockSnsNeurons MockHubSns MockForumGovernance MockForumSnsW MockRllGovernance MockNnsGovernance \
         MockCmc MockSnsWasm MockPremium MockSneedApp MockIcpSwapList MockIcpSwapTokenList MockNamesModerator MockIcpLedger MockMrSneedGov MockNotifySender MockExt MockMonSns MockMonNns MockProxyGov MockProxyTarget MockCkBtcMinter MockCkEthMinter Icrc3Demo; do
  echo "== $c"
  # shellcheck disable=SC2086
  "$MOC" -c $PKGS -o "$OUT/$c.wasm" "$HERE/canisters/$c.mo" 2>&1 | grep -i "error" -A5 || true
  test -s "$OUT/$c.wasm"
done
# the naming canisters, sneed_notifications, sneed_premium, sneed_pad and sneed_guardian before the
# paging and rate-limit fixes (spec/paging_audit.md S12-S14, premium): their source at 1788bfee (HEAD
# then). premium, notifications (ic) and pad, guardian (staging) run exactly this (`dfx +0.28.0 build`
# of it at /home/snassy/app_sneeddao gives 506fde4b…, 7c32ae81…, c7839ee6…, bca9a14e…). For the
# fail-before runs (PID_NAMES_WASM=sneed_pid_names_prepaging etc.) and the upgrades with keep
NAMES_PREPAGING_COMMIT=1788bfee
echo "== naming, notifications, premium, pad, guardian at $NAMES_PREPAGING_COMMIT (moc, *_prepaging)"
PREV_SRC="$(mktemp -d)"
git archive "$NAMES_PREPAGING_COMMIT" src | tar -x -C "$PREV_SRC"
for c in sneed_pid_names sneed_neuron_names sneed_pid_nicknames sneed_neuron_nicknames sneed_avatars sneed_profiles sneed_notifications sneed_premium sneed_pad sneed_guardian; do
  case "$c" in sneed_premium|sneed_pad|sneed_guardian) EOP="" ;; *) EOP="--enhanced-orthogonal-persistence" ;; esac
  # shellcheck disable=SC2086
  "$MOC" $PKGS $EOP "$PREV_SRC/src/$c/main.mo" -o "$OUT/${c}_prepaging.wasm" 2>&1 | grep -i "error" | head -5 || true
  test -s "$OUT/${c}_prepaging.wasm"
done
rm -rf "$PREV_SRC"
# app_sneeddao_backend and sneed_notifications before the support-audit fixes (spec/support_audit.md
# P0-7, P0-8, P1-9, P2-19): their source at d20ab1bf is what production runs (`dfx +0.28.0 build
# --network ic` of it at /home/snassy/app_sneeddao gives the module hashes 3d2a5468… and e78123ff…),
# for the fail-before runs of backend-support.test.js / notifications-support.test.js
# (BACKEND_WASM=app_sneeddao_backend_preaudit, NOTIF_WASM=sneed_notifications_preaudit) and their
# upgrades with keep (EOP, as dfx.json builds them); and an SMS stand-in whose answer does not decode
HUB_PREAUDIT_COMMIT=d20ab1bf
echo "== app_sneeddao_backend, sneed_notifications at $HUB_PREAUDIT_COMMIT (moc, EOP, *_preaudit)"
PREV_SRC="$(mktemp -d)"
git archive "$HUB_PREAUDIT_COMMIT" src | tar -x -C "$PREV_SRC"
for c in app_sneeddao_backend sneed_notifications; do
  # shellcheck disable=SC2086
  "$MOC" $PKGS --enhanced-orthogonal-persistence "$PREV_SRC/src/$c/main.mo" -o "$OUT/${c}_preaudit.wasm" 2>&1 | grep -i "error" | head -5 || true
  test -s "$OUT/${c}_preaudit.wasm"
done
rm -rf "$PREV_SRC"
echo "== MockSmsBadReply"
# shellcheck disable=SC2086
"$MOC" -c $PKGS -o "$OUT/MockSmsBadReply.wasm" "$HERE/canisters/MockSmsBadReply.mo" 2>&1 | grep -i "error" -A5 || true
test -s "$OUT/MockSmsBadReply.wasm"
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
# sneedex and sneed_lock before the paging fixes and rate limits (spec/paging_audit.md S6, S7, S15):
# their source at 36ca7f48 (unchanged to 1788bfee), what proposals #461 (sneed_lock) and #462
# (sneedex) install. For the fail-before runs (SNEEDEX_WASM=sneedex_prepaging,
# SNEED_LOCK_WASM=sneed_lock_prepaging) and the upgrade tests from it (classic persistence)
DEX_LOCK_PREPAGING_COMMIT=36ca7f48
echo "== sneedex, sneed_lock at $DEX_LOCK_PREPAGING_COMMIT (moc, *_prepaging)"
PREV_SRC="$(mktemp -d)"
git archive "$DEX_LOCK_PREPAGING_COMMIT" src | tar -x -C "$PREV_SRC"
for c in sneedex sneed_lock; do
  # shellcheck disable=SC2086
  "$MOC" $PKGS "$PREV_SRC/src/$c/main.mo" -o "$OUT/${c}_prepaging.wasm" 2>&1 | grep -i "error" | head -5 || true
  test -s "$OUT/${c}_prepaging.wasm"
done
rm -rf "$PREV_SRC"
# sneedex before DAO settings (dao_set / validate_dao_set / dao_settings, spec/dao_settings.md): its
# source at 4066b698 (HEAD then), for the fail-before run of sneedex-dao-settings.test.js
# (SNEEDEX_WASM=sneedex_predaoset) and the upgrade test from it (classic persistence)
SNEEDEX_PREDAOSET_COMMIT=4066b698
echo "== sneedex at $SNEEDEX_PREDAOSET_COMMIT (moc, sneedex_predaoset)"
PREV_SRC="$(mktemp -d)"
git archive "$SNEEDEX_PREDAOSET_COMMIT" src | tar -x -C "$PREV_SRC"
# shellcheck disable=SC2086
"$MOC" $PKGS "$PREV_SRC/src/sneedex/main.mo" -o "$OUT/sneedex_predaoset.wasm" 2>&1 | grep -i "error" | head -5 || true
rm -rf "$PREV_SRC"
test -s "$OUT/sneedex_predaoset.wasm"
# the trading and staking bots before the paging fixes (spec/paging_audit.md S8-S11, bot items): their
# source at 2a0164bc (unchanged to 1788bfee; the unpublished trading bot 0.9.4 / staking bot 0.9.5), for
# the fail-before runs of bots-paging.test.js (BOTS_BUILD=prepaging); and test builds of that source and
# of the current one with test-only seeding methods (canisters/*_bot_seed.mo.part): *_prepaging_seed,
# *_seed. The published versions the upgrade tests start from are the wasms in releases/.
BOTS_PREPAGING_COMMIT=2a0164bc
echo "== sneed_trading_bot, sneed_icp_staking_bot at $BOTS_PREPAGING_COMMIT and now (+ test seeding)"
for variant in prepaging current; do
  PREV_SRC="$(mktemp -d)"
  if [ "$variant" = prepaging ]; then git archive "$BOTS_PREPAGING_COMMIT" src | tar -x -C "$PREV_SRC"; sfx=_prepaging
  else mkdir -p "$PREV_SRC/src"; cp -r "$ROOT/src/sneed_bots" "$ROOT/src/IngressGuard.mo" "$PREV_SRC/src/"; sfx=""; fi
  for pair in sneed_trading_bot:trading:addCircuitBreakerRule sneed_icp_staking_bot:staking:addDistributionList; do
    IFS=: read -r c part anchor <<< "$pair"
    MAIN="$PREV_SRC/src/sneed_bots/$c/main.mo"
    if [ "$variant" = prepaging ]; then
      # shellcheck disable=SC2086
      "$MOC" $PKGS "$MAIN" -o "$OUT/${c}_prepaging.wasm" 2>&1 | grep -E "error \[M" -A5 | head -10 || true
      test -s "$OUT/${c}_prepaging.wasm"
    fi
    methods="$(grep -o 'public shared func test_[a-z_]*' "$HERE/canisters/${part}_bot_seed.mo.part" | sed 's/public shared func //')"
    for m in $methods; do sed -i "s/^      #$anchor : Any;$/      #$anchor : Any;\n      #$m : Any;/" "$MAIN"; done
    sed -i '1i import TestIC "mo:base/ExperimentalInternetComputer";' "$MAIN"
    sed -i '1i import TestCycles "mo:base/ExperimentalCycles";' "$MAIN"
    tac "$MAIN" | sed '0,/^};$/{/^};$/d}' | tac > "$MAIN.tmp" && mv "$MAIN.tmp" "$MAIN" # the actor's closing brace
    { cat "$HERE/canisters/${part}_bot_seed.mo.part"; echo "};"; } >> "$MAIN"
    # shellcheck disable=SC2086
    "$MOC" $PKGS "$MAIN" -o "$OUT/${c}${sfx}_seed.wasm" 2>&1 | grep -E "error \[M" -A5 | head -10 || true
    test -s "$OUT/${c}${sfx}_seed.wasm"
  done
  rm -rf "$PREV_SRC"
done
echo "== done: $(ls "$OUT" | tr '\n' ' ')"
