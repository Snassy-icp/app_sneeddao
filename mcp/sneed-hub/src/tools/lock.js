// Sneed Lock (pqsms-lqaaa-aaaal-ajjza-cai). Queries: get_lock_states_page (paged, filtered),
// get_lock_state (one lock). Amounts are converted with the token's ICRC-1 decimals.
import { z } from 'zod';
import { lockActor, toPrincipal, opt, ptext, HUB_URL, CANISTERS } from '../ic.js';
import { result, safe, variantKey, nsToIso, nsDuration, tokenInfo, formatUnits } from '../format.js';
import { namesOf, who } from './names.js';

const lockView = async (st, names) => {
  const kind = variantKey(st.kind) === 'TokenLock' ? 'token' : 'position';
  const ledger = opt(st.ledger);
  const amount = opt(st.amount);
  const nowNs = BigInt(Date.now()) * 1_000_000n;
  const dissolvingUntil = opt(st.dissolving_until);
  const v = {
    lock_id: st.lock_id,
    kind,
    owner: who(names, st.owner),
    status: st.archived ? 'archived (unlocked and withdrawn/cleared)' : st.locked ? 'locked' : 'unlocked (can be withdrawn by the owner)',
    lock_end: nsToIso(st.lock_end),
    earliest_unlock: nsToIso(st.earliest_unlock),
    dissolve_delay: nsDuration(st.dissolve_delay),
    dissolving_until: nsToIso(dissolvingUntil),
    created_at: nsToIso(opt(st.created_at)),
    url: `${HUB_URL}/lock/${st.lock_id}`,
  };
  if (kind === 'token' && ledger) {
    const t = await tokenInfo(ledger);
    v.token = { ledger: ptext(ledger), symbol: t.symbol, decimals: t.decimals };
    v.amount = amount != null ? (t.decimals != null ? `${formatUnits(amount, t.decimals)} ${t.symbol ?? ''}`.trim() : `${amount} base units`) : null;
    v.amount_base_units = amount != null ? amount.toString() : null;
  } else {
    const t0 = opt(st.token0), t1 = opt(st.token1);
    const [i0, i1] = await Promise.all([t0 ? tokenInfo(t0) : null, t1 ? tokenInfo(t1) : null]);
    v.position = {
      swap_canister_id: ptext(opt(st.swap_canister_id)),
      position_id: opt(st.position_id),
      token0: t0 ? { ledger: ptext(t0), symbol: i0?.symbol } : null,
      token1: t1 ? { ledger: ptext(t1), symbol: i1?.symbol } : null,
      dex: opt(st.dex),
    };
  }
  if (!st.archived && st.locked && BigInt(st.earliest_unlock) > nowNs) v.unlocks_in = nsDuration(BigInt(st.earliest_unlock) - nowNs);
  return v;
};

const pageQuery = ({ owner, ledger, token, swap, kind, status, include_archived, after, take }) => ({
  owner: owner ? [toPrincipal(owner)] : [],
  ledger: ledger ? [toPrincipal(ledger, 'ledger canister id')] : [],
  swap_canister_id: swap ? [toPrincipal(swap, 'swap canister id')] : [],
  token: token ? [toPrincipal(token, 'ledger canister id')] : [],
  kind: kind === 'token' ? [{ TokenLock: null }] : kind === 'position' ? [{ PositionLock: null }] : [],
  status: status === 'active' ? [{ Active: null }] : status === 'expired' ? [{ Expired: null }] : [],
  include_archived: Boolean(include_archived),
  prev: after != null ? [BigInt(after)] : [],
  take: [BigInt(take ?? 25)],
});

const viewAll = async (states) => {
  const names = await namesOf(states.map((s) => s.owner));
  return Promise.all(states.map((s) => lockView(s, names)));
};

