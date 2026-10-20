// sneedapp upgrades from older deployments (fixes of 2026-10-20):
// - the legacy userRegistrations bookmarks are merged into the wallet once,
//   so a bookmark its user removed or moved does not come back on a later upgrade;
// - ICP staking bots filed under the legacy slug "icp-staking-bot" (by the
//   wallet migration and by createNeuronManager) are relabelled with the
//   catalogue slug "sneed-icp-staking-bot", in the wallet and in the mint log.
// Starts from sneedapp at 0532de6d (before the wallet) and at e6e01c4e (before
// these fixes); build.sh compiles both.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Principal } from '@icp-sdk/core/principal';
import { IDL } from '@icp-sdk/core/candid';
import { createPic, install, actorAs, admin, alice, bob, carol, ICP_LEDGER_ID, T, unwrap, wasm } from '../lib/pic.js';
import { ledgerInit } from '../lib/idl.js';
import { idlFactory as factoryIdl } from '../build/sneedapp.did.js';

const CMC_ID = Principal.fromText('rkp4c-7iaaa-aaaaa-aaaca-cai');
const SLUG = 'sneed-icp-staking-bot';
const LEGACY = 'icp-staking-bot';
const c1 = Principal.fromText('rrkah-fqaaa-aaaaa-aaaaq-cai');
const c2 = Principal.fromText('ryjl3-tyaaa-aaaaa-aaaba-cai');
const c3 = Principal.fromText('r7inp-6aaaa-aaaaa-aaabq-cai');
const ids = (entries) => entries.map((e) => e.canisterId.toText()).sort();
const upgrade = (pic, canisterId) => pic.upgradeCanister({ sender: admin, canisterId, wasm: wasm('sneedapp'), arg: IDL.encode([], []) });

describe('sneedapp upgrades from older deployments', () => {
  let pic, factoryId, f, fAlice, fBob, fCarol;

  beforeAll(async () => {
    ({ pic } = await createPic());
    await install(pic, { name: 'MockLedger', initTypes: ledgerInit, initArgs: [{ fee: 10_000n, symbol: 'ICP', decimals: 8 }], targetCanisterId: ICP_LEDGER_ID });
    await install(pic, { name: 'MockCmc', targetCanisterId: CMC_ID });
  }, 120_000);
  afterAll(async () => { await pic?.tearDown(); });

  describe('from before the wallet (legacy userRegistrations)', () => {
    beforeAll(async () => {
      factoryId = await install(pic, { name: 'sneedapp_prewallet', cycles: 20n * T });
      f = actorAs(pic, factoryIdl, factoryId, admin);
      fAlice = actorAs(pic, factoryIdl, factoryId, alice);
      fBob = actorAs(pic, factoryIdl, factoryId, bob);
      fCarol = actorAs(pic, factoryIdl, factoryId, carol);
      // bookmarks as the old factory kept them (registerManager wrote userRegistrations)
      unwrap(await fAlice.registerManager(c1));
      unwrap(await fAlice.registerManager(c2));
      unwrap(await fBob.registerManager(c3));
      await upgrade(pic, factoryId);
    }, 120_000);

    it('merges the legacy bookmarks into the wallet', async () => {
      expect(ids(await fAlice.getMyWallet())).toEqual([c1, c2].map((p) => p.toText()).sort());
      expect(ids(await fBob.getMyWallet())).toEqual([c3.toText()]);
    });

    it('a removed or moved bookmark stays removed across later upgrades', async () => {
      unwrap(await fAlice.deregisterCanister(c1));
      unwrap(await fAlice.transferManager(c2, carol));
      expect(await fAlice.getMyWallet()).toEqual([]);
      await upgrade(pic, factoryId);
      await upgrade(pic, factoryId);
      expect(await fAlice.getMyWallet()).toEqual([]);
      expect(ids(await fCarol.getMyWallet())).toEqual([c2.toText()]);
      expect(ids(await fBob.getMyWallet())).toEqual([c3.toText()]); // untouched bookmarks stay
      expect(await f.getTotalRegistrationCount()).toBe(2n);
    }, 120_000);

    it('files the merged bookmarks under the catalogue slug of the staking bot', async () => {
      expect(await fBob.getMyWallet()).toEqual([{ canisterId: c3, appId: SLUG }]);
      expect(await fBob.getMyWalletForApp(SLUG)).toHaveLength(1);
      expect(await fCarol.getMyWalletForApp(SLUG)).toHaveLength(1);
    });
  });

  describe('from before the slug fix (createNeuronManager filed under "icp-staking-bot")', () => {
    let bot;
    beforeAll(async () => {
      factoryId = await install(pic, { name: 'sneedapp_prev', cycles: 20n * T });
      f = actorAs(pic, factoryIdl, factoryId, admin);
      fAlice = actorAs(pic, factoryIdl, factoryId, alice);
      await f.setPaymentRequired(false);
      await f.setManagerWasm(wasm('MockPremium'));
      bot = unwrap(await fAlice.createNeuronManager()).canisterId;
      unwrap(await fAlice.registerCanister(c1, LEGACY));
      expect((await f.lookupMintedCanister(bot))[0].appId).toBe(LEGACY); // as the old code filed it
      await upgrade(pic, factoryId);
    }, 120_000);

    it('relabels wallet and mint-log entries with the catalogue slug, keeping everything else', async () => {
      const wallet = await fAlice.getMyWallet();
      expect(wallet.map((e) => e.appId)).toEqual([SLUG, SLUG]);
      expect(ids(await fAlice.getMyWalletForApp(SLUG))).toEqual([bot, c1].map((p) => p.toText()).sort());
      const entry = (await f.lookupMintedCanister(bot))[0];
      expect(entry).toMatchObject({ appId: SLUG, index: 0n, numericAppId: 0n, publisherId: 0n });
      expect(await f.getMintLogCountForApp(SLUG)).toBe(1n);
      expect(await f.getMintLogCountForApp(LEGACY)).toBe(0n);
      const q = { startIndex: [], limit: [], appIdFilter: [SLUG], minterFilter: [], fromTime: [], toTime: [] };
      expect((await f.getMintLog(q)).totalCount).toBe(1n);
    });

    it('new legacy mints and bookmarks use the catalogue slug too', async () => {
      const second = unwrap(await fAlice.createNeuronManager()).canisterId;
      expect((await f.lookupMintedCanister(second))[0].appId).toBe(SLUG);
      unwrap(await fAlice.registerCanister(c2, LEGACY));
      expect((await fAlice.getMyWallet()).every((e) => e.appId === SLUG)).toBe(true);
      expect(await f.getMintLogCountForApp(SLUG)).toBe(2n);
    }, 120_000);
  });
});
