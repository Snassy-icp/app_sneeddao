// Pure helpers of the forum client (ThreadViewer, Discussion, Poll), kept free of React and of the
// generated declarations so they can be tested in node (test/canisters/tests/forum-frontend.test.js).

/// A vote score (e8s, may be negative) as shown next to the vote buttons: compact text and the sign
/// used for its colour.
export function scoreLabel(e8s) {
    const tokens = Number(e8s) / 100000000;
    const abs = Math.abs(tokens);
    const trim = (x, digits) => x.toFixed(digits).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
    let body;
    // round first, then pick the unit, so 999,950 is 1M and not 1000K
    if (abs >= 999950) body = trim(abs / 1000000, 1) + 'M';
    else if (abs >= 999.95) body = trim(abs / 1000, 1) + 'K';
    else if (abs >= 1) body = trim(abs, 1);
    else body = trim(abs, 2);
    if (Number(body.replace(/[KM]$/, '')) === 0) return { text: '0', sign: 0 }; // rounds to 0: no sign, no colour
    const sign = Math.sign(tokens);
    return { text: (sign > 0 ? '+' : '-') + body, sign };
}

/// The winning option ids of a poll (ties: all of them).
export function winningOptionIds(options) {
    if (!options || !Array.isArray(options)) return new Set();
    const max = Math.max(...options.map((o) => Number(o.total_voting_power || 0)));
    if (!(max > 0)) return new Set(); // nobody voted: nobody won
    return new Set(options.filter((o) => Number(o.total_voting_power || 0) === max).map((o) => o.id));
}

/// The title shown for a thread: an explicit title prop, the thread's own title, else "Thread #id".
export function threadDisplayTitle({ title, threadDetails, threadId }) {
    if (title) return title;
    const own = threadDetails?.title;
    const text = Array.isArray(own) ? own[0] : own; // Candid opt text: [] or [title]
    if (text) return text;
    return `Thread #${threadId}`;
}

/// What the thread view does with read marks when its posts (re)load: which marks to stash for the
/// "new since your last visit" highlight, and the read mark to write (null: none).
export function planReadTracking({ threadId, posts, me, serverLastRead, stashedFor }) {
    const mine = (post) => post.created_by != null && String(post.created_by) === String(me);
    // only this thread's posts (on a thread switch the previous thread's are still shown for a moment)
    const visible = posts.filter((post) => String(post.thread_id) === String(threadId) && (!post.deleted || mine(post)));
    if (visible.length === 0) return { stash: null, write: null };
    const highest = Math.max(...visible.map((post) => Number(post.id)));
    const last = Number(serverLastRead) || 0;
    // the highlight is stashed once per visit of a thread: later reloads read back our own mark
    const stash = String(stashedFor) === String(threadId) ? null : { lastRead: last, highest };
    return { stash, write: highest > last ? highest : null };
}

/// The arguments of create_tip (to, post id, ledger, amount, opt block index).
export function createTipArgs({ to, postId, ledger, amount, blockIndex }) {
    // BigInt all the way (Number loses precision above 2^53), and block 0 is a block
    return [to, BigInt(postId), ledger, BigInt(amount), blockIndex == null ? [] : [BigInt(blockIndex)]];
}

/// What a tipper is told when a call throws (a network error, a timeout) at `stage` 'transfer'
/// (sending the tokens) or 'register' (recording the tip, after the tokens were sent); null: nothing.
export function tipExceptionMessage(stage, error) {
    const why = String(error?.message || error || 'unknown error');
    if (stage === 'register') return `The tokens were sent (do not send them again), but recording the tip failed: ${why}. Reload the page to see whether it was recorded.`;
    return `The transfer could not be confirmed: ${why}. Check your wallet's balance before trying again.`;
}

/// The decimals to convert a tip amount with, from the tip modal's token metadata, or why not.
export function tipDecimals(metadata) {
    if (!metadata) return { error: 'Token metadata not loaded. Please try again.' };
    // never guess: a wrong guess sends 10^k times the amount typed
    if (metadata.decimalsUnknown || !Number.isInteger(metadata.decimals)) return { error: "Could not read this token's decimals from its ledger. Please try again." };
    return { decimals: metadata.decimals };
}

/// A topic's live threads in the order the topic page shows them. `threads` come in the forum's
/// order: hottest first for 'hot' (get_threads_by_hot, reverse), else most recently active first
/// (get_threads_by_activity_with_unread_counts, reverse); sortBy is 'hot', 'newest', 'oldest',
/// 'activity-newest' or 'activity-oldest'.
export function orderTopicThreads(threads, sortBy) {
    const live = threads.filter((t) => !t.deleted);
    if (sortBy === 'hot' || sortBy === 'activity-newest') return live; // the forum's order
    if (sortBy === 'activity-oldest') return live.reverse();
    const asc = sortBy === 'oldest';
    return live.sort((a, b) => {
        const x = BigInt(a.created_at), y = BigInt(b.created_at);
        const c = x < y ? -1 : x > y ? 1 : 0;
        return asc ? c : -c;
    });
}
