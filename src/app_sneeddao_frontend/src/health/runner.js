// Runs a check tree. Leaves run concurrently (bounded); a group's status is
// the worst of its children's. Results are reported through onUpdate so the
// page can render progressively.
import { withTimeout } from './agent.js';

export const RANK = { fail: 4, error: 4, warn: 3, running: 2, pass: 1, skip: 0, pending: 0 };
export const worst = (statuses) => statuses.reduce((a, b) => (RANK[b] > RANK[a] ? b : a), 'skip');

function makeCtx(config) {
    const memo = new Map();
    return {
        config,
        load(key, loader) {
            if (!memo.has(key)) memo.set(key, Promise.resolve().then(() => loader(this)));
            return memo.get(key);
        },
        call(promise, what, seconds = config.callTimeoutSec) { return withTimeout(promise, seconds * 1000, what); },
    };
}

/// Resolve dynamic groups (children given as a function) into a static tree.
async function expand(node, ctx) {
    if (!node.children) return node;
    try {
        const children = typeof node.children === 'function' ? await node.children(ctx) : node.children;
        return { ...node, children: await Promise.all(children.map((ch) => expand(ch, ctx))) };
    } catch (e) {
        return { id: node.id, name: node.name, run: async () => ({ status: 'fail', summary: `Could not list checks: ${e.message || e}` }) };
    }
}

export async function runTree(tree, config, onUpdate, concurrency = 6) {
    const ctx = makeCtx(config);
    const expanded = await expand(tree, ctx);
    const results = new Map(); // leaf id -> result
    const leaves = [];
    const collect = (n) => (n.children ? n.children.forEach(collect) : leaves.push(n));
    collect(expanded);
    for (const l of leaves) results.set(l.id, { status: 'pending' });
    onUpdate?.({ tree: expanded, results: new Map(results) });

    let next = 0;
    const worker = async () => {
        while (next < leaves.length) {
            const leaf = leaves[next++];
            results.set(leaf.id, { status: 'running' });
            onUpdate?.({ tree: expanded, results: new Map(results) });
            const t0 = Date.now();
            let r;
            try {
                r = await withTimeout(leaf.run(ctx), config.callTimeoutSec * 1000 + 5000, leaf.name);
                if (!r || !r.status) r = { status: 'fail', summary: 'Check returned nothing' };
            } catch (e) {
                r = { status: 'fail', summary: `Error: ${e?.message || String(e)}` };
            }
            results.set(leaf.id, { ...r, link: r.link || leaf.link, ms: Date.now() - t0 });
            onUpdate?.({ tree: expanded, results: new Map(results) });
        }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, leaves.length) }, worker));
    return { tree: expanded, results };
}

/// Status of any node given the leaf results.
export function statusOf(node, results) {
    if (!node.children) return results.get(node.id)?.status || 'pending';
    return worst(node.children.map((ch) => statusOf(ch, results)));
}

export function countLeaves(node, results, acc = { pass: 0, warn: 0, fail: 0, skip: 0, pending: 0, running: 0 }) {
    if (!node.children) { const s = results.get(node.id)?.status || 'pending'; acc[s] = (acc[s] || 0) + 1; return acc; }
    node.children.forEach((ch) => countLeaves(ch, results, acc));
    return acc;
}
