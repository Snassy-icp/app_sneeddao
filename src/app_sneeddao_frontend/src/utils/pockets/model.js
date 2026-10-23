// The pockets model (spec/programmable_accounts.md §4.1, §4.3, §4.6, §4.8). Pure: no React, no
// network. Every account that is the user's and holds tokens is a pocket:
//   - wallet pocket:  { owner = me; subaccount }            (Main, #1, #2, ..., exact subaccounts)
//   - hosted pocket:  an account a canister holds for me     (Sneed Lock wallet, Sneedex escrows, ICPSwap)
//   - service balance: a balance in a service's own books   (Sneed Monitor, Sneed Notifications)
//
//   Pocket = { id, kind, adapterId, account, number, label, nickname, defaultLabel, host,
//              balances: Map<ledger, { total, available, locked?, note? }>, ledgers: string[],
//              caps, grants, hidden, hostKey, status: 'ok' | 'error' | 'unknown', error }
//
// Totals always count every pocket, hidden or not; "hidden" only takes a pocket out of lists,
// pickers and the switcher.
import { Principal } from '@dfinity/principal';
import { bytesToHex, canonical, pocketNumber, shortSubaccount, isDefault, subaccountToNumber, MAX_POCKET_NUMBER } from './subaccount.js';

export const KIND = { wallet: 'wallet', hosted: 'hosted', service: 'service' };
export const WALLET_ADAPTER = 'wallet';
export const ALL = 'all';

const text = (p) => (p == null ? '' : typeof p === 'string' ? p : p.toText());
const toPrincipal = (p) => (typeof p === 'string' ? Principal.fromText(p) : p);
const big = (v) => { try { return v == null ? 0n : BigInt(v); } catch { return 0n; } };

// ---- ids and keys ----

/// The canonical key of an ICRC-1 account: "<owner>:<hex>" ("<owner>:0" for the default account).
export function accountKey(account) {
    if (!account) return null;
    const sub = canonical(account.subaccount ?? null);
    return `${text(account.owner)}:${sub ? bytesToHex(sub) : '0'}`;
}

export const walletPocketId = (subaccount) => { const s = canonical(subaccount ?? null); return `w:${s ? bytesToHex(s) : '0'}`; };
export const hostedPocketId = (adapterId, hostKey) => `h:${adapterId}:${hostKey}`;
export const servicePocketId = (adapterId, hostKey) => `s:${adapterId}:${hostKey}`;
export const MAIN_ID = 'w:0';

/// What a pocket's buttons may do (§4.2): wallet pockets do everything with the user's key.
export const WALLET_CAPS = Object.freeze({ receive: true, deposit: false, withdraw: true, send: true, approve: true, readOnly: false, withdrawTo: 'any' });

// ---- constructors ----

/// A wallet pocket of `me` on `subaccount` (null = Main).
export function walletPocket(me, subaccount = null, extra = {}) {
    const sub = canonical(subaccount);
    return {
        id: walletPocketId(sub),
        kind: KIND.wallet,
        adapterId: WALLET_ADAPTER,
        hostKey: sub ? bytesToHex(sub) : '0',
        account: { owner: toPrincipal(me), subaccount: sub },
        number: sub ? pocketNumber(sub) : null,
        nickname: '',
        defaultLabel: sub ? '' : 'Main',
        host: null,
        balances: new Map(),
        ledgers: [],
        caps: WALLET_CAPS,
        grants: 0,
        hidden: false,
        status: 'ok',
        error: null,
        ...extra,
    };
}

/// A hosted pocket or service balance listed by an adapter: `item` = { hostKey, account?, label?, ledgers? }.
export function adapterPocket(adapter, item, extra = {}) {
    const kind = adapter.kind === KIND.service ? KIND.service : KIND.hosted;
    const account = item.account ? { owner: toPrincipal(item.account.owner), subaccount: canonical(item.account.subaccount ?? null) } : null;
    return {
        id: kind === KIND.service ? servicePocketId(adapter.id, item.hostKey) : hostedPocketId(adapter.id, item.hostKey),
        kind,
        adapterId: adapter.id,
        hostKey: String(item.hostKey),
        account,
        number: null,
        nickname: '',
        defaultLabel: item.label || adapter.name,
        host: adapter.name,
        balances: new Map(),
        ledgers: (item.ledgers || []).map(text),
        caps: { ...defaultCaps(adapter), ...(item.caps || {}) },
        grants: item.grants || 0,
        meta: item.meta ?? null, // the adapter's own data about this pocket (a bid, a pool's tokens)
        hidden: false,
        status: 'ok',
        error: null,
        ...extra,
    };
}

