// Sneed Notifications relay (spec/sneed_notifications.md §4): pulls jobs for Discord and web push
// from the sneed_notifications canister, delivers them, and acknowledges each one. Messages wait in
// the canister until acknowledged, so a relay that stops loses nothing: jobs it took come back to
// the queue when their lease runs out.
//
// Channel addresses arrive encrypted by the user's browser to this relay's public key (hybrid:
// RSA-OAEP-256 wraps an AES-256-GCM key); only this process can read them. Keys and tokens live
// outside the repository, in RELAY_DIR:
//   enc_key.pem          RSA private key (its public half is published with admin_set_relay_key)
//   relay_discord.json   { secret: hex } Ed25519 identity of the Discord relay
//   relay_push.json      { secret: hex } Ed25519 identity of the push relay
//   vapid.json           { publicKey, privateKey } web push (VAPID) keys
//   discord_token        the Discord bot token (Mr Sneed's bot)
//
//   node relay.mjs <notifications canister id> [--once]
import fs from 'node:fs';
import crypto from 'node:crypto';
import { HttpAgent, Actor } from '@dfinity/agent';
import { Ed25519KeyIdentity } from '@dfinity/identity';
import webpush from 'web-push';
import { notificationPage as pageOf, pushLink, shownLink } from './links.mjs';

const DIR = process.env.RELAY_DIR || `${process.env.HOME}/.config/mr-sneed/relay`;
const CANISTER = process.argv[2];
const ONCE = process.argv.includes('--once');
// The Sneed Hub a relay links to: prod by default; the staging relay runs with SNEED_HUB_URL set to the
// staging frontend, so a tapped push opens the site (and the installed app) it came from.
const HUB = (process.env.SNEED_HUB_URL || 'https://app.sneeddao.com').replace(/\/+$/, '');
// Link pushes to the single-notification page only where that frontend has it (NOTIFICATION_PAGES=1);
// otherwise to /notifications, which every deployed frontend has.
const NOTIFICATION_PAGES = process.env.NOTIFICATION_PAGES === '1';
if (!CANISTER) { console.error('usage: node relay.mjs <notifications canister id> [--once]'); process.exit(2); }
const log = (...a) => console.log(new Date().toISOString(), ...a);

const idl = ({ IDL }) => {
    const ChannelKind = IDL.Variant({ sneed_sms: IDL.Null, push: IDL.Null, discord: IDL.Null, telegram: IDL.Null, email: IDL.Null, sms: IDL.Null });
    const Level = IDL.Variant({ urgent: IDL.Null, normal: IDL.Null, info: IDL.Null });
    const RelayJob = IDL.Record({ id: IDL.Nat, kind: ChannelKind, address: IDL.Vec(IDL.Nat8), app: IDL.Text, title: IDL.Text, body: IDL.Text, link: IDL.Opt(IDL.Text), level: Level, created_at: IDL.Int });
    return IDL.Service({
        relay_pull: IDL.Func([IDL.Nat], [IDL.Vec(RelayJob)], []),
        relay_ack: IDL.Func([IDL.Vec(IDL.Tuple(IDL.Nat, IDL.Variant({ ok: IDL.Null, err: IDL.Text })))], [], []),
    });
};

const read = (f) => fs.readFileSync(`${DIR}/${f}`, 'utf8');
const encKey = crypto.createPrivateKey(read('enc_key.pem'));
const vapid = JSON.parse(read('vapid.json'));
const discordToken = (() => { try { return read('discord_token').trim(); } catch { return fs.readFileSync(`${process.env.HOME}/.config/mr-sneed/discord_token`, 'utf8').trim(); } })();

async function actorFor(kind) {
    const { secret } = JSON.parse(read(`relay_${kind}.json`));
    const identity = Ed25519KeyIdentity.fromSecretKey(Uint8Array.from(Buffer.from(secret, 'hex')));
    const agent = await HttpAgent.create({ host: 'https://icp-api.io', identity });
    return { kind, principal: identity.getPrincipal().toText(), actor: Actor.createActor(idl, { agent, canisterId: CANISTER }) };
}

