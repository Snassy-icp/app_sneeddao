// ICRC-2 approvals (allowances an account has granted): find them, judge them, change them.
//
// Reusable per (ledger, account): the wallet calls it for the main account, Sneed pockets call it per
// subaccount. Nothing here touches React or the build's environment (process.env, `declarations/`),
// so scripts/approvals-mainnet.mjs runs it in node against mainnet.
//
// Discovery, best first (discoverApprovals):
//   1. ICRC-103 `icrc103_get_allowances`: the ledger lists the account's allowances itself. Complete.
//   2. An index: index-ng (`get_account_transactions`, found with ICRC-106 or a hint) or the ICP index
//      (spenders only as account identifiers). The account's `approve` operations name the spenders;
//      each is then confirmed with `icrc2_allowance` (it may have been used, replaced or expired).
//      Complete unless the history is longer than `maxTxs`.
//   3. Known spenders: `icrc2_allowance` for each candidate (Sneed canisters, DEX pools, spenders
//      Sneed Hub approved, see recordApprovalSpender). Finds only what it is asked about.
// Known spenders are checked in modes 2 and 3 as well, so a truncated history still finds them.
import { Actor } from '@dfinity/agent';
import { Principal } from '@dfinity/principal';
import { bigEndianCrc32 } from '@dfinity/utils';
import { sha224 } from '@noble/hashes/sha256';
import { icrc2Approve } from './icrcTx.js';

export const ICP_LEDGER_ID = 'ryjl3-tyaaa-aaaaa-aaaba-cai';
export const ICP_INDEX_ID = 'qhbym-qaaaa-aaaaa-aaafq-cai';

// ---- Candid (only the fields used; records decode with fewer fields) ----

const ledgerIdl = ({ IDL }) => {
    const Account = IDL.Record({ owner: IDL.Principal, subaccount: IDL.Opt(IDL.Vec(IDL.Nat8)) });
    const Standard = IDL.Record({ name: IDL.Text, url: IDL.Text });
    const Allowance103 = IDL.Record({ from_account: Account, to_spender: Account, allowance: IDL.Nat, expires_at: IDL.Opt(IDL.Nat64) });
    const GetAllowancesError = IDL.Variant({
        AccessDenied: IDL.Record({ reason: IDL.Text }),
        GenericError: IDL.Record({ error_code: IDL.Nat, message: IDL.Text }),
    });
    const ApproveError = IDL.Variant({
        GenericError: IDL.Record({ message: IDL.Text, error_code: IDL.Nat }),
        TemporarilyUnavailable: IDL.Null,
        Duplicate: IDL.Record({ duplicate_of: IDL.Nat }),
        BadFee: IDL.Record({ expected_fee: IDL.Nat }),
        AllowanceChanged: IDL.Record({ current_allowance: IDL.Nat }),
        CreatedInFuture: IDL.Record({ ledger_time: IDL.Nat64 }),
        TooOld: IDL.Null,
        Expired: IDL.Record({ ledger_time: IDL.Nat64 }),
        InsufficientFunds: IDL.Record({ balance: IDL.Nat }),
    });
    return IDL.Service({
        icrc1_supported_standards: IDL.Func([], [IDL.Vec(Standard)], ['query']),
        icrc1_fee: IDL.Func([], [IDL.Nat], ['query']),
        icrc2_allowance: IDL.Func([IDL.Record({ account: Account, spender: Account })], [IDL.Record({ allowance: IDL.Nat, expires_at: IDL.Opt(IDL.Nat64) })], ['query']),
        icrc103_get_allowances: IDL.Func(
            [IDL.Record({ from_account: IDL.Opt(Account), prev_spender: IDL.Opt(Account), take: IDL.Opt(IDL.Nat) })],
            [IDL.Variant({ Ok: IDL.Vec(Allowance103), Err: GetAllowancesError })], ['query']),
        icrc106_get_index_principal: IDL.Func([], [IDL.Variant({ Ok: IDL.Principal, Err: IDL.Reserved })], ['query']),
        icrc2_approve: IDL.Func([IDL.Record({
            fee: IDL.Opt(IDL.Nat), memo: IDL.Opt(IDL.Vec(IDL.Nat8)), from_subaccount: IDL.Opt(IDL.Vec(IDL.Nat8)),
            created_at_time: IDL.Opt(IDL.Nat64), amount: IDL.Nat, expected_allowance: IDL.Opt(IDL.Nat),
            expires_at: IDL.Opt(IDL.Nat64), spender: Account,
        })], [IDL.Variant({ Ok: IDL.Nat, Err: ApproveError })], []),
    });
};