/// An adapter's capabilities from the functions it ships (absent = can't).
export function defaultCaps(adapter) {
    const readOnly = typeof adapter.withdraw !== 'function';
    return {
        receive: adapter.kind !== KIND.service && Boolean(adapter.receivesDirectly),
        deposit: typeof adapter.deposit === 'function',
        withdraw: !readOnly,
        send: false,
        approve: false,
        readOnly,
        withdrawTo: adapter.withdrawTo || 'any',
        quiet: Boolean(adapter.quiet), // escrows that clutter: shown only when something can be withdrawn
        ...(adapter.caps || {}),
    };
}

// ---- display ----

/// "Savings · #3", "Main", "#7", "Savings · #0a1b…"; hosted: "Sneed Lock wallet", "Bots · Sneed Lock" (§4.6).
export function displayName(p) {
    const nick = (p.nickname || '').trim();
    if (p.kind === KIND.wallet) {
        const tag = p.account?.subaccount ? shortSubaccount(p.account.subaccount) : 'Main';
        if (!nick) return tag;
        return `${nick} · ${tag}`;
    }
    if (!nick) return p.defaultLabel || p.host || p.adapterId;
    return `${nick} · ${p.host || p.adapterId}`;
}

/// The badge text: "Wallet", the host's name, or "Service balance".
export const badge = (p) => (p.kind === KIND.wallet ? 'Wallet' : p.kind === KIND.service ? 'Service balance' : p.host || p.adapterId);

// ---- balances ----

/// A balance record: { total, available, locked?, note? } with bigint amounts.
export function balanceRecord(b) {
    if (b == null) return null;
    if (typeof b === 'bigint' || typeof b === 'number' || typeof b === 'string') { const t = big(b); return { total: t, available: t }; }
    const total = big(b.total);
    const out = { total, available: b.available == null ? total : big(b.available) };
    if (b.locked != null) out.locked = big(b.locked);
    if (b.note) out.note = b.note;
    return out;
}

/// The pocket with `ledger`'s balance set (a new object; the input is not changed).
export function withBalance(p, ledger, b) {
    const balances = new Map(p.balances);
    const r = balanceRecord(b);
    const l = text(ledger);
    if (r) balances.set(l, r); else balances.delete(l);
    const ledgers = p.ledgers.includes(l) ? p.ledgers : [...p.ledgers, l];
    return { ...p, balances, ledgers };
}

export const balanceOf = (p, ledger) => p.balances.get(text(ledger)) || null;
export const totalIn = (p, ledger) => balanceOf(p, ledger)?.total ?? 0n;

// ---- merge (§4.8: registry first, then discovery, then each adapter) ----

