// app_sneeddao_backend (the Sneed Hub backend): per-user state. Settings
// (defaults, partial updates, the denomination token), last-seen bot log ids,
// the swap / ledger / tracked canister registries, wallet tokens, the "for"
// methods of authorized canisters (Sneedex), canister groups with their
// regular and premium limits, the wallet layout, and an upgrade keeping it all.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Principal } from '@icp-sdk/core/principal';
import { createPic, install, actorAs, admin, alice, bob, carol, user, T, unwrap, errOf, wasm, nowNs } from '../lib/pic.js';
import { premiumIdl } from '../lib/idl.js';
import { settingsUpdate, ser, upgradeHub } from '../lib/hub.js';
import { idlFactory as hubIdl } from '../build/app_sneeddao_backend.did.js';

const anon = Principal.anonymous();
const sneedex = user('sneedex'); // stands in for an authorized canister
const c = (i) => user(`canister-${i}`); // canister ids are just principals here
const cs = (from, n) => Array.from({ length: n }, (_, i) => c(from + i));
const group = (id, canisters = [], subgroups = []) => ({ id, name: `group ${id}`, canisters, subgroups });
const txt = (list) => list.map((p) => p.toText());
const lay = (opt) => opt.map((l) => Object.fromEntries(Object.entries(l).map(([k, v]) => [k, txt(v)])));
const CKUSDC = 'xevnm-gaaaa-aaaar-qafnq-cai';
const H_NS = 3_600_000_000_000n;

const DEFAULTS = {
  principal_color_coding: true, neuron_color_coding: true, show_vp_bar: true, show_header_notifications: true, collectibles_threshold: 1.0,
  expand_quick_links_on_desktop: false, particle_effects_enabled: true, neuron_manager_cycle_threshold_red: 1_000_000_000_000n,
  neuron_manager_cycle_threshold_orange: 5_000_000_000_000n, canister_manager_cycle_threshold_red: 1_000_000_000_000n,
  canister_manager_cycle_threshold_orange: 5_000_000_000_000n, frontend_auto_update_enabled: false, frontend_clear_cache_on_update: false,
  frontend_update_check_interval_sec: 600n, frontend_update_countdown_sec: 300n, swap_slippage_tolerance: 0.01, always_show_remove_token: false,
  denomination_token: CKUSDC, notify_replies: true, notify_tips: true, notify_messages: true, notify_collectibles: true, notify_votable_proposals: true,
  notify_outdated_bots: true, notify_low_cycles: true, notify_bot_chores: true, notify_bot_log_errors: true, notify_bot_log_warnings: true, notify_updates: true,
};
// a value different from the default for every setting
const CHANGED = {
  principal_color_coding: false, neuron_color_coding: false, show_vp_bar: false, show_header_notifications: false, collectibles_threshold: 2.5,
  expand_quick_links_on_desktop: true, particle_effects_enabled: false, neuron_manager_cycle_threshold_red: 7n, neuron_manager_cycle_threshold_orange: 8n,
  canister_manager_cycle_threshold_red: 9n, canister_manager_cycle_threshold_orange: 10n, frontend_auto_update_enabled: true, frontend_clear_cache_on_update: true,
  frontend_update_check_interval_sec: 60n, frontend_update_countdown_sec: 30n, swap_slippage_tolerance: 0.005, always_show_remove_token: true,
  denomination_token: 'ryjl3-tyaaa-aaaaa-aaaba-cai', notify_replies: false, notify_tips: false, notify_messages: false, notify_collectibles: false,
  notify_votable_proposals: false, notify_outdated_bots: false, notify_low_cycles: false, notify_bot_chores: false, notify_bot_log_errors: false,
  notify_bot_log_warnings: false, notify_updates: false,
};

let pic, appSubnet, hubId, premiumId;
let hub, hubAlice, hubBob, hubCarol, hubAnon, hubSneedex, premium;

