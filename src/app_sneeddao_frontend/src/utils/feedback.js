// Bug reports and ideas (the /feedback page). A public report is a thread in the Sneed forum topic
// set in the backend, so it can be discussed; the recipients get a Sneed SMS ping linking to it.
// A security report is never posted: it goes to the recipients by Sneed SMS only. Both are sent
// from the reporter's own principal, so replies reach them. The backend's settings interface is
// declared here, like donations.js, so it does not wait for regenerated declarations.
import { Actor, HttpAgent } from '@dfinity/agent';
import { canisterId as backendCanisterId } from 'declarations/app_sneeddao_backend';
import { createActor as createForumActor, canisterId as forumCanisterId } from 'declarations/sneed_sns_forum';
import { createActor as createSmsActor, canisterId as smsCanisterId } from 'declarations/sneed_sms';

const isLocal = !(process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging');
const host = isLocal ? 'http://localhost:4943' : 'https://icp0.io';

export const SNEED_FORUM_ID = 1n; // the Sneed DAO forum
export const MAX_TITLE = 100; // a Sneed SMS subject (the forum allows 200)
export const MAX_PUBLIC_TEXT = 3500; // a forum thread holds 4,000 with the attached details
export const MAX_PRIVATE_TEXT = 1700; // a Sneed SMS message holds 2,000 with the attached details
const SMS_BODY_MAX = 2000;

const settingsIdl = ({ IDL }) => {
    const Config = IDL.Record({ recipients: IDL.Vec(IDL.Principal), bug_topic: IDL.Opt(IDL.Nat), idea_topic: IDL.Opt(IDL.Nat) });
    return IDL.Service({
        get_feedback_config: IDL.Func([], [Config], ['query']),
        admin_set_feedback_config: IDL.Func([Config], [IDL.Variant({ ok: IDL.Null, err: IDL.Text })], []),
    });
};

async function agentFor(identity) {
    const agent = await HttpAgent.create({ host, ...(identity ? { identity } : {}) });
    if (isLocal) await agent.fetchRootKey();
    return agent;
}
const settingsActor = async (identity) => Actor.createActor(settingsIdl, { agent: await agentFor(identity), canisterId: backendCanisterId });
export const forumActor = async (identity) => createForumActor(forumCanisterId, { agent: await agentFor(identity) });
const smsActor = async (identity) => createSmsActor(smsCanisterId, { agent: await agentFor(identity) });

/// { recipients: Principal[], bugTopic: bigint | null, ideaTopic: bigint | null }, or null on a
/// backend from before feedback.
export async function getFeedbackConfig() {
    try {
        const c = await (await settingsActor()).get_feedback_config();
        return { recipients: c.recipients, bugTopic: c.bug_topic[0] ?? null, ideaTopic: c.idea_topic[0] ?? null };
    } catch (e) {
        if (/has no (query|update) method|method not found|IC0536/i.test(String(e?.message || e))) return null;
        throw e;
    }
}

export async function adminSetFeedbackConfig(identity, { recipients, bugTopic, ideaTopic }) {
    const r = await (await settingsActor(identity)).admin_set_feedback_config({
        recipients, bug_topic: bugTopic != null ? [BigInt(bugTopic)] : [], idea_topic: ideaTopic != null ? [BigInt(ideaTopic)] : [],
    });
    if ('err' in r) throw new Error(r.err);
}

/// The Sneed forum's topics: [{ id, title, parent }].
export async function sneedForumTopics() {
    const ts = await (await forumActor()).get_topics_by_forum(SNEED_FORUM_ID);
    return ts.filter((t) => !t.deleted).map((t) => ({ id: t.id, title: t.title, parent: t.parent_topic_id[0] ?? null }));
}

/// The latest public reports in a topic, most recent activity first.
export async function recentReports(topicId, limit = 10) {
    const r = await (await forumActor()).get_threads_by_activity(BigInt(topicId), [], BigInt(limit), true);
    return r.threads;
}

/// The details a bug report can carry: the page it came from, the app build, the browser.
export async function reportDetails(fromPath) {
    let build = null;
    try { build = (await (await fetch('/version.json', { cache: 'no-store' })).json()).buildId; } catch { /* local dev */ }
    return [
        fromPath && ['Page', fromPath],
        build && ['App build', build],
        ['Browser', navigator.userAgent],
        ['Screen', `${window.screen.width}×${window.screen.height}, window ${window.innerWidth}×${window.innerHeight}`],
    ].filter(Boolean);
}
const detailsText = (details) => (details.length ? `\n\n---\n${details.map(([k, v]) => `${k}: ${v}`).join('\n')}` : '');
const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/// Sends a report. Returns { threadId (public only), pinged }: pinged is false when the SMS ping
/// could not go out (a public report is complete without it; a security report throws).
export async function sendReport(identity, config, { kind, title, text, details, security }) {
    const label = kind === 'bug' ? 'Bug' : 'Idea';
    const body = `${text}${detailsText(details)}`;
    const sms = await smsActor(identity);
    const ping = async (subject, message) => {
        if (!config.recipients.length) return false;
        const r = await sms.send_message({ recipients: config.recipients, subject: clip(subject, MAX_TITLE), body: clip(message, SMS_BODY_MAX), reply_to: [] });
        if ('err' in r) throw new Error(Object.values(r.err)[0] || 'Sneed SMS refused the message');
        return true;
    };
    if (security) {
        await ping(`Security report: ${title}`, `A private security report from Sneed Hub's feedback page. Do not post it publicly.\n\n${body}`);
        return { threadId: null, pinged: true };
    }
    const topic = kind === 'bug' ? config.bugTopic : config.ideaTopic;
    if (topic == null) throw new Error(`No forum topic is set for ${label.toLowerCase()}s yet`);
    const forum = await forumActor(identity);
    const r = await forum.create_thread({ topic_id: BigInt(topic), title: [clip(`${label}: ${title}`, 200)], body });
    if ('err' in r) throw new Error(Object.values(r.err)[0] || 'The forum refused the report');
    const threadId = r.ok;
    let pinged = false;
    try {
        pinged = await ping(`New ${label.toLowerCase()}: ${title}`, `${label}: ${title}\nhttps://app.sneeddao.com/thread?threadid=${threadId}\n\n${clip(text, 1500)}`);
    } catch { /* e.g. within Sneed SMS's rate limit: the thread is there anyway */ }
    return { threadId, pinged };
}