/// The browser's envelope: { k: RSA-OAEP(aesKey), iv, c: AES-GCM(json) with the tag at the end }.
function decrypt(bytes) {
    const env = JSON.parse(Buffer.from(bytes).toString('utf8'));
    const aesKey = crypto.privateDecrypt({ key: encKey, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, Buffer.from(env.k, 'base64'));
    const data = Buffer.from(env.c, 'base64');
    const d = crypto.createDecipheriv('aes-256-gcm', aesKey, Buffer.from(env.iv, 'base64'));
    d.setAuthTag(data.subarray(data.length - 16));
    return JSON.parse(Buffer.concat([d.update(data.subarray(0, data.length - 16)), d.final()]).toString('utf8'));
}

async function discord(job, addr) {
    if (!/^\d{15,22}$/.test(addr.discord_id || '')) throw new Error('not a Discord user id');
    const H = { Authorization: `Bot ${discordToken}`, 'Content-Type': 'application/json', 'User-Agent': 'SneedNotifications (https://app.sneeddao.com, 1)' };
    const ch = await fetch('https://discord.com/api/v10/users/@me/channels', { method: 'POST', headers: H, body: JSON.stringify({ recipient_id: addr.discord_id }) });
    if (!ch.ok) throw new Error(`Discord: can't open a DM (${ch.status}); share a server with Mr Sneed and allow DMs from its members`);
    const { id } = await ch.json();
    const code = verificationCode(job);
    const content = code ? `**Your Sneed Notifications code: ${code}**\nEnter it in Sneed Hub → Notifications: <${HUB}/notifications?code=${code}>` : `**[${job.app}] ${job.title}**${job.body ? `\n${tidyBody(job.body).slice(0, 1500)}` : ''}${shownLink(job, HUB) ? `\n<${shownLink(job, HUB)}>` : ''}\n-# via Sneed Notifications · full message: <${notificationPage(job)}> · manage: <${HUB}/notifications>`;
    const r = await fetch(`https://discord.com/api/v10/channels/${id}/messages`, { method: 'POST', headers: H, body: JSON.stringify({ content: content.slice(0, 2000), allowed_mentions: { parse: [] } }) });
    if (!r.ok) throw new Error(`Discord: send failed (${r.status})`);
}

// Previews are clipped by the sending canister (Sneed SMS: 100 characters + "…"); a link cut in the
// middle is a broken link, so drop it (the full message, with the whole link, is one tap away).
const tidyBody = (body) => (body || '').replace(/(^|\s)https?:\/\/\S*…\s*$/u, '$1…').replace(/\s+…$/u, '…');
// The notification's own page in Sneed Hub (links.mjs).
const notificationPage = (job) => pageOf(job, HUB, NOTIFICATION_PAGES);

// A channel's verification code, if this job carries one (the canister's "Your Sneed Notifications code: 123456").
const verificationCode = (job) => (job.app === 'Sneed Notifications' && /code: (\d{6})$/.exec(job.title)?.[1]) || null;

async function push(job, sub) {
    // A verification code goes first, so a phone banner never cuts it off; tapping it opens the page with the code filled in.
    const code = verificationCode(job);
    const payload = JSON.stringify(code
        ? { title: `Your code: ${code}`, body: 'Enter it in Sneed Hub → Notifications to turn on notifications for this device.', link: `${HUB}/notifications?code=${code}`, tag: `sneed-${job.id}` }
        : { title: `${job.app}: ${job.title}`, body: tidyBody(job.body).slice(0, 300), link: pushLink(job, HUB, NOTIFICATION_PAGES), tag: `sneed-${job.id}` });
    try {
        await webpush.sendNotification(sub, payload, { TTL: 86_400, vapidDetails: { subject: HUB, publicKey: vapid.publicKey, privateKey: vapid.privateKey } });
    } catch (e) {
        throw new Error(e.statusCode === 404 || e.statusCode === 410 ? 'this device stopped accepting notifications' : `push failed (${e.statusCode || e.message})`);
    }
}

async function round(r) {
    const jobs = await r.actor.relay_pull(20n);
    if (!jobs.length) return 0;
    const acks = [];
    for (const job of jobs) {
        try {
            const addr = decrypt(job.address);
            if (r.kind === 'discord') await discord(job, addr); else await push(job, addr);
            acks.push([job.id, { ok: null }]);
        } catch (e) {
            acks.push([job.id, { err: String(e.message || e).slice(0, 200) }]);
        }
    }
    await r.actor.relay_ack(acks);
    log(r.kind, `delivered ${acks.filter(([, a]) => 'ok' in a).length}/${acks.length}`);
    return jobs.length;
}

const relays = await Promise.all(['discord', 'push'].map(actorFor));
log('relay up for', CANISTER, relays.map((r) => `${r.kind}=${r.principal}`).join(' '));
for (;;) {
    for (const r of relays) { try { await round(r); } catch (e) { log(r.kind, 'error', String(e.message || e).slice(0, 200)); } }
    if (ONCE) break;
    await new Promise((s) => setTimeout(s, 15_000));
}
