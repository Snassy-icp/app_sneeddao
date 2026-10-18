// @-mentions in forum threads and posts (spec/forum_mentions.md). A mention is a Markdown link
// whose text starts with "@" and whose target is a principal page:
//   [@Mr Sneed](https://app.sneeddao.com/principal?id=tksci-…)
// The forum records it for the mentioned member (header notification, /posts "Mentions" tab).
// Members who opted in also get a Sneed SMS, sent from the poster's own principal by the
// poster's browser. The forum's mention methods are declared here, like donations.js, so this
// does not wait for regenerated declarations.
import { Actor, HttpAgent } from '@dfinity/agent';
import { Principal } from '@dfinity/principal';
import { canisterId as forumCanisterId } from 'declarations/sneed_sns_forum';
import { createActor as createSmsActor, canisterId as smsCanisterId } from 'declarations/sneed_sms';

const isLocal = !(process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging');
const host = isLocal ? 'http://localhost:4943' : 'https://icp0.io';
export const MAX_MENTIONS = 10; // per thread or post, as in the forum
const HUB = 'https://app.sneeddao.com';
const PREFIXES = [`${HUB}/principal?id=`, '/principal?id='];

const mentionsIdl = ({ IDL }) => {
    const Mention = IDL.Record({
        index: IDL.Nat, thread_id: IDL.Nat, post_id: IDL.Opt(IDL.Nat), by: IDL.Principal, created_at: IDL.Int,
        thread_title: IDL.Opt(IDL.Text), title: IDL.Opt(IDL.Text), excerpt: IDL.Text,
    });
    const ForumError = IDL.Variant({ NotFound: IDL.Text, Unauthorized: IDL.Text, InvalidInput: IDL.Text, AlreadyExists: IDL.Text, InternalError: IDL.Text });
    return IDL.Service({
        get_mentions_of_user: IDL.Func([IDL.Principal, IDL.Opt(IDL.Nat), IDL.Nat], [IDL.Record({ items: IDL.Vec(Mention), next: IDL.Opt(IDL.Nat) })], ['query']),
        get_recent_mentions_count: IDL.Func([IDL.Principal], [IDL.Nat], ['query']),
        mark_mentions_seen_up_to: IDL.Func([IDL.Int], [], []),
        set_mention_sms: IDL.Func([IDL.Bool], [IDL.Variant({ ok: IDL.Null, err: ForumError })], []),
        get_mention_sms: IDL.Func([IDL.Principal], [IDL.Bool], ['query']),
        get_last_seen_mentions_timestamp: IDL.Func([IDL.Principal], [IDL.Opt(IDL.Int)], ['query']),
        get_mention_sms_opted_in: IDL.Func([IDL.Vec(IDL.Principal)], [IDL.Vec(IDL.Principal)], ['query']),
    });
};

async function agentFor(identity) {
    const agent = await HttpAgent.create({ host, ...(identity ? { identity } : {}) });
    if (isLocal) await agent.fetchRootKey();
    return agent;
}
const mentionsActor = async (identity) => Actor.createActor(mentionsIdl, { agent: await agentFor(identity), canisterId: forumCanisterId });

/// The Markdown for a mention. Names follow the naming rules (no "]"), so they need no escaping.
export function mentionMarkdown(principal, name) {
    const p = typeof principal === 'string' ? principal : principal.toText();
    const label = (name || '').replace(/[[\]\n]/g, '').trim() || `${p.slice(0, 5)}…${p.slice(-3)}`;
    return `[@${label}](${HUB}/principal?id=${p})`;
}

/// The principal a link points at when it is a mention target, else null.
export function mentionTarget(href) {
    const h = (href || '').trim();
    for (const prefix of PREFIXES) {
        if (h.startsWith(prefix)) {
            const id = h.slice(prefix.length);
            try { const p = Principal.fromText(id); return p.toText() === id ? p : null; } catch { return null; }
        }
    }
    return null;
}

/// The principals a text mentions, as the forum counts them: first appearance, no repeats, ten at most.
export function parseMentions(body) {
    const out = [];
    const re = /\[@([^\]\n]{1,64})\]\(([^)\s]+)\)/g;
    let m;
    while ((m = re.exec(body || '')) && out.length < MAX_MENTIONS) {
        const p = mentionTarget(m[2]);
        if (p && !out.some((x) => x.toText() === p.toText())) out.push(p);
    }
    return out;
}

// ---- notifications ----
export async function getMentions(identity, user, before = null, limit = 30) {
    return (await mentionsActor(identity)).get_mentions_of_user(user, before == null ? [] : [BigInt(before)], BigInt(limit));
}
export async function getRecentMentionsCount(identity, user) {
    return Number(await (await mentionsActor(identity)).get_recent_mentions_count(user));
}
export async function getLastSeenMentions(identity, user) {
    const r = await (await mentionsActor(identity)).get_last_seen_mentions_timestamp(user);
    return r.length ? r[0] : 0n;
}
export async function markMentionsSeen(identity) {
    await (await mentionsActor(identity)).mark_mentions_seen_up_to(BigInt(Date.now()) * 1_000_000n);
}

// ---- SMS opt-in ----
export async function getMentionSms(user) {
    return (await mentionsActor(null)).get_mention_sms(user);
}
export async function setMentionSms(identity, on) {
    const r = await (await mentionsActor(identity)).set_mention_sms(on);
    if ('err' in r) { const k = Object.keys(r.err)[0]; throw new Error(r.err[k] || k); }
}

/// After a thread or post is saved: send a Sneed SMS, from the poster, to each newly mentioned
/// member who opted in. Best effort; never throws. `before` is the text the post had before an
/// edit, so an edit only pings the people it adds. Returns how many were pinged.
export async function smsMentioned(identity, { body, before = '', link, where }) {
    try {
        const me = identity.getPrincipal().toText();
        const old = new Set(parseMentions(before).map((p) => p.toText()));
        const fresh = parseMentions(body).filter((p) => p.toText() !== me && !old.has(p.toText()));
        if (!fresh.length) return 0;
        const opted = await (await mentionsActor(null)).get_mention_sms_opted_in(fresh);
        if (!opted.length) return 0;
        const sms = createSmsActor(smsCanisterId, { agent: await agentFor(identity) });
        const text = (body || '').replace(/\[@([^\]\n]{1,64})\]\([^)\s]+\)/g, '@$1');
        const excerpt = text.length > 300 ? `${text.slice(0, 299)}…` : text;
        const r = await sms.send_message({
            recipients: opted,
            subject: `You were mentioned${where ? ` in ${where}`.slice(0, 80) : ''}`,
            body: `${excerpt}\n\n${link}`,
            reply_to: [],
        });
        return 'ok' in r ? opted.length : 0;
    } catch {
        return 0;
    }
}
