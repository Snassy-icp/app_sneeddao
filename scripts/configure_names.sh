#!/usr/bin/env bash
# Configure the naming service's canisters after their first deploy (spec/sneed_names.md §10):
# each points at the backend for moderation, at SNS-W, at Sneed governance and at Sneed Premium,
# and the backend learns which canisters may call names_moderate.
#
#   scripts/configure_names.sh staging            # or ic
#
# Runs as the current dfx identity, which must control the canisters (or be an admin of them)
# and be a backend admin. ARCHIVE_CONTROLLERS (space-separated principals) become co-controllers
# of the ICRC-3 archives; on ic it defaults to the Sneed SNS root.
set -euo pipefail
NET="${1:?usage: configure_names.sh <staging|ic>}"
DFX="dfx +0.28.0"
id() { $DFX canister --network "$NET" id "$1"; }

BE=$(id app_sneeddao_backend)
PREMIUM=$(id sneed_premium)
PN=$(id sneed_pid_names); NN=$(id sneed_neuron_names)
PNK=$(id sneed_pid_nicknames); NNK=$(id sneed_neuron_nicknames)
AV=$(id sneed_avatars); PR=$(id sneed_profiles)
GOV=fi3zi-fyaaa-aaaaq-aachq-cai     # Sneed SNS governance (the *_by_dao methods)
SNSW=qaa6y-5yaaa-aaaaa-aaafa-cai    # SNS-W
if [ "$NET" = ic ]; then ARCHIVE_CONTROLLERS="${ARCHIVE_CONTROLLERS:-fp274-iaaaa-aaaaq-aacha-cai}"; else ARCHIVE_CONTROLLERS="${ARCHIVE_CONTROLLERS:-}"; fi
AC=""; for p in $ARCHIVE_CONTROLLERS; do AC="$AC principal \"$p\";"; done

call() { echo "== $1 $2"; $DFX canister --network "$NET" call "$1" "$2" "$3"; }

call "$PN" admin_set_config "(record { max_members = 50 : nat; max_hotkeys = 10 : nat; moderator = opt principal \"$BE\"; dao_governance = principal \"$GOV\"; sns_wasm = principal \"$SNSW\"; archive_controllers = vec {$AC} })"
call "$NN" admin_set_config "(record { moderator = opt principal \"$BE\"; dao_governance = principal \"$GOV\"; sns_wasm = principal \"$SNSW\"; archive_controllers = vec {$AC} })"
call "$PNK" admin_set_config "(record { max_free = 10 : nat; max_premium = 100 : nat; moderator = opt principal \"$BE\"; premium = opt principal \"$PREMIUM\" })"
call "$NNK" admin_set_config "(record { max_free = 10 : nat; max_premium = 100 : nat; moderator = opt principal \"$BE\"; premium = opt principal \"$PREMIUM\" })"
call "$AV" admin_set_config "(record { max_held = 20 : nat; max_held_premium = 200 : nat; premium = opt principal \"$PREMIUM\" })"
call "$PR" admin_set_config "(record { max_dapp_canisters = 10 : nat; moderator = opt principal \"$BE\"; dao_governance = principal \"$GOV\"; sns_wasm = principal \"$SNSW\"; archive_controllers = vec {$AC} })"
call "$BE" admin_set_names_canisters "(vec { principal \"$PN\"; principal \"$NN\"; principal \"$PNK\"; principal \"$NNK\"; principal \"$PR\" })"
echo "Configured. Next: freeze the backend's naming writes, run scripts/migrate_names.py --network $NET, then admin_finish_import on each canister."
