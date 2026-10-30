// Write tools for Sneedapp: mint a bot (pages/SneedAppMint.jsx handleMint: pay the shortfall of the
// mint price into your Sneedapp payment subaccount, then mintCanister(app, version)) and upgrade a bot
// you control (components/UpgradeBotsDialog.jsx: install_code in upgrade mode with empty args, through
// every published version between the running one and the target, utils/upgradePath.js
// upgradeSteps). Unlike the dialog, each downloaded wasm must hash to the version's published
// wasmHash before it is installed. The optional extra cycles ("gas") top-up of the mint page is not
// offered here: use cycles_top_up_help.
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { idlFactory as sneedappIdl } from '../idl/sneedapp.did.js';
import { idlFactory as icrc1Idl } from '../idl/icrc1_ledger.did.js';
import { CANISTERS, opt, toPrincipal } from '../ic.js';
import { defineWrite } from '../writes.js';
import { spend, ledgerFee, fmt, link, toHex, balanceProblems } from '../chain.js';
import { plain, shortErr } from '../format.js';

const ICP_T = { decimals: 8, symbol: 'ICP' };
const botIdl = ({ IDL }) => IDL.Service({ getVersion: IDL.Func([], [IDL.Record({ major: IDL.Nat, minor: IDL.Nat, patch: IDL.Nat })], ['query']) });
const vText = (v) => `${v.major}.${v.minor}.${v.patch}`;
const cmp = (a, b) => Number(a.major) - Number(b.major) || Number(a.minor) - Number(b.minor) || Number(a.patch) - Number(b.patch);
const urlOf = (v) => (Array.isArray(v?.wasmUrl) ? v.wasmUrl[0] : v?.wasmUrl)?.trim?.() || '';
const parseVersion = (t) => {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(t).trim());
  if (!m) throw new Error(`"${t}" is not a version like 0.9.5.`);
  return { major: BigInt(m[1]), minor: BigInt(m[2]), patch: BigInt(m[3]) };
};

/// The versions to install, oldest first, from `current` to `target` (utils/upgradePath.js
/// upgradeSteps): every published version with a wasm URL newer than `current` and older than
/// `target`, then `target`. Without a known current version only the target.
export const upgradeSteps = (current, target, versions = []) => {
  if (!target) return [];
  if (!current) return [target];
  const seen = new Set();
  const steps = versions.filter((v) => urlOf(v) && cmp(v, current) > 0 && cmp(v, target) < 0).sort(cmp)
    .filter((v) => { const k = vText(v); if (seen.has(k)) return false; seen.add(k); return true; });
  return [...steps, target];
};

/// The newest version with a downloadable wasm.
const latestOf = (versions) => versions.filter((v) => v.hasWasm && urlOf(v)).sort(cmp).pop() ?? null;

const mintBuild = async ({ app_id, version }, ctx) => {
  const sa = await ctx.anon(sneedappIdl, CANISTERS.sneedapp);
  const me = toPrincipal(ctx.principal);
  const [app, versions] = await Promise.all([sa.getApp(app_id), sa.getAppVersions(app_id)]);
  const a = opt(app);
  if (!a) throw new Error(`No Sneedapp app "${app_id}" (see sneedapp_apps).`);
  const v = version ? versions.find((x) => cmp(x, parseVersion(version)) === 0) : latestOf(versions);
  const problems = [];
  if (!a.enabled) problems.push(`${a.name} is not enabled for minting.`);
  if (!v) problems.push(version ? `No version ${version} of ${a.name}.` : `${a.name} has no version with a wasm.`);
  else if (!v.hasWasm) problems.push(`Version ${vText(v)} has no wasm.`);
  // the page's own reads (getAppMintPrice and getUserPaymentBalance are update calls that only read)
  const [sub, price, deposit] = await Promise.all([sa.getPaymentSubaccount(me), sa.getAppMintPrice(app_id, me), sa.getUserPaymentBalance(me)]);
  const applicable = BigInt(price.applicable);
  const shortfall = applicable > BigInt(deposit) ? applicable - BigInt(deposit) : 0n;
  const fee = await ledgerFee(CANISTERS.icp_ledger);
  const calls = [];
  const spends = [];
  if (shortfall > 0n) {
    calls.push({ canister: CANISTERS.icp_ledger, method: 'icrc1_transfer', args: { to: { owner: CANISTERS.sneedapp, subaccount: [toHex(sub)] }, amount: shortfall, fee: [fee], memo: [], from_subaccount: [], created_at_time: [] }, note: 'into your Sneedapp payment subaccount' });
    spends.push(await spend(CANISTERS.icp_ledger, shortfall + fee, `${a.name} mint price + ledger fee`, 'Sneedapp payment subaccount'));
    problems.push(...await balanceProblems(ctx, spends));
  }
  if (v) calls.push({ canister: CANISTERS.sneedapp, method: 'mintCanister', args: [app_id, [v.major], [v.minor], [v.patch]] });
  return {
    summary: `Mint ${a.name}${v ? ` ${vText(v)}` : ''} for ${fmt(applicable, ICP_T)}${price.isPremium ? ' (Premium price)' : ''}`,
    calls, spends, problems,
    notes: [
      `${BigInt(deposit) > 0n ? `Your Sneedapp payment deposit holds ${fmt(deposit, ICP_T)}; ` : ''}the new canister is yours (you become its controller) and is registered in your Sneedapp wallet.`,
      'It starts with the cycles the mint includes; top it up later (cycles_top_up_help).',
    ],
    _sub: sub, _shortfall: shortfall, _fee: fee, _v: v,
  };
};

