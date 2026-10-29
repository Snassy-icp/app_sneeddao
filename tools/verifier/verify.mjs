#!/usr/bin/env node
// Sneed proposal verifier (no AI): rebuilds the wasm or frontend batch of new Sneed DAO upgrade proposals with
// tools/release-build.sh (the release build container) and posts the result in the proposal's forum thread.
//
//   node tools/verifier/verify.mjs [--dry-run] [--proposal N]... [--state FILE] [--pem FILE] [--work DIR]
//
//   --dry-run       print what would be posted; never sign or post. The state file is not changed.
//   --proposal N    check these proposals now (any age), instead of polling for new ones
//   --state FILE    default $SNEED_VERIFIER_STATE or ~/.local/state/sneed-verifier/state.json
//   --pem FILE      the poster identity's PEM (default $SNEED_VERIFIER_PEM). Required unless --dry-run.
//   --work DIR      scratch for the git mirrors and builds (default ~/.cache/sneed-verifier)
//   --repo-allow U  repositories it will build (repeatable; default https://github.com/Snassy-icp/app_sneeddao)
//
// Polling: the first run only records the newest proposal id; after that each new UpgradeSnsControlledCanister and
// GNSF 7000 (frontend release) proposal is checked once. Transient failures are retried on the next runs.
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, renameSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative, sep, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import {
  UPGRADE_ACTION, FRONTEND_FUNCTION, DEFAULT_REPO, normRepo, planVerification, wasmHashFromRendering, judge,
  formatResult, loadState, selectWork, recordOutcome, advance, MAX_ATTEMPTS,
} from './lib.mjs';

const run = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '../..');
const GOVERNANCE = 'fi3zi-fyaaa-aaaaq-aachq-cai';
const SNS_ROOT = 'fp274-iaaaa-aaaaq-aacha-cai';
const FORUM = process.env.SNEED_VERIFIER_FORUM || 'mcigm-4aaaa-aaaad-qhlkq-cai';
const FRONTEND = 'pxtkg-giaaa-aaaal-ajjzq-cai';
const HOST = 'https://icp-api.io';

// @dfinity packages from the repo's node_modules (the main checkout's when run from a worktree without one)
const modulesRoot = [join(REPO_ROOT, 'node_modules'), '/home/snassy/app_sneeddao/node_modules'].find((d) => existsSync(join(d, '@dfinity/agent')));
if (!modulesRoot) { console.error('no node_modules with @dfinity/agent: run npm ci in the repo'); process.exit(2); }
const req = createRequire(join(modulesRoot, 'x.js'));
const { HttpAgent, Actor, SignIdentity } = req('@dfinity/agent');
const { Principal } = req('@dfinity/principal');
const { idlFactory: govIdl } = await import(join(REPO_ROOT, 'src/external/sns_governance/sns_governance.did.js'));

// ---- arguments ----
const argv = process.argv.slice(2);
const opt = { dryRun: false, proposals: [], allow: [] };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--dry-run') opt.dryRun = true;
  else if (a === '--proposal') opt.proposals.push(argv[++i]);
  else if (a === '--state') opt.state = argv[++i];
  else if (a === '--pem') opt.pem = argv[++i];
  else if (a === '--work') opt.work = argv[++i];
  else if (a === '--repo-allow') opt.allow.push(argv[++i]);
  else { console.error(`unknown argument ${a}`); process.exit(2); }
}
const statePath = opt.state || process.env.SNEED_VERIFIER_STATE || join(homedir(), '.local/state/sneed-verifier/state.json');
const work = opt.work || process.env.SNEED_VERIFIER_WORK || join(homedir(), '.cache/sneed-verifier');
const allowed = (opt.allow.length ? opt.allow : (process.env.SNEED_VERIFIER_REPOS || DEFAULT_REPO).split(',')).map(normRepo);
const pemPath = opt.pem || process.env.SNEED_VERIFIER_PEM;
if (!opt.dryRun && !pemPath) { console.error('--pem or SNEED_VERIFIER_PEM is required to post (or use --dry-run)'); process.exit(2); }

// ---- governance ----
const anon = await HttpAgent.create({ host: HOST });
const gov = Actor.createActor(govIdl, { agent: anon, canisterId: GOVERNANCE });