export function registerLockTools(server) {
  server.registerTool('sneed_lock_list', {
    title: 'List Sneed Lock locks',
    description: `List Sneed Lock locks (canister ${CANISTERS.sneed_lock}), filtered by owner principal and/or token, paged in ascending lock id order. Uses get_lock_states_page. Locks are public on-chain records.`,
    inputSchema: {
      owner: z.string().optional().describe('Owner principal'),
      token: z.string().optional().describe('ICRC-1 ledger canister id: token locks of it and LP position locks with it as one side'),
      kind: z.enum(['token', 'position', 'any']).optional().describe('Lock kind (default any)'),
      status: z.enum(['active', 'expired', 'any']).optional().describe('active = still locked; expired = unlocked or archived (default any)'),
      include_archived: z.boolean().optional().describe('Include archived (withdrawn) locks; default false'),
      after: z.number().int().min(0).optional().describe('Page: only lock ids greater than this (use next_after from the previous page)'),
      limit: z.number().int().min(1).max(100).optional().describe('Page size (default 25)'),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, safe(async (a) => {
    const take = a.limit ?? 25;
    const lock = await lockActor();
    const states = await lock.get_lock_states_page(pageQuery({ ...a, kind: a.kind === 'any' ? null : a.kind, status: a.status === 'any' ? null : a.status, take }));
    const locks = await viewAll(states);
    const url = a.owner ? `${HUB_URL}/sneedlock_info?owner=${a.owner}` : a.token ? `${HUB_URL}/tokenlock?ledger=${a.token}` : `${HUB_URL}/sneedlock_info`;
    return result({
      count: locks.length,
      next_after: states.length === take ? states[states.length - 1].lock_id : null,
      sneed_hub_url: url,
      locks,
    });
  }));

  server.registerTool('sneed_lock_get', {
    title: 'Get a Sneed Lock lock',
    description: 'One Sneed Lock lock by id (token or LP position lock): owner, amount, lock end, dissolve delay, status. Uses get_lock_state.',
    inputSchema: { lock_id: z.number().int().min(0).describe('Lock id') },
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, safe(async ({ lock_id }) => {
    const lock = await lockActor();
    const st = opt(await lock.get_lock_state(BigInt(lock_id)));
    if (!st) return result({ lock_id, found: false, note: 'No lock with this id.' });
    return result(await lockView(st, await namesOf([st.owner])));
  }));

  server.registerTool('sneed_lock_token_totals', {
    title: 'Sneed Lock totals for a token',
    description: 'Totals of the active token locks of one ICRC-1 token: total locked, number of locks and owners, next unlock, plus the number of active LP position locks containing the token. Pages through get_lock_states_page.',
    inputSchema: { ledger: z.string().describe('ICRC-1 ledger canister id, e.g. hvgxa-wqaaa-aaaaq-aacia-cai (SNEED)') },
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, safe(async ({ ledger }) => {
    const lock = await lockActor();
    const t = await tokenInfo(ledger);
    let total = 0n, count = 0, after = null, pages = 0, truncated = false;
    const owners = new Map();
    let nextUnlock = null, lastUnlock = null;
    for (;;) {
      const page = await lock.get_lock_states_page(pageQuery({ ledger, kind: 'token', status: 'active', after, take: 500 }));
      for (const st of page) {
        const amt = opt(st.amount) ?? 0n;
        total += amt; count += 1;
        const o = st.owner.toText();
        owners.set(o, (owners.get(o) ?? 0n) + amt);
        const u = BigInt(st.earliest_unlock);
        if (nextUnlock == null || u < nextUnlock) nextUnlock = u;
        if (lastUnlock == null || u > lastUnlock) lastUnlock = u;
      }
      pages += 1;
      if (page.length < 500) break;
      if (pages >= 40) { truncated = true; break; }
      after = page[page.length - 1].lock_id;
    }
    let positionLocks = 0; after = null; pages = 0;
    for (;;) {
      const page = await lock.get_lock_states_page(pageQuery({ token: ledger, kind: 'position', status: 'active', after, take: 500 }));
      positionLocks += page.length; pages += 1;
      if (page.length < 500 || pages >= 20) break;
      after = page[page.length - 1].lock_id;
    }
    const fmt = (x) => (t.decimals != null ? `${formatUnits(x, t.decimals)} ${t.symbol ?? ''}`.trim() : `${x} base units`);
    const top = [...owners.entries()].sort((a, b) => (b[1] > a[1] ? 1 : b[1] < a[1] ? -1 : 0)).slice(0, 10);
    const names = await namesOf(top.map(([o]) => o));
    return result({
      token: { ledger, name: t.name, symbol: t.symbol, decimals: t.decimals },
      active_token_locks: count,
      total_locked: fmt(total),
      total_locked_base_units: total.toString(),
      owners: owners.size,
      largest_owners: top.map(([o, amt]) => ({ ...who(names, o), locked: fmt(amt) })),
      next_unlock: nextUnlock != null ? nsToIso(nextUnlock) : null,
      last_unlock: lastUnlock != null ? nsToIso(lastUnlock) : null,
      active_position_locks_with_token: positionLocks,
      truncated: truncated || undefined,
      sneed_hub_url: `${HUB_URL}/tokenlock?ledger=${ledger}`,
    });
  }));
}