const indexNgIdl = ({ IDL }) => {
    const Account = IDL.Record({ owner: IDL.Principal, subaccount: IDL.Opt(IDL.Vec(IDL.Nat8)) });
    const Approve = IDL.Record({ from: Account, spender: Account, amount: IDL.Nat, expires_at: IDL.Opt(IDL.Nat64) });
    const Transaction = IDL.Record({ kind: IDL.Text, approve: IDL.Opt(Approve), timestamp: IDL.Nat64 });
    return IDL.Service({
        get_account_transactions: IDL.Func(
            [IDL.Record({ account: Account, start: IDL.Opt(IDL.Nat), max_results: IDL.Nat })],
            [IDL.Variant({
                Ok: IDL.Record({ transactions: IDL.Vec(IDL.Record({ id: IDL.Nat, transaction: Transaction })), oldest_tx_id: IDL.Opt(IDL.Nat) }),
                Err: IDL.Record({ message: IDL.Text }),
            })], ['query']),
    });
};

const icpIndexIdl = ({ IDL }) => {
    const Account = IDL.Record({ owner: IDL.Principal, subaccount: IDL.Opt(IDL.Vec(IDL.Nat8)) });
    const Tokens = IDL.Record({ e8s: IDL.Nat64 });
    const TimeStamp = IDL.Record({ timestamp_nanos: IDL.Nat64 });
    const Operation = IDL.Variant({
        Approve: IDL.Record({ from: IDL.Text, spender: IDL.Text, allowance: Tokens, expires_at: IDL.Opt(TimeStamp) }),
        Burn: IDL.Record({ from: IDL.Text, amount: Tokens, spender: IDL.Opt(IDL.Text) }),
        Mint: IDL.Record({ to: IDL.Text }),
        Transfer: IDL.Record({ from: IDL.Text, to: IDL.Text, amount: Tokens, fee: Tokens, spender: IDL.Opt(IDL.Text) }),
    });
    return IDL.Service({
        get_account_transactions: IDL.Func(
            [IDL.Record({ account: Account, start: IDL.Opt(IDL.Nat), max_results: IDL.Nat })],
            [IDL.Variant({
                Ok: IDL.Record({ transactions: IDL.Vec(IDL.Record({ id: IDL.Nat64, transaction: IDL.Record({ operation: Operation }) })), oldest_tx_id: IDL.Opt(IDL.Nat64) }),
                Err: IDL.Record({ message: IDL.Text }),
            })], ['query']),
    });
};

/// `agent`: an HttpAgent, or anything with createActor(idlFactory, canisterIdText) (tests use PocketIC).
const actor = (idl, canisterId, agent) => (typeof agent?.createActor === 'function'
    ? agent.createActor(idl, String(canisterId))
    : Actor.createActor(idl, { agent, canisterId: String(canisterId) }));
export const ledgerActor = (ledgerId, agent) => actor(ledgerIdl, ledgerId, agent);

// ---- Accounts ----

const toHex = (bytes) => Array.from(bytes || [], (b) => Number(b).toString(16).padStart(2, '0')).join('');
const fromHex = (hex) => Uint8Array.from(String(hex || '').match(/../g) || [], (h) => parseInt(h, 16));
const asPrincipal = (p) => (typeof p === 'string' ? Principal.fromText(p) : p);

