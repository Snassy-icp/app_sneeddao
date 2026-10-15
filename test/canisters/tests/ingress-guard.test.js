// The ingress guard (system func inspect, src/IngressGuard.mo) of every DAO canister:
// - no query method is accepted as an update call (which would go through consensus at the
//   canister's expense), whoever calls it;
// - arguments are capped in size: an update method taking just a Nat refuses a huge one, and
//   still accepts a normal one.
// - the bots accept update calls only from their controllers and botkey principals.
// Method-specific limits (texts against the canister's own config) are covered in each
// canister's own tests.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { IDL } from '@icp-sdk/core/candid';
import { Principal } from '@icp-sdk/core/principal';
import { createPic, install, actorAs, account, admin, alice, carol, T, refusedAtIngress, asUpdates } from '../lib/pic.js';
import { ledgerInit } from '../lib/idl.js';
import { idlFactory as backendIdl } from '../build/app_sneeddao_backend.did.js';
import { idlFactory as forumIdl } from '../build/sneed_sns_forum.did.js';
import { idlFactory as smsIdl } from '../build/sneed_sms.did.js';
import { idlFactory as premiumIdl, init as premiumInit } from '../build/sneed_premium.did.js';
import { idlFactory as rllIdl } from '../build/rll.did.js';
import { idlFactory as lockIdl } from '../build/sneed_lock.did.js';
import { idlFactory as sneedexIdl, init as sneedexInit } from '../build/sneedex.did.js';
import { idlFactory as sneedappIdl } from '../build/sneedapp.did.js';
import { idlFactory as padIdl } from '../build/sneed_pad.did.js';
import { idlFactory as guardianIdl, init as guardianInit } from '../build/sneed_guardian.did.js';
import { idlFactory as stakingBotIdl } from '../build/sneed_icp_staking_bot.did.js';
import { idlFactory as tradingBotIdl } from '../build/sneed_trading_bot.did.js';

/// A value of any Candid type (the smallest one), to call a method with.
function defaultOf(t) {
  switch (t.constructor.name) {
    case 'NatClass': case 'IntClass': return 0n;
    case 'FixedNatClass': case 'FixedIntClass': return t._bits > 32 ? 0n : 0;
    case 'FloatClass': return 0;
    case 'TextClass': return '';
    case 'BoolClass': return false;
    case 'NullClass': case 'ReservedClass': return null;
    case 'PrincipalClass': case 'ServiceClass': return Principal.anonymous();
    case 'OptClass': return [];
    case 'VecClass': return t._type.constructor.name === 'FixedNatClass' && t._type._bits === 8 ? new Uint8Array() : [];
    case 'TupleClass': return t._components.map(defaultOf);
    case 'RecordClass': return Object.fromEntries(t._fields.map(([k, ft]) => [k, defaultOf(ft)]));
    case 'VariantClass': { const [k, ft] = t._fields[0]; return { [k]: defaultOf(ft) }; }
    case 'RecClass': return defaultOf(t._type);
    case 'FuncClass': return [Principal.anonymous(), ''];
    default: throw new Error(`no default for ${t.constructor.name} ${t.name}`);
  }
}

const notRefused = async (promise) => {
  try { await promise; } catch (e) { if (/canister_inspect_message .*refused/.test(String(e?.message || e))) return false; }
  return true;
};

let pic, appSubnet;
const canisters = [];
beforeAll(async () => {
  ({ pic, appSubnet } = await createPic());
  const icpId = await install(pic, { name: 'MockLedger', initTypes: ledgerInit, initArgs: [{ fee: 10_000n, symbol: 'ICP', decimals: 8 }], targetSubnetId: appSubnet });
  const on = { cycles: 20n * T, targetSubnetId: appSubnet };
  const add = async (name, idl, { bot = false, ...extra } = {}) => canisters.push({ name, idl, bot, id: await install(pic, { name, ...on, ...extra }) });
  await add('app_sneeddao_backend', backendIdl);
  await add('sneed_sns_forum', forumIdl);
  await add('sneed_sms', smsIdl);
  await add('sneed_premium', premiumIdl, { initTypes: premiumInit({ IDL }), initArgs: [[]] });
  await add('rll', rllIdl);
  await add('sneed_lock', lockIdl);
  await add('sneedex', sneedexIdl, { initTypes: sneedexInit({ IDL }), initArgs: [[]] });
  await add('sneedapp', sneedappIdl);
  await add('sneed_pad', padIdl);
  await add('sneed_guardian', guardianIdl, {
    initTypes: guardianInit({ IDL }),
    initArgs: [{ name: 'guardian', approvers: [admin], threshold: 1n, archive_controllers: [], admins: [], sneed_premium: [], fee_destination: [account(admin)], icp_ledger: [icpId], sns_wasm: [] }],
  });
  await add('sneed_icp_staking_bot', stakingBotIdl, { bot: true });
  await add('sneed_trading_bot', tradingBotIdl, { bot: true });
}, 300_000);
afterAll(async () => { await pic?.tearDown(); });

