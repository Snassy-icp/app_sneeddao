#!/bin/bash
# The Sneed DAO release build: builds a committed source tree in the Sneed release build container, the same way
# for releases and for the proposal verifier (tools/verifier/verify.mjs calls this script), wherever the checkout
# is on the host.
#
#   tools/release-build.sh [options] <canister>       Motoko canister: dfx 0.28.0 build --network ic; prints the raw
#                                                     and gzip -n -9 sha256 and which one to propose (gzip above 2 MB)
#   tools/release-build.sh [options] frontend         frontend batch evidence: dfx 0.31.0
#                                                     deploy --compute-evidence, anonymous, against the live asset canister
#   tools/release-build.sh [options] frontend-dist    the frontend's dist/ only (no network during the build)
#
# Options:
#   --commit REV   commit to build (default HEAD). Only committed files are built: the tree is exported with
#                  `git archive`, so uncommitted changes never reach a release.
#   --repo DIR     git repository to export from (default: the one this script is in)
#   --work DIR     scratch directory (default ${XDG_CACHE_HOME:-~/.cache}/sneed-release-build)
#   --out PATH     copy the release artifact (wasm or wasm.gz) to this file; for frontend-dist, dist/ to this dir
#   --image NAME   container image (default sneed-release-build:1; build it with --build-image)
#   --build-image  build the image from tools/verifier/Containerfile first
#   --keep         keep the exported source tree afterwards
#
# Sandbox: rootless podman, read-only root filesystem, all capabilities dropped, no-new-privileges, memory/CPU/pid
# limits, nothing from the host mounted but the exported tree (read-write), a cache directory and the in-container
# script (read-only). No identity, key or token is mounted (dfx makes itself a throwaway "default" identity in a
# small tmpfs that disappears with the container; every call is anonymous anyway). Dependencies (mops, npm ci) are fetched in a first
# container with network; the Motoko and dist builds then run with --network none. Computing frontend evidence needs
# the network (it reads the live asset canister).
#
# The tree is always mounted at /home/snassy/app_sneeddao inside the container: moc records absolute source paths
# in the wasm, and that is the path every Sneed release so far was built at, so their hashes stay reproducible.
#
# Output: build logs on stderr; on stdout a summary and, last, "SNEED_RESULT <json>" (machine-readable).
set -euo pipefail

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
repo=$(cd "$here/.." && pwd); commit=HEAD; out=""; keep=0; build_image=0
image=${SNEED_BUILD_IMAGE:-sneed-release-build:1}
work=${SNEED_BUILD_WORK:-${XDG_CACHE_HOME:-$HOME/.cache}/sneed-release-build}
MEM=${SNEED_BUILD_MEMORY:-6g}; CPUS=${SNEED_BUILD_CPUS:-2}
IN_PATH=/home/snassy/app_sneeddao

target=""
while [ $# -gt 0 ]; do
  case "$1" in
    --commit) commit=$2; shift 2 ;;
    --repo) repo=$2; shift 2 ;;
    --work) work=$2; shift 2 ;;
    --out) out=$2; shift 2 ;;
    --image) image=$2; shift 2 ;;
    --build-image) build_image=1; shift ;;
    --keep) keep=1; shift ;;
    -h|--help) sed -n '2,32p' "$0"; exit 0 ;;
    -*) echo "unknown option $1" >&2; exit 2 ;;
    *) target=$1; shift ;;
  esac
done
[ -n "$target" ] || { echo "usage: $0 [options] <canister>|frontend|frontend-dist" >&2; exit 2; }
[[ "$target" =~ ^[a-z0-9_-]+$ ]] || { echo "bad target name: $target" >&2; exit 2; }

# Rootless podman without a systemd user session (WSL, plain ssh without lingering) needs the cgroupfs manager.
podman_g=()
if [ ! -S "${XDG_RUNTIME_DIR:-/nonexistent}/bus" ]; then podman_g=(--cgroup-manager=cgroupfs); fi
pm() { podman "${podman_g[@]}" "$@"; }

if [ "$build_image" = 1 ]; then pm build -t "$image" -f "$here/verifier/Containerfile" "$here/verifier" >&2; fi
pm image exists "$image" || { echo "image $image missing: run with --build-image" >&2; exit 1; }
image_id=$(pm image inspect --format '{{.Id}}' "$image")

sha=$(git -C "$repo" rev-parse --verify "${commit}^{commit}")
if [ "$commit" = HEAD ] && [ -n "$(git -C "$repo" status --porcelain --untracked-files=no 2>/dev/null)" ]; then
  echo "warning: $repo has uncommitted changes; building the committed HEAD $sha only" >&2
fi

mkdir -p "$work/cache"
# one build at a time per work dir (memory), e.g. a release while the verifier runs
exec 9>"$work/.lock"; flock 9
src="$work/src-${sha:0:12}-$target"
rm -rf "$src"; mkdir -p "$src"
git -C "$repo" archive --format=tar "$sha" | tar -x -C "$src"
cleanup() { [ "$keep" = 1 ] || rm -rf "$src"; }
trap cleanup EXIT

run() { # run <network> <args...>
  local net=$1; shift
  pm run --rm --read-only --network "$net" \
    --cap-drop=all --security-opt=no-new-privileges \
    --memory="$MEM" --memory-swap="$MEM" --cpus="$CPUS" --pids-limit=4096 \
    --tmpfs /opt/home/.config:rw,size=16m,mode=0700 \
    -v "$src:$IN_PATH:rw" -v "$work/cache:/cache:rw" -v "$here/verifier/inner-build.sh:/opt/sneed/inner-build.sh:ro" \
    -w "$IN_PATH" "$image" bash /opt/sneed/inner-build.sh "$@"
}

run slirp4netns fetch "$target" >&2
if [ "$target" = frontend ]; then net=slirp4netns; else net=none; fi
# (inner-build.sh logs to stderr; its stdout is only the result line. No `tee /dev/stderr`: when the caller's
# stderr is a socket, e.g. node's child_process, /dev/stderr cannot be opened.)
result=$(run "$net" build "$target" | grep '^SNEED_RESULT ' | tail -1 | sed 's/^SNEED_RESULT //')
[ -n "$result" ] || { echo "build produced no result" >&2; exit 1; }

if [ -n "$out" ]; then
  if [ "$target" = frontend-dist ]; then
    rm -rf "$out"; cp -r "$src/src/app_sneeddao_frontend/dist" "$out"; echo "dist: $out" >&2
  else
    rel=$(printf '%s' "$result" | sed -n 's/.*"release_file":"\([^"]*\)".*/\1/p')
    if [ -n "$rel" ]; then cp "$src/$rel" "$out"; echo "artifact: $out" >&2; fi
  fi
fi

echo "commit:  $sha"
echo "target:  $target"
echo "image:   $image ($image_id)"
printf '%s\n' "$result" | sed 's/[{}"]//g; s/,/\n/g' | sed 's/:/: /; s/^/  /'
echo "SNEED_RESULT {\"commit\":\"$sha\",\"target\":\"$target\",\"image\":\"$image_id\",\"build\":$result}"
