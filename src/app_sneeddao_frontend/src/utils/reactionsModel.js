// Emoji reactions on forum posts and threads: the client's model (pure, tested in
// test/canisters/tests/forum-frontend.test.js). The forum canister (src/sneed_sns_forum/Reactions.mo)
// is the authority; isSingleEmoji is the same check, so the picker never offers what it refuses.

export const MAX_PER_USER = 10;
export const MAX_BYTES = 64;
const MAX_CODE_POINTS = 16;

const isRegional = (c) => c >= 0x1F1E6 && c <= 0x1F1FF;
const isSkinTone = (c) => c >= 0x1F3FB && c <= 0x1F3FF;
const isTag = (c) => c >= 0xE0020 && c <= 0xE007E;
const TAG_END = 0xE007F, ZWJ = 0x200D, VS16 = 0xFE0F, VS15 = 0xFE0E, KEYCAP = 0x20E3;
const isKeycapBase = (c) => (c >= 0x30 && c <= 0x39) || c === 0x23 || c === 0x2A;

function isEmojiBase(c) {
    if (c >= 0x1F000 && c <= 0x1FAFF) return !isRegional(c) && !isSkinTone(c);
    if (c >= 0x2600 && c <= 0x27BF) return true;
    return c === 0x00A9 || c === 0x00AE || c === 0x203C || c === 0x2049 || c === 0x2122 || c === 0x2139
        || (c >= 0x2194 && c <= 0x2199) || c === 0x21A9 || c === 0x21AA
        || c === 0x231A || c === 0x231B || c === 0x2328 || c === 0x23CF || (c >= 0x23E9 && c <= 0x23F3) || (c >= 0x23F8 && c <= 0x23FA)
        || c === 0x24C2 || c === 0x25AA || c === 0x25AB || c === 0x25B6 || c === 0x25C0 || (c >= 0x25FB && c <= 0x25FE)
        || c === 0x2934 || c === 0x2935 || (c >= 0x2B05 && c <= 0x2B07) || c === 0x2B1B || c === 0x2B1C || c === 0x2B50 || c === 0x2B55
        || c === 0x3030 || c === 0x303D || c === 0x3297 || c === 0x3299;
}

/// Whether `t` is exactly one emoji (one grapheme cluster: ZWJ sequences, skin tones, flags and
/// keycaps count as one), at most MAX_BYTES bytes of UTF-8.
export function isSingleEmoji(t) {
    if (typeof t !== 'string' || t.length === 0) return false;
    const cs = Array.from(t, (ch) => ch.codePointAt(0));
    const n = cs.length;
    if (n > MAX_CODE_POINTS || new TextEncoder().encode(t).length > MAX_BYTES) return false;
    if (isRegional(cs[0])) return n === 2 && isRegional(cs[1]);
    if (isKeycapBase(cs[0])) return (n === 2 && cs[1] === KEYCAP) || (n === 3 && cs[1] === VS16 && cs[2] === KEYCAP);
    let i = 0;
    for (;;) {
        if (i >= n || !isEmojiBase(cs[i])) return false;
        i += 1;
        if (i < n && (cs[i] === VS16 || cs[i] === VS15)) i += 1;
        if (i < n && isSkinTone(cs[i])) i += 1;
        if (i < n && cs[i] === VS16) i += 1;
        if (i < n && cs[i] === KEYCAP) i += 1;
        if (i < n && isTag(cs[i])) {
            while (i < n && isTag(cs[i])) i += 1;
            if (i >= n || cs[i] !== TAG_END) return false;
            i += 1;
        }
        if (i === n) return true;
        if (cs[i] !== ZWJ) return false;
        i += 1;
    }
}

/// My set after tapping `emoji`: removed when I gave it, added otherwise; null when my set is full.
export function toggleEmoji(mine, emoji) {
    if (mine.includes(emoji)) return mine.filter((e) => e !== emoji);
    if (mine.length >= MAX_PER_USER) return null;
    return [...mine, emoji];
}

/// The target's counts ([{emoji, count: bigint}], first-given order) after my set went from
/// `oldSet` to `newSet` (what the canister does, for an optimistic update).
export function applyReactionChange(counts, oldSet, newSet) {
    const out = [];
    for (const c of counts) {
        const removed = oldSet.includes(c.emoji) && !newSet.includes(c.emoji);
        const added = newSet.includes(c.emoji) && !oldSet.includes(c.emoji);
        const n = BigInt(c.count) + (added ? 1n : 0n) - (removed && BigInt(c.count) > 0n ? 1n : 0n);
        if (n > 0n) out.push({ emoji: c.emoji, count: n });
    }
    for (const e of newSet) if (!oldSet.includes(e) && !counts.some((c) => c.emoji === e)) out.push({ emoji: e, count: 1n });
    return out;
}