const mintRun = async ({ app_id }, ctx, plan) => {
  const steps = [];
  let spent = false;
  if (plan._shortfall > 0n) {
    const tr = await (await ctx.signed(icrc1Idl, CANISTERS.icp_ledger)).icrc1_transfer({ to: { owner: toPrincipal(CANISTERS.sneedapp), subaccount: [plan._sub] }, amount: plan._shortfall, fee: [plan._fee], memo: [], from_subaccount: [], created_at_time: [] });
    if ('Err' in tr) return { ok: false, error: `payment refused, nothing sent: ${JSON.stringify(plain(tr.Err))}` };
    spent = true;
    steps.push(`paid into your Sneedapp payment subaccount (ICP block ${tr.Ok})`);
  }
  const v = plan._v;
  let r;
  try { r = await (await ctx.signed(sneedappIdl, CANISTERS.sneedapp)).mintCanister(app_id, [v.major], [v.minor], [v.patch]); } catch (e) {
    return { ok: false, spent, steps, error: shortErr(e), recovery: 'The payment stays in your Sneedapp payment subaccount: check sneedapp_my_bots before minting again (the next mint uses the deposit).' };
  }
  if ('Err' in r) return { ok: false, spent, steps, error: `mintCanister: ${JSON.stringify(plain(r.Err))}`, recovery: spent ? 'The payment stays in your Sneedapp payment subaccount for the next mint.' : undefined };
  const id = r.Ok.canisterId.toText();
  steps.push(`minted ${id}`);
  return { ok: true, spent, summary: `minted ${id} (v${vText(v)})`, steps, links: [link(/trading/.test(app_id) ? `/trading_bot/${id}` : /staking|neuron/.test(app_id) ? `/icp_neuron_manager/${id}` : `/canister?id=${id}`)] };
};

const upgradeBuild = async ({ canister_id, to_version }, ctx) => {
  const id = toPrincipal(canister_id, 'canister id').toText();
  const sa = await ctx.anon(sneedappIdl, CANISTERS.sneedapp);
  const wallet = await (await ctx.signed(sneedappIdl, CANISTERS.sneedapp)).getMyWallet();
  const entry = wallet.find((e) => e.canisterId.toText() === id);
  const problems = [];
  if (!entry) throw new Error(`${id} is not in your Sneedapp wallet (sneedapp_my_bots lists yours).`);
  const versions = await sa.getAppVersions(entry.appId);
  const info = await ctx.canisterInfo(id);
  if (!info.controllers.includes(ctx.principal)) problems.push(`${ctx.principal} is not a controller of ${id}, so it cannot upgrade it.`);
  // the running code: by its module hash among the published versions, else as the bot reports it
  let current = versions.find((v) => info.moduleHash && v.wasmHash.toLowerCase() === info.moduleHash.toLowerCase()) ?? null;
  if (!current) { try { current = await (await ctx.anon(botIdl, id)).getVersion(); } catch { current = null; } }
  const target = to_version ? versions.find((v) => cmp(v, parseVersion(to_version)) === 0) : latestOf(versions);
  if (!target) throw new Error(to_version ? `No published version ${to_version} of ${entry.appId}.` : `${entry.appId} has no version with a wasm.`);
  if (!current) problems.push(`The running version of ${id} is unknown (its module hash ${info.moduleHash ?? 'unknown'} matches no published version and it does not answer getVersion), so the versions in between cannot be worked out. Upgrade it on Sneed Hub, where you can confirm the risk.`);
  else if (cmp(target, current) <= 0) problems.push(`${id} runs ${vText(current)} already${cmp(target, current) < 0 ? ', newer than the target: downgrades are not offered' : ''}.`);
  const steps = current ? upgradeSteps(current, target, versions) : [];
  for (const s of steps) if (!urlOf(s) || !s.wasmHash) problems.push(`Version ${vText(s)} has no wasm URL and hash to install from.`);
  return {
    summary: `Upgrade ${entry.appId} ${id} from ${current ? vText(current) : '?'} to ${vText(target)}${steps.length > 1 ? ` in ${steps.length} steps (every published version in between, as Sneed Hub does)` : ''}`,
    calls: steps.map((s) => ({ canister: 'aaaaa-aa', method: 'install_code', args: { mode: { upgrade: [] }, canister_id: id, wasm_module: `<${urlOf(s)}>`, arg: '4449444c0000' }, note: `v${vText(s)}, the wasm must hash to ${s.wasmHash}` })),
    notes: ['Each step downloads the published wasm and installs it only when its SHA-256 matches the published hash. State is kept by each version\'s migration; a step that fails leaves the bot on the version before it.', 'You pay nothing; the upgrade uses the bot\'s cycles.'],
    problems,
    _steps: steps.map((s) => ({ v: vText(s), url: urlOf(s), hash: s.wasmHash.toLowerCase() })),
  };
};