/// A subaccount as 32 bytes, or null for the default (all-zero or absent) one.
export function normSubaccount(sub) {
    if (sub == null) return null;
    let bytes = sub;
    if (Array.isArray(sub) && (sub.length === 0 || sub.length === 1 && typeof sub[0] === 'object')) bytes = sub[0] ?? null; // candid opt
    if (bytes == null) return null;
    if (typeof bytes === 'string') bytes = fromHex(bytes);
    bytes = Uint8Array.from(bytes);
    if (bytes.length === 0 || bytes.every((b) => b === 0)) return null;
    return bytes;
}
export const subaccountHex = (sub) => { const s = normSubaccount(sub); return s ? toHex(s) : null; };

/// The candid Account for an owner and optional subaccount.
export const toAccount = (owner, subaccount = null) => {
    const s = normSubaccount(subaccount);
    return { owner: asPrincipal(owner), subaccount: s ? [s] : [] };
};

/// "principal" or "principal.subhex": a stable key for an account.
export const accountKey = (owner, subaccount = null) => {
    const hex = subaccountHex(subaccount);
    return `${asPrincipal(owner).toText()}${hex ? `.${hex}` : ''}`;
};

/// The ICP account identifier (64 hex) of an account.
export function icpAccountId(owner, subaccount = null) {
    const p = asPrincipal(owner).toUint8Array();
    const sub = normSubaccount(subaccount) || new Uint8Array(32);
    const digest = sha224(new Uint8Array([0x0a, ...new TextEncoder().encode('account-id'), ...p, ...sub]));
    return toHex(new Uint8Array([...bigEndianCrc32(digest), ...digest]));
}

const sameAccount = (a, owner, subaccount) =>
    a.owner.toText() === asPrincipal(owner).toText() && subaccountHex(a.subaccount) === subaccountHex(subaccount);

// ---- Small helpers ----

const nowNs = () => BigInt(Date.now()) * 1_000_000n;
const optOne = (o) => (Array.isArray(o) ? (o.length ? o[0] : null) : (o ?? null));

/// Run `tasks` (functions returning promises) with at most `n` at a time; results in order.
export async function mapLimited(items, n, fn) {
    const out = new Array(items.length);
    let next = 0;
    const worker = async () => {
        while (next < items.length) {
            const i = next++;
            out[i] = await fn(items[i], i);
        }
    };
    await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
    return out;
}

/// A queue that runs at most `n` jobs at once (shared by every discovery in the page).
export function makeLimiter(n) {
    let active = 0;
    const waiting = [];
    const pump = () => {
        while (active < n && waiting.length) {
            const { fn, resolve, reject } = waiting.shift();
            active++;
            Promise.resolve().then(fn).then(resolve, reject).finally(() => { active--; pump(); });
        }
    };
    return (fn) => new Promise((resolve, reject) => { waiting.push({ fn, resolve, reject }); pump(); });
}

// ---- Ledger facts (standards, index) ----

const ledgerInfoMemo = new Map();

/// { standards: ['ICRC-1', …], icrc103, indexId } for a ledger; remembered for the session.
/// `indexHint` (e.g. the SNS index) is used when the ledger does not say (ICRC-106).
export async function getLedgerApprovalInfo(agent, ledgerId, { indexHint = null } = {}) {
    const id = String(ledgerId);
    const memoKey = `${id}|${indexHint || ''}`;
    if (ledgerInfoMemo.has(memoKey)) return ledgerInfoMemo.get(memoKey);
    const p = (async () => {
        const l = ledgerActor(id, agent);
        let standards = [];
        try { standards = (await l.icrc1_supported_standards()).map((s) => s.name.toUpperCase()); } catch { /* old ledger */ }
        const icrc2 = standards.includes('ICRC-2');
        const icrc103 = standards.includes('ICRC-103');
        let indexId = null;
        let indexKind = null;
        if (id === ICP_LEDGER_ID) { indexId = ICP_INDEX_ID; indexKind = 'icp'; }
        else {
            if (standards.includes('ICRC-106')) {
                try { const r = await l.icrc106_get_index_principal(); if ('Ok' in r) indexId = r.Ok.toText(); } catch { /* none */ }
            }
            if (!indexId && indexHint) indexId = String(indexHint);
            if (indexId) indexKind = 'ng';
        }
        return { standards, icrc2, icrc103, indexId, indexKind };
    })();
    ledgerInfoMemo.set(memoKey, p);
    p.catch(() => ledgerInfoMemo.delete(memoKey));
    return p;
}

