// Lists of Sneed Lock locks, paged (Sneed Lock v2 removed the whole-store queries such as
// get_all_token_locks, whose replies grow with every lock). Each helper walks
// get_lock_states_page and answers the same tuples the old query did, so callers keep their
// shape:
//   token locks:    [owner, ledger, { lock_id, amount, expiry }]
//   position locks: [owner, swap, { dex, lock_id, position_id, expiry, token0, token1 }]
// Against a Sneed Lock without get_lock_states_page (before the v2 upgrade) they call the old
// query instead, so this frontend can be deployed before or after the canister upgrade.
import { Actor } from '@dfinity/agent';
import { createActor as createSneedLockActor, canisterId as sneedLockCanisterId } from 'declarations/sneed_lock';

const PAGE = 500n;

const legacyIdl = ({ IDL }) => {
    const TokenLock = IDL.Tuple(IDL.Principal, IDL.Principal, IDL.Record({ lock_id: IDL.Nat, amount: IDL.Nat, expiry: IDL.Nat64 }));
    const PositionLock = IDL.Tuple(IDL.Principal, IDL.Principal, IDL.Record({
        dex: IDL.Nat, lock_id: IDL.Nat, position_id: IDL.Nat, expiry: IDL.Nat64, token0: IDL.Principal, token1: IDL.Principal,
    }));
    const q = (args, ret) => IDL.Func(args, [IDL.Vec(ret)], ['query']);
    return IDL.Service({
        get_all_token_locks: q([], TokenLock),
        get_active_token_locks: q([], TokenLock),
        get_expired_token_locks: q([], TokenLock),
        get_ledger_token_locks: q([IDL.Principal], TokenLock),
        get_all_position_locks: q([], PositionLock),
        get_active_position_locks: q([], PositionLock),
        get_expired_position_locks: q([], PositionLock),
        get_swap_position_locks: q([IDL.Principal], PositionLock),
        get_token_position_locks: q([IDL.Principal], PositionLock),
    });
};

/** The same agent and canister as `actor`, speaking the pre-v2 list queries. */
function legacyActor(actor) {
    const agent = Actor.agentOf(actor);
    const canisterId = Actor.canisterIdOf(actor);
    return Actor.createActor(legacyIdl, { agent, canisterId });
}

const isMissingMethod = (e) => /has no (query|update) method|method.*not found|no method|IC0536|Canister has no/i.test(String(e?.message || e));

/** Every LockState matching `filter` (fields of LockPageQuery; unspecified ones are open). */
export async function fetchAllLockStates(actor, filter = {}) {
    const out = [];
    let prev = [];
    for (;;) {
        const page = await actor.get_lock_states_page({
            owner: filter.owner ? [filter.owner] : [],
            ledger: filter.ledger ? [filter.ledger] : [],
            swap_canister_id: filter.swap ? [filter.swap] : [],
            token: filter.token ? [filter.token] : [],
            kind: filter.kind ? [{ [filter.kind]: null }] : [],
            status: filter.status ? [{ [filter.status]: null }] : [],
            include_archived: !!filter.includeArchived,
            prev,
            take: [PAGE],
        });
        out.push(...page);
        if (BigInt(page.length) < PAGE) break;
        prev = [page[page.length - 1].lock_id];
    }
    return out;
}

const tokenTuple = (s) => [s.owner, s.ledger[0], { lock_id: s.lock_id, amount: s.amount[0], expiry: s.expiry }];
const positionTuple = (s) => [s.owner, s.swap_canister_id[0], {
    dex: s.dex?.[0] ?? 1n, lock_id: s.lock_id, position_id: s.position_id[0], expiry: s.expiry, token0: s.token0[0], token1: s.token1[0],
}];

async function list(actor, filter, toTuple, legacyCall) {
    const a = actor || createSneedLockActor(sneedLockCanisterId);
    try {
        return (await fetchAllLockStates(a, filter)).map(toTuple);
    } catch (e) {
        if (!isMissingMethod(e)) throw e;
        return legacyCall(legacyActor(a));
    }
}

// Same answers as the removed queries of the same names.
export const getAllTokenLocks = (actor) => list(actor, { kind: 'TokenLock' }, tokenTuple, (l) => l.get_all_token_locks());
export const getActiveTokenLocks = (actor) => list(actor, { kind: 'TokenLock', status: 'Active' }, tokenTuple, (l) => l.get_active_token_locks());
export const getExpiredTokenLocks = (actor) => list(actor, { kind: 'TokenLock', status: 'Expired', includeArchived: true }, tokenTuple, (l) => l.get_expired_token_locks());
export const getLedgerTokenLocks = (actor, ledger) => list(actor, { kind: 'TokenLock', ledger, includeArchived: true }, tokenTuple, (l) => l.get_ledger_token_locks(ledger));
export const getAllPositionLocks = (actor) => list(actor, { kind: 'PositionLock' }, positionTuple, (l) => l.get_all_position_locks());
export const getActivePositionLocks = (actor) => list(actor, { kind: 'PositionLock', status: 'Active' }, positionTuple, (l) => l.get_active_position_locks());
export const getExpiredPositionLocks = (actor) => list(actor, { kind: 'PositionLock', status: 'Expired', includeArchived: true }, positionTuple, (l) => l.get_expired_position_locks());
export const getSwapPositionLocks = (actor, swap) => list(actor, { kind: 'PositionLock', swap, includeArchived: true }, positionTuple, (l) => l.get_swap_position_locks(swap));
export const getTokenPositionLocks = (actor, token) => list(actor, { kind: 'PositionLock', token }, positionTuple, (l) => l.get_token_position_locks(token));