/// The picker's emojis, with names to search by.
export const COMMON_EMOJIS = [
    ['👍', 'thumbs up like yes'], ['👎', 'thumbs down dislike no'], ['❤️', 'heart love red'], ['😂', 'joy laugh tears lol'],
    ['🎉', 'party tada celebrate'], ['🚀', 'rocket moon launch'], ['🔥', 'fire hot lit'], ['👀', 'eyes look watching'],
    ['🙏', 'pray thanks please'], ['💯', 'hundred perfect 100'], ['🤔', 'thinking hmm'], ['😮', 'wow surprised open mouth'],
    ['😢', 'sad cry tear'], ['😡', 'angry mad'], ['👏', 'clap applause'], ['🙌', 'raised hands hooray'],
    ['💪', 'strong muscle flex'], ['✅', 'check done yes'], ['❌', 'cross no wrong'], ['⭐', 'star favourite'],
    ['🤝', 'handshake deal agree'], ['😎', 'cool sunglasses'], ['🥳', 'party face celebrate'], ['😅', 'sweat smile phew'],
    ['🤣', 'rofl rolling laugh'], ['😍', 'heart eyes love'], ['🥰', 'smiling hearts love'], ['😊', 'smile blush happy'],
    ['🙂', 'slight smile'], ['😉', 'wink'], ['😐', 'neutral meh'], ['🙄', 'eye roll'], ['😬', 'grimace awkward'],
    ['🤯', 'mind blown exploding head'], ['😱', 'scream fear'], ['🫡', 'salute'], ['🫠', 'melting'], ['💀', 'skull dead'],
    ['🤡', 'clown'], ['💩', 'poop'], ['👋', 'wave hello bye'], ['✌️', 'peace victory'], ['🤞', 'fingers crossed luck'],
    ['👌', 'ok perfect'], ['🫶', 'heart hands'], ['💡', 'idea bulb light'], ['📈', 'chart up pump'], ['📉', 'chart down dump'],
    ['💰', 'money bag'], ['💎', 'diamond gem hands'], ['🪙', 'coin token'], ['🏆', 'trophy win'], ['🎯', 'target bullseye'],
    ['⚡', 'lightning zap fast'], ['🌙', 'moon'], ['☕', 'coffee'], ['🍕', 'pizza'], ['🍿', 'popcorn watching'],
    ['🐸', 'frog'], ['🦆', 'duck'], ['🐳', 'whale'], ['🐂', 'bull'], ['🐻', 'bear'], ['🤖', 'robot bot'],
    ['🧠', 'brain smart'], ['🛠️', 'tools build'], ['🐛', 'bug'], ['🔒', 'lock locked'], ['🗳️', 'ballot vote'],
    ['📣', 'megaphone announce'], ['⏳', 'hourglass waiting'], ['❓', 'question'], ['❗', 'exclamation important'],
    ['🇲🇹', 'flag malta'], ['🏳️‍🌈', 'rainbow flag'], ['👩‍💻', 'woman technologist coder dev'], ['👨‍💻', 'man technologist coder dev'],
].map(([emoji, name]) => ({ emoji, name }));

/// The emojis of `list` ({emoji, name, keywords?}; default COMMON_EMOJIS) whose name or keywords
/// contain every word of the query (all for an empty query), single emojis only, without repeats.
export function searchEmojis(query, list = COMMON_EMOJIS) {
    const words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
    const seen = new Set();
    return list.filter((e) => {
        if (seen.has(e.emoji) || !isSingleEmoji(e.emoji)) return false;
        const hay = `${e.name || ''} ${(e.keywords || []).join(' ')}`.toLowerCase();
        if (!words.every((w) => hay.includes(w))) return false;
        seen.add(e.emoji);
        return true;
    });
}

/// Candid helpers: a reaction target for a post or a thread, and its map key.
export const postTarget = (id) => ({ post: BigInt(id) });
export const threadTarget = (id) => ({ thread: BigInt(id) });
export const targetKey = (t) => ('post' in t ? `p${t.post}` : `t${t.thread}`);