describe('app_sneeddao_backend user state', () => {
  beforeAll(async () => {
    ({ pic, appSubnet } = await createPic());
    hubId = await install(pic, { name: 'app_sneeddao_backend', cycles: 20n * T, targetSubnetId: appSubnet });
    premiumId = await install(pic, { name: 'MockPremium', targetSubnetId: appSubnet });
    hub = actorAs(pic, hubIdl, hubId, admin);
    hubAlice = actorAs(pic, hubIdl, hubId, alice); hubBob = actorAs(pic, hubIdl, hubId, bob); hubCarol = actorAs(pic, hubIdl, hubId, carol);
    hubAnon = actorAs(pic, hubIdl, hubId, anon); hubSneedex = actorAs(pic, hubIdl, hubId, sneedex);
    premium = actorAs(pic, premiumIdl, premiumId, admin);
  }, 180_000);
  afterAll(async () => { await pic?.tearDown(); });

  it('settings: defaults for everyone (anonymous too), partial updates, every field round-trips', async () => {
    expect(await hubAnon.get_my_settings()).toEqual(DEFAULTS);
    expect(await hubAlice.get_my_settings()).toEqual(DEFAULTS);
    expect(errOf(await hubAnon.set_my_settings(settingsUpdate({ show_vp_bar: false })))).toMatch(/Anonymous/);
    // an empty update changes nothing
    expect(unwrap(await hubAlice.set_my_settings(settingsUpdate()))).toEqual(DEFAULTS);
    // one field at a time leaves the others alone
    expect(unwrap(await hubAlice.set_my_settings(settingsUpdate({ show_vp_bar: false })))).toEqual({ ...DEFAULTS, show_vp_bar: false });
    expect(unwrap(await hubAlice.set_my_settings(settingsUpdate({ swap_slippage_tolerance: 0.03 })))).toEqual({ ...DEFAULTS, show_vp_bar: false, swap_slippage_tolerance: 0.03 });
    // every field at once
    expect(unwrap(await hubBob.set_my_settings(settingsUpdate(CHANGED)))).toEqual(CHANGED);
    expect(await hubBob.get_my_settings()).toEqual(CHANGED);
    expect(await hubAlice.get_my_settings()).toEqual({ ...DEFAULTS, show_vp_bar: false, swap_slippage_tolerance: 0.03 });
    expect(await hubCarol.get_my_settings()).toEqual(DEFAULTS);
    // setting a value back to the default is stored like any other
    unwrap(await hubAlice.set_my_settings(settingsUpdate({ show_vp_bar: true })));
    expect((await hubAlice.get_my_settings()).show_vp_bar).toBe(true);
  });

  it('the denomination token: ckUSDC by default, any text stored as given', async () => {
    expect((await hubCarol.get_my_settings()).denomination_token).toBe(CKUSDC);
    unwrap(await hubCarol.set_my_settings(settingsUpdate({ denomination_token: 'ryjl3-tyaaa-aaaaa-aaaba-cai' })));
    expect((await hubCarol.get_my_settings()).denomination_token).toBe('ryjl3-tyaaa-aaaaa-aaaba-cai');
    // no validation: the frontend owns the meaning (current behaviour)
    unwrap(await hubCarol.set_my_settings(settingsUpdate({ denomination_token: 'USD' })));
    expect((await hubCarol.get_my_settings()).denomination_token).toBe('USD');
    unwrap(await hubCarol.set_my_settings(settingsUpdate({ denomination_token: '' })));
    expect((await hubCarol.get_my_settings()).denomination_token).toBe('');
    unwrap(await hubCarol.set_my_settings(settingsUpdate({ denomination_token: CKUSDC })));
  });

  it('last-seen bot log ids only move forward, per user and per canister', async () => {
    expect(await hubAlice.get_last_seen_log_id(c(1))).toBe(0n);
    expect(await hubAlice.get_all_last_seen_log_ids()).toEqual([]);
    await hubAlice.mark_logs_seen(c(1), 10n);
    await hubAlice.mark_logs_seen(c(1), 4n); // older: ignored
    await hubAlice.mark_logs_seen(c(2), 3n);
    expect(await hubAlice.get_last_seen_log_id(c(1))).toBe(10n);
    expect(await hubBob.get_last_seen_log_id(c(1))).toBe(0n);
    expect(new Map((await hubAlice.get_all_last_seen_log_ids()).map(([p, n]) => [p.toText(), n]))).toEqual(new Map([[c(1).toText(), 10n], [c(2).toText(), 3n]]));
    await hubAlice.mark_logs_seen(c(1), 11n);
    expect(await hubAlice.get_last_seen_log_id(c(1))).toBe(11n);
    await hubAnon.mark_logs_seen(c(1), 99n); // anonymous: a no-op
    expect(await hubAnon.get_last_seen_log_id(c(1))).toBe(0n);
    expect(await hubAnon.get_all_last_seen_log_ids()).toEqual([]);
  });

  it('swap and ledger canister registries per principal: dedup, removal, anonymous ignored', async () => {
    for (const [reg, unreg, get] of [
      ['register_swap_canister_id', 'unregister_swap_canister_id', 'get_swap_canister_ids'],
      ['register_ledger_canister_id', 'unregister_ledger_canister_id', 'get_ledger_canister_ids'],
    ]) {
      expect(await hubAlice[get]()).toEqual([]);
      await hubAlice[reg](c(1)); await hubAlice[reg](c(2)); await hubAlice[reg](c(1));
      expect(txt(await hubAlice[get]())).toEqual(txt([c(2), c(1)])); // newest first
      await hubBob[reg](c(3));
      expect(txt(await hubBob[get]())).toEqual(txt([c(3)]));
      await hubAlice[unreg](c(1));
      await hubAlice[unreg](c(9)); // not there: fine
      await hubCarol[unreg](c(9)); // nothing registered at all: fine
      expect(txt(await hubAlice[get]())).toEqual(txt([c(2)]));
      await hubAnon[reg](c(4));
      expect(await hubAnon[get]()).toEqual([]);
      await hubAnon[unreg](c(4));
    }
  });

  it('tracked canisters and wallet tokens: own registrations', async () => {
    expect(await hubAlice.get_tracked_canisters()).toEqual([]);
    await hubAlice.register_tracked_canister(c(1)); await hubAlice.register_tracked_canister(c(2)); await hubAlice.register_tracked_canister(c(2));
    expect(txt(await hubAlice.get_tracked_canisters())).toEqual(txt([c(2), c(1)]));
    await hubAlice.unregister_tracked_canister(c(2));
    expect(txt(await hubAlice.get_tracked_canisters())).toEqual(txt([c(1)]));
    await hubAnon.register_tracked_canister(c(1));
    expect(await hubAnon.get_tracked_canisters()).toEqual([]);
    await hubAnon.unregister_tracked_canister(c(1));
    // tokens keep their order of registration
    expect(await hubAlice.get_user_tokens()).toEqual([]);
    await hubAlice.register_user_token(c(10)); await hubAlice.register_user_token(c(11)); await hubAlice.register_user_token(c(10));
    expect(txt(await hubAlice.get_user_tokens())).toEqual(txt([c(10), c(11)]));
    await hubAlice.unregister_user_token(c(10));
    expect(txt(await hubAlice.get_user_tokens())).toEqual(txt([c(11)]));
    await hubAlice.unregister_user_token(c(11));
    expect(await hubAlice.get_user_tokens()).toEqual([]);
    await hubAlice.unregister_user_token(c(11)); // nothing left: fine
    await hubAlice.register_user_token(c(11));
    await hubAnon.register_user_token(c(10));
    await hubAnon.unregister_user_token(c(10));
    expect(await hubAnon.get_user_tokens()).toEqual([]);
  });

  it('"for" methods: only admins and authorized callers act on other users\' wallets', async () => {
    await expect(hubAlice.add_authorized_for_caller(sneedex)).rejects.toThrow(/assertion failed/);
    await expect(hubAnon.add_authorized_for_caller(sneedex)).rejects.toThrow(/assertion failed/);
    expect(await hub.get_authorized_for_callers()).toEqual([]);
    // not authorized: silently nothing
    await hubSneedex.register_tracked_canister_for(bob, c(20));
    await hubSneedex.register_user_token_for(bob, c(21));
    expect(await hubBob.get_tracked_canisters()).toEqual([]);
    expect(await hubBob.get_user_tokens()).toEqual([]);
    await hub.add_authorized_for_caller(sneedex);
    expect(txt(await hubAnon.get_authorized_for_callers())).toEqual(txt([sneedex]));
    await hubSneedex.register_tracked_canister_for(bob, c(20));
    await hubSneedex.register_tracked_canister_for(bob, c(20));
    await hubSneedex.register_user_token_for(bob, c(21));
    await hubSneedex.register_user_token_for(bob, c(21));
    await hubSneedex.register_user_token_for(bob, c(22));
    expect(txt(await hubBob.get_tracked_canisters())).toEqual(txt([c(20)]));
    expect(txt(await hubBob.get_user_tokens())).toEqual(txt([c(21), c(22)]));
    // never for the anonymous principal
    await hubSneedex.register_tracked_canister_for(anon, c(20));
    await hubSneedex.register_user_token_for(anon, c(21));
    expect(await hubAnon.get_tracked_canisters()).toEqual([]);
    expect(await hubAnon.get_user_tokens()).toEqual([]);
    await hubSneedex.unregister_user_token_for(bob, c(21));
    await hubSneedex.unregister_user_token_for(carol, c(21)); // nothing there: fine
    expect(txt(await hubBob.get_user_tokens())).toEqual(txt([c(22)]));
    // admins are authorized without being listed
    await hub.register_tracked_canister_for(bob, c(23));
    await hub.unregister_tracked_canister_for(bob, c(20));
    expect(txt(await hubBob.get_tracked_canisters())).toEqual(txt([c(23)]));
    await hub.unregister_user_token_for(bob, c(22));
    expect(await hubBob.get_user_tokens()).toEqual([]);
    // revoked: no effect any more
    await expect(hubAlice.remove_authorized_for_caller(sneedex)).rejects.toThrow(/assertion failed/);
    await hub.remove_authorized_for_caller(sneedex);
    await hubSneedex.register_tracked_canister_for(bob, c(24));
    await hubSneedex.unregister_tracked_canister_for(bob, c(23));
    expect(txt(await hubBob.get_tracked_canisters())).toEqual(txt([c(23)]));
    await hub.add_authorized_for_caller(sneedex); // listed again for the upgrade test
  });

  it('canister groups: nested folders within the regular limits', async () => {
    expect(await hubAlice.get_canister_groups()).toEqual([]);
    expect(await hub.get_canister_groups_limits_config()).toEqual({ max_canister_groups: 5n, max_canisters_per_group: 20n, max_total_grouped_canisters: 50n, premium_max_canister_groups: 50n, premium_max_canisters_per_group: 100n, premium_max_total_grouped_canisters: 500n });
    const tree = { groups: [group('a', cs(0, 3), [group('a1', cs(3, 2), [group('a1x', cs(5, 1))])]), group('b')], ungrouped: cs(6, 2) };
    unwrap(await hubAlice.set_canister_groups(tree));
    expect(ser(await hubAlice.get_canister_groups())).toBe(ser([tree]));
    expect(await hubBob.get_canister_groups()).toEqual([]);
    expect(await hubAlice.get_my_canister_groups_usage()).toEqual({ group_count: 4n, total_canisters: 8n, max_in_single_group: 3n, ungrouped_count: 2n, group_limit: 5n, per_group_limit: 20n, total_limit: 50n, is_premium: false });
    // nested folders count against the folder limit
    expect(errOf(await hubAlice.set_canister_groups({ groups: [group('a', [], [group('1'), group('2'), group('3'), group('4'), group('5')])], ungrouped: [] }))).toMatch(/maximum number of folders \(5\). You have 6/);
    expect(errOf(await hubAlice.set_canister_groups({ groups: [group('a', [], [group('deep', cs(0, 21))])], ungrouped: [] }))).toMatch(/more than 20 canisters/);
    // ungrouped canisters count against the total
    expect(errOf(await hubAlice.set_canister_groups({ groups: [group('a', cs(0, 20)), group('b', cs(20, 20))], ungrouped: cs(40, 11) }))).toMatch(/maximum total canisters \(50\). You have 51/);
    unwrap(await hubAlice.set_canister_groups({ groups: [group('a', cs(0, 20)), group('b', cs(20, 20))], ungrouped: cs(40, 10) })); // exactly at the limits
    expect((await hubAlice.get_my_canister_groups_usage()).total_canisters).toBe(50n);
    // refused updates leave the stored tree alone; delete removes it
    expect(errOf(await hubAlice.set_canister_groups({ groups: [group('1'), group('2'), group('3'), group('4'), group('5'), group('6')], ungrouped: [] }))).toMatch(/folders/);
    expect((await hubAlice.get_my_canister_groups_usage()).total_canisters).toBe(50n);
    await hubAlice.delete_canister_groups();
    expect(await hubAlice.get_canister_groups()).toEqual([]);
    expect((await hubAlice.get_my_canister_groups_usage()).group_count).toBe(0n);
    unwrap(await hubAlice.set_canister_groups(tree));
  });

  it('canister group limits: admin configurable, premium members get the premium set', async () => {
    expect(errOf(await hubAlice.update_canister_groups_limits([1n], [], [], [], [], []))).toMatch(/Not authorized/);
    unwrap(await hub.update_canister_groups_limits([2n], [], [], [3n], [], []));
    const cfg = await hub.get_canister_groups_limits_config();
    expect(cfg.max_canister_groups).toBe(2n); expect(cfg.premium_max_canister_groups).toBe(3n); expect(cfg.max_canisters_per_group).toBe(20n);
    const three = { groups: [group('1'), group('2'), group('3')], ungrouped: [] };
    expect(errOf(await hubCarol.set_canister_groups(three))).toMatch(/\(2\)/);
    // the alice tree from before stays even though it is now over the limit
    expect((await hubAlice.get_my_canister_groups_usage()).group_count).toBe(4n);
    unwrap(await hub.set_nickname_premium_canister([premiumId]));
    await premium.set_member(carol, (await nowNs(pic)) + H_NS); // premium for an hour
    unwrap(await hubCarol.set_canister_groups(three));
    expect(await hubCarol.get_my_canister_groups_usage()).toMatchObject({ is_premium: true, group_limit: 3n, per_group_limit: 100n, total_limit: 500n });
    expect(errOf(await hubCarol.set_canister_groups({ groups: [...three.groups, group('4')], ungrouped: [] }))).toMatch(/\(3\)/);
    // membership runs out: back to the regular limits
    await pic.advanceTime(2 * 3600 * 1000); await pic.tick(2);
    expect(await hubCarol.get_my_canister_groups_usage()).toMatchObject({ is_premium: false, group_limit: 2n });
    expect(errOf(await hubCarol.set_canister_groups(three))).toMatch(/\(2\)/);
    // a premium canister that does not answer counts as "not premium"
    unwrap(await hub.set_nickname_premium_canister([user('no-such-canister')]));
    expect(await hubCarol.get_my_canister_groups_usage()).toMatchObject({ is_premium: false, group_limit: 2n });
    unwrap(await hub.set_nickname_premium_canister([premiumId]));
    unwrap(await hub.update_canister_groups_limits([5n], [], [], [50n], [], []));
  });

  it('anonymous callers are refused canister groups and wallet layouts; banned users cannot save them', async () => {
    expect(errOf(await hubAnon.set_canister_groups({ groups: [group('anon', cs(0, 1))], ungrouped: [] }))).toMatch(/Anonymous/);
    expect(await hubAnon.get_canister_groups()).toEqual([]);
    await expect(hubAnon.delete_canister_groups()).rejects.toThrow(/Anonymous/);
    await expect(hubAnon.set_wallet_layout({ tokens: [c(1)], positions: [], apps: [], sneedapp: [] })).rejects.toThrow(/Anonymous/);
    expect(await hubAnon.get_wallet_layout()).toEqual([]);
    const eve = user('eve-banned');
    const hubEve = actorAs(pic, hubIdl, hubId, eve);
    unwrap(await hub.ban_user(eve, 1n, 'test'));
    expect(errOf(await hubEve.set_canister_groups({ groups: [group('e')], ungrouped: [] }))).toMatch(/banned/);
    await expect(hubEve.set_wallet_layout({ tokens: [], positions: [], apps: [], sneedapp: [] })).rejects.toThrow(/banned/);
    unwrap(await hub.unban_user(eve));
  });

  it('wallet layout per user, replaced as a whole', async () => {
    expect(await hubBob.get_wallet_layout()).toEqual([]);
    const layout = { tokens: [c(1), c(2)], positions: [c(3)], apps: [c(4)], sneedapp: [c(5), c(6)] };
    await hubAlice.set_wallet_layout(layout);
    expect(lay(await hubAlice.get_wallet_layout())).toEqual(lay([layout]));
    expect(await hubBob.get_wallet_layout()).toEqual([]);
    const layout2 = { tokens: [c(2), c(1)], positions: [], apps: [], sneedapp: [] };
    await hubAlice.set_wallet_layout(layout2);
    expect(lay(await hubAlice.get_wallet_layout())).toEqual(lay([layout2]));
  });

  it('an upgrade keeps settings, log ids, registries, tokens, authorized callers, groups and layouts', async () => {
    const snapshot = async () => {
      const out = {};
      for (const [name, a] of [['alice', hubAlice], ['bob', hubBob], ['carol', hubCarol]]) {
        out[name] = ser({
          settings: await a.get_my_settings(),
          seen: (await a.get_all_last_seen_log_ids()).map(ser).sort(),
          swaps: await a.get_swap_canister_ids(), ledgers: await a.get_ledger_canister_ids(), tracked: await a.get_tracked_canisters(),
          tokens: await a.get_user_tokens(), groups: await a.get_canister_groups(), layout: await a.get_wallet_layout(),
        });
      }
      out.authorized = ser(await hub.get_authorized_for_callers());
      out.limits = ser(await hub.get_canister_groups_limits_config());
      return out;
    };
    const before = await snapshot();
    expect(before.bob).toContain('"swap_slippage_tolerance":0.005');
    await upgradeHub(pic, hubId, admin, wasm('app_sneeddao_backend'));
    await pic.tick(2);
    expect(await snapshot()).toEqual(before);
    expect(await hubBob.get_my_settings()).toEqual(CHANGED);
    // the authorized caller still works after the upgrade
    await hubSneedex.register_user_token_for(carol, c(30));
    expect(txt(await hubCarol.get_user_tokens())).toEqual(txt([c(30)]));
  });
});
