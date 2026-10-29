#!/bin/bash
# Runs INSIDE the Sneed release build container (tools/verifier/Containerfile); started by tools/release-build.sh,
# never by hand. The source tree is mounted at /home/snassy/app_sneeddao (the working directory).
#
#   inner-build.sh fetch    <canister|frontend|frontend-dist>   dependencies only (the one phase with general network)
#   inner-build.sh build    <canister>                          dfx 0.28.0 build --network ic, sha256 raw + gzip -n -9
#   inner-build.sh build    frontend-dist                       dfx 0.31.0 build of the frontend's dist/ (no network)
#   inner-build.sh build    frontend                            dfx 0.31.0 deploy --compute-evidence
#                                                               (anonymous; reads the live asset canister, uploads nothing)
# The last line of a build is "SNEED_RESULT <json>".
set -euo pipefail
phase=${1:?phase}; target=${2:?target}
GZIP_OVER=${GZIP_OVER:-2000000}   # raw wasms above this many bytes ship gzipped (proposal size limit)

use_dfx() { export PATH="/opt/dfx/$1:$PATH"; dfx --version >&2; }
json_str() { printf '"%s"' "$(printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g')"; }

case "$target" in frontend|frontend-dist) kind=frontend ;; *) kind=motoko ;; esac

if [ "$phase" = fetch ]; then
  mkdir -p /cache/npm /cache/xdg
  if [ "$kind" = motoko ]; then
    mops install >&2
  else
    # The frontend's prebuild runs `dfx generate`, which compiles every Motoko canister: it needs the mops packages too.
    mops install >&2
    # The root package-lock.json is committed (it covers the frontend workspace) so this resolves exactly.
    npm ci --legacy-peer-deps --no-audit --no-fund >&2
  fi
  exit 0
fi

[ "$phase" = build ] || { echo "unknown phase $phase" >&2; exit 2; }

if [ "$kind" = motoko ]; then
  use_dfx 0.28.0
  dfx build --network ic --identity anonymous "$target" >&2
  wasm=".dfx/ic/canisters/$target/$target.wasm"
  [ -f "$wasm" ] || { echo "no wasm at $wasm" >&2; exit 1; }
  gzip -n -9 -c "$wasm" > "$wasm.gz"
  raw_sha=$(sha256sum "$wasm" | cut -d' ' -f1); raw_bytes=$(stat -c %s "$wasm")
  gz_sha=$(sha256sum "$wasm.gz" | cut -d' ' -f1); gz_bytes=$(stat -c %s "$wasm.gz")
  if [ "$raw_bytes" -gt "$GZIP_OVER" ]; then rel=gz; rel_sha=$gz_sha; rel_file="$wasm.gz"; else rel=raw; rel_sha=$raw_sha; rel_file="$wasm"; fi
  echo "SNEED_RESULT {\"mode\":\"motoko\",\"canister\":$(json_str "$target"),\"dfx\":\"0.28.0\",\"raw_sha256\":\"$raw_sha\",\"raw_bytes\":$raw_bytes,\"gz_sha256\":\"$gz_sha\",\"gz_bytes\":$gz_bytes,\"release\":\"$rel\",\"release_sha256\":\"$rel_sha\",\"release_file\":$(json_str "$rel_file")}"
  exit 0
fi

use_dfx 0.31.0
if [ "$target" = frontend-dist ]; then
  dfx build --network ic --identity anonymous app_sneeddao_frontend >&2
  dist=src/app_sneeddao_frontend/dist
  [ -d "$dist" ] || { echo "no $dist" >&2; exit 1; }
  # one hash over the sorted per-file hashes, so two builds can be compared at a glance
  tree=$(cd "$dist" && find . -type f -print0 | LC_ALL=C sort -z | xargs -0 sha256sum | sha256sum | cut -d' ' -f1)
  files=$(find "$dist" -type f | wc -l)
  echo "SNEED_RESULT {\"mode\":\"frontend-dist\",\"dfx\":\"0.31.0\",\"dist\":\"$dist\",\"files\":$files,\"tree_sha256\":\"$tree\"}"
  exit 0
fi

log=/tmp/evidence.log
dfx deploy --network ic --identity anonymous app_sneeddao_frontend --compute-evidence 2>&1 | tee "$log" >&2
# dfx prints the evidence alone on the line after "Computing evidence ..."
evidence=$(grep -oE '^[0-9a-f]{64}$' "$log" | tail -1 || true)
[ -n "$evidence" ] || { echo "no evidence in the dfx output" >&2; exit 1; }
echo "SNEED_RESULT {\"mode\":\"frontend\",\"dfx\":\"0.31.0\",\"evidence\":\"$evidence\"}"
