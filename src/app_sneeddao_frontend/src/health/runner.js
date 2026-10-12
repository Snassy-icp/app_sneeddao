// Runs a check tree. Leaves run concurrently (bounded); a group's status is
// the worst of its children's. Results are reported through onUpdate so the
// page can render progressively.
//
// Dynamic groups (children given as a function) are listed independently of
// each other while the leaves already known are running, so the page shows
// the tree at once and fills it in; a slow listing only delays its own group.
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

const isDynamic = (node) => typeof node.children === 'function';

export async function runTree(tree, config, onUpdate, concurrency = 6) {
    const ctx = makeCtx(config);
    const results = new Map(); // leaf id -> result
    const listed = new Map(); // dynamic group id -> its children once known
    const queue = [];
    let active = 0;
    let listing = 0;
    let finish;
    const done = new Promise((resolve) => { finish = resolve; });

    // The tree as it is known right now: a dynamic group whose children are
    // still being listed has no children and `loading` set.
    const materialize = (n) => {
        if (!n.children) return n;
        const kids = isDynamic(n) ? listed.get(n.id) : n.children;
        if (!kids) return { ...n, children: [], loading: true };
        return { ...n, children: kids.map(materialize) };
    };
    const emit = () => onUpdate?.({ tree: materialize(tree), results: new Map(results) });
    const checkDone = () => { if (queue.length === 0 && active === 0 && listing === 0) finish(); };

    const runLeaf = async (leaf) => {
        results.set(leaf.id, { status: 'running' });
        emit();
        const t0 = Date.now();
        let r;
        try {
            r = await withTimeout(leaf.run(ctx), config.callTimeoutSec * 1000 + 5000, leaf.name);
            if (!r || !r.status) r = { status: 'fail', summary: 'Check returned nothing' };
        } catch (e) {
            r = { status: 'fail', summary: `Error: ${e?.message || String(e)}` };
        }
        results.set(leaf.id, { ...r, link: r.link || leaf.link, ms: Date.now() - t0 });
        emit();
    };
    const pump = () => {
        while (active < concurrency && queue.length) {
            const leaf = queue.shift();
            active++;
            runLeaf(leaf).finally(() => { active--; pump(); checkDone(); });
        }
    };

    const discover = (n) => {
        if (!n.children) {
            results.set(n.id, { status: 'pending' });
            queue.push(n);
            return;
        }
        if (!isDynamic(n)) { n.children.forEach(discover); return; }
        listing++;
        Promise.resolve()
            .then(() => n.children(ctx))
            .then((kids) => Array.isArray(kids) ? kids : [], (e) => [{ id: `${n.id}:list`, name: 'Listing checks', run: async () => ({ status: 'fail', summary: `Could not list checks: ${e?.message || e}` }) }])
            .then((kids) => {
                listed.set(n.id, kids);
                kids.forEach(discover);
            })
            .finally(() => { listing--; emit(); pump(); checkDone(); });
    };

    discover(tree);
    emit();
    pump();
    checkDone();
    await done;
    const final = { tree: materialize(tree), results: new Map(results) };
    onUpdate?.(final);
    return final;
}

/// Status of any node given the leaf results.
export function statusOf(node, results) {
    if (!node.children) return results.get(node.id)?.status || 'pending';
    if (node.loading) return 'running';
    return worst(node.children.map((ch) => statusOf(ch, results)));
}

export function countLeaves(node, results, acc = { pass: 0, warn: 0, fail: 0, skip: 0, pending: 0, running: 0 }) {
    if (!node.children) { const s = results.get(node.id)?.status || 'pending'; acc[s] = (acc[s] || 0) + 1; return acc; }
    node.children.forEach((ch) => countLeaves(ch, results, acc));
    return acc;
}

/// True while some dynamic group has not listed its checks yet.
export const isListing = (node) => !!node.children && (node.loading || node.children.some(isListing));
