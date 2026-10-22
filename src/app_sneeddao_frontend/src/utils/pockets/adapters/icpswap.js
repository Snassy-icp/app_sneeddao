// ICPSwap pools' unused balances as hosted, books-only pockets (one per pool, two tokens). Listing:
// the swap canisters the wallet knows (backend get_swap_canister_ids) plus pools the swap UI used
// (remembered here); a pool shows when I have an unused balance or a position in it. Withdraw goes
// to Main: pool.withdraw({ token; amount; fee }) debits `amount` and delivers amount - fee.
import { big, feeOf, minus, once, text, unwrapResult } from './common.js';

const REMEMBERED_KEY = 'sneed_pockets_icpswap_pools_v1';

/// Pools the swap UI used (localStorage; [] when unavailable).
export function rememberedPools() {
    try { const v = JSON.parse(localStorage.getItem(REMEMBERED_KEY) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
}
/// Remember a pool the swap UI used, so its leftovers show as a pocket.
export function rememberPool(poolId) {
    try {
        const id = text(poolId);
        const v = rememberedPools();
        if (!v.includes(id)) localStorage.setItem(REMEMBERED_KEY, JSON.stringify([...v, id].slice(-200)));
    } catch { /* storage blocked */ }
}

const pool = (ctx, id) => ctx.actor('icpswap_pool', text(id));
const unused = (ctx, id) => once(ctx, `icpswap:unused:${text(id)}`, async () => unwrapResult(await pool(ctx, id).getUserUnusedBalance(ctx.me), 'ICPSwap'));
const tokensOf = (ctx, id) => once(ctx, `icpswap:meta:${text(id)}`, async () => {
    const m = unwrapResult(await pool(ctx, id).metadata(), 'ICPSwap');
    return [m.token0.address, m.token1.address];
});

export const icpswapAdapter = {
    id: 'icpswap',
    name: 'ICPSwap',
    kind: 'hosted',
    receivesDirectly: false, // the pool's own books
    withdrawTo: 'main',
    async listMyAccounts(ctx) {
        const known = ctx.swapCanisters ? await ctx.swapCanisters() : [];
        const ids = [...new Set([...known.map(text), ...rememberedPools()])];
        const items = [];
        await Promise.all(ids.map(async (id) => {
            try {
                const [[t0, t1], u] = await Promise.all([tokensOf(ctx, id), unused(ctx, id)]);
                let positions = 0;
                try { const r = await pool(ctx, id).getUserPositionIdsByPrincipal(ctx.me); positions = 'ok' in r ? r.ok.length : 0; } catch { /* not every pool answers */ }
                if (big(u.balance0) === 0n && big(u.balance1) === 0n && positions === 0) return;
                const sym = async (l) => (ctx.ledgerMeta ? (await ctx.ledgerMeta(l))?.symbol : null) || `${l.slice(0, 5)}…`;
                items.push({ hostKey: id, account: null, label: `ICPSwap ${await sym(t0)}/${await sym(t1)}`, ledgers: [t0, t1], meta: { pool: id, token0: t0, token1: t1, positions } });
            } catch { /* one pool failing hides only that pool */ }
        }));
        return items.sort((a, b) => a.hostKey.localeCompare(b.hostKey));
    },
    async balance(ctx, pocket, ledger) {
        const [t0, t1] = await tokensOf(ctx, pocket.hostKey);
        const u = await unused(ctx, pocket.hostKey);
        const l = text(ledger);
        const t = l === t0 ? big(u.balance0) : l === t1 ? big(u.balance1) : 0n;
        return { total: t, available: t };
    },
    /// What can arrive in the wallet: the unused balance less the pool's transfer fee.
    async rules(ctx, pocket, ledger) {
        const [b, fee] = await Promise.all([icpswapAdapter.balance(ctx, pocket, ledger), feeOf(ctx, ledger)]);
        return { withdrawable: minus(b.total, fee), fee, why: null };
    },
    /// Deliver `amount` to Main: the pool is asked for amount + fee.
    async withdraw(ctx, pocket, ledger, amount) {
        const fee = await feeOf(ctx, ledger);
        const r = await pool(ctx, pocket.hostKey).withdraw({ token: text(ledger), amount: big(amount) + fee, fee });
        return unwrapResult(r, 'ICPSwap refused the withdrawal');
    },
};