// ---- The three discovery sources ----

/// ICRC-103: every allowance of the account, paged by spender. The ledger orders all allowances by
/// (from, spender) and carries on into the next accounts' once this one's run out, so a row from
/// another account ends the list (paging on with its spender would start this account over).
export async function listAllowancesIcrc103(agent, ledgerId, owner, subaccount = null, { maxPages = 50, take = null } = {}) {
    const l = ledgerActor(ledgerId, agent);
    const out = [];
    let prev = [];
    for (let page = 0; page < maxPages; page++) {
        const r = await l.icrc103_get_allowances({ from_account: [toAccount(owner, subaccount)], prev_spender: prev, take: take ? [BigInt(take)] : [] });
        if ('Err' in r) throw new Error(`icrc103_get_allowances: ${JSON.stringify(r.Err, bigintJson)}`);
        const rows = r.Ok;
        const mine = rows.filter((a) => sameAccount(a.from_account, owner, subaccount));
        for (const a of mine) out.push({ spender: a.to_spender, allowance: a.allowance, expiresAt: optOne(a.expires_at) });
        if (!rows.length || mine.length < rows.length) break;
        prev = [rows[rows.length - 1].to_spender];
    }
    return out;
}

/// index-ng: the latest approve per spender in the account's history (newest first).
/// Returns { spenders: [{ spender, allowance, expiresAt }], complete }.
export async function approvesFromIndexNg(agent, indexId, owner, subaccount = null, { maxTxs = 3000, pageSize = 500 } = {}) {
    const ix = actor(indexNgIdl, indexId, agent);
    const seen = new Map();
    let start = [];
    let read = 0;
    let complete = false;
    while (read < maxTxs) {
        const r = await ix.get_account_transactions({ account: toAccount(owner, subaccount), start, max_results: BigInt(pageSize) });
        if ('Err' in r) throw new Error(`index: ${r.Err.message}`);
        const txs = r.Ok.transactions;
        for (const { transaction: t } of txs) {
            const ap = optOne(t.approve);
            if (!ap || !sameAccount(ap.from, owner, subaccount)) continue;
            const k = accountKey(ap.spender.owner, ap.spender.subaccount);
            if (!seen.has(k)) seen.set(k, { spender: ap.spender, allowance: ap.amount, expiresAt: optOne(ap.expires_at) });
        }
        read += txs.length;
        const oldest = optOne(r.Ok.oldest_tx_id);
        const last = txs.length ? txs[txs.length - 1].id : null;
        if (!txs.length || last == null || (oldest != null && BigInt(last) <= BigInt(oldest))) { complete = true; break; }
        start = [BigInt(last)];
    }
    return { spenders: [...seen.values()], complete };
}