/// Merge every source into one list, deduplicated by account (and by id for books-only balances).
///   me:          the user's principal
///   registry:    account entries from the naming service ({ account, nickname, pocket: meta|null })
///                (the caller's own entries: names for any account, pocket meta for their pockets)
///   discovered:  wallet subaccounts found by discovery: [{ subaccount, ledger?, balance? }]
///   hosted:      [{ adapter, items: [{ hostKey, account?, label?, ledgers?, caps? }], error? }]
///   balances:    Map<pocketId, Map<ledger, balance>> (optional; also settable later with withBalance)
export function mergePockets({ me, registry = [], discovered = [], hosted = [], balances = null }) {
    const meText = text(me);
    const byKey = new Map(); // accountKey -> pocket id
    const byId = new Map();
    const order = [];
    const put = (p) => {
        const old = byId.get(p.id);
        if (!old) order.push(p.id);
        const merged = old ? mergeOne(old, p) : p;
        byId.set(p.id, merged);
        const k = accountKey(merged.account);
        if (k) byKey.set(k, merged.id);
        return merged;
    };
    const findByAccount = (account) => { const k = accountKey(account); return k && byKey.has(k) ? byId.get(byKey.get(k)) : null; };

    put(walletPocket(meText));

    // names for any account; pocket meta makes it a pocket
    const names = new Map();
    for (const e of registry) {
        const k = accountKey(e.account);
        if (!k) continue;
        names.set(k, e);
        const meta = e.pocket ?? null;
        if (!meta) continue;
        if (!meta.host && text(e.account.owner) === meText) {
            put(walletPocket(meText, e.account.subaccount, { hidden: Boolean(meta.hidden), ledgers: (meta.ledgers || []).map(text), registered: true }));
        }
    }

    for (const d of discovered) {
        const p = walletPocket(meText, d.subaccount, { ledgers: d.ledger ? [text(d.ledger)] : [], discovered: true });
        const merged = put(p);
        if (d.ledger && d.balance != null) byId.set(merged.id, withBalance(merged, d.ledger, d.balance));
    }

    const failedAdapters = new Set();
    for (const h of hosted) {
        if (h.error) { failedAdapters.add(h.adapter.id); continue; }
        for (const item of h.items || []) {
            const p = adapterPocket(h.adapter, item);
            const same = p.account ? findByAccount(p.account) : null;
            if (same && same.id !== p.id && same.kind === KIND.wallet) continue; // never shadow a wallet pocket
            put(p);
        }
    }

    // pockets the registry remembers on a host that couldn't be read: keep them, marked
    for (const e of registry) {
        const meta = e.pocket ?? null;
        if (!meta?.host || findByAccount(e.account)) continue;
        const adapterId = meta.host;
        const failed = failedAdapters.has(adapterId);
        put({
            ...adapterPocket({ id: adapterId, name: adapterId, kind: KIND.hosted }, { hostKey: accountKey(e.account), account: e.account, ledgers: meta.ledgers }),
            hidden: Boolean(meta.hidden), registered: true, status: failed ? 'error' : 'unknown', error: failed ? `couldn't read ${adapterId}` : null,
        });
    }

    // adapters that failed: one marker pocket each, so the UI can say "couldn't read <host>"
    for (const h of hosted) {
        if (!h.error) continue;
        put({ ...adapterPocket(h.adapter, { hostKey: '*' }), status: 'error', error: String(h.error?.message || h.error) });
    }

    // nicknames and hidden flags from the registry apply to whichever pocket has the account
    for (const id of order) {
        const p = byId.get(id);
        const e = p.account ? names.get(accountKey(p.account)) : null;
        let q = p;
        if (e) q = { ...q, nickname: e.nickname || '', hidden: e.pocket ? Boolean(e.pocket.hidden) : q.hidden, registered: Boolean(e.pocket) || q.registered };
        const bs = balances?.get(id);
        if (bs) for (const [l, b] of bs) q = withBalance(q, l, b);
        byId.set(id, q);
    }
    return order.map((id) => byId.get(id));
}

function mergeOne(a, b) {
    const ledgers = [...a.ledgers];
    for (const l of b.ledgers) if (!ledgers.includes(l)) ledgers.push(l);
    const balances = new Map(a.balances);
    for (const [l, v] of b.balances) balances.set(l, v);
    return {
        ...a,
        ...Object.fromEntries(Object.entries(b).filter(([, v]) => v !== undefined && v !== null && v !== '')),
        ledgers,
        balances,
        hidden: a.hidden || b.hidden,
        registered: a.registered || b.registered,
        discovered: a.discovered || b.discovered,
    };
}

// ---- totals, holders, selection ----

/// A token's total over every pocket (hidden ones too), or over the selected pocket.
export function total(pockets, ledger, selected = ALL) {
    let t = 0n;
    for (const p of pockets) if (selected === ALL || selected == null || p.id === selected) t += countedIn(p, ledger);
    return t;
}

// ---- quiet hosts (Sneedex escrows) ----