async function listInteresting(limit = 50) {
  const r = await gov.list_proposals({ limit, before_proposal: [], exclude_type: [], include_reward_status: [], include_status: [], include_topics: [] });
  return r.proposals.filter((p) => p.action === UPGRADE_ACTION || p.action === FRONTEND_FUNCTION).map((p) => p.id[0].id.toString());
}

async function getProposal(id) {
  const r = await gov.get_proposal({ proposal_id: [{ id: BigInt(id) }] });
  const res = r.result[0];
  if (!res || !('Proposal' in res)) throw Object.assign(new Error(`proposal ${id} not found`), { final: true });
  const p = res.Proposal; const d = p.proposal[0]; const a = d.action[0] || {};
  const out = {
    id: String(id), actionId: p.action, title: d.title, summary: d.summary, url: d.url,
    rendering: p.payload_text_rendering[0] || '',
    executed: p.executed_timestamp_seconds > 0n, failed: p.failed_timestamp_seconds > 0n,
    decided: p.decided_timestamp_seconds > 0n, upgrade: null, gnsf: null,
  };
  if (a.UpgradeSnsControlledCanister) {
    const u = a.UpgradeSnsControlledCanister;
    out.upgrade = { canisterId: u.canister_id[0]?.toText() ?? null, wasmSha256: wasmHashFromRendering(out.rendering) };
  }
  if (a.ExecuteGenericNervousSystemFunction) {
    const e = a.ExecuteGenericNervousSystemFunction;
    out.gnsf = { functionId: e.function_id };
    if (e.function_id === FRONTEND_FUNCTION) {
      const { IDL } = req('@dfinity/candid');
      try {
        const [c] = IDL.decode([IDL.Record({ batch_id: IDL.Nat, evidence: IDL.Vec(IDL.Nat8) })], Uint8Array.from(e.payload));
        Object.assign(out.gnsf, { batchId: c.batch_id.toString(), evidence: Buffer.from(c.evidence).toString('hex') });
      } catch { /* left without evidence: planVerification says it cannot read it */ }
    }
  }
  return out;
}

/** Whether a frontend release newer than `id` has executed (then the canister no longer serves `id`'s build). */
async function laterFrontendRelease(id) {
  const r = await gov.list_proposals({ limit: 100, before_proposal: [], exclude_type: [], include_reward_status: [], include_status: [], include_topics: [] });
  return r.proposals.some((p) => p.action === FRONTEND_FUNCTION && p.id[0].id > BigInt(id) && p.executed_timestamp_seconds > 0n);
}

function canisterNames() {
  const ids = JSON.parse(readFileSync(join(REPO_ROOT, 'canister_ids.json'), 'utf8'));
  const names = {};
  for (const [name, nets] of Object.entries(ids)) if (nets.ic) names[nets.ic] = name;
  return names;
}

// ---- source ----
async function git(...args) { return (await run('git', args, { maxBuffer: 1 << 26 })).stdout.trim(); }

/** A bare mirror of the repo per URL, fetched before each use; resolves a (short) commit to the full sha. */
async function mirrorFor(repoUrl, commit) {
  const dir = join(work, 'mirrors', normRepo(repoUrl).replace(/[^a-z0-9]+/g, '_'));
  if (!existsSync(dir)) { mkdirSync(dirname(dir), { recursive: true }); await git('clone', '--quiet', '--mirror', repoUrl, dir); }
  else await git('-C', dir, 'fetch', '--quiet', '--prune', 'origin');
  let full;
  try { full = await git('-C', dir, 'rev-parse', '--verify', '--quiet', `${commit}^{commit}`); }
  catch { throw Object.assign(new Error(`commit ${commit} is not in ${repoUrl}`), { final: true }); }
  return { dir, full };
}