/// ICP index: approves name the spender only by account identifier. `candidates` (accounts) are
/// hashed to match them; the rest come back with `spenderAccountId` only, and with the allowance
/// estimated from the history (the approved amount less the transfer_from/burns the spender made
/// after it, amount + fee each).
export async function approvesFromIcpIndex(agent, owner, subaccount = null, { candidates = [], maxTxs = 3000, pageSize = 500, indexId = ICP_INDEX_ID } = {}) {
    const ix = actor(icpIndexIdl, indexId, agent);
    const myAid = icpAccountId(owner, subaccount);
    const byAid = new Map();
    for (const c of candidates) {
        try { byAid.set(icpAccountId(c.owner, c.subaccount), toAccount(c.owner, c.subaccount)); } catch { /* bad candidate */ }
    }
    const seen = new Map();
    const used = new Map(); // spender aid → pulled after its latest approve (newer txs come first)
    let start = [];
    let read = 0;
    let complete = false;
    while (read < maxTxs) {
        const r = await ix.get_account_transactions({ account: toAccount(owner, subaccount), start, max_results: BigInt(pageSize) });
        if ('Err' in r) throw new Error(`ICP index: ${r.Err.message}`);
        const txs = r.Ok.transactions;
        for (const { transaction: t } of txs) {
            const op = t.operation;
            const pull = op.Transfer || op.Burn;
            if (pull && pull.from === myAid && pull.spender.length && !seen.has(pull.spender[0])) {
                const sp = pull.spender[0];
                used.set(sp, (used.get(sp) || 0n) + BigInt(pull.amount.e8s) + BigInt(pull.fee?.e8s ?? 0n));
                continue;
            }
            const ap = op.Approve;
            if (!ap || ap.from !== myAid) continue;
            if (seen.has(ap.spender)) continue;
            const approved = BigInt(ap.allowance.e8s);
            const spent = used.get(ap.spender) || 0n;
            seen.set(ap.spender, {
                spender: byAid.get(ap.spender) || null,
                spenderAccountId: ap.spender,
                allowance: approved > spent ? approved - spent : 0n,
                expiresAt: ap.expires_at.length ? BigInt(ap.expires_at[0].timestamp_nanos) : null,
            });
        }
        read += txs.length;
        const oldest = optOne(r.Ok.oldest_tx_id);
        const last = txs.length ? txs[txs.length - 1].id : null;
        if (!txs.length || last == null || (oldest != null && BigInt(last) <= BigInt(oldest))) { complete = true; break; }
        start = [BigInt(last)];
    }
    return { spenders: [...seen.values()], complete };
}

/// The current allowance from `owner/subaccount` to `spender` ({ owner, subaccount }).
export async function getAllowance(agent, ledgerId, owner, subaccount, spender) {
    const r = await ledgerActor(ledgerId, agent).icrc2_allowance({ account: toAccount(owner, subaccount), spender: toAccount(spender.owner, spender.subaccount) });
    return { allowance: r.allowance, expiresAt: optOne(r.expires_at) };
}

// ---- Discovery ----

/**
 * Every live approval of one account on one ledger.
 * @param {object} o
 * @param {import('@dfinity/agent').HttpAgent} o.agent  any agent (anonymous is enough: all queries)
 * @param {string} o.ledgerId
 * @param {string|Principal} o.owner
 * @param {Uint8Array|number[]|string|null} [o.subaccount]  hex or bytes; null = default account
 * @param {Array<{owner, subaccount?, name?}>} [o.candidates]  known spenders to check as well
 * @param {Array<{owner, subaccount?}>} [o.resolveCandidates]  extra accounts used only to name ICP index spenders
 * @param {string} [o.indexHint]  index canister when the ledger does not answer ICRC-106
 * @param {number} [o.maxTxs]  history read from an index before giving up (then complete = false)
 * @param {boolean} [o.useIcrc103]  false skips ICRC-103 even where supported (to compare the paths)
 * @param {bigint} [o.now]  the time (ns) expiries are judged against; default the clock
 * @returns {Promise<{ ledgerId, owner, subaccount, method, complete, approvals: object[], notes: string[], at }>}
 *   each approval: { ledgerId, from: Account, spender: Account|null, spenderAccountId?, allowance: bigint,
 *                expiresAt: bigint|null, source, verified }   (verified: read from icrc2_allowance or ICRC-103)
 */