/// Escrows a host keeps for a pending action (Sneedex bids and the offer-creation payment): the
/// user's to take only in part, so they count with what can be withdrawn now (`available`).
export const isQuiet = (p) => Boolean(p.caps?.quiet);

/// What a pocket adds to a token's total: everything, or for quiet pockets what can leave now.
export const countedIn = (p, ledger) => (isQuiet(p) ? balanceOf(p, ledger)?.available ?? 0n : totalIn(p, ledger));

/// Something in any ledger the user can withdraw now.
export function hasWithdrawable(p) {
    for (const b of p.balances.values()) if ((b.available ?? b.total) > 0n) return true;
    return false;
}

/// Quiet pockets stay out of lists, pickers and the switcher (marked hidden + quietHidden) unless
/// they hold something withdrawable, carry a name, or the user turned "Show Sneedex escrows" on.
export function applyQuiet(pockets, { showQuiet = false } = {}) {
    return pockets.map((p) => {
        if (!isQuiet(p) || showQuiet || hasWithdrawable(p) || (p.nickname || '').trim()) return p.quietHidden ? { ...p, hidden: p.hiddenByUser ?? false, quietHidden: false } : p;
        return { ...p, hiddenByUser: p.hiddenByUser ?? p.hidden, hidden: true, quietHidden: true };
    });
}

/// The pockets holding `ledger` (balance > 0), visible ones only unless includeHidden.
export function holders(pockets, ledger, { includeHidden = false } = {}) {
    return pockets.filter((p) => countedIn(p, ledger) > 0n && (includeHidden || !p.hidden));
}

/// The "in N pockets" disclosure shows only when more than one pocket holds the token.
export const showDisclosure = (pockets, ledger) => holders(pockets, ledger).length > 1;

/// Whether a pocket appears in lists and pickers (§4.8): not hidden; Main always; named pockets
/// even when empty; unnamed ones only with a balance (in `ledger`, or in any ledger); service
/// balances and pockets that couldn't be read always.
export function isListed(p, ledger = null) {
    if (p.hidden) return false;
    if (p.id === MAIN_ID || p.kind === KIND.service || p.status === 'error') return true;
    if ((p.nickname || '').trim()) return true;
    if (ledger != null) return totalIn(p, ledger) > 0n;
    for (const b of p.balances.values()) if (b.total > 0n) return true;
    return false;
}

export const listed = (pockets, ledger = null) => pockets.filter((p) => isListed(p, ledger));

/// The pockets a picker offers for a ledger and a purpose (§4.5): 'from' = can send and holds it,
/// 'to' / 'receive' = can receive it, 'approve' = can approve.
export function pickable(pockets, ledger, filter = 'from') {
    return pockets.filter((p) => {
        if (p.hidden || p.status === 'error') return false;
        if (filter === 'from') return (p.caps.send || p.caps.withdraw) && totalIn(p, ledger) > 0n;
        if (filter === 'to') return p.kind === KIND.wallet || p.caps.deposit;
        if (filter === 'receive') return p.caps.receive;
        if (filter === 'approve') return p.caps.approve;
        return true;
    });
}

/// What the switcher does to the token list (§4.3): with one pocket selected, every token shows only
/// that pocket's balance, and (hideEmpty) tokens it does not hold are dropped. `ledgers` = the
/// wallet's ledger ids. Returns [{ ledger, balance }].
export function tokensForSelection(pockets, ledgers, selected = ALL, { hideEmpty = true } = {}) {
    const out = [];
    for (const l of ledgers.map(text)) {
        const b = total(pockets, l, selected);
        if (selected !== ALL && hideEmpty && b === 0n) continue;
        out.push({ ledger: l, balance: b });
    }
    return out;
}

/// The selection after a refresh: the same pocket if it still exists and is not hidden, else All.
export const validSelection = (pockets, selected) => (selected && selected !== ALL && pockets.some((p) => p.id === selected && !p.hidden) ? selected : ALL);

// ---- numbers ----

