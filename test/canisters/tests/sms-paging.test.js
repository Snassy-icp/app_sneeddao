// Sneed SMS: the paged admin read and the send burst limit (spec/paging_audit.md S4, src/RateLimit.mo).
// - admin_get_messages_page(before, limit): every message, newest first, at most 100 and about 1 MB a
//   page (always at least one), `next_before` until the end; together exactly get_all_messages_admin;
//   empty for non-admins; a query only;
// - send_message has a burst limit per sender on top of the minutes between messages (default 10 in
//   a row, then 2 a minute): a spammer is refused at ingress and, past ingress, in the method
//   (RateLimited); someone sending at a human pace is not; admins are exempt; admins set it
//   (admin_set_send_rate_limit, logged as ICRC-3 config_update);
// - an upgrade from the production build (src/sneed_sms at 11416b2e, build/sneed_sms_live.wasm) and
//   from the build with the paged inbox reads (1788bfee, build/sneed_sms_prepaging.wasm) with keep
//   keeps every message, and the admin pages agree with the old full list.
// SMS_WASM=sneed_sms_prepaging npx vitest run tests/sms-paging.test.js runs it against the code before.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { IDL } from '@icp-sdk/core/candid';
import { createPic, install, actorAs, wasm, admin, alice, bob, carol, user, unwrap, errOf, refusedAtIngress, asUpdates } from '../lib/pic.js';
import { btype, tx } from '../lib/icrc3.js';
import { idlFactory as smsIdl } from '../build/sneed_sms.did.js';

const SMS_WASM = process.env.SMS_WASM || 'sneed_sms';
const KEEP = { skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] };
const dave = user('smspg-dave');
const eve = user('smspg-eve');

// declared here too, so the suite runs (and fails) against a build without the methods
const fullIdl = ({ IDL: I }) => {
  const base = Object.fromEntries(smsIdl({ IDL: I })._fields);
  const MessageResponse = base.get_all_messages_admin.retTypes[0]._type;
  const Result = base.update_config.retTypes[0];
  const Rule = I.Record({ capacity: I.Nat, per_minute: I.Nat });
  const V = I.Rec();
  V.fill(I.Variant({ Int: I.Int, Map: I.Vec(I.Tuple(I.Text, V)), Nat: I.Nat, Blob: I.Vec(I.Nat8), Text: I.Text, Array: I.Vec(V) }));
  return I.Service({
    ...base,
    admin_get_messages_page: I.Func([I.Opt(I.Nat), I.Nat], [I.Record({ messages: I.Vec(MessageResponse), total: I.Nat, next_before: I.Opt(I.Nat) })], ['query']),
    get_send_rate_limit: I.Func([], [Rule], ['query']),
    admin_set_send_rate_limit: I.Func([Rule], [Result], []),
    get_rate_limit_exempt: I.Func([], [I.Vec(I.Principal)], ['query']),
    admin_set_rate_limit_exempt: I.Func([I.Principal, I.Bool], [Result], []),
    icrc3_get_blocks: I.Func([I.Vec(I.Record({ start: I.Nat, length: I.Nat }))], [I.Record({ log_length: I.Nat, blocks: I.Vec(I.Record({ id: I.Nat, block: V })), archived_blocks: I.Vec(I.Reserved) })], ['query']),
  });
};

let pic;
const as = (id, p) => actorAs(pic, fullIdl, id, p);
const msg = (recipients, subject = 'hi', body = 'hello') => ({ recipients, subject, body, reply_to: [] });
const json = (v) => JSON.stringify(v, (_, x) => (typeof x === 'bigint' ? x.toString() : x));
const advance = async (seconds) => { await pic.advanceTime(seconds * 1000); await pic.tick(); };
const plain = (v) => {
  if ('Nat' in v) return v.Nat;
  if ('Text' in v) return v.Text;
  if ('Blob' in v) return Buffer.from(v.Blob).toString('hex');
  if ('Array' in v) return v.Array.map(plain);
  if ('Int' in v) return v.Int;
  return Object.fromEntries(v.Map.map(([k, x]) => [k, plain(x)]));
};