/// Download a wasm and check it against the published hash (exported for tests).
export const fetchVerifiedWasm = async (url, hash, fetcher = fetch) => {
  const res = await fetcher(url);
  if (!res.ok) throw new Error(`download failed (HTTP ${res.status})`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const got = createHash('sha256').update(bytes).digest('hex');
  if (got !== hash) throw new Error(`the downloaded wasm hashes to ${got}, not the published ${hash}: not installed`);
  return bytes;
};

export const upgradeRun = async ({ canister_id }, ctx, plan, fetcher = fetch) => {
  const id = toPrincipal(canister_id).toText();
  const mgmt = await ctx.management(id);
  const done = [];
  for (const [i, s] of plan._steps.entries()) {
    try {
      const wasm = await fetchVerifiedWasm(s.url, s.hash, fetcher);
      await mgmt.install_code({ mode: { upgrade: [] }, canister_id: toPrincipal(id), wasm_module: wasm, arg: new Uint8Array([0x44, 0x49, 0x44, 0x4c, 0x00, 0x00]) });
      done.push(`v${s.v} installed`);
    } catch (e) {
      return { ok: false, steps: done, error: `${i > 0 ? `now on v${plan._steps[i - 1].v}; ` : ''}v${s.v} failed: ${shortErr(e)}`, recovery: 'Run sneedapp_upgrade_bot again to continue from the version the bot is on.' };
    }
  }
  return { ok: true, summary: `${id} upgraded to v${plan._steps[plan._steps.length - 1].v}`, steps: done };
};

export const sneedappWrites = [
  {
    name: 'sneedapp_mint',
    title: 'Sneedapp: mint a bot',
    description: 'Mint a Sneedapp canister (e.g. an ICP Staking Bot or a Sneed Trading Bot), as the mint page does: pay what your Sneedapp payment deposit lacks of the mint price (Premium price applied) into it, then sneedapp.mintCanister(app, version). You become the canister\'s controller. Counts toward the daily ICP cap.',
    inputSchema: {
      app_id: z.string().describe('App id, e.g. "sneed-icp-staking-bot" (sneedapp_apps)'),
      version: z.string().optional().describe('Version like 0.9.5 (default: the latest with a wasm)'),
    },
    build: mintBuild,
    run: mintRun,
  },
  {
    name: 'sneedapp_upgrade_bot',
    title: 'Sneedapp: upgrade a bot',
    description: 'Upgrade a Sneedapp canister you control to a published version (default the latest), as Sneed Hub\'s "Upgrade" does: install_code in upgrade mode through every published version between the running one and the target, never skipping one (each version\'s migration expects the one before). Each wasm is downloaded from its published URL and installed only if its SHA-256 matches the published hash. The management canister call needs "everything" (or aaaaa-aa) in an act-as-me delegation.',
    inputSchema: {
      canister_id: z.string().describe('The bot\'s canister id'),
      to_version: z.string().optional().describe('Target version like 0.9.5 (default: the latest)'),
    },
    destructive: true,
    build: upgradeBuild,
    run: (a, ctx, plan) => upgradeRun(a, ctx, plan),
  },
];

export const registerSneedappWrites = (server) => sneedappWrites.forEach((w) => defineWrite(server, w));