export async function discoverApprovals({ agent, ledgerId, owner, subaccount = null, candidates = [], resolveCandidates = [], indexHint = null, maxTxs = 3000, concurrency = 4, useIcrc103 = true, icrc103PageSize = null, now = null }) {
    const id = String(ledgerId);
    const ownerP = asPrincipal(owner);
    const from = toAccount(ownerP, subaccount);
    const notes = [];
    const info = await getLedgerApprovalInfo(agent, id, { indexHint });
    const base = { ledgerId: id, owner: ownerP.toText(), subaccount: subaccountHex(subaccount), at: Date.now() };
    if (!info.icrc2 && info.standards.length) return { ...base, method: 'none', complete: true, approvals: [], notes: ['This token does not support approvals (no ICRC-2).'] };

    if (now == null) now = nowNs();
    const live = (a) => a.allowance > 0n && (a.expiresAt == null || BigInt(a.expiresAt) > now);
    const mk = (spender, a, source, verified, extra = {}) => ({ ledgerId: id, from, spender, allowance: BigInt(a.allowance), expiresAt: a.expiresAt == null ? null : BigInt(a.expiresAt), source, verified, ...extra });

    if (info.icrc103 && useIcrc103) {
        try {
            const rows = await listAllowancesIcrc103(agent, id, ownerP, subaccount, { take: icrc103PageSize });
            return { ...base, method: 'icrc103', complete: true, approvals: rows.filter(live).map((r) => mk(r.spender, r, 'icrc103', true)), notes };
        } catch (e) {
            notes.push(`ICRC-103 failed (${e?.message || e}); using the other ways.`);
        }
    }

    // spender key → { spender, source, indexRow? }
    const toCheck = new Map();
    const unresolved = [];
    let method = 'known';
    let complete = false;
    if (info.indexId) {
        try {
            if (info.indexKind === 'icp') {
                const r = await approvesFromIcpIndex(agent, ownerP, subaccount, { candidates: [...candidates, ...resolveCandidates], maxTxs, indexId: info.indexId });
                for (const s of r.spenders) {
                    if (s.spender) toCheck.set(accountKey(s.spender.owner, s.spender.subaccount), { spender: s.spender, source: 'index' });
                    else if (live(s)) unresolved.push(mk(null, s, 'index', false, { spenderAccountId: s.spenderAccountId }));
                }
                complete = r.complete;
            } else {
                const r = await approvesFromIndexNg(agent, info.indexId, ownerP, subaccount, { maxTxs });
                for (const s of r.spenders) toCheck.set(accountKey(s.spender.owner, s.spender.subaccount), { spender: s.spender, source: 'index' });
                complete = r.complete;
            }
            method = 'index';
            if (!complete) notes.push(`Only the latest ${maxTxs} transactions were read; older approvals may be missing (known spenders were checked too).`);
        } catch (e) {
            notes.push(`The index could not be read (${e?.message || e}); only known spenders were checked.`);
        }
    } else {
        notes.push('This token has neither ICRC-103 nor an index, so only known spenders were checked.');
    }
    for (const c of candidates) {
        try {
            const acc = toAccount(c.owner, c.subaccount);
            const k = accountKey(acc.owner, acc.subaccount);
            if (!toCheck.has(k)) toCheck.set(k, { spender: acc, source: 'known' });
        } catch { /* bad candidate */ }
    }
    const checked = await mapLimited([...toCheck.values()], concurrency, async (c) => {
        try {
            const a = await getAllowance(agent, id, ownerP, subaccount, c.spender);
            return live(a) ? mk(c.spender, a, c.source, true) : null;
        } catch (e) {
            return null;
        }
    });
    const approvals = [...checked.filter(Boolean), ...unresolved];
    if (unresolved.length) notes.push(`${unresolved.length} approval(s) name the spender only by account id (the ICP index does); Sneed Hub can't check or revoke those.`);
    return { ...base, method, complete, approvals, notes };
}

// ---- Risk ----

