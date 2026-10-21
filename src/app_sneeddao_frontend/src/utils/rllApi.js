// Reads of the RLL rewards canister (public/api-docs/rll.md) shared by /rll and /admin/rll.
//
// The paged event queries and get_event_statistics_status arrive with the RLL upgrade of
// proposal #444; the generated declarations may not list them yet, so they have their own small
// interface here. Before the upgrade the canister has no such methods: the loaders fall back to
// the unpaged lists (small enough for distributions and claims) and say so.
import { Actor, HttpAgent } from '@dfinity/agent';
import { createActor as createRllActor, canisterId as rllCanisterId } from 'declarations/rll';

export { rllCanisterId };

const isLocal = !(process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging');
export const RLL_HOST = isLocal ? 'http://localhost:4943' : 'https://icp0.io';

/// The RLL actor of the generated declarations, anonymous or as `identity`.
export const rllActor = (identity) => createRllActor(rllCanisterId, { agentOptions: identity ? { identity, host: RLL_HOST } : { host: RLL_HOST } });

const pagedIdl = ({ IDL }) => {
    const Range = IDL.Record({ first: IDL.Nat64, last: IDL.Nat64 });
    const DistributionEvent = IDL.Record({ token_id: IDL.Principal, proposal_range: Range, timestamp: IDL.Int, amount: IDL.Nat });
    const UserDistributionEvent = IDL.Record({ token_id: IDL.Principal, user: IDL.Principal, proposal_range: Range, timestamp: IDL.Int, amount: IDL.Nat });
    const ClaimEvent = IDL.Record({
        fee: IDL.Nat, status: IDL.Variant({ Failed: IDL.Null, Success: IDL.Null, Pending: IDL.Null }), tx_index: IDL.Opt(IDL.Nat),
        token_id: IDL.Principal, sequence_number: IDL.Nat, error_message: IDL.Opt(IDL.Text), timestamp: IDL.Nat64, hotkey: IDL.Principal, amount: IDL.Nat,
    });
    const page = (T) => IDL.Func([IDL.Nat, IDL.Nat], [IDL.Record({ total: IDL.Nat, events: IDL.Vec(T) })], ['query']);
    return IDL.Service({
        get_distribution_events_page: page(DistributionEvent),
        get_user_distribution_events_page: page(UserDistributionEvent),
        get_claim_events_page: page(ClaimEvent),
        get_event_statistics_status: IDL.Func([], [IDL.Record({
            distribution_events: IDL.Nat, user_distribution_events: IDL.Nat, claim_events: IDL.Nat,
            rebuilt_at: IDL.Int, rebuild_instructions: IDL.Nat64, postupgrade_instructions: IDL.Nat64,
        })], ['query']),
    });
};

/// An actor for the methods of #444 only (paged events, statistics status).
export function rllPagedActor(identity) {
    const agent = new HttpAgent(identity ? { identity, host: RLL_HOST } : { host: RLL_HOST });
    if (isLocal) agent.fetchRootKey().catch(() => {});
    return Actor.createActor(pagedIdl, { agent, canisterId: rllCanisterId });
}

const msgOf = (e) => e?.message || String(e);
/// The canister does not have the method (before its upgrade).
export const isMissingMethod = (e) => /no (update|query) method|has no (query|update) method|method not found|IC0536|IC0302/i.test(msgOf(e));
/// The call ran out of instructions (get_event_statistics on production before #444).
export const isInstructionLimit = (e) => /instruction|IC0522/i.test(msgOf(e));

/// Event statistics: { stats } or { fixing: true } (instruction limit, fixed by #444) or { error }.
export async function loadEventStatistics() {
    try {
        return { stats: await rllActor().get_event_statistics() };
    } catch (e) {
        if (isInstructionLimit(e)) return { fixing: true };
        return { error: msgOf(e) };
    }
}

/// get_event_statistics_status, or null before #444.
export async function loadEventStatisticsStatus() {
    try { return await rllPagedActor().get_event_statistics_status(); }
    catch (e) { if (isMissingMethod(e)) return null; throw e; }
}

/// A source of one event list, newest first: { total, paged, page(index, size) -> events }.
/// `paged` is false when the canister has no paged method yet and the whole list was read.
async function newestFirstSource(pagedMethod, fullMethod, identity) {
    const paged = rllPagedActor(identity);
    let total;
    try {
        total = Number((await paged[pagedMethod](0n, 0n)).total);
    } catch (e) {
        if (!isMissingMethod(e) || !fullMethod) throw e;
        const all = await rllActor(identity)[fullMethod]();
        const list = Array.isArray(all) ? all : ('ok' in all ? all.ok : []);
        const reversed = [...list].reverse();
        return { total: reversed.length, paged: false, page: async (index, size) => reversed.slice(index * size, index * size + size) };
    }
    return {
        total, paged: true,
        page: async (index, size) => {
            const end = Math.max(0, total - index * size);
            const start = Math.max(0, end - size);
            if (end <= start) return [];
            const r = await paged[pagedMethod](BigInt(start), BigInt(end - start));
            return [...r.events].reverse();
        },
    };
}

/// Distribution events (one per token per cycle), newest first.
export const distributionSource = () => newestFirstSource('get_distribution_events_page', 'get_distribution_events');

/// Every claim event, oldest first, read in pages of 2000 (or whole before #444).
export async function loadAllClaimEvents(identity) {
    const paged = rllPagedActor(identity);
    try {
        const first = await paged.get_claim_events_page(0n, 2000n);
        const total = Number(first.total);
        const events = [...first.events];
        while (events.length < total) {
            const r = await paged.get_claim_events_page(BigInt(events.length), 2000n);
            if (r.events.length === 0) break;
            events.push(...r.events);
        }
        return { events, paged: true };
    } catch (e) {
        if (!isMissingMethod(e)) throw e;
        return { events: await rllActor(identity).get_claim_events(), paged: false };
    }
}

export const claimStatusOf = (ev) => Object.keys(ev.status)[0]; // 'Pending' | 'Success' | 'Failed'

/// Claim events grouped by sequence number into one claim each, newest first:
/// { seq, hotkey, token, amount, fee, ts, status ('Success' | 'Failed' | 'Pending'), error, txIndex, events }.
/// A claim whose Pending event has no outcome is 'Pending'.
export function groupClaims(events) {
    const bySeq = new Map();
    for (const ev of events) {
        const key = String(ev.sequence_number);
        let c = bySeq.get(key);
        if (!c) { c = { seq: ev.sequence_number, events: [] }; bySeq.set(key, c); }
        c.events.push(ev);
    }
    const out = [];
    for (const c of bySeq.values()) {
        const outcome = c.events.find((e) => claimStatusOf(e) !== 'Pending');
        const first = c.events[0];
        const main = outcome || first;
        out.push({
            seq: c.seq, events: c.events, hotkey: main.hotkey, token: main.token_id.toText(),
            amount: main.amount, fee: main.fee, ts: main.timestamp, startedAt: first.timestamp,
            status: outcome ? claimStatusOf(outcome) : 'Pending',
            error: outcome?.error_message?.[0] ?? null,
            txIndex: outcome?.tx_index?.[0] ?? null,
        });
    }
    out.sort((a, b) => (a.seq > b.seq ? -1 : a.seq < b.seq ? 1 : 0));
    return out;
}

/// The error of a failed claim with its numbers taken out, so identical errors group together.
export const errorShape = (msg) => (msg || '(no message)').replace(/\d[\d_,.]*/g, 'N');

/// Nanosecond timestamp (int, nat64 or number) to a short local date and time.
export function fmtNs(ns) {
    if (ns === null || ns === undefined) return '';
    const ms = Number(BigInt(ns) / 1_000_000n);
    if (!ms) return '';
    return new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}