// ---- build (the same script releases use) ----
async function releaseBuild(mirror, full, target, out) {
  const args = ['--repo', mirror, '--commit', full, '--work', join(work, 'build')];
  if (out) args.push('--out', out);
  args.push(target);
  console.error(`[build] tools/release-build.sh ${args.join(' ')}`);
  let stdout;
  const log = join(work, 'logs', `${target}-${full.slice(0, 12)}.log`);
  mkdirSync(dirname(log), { recursive: true });
  try {
    let stderr;
    ({ stdout, stderr } = await run(join(REPO_ROOT, 'tools/release-build.sh'), args, { maxBuffer: 1 << 28, timeout: 90 * 60_000 }));
    writeFileSync(log, stderr);
  } catch (e) {
    writeFileSync(log, `${e.message}\n${e.stderr || ''}`);
    const lines = String(e.stderr || '').split('\n').filter((l) => !/level=warning|warning \[M\d+\]/.test(l));
    const errs = lines.filter((l) => /error|failed|cannot|denied|killed/i.test(l));
    const tail = (errs.length ? errs : lines).slice(-4).join('\n');
    console.error(`[build] failed, full log: ${log}`);
    throw Object.assign(new Error(`the build failed: ${tail.slice(-600) || e.message}`), { transient: true });
  }
  const line = stdout.split('\n').reverse().find((l) => l.startsWith('SNEED_RESULT '));
  if (!line) throw Object.assign(new Error('the build printed no result'), { transient: true });
  return JSON.parse(line.slice('SNEED_RESULT '.length));
}

// ---- served assets (for frontend releases that already executed) ----
const assetIdl = ({ IDL }) => IDL.Service({
  list: IDL.Func([IDL.Record({ start: IDL.Opt(IDL.Nat), length: IDL.Opt(IDL.Nat) })], [IDL.Vec(IDL.Record({
    key: IDL.Text, content_type: IDL.Text,
    encodings: IDL.Vec(IDL.Record({ content_encoding: IDL.Text, sha256: IDL.Opt(IDL.Vec(IDL.Nat8)), length: IDL.Nat, modified: IDL.Int })),
  }))], ['query']),
  get: IDL.Func([IDL.Record({ key: IDL.Text, accept_encodings: IDL.Vec(IDL.Text) })], [IDL.Record({
    content: IDL.Vec(IDL.Nat8), content_type: IDL.Text, content_encoding: IDL.Text, sha256: IDL.Opt(IDL.Vec(IDL.Nat8)), total_length: IDL.Nat })], ['query']),
  get_chunk: IDL.Func([IDL.Record({ key: IDL.Text, content_encoding: IDL.Text, index: IDL.Nat, sha256: IDL.Opt(IDL.Vec(IDL.Nat8)) })],
    [IDL.Record({ content: IDL.Vec(IDL.Nat8) })], ['query']),
});

async function compareServed(distDir) {
  const a = Actor.createActor(assetIdl, { agent: anon, canisterId: FRONTEND });
  const served = new Map();
  for (let start = 0n; ;) {
    const page = await a.list({ start: [start], length: [] });
    if (page.length === 0) break;
    for (const e of page) {
      const id = e.encodings.find((x) => x.content_encoding === 'identity');
      served.set(e.key, id && id.sha256.length ? Buffer.from(id.sha256[0]).toString('hex') : 'download');
    }
    start += BigInt(page.length);
  }
  const download = async (key) => {
    const r = await a.get({ key, accept_encodings: ['gzip'] });
    const parts = [Buffer.from(r.content)]; let have = r.content.length;
    for (let i = 1n; have < Number(r.total_length); i++) {
      const c = await a.get_chunk({ key, content_encoding: r.content_encoding, index: i, sha256: r.sha256 });
      parts.push(Buffer.from(c.content)); have += c.content.length;
    }
    const body = Buffer.concat(parts);
    return crypto.createHash('sha256').update(r.content_encoding === 'gzip' ? zlib.gunzipSync(body) : body).digest('hex');
  };
  for (const [k, v] of served) if (v === 'download') served.set(k, await download(k));
  const local = new Map();
  const walk = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name !== '.ic-assets.json5') local.set('/' + relative(distDir, p).split(sep).join('/'), crypto.createHash('sha256').update(readFileSync(p)).digest('hex'));
  } };
  walk(distDir);
  const diffs = [];
  for (const [k, h] of local) { const s = served.get(k); if (s !== h) diffs.push(`${s === undefined ? 'missing' : 'differs'} ${k}`); }
  for (const k of served.keys()) if (!local.has(k)) diffs.push(`extra ${k}`);
  return { mode: 'frontend-served', files: local.size, served_match: diffs.length === 0,
    served_diff: diffs.length ? `${diffs.length} differences, e.g. ${diffs.slice(0, 3).join(', ')}` : '' };
}

