// Sneed SMS paged reads (for clients that keep the newest messages and load older ones on demand):
// get_received_messages_page and get_sent_messages_page. Without `after`: newest first (descending),
// below `before`; with `after`: ids above it (and below `before`), ascending, the incremental read.
// At most 100 per reply and about 1 MB of subject and text, with the caller's whole-list `total` and
// `last_updated` so a client sees removals and changes. Only ever the caller's own messages; the
// same messages the full lists return; queries refused as updates at ingress; and an upgrade from
// the production build (src/sneed_sms at 11416b2e, module hash b1356256…, build/sneed_sms_live.wasm)
// with wasm_memory_persistence = keep keeps every message, and the new reads agree with the old lists.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Principal } from '@icp-sdk/core/principal';
import { IDL } from '@icp-sdk/core/candid';
import { createPic, install, actorAs, wasm, admin, alice, bob, carol, user, unwrap, refusedAtIngress, asUpdates } from '../lib/pic.js';
import { idlFactory as smsIdl } from '../build/sneed_sms.did.js';

const SMS_WASM = process.env.SMS_WASM || 'sneed_sms';
const KEEP = { skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] };
const dave = user('inc-dave');
const stranger = user('inc-stranger');
const ANON = Principal.anonymous().toText();

const MessageResponse = (I) => I.Record({
  id: I.Nat, sender: I.Principal, recipients: I.Vec(I.Principal), subject: I.Text, body: I.Text,
  reply_to: I.Opt(I.Vec(I.Nat)), created_at: I.Int, updated_at: I.Int, can_remove_self: I.Bool,
});
// declared here too, so the suite runs (and fails) against a build without the methods
const fullIdl = ({ IDL: I }) => {
  const Page = I.Record({ messages: I.Vec(MessageResponse(I)), total: I.Nat, last_updated: I.Int, has_more: I.Bool });
  const Args = I.Record({ before: I.Opt(I.Nat), after: I.Opt(I.Nat), limit: I.Nat });
  return I.Service({
    ...Object.fromEntries(smsIdl({ IDL: I })._fields),
    get_received_messages_page: I.Func([Args], [Page], ['query']),
    get_sent_messages_page: I.Func([Args], [Page], ['query']),
  });
};

let pic;
const as = (id, p) => actorAs(pic, fullIdl, id, p);
const msg = (recipients, subject = 'hi', body = 'hello', reply_to = []) => ({ recipients, subject, body, reply_to: reply_to.length ? [reply_to] : [] });
const idsOf = (ms) => ms.map((m) => m.id);
const sortIds = (a) => [...a].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));
const maxUpdated = (ms) => ms.reduce((a, m) => (m.updated_at > a ? m.updated_at : a), 0n);
const opt = (v) => (v == null ? [] : [v]);

const args = ({ before = null, after = null, limit = 100 } = {}) => ({ before: opt(before), after: opt(after), limit: BigInt(limit) });

/// Every page `limit` at a time: ascending from `after` (incremental), or with after = undefined
/// newest first, then older (before = the lowest id seen). Returns the messages and the pages.
async function readAll(actor, method, limit, { after } = {}) {
  const pages = [];
  const messages = [];
  const up = after !== undefined;
  let cursor = up ? after : null;
  for (;;) {
    const page = await actor[method](up ? args({ after: cursor, limit }) : args({ before: cursor, limit }));
    pages.push(page);
    messages.push(...page.messages);
    if (!page.has_more) break;
    cursor = page.messages.at(-1).id;
  }
  return { messages, pages };
}

async function freshSms() {
  const id = await install(pic, { name: SMS_WASM });
  unwrap(await as(id, admin).update_config([0n], [], [], [])); // no wait between messages
  return id;
}

beforeAll(async () => { ({ pic } = await createPic()); }, 120_000);
afterAll(async () => { await pic?.tearDown(); });

