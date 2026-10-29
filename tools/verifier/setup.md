# Sneed proposal verifier and release build

A service without AI that checks new Sneed DAO upgrade proposals. Every 15 minutes it lists new proposals on
Sneed governance (`fi3zi-fyaaa-aaaaq-aachq-cai`). For each `UpgradeSnsControlledCanister` and each GNSF 7000
frontend release, it rebuilds the code from source in a container. It then posts the result in the proposal's thread
in the Sneed forum (`mcigm-4aaaa-aaaad-qhlkq-cai`): reproduced ✅, mismatch ❌ with both hashes, or cannot verify
⚠️ with the reason.

| File | What |
|---|---|
| `tools/release-build.sh` | **The** release build. Releases and the verifier both use it, so they cannot diverge. |
| `tools/verifier/Containerfile` | The release build environment: node 24.17.0 / npm 11.13.0, dfx 0.28.0 and 0.31.0 (sha256-checked), mops 2.14.1. |
| `tools/verifier/inner-build.sh` | Runs inside the container: `mops install`/`npm ci`, then the build. |
| `tools/verifier/verify.mjs` | The poller: proposals, git mirror, build, compare, post (or `--dry-run`). |
| `tools/verifier/lib.mjs` | Pure parts: Verify block, summary fallback, judging, post text, state (tested in `test/canisters/tests/proposal-verifier.test.js`). |
| `tools/verifier/systemd/` | User service and timer. |

## Release builds (anyone, any checkout path)

```bash
tools/release-build.sh --build-image sneed_sns_forum      # first time: builds the image too
tools/release-build.sh --commit <sha> sneed_sns_forum --out /tmp/forum.wasm.gz
tools/release-build.sh frontend                           # evidence of a pending batch (anonymous, read-only)
tools/release-build.sh frontend-dist --out /tmp/dist      # the frontend's dist/ only
```

It exports the commit with `git archive`, so uncommitted changes never reach a release. It builds in rootless podman
and prints the raw and `gzip -n -9` sha256, plus which one to propose: gzip above 2,000,000 bytes. The last line is
`SNEED_RESULT {json}`.

