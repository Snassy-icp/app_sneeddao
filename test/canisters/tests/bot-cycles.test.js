// The Sneedapp bots' public cycles balance (sneed_icp_staking_bot 0.9.5, sneed_trading_bot 0.9.4):
// `getCyclesBalance : () -> (nat) query` and the cycles wallet's
// `wallet_balance128 : () -> (record { amount : nat }) query` answer anyone, the anonymous
// principal included, so a non-controller (Sneed Monitor, a managed-bots service, other users)
// can see a bot's fuel and top it up through the CMC. canister_status stays controller-only.
// Both bots upgrade from the versions published in SneedApp (releases/: staking 0.9.4, trading
// 0.9.3), which lack the queries, and keep their state.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Principal } from '@icp-sdk/core/principal';
import { IDL } from '@icp-sdk/core/candid';
import { createPic, install, actorAs, admin, carol, ICP_LEDGER_ID, T, wasm, refusedAtIngress, asUpdates } from '../lib/pic.js';
import { ledgerInit } from '../lib/idl.js';
import { idlFactory as stakingIdl } from '../build/sneed_icp_staking_bot.did.js';
import { idlFactory as tradingIdl } from '../build/sneed_trading_bot.did.js';

const RELEASES = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'releases');
const published = (app, version, name) => readFileSync(resolve(RELEASES, app, version, `${name}.wasm`));
const anon = Principal.anonymous();

const BOTS = [
  {
    name: 'sneed_icp_staking_bot', idl: stakingIdl, version: { major: 0n, minor: 9n, patch: 5n },
    prev: { app: 'icp_staking_bot', version: '0.9.4' }, perm: { ViewChores: null }, choreType: 'refresh-stake',
  },
  {
    name: 'sneed_trading_bot', idl: tradingIdl, version: { major: 0n, minor: 9n, patch: 4n },
    prev: { app: 'trading_bot', version: '0.9.3' }, perm: { ViewLogs: null }, choreType: 'trade',
  },
];

let pic, appSubnet;
beforeAll(async () => {
  ({ pic, appSubnet } = await createPic());
  await install(pic, { name: 'MockLedger', initTypes: ledgerInit, initArgs: [{ fee: 10_000n, symbol: 'ICP', decimals: 8 }], targetCanisterId: ICP_LEDGER_ID });
});
afterAll(async () => { await pic?.tearDown(); });

// PocketIC charges for messages and memory between our reads; queries themselves are free
const near = (a, b) => (a > b ? a - b : b - a) < 1_000_000_000n; // within 1B of each other

for (const b of BOTS) {
  describe(`${b.name}: public cycles balance`, () => {
    let id, asAnon;
    beforeAll(async () => {
      id = await install(pic, { name: b.name, cycles: 50n * T, targetSubnetId: appSubnet });
      asAnon = actorAs(pic, b.idl, id, anon);
    });

    it('answers an anonymous caller with the canister\'s balance', async () => {
      const bal = await asAnon.getCyclesBalance();
      expect(near(bal, BigInt(await pic.getCyclesBalance(id)))).toBe(true);
      expect(bal > 49n * T && bal <= 50n * T).toBe(true);
      const w = await asAnon.wallet_balance128();
      expect(near(w.amount, bal)).toBe(true);
    });

    it('follows a permissionless top-up', async () => {
      const before = await asAnon.getCyclesBalance();
      await pic.addCycles(id, 7n * T);
      const after = await asAnon.getCyclesBalance();
      expect(near(after, before + 7n * T)).toBe(true);
    });

    it('is a query only: the ingress guard refuses it as an update call', async () => {
      const asUpdate = actorAs(pic, asUpdates(b.idl), id, anon);
      expect(await refusedAtIngress(asUpdate.getCyclesBalance())).toBe(true);
      expect(await refusedAtIngress(asUpdate.wallet_balance128())).toBe(true);
    });
  });

  describe(`${b.name}: upgrade from the published ${b.prev.version}`, () => {
    let id, bot, asAnon, before;
    beforeAll(async () => {
      id = await pic.createCanister({ sender: admin, cycles: 50n * T, targetSubnetId: appSubnet, controllers: [admin] });
      await pic.installCode({ sender: admin, canisterId: id, wasm: published(b.prev.app, b.prev.version, b.name), arg: IDL.encode([], []) });
      bot = actorAs(pic, b.idl, id, admin);
      asAnon = actorAs(pic, b.idl, id, anon);
      expect(await bot.addHotkeyPermissions(carol, [b.perm])).toEqual({ Ok: null });
      expect(await bot.createChoreInstance(b.choreType, 'second', 'Second instance')).toBe(true);
      await bot.setLogLevel({ Debug: null });
      before = {
        version: await bot.getVersion(), createdAt: await bot.getCreatedAt?.(), botkeys: await bot.getBotkeySnapshot(),
        instances: await bot.listChoreInstances([]), logConfig: await bot.getLogConfig(),
      };
    });

    it(`the published ${b.prev.version} has no cycles query`, async () => {
      expect(before.version).toEqual({ major: 0n, minor: 9n, patch: BigInt(b.prev.version.split('.')[2]) });
      await expect(asAnon.getCyclesBalance()).rejects.toThrow();
    });

    it('upgrades, keeps its state and answers the cycles query', async () => {
      await pic.upgradeCanister({ sender: admin, canisterId: id, wasm: wasm(b.name) });
      expect(await bot.getVersion()).toEqual(b.version);
      if (before.createdAt !== undefined) expect(await bot.getCreatedAt()).toBe(before.createdAt);
      expect(await bot.getBotkeySnapshot()).toEqual(before.botkeys);
      expect(await bot.listChoreInstances([])).toEqual(before.instances);
      // the upgrade itself may log an entry; the settings and earlier entries stay
      const lc = await bot.getLogConfig();
      expect(lc).toMatchObject({ logLevel: { Debug: null }, maxEntries: before.logConfig.maxEntries });
      expect(lc.entryCount >= before.logConfig.entryCount).toBe(true);
      expect(near(await asAnon.getCyclesBalance(), BigInt(await pic.getCyclesBalance(id)))).toBe(true);
    });
  });
}