// ---- one proposal ----
async function verifyOne(id, names) {
  const p = await getProposal(id);
  const plan = planVerification(p, names);
  if (plan.kind === 'skip') return { plan, verdict: null };
  if (plan.kind === 'cannot') return { plan, verdict: { status: 'cannot', reason: plan.reason } };
  if (!allowed.includes(normRepo(plan.repo))) {
    return { plan, verdict: { status: 'cannot', reason: `${plan.repo} is not a repository this verifier builds (${allowed.join(', ')})` } };
  }
  const { dir, full } = await mirrorFor(plan.repo, plan.commit);
  const meta = { fullCommit: full };
  let build;
  if (plan.kind === 'motoko') {
    build = await releaseBuild(dir, full, plan.canister);
  } else if (!p.decided || (!p.executed && !p.failed)) {
    // open: the batch is still proposed, so the evidence can be recomputed against the live canister
    build = await releaseBuild(dir, full, 'frontend');
  } else if (p.executed) {
    if (await laterFrontendRelease(id)) {
      return { plan, verdict: { status: 'cannot', reason: 'the proposal already executed and a later frontend release replaced its assets, so neither its evidence nor its served files can be checked any more' }, meta };
    }
    const distOut = join(work, 'dist', `p${id}`);
    mkdirSync(dirname(distOut), { recursive: true });
    const r = await releaseBuild(dir, full, 'frontend-dist', distOut);
    build = { ...(await compareServed(distOut)), dist: r.build };
    meta.image = r.image;
    return { plan, verdict: judge(plan, build), meta };
  } else {
    return { plan, verdict: { status: 'cannot', reason: 'the proposal failed or was rejected; its batch is no longer proposed' }, meta };
  }
  meta.image = build.image;
  return { plan, verdict: judge(plan, build.build), meta };
}

// ---- posting ----
/** Loads an Ed25519 or secp256k1 PEM (dfx identity format) as a SignIdentity, using only node:crypto. */
function identityFromPem(path) {
  const key = crypto.createPrivateKey(readFileSync(path, 'utf8'));
  const der = crypto.createPublicKey(key).export({ type: 'spki', format: 'der' });
  const type = key.asymmetricKeyType;
  const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
  class PemIdentity extends SignIdentity {
    getPublicKey() { return { toDer: () => new Uint8Array(der), derKey: new Uint8Array(der), rawKey: new Uint8Array(der) }; }
    async sign(blob) {
      if (type === 'ed25519') return new Uint8Array(crypto.sign(null, Buffer.from(blob), key));
      if (type === 'ec') {
        const sig = crypto.sign('sha256', Buffer.from(blob), { key, dsaEncoding: 'ieee-p1363' });
        let s = BigInt('0x' + sig.subarray(32).toString('hex'));
        if (s > N / 2n) s = N - s; // low-s
        return new Uint8Array(Buffer.concat([sig.subarray(0, 32), Buffer.from(s.toString(16).padStart(64, '0'), 'hex')]));
      }
      throw new Error(`unsupported key type ${type}`);
    }
  }
  if (type !== 'ed25519' && !(type === 'ec' && key.asymmetricKeyDetails?.namedCurve === 'secp256k1')) throw new Error(`unsupported key type ${type}`);
  return new PemIdentity();
}

const forumIdl = ({ IDL }) => {
  const Res = IDL.Variant({ ok: IDL.Nat, err: IDL.Reserved });
  return IDL.Service({
    get_proposal_thread: IDL.Func([IDL.Principal, IDL.Nat], [IDL.Opt(IDL.Record({ thread_id: IDL.Nat, proposal_id: IDL.Nat }))], ['query']),
    create_proposal_thread_with_auto_setup: IDL.Func([IDL.Record({ proposal_id: IDL.Nat, sns_root_canister_id: IDL.Principal })], [Res], []),
    create_post: IDL.Func([IDL.Nat, IDL.Opt(IDL.Nat), IDL.Opt(IDL.Text), IDL.Text], [Res], []),
  });
};
const show = (v) => JSON.stringify(v, (k, x) => (typeof x === 'bigint' ? x.toString() : x));