async function freshSms(name = SMS_WASM) {
  const id = await install(pic, { name });
  unwrap(await as(id, admin).update_config([0n], [2_000_000n], [2_000_000n], [])); // no minutes between messages
  return id;
}

/// Every admin page, `limit` at a time
async function adminPages(actor, limit) {
  const pages = [];
  const messages = [];
  let before = [];
  for (let i = 0; i < 1000; i++) {
    const page = await actor.admin_get_messages_page(before, BigInt(limit));
    pages.push(page);
    messages.push(...page.messages);
    if (!page.next_before.length) break;
    before = page.next_before;
  }
  return { pages, messages };
}
const byIdDesc = (ms) => [...ms].sort((a, b) => (a.id < b.id ? 1 : -1));

beforeAll(async () => { ({ pic } = await createPic()); }, 120_000);
afterAll(async () => { await pic?.tearDown(); });

describe('admin_get_messages_page', () => {
  let id;
  beforeAll(async () => {
    id = await freshSms();
    unwrap(await as(id, admin).admin_set_send_rate_limit({ capacity: 0n, per_minute: 0n })); // bulk setup
    for (let i = 0; i < 7; i++) {
      unwrap(await as(id, alice).send_message(msg([bob], `a${i}`)));
      unwrap(await as(id, carol).send_message(msg([alice, dave], `c${i}`)));
    }
    const leave = unwrap(await as(id, bob).send_message(msg([carol], 'left by everyone')));
    unwrap(await as(id, carol).remove_self_from_message(leave));
    unwrap(await as(id, bob).remove_self_from_message(leave)); // deleted: a gap in the ids
    unwrap(await as(id, dave).remove_self_from_message(2n)); // changed, not deleted
  }, 120_000);

  it('newest first, `next_before` until the end, together exactly get_all_messages_admin', async () => {
    const full = await as(id, admin).get_all_messages_admin();
    expect(full).toHaveLength(14);
    const { pages, messages } = await adminPages(as(id, admin), 4);
    expect(pages.map((p) => p.messages.length)).toEqual([4, 4, 4, 2]);
    expect(pages.every((p) => p.total === 14n)).toBe(true);
    expect(json(messages)).toBe(json(byIdDesc(full)));
    // limit above 100: 100
    expect((await as(id, admin).admin_get_messages_page([], 1000n)).messages).toHaveLength(14);
  });

  it('empty for non-admins', async () => {
    expect(await as(id, alice).admin_get_messages_page([], 10n)).toEqual({ messages: [], total: 0n, next_before: [] });
    expect(await as(id, alice).get_all_messages_admin()).toEqual([]);
  });

  it('at most 100 messages and about 1 MB a page, always at least one', async () => {
    const big = await freshSms();
    unwrap(await as(big, admin).admin_set_send_rate_limit({ capacity: 0n, per_minute: 0n }));
    for (let i = 0; i < 105; i++) unwrap(await as(big, alice).send_message(msg([bob], `m${i}`)));
    const first = await as(big, admin).admin_get_messages_page([], 1000n);
    expect(first.messages).toHaveLength(100);
    expect(first.next_before).toEqual([first.messages.at(-1).id]);
    const second = await as(big, admin).admin_get_messages_page(first.next_before, 1000n);
    expect(second.messages).toHaveLength(5);
    expect(second.next_before).toEqual([]);
    const body = 'x'.repeat(300_000);
    for (let i = 0; i < 8; i++) unwrap(await as(big, alice).send_message(msg([bob], `big${i}`, body)));
    const { pages, messages } = await adminPages(as(big, admin), 100);
    expect(messages).toHaveLength(113);
    for (const p of pages) expect(p.messages.reduce((n, m) => n + m.body.length, 0)).toBeLessThanOrEqual(1_000_000);
    unwrap(await as(big, alice).send_message(msg([bob], 'huge', 'y'.repeat(1_100_000))));
    const huge = await as(big, admin).admin_get_messages_page([], 100n);
    expect(huge.messages).toHaveLength(1);
    expect(huge.next_before.length).toBe(1);
  }, 180_000);

  it('a query only', async () => {
    const u = actorAs(pic, asUpdates(fullIdl), id, admin);
    expect(await refusedAtIngress(u.admin_get_messages_page([], 10n))).toBe(true);
    expect(await refusedAtIngress(u.get_send_rate_limit())).toBe(true);
    expect(await refusedAtIngress(u.get_rate_limit_exempt())).toBe(true);
  });
});