export const UNLIMITED_TOKENS = 10n ** 10n; // ten billion whole tokens and up reads as "unlimited"

/// { unlimited, noExpiry, aboveBalance, level: 'ok'|'warn' } for an approval.
/// `decimals`; optional `balance` (base units) and `totalSupply` sharpen the judgement.
export function approvalRisk(a, { decimals = 8, balance = null, totalSupply = null } = {}) {
    const amt = BigInt(a.allowance);
    const one = 10n ** BigInt(decimals ?? 8);
    const unlimited = amt / one >= UNLIMITED_TOKENS || (totalSupply != null && BigInt(totalSupply) > 0n && amt >= BigInt(totalSupply));
    const noExpiry = a.expiresAt == null;
    const aboveBalance = !unlimited && balance != null && amt > BigInt(balance);
    return { unlimited, noExpiry, aboveBalance, level: unlimited || noExpiry ? 'warn' : 'ok' };
}

// ---- Changing approvals ----

/**
 * icrc2_approve from (identity's) `fromSubaccount` to `spender`. `agent` must carry the owner's identity.
 * `expectedAllowance` guards against a race (the ledger refuses if it changed): pass the allowance shown.
 * `expiresAt` in ns since epoch, or null for none. Returns the block index; throws a readable Error.
 */
export async function setApproval({ agent, ledgerId, fromSubaccount = null, spender, amount, expectedAllowance = null, expiresAt = null, fee = null }) {
    const s = normSubaccount(fromSubaccount);
    const args = {
        spender: toAccount(spender.owner, spender.subaccount),
        amount: BigInt(amount),
        fee: fee == null ? [] : [BigInt(fee)],
        memo: [],
        from_subaccount: s ? [s] : [],
        created_at_time: [],
        expected_allowance: expectedAllowance == null ? [] : [BigInt(expectedAllowance)],
        expires_at: expiresAt == null ? [] : [BigInt(expiresAt)],
    };
    const r = await approveAndRecord(ledgerActor(ledgerId, agent), ledgerId, args);
    if ('Err' in r) throw new Error(approveErrorText(r.Err));
    return r.Ok;
}

export function approveErrorText(err) {
    const k = Object.keys(err || {})[0];
    const v = err?.[k];
    switch (k) {
        case 'AllowanceChanged': return `The allowance changed meanwhile (now ${v.current_allowance}); refresh and try again.`;
        case 'InsufficientFunds': return 'Not enough balance to pay the ledger fee for this change.';
        case 'BadFee': return `The ledger wants a fee of ${v.expected_fee}.`;
        case 'Expired': return 'The expiry is in the past.';
        case 'TemporarilyUnavailable': return 'The ledger is busy; try again shortly.';
        case 'GenericError': return `Ledger error: ${v.message}`;
        default: return `The ledger refused: ${JSON.stringify(err, bigintJson)}`;
    }
}

export async function getLedgerFee(agent, ledgerId) {
    return ledgerActor(ledgerId, agent).icrc1_fee();
}

// ---- Spenders Sneed Hub approved (so mode 3 knows them) ----

const SPENDERS_KEY = 'sneed_approval_spenders_v1';
const MAX_PER_LEDGER = 50;
export const APPROVALS_CHANGED_EVENT = 'sneed-approvals-changed';

const storage = () => { try { return globalThis.localStorage || null; } catch { return null; } };

/// Remember that this app approved `spender` on `ledgerId` (best effort; never throws).
export function recordApprovalSpender(ledgerId, spender, fromSubaccount = null) {
    try {
        const ls = storage();
        if (ls && spender?.owner) {
            const all = JSON.parse(ls.getItem(SPENDERS_KEY) || '{}');
            const id = String(ledgerId);
            const owner = asPrincipal(spender.owner).toText();
            const sub = subaccountHex(spender.subaccount);
            const list = (all[id] || []).filter((x) => !(x.owner === owner && (x.sub || null) === sub));
            list.unshift({ owner, sub, from: subaccountHex(fromSubaccount), at: Date.now() });
            all[id] = list.slice(0, MAX_PER_LEDGER);
            ls.setItem(SPENDERS_KEY, JSON.stringify(all));
        }
    } catch { /* storage full or blocked */ }
    try { globalThis.dispatchEvent?.(new CustomEvent(APPROVALS_CHANGED_EVENT, { detail: { ledgerId: String(ledgerId) } })); } catch { /* node */ }
}

