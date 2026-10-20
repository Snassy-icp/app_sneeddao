// The controllers behind a controller: when a ledger (or its index or archive) is controlled by a
// canister nobody has classified, read that canister's own controllers through read_state (works
// for any canister, no cooperation needed), and theirs, a few levels deep. A canister whose every
// path ends in trusted roots (NNS root, an SNS root, a blackhole, a Sneed guardian, or nothing at
// all) is "semi-blackholed": no person can replace its code, but its own code still decides what it
// does with its control over the ledger. Only code we know (KNOWN_SAFE_CONTROLLER_CODE) clears that.
// No heavy imports, so a node script can exercise it.

/// Module hashes of controller code known to only do what its rules say (none yet: the Sneed
/// guardians are recognised by canister id, and their module hashes are not pinned here).
export const KNOWN_SAFE_CONTROLLER_CODE = {};

export const TREE_MAX_DEPTH = 3;
export const TREE_MAX_CANISTERS = 20;
const short = (id) => (id.length > 12 ? `${id.slice(0, 5)}…${id.slice(-3)}` : id);

/// Walks the controllers of `canisters` (canister ids already known to be unclassified).
///   readStatus(id) -> { controllers: string[], moduleHash: string|null } (may throw)
///   trusted(id)    -> label (string) when `id` is a trusted root, else null (may be async)
///   self           -> the canister being checked: a path back to it is a loop
/// Returns { nodes, ok, safe, lines, read }: ok when every path ends in trusted roots, safe when in
/// addition every canister on the way runs known-safe code.
export async function buildControllerTree(canisters, { readStatus, trusted, self = null, knownSafe = KNOWN_SAFE_CONTROLLER_CODE, maxDepth = TREE_MAX_DEPTH, maxCanisters = TREE_MAX_CANISTERS }) {
    const read = new Map(); // id -> Promise<status | Error>, shared across paths
    const budget = { left: maxCanisters };
    const statusOf = (id) => {
        if (!read.has(id)) {
            if (budget.left <= 0) return null;
            budget.left -= 1;
            read.set(id, Promise.resolve().then(() => readStatus(id)).catch((e) => (e instanceof Error ? e : new Error(String(e)))));
        }
        return read.get(id);
    };

    const visit = async (id, depth, path) => {
        const label = await trusted(id);
        if (label) return { id, kind: 'trusted', label, ok: true, safe: true };
        if (id.length !== 27) return { id, kind: 'user', label: `user principal ${id}`, ok: false, safe: false };
        // A loop adds no new controller: what it reaches is decided on the other paths.
        if (id === self || path.includes(id)) return { id, kind: 'loop', label: `${id} (loops back: no new controller)`, ok: true, safe: true };
        if (depth > maxDepth) return { id, kind: 'unexplored', label: `${id} (not followed: more than ${maxDepth} levels deep)`, ok: false, safe: false };
        const p = statusOf(id);
        if (!p) return { id, kind: 'unexplored', label: `${id} (not followed: more than ${maxCanisters} canisters in the tree)`, ok: false, safe: false };
        const st = await p;
        if (st instanceof Error) return { id, kind: 'unreadable', label: `${id} (controllers could not be read: ${st.message.split('\n')[0].slice(0, 100)})`, ok: false, safe: false };
        const codeSafe = !!(st.moduleHash && knownSafe[st.moduleHash]);
        const base = { id, kind: 'canister', moduleHash: st.moduleHash, codeSafe, codeName: codeSafe ? knownSafe[st.moduleHash] : null };
        if (st.controllers.length === 0) return { ...base, label: `${id} (canister, no controllers: its code can never change)`, children: [], ok: true, safe: codeSafe };
        const children = await Promise.all(st.controllers.map((c) => visit(c, depth + 1, [...path, id])));
        return { ...base, label: `${id} (canister${st.moduleHash ? `, code ${st.moduleHash.slice(0, 8)}…` : ', no code'}${codeSafe ? `, known: ${knownSafe[st.moduleHash]}` : ''})`, children, ok: children.every((c) => c.ok), safe: codeSafe && children.every((c) => c.safe) };
    };

    const nodes = await Promise.all(canisters.map((c) => visit(c, 1, self ? [self] : [])));
    const lines = [];
    const draw = (n, prefix, last, top) => {
        lines.push(top ? n.label : `${prefix}${last ? '└─ ' : '├─ '}${n.label}`);
        const kids = n.children || [];
        kids.forEach((k, i) => draw(k, top ? '' : prefix + (last ? '   ' : '│  '), i === kids.length - 1, false));
    };
    nodes.forEach((n) => draw(n, '', true, true));
    return { nodes, ok: nodes.every((n) => n.ok), safe: nodes.every((n) => n.safe), lines, read: read.size };
}

/// Distinct ends of a node's paths: trusted root labels, and the ones that are not (users, unread).
function ends(n, acc = { good: new Set(), bad: new Set() }) {
    if (n.kind === 'trusted') acc.good.add(n.label);
    else if (n.kind === 'user') acc.bad.add(`user principal ${short(n.id)}`);
    else if (n.kind === 'unreadable') acc.bad.add(`${short(n.id)} (unreadable)`);
    else if (n.kind === 'unexplored') acc.bad.add(`${short(n.id)} (not followed further)`);
    else if (n.kind === 'canister') { if (!n.children.length) acc.good.add('no controllers'); n.children.forEach((c) => ends(c, acc)); }
    return acc;
}

/// "xnsdw…cai (canister → controlled only by NNS root)" for a summary line.
export function describeTreeNode(n) {
    if (n.kind !== 'canister') return n.kind === 'trusted' ? n.label : n.kind === 'user' ? `user principal ${short(n.id)}` : `${short(n.id)} (${n.kind === 'loop' ? 'loops back' : n.kind === 'unreadable' ? 'unreadable' : 'not followed further'})`;
    if (!n.children.length) return `${short(n.id)} (canister with no controllers)`;
    const e = ends(n);
    if (n.ok) return `${short(n.id)} (canister → controlled only by ${[...e.good].join(', ')})`;
    return `${short(n.id)} (canister → reaches ${[...e.bad].join(', ')})`;
}

/// The untrusted ends of a tree, for a failure label.
export const untrustedEnds = (tree) => [...new Set(tree.nodes.flatMap((n) => [...ends(n).bad]))];