describe('send burst limit', () => {
  let id;
  beforeAll(async () => { id = await freshSms(); }, 120_000);

  it('default 10 in a row, then 2 a minute', async () => {
    expect(await as(id, alice).get_send_rate_limit()).toEqual({ capacity: 10n, per_minute: 2n });
  });

  it('a spammer is refused at ingress after 10 messages; a minute later 2 more go through', async () => {
    for (let i = 0; i < 10; i++) unwrap(await as(id, eve).send_message(msg([bob], `spam ${i}`)));
    expect(await refusedAtIngress(as(id, eve).send_message(msg([bob], 'spam 10')))).toBe(true);
    await advance(60);
    unwrap(await as(id, eve).send_message(msg([bob], 'later 1')));
    unwrap(await as(id, eve).send_message(msg([bob], 'later 2')));
    expect(await refusedAtIngress(as(id, eve).send_message(msg([bob], 'too soon')))).toBe(true);
    expect((await as(id, eve).get_sent_messages()).length).toBe(12);
  }, 120_000);

  it('someone writing at a human pace is never limited', async () => {
    for (let i = 0; i < 20; i++) {
      unwrap(await as(id, dave).send_message(msg([alice], `note ${i}`)));
      await advance(30); // two a minute
    }
  }, 120_000);

  it('past ingress (calls at once, or from canisters) the method refuses with RateLimited and stores nothing', async () => {
    const send = Object.fromEntries(smsIdl({ IDL })._fields).send_message;
    const sender = user('smspg-burst');
    const calls = [];
    for (let i = 0; i < 12; i++) calls.push(await pic.submitCall({ canisterId: id, method: 'send_message', sender, arg: IDL.encode(send.argTypes, [msg([bob], `burst ${i}`)]) }));
    const results = [];
    for (const c of calls) results.push(IDL.decode(send.retTypes, await pic.awaitCall(c))[0]);
    expect(results.filter((r) => 'ok' in r)).toHaveLength(10);
    const refused = results.filter((r) => 'err' in r);
    expect(refused).toHaveLength(2);
    for (const r of refused) expect(r.err.RateLimited).toMatch(/^Too many messages in a row: at most 10, then 2 a minute/);
    expect((await as(id, sender).get_sent_messages()).length).toBe(10);
  }, 120_000);

  it('an exempt integrator sends 50 in a row (also past the minutes between messages); one that is not exempt is limited', async () => {
    const bot = await freshSms();
    unwrap(await as(bot, admin).update_config([10n], [], [], [])); // 10 minutes between messages, as on production
    const taco = user('smspg-taco-bot');
    const other = user('smspg-other-bot');
    expect(errOf(await as(bot, alice).admin_set_rate_limit_exempt(taco, true))).toHaveProperty('Unauthorized');
    unwrap(await as(bot, admin).admin_set_rate_limit_exempt(taco, true));
    expect((await as(bot, alice).get_rate_limit_exempt()).map((p) => p.toText())).toEqual([taco.toText()]);
    const len = (await as(bot, admin).icrc3_get_blocks([{ start: 0n, length: 0n }])).log_length;
    const b = (await as(bot, admin).icrc3_get_blocks([{ start: len - 1n, length: 1n }])).blocks[0].block;
    expect({ t: btype(b), ...plain(tx(b)) }).toMatchObject({ t: 'sneedsms_config_update', key: 'rate_limit_exempt', principal: Buffer.from(taco.toUint8Array()).toString('hex'), old_value: 0n, value: 1n });
    for (let i = 0; i < 50; i++) unwrap(await as(bot, taco).send_message(msg([bob], `notice ${i}`)));
    unwrap(await as(bot, other).send_message(msg([bob], 'first')));
    expect(errOf(await as(bot, other).send_message(msg([bob], 'second'))).RateLimited).toMatch(/Must wait/);
    unwrap(await as(bot, admin).admin_set_rate_limit_exempt(taco, false));
    expect(await as(bot, alice).get_rate_limit_exempt()).toEqual([]);
    expect(errOf(await as(bot, taco).send_message(msg([bob], 'after'))).RateLimited).toMatch(/Must wait/);
  }, 180_000);

  it('admins are exempt', async () => {
    for (let i = 0; i < 15; i++) unwrap(await as(id, admin).send_message(msg([bob], `admin ${i}`)));
  }, 120_000);

  it('admins set it; each change is an ICRC-3 config_update block; an upgrade keeps it', async () => {
    const lastBlock = async () => {
      const len = (await as(id, admin).icrc3_get_blocks([{ start: 0n, length: 0n }])).log_length;
      const b = (await as(id, admin).icrc3_get_blocks([{ start: len - 1n, length: 1n }])).blocks[0].block;
      return { t: btype(b), ...plain(tx(b)) };
    };
    expect(errOf(await as(id, alice).admin_set_send_rate_limit({ capacity: 1n, per_minute: 1n }))).toHaveProperty('Unauthorized');
    expect(errOf(await as(id, admin).admin_set_send_rate_limit({ capacity: 3n, per_minute: 0n }))).toHaveProperty('InvalidInput');
    unwrap(await as(id, admin).admin_set_send_rate_limit({ capacity: 2n, per_minute: 1n }));
    expect(await lastBlock()).toMatchObject({ t: 'sneedsms_config_update', key: 'send_rate_limit', old_value: { capacity: 10n, per_minute: 2n }, value: { capacity: 2n, per_minute: 1n } });
    const g = user('smspg-grace');
    unwrap(await as(id, g).send_message(msg([bob])));
    unwrap(await as(id, g).send_message(msg([bob])));
    expect(await refusedAtIngress(as(id, g).send_message(msg([bob])))).toBe(true);
    await pic.upgradeCanister({ sender: admin, canisterId: id, wasm: wasm(SMS_WASM), arg: IDL.encode([], []), upgradeModeOptions: KEEP });
    expect(await as(id, alice).get_send_rate_limit()).toEqual({ capacity: 2n, per_minute: 1n });
    unwrap(await as(id, admin).admin_set_send_rate_limit({ capacity: 0n, per_minute: 0n })); // off
    for (let i = 0; i < 12; i++) unwrap(await as(id, g).send_message(msg([bob], `free ${i}`)));
  }, 120_000);
});

describe('upgrades with keep', () => {
  for (const from of ['sneed_sms_live', 'sneed_sms_prepaging']) {
    it(`from ${from}: every message kept; the admin pages agree with the old full list`, async () => {
      const id = await install(pic, { name: from });
      unwrap(await as(id, admin).update_config([0n], [], [], []));
      for (let i = 0; i < 5; i++) unwrap(await as(id, alice).send_message(msg([bob, carol], `m${i}`)));
      unwrap(await as(id, bob).remove_self_from_message(1n));
      const before = await as(id, admin).get_all_messages_admin();
      await pic.upgradeCanister({ sender: admin, canisterId: id, wasm: wasm(SMS_WASM), arg: IDL.encode([], []), upgradeModeOptions: KEEP });
      await pic.tick(2);
      expect(json(await as(id, admin).get_all_messages_admin())).toBe(json(before));
      expect(json((await adminPages(as(id, admin), 2)).messages)).toBe(json(byIdDesc(before)));
      expect(unwrap(await as(id, carol).send_message(msg([alice], 'after')))).toBe(6n);
    }, 120_000);
  }
});
