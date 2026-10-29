// Pure parts of the Sneed proposal verifier: reading what a proposal claims, the "Verify:" block, the result
// post, and the state file. No network, no files, no @dfinity imports (tested in
// test/canisters/tests/proposal-verifier.test.js).

export const UPGRADE_ACTION = 3n;      // UpgradeSnsControlledCanister
export const FRONTEND_FUNCTION = 7000n; // GNSF 7000: commit_proposed_batch on the Sneed Hub frontend
export const DEFAULT_REPO = 'https://github.com/Snassy-icp/app_sneeddao';
export const FORUM_POST_MAX = 4000;     // prod forum post_body_max_length (get_text_limits)

const HEX64 = /^[0-9a-f]{64}$/;

/** Normalises a repo URL for comparison: lower-case host/path, no trailing .git or slash. */
export function normRepo(url) {
  return String(url || '').trim().replace(/\.git$/i, '').replace(/\/+$/, '').toLowerCase();
}

/**
 * The machine-readable block, one line anywhere in the summary (backticks allowed):
 *   Verify: repo=https://github.com/Snassy-icp/app_sneeddao commit=<sha> canister=<dfx name> dfx=0.28.0 build=dfx-build
 *   Verify: repo=… commit=<sha> canister=app_sneeddao_frontend dfx=0.31.0 build=frontend-batch
 * Returns the key/value pairs of the first such line, or null.
 */