describe('ordering and paging', () => {
  let id;
  beforeAll(async () => {
    id = await freshSms();
    // interleaved senders, so bob's inbox ids are not contiguous
    for (let i = 0; i < 6; i += 1) {
      unwrap(await as(id, alice).send_message(msg([bob], `a${i}`)));
      unwrap(await as(id, carol).send_message(msg([bob, dave], `c${i}`)));
      unwrap(await as(id, dave).send_message(msg([alice], `d${i}`))); // not bob's
    }
  }, 120_000);

  it('a principal the canister has never seen gets an empty page', async () => {
    expect(await as(id, stranger).get_received_messages_page(args({ limit: 10 }))).toEqual({ messages: [], total: 0n, last_updated: 0n, has_more: false });
    expect(await as(id, stranger).get_sent_messages_page(args({ after: 0n, limit: 10 }))).toEqual({ messages: [], total: 0n, last_updated: 0n, has_more: false });
  });

  it('newest first: pages descending by id with `before`, together exactly the full list, whole-list markers on every page', async () => {
    const full = await as(id, bob).get_received_messages();
    const { messages, pages } = await readAll(as(id, bob), 'get_received_messages_page', 5);
    expect(pages.map((p) => p.messages.length)).toEqual([5, 5, 2]);
    expect(pages.map((p) => p.has_more)).toEqual([true, true, false]);
    expect(idsOf(messages)).toEqual(sortIds(idsOf(full)).reverse());
    expect(messages).toEqual([...full].sort((x, y) => (x.id < y.id ? 1 : -1)));
    for (const p of pages) {
      expect(p.total).toBe(12n);
      expect(p.last_updated).toBe(maxUpdated(full));
    }
  });

  it('incremental: with `after`, ascending pages of what is newer, together exactly the full list', async () => {
    const full = await as(id, bob).get_received_messages();
    const { messages, pages } = await readAll(as(id, bob), 'get_received_messages_page', 5, { after: 0n });
    expect(pages.map((p) => p.messages.length)).toEqual([5, 5, 2]);
    expect(pages.map((p) => p.has_more)).toEqual([true, true, false]);
    expect(messages).toEqual([...full].sort((x, y) => (x.id < y.id ? -1 : 1)));
    expect(pages.every((p) => p.total === 12n)).toBe(true);
  });

  it('after picks up from there; at the newest id nothing comes back, with the same markers; both bounds give the window between', async () => {
    const all = (await readAll(as(id, bob), 'get_received_messages_page', 100, { after: 0n })).messages;
    const mid = all[6].id;
    const rest = await as(id, bob).get_received_messages_page(args({ after: mid }));
    expect(idsOf(rest.messages)).toEqual(idsOf(all.slice(7)));
    const older = await as(id, bob).get_received_messages_page(args({ before: mid }));
    expect(idsOf(older.messages)).toEqual(idsOf(all.slice(0, 6)).reverse());
    const window = await as(id, bob).get_received_messages_page(args({ after: all[2].id, before: all[6].id }));
    expect(idsOf(window.messages)).toEqual(idsOf(all.slice(3, 6)));
    const none = await as(id, bob).get_received_messages_page(args({ after: all.at(-1).id }));
    expect(none).toEqual({ messages: [], total: 12n, last_updated: maxUpdated(all), has_more: false });
    expect((await as(id, bob).get_received_messages_page(args({ before: all[0].id }))).messages).toEqual([]);
    // limit 0: only the markers (a cheap change check)
    const markers = await as(id, bob).get_received_messages_page(args({ limit: 0 }));
    expect(markers).toEqual({ messages: [], total: 12n, last_updated: maxUpdated(all), has_more: true });
    // a new message shows up after the old cursor, and on top of the newest page
    const n = unwrap(await as(id, alice).send_message(msg([bob], 'new')));
    const fresh = await as(id, bob).get_received_messages_page(args({ after: all.at(-1).id }));
    expect(idsOf(fresh.messages)).toEqual([n]);
    expect(fresh.total).toBe(13n);
    expect((await as(id, bob).get_received_messages_page(args({ limit: 1 }))).messages[0].id).toBe(n);
  });

  it('sent lists page the same way', async () => {
    const full = await as(id, carol).get_sent_messages();
    const { messages, pages } = await readAll(as(id, carol), 'get_sent_messages_page', 4);
    expect(idsOf(messages)).toEqual(sortIds(idsOf(full)).reverse());
    expect(pages.every((p) => p.total === 6n)).toBe(true);
    const up = await readAll(as(id, carol), 'get_sent_messages_page', 4, { after: 0n });
    expect(idsOf(up.messages)).toEqual(sortIds(idsOf(full)));
  });

  it('at most 100 messages per reply', async () => {
    const big = await freshSms();
    for (let i = 0; i < 105; i += 1) unwrap(await as(big, alice).send_message(msg([bob], `m${i}`)));
    const first = await as(big, bob).get_received_messages_page(args({ limit: 1000 }));
    expect(first.messages).toHaveLength(100);
    expect(first.has_more).toBe(true);
    expect(first.total).toBe(105n);
    const second = await as(big, bob).get_received_messages_page(args({ before: first.messages.at(-1).id, limit: 1000 }));
    expect(second.messages).toHaveLength(5);
    expect(second.has_more).toBe(false);
    const up = await as(big, bob).get_received_messages_page(args({ after: 0n, limit: 1000 }));
    expect(up.messages).toHaveLength(100);
    expect(up.has_more).toBe(true);
    const sent = await as(big, alice).get_sent_messages_page(args({ limit: 1000 }));
    expect(sent.messages).toHaveLength(100);
  }, 120_000);

  it('about 1 MB of text per reply, and always at least one message', async () => {
    const big = await freshSms();
    unwrap(await as(big, admin).update_config([], [], [100_000n], []));
    const body = 'x'.repeat(90_000);
    for (let i = 0; i < 14; i += 1) unwrap(await as(big, alice).send_message(msg([bob], `b${i}`, body)));
    for (const dir of [{}, { after: 0n }]) {
      const { messages, pages } = await readAll(as(big, bob), 'get_received_messages_page', 100, dir);
      expect(messages).toHaveLength(14);
      expect(pages.length).toBeGreaterThan(1);
      for (const p of pages) expect(p.messages.reduce((n, m) => n + m.body.length, 0)).toBeLessThanOrEqual(1_000_000);
    }
    unwrap(await as(big, admin).update_config([], [], [2_000_000n], []));
    unwrap(await as(big, admin).send_message(msg([carol], 'huge', 'y'.repeat(1_100_000))));
    const huge = await as(big, carol).get_received_messages_page(args({}));
    expect(huge.messages).toHaveLength(1);
    expect(huge.has_more).toBe(false);
  }, 120_000);
});