**Path independence.** moc records absolute source paths in the wasm, so a host build's hash depends on where the
checkout is. The container always mounts the exported tree at `/home/snassy/app_sneeddao`, the path every release
so far was built at. Builds from any host path (worktrees, the VPS, a voter's laptop) give today's hashes. Checked:
#472's wasm (`724db9c3…`) came out byte-identical from this worktree and from a clone in another directory.
We kept that path rather than switching to `/build`, because `/build` would change every hash from the next
release on. Old proposals would then only verify with an old path. If the path ever changes, the first release built
with the new path gets a new hash for unchanged code. Say so in that proposal.

**Sandbox.** Rootless podman, `--read-only` root, `--cap-drop=all`, `no-new-privileges`, and limits on memory
(default 6g, `SNEED_BUILD_MEMORY`), CPUs (2, `SNEED_BUILD_CPUS`) and pids (4096). Only these are mounted:
- the exported tree (rw)
- `~/.cache/sneed-release-build/cache` for npm and mops downloads (rw)
- the in-container script (ro)

dfx gets a throwaway identity in a 16 MB tmpfs, and every call is anonymous. No key, token or host home is
visible. Dependencies are fetched in a first container with network. The Motoko and `frontend-dist` builds then run
with `--network none`. `frontend` evidence needs the network, because dfx reads the live asset canister.

## What the verifier checks

- **Upgrades.** It takes the wasm sha256 from governance's rendering of the proposal (`SHA256 \`…\``), rebuilds the
  canister, and compares both the gzipped and the raw hash.
- **Frontend releases (GNSF 7000).** It reads `{ batch_id; evidence }` from the payload.
  - While the proposal is **open**, it recomputes the evidence with `dfx deploy --compute-evidence`
    against the live canister.
  - Once the proposal has **executed**, recomputing is impossible: dfx computes evidence against the canister's
    content *before* the batch, and that state is gone. The verifier then checks instead that the canister serves
    exactly the rebuilt `dist/`. That holds only until a later frontend release executes; after that it says
    "cannot verify".
  - The poller runs every 15 minutes, and voting takes days, so new frontend proposals are checked while still open.
- **Source.** It reads the source from the summary's **Verify line**:
  ```
  Verify: repo=https://github.com/Snassy-icp/app_sneeddao commit=<full sha> canister=<dfx name> dfx=0.28.0 build=dfx-build
  Verify: repo=https://github.com/Snassy-icp/app_sneeddao commit=<full sha> canister=app_sneeddao_frontend dfx=0.31.0 build=frontend-batch
  ```
  `~/.config/mr-sneed/tools/encode_upgrade.cjs` and `encode_commit_batch.cjs … commit` append it. They use
  `verify_line.cjs` for this. `VERIFY_COMMIT` defaults to the main checkout's HEAD and is refused if that tree is
  dirty. `VERIFY=0` turns it off.
  - Older summaries are parsed as a fallback: "commit e8ac353c", "commit **44382a91**", "dfx 0.28.0", the
    repo URL, and the canister name from `canister_ids.json`.
  - Only allow-listed repos are built (`SNEED_VERIFIER_REPOS`, default the Sneed repo).

## What the forum requires to post

From `src/sneed_sns_forum` and prod's live settings, checked 2026-10-29:
- **A non-anonymous principal.** That is the only identity requirement: no neuron, no Sneed Premium, no minimum
  balance.
- **The proposal's thread.** `get_proposal_thread(fp274-iaaaa-aaaaq-aacha-cai, id)` returns it. It is `null` until
  someone opens the proposal in Sneed Hub, and it was `null` for #472 and #473. The verifier then calls
  `create_proposal_thread_with_auto_setup` (also non-anonymous only), then `create_post(thread, null, null, body)`.
- **Post length.** At most `post_body_max_length` = **4,000** characters on prod (`get_text_limits`); premium
  members get 50,000. Posts are capped at 4,000.
- **Rate limits.** 10 posts and 10 threads in a row, then 4 posts and 2 threads a minute. That is ample.
- The thread must exist and not be deleted. The ingress guard refuses oversized args.

## VPS setup (Ubuntu 24.04, user snassy)

**Owner (sudo, once):**

```bash
sudo apt install -y podman uidmap slirp4netns
sudo loginctl enable-linger snassy        # user timers run without an open login session
grep snassy /etc/subuid /etc/subgid       # rootless podman needs subordinate ids (Ubuntu adds them for new users;
# if missing: sudo usermod --add-subuids 100000-165535 --add-subgids 100000-165535 snassy)
```

**Then, as snassy:**

```bash
# 1. A dedicated checkout of main, so a branch checked out in ~/app_sneeddao never changes the verifier's code.
git clone https://github.com/Snassy-icp/app_sneeddao ~/sneed-verifier
cd ~/sneed-verifier && npm ci --legacy-peer-deps --ignore-scripts   # @dfinity/agent etc. for verify.mjs

# 2. The build image (about 1.4 GB; a few minutes).
tools/release-build.sh --build-image sneed_pid_nicknames   # builds the image, then a small canister as a smoke test

# 3. The "Sneed Verifier" identity: a plaintext PEM readable only by snassy. It only posts in the forum and holds no funds.
dfx identity new sneed_verifier --storage-mode plaintext
dfx identity get-principal --identity sneed_verifier       # name it "Sneed Verifier" in Sneed Hub (Sneed names)
mkdir -p ~/.config/sneed-verifier && chmod 700 ~/.config/sneed-verifier
printf 'SNEED_VERIFIER_PEM=%s\n' ~/.config/dfx/identity/sneed_verifier/identity.pem > ~/.config/sneed-verifier/env

# 4. A dry run on real proposals: prints the posts, posts nothing, changes no state.
node tools/verifier/verify.mjs --dry-run --proposal 472 --proposal 473

# 5. The units.
mkdir -p ~/.config/systemd/user
cp tools/verifier/systemd/sneed-verifier.{service,timer} ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now sneed-verifier.timer
systemctl --user start sneed-verifier.service && journalctl --user -u sneed-verifier -n 50   # first run: records the newest id only
```

The first real run only records the newest proposal id, so it posts nothing about old proposals. To announce a
proposal by hand, run `node tools/verifier/verify.mjs --proposal N`; without `--dry-run` that posts.

State is kept in `~/.local/state/sneed-verifier/state.json` (`last_seen`, `done`, `retry`). Builds and git mirrors
live in `~/.cache/sneed-verifier`, and the npm/mops cache in `~/.cache/sneed-release-build`.

To update the verifier, run `cd ~/sneed-verifier && git pull --ff-only && npm ci --legacy-peer-deps --ignore-scripts`.
Run `tools/release-build.sh --build-image …` too when the Containerfile changed.

Notes:
- On a host without a systemd user bus (WSL, plain `su`), `release-build.sh` passes `--cgroup-manager=cgroupfs`
  itself.
- Clean up with `podman container prune -f` and `podman image prune -f`. `--rm` already removes each build
  container.
- The summaries of #473 and #476 tell voters to run `dfx deploy … --by-proposal --compute-evidence`. dfx 0.31.0 refuses
  that ("'--by-proposal' cannot be used with '--compute-evidence'"). The right command is
  `dfx deploy --network ic app_sneeddao_frontend --compute-evidence`, or simply `tools/release-build.sh frontend`.
- `mops.lock` is not committed, so `mops install` resolves the dependency tree again on each build. It is pinned by
  exact versions in `mops.toml` and in the packages' own manifests, so the result is stable today. Committing
  `mops.lock` would make it explicit.
