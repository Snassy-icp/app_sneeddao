// The pocket registry (spec/programmable_accounts.md §4.7): every pocket created in Sneed Hub, and
// every one discovery finds with a balance, is the `pocket` field of the user's account entry in
// sneed_pid_nicknames, next to its private name. A new device finds them without scanning; without
// a sign-in or when the call fails, the localStorage mirror (NamingService) and discovery still work.
//
// Entries (plain form, see NamingService):
//   { account: { owner, subaccount }, nickname, pocket: { host, ledgers, hidden, createdAt } | null, updatedAt }
// mergePockets (model.js) takes them as its `registry`.
import * as NS from '../NamingService.js';
import { accountKey } from './model.js';
import { canonical } from './subaccount.js';

const text = (p) => (typeof p === 'string' ? p : p.toText());
const nowNs = () => BigInt(Date.now()) * 1_000_000n;

/// A registry bound to one signed-in identity. `ns` is the naming client (NamingService by default;
/// tests pass their own).
export function createRegistry(identity, ns = NS) {
    let entries = identity ? ns.loadAccountNicknamesMirror(identity) : [];
    const byKey = () => new Map(entries.map((e) => [accountKey(e.account), e]));
    const metaOf = (account) => byKey().get(accountKey(account))?.pocket ?? null;

    return {
        /// What is known now (the mirror until refresh() returns).
        entries: () => entries,
        /// Reload from the canister (the mirror is refreshed by the call). Keeps the mirror on failure.
        async refresh() {
            if (!identity) return entries;
            entries = await ns.getMyAccountNicknames(identity);
            return entries;
        },
        get: (account) => byKey().get(accountKey(account)) || null,
        /// Remember pockets (one batched update): items = [{ account, host?, ledgers?, hidden? }].
        /// Pockets already remembered keep their meta, gaining the new ledgers. Returns the results.
        async remember(items) {
            const writes = [];
            for (const it of items) {
                const old = metaOf(it.account);
                const ledgers = [...new Set([...(old?.ledgers || []), ...(it.ledgers || []).map(text)])].slice(0, 20);
                if (old && ledgers.length === old.ledgers.length && (it.hidden == null || it.hidden === old.hidden)) continue; // nothing new
                writes.push({
                    account: { owner: it.account.owner, subaccount: canonical(it.account.subaccount ?? null) },
                    pocket: { host: it.host ?? old?.host ?? null, ledgers, hidden: it.hidden ?? old?.hidden ?? false, createdAt: old?.createdAt ?? nowNs() },
                });
            }
            if (!writes.length || !identity) return [];
            const results = await ns.setPockets(identity, writes);
            entries = ns.loadAccountNicknamesMirror(identity);
            return results;
        },
        async rename(account, nickname) {
            const r = await ns.setAccountNickname(identity, account, nickname.trim());
            entries = ns.loadAccountNicknamesMirror(identity);
            return r;
        },
        async setHidden(account, hidden, host = null) {
            const old = metaOf(account);
            const r = await ns.setPocket(identity, account, { host: old?.host ?? host, ledgers: old?.ledgers || [], hidden, createdAt: old?.createdAt ?? nowNs() });
            entries = ns.loadAccountNicknamesMirror(identity);
            return r;
        },
        /// Registry only: the name stays, and a pocket with a balance is found again by discovery.
        async forget(account) {
            const r = await ns.setPocket(identity, account, null);
            entries = ns.loadAccountNicknamesMirror(identity);
            return r;
        },
    };
}