/** The injected poster: dry run prints; live posts as the PEM's principal, creating the thread if needed. */
async function makePoster() {
  const root = Principal.fromText(SNS_ROOT);
  const forumAnon = Actor.createActor(forumIdl, { agent: anon, canisterId: FORUM });
  if (opt.dryRun) {
    return async (id, body) => {
      const t = await forumAnon.get_proposal_thread(root, BigInt(id));
      const where = t.length ? `thread ${t[0].thread_id}` : 'a new proposal thread (create_proposal_thread_with_auto_setup)';
      console.log(`\n----- DRY RUN: would post to ${where} for proposal #${id} (${body.length} chars) -----\n${body}\n----- end -----`);
      return false;
    };
  }
  const identity = identityFromPem(pemPath);
  console.error(`[post] as ${identity.getPrincipal().toText()}`);
  const forum = Actor.createActor(forumIdl, { agent: await HttpAgent.create({ host: HOST, identity }), canisterId: FORUM });
  return async (id, body) => {
    let t = await forumAnon.get_proposal_thread(root, BigInt(id));
    let thread = t.length ? t[0].thread_id : null;
    if (thread == null) {
      const r = await forum.create_proposal_thread_with_auto_setup({ proposal_id: BigInt(id), sns_root_canister_id: root });
      if ('ok' in r) thread = r.ok;
      else {
        t = await forumAnon.get_proposal_thread(root, BigInt(id)); // created by someone else meanwhile?
        if (!t.length) throw Object.assign(new Error(`forum refused the thread: ${show(r.err)}`), { transient: true });
        thread = t[0].thread_id;
      }
    }
    const r = await forum.create_post(thread, [], [], body);
    if (!('ok' in r)) throw Object.assign(new Error(`forum refused the post: ${show(r.err)}`), { transient: true });
    console.error(`[post] proposal #${id}: post ${r.ok} in thread ${thread}`);
    return true;
  };
}

// ---- main ----
function readState() {
  try { return loadState(JSON.parse(readFileSync(statePath, 'utf8'))); } catch { return loadState(null); }
}
function writeState(s) {
  mkdirSync(dirname(statePath), { recursive: true });
  writeFileSync(statePath + '.tmp', JSON.stringify(s, null, 1)); renameSync(statePath + '.tmp', statePath);
}

const names = canisterNames();
const post = await makePoster();
let state = readState();
let ids, newest = null;
if (opt.proposals.length) ids = opt.proposals;
else {
  const listed = await listInteresting();
  ({ work: ids, newest } = selectWork(state, listed));
  if (state.last_seen == null) console.error(`[poll] first run: starting after proposal ${newest ?? 'none'}`);
}
console.error(`[poll] to check: ${ids.length ? ids.join(', ') : 'nothing new'}`);

let failures = 0;
for (const id of ids) {
  let outcome;
  try {
    const { plan, verdict, meta } = await verifyOne(id, names);
    if (!verdict) { outcome = { status: 'skipped' }; console.error(`[#${id}] not an upgrade or frontend release`); }
    else {
      const body = formatResult(plan, verdict, meta || {});
      const posted = await post(id, body);
      outcome = { status: verdict.status, posted };
      console.error(`[#${id}] ${verdict.status}`);
    }
  } catch (e) {
    failures++;
    console.error(`[#${id}] error: ${e.message}`);
    if (e.final) {
      const body = formatResult({ id, kind: 'unknown' }, { status: 'cannot', reason: e.message });
      outcome = { status: 'cannot', posted: await post(id, body).catch(() => false) };
    } else {
      outcome = { status: 'cannot', transient: true, reason: e.message };
      // last attempt (or a one-off --proposal run): say so in the thread rather than staying silent
      if (opt.proposals.length || (state.retry[id]?.attempts ?? 0) + 1 >= MAX_ATTEMPTS) {
        const body = formatResult({ id, kind: 'unknown' }, { status: 'cannot', reason: `${e.message} (gave up after ${opt.proposals.length ? 1 : MAX_ATTEMPTS} attempts)` });
        outcome.posted = await post(id, body).catch(() => false);
      }
    }
  }
  if (!opt.dryRun && !opt.proposals.length) state = recordOutcome(state, id, outcome);
}
if (!opt.dryRun && !opt.proposals.length) writeState(advance(state, newest));
process.exit(failures ? 1 : 0);