export function parseVerifyBlock(summary) {
  for (const raw of String(summary || '').split('\n')) {
    const line = raw.trim().replace(/^[`>*\-\s]+|[`\s]+$/g, '');
    const m = /^Verify:\s+(.*)$/i.exec(line);
    if (!m) continue;
    const out = {};
    for (const tok of m[1].split(/\s+/)) {
      const kv = /^([a-z_]+)=(\S+)$/i.exec(tok.replace(/`/g, ''));
      if (kv) out[kv[1].toLowerCase()] = kv[2];
    }
    if (Object.keys(out).length) return out;
  }
  return null;
}

/** Formats a Verify line (used by the proposal encoders' summaries and documented in setup.md). */
export function formatVerifyBlock({ repo = DEFAULT_REPO, commit, canister, dfx, build }) {
  return `Verify: repo=${repo} commit=${commit} canister=${canister} dfx=${dfx} build=${build}`;
}

/** Fallback for summaries written before the Verify block: "commit e8ac353c", "from commit **44382a91**". */
export function parseSummaryFallback(summary) {
  const s = String(summary || '');
  const commit = /\bcommit\s+[`*]*([0-9a-f]{7,40})\b/i.exec(s)?.[1]?.toLowerCase() ?? null;
  const dfx = /\bdfx\s+(?:\+)?(\d+\.\d+\.\d+)\b/i.exec(s)?.[1] ?? null;
  const repo = /(https:\/\/github\.com\/[\w.-]+\/[\w.-]+?)(?:\.git)?(?=[\s)`*,.]|$)/i.exec(s)?.[1] ?? null;
  const hashes = [...s.matchAll(/\b([0-9a-f]{64})\b/gi)].map((m) => m[1].toLowerCase());
  return { commit, dfx, repo, hashes };
}

/** The wasm sha256 that SNS governance renders for an UpgradeSnsControlledCanister ("SHA256 `…`"). */
export function wasmHashFromRendering(rendering) {
  const m = /SHA256\s+`?([0-9a-f]{64})`?/i.exec(String(rendering || ''));
  return m ? m[1].toLowerCase() : null;
}

/**
 * What a proposal asks to verify, from the decoded proposal. Input (plain values, no Candid types):
 *   { id, actionId, title, summary, url, rendering, upgrade: { canisterId, wasmSha256 } | null,
 *     gnsf: { functionId, batchId, evidence } | null }
 * `names` maps ic canister ids to dfx canister names (canister_ids.json).
 * Returns { kind: 'motoko'|'frontend', ... } or { kind: 'skip' } or { kind: 'cannot', reason }.
 */
export function planVerification(p, names = {}) {
  const block = parseVerifyBlock(p.summary);
  const fb = parseSummaryFallback(p.summary);
  const repo = block?.repo || fb.repo || p.url || null;
  const commit = (block?.commit || fb.commit || '').toLowerCase() || null;
  const source = block ? 'verify-block' : 'summary';
  const base = { id: p.id, title: p.title, repo, commit, source };

  if (p.actionId === UPGRADE_ACTION && p.upgrade) {
    const canister = block?.canister || names[p.upgrade.canisterId] || null;
    const plan = { ...base, kind: 'motoko', canisterId: p.upgrade.canisterId, canister,
      dfx: block?.dfx || fb.dfx || null, expected: p.upgrade.wasmSha256, build: block?.build || 'dfx-build' };
    if (block?.canister && names[p.upgrade.canisterId] && block.canister !== names[p.upgrade.canisterId]) {
      return { ...plan, kind: 'cannot', reason: `the Verify block names canister ${block.canister}, but the proposal upgrades ${p.upgrade.canisterId} (${names[p.upgrade.canisterId]})` };
    }
    return checkPlan(plan, '0.28.0');
  }
  if (p.actionId === FRONTEND_FUNCTION && p.gnsf) {
    const plan = { ...base, kind: 'frontend', canister: 'app_sneeddao_frontend', dfx: block?.dfx || fb.dfx || null,
      batchId: p.gnsf.batchId, expected: p.gnsf.evidence, build: block?.build || 'frontend-batch' };
    return checkPlan(plan, '0.31.0');
  }
  return { ...base, kind: 'skip' };
}

function checkPlan(plan, supportedDfx) {
  const cannot = (reason) => ({ ...plan, kind: 'cannot', reason });
  if (!plan.expected || !HEX64.test(plan.expected)) return cannot('the proposal carries no readable sha256');
  if (!plan.commit) return cannot('the summary names no commit (add a "Verify:" line)');
  if (!plan.canister) return cannot(`canister ${plan.canisterId} is not in canister_ids.json and the summary does not name it`);
  if (!plan.repo) return cannot('the summary names no repository');
  if (plan.dfx && plan.dfx !== supportedDfx) return cannot(`the summary says dfx ${plan.dfx}; the release build environment builds ${plan.kind === 'motoko' ? 'Motoko canisters' : 'the frontend'} with dfx ${supportedDfx} only`);
  const want = plan.kind === 'motoko' ? 'dfx-build' : 'frontend-batch';
  if (plan.build !== want) return cannot(`unknown build "${plan.build}" for this proposal type (expected ${want})`);
  return plan;
}

/**
 * Compares a build result (tools/release-build.sh's SNEED_RESULT) with the plan.
 * Returns { status: 'ok'|'mismatch'|'cannot', ... } for formatResult.
 */
export function judge(plan, build) {
  if (plan.kind === 'motoko') {
    const got = [build.gz_sha256, build.raw_sha256].filter(Boolean);
    const which = plan.expected === build.gz_sha256 ? 'gzip -n -9' : plan.expected === build.raw_sha256 ? 'raw' : null;
    return { status: which ? 'ok' : 'mismatch', matched: which, expected: plan.expected, got, build };
  }
  if (build.mode === 'frontend') {
    return { status: build.evidence === plan.expected ? 'ok' : 'mismatch', expected: plan.expected, got: [build.evidence], build };
  }
  if (build.mode === 'frontend-served') {
    // proposal already executed: the batch is gone, but the canister must now serve exactly this build
    return { status: build.served_match ? 'ok' : 'mismatch', expected: plan.expected, got: [], build, served: true };
  }
  return { status: 'cannot', reason: `unexpected build result ${build.mode}` };
}

const short = (h) => (h ? `${h.slice(0, 8)}…${h.slice(-4)}` : '?');

/** The forum post (Markdown, at most FORUM_POST_MAX chars). */
export function formatResult(plan, verdict, meta = {}) {
  const head = verdict.status === 'ok' ? 'Reproduced ✅' : verdict.status === 'mismatch' ? 'Mismatch ❌' : 'Cannot verify ⚠️';
  const L = [`**Sneed Verifier: ${head}**`, ''];
  const what = plan.kind === 'frontend'
    ? `Proposal #${plan.id}: frontend release, batch ${plan.batchId ?? '?'} on pxtkg-giaaa-aaaal-ajjzq-cai.`
    : plan.kind === 'motoko' || plan.canisterId
      ? `Proposal #${plan.id}: upgrade of ${plan.canister ?? '?'} (${plan.canisterId ?? '?'}).`
      : `Proposal #${plan.id}.`;
  L.push(what);
  if (plan.commit) L.push(`Source: commit \`${meta.fullCommit || plan.commit}\` of ${plan.repo} (read from the ${plan.source === 'verify-block' ? 'Verify block' : 'summary'}).`);
  L.push('');
  if (verdict.status === 'cannot') {
    L.push(`Not checked: ${verdict.reason}`);
  } else if (plan.kind === 'motoko') {
    L.push(`- Proposal wasm sha256: \`${verdict.expected}\``);
    L.push(`- Rebuilt, gzip -n -9: \`${verdict.build.gz_sha256}\`${verdict.matched === 'gzip -n -9' ? ' (match)' : ''}`);
    L.push(`- Rebuilt, raw: \`${verdict.build.raw_sha256}\`${verdict.matched === 'raw' ? ' (match)' : ''}`);
    if (verdict.status === 'mismatch') L.push('', 'Neither rebuilt hash matches the wasm in the proposal. The wasm was not built from this commit with this toolchain, or the build is not reproducible.');
  } else if (verdict.served) {
    L.push(`- Proposal evidence: \`${verdict.expected}\``);
    L.push(`- The proposal had already executed, so its batch evidence can no longer be recomputed (dfx computes it against the canister's content before the batch). Checked instead: the asset canister serves ${verdict.build.served_match ? 'exactly' : 'NOT'} this build (${verdict.build.files} files${verdict.build.served_diff ? `; ${verdict.build.served_diff}` : ''}).`);
  } else {
    L.push(`- Proposal evidence: \`${verdict.expected}\``);
    L.push(`- Rebuilt evidence: \`${verdict.got[0]}\``);
    if (verdict.status === 'mismatch') L.push('', 'The evidence differs: the batch does not contain exactly this commit\'s build (or the canister changed since the batch was proposed).');
  }
  L.push('');
  const how = plan.kind === 'frontend' ? (verdict.served ? 'frontend-dist' : 'frontend') : plan.canister;
  L.push(`How: \`tools/release-build.sh --commit ${(meta.fullCommit || plan.commit || '').slice(0, 12)} ${how}\` in the Sneed release build container${meta.image ? ` (image ${short(meta.image)})` : ''}. Anyone can run the same.`);
  L.push('', '_Automated check by the Sneed Verifier, no AI involved. It shows whether the proposal matches the source; it does not review what the code does._');
  let body = L.join('\n');
  if (body.length > FORUM_POST_MAX) body = body.slice(0, FORUM_POST_MAX - 1) + '…';
  return body;
}

// ---- state ----

export const MAX_ATTEMPTS = 3;

export function emptyState() { return { version: 1, last_seen: null, done: {}, retry: {} }; }

/** Accepts anything read from the state file; returns a well-formed state. */
export function loadState(json) {
  const s = emptyState();
  if (!json || typeof json !== 'object') return s;
  if (json.last_seen != null && /^\d+$/.test(String(json.last_seen))) s.last_seen = String(json.last_seen);
  if (json.done && typeof json.done === 'object') s.done = { ...json.done };
  if (json.retry && typeof json.retry === 'object') s.retry = { ...json.retry };
  return s;
}

/**
 * Which proposal ids to look at, given the ids of proposals of interest just listed (newest first or any order).
 * First run (no last_seen): nothing old is processed, last_seen becomes the newest id. Retries come first.
 */
export function selectWork(state, ids) {
  const all = ids.map((x) => BigInt(x)).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const newest = all.length ? all[all.length - 1] : null;
  if (state.last_seen == null) return { work: Object.keys(state.retry), newest };
  const last = BigInt(state.last_seen);
  const fresh = all.filter((id) => id > last && !state.done[String(id)]).map(String);
  const work = [...new Set([...Object.keys(state.retry), ...fresh])];
  return { work, newest };
}

/**
 * Records the outcome for one proposal. A 'transient' outcome (network, image missing, build crashed) is retried
 * up to MAX_ATTEMPTS runs; everything else is final.
 */
export function recordOutcome(state, id, outcome, now = new Date().toISOString()) {
  const key = String(id);
  const s = { ...state, done: { ...state.done }, retry: { ...state.retry } };
  if (outcome.transient) {
    const attempts = (s.retry[key]?.attempts ?? 0) + 1;
    if (attempts < MAX_ATTEMPTS) {
      s.retry[key] = { attempts, last_error: outcome.reason, at: now };
      return s;
    }
  }
  delete s.retry[key];
  s.done[key] = { status: outcome.status, posted: !!outcome.posted, at: now };
  return s;
}

export function advance(state, newest) {
  if (newest == null) return state;
  const cur = state.last_seen == null ? -1n : BigInt(state.last_seen);
  return BigInt(newest) > cur ? { ...state, last_seen: String(newest) } : state;
}