/// [{ owner, subaccount }] Sneed Hub approved on `ledgerId`.
export function getRecordedSpenders(ledgerId) {
    try {
        const ls = storage();
        if (!ls) return [];
        const all = JSON.parse(ls.getItem(SPENDERS_KEY) || '{}');
        return (all[String(ledgerId)] || []).map((x) => ({ owner: x.owner, subaccount: x.sub ? fromHex(x.sub) : null, recorded: true }));
    } catch { return []; }
}

/// Drop-in for `ledger.icrc2_approve(args)` that also records the spender. Returns the ledger's answer.
export async function approveAndRecord(ledger, ledgerId, args) {
    const r = await icrc2Approve(ledger, args);
    recordApprovalSpender(String(ledgerId), args.spender, optOne(args.from_subaccount));
    return r;
}

// ---- Cache (results survive a reload; bigints as strings) ----

const CACHE_KEY = 'sneed_approvals_cache_v1';
const CACHE_MAX_ENTRIES = 400;

export const bigintJson = (k, v) => (typeof v === 'bigint' ? v.toString() : v);

const serApproval = (a) => ({
    l: a.ledgerId, fo: a.from.owner.toText(), fs: subaccountHex(a.from.subaccount),
    so: a.spender ? a.spender.owner.toText() : null, ss: a.spender ? subaccountHex(a.spender.subaccount) : null,
    aid: a.spenderAccountId || null, amt: a.allowance.toString(), exp: a.expiresAt == null ? null : a.expiresAt.toString(),
    src: a.source, v: a.verified,
});
const deApproval = (x) => ({
    ledgerId: x.l, from: toAccount(x.fo, x.fs), spender: x.so ? toAccount(x.so, x.ss) : null,
    ...(x.aid ? { spenderAccountId: x.aid } : {}), allowance: BigInt(x.amt), expiresAt: x.exp == null ? null : BigInt(x.exp),
    source: x.src, verified: x.v,
});

export const cacheKeyFor = (ledgerId, owner, subaccount = null) => `${String(ledgerId)}|${accountKey(owner, subaccount)}`;

export function readApprovalsCache(key) {
    try {
        const all = JSON.parse(storage()?.getItem(CACHE_KEY) || '{}');
        const e = all[key];
        if (!e) return null;
        return { ...e, approvals: e.approvals.map(deApproval) };
    } catch { return null; }
}

export function writeApprovalsCache(key, result) {
    try {
        const ls = storage();
        if (!ls) return;
        const all = JSON.parse(ls.getItem(CACHE_KEY) || '{}');
        all[key] = { ...result, approvals: result.approvals.map(serApproval) };
        const keys = Object.keys(all);
        if (keys.length > CACHE_MAX_ENTRIES) {
            keys.sort((a, b) => (all[a].at || 0) - (all[b].at || 0)).slice(0, keys.length - CACHE_MAX_ENTRIES).forEach((k) => delete all[k]);
        }
        ls.setItem(CACHE_KEY, JSON.stringify(all));
    } catch { /* full or blocked */ }
}

export function dropApprovalsCache(predicate = () => true) {
    try {
        const ls = storage();
        if (!ls) return;
        const all = JSON.parse(ls.getItem(CACHE_KEY) || '{}');
        for (const k of Object.keys(all)) if (predicate(k)) delete all[k];
        ls.setItem(CACHE_KEY, JSON.stringify(all));
    } catch { /* ignore */ }
}
