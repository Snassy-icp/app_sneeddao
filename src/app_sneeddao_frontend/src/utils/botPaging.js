// Paging helpers for the bots' list getters (spec/paging_audit.md, bot items).
//
// Since trading bot 0.9.4 / staking bot 0.9.5 the bots cap every page (trade log and bot log 500,
// portfolio and purse snapshots 200, price history and daily rows 1000, and about 1 MB per reply)
// and can return snapshots, daily summaries, candles and price history newest first
// (`newestFirst`, with `offset` counted from the newest). Earlier bots ignore the new fields and
// answer oldest first without a cap: these helpers notice that and fall back, so one code path
// serves every bot version.

export const BOT_PAGE = { tradeLog: 500, logs: 500, snapshots: 200, priceHistory: 1000, daily: 1000 };

const big = (n) => BigInt(n);

/// Up to `want` newest rows from an offset-paged getter (getPriceHistory, getDailyPortfolioSummaries,
/// getDailyPriceCandles). `call(query)` resolves to { entries, totalCount }; `base` is the query
/// without limit/offset/newestFirst; `order(row)` grows with time. Returns the rows oldest first.
export async function fetchNewestRows({ call, base, want, pageSize, order }) {
    const first = await call({ ...base, limit: [big(Math.min(want, pageSize))], offset: [0n], newestFirst: [true] });
    let rows = first.entries || [];
    const total = Number(first.totalCount ?? rows.length);
    const oldestFirst = rows.length >= 2 && order(rows[0]) < order(rows[rows.length - 1]);
    if (oldestFirst) {
        // a bot from before the paging fixes: no cap, oldest first; ask for the tail by offset
        if (total <= rows.length) return rows;
        const tail = await call({ ...base, limit: [big(want)], offset: [big(Math.max(0, total - want))], newestFirst: [true] });
        return tail.entries || [];
    }
    while (rows.length < want && rows.length < total) {
        const page = await call({ ...base, limit: [big(Math.min(want - rows.length, pageSize))], offset: [big(rows.length)], newestFirst: [true] });
        const got = page.entries || [];
        if (got.length === 0) break;
        rows = rows.concat(got);
    }
    return rows.reverse();
}

/// Up to `want` newest snapshots (getPortfolioSnapshots, or getPursePortfolioSnapshots bound to a
/// purse). `call(query)` resolves to { entries, totalCount, hasMore }; `base` holds the filters.
/// For bots from before the paging fixes, `getNextId` (optional, from getPortfolioSnapshotStats)
/// lets the fallback ask for the newest ids instead of the oldest. Returns the snapshots oldest first.
export async function fetchNewestSnapshots({ call, base, want, pageSize = BOT_PAGE.snapshots, getNextId }) {
    const first = await call({ ...base, limit: [big(Math.min(want, pageSize))], offset: [0n], newestFirst: [true] });
    let rows = first.entries || [];
    const oldestFirst = rows.length >= 2 && rows[0].id < rows[rows.length - 1].id;
    if (oldestFirst) {
        if (!first.hasMore || !getNextId) return rows;
        const nextId = Number(await getNextId());
        const span = want * 2; // Before and After snapshots share the id sequence
        const fromId = Math.max(0, nextId - span);
        const r = await call({ ...base, startId: [big(fromId)], limit: [big(span)], offset: [], newestFirst: [] });
        return (r.entries || []).slice(-want);
    }
    let hasMore = first.hasMore;
    while (hasMore && rows.length < want) {
        const page = await call({ ...base, limit: [big(Math.min(want - rows.length, pageSize))], offset: [big(rows.length)], newestFirst: [true] });
        const got = page.entries || [];
        if (got.length === 0) break;
        rows = rows.concat(got);
        hasMore = page.hasMore;
    }
    return rows.reverse();
}

/// Every trade log entry matching `base` (the bot caps a page at 500: page with offset), newest
/// first, stopping at `max` entries.
export async function fetchAllTradeLog(bot, base, max = 100_000) {
    const all = [];
    for (;;) {
        const page = await bot.getTradeLog({ ...base, limit: [big(BOT_PAGE.tradeLog)], offset: [big(all.length)] });
        const got = page.entries || [];
        all.push(...got);
        if (!page.hasMore || got.length === 0 || all.length >= max) break;
    }
    return all;
}

/// The next older page of bot log entries before the oldest one shown (`filter` without
/// startId/beforeId). Bots before the paging fixes ignore `beforeId` and answer with the newest
/// entries again; then this returns null and the caller falls back to a larger `limit`.
export async function fetchOlderLogs(bot, filter, oldestId, pageSize) {
    const res = await bot.getLogs({ ...filter, startId: [], beforeId: [big(oldestId)], limit: [big(pageSize)] });
    const entries = res.entries || [];
    if (entries.some((e) => BigInt(e.id) >= BigInt(oldestId))) return null;
    return { entries, hasMore: res.hasMore };
}