describe('caller isolation', () => {
  it('never returns a message the caller is not on, in either direction', async () => {
    const id = await freshSms();
    unwrap(await as(id, alice).send_message(msg([bob], 'to bob')));
    unwrap(await as(id, alice).send_message(msg([carol], 'to carol')));
    unwrap(await as(id, bob).send_message(msg([carol, dave], 'bob to carol and dave')));
    unwrap(await as(id, dave).send_message(msg([alice])));
    for (const p of [alice, bob, carol, dave]) {
      const received = (await readAll(as(id, p), 'get_received_messages_page', 1)).messages;
      expect(received.every((m) => m.recipients.some((r) => r.toText() === p.toText()))).toBe(true);
      expect(sortIds(idsOf(received))).toEqual(sortIds(idsOf(await as(id, p).get_received_messages())));
      const sent = (await readAll(as(id, p), 'get_sent_messages_page', 1)).messages;
      expect(sent.every((m) => m.sender.toText() === p.toText())).toBe(true);
      expect(sortIds(idsOf(sent))).toEqual(sortIds(idsOf(await as(id, p).get_sent_messages())));
    }
    expect((await as(id, carol).get_received_messages_page(args({ after: 0n, limit: 100 }))).messages.map((m) => m.subject)).toEqual(['to carol', 'bob to carol and dave']);
    expect((await as(id, stranger).get_received_messages_page(args({ after: 0n, limit: 100 }))).messages).toEqual([]);
    expect((await as(id, Principal.anonymous()).get_received_messages_page(args({ after: 0n, limit: 100 }))).messages).toEqual([]);
  });

  it('a recipient listed twice gets the message once, counted once', async () => {
    const id = await freshSms();
    const m = unwrap(await as(id, alice).send_message(msg([bob, bob], 'twice')));
    const page = await as(id, bob).get_received_messages_page(args({ after: 0n, limit: 100 }));
    expect(idsOf(page.messages)).toEqual([m]);
    expect(page.total).toBe(1n);
  });
});