/// The numbers in use by wallet pockets (from any source).
export const usedNumbers = (pockets) => new Set(pockets.filter((p) => p.kind === KIND.wallet && p.number != null).map((p) => p.number));

/// The smallest pocket number >= 1 not in use ("Receive on a new pocket"). With `registry` (and
/// `me`), numbers of the user's own named accounts count as taken too, so a new pocket never
/// inherits the name of a forgotten one.
export function nextFreeNumber(pocketsOrNumbers, { registry = [], me = null } = {}) {
    const used = pocketsOrNumbers instanceof Set ? new Set(pocketsOrNumbers) : Array.isArray(pocketsOrNumbers) && typeof pocketsOrNumbers[0] === 'number' ? new Set(pocketsOrNumbers) : usedNumbers(pocketsOrNumbers || []);
    for (const e of registry) {
        if (me && text(e.account.owner) !== text(me)) continue;
        const n = e.account.subaccount ? pocketNumber(e.account.subaccount) : null;
        if (n != null) used.add(n);
    }
    let n = 1;
    while (used.has(n)) n++;
    if (BigInt(n) > MAX_POCKET_NUMBER) throw new Error('No free pocket number');
    return n;
}

/// Wallet pockets whose subaccount parses as [L][principal]... get a hint (§4.10).
export function isPrincipalShaped(sub) {
    if (isDefault(sub)) return false;
    const b = canonical(sub);
    return b[0] >= 1 && b[0] <= 29;
}

/// Sort for lists: Main first, then numbered wallet pockets by number, exact ones, hosted, services.
export function sortPockets(pockets) {
    const rank = (p) => (p.id === MAIN_ID ? 0 : p.kind === KIND.wallet ? (p.number != null ? 1 : 2) : p.kind === KIND.hosted ? 3 : 4);
    return [...pockets].sort((a, b) => {
        const r = rank(a) - rank(b);
        if (r) return r;
        if (a.kind === KIND.wallet && b.kind === KIND.wallet) {
            const x = subaccountToNumber(a.account.subaccount); const y = subaccountToNumber(b.account.subaccount);
            return x < y ? -1 : x > y ? 1 : 0;
        }
        return displayName(a).localeCompare(displayName(b));
    });
}

// ---- the wallet's own token data (Main and the Sneed Lock wallet) ----

export const LOCK_POCKET_ID = 'h:sneed_lock:wallet';

/// Main's and the Sneed Lock wallet's balances from the wallet's token list (which already reads
/// them: `balance`, `balance_backend`, `locked`), so the model never reads them twice.
/// `tokens` = [{ ledger, balance, balance_backend?, locked? }].
export function withWalletTokens(pockets, tokens) {
    const byLedger = new Map(tokens.filter((t) => t && t.ledger).map((t) => [text(t.ledger), t]));
    return pockets.map((p) => {
        let q = p;
        for (const [l, t] of byLedger) {
            if (p.id === MAIN_ID && t.balance != null) q = withBalance(q, l, big(t.balance));
            if (p.id === LOCK_POCKET_ID && t.balance_backend != null) {
                const total = big(t.balance_backend);
                const locked = big(t.locked);
                q = withBalance(q, l, { total, available: total > locked ? total - locked : 0n, locked });
            }
        }
        return q;
    });
}

/// What the wallet's token list does not count: every pocket but Main and the Sneed Lock wallet
/// (hidden ones too), so a token card's total is Main + Sneed Lock + this.
export const otherPocketsTotal = (pockets, ledger) => pockets.filter((p) => p.id !== MAIN_ID && p.id !== LOCK_POCKET_ID).reduce((t, p) => t + countedIn(p, ledger), 0n);

/// Casual and pro (§4.3): pockets stay out of sight while the user has nothing but Main and the
/// Sneed Lock wallet (the wallet showed those before pockets existed).
export const hasExtraPockets = (pockets) => pockets.some((p) => p.id !== MAIN_ID && p.id !== LOCK_POCKET_ID && isListed(p));

/// The ICRC-1 account a pocket receives on, or null (books-only balances).
export const receiveAccount = (p) => (p.caps?.receive || p.kind === KIND.wallet ? p.account : null);