describe('ingress guard', () => {
  it('refuses every query method sent as an update call, from a user and from a controller', async () => {
    let checked = 0;
    for (const c of canisters) {
      const fields = c.idl({ IDL })._fields;
      const queries = fields.filter(([, f]) => f.annotations.includes('query') || f.annotations.includes('composite_query'));
      expect(queries.length, c.name).toBeGreaterThan(0);
      for (const who of [alice, admin]) {
        const asUpdate = actorAs(pic, asUpdates(c.idl), c.id, who);
        for (const [name, f] of queries) {
          const ok = await refusedAtIngress(asUpdate[name](...f.argTypes.map(defaultOf))).catch((e) => { throw new Error(`${c.name}.${name}: ${e.message}`); });
          expect(ok, `${c.name}.${name}`).toBe(true);
          checked++;
        }
      }
      // the same methods still answer as query calls
      const [name, f] = queries[0];
      expect(await notRefused(actorAs(pic, c.idl, c.id, alice)[name](...f.argTypes.map(defaultOf))), `${c.name}.${name} as a query`).toBe(true);
    }
    expect(checked).toBeGreaterThan(400);
  }, 600_000);

  it('caps the argument size: a Nat of 5 kB is refused, a small one is not', async () => {
    const tested = [];
    for (const c of canisters.filter((c) => !c.bot)) {
      const fields = c.idl({ IDL })._fields;
      const natOnly = fields.find(([, f]) => !f.annotations.length && f.argTypes.length === 1 && f.argTypes[0].constructor.name === 'NatClass');
      if (!natOnly) continue;
      const [name] = natOnly;
      const a = actorAs(pic, c.idl, c.id, alice);
      expect(await refusedAtIngress(a[name](2n ** 40_000n)), `${c.name}.${name}(huge)`).toBe(true);
      expect(await notRefused(a[name](1n)), `${c.name}.${name}(1)`).toBe(true);
      tested.push(`${c.name}.${name}`);
    }
    expect(tested.length, tested.join(', ')).toBeGreaterThanOrEqual(8);
  }, 300_000);

  it('bots: update calls only from controllers and botkey principals, arguments capped at 64 KiB', async () => {
    for (const c of canisters.filter((c) => c.bot)) {
      const owner = actorAs(pic, c.idl, c.id, admin);
      const stranger = actorAs(pic, c.idl, c.id, alice);
      const botkey = actorAs(pic, c.idl, c.id, carol);
      // a stranger never gets an update through, not even one the method would refuse anyway
      expect(await refusedAtIngress(stranger.setLogLevel({ Info: null })), `${c.name} stranger`).toBe(true);
      expect(await refusedAtIngress(stranger.addHotkeyPermissions(alice, [{ FullPermissions: null }])), `${c.name} stranger escalation`).toBe(true);
      expect(await notRefused(owner.setLogLevel({ Info: null })), `${c.name} controller`).toBe(true);
      // a botkey principal passes the guard; the method still checks its permission
      await owner.addHotkeyPermissions(carol, [{ ViewLogs: null }]);
      expect(await notRefused(botkey.setLogLevel({ Info: null })), `${c.name} botkey`).toBe(true);
      await expect(botkey.setLogLevel({ Info: null }), `${c.name} botkey without ManageLogs`).rejects.toThrow();
      // the cap holds for the controller too
      expect(await refusedAtIngress(owner.setChoreInterval('x'.repeat(70_000), 60n)), `${c.name} huge text`).toBe(true);
      expect(await notRefused(owner.setChoreInterval('no-such-chore', 60n)), `${c.name} small text`).toBe(true);
      // queries still answer anyone as queries
      expect(await notRefused(stranger.getVersion()), `${c.name} getVersion`).toBe(true);
    }
  }, 300_000);
});