describe('removal and change detection', () => {
  it('leaving lowers total; a co-recipient or sender leaving raises last_updated for those who stay', async () => {
    const id = await freshSms();
    const m1 = unwrap(await as(id, alice).send_message(msg([bob, carol], 'one')));
    const m2 = unwrap(await as(id, alice).send_message(msg([bob], 'two')));
    const m3 = unwrap(await as(id, alice).send_message(msg([bob, carol], 'three')));
    const bob0 = await as(id, bob).get_received_messages_page(args({ after: 0n, limit: 100 }));
    const carol0 = await as(id, carol).get_received_messages_page(args({ after: 0n, limit: 100 }));
    const alice0 = await as(id, alice).get_sent_messages_page(args({ after: 0n, limit: 100 }));
    expect([bob0.total, carol0.total, alice0.total]).toEqual([3n, 2n, 3n]);

    await pic.advanceTime(1000); await pic.tick();
    unwrap(await as(id, bob).remove_self_from_message(m1)); // bob leaves m1
    const bob1 = await as(id, bob).get_received_messages_page(args({ after: m3, limit: 100 }));
    expect(bob1.total).toBe(2n); // the cached count (3) no longer matches
    const carol1 = await as(id, carol).get_received_messages_page(args({ after: m3, limit: 100 }));
    expect(carol1.total).toBe(2n);
    expect(carol1.last_updated > carol0.last_updated).toBe(true); // m1's recipient list changed
    expect((await as(id, carol).get_message(m1))[0].updated_at).toBe(carol1.last_updated);

    await pic.advanceTime(1000); await pic.tick();
    unwrap(await as(id, alice).remove_self_from_message(m3)); // the sender leaves m3
    expect((await as(id, alice).get_sent_messages_page(args({ after: m3, limit: 100 }))).total).toBe(2n);
    const bob2 = await as(id, bob).get_received_messages_page(args({ after: m3, limit: 100 }));
    expect(bob2.total).toBe(2n);
    expect(bob2.last_updated > bob1.last_updated).toBe(true);
    const full = (await as(id, bob).get_received_messages_page(args({ after: 0n, limit: 100 }))).messages;
    expect(full.find((m) => m.id === m3).sender.toText()).toBe(ANON);

    unwrap(await as(id, bob).remove_self_from_message(m2)); // bob leaves; alice is still on m2
    expect((await as(id, bob).get_received_messages_page(args({ limit: 0 }))).total).toBe(1n);
    expect((await as(id, alice).get_sent_messages_page(args({ limit: 0 }))).total).toBe(2n);
    unwrap(await as(id, alice).remove_self_from_message(m2)); // the last one on m2: deleted
    const alice3 = await as(id, alice).get_sent_messages_page(args({ after: 0n, limit: 100 }));
    expect(idsOf(alice3.messages)).toEqual([m1]);
    expect(alice3.total).toBe(1n);
  });
});

describe('ingress guard', () => {
  it('refuses both reads as update calls', async () => {
    const id = await freshSms();
    const u = actorAs(pic, asUpdates(fullIdl), id, bob);
    expect(await refusedAtIngress(u.get_received_messages_page(args({ after: 0n, limit: 10 })))).toBe(true);
    expect(await refusedAtIngress(u.get_sent_messages_page(args({ after: 1n, limit: 10 })))).toBe(true);
  });
});

describe('upgrade from the production build (keep)', () => {
  it('keeps every message; the new reads agree with the old lists for everyone', async () => {
    const id = await install(pic, { name: 'sneed_sms_live' });
    const o = (p) => as(id, p);
    await expect(o(bob).get_received_messages_page(args({ after: 0n, limit: 10 }))).rejects.toThrow(); // production has no incremental reads
    unwrap(await o(admin).update_config([0n], [], [], []));
    const m1 = unwrap(await o(alice).send_message(msg([bob, carol], 'kept')));
    unwrap(await o(bob).send_message(msg([alice], 'Re: kept', 'reply', [m1])));
    unwrap(await o(carol).send_message(msg([bob, dave], 'three')));
    unwrap(await o(dave).remove_self_from_message(m1 + 2n));
    unwrap(await o(alice).remove_self_from_message(m1)); // sender leaves
    const people = [alice, bob, carol, dave];
    const snapshot = async () => JSON.stringify(await Promise.all(people.map(async (p) => [
      await o(p).get_received_messages(), await o(p).get_sent_messages(), await o(p).get_all_messages(),
    ])), (_, v) => (typeof v === 'bigint' ? v.toString() : v));
    const before = await snapshot();

    await pic.upgradeCanister({ sender: admin, canisterId: id, wasm: wasm(SMS_WASM), arg: IDL.encode([], []), upgradeModeOptions: KEEP });
    await pic.tick(2);
    expect(await snapshot()).toBe(before);
    for (const p of people) {
      const received = await o(p).get_received_messages();
      const page = await o(p).get_received_messages_page(args({ after: 0n, limit: 100 }));
      expect(idsOf(page.messages)).toEqual(sortIds(idsOf(received)));
      expect(page.total).toBe(BigInt(received.length));
      expect(page.last_updated).toBe(maxUpdated(received));
      const sent = await o(p).get_sent_messages();
      expect(idsOf((await o(p).get_sent_messages_page(args({ after: 0n, limit: 100 }))).messages)).toEqual(sortIds(idsOf(sent)));
    }
    expect(unwrap(await o(bob).send_message(msg([carol], 'after')))).toBe(m1 + 3n);
  }, 120_000);
});
