// sneedapp (the SneedApp bot factory, actor class IcpNeuronManagerFactory):
// the app catalogue and its versions, publishers and their permissions, the
// user wallet (bookmarks) and the "for" methods of authorized callers, admin
// and governance guards, the legacy official-version registry, every query,
// and an upgrade of the factory keeping all of it. Minting and payments are in
// sneedapp-mint.test.js. The ICP ledger, the CMC and Sneed Premium are mocks
// at the ids the factory hard-codes.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Principal } from '@icp-sdk/core/principal';
import { IDL } from '@icp-sdk/core/candid';
import { createHash } from 'node:crypto';
import {
  createPic, install, actorAs, account, admin, alice, bob, carol, user, ICP_LEDGER_ID, T, unwrap, errOf, wasm,
} from '../lib/pic.js';
import { ledgerIdl, ledgerInit, cmcIdl, premiumIdl } from '../lib/idl.js';
import { idlFactory as factoryIdl } from '../build/sneedapp.did.js';

const CMC_ID = Principal.fromText('rkp4c-7iaaa-aaaaa-aaaca-cai');
const ICP_FEE = 10_000n;
const dave = user('dave');
const anon = Principal.anonymous();
const sha256hex = (bytes) => createHash('sha256').update(bytes).digest('hex');
// a trap (assert) comes back as a rejected call
const trap = (p) => expect(p).rejects.toThrow();

let pic, icpId, cmcId, premiumId, factoryId;
let icp, cmc, premium, f, fAlice, fBob, fCarol, fAnon;
// two small canisters without init arguments serve as the "app" wasms
const wasmV1 = wasm('MockPremium');
const wasmV2 = wasm('MockCmc');

const publisherInput = (over = {}) => ({ name: 'Alice Labs', description: 'bots by alice', websiteUrl: ['https://alice.example'], logoUrl: [], links: [['docs', 'https://alice.example/docs']], defaultPaymentAccount: account(alice), ...over });
const appInput = (over = {}) => ({ appId: 'demo', name: 'Demo Bot', description: 'a demo', iconUrl: [], mintPriceE8s: 100_000_000n, premiumMintPriceE8s: 50_000_000n, viewUrl: ['https://x/view/{canisterId}'], manageUrl: [], mintUrl: [], families: [], ...over });
const updateInput = (over = {}) => { const { appId, ...rest } = appInput(over); return rest; };
const versionInput = (major, minor, patch, over = {}) => ({ major, minor, patch, wasmHash: `hash-${major}.${minor}.${patch}`, wasmUrl: [], sourceUrl: ['https://src/x'], releaseNotes: `v${major}.${minor}.${patch}`, releaseDate: 1_700_000_000n, ...over });
const ver = (v) => `${v.major}.${v.minor}.${v.patch}`;
const texts = (ps) => ps.map((p) => p.toText()).sort();

describe('sneedapp catalogue, publishers, wallet and admin', () => {
  beforeAll(async () => {
    ({ pic } = await createPic());
    icpId = await install(pic, { name: 'MockLedger', initTypes: ledgerInit, initArgs: [{ fee: ICP_FEE, symbol: 'ICP', decimals: 8 }], targetCanisterId: ICP_LEDGER_ID });
    cmcId = await install(pic, { name: 'MockCmc', targetCanisterId: CMC_ID });
    premiumId = await install(pic, { name: 'MockPremium' });
    factoryId = await install(pic, { name: 'sneedapp', cycles: 100n * T });
    icp = actorAs(pic, ledgerIdl, icpId, admin);
    cmc = actorAs(pic, cmcIdl, cmcId, admin);
    premium = actorAs(pic, premiumIdl, premiumId, admin);
    f = actorAs(pic, factoryIdl, factoryId, admin);
    fAlice = actorAs(pic, factoryIdl, factoryId, alice);
    fBob = actorAs(pic, factoryIdl, factoryId, bob);
    fCarol = actorAs(pic, factoryIdl, factoryId, carol);
    fAnon = actorAs(pic, factoryIdl, factoryId, anon);
  }, 120_000);
  afterAll(async () => { await pic?.tearDown(); });

  it('starts with the installer as its only admin and publisher 0 (Sneed DAO) owned by it, no apps, payment required', async () => {
    expect(texts(await f.getAdmins())).toEqual([admin.toText()]);
    expect(await f.getSneedGovernance()).toEqual([]);
    expect((await f.getCanisterId()).toText()).toBe(factoryId.toText());
    const pub0 = (await f.getPublisher(0n))[0];
    expect(pub0.name).toBe('Sneed DAO');
    expect(pub0.verified).toBe(true);
    expect(pub0.daoCutBasisPoints).toBe(10_000n);
    expect(texts(pub0.owners)).toEqual([admin.toText()]);
    expect(pub0.families).toEqual(['sneed-bots']);
    expect(pub0.defaultPaymentAccount.owner.toText()).toBe(admin.toText()); // the default fee destination: the deployer
    expect(await f.getApps()).toEqual([]);
    expect(await f.getPublishers()).toHaveLength(1);
    const cfg = await f.getPaymentConfig();
    expect(cfg.creationFeeE8s).toBe(100_000_000n);
    expect(cfg.targetCyclesAmount).toBe(2n * T);
    expect(cfg.feeDestination.owner.toText()).toBe(admin.toText());
    expect(cfg.paymentRequired).toBe(true);
    expect(await f.getCanisterCreationCycles()).toBe(1n * T);
    expect(await f.getPremiumCreationFee()).toBe(50_000_000n);
    expect(await f.getSneedPremiumCanisterId()).toEqual([]);
    expect(await f.getCurrentVersion()).toEqual({ major: 0n, minor: 0n, patch: 0n });
    expect(await f.hasManagerWasm()).toBe(false);
    expect(await f.getOfficialVersions()).toEqual([]);
    expect(await f.getAuthorizedForCallers()).toEqual([]);
    expect(Number(await f.getCyclesBalance())).toBeGreaterThan(90e12);
  });

  it('admins add and remove admins (never the last one); governance may configure but not administrate', async () => {
    await trap(fAlice.addAdmin(alice));
    await f.addAdmin(bob);
    await f.addAdmin(bob); // idempotent
    expect(texts(await f.getAdmins())).toEqual(texts([admin, bob]));
    await fBob.removeAdmin(admin); // any admin may remove another
    expect(texts(await f.getAdmins())).toEqual([bob.toText()]);
    await trap(fBob.removeAdmin(bob)); // keeps at least one admin
    await trap(f.addAdmin(admin)); // no longer an admin
    await fBob.addAdmin(admin);
    await f.removeAdmin(bob);
    expect(texts(await f.getAdmins())).toEqual([admin.toText()]);
    // governance: payment settings yes, admin-only things no
    await trap(fAlice.setSneedGovernance([carol]));
    await f.setSneedGovernance([carol]);
    expect((await f.getSneedGovernance())[0].toText()).toBe(carol.toText());
    await fCarol.setCreationFee(200_000_000n);
    expect((await f.getPaymentConfig()).creationFeeE8s).toBe(200_000_000n);
    await trap(fCarol.addAdmin(carol));
    await trap(fCarol.verifyPublisher(0n));
    await trap(fCarol.removeApp(0n));
    await f.setCreationFee(100_000_000n);
    await f.setSneedGovernance([]);
    await trap(fCarol.setCreationFee(1n)); // no longer governance
  });

  it('payment configuration is admin or governance only, and every setter is read back', async () => {
    const cfg = { creationFeeE8s: 300_000_000n, targetCyclesAmount: 3n * T, feeDestination: account(carol), paymentRequired: false };
    await trap(fAlice.setPaymentConfig(cfg));
    await f.setPaymentConfig(cfg);
    const got = await f.getPaymentConfig();
    expect(got.creationFeeE8s).toBe(300_000_000n);
    expect(got.targetCyclesAmount).toBe(3n * T);
    expect(got.feeDestination.owner.toText()).toBe(carol.toText());
    expect(got.paymentRequired).toBe(false);
    for (const call of [
      () => fAlice.setCreationFee(1n), () => fAlice.setTargetCycles(1n), () => fAlice.setFeeDestination(account(alice)), () => fAlice.setPaymentRequired(false),
      () => fAlice.setPremiumCreationFee(1n), () => fAlice.setSneedPremiumCanisterId([premiumId]), () => fAlice.setCanisterCreationCycles(1n),
    ]) await trap(call());
    await f.setCreationFee(100_000_000n);
    await f.setTargetCycles(2n * T);
    await f.setFeeDestination(account(admin));
    await f.setPaymentRequired(true);
    await f.setPremiumCreationFee(40_000_000n);
    await f.setSneedPremiumCanisterId([premiumId]);
    await f.setCanisterCreationCycles(1_500_000_000_000n);
    const back = await f.getPaymentConfig();
    expect(back).toEqual({ creationFeeE8s: 100_000_000n, targetCyclesAmount: 2n * T, feeDestination: account(admin), paymentRequired: true });
    expect(await f.getPremiumCreationFee()).toBe(40_000_000n);
    expect((await f.getSneedPremiumCanisterId())[0].toText()).toBe(premiumId.toText());
    expect(await f.getCanisterCreationCycles()).toBe(1_500_000_000_000n);
    await f.setCanisterCreationCycles(1n * T);
  });

  it('quotes cycles from the CMC rate: 2 T cycles at 3.5 XDR/ICP with 5% headroom is 0.6 ICP', async () => {
    const rate = await f.getConversionRate();
    expect(rate.xdrPermyriadPerIcp).toBe(35_000n);
    expect(rate.cyclesPerIcp).toBe(3_500_000_000_000n);
    expect(await f.calculateIcpForCycles(2n * T)).toBe(60_000_000n);
    await cmc.set_rate(70_000n);
    expect(await f.calculateIcpForCycles(2n * T)).toBe(30_000_000n);
    await cmc.set_rate(35_000n);
    expect(await f.calculateIcpForCycles(0n)).toBe(0n);
  });

  it('anyone but anonymous creates a publisher: unverified, 10% DAO cut, the creator its only owner', async () => {
    expect(errOf(await fAnon.createPublisher(publisherInput()))).toMatch(/Anonymous/);
    expect(unwrap(await fAlice.createPublisher(publisherInput()))).toBe(1n);
    const pub = (await f.getPublisher(1n))[0];
    expect(pub.name).toBe('Alice Labs');
    expect(pub.verified).toBe(false);
    expect(pub.daoCutBasisPoints).toBe(1000n);
    expect(texts(pub.owners)).toEqual([alice.toText()]);
    expect(pub.families).toEqual([]);
    expect(pub.links).toEqual([['docs', 'https://alice.example/docs']]);
    expect(pub.defaultPaymentAccount.owner.toText()).toBe(alice.toText());
    expect((await f.getPublishers()).map((p) => p.publisherId).sort()).toEqual([0n, 1n]);
    expect((await f.getVerifiedPublishers()).map((p) => p.publisherId)).toEqual([0n]);
    expect((await f.getPublishersByOwner(alice)).map((p) => p.publisherId)).toEqual([1n]);
    expect(await f.getPublishersByOwner(bob)).toEqual([]);
    expect(await f.getPublisher(42n)).toEqual([]);
  });

  it('publisher owners edit the profile, owners and families; strangers are refused; the last owner stays', async () => {
    expect(errOf(await fBob.updatePublisher(1n, publisherInput({ name: 'Bob' })))).toBe('Not authorized');
    expect(errOf(await fAlice.updatePublisher(9n, publisherInput()))).toBe('Publisher not found');
    unwrap(await fAlice.updatePublisher(1n, publisherInput({ name: 'Alice Labs 2', defaultPaymentAccount: account(dave) })));
    let pub = (await f.getPublisher(1n))[0];
    expect(pub.name).toBe('Alice Labs 2');
    expect(pub.defaultPaymentAccount.owner.toText()).toBe(dave.toText());
    expect(pub.daoCutBasisPoints).toBe(1000n); // untouched by the profile update
    // owners
    expect(errOf(await fBob.addPublisherOwner(1n, bob))).toBe('Not authorized');
    unwrap(await fAlice.addPublisherOwner(1n, bob));
    expect(errOf(await fAlice.addPublisherOwner(1n, bob))).toBe('Already an owner');
    unwrap(await fBob.updatePublisher(1n, publisherInput({ name: 'Alice & Bob', defaultPaymentAccount: account(alice) })));
    expect(errOf(await fBob.removePublisherOwner(1n, carol))).toBe('Principal is not an owner');
    unwrap(await fBob.removePublisherOwner(1n, bob));
    expect(errOf(await fAlice.removePublisherOwner(1n, alice))).toBe('Cannot remove the last owner');
    expect(errOf(await fBob.updatePublisher(1n, publisherInput()))).toBe('Not authorized');
    // admins may too
    unwrap(await f.addPublisherOwner(1n, bob));
    unwrap(await f.removePublisherOwner(1n, bob));
    // families
    expect(errOf(await fBob.addPublisherFamily(1n, 'bots'))).toBe('Not authorized');
    unwrap(await fAlice.addPublisherFamily(1n, 'bots'));
    expect(errOf(await fAlice.addPublisherFamily(1n, 'bots'))).toBe('Family already exists');
    unwrap(await fAlice.addPublisherFamily(1n, 'tools'));
    pub = (await f.getPublisher(1n))[0];
    expect(pub.families).toEqual(['bots', 'tools']);
    expect(texts(pub.owners)).toEqual([alice.toText()]);
  });

  it('only admins verify publishers and set their DAO cut (at most 100%)', async () => {
    await trap(fAlice.verifyPublisher(1n));
    await trap(f.verifyPublisher(9n));
    await f.verifyPublisher(1n);
    expect((await f.getPublisher(1n))[0].verified).toBe(true);
    expect((await f.getVerifiedPublishers()).map((p) => p.publisherId).sort()).toEqual([0n, 1n]);
    await trap(fAlice.setPublisherDaoCut(1n, 500n));
    await trap(f.setPublisherDaoCut(1n, 10_001n));
    await f.setPublisherDaoCut(1n, 2500n);
    expect((await f.getPublisher(1n))[0].daoCutBasisPoints).toBe(2500n);
    await trap(fAlice.unverifyPublisher(1n));
    await f.unverifyPublisher(1n);
    expect((await f.getPublisher(1n))[0].verified).toBe(false);
    await f.verifyPublisher(1n);
  });

  it('apps: owners add apps under their own publisher, families must be the publisher\'s, ids are unique, minting starts disabled', async () => {
    expect(errOf(await fAlice.addApp(0n, appInput()))).toBe('Not authorized'); // not an owner of Sneed DAO
    expect(errOf(await fAlice.addApp(1n, appInput({ families: ['nope'] })))).toBe("Family 'nope' not in publisher's families");
    expect(errOf(await f.addApp(7n, appInput()))).toBe('Publisher not found');
    expect(unwrap(await fAlice.addApp(1n, appInput({ families: ['bots'] })))).toBe(0n);
    expect(errOf(await fAlice.addApp(1n, appInput()))).toBe('App ID already exists');
    const app = (await f.getApp('demo'))[0];
    expect(app.numericAppId).toBe(0n);
    expect(app.publisherId).toBe(1n);
    expect(app.enabled).toBe(false);
    expect(app.families).toEqual(['bots']);
    expect(app.paymentAccount).toEqual([]);
    expect(app.daoCutBasisPoints).toEqual([]);
    expect(app.mintPriceE8s).toBe(100_000_000n);
    expect((await f.getAppByNumericId(0n))[0].appId).toBe('demo');
    expect(await f.getApp('nothing')).toEqual([]);
    expect(await f.getAppByNumericId(5n)).toEqual([]);
    // admins add apps to any publisher, including Sneed DAO
    expect(unwrap(await f.addApp(0n, appInput({ appId: 'dao-app', name: 'DAO App', families: ['sneed-bots'] })))).toBe(1n);
    expect((await f.getApps()).map((a) => a.appId)).toEqual(['demo', 'dao-app']);
    expect((await f.getAppsByPublisher(1n)).map((a) => a.appId)).toEqual(['demo']);
    expect((await f.getAppsByPublisher(0n)).map((a) => a.appId)).toEqual(['dao-app']);
    expect((await f.getAppsByFamily('bots')).map((a) => a.appId)).toEqual(['demo']);
    expect((await f.getAppsByFamily('sneed-bots')).map((a) => a.appId)).toEqual(['dao-app']);
    expect(await f.getAppsByFamily('none')).toEqual([]);
  });

  it('app settings: owners update, enable, price, set the payment account and families; the DAO cut and removal are admin only', async () => {
    expect(errOf(await fBob.updateApp(0n, updateInput()))).toBe('Not authorized');
    expect(errOf(await fAlice.updateApp(9n, updateInput()))).toBe('App not found');
    expect(errOf(await fAlice.updateApp(0n, updateInput({ families: ['other'] })))).toBe("Family 'other' not in publisher's families");
    unwrap(await fAlice.updateApp(0n, updateInput({ name: 'Demo Bot v2', mintPriceE8s: 1n, families: ['tools'] })));
    let app = (await f.getApp('demo'))[0];
    expect(app.name).toBe('Demo Bot v2');
    expect(app.mintPriceE8s).toBe(1n);
    expect(app.families).toEqual(['tools']);
    expect(app.appId).toBe('demo'); // the id and numeric id never change
    expect(errOf(await fBob.setAppEnabled(0n, true))).toBe('Not authorized');
    unwrap(await fAlice.setAppEnabled(0n, true));
    expect((await f.getApp('demo'))[0].enabled).toBe(true);
    expect(errOf(await fBob.setAppPricing(0n, 5n, 5n))).toBe('Not authorized');
    unwrap(await fAlice.setAppPricing(0n, 100_000_000n, 50_000_000n));
    app = (await f.getApp('demo'))[0];
    expect([app.mintPriceE8s, app.premiumMintPriceE8s]).toEqual([100_000_000n, 50_000_000n]);
    expect(errOf(await fBob.setAppPaymentAccount(0n, [account(bob)]))).toBe('Not authorized');
    unwrap(await fAlice.setAppPaymentAccount(0n, [account(dave)]));
    expect((await f.getApp('demo'))[0].paymentAccount[0].owner.toText()).toBe(dave.toText());
    unwrap(await fAlice.setAppPaymentAccount(0n, []));
    expect(errOf(await fAlice.setAppFamilies(0n, ['bots', 'nope']))).toBe("Family 'nope' not in publisher's families");
    unwrap(await fAlice.setAppFamilies(0n, ['bots', 'tools']));
    expect((await f.getApp('demo'))[0].families).toEqual(['bots', 'tools']);
    // DAO cut: the app override wins over the publisher's, admin only, at most 100%
    expect(await f.getEffectiveDaoCutForApp('demo')).toBe(2500n);
    expect(await f.getEffectiveDaoCutForApp('unknown')).toBe(1000n);
    await trap(fAlice.setAppDaoCut(0n, [2000n]));
    await trap(f.setAppDaoCut(0n, [10_001n]));
    await trap(f.setAppDaoCut(9n, [1n]));
    await f.setAppDaoCut(0n, [2000n]);
    expect(await f.getEffectiveDaoCutForApp('demo')).toBe(2000n);
    expect((await f.getApp('demo'))[0].daoCutBasisPoints).toEqual([2000n]);
    await f.setAppDaoCut(0n, []);
    expect(await f.getEffectiveDaoCutForApp('demo')).toBe(2500n);
    await trap(fAlice.removeApp(0n));
    expect(errOf(await f.removeApp(9n))).toBe('App not found');
  });

  it('removing a family from a publisher strips it from that publisher\'s apps', async () => {
    unwrap(await fAlice.removePublisherFamily(1n, 'tools'));
    expect((await f.getPublisher(1n))[0].families).toEqual(['bots']);
    expect((await f.getApp('demo'))[0].families).toEqual(['bots']);
    expect((await f.getAppByNumericId(0n))[0].families).toEqual(['bots']); // the index too
    expect(await f.getAppsByFamily('tools')).toEqual([]);
    unwrap(await fAlice.removePublisherFamily(1n, 'tools')); // removing a missing family is a no-op
  });

  it('versions: highest-first metadata without blobs, uploads are checked against the declared sha256 and set the size and hasWasm, the "latest" is the highest version that has a wasm', async () => {
    await trap(fBob.addAppVersion('demo', versionInput(1n, 0n, 0n)));
    await trap(fAlice.addAppVersion('no-such-app', versionInput(1n, 0n, 0n)));
    await fAlice.addAppVersion('demo', versionInput(1n, 0n, 0n));
    await fAlice.addAppVersion('demo', versionInput(1n, 1n, 0n, { wasmHash: '' })); // no hash declared: the upload fills it in
    await trap(fAlice.addAppVersion('demo', versionInput(1n, 1n, 0n))); // duplicate version number
    let versions = await f.getAppVersions('demo');
    expect(versions.map(ver)).toEqual(['1.1.0', '1.0.0']);
    expect(versions.every((v) => !v.hasWasm && v.wasmSize === 0n)).toBe(true);
    expect(await f.getLatestAppVersion('demo')).toEqual([]); // none has a wasm yet
    expect(await f.getAppVersions('other')).toEqual([]);
    expect((await f.getAppVersion('demo', 1n, 0n, 0n))[0].releaseNotes).toBe('v1.0.0');
    expect(await f.getAppVersion('demo', 9n, 0n, 0n)).toEqual([]);
    expect(await f.hasAppVersionWasm('demo', 1n, 0n, 0n)).toBe(false);
    // uploads: owner or admin, only for a version that exists
    await trap(fBob.uploadAppVersionWasm('demo', 1n, 0n, 0n, wasmV1));
    await trap(fAlice.uploadAppVersionWasm('demo', 2n, 0n, 0n, wasmV1));
    // the declared wasmHash is checked: 'hash-1.0.0' is not the sha256 of wasmV1
    await trap(fAlice.uploadAppVersionWasm('demo', 1n, 0n, 0n, wasmV1));
    expect(await f.hasAppVersionWasm('demo', 1n, 0n, 0n)).toBe(false);
    // and so is the module itself: bytes without the wasm (or gzip) magic are refused
    await fAlice.updateAppVersion('demo', 1n, 0n, 0n, versionInput(1n, 0n, 0n, { wasmHash: '' }));
    await trap(fAlice.uploadAppVersionWasm('demo', 1n, 0n, 0n, Uint8Array.from([1, 2, 3, 4])));
    // a hash given in upper case matches and is stored in lower case
    await fAlice.updateAppVersion('demo', 1n, 0n, 0n, versionInput(1n, 0n, 0n, { wasmHash: sha256hex(wasmV1).toUpperCase() }));
    await fAlice.uploadAppVersionWasm('demo', 1n, 0n, 0n, wasmV1);
    const v100 = (await f.getAppVersion('demo', 1n, 0n, 0n))[0];
    expect(v100.hasWasm).toBe(true);
    expect(v100.wasmSize).toBe(BigInt(wasmV1.length));
    expect(await f.hasAppVersionWasm('demo', 1n, 0n, 0n)).toBe(true);
    expect(ver((await f.getLatestAppVersion('demo'))[0])).toBe('1.0.0'); // the only one with a wasm
    expect(v100.wasmHash).toBe(sha256hex(wasmV1));
    await f.uploadAppVersionWasm('demo', 1n, 1n, 0n, wasmV2); // admins may too
    expect((await f.getAppVersion('demo', 1n, 1n, 0n))[0].wasmHash).toBe(sha256hex(wasmV2)); // filled in
    expect(ver((await f.getLatestAppVersion('demo'))[0])).toBe('1.1.0');
    // "latest" is the highest version, not the most recently added: a 0.9.0
    // added later and given a wasm neither becomes the latest nor heads the list
    await fAlice.addAppVersion('demo', versionInput(0n, 9n, 0n, { wasmHash: sha256hex(wasmV1) }));
    await fAlice.uploadAppVersionWasm('demo', 0n, 9n, 0n, wasmV1);
    expect(ver((await f.getLatestAppVersion('demo'))[0])).toBe('1.1.0');
    expect((await f.getAppVersions('demo')).map(ver)).toEqual(['1.1.0', '1.0.0', '0.9.0']);
    await fAlice.removeAppVersion('demo', 0n, 9n, 0n);
    expect(ver((await f.getLatestAppVersion('demo'))[0])).toBe('1.1.0');
    // with a wasm uploaded, a metadata update must keep a matching hash
    await trap(fAlice.updateAppVersion('demo', 1n, 0n, 0n, versionInput(1n, 0n, 0n, { wasmHash: sha256hex(wasmV2) })));
    // metadata updates keep the blob and its size
    await fAlice.updateAppVersion('demo', 1n, 0n, 0n, versionInput(1n, 0n, 0n, { releaseNotes: 'patched notes', wasmHash: sha256hex(wasmV1) }));
    const updated = (await f.getAppVersion('demo', 1n, 0n, 0n))[0];
    expect(updated.releaseNotes).toBe('patched notes');
    expect(updated.wasmHash).toBe(sha256hex(wasmV1));
    expect(updated.wasmSize).toBe(BigInt(wasmV1.length));
    expect(updated.hasWasm).toBe(true);
    // clearing frees the blob but keeps the version
    await trap(fBob.clearAppVersionWasm('demo', 1n, 1n, 0n));
    await fAlice.clearAppVersionWasm('demo', 1n, 1n, 0n);
    const v110 = (await f.getAppVersion('demo', 1n, 1n, 0n))[0];
    expect(v110.hasWasm).toBe(false);
    expect(v110.wasmSize).toBe(0n);
    expect(ver((await f.getLatestAppVersion('demo'))[0])).toBe('1.0.0');
    await fAlice.uploadAppVersionWasm('demo', 1n, 1n, 0n, wasmV2);
    // removing takes the blob with it
    await trap(fBob.removeAppVersion('demo', 1n, 1n, 0n));
    await fAlice.addAppVersion('demo', versionInput(2n, 0n, 0n, { wasmHash: sha256hex(wasmV2) }));
    await fAlice.uploadAppVersionWasm('demo', 2n, 0n, 0n, wasmV2);
    await fAlice.removeAppVersion('demo', 2n, 0n, 0n);
    expect(await f.hasAppVersionWasm('demo', 2n, 0n, 0n)).toBe(false);
    versions = await f.getAppVersions('demo');
    expect(versions.map(ver)).toEqual(['1.1.0', '1.0.0']);
  });

  it('removing an app leaves its versions behind: an app re-added under the same id inherits them', async () => {
    unwrap(await fAlice.addApp(1n, appInput({ appId: 'tmp', name: 'Temp' })));
    const tmpId = (await f.getApp('tmp'))[0].numericAppId;
    await fAlice.addAppVersion('tmp', versionInput(1n, 0n, 0n, { wasmHash: sha256hex(wasmV1) }));
    await fAlice.uploadAppVersionWasm('tmp', 1n, 0n, 0n, wasmV1);
    unwrap(await f.removeApp(tmpId));
    expect(await f.getApp('tmp')).toEqual([]);
    expect(await f.getAppByNumericId(tmpId)).toEqual([]);
    expect((await f.getApps()).map((a) => a.appId)).toEqual(['demo', 'dao-app']);
    // NOTE (current behaviour): removeApp deletes the app record only; the
    // version list and the wasm blob stay keyed by the app id string.
    expect((await f.getAppVersions('tmp')).map(ver)).toEqual(['1.0.0']);
    expect(await f.hasAppVersionWasm('tmp', 1n, 0n, 0n)).toBe(true);
    unwrap(await f.addApp(0n, appInput({ appId: 'tmp', name: 'Temp again', families: [] })));
    expect(ver((await f.getLatestAppVersion('tmp'))[0])).toBe('1.0.0'); // inherited by a different publisher's app
    unwrap(await f.removeApp((await f.getApp('tmp'))[0].numericAppId));
  });

  it('wallet: users bookmark canisters, filter by app, transfer and remove them; only admins read other wallets', async () => {
    const c1 = Principal.fromText('aaaaa-aa');
    const c2 = Principal.fromText('rrkah-fqaaa-aaaaa-aaaaq-cai');
    unwrap(await fAlice.registerCanister(c1, 'demo'));
    unwrap(await fAlice.registerManager(c2)); // the legacy call: no app id
    expect(await fAlice.getMyWallet()).toEqual([{ canisterId: c1, appId: 'demo' }, { canisterId: c2, appId: '' }]);
    expect(await fAlice.getMyWalletForApp('demo')).toEqual([{ canisterId: c1, appId: 'demo' }]);
    expect(texts(await fAlice.getMyManagers())).toEqual(texts([c1, c2]));
    expect(texts(await f.getManagersByOwner(alice))).toEqual(texts([c1, c2]));
    unwrap(await fAlice.registerCanister(c1, 'other')); // a known app id is kept
    expect((await fAlice.getMyWalletForApp('demo')).length).toBe(1);
    unwrap(await fAlice.registerCanister(c2, 'demo')); // an empty one is filled in
    expect((await fAlice.getMyWalletForApp('demo')).length).toBe(2);
    expect(await fAlice.getMyWallet()).toHaveLength(2); // no duplicates
    expect(await fBob.getMyWallet()).toEqual([]);
    expect(await f.getRegisteredUserCount()).toBe(1n);
    expect(await f.getTotalRegistrationCount()).toBe(2n);
    expect(await f.getManagerCount()).toBe(2n);
    // admin-only views
    await trap(fAlice.getUserWallet(bob));
    await trap(fAlice.getAllWallets());
    await trap(fAlice.getAllRegistrations());
    expect(await f.getUserWallet(alice)).toHaveLength(2);
    const all = await f.getAllWallets();
    expect(all.map(([p]) => p.toText())).toEqual([alice.toText()]);
    expect((await f.getAllRegistrations())[0][1].map((p) => p.toText()).sort()).toEqual(texts([c1, c2]));
    // transfer: the entry moves with its app id
    expect(errOf(await fBob.transferManager(c1, carol))).toMatch(/not in your registered list/);
    unwrap(await fAlice.transferManager(c1, bob));
    expect(await fBob.getMyWallet()).toEqual([{ canisterId: c1, appId: 'demo' }]);
    expect(await fAlice.getMyWallet()).toEqual([{ canisterId: c2, appId: 'demo' }]);
    expect(await f.getRegisteredUserCount()).toBe(2n);
    // removal
    expect(errOf(await fAlice.deregisterCanister(c1))).toMatch(/not found/);
    expect(errOf(await fAlice.deregisterManager(c1))).toMatch(/not in your registered list/);
    unwrap(await fAlice.deregisterManager(c2));
    expect(await fAlice.getMyWallet()).toEqual([]);
    expect(await f.getRegisteredUserCount()).toBe(1n); // empty wallets disappear
    unwrap(await fBob.deregisterCanister(c1));
    expect(await f.getRegisteredUserCount()).toBe(0n);
    expect(await f.getManagerByCanisterId(c1)).toEqual([]); // deprecated, always empty
    await fAlice.updateManagerNeuronId(c1, []); // deprecated no-op
  });

  it('the "for" methods: authorized callers and admins register for others, never for anonymous', async () => {
    const c = Principal.fromText('aaaaa-aa');
    expect(errOf(await fAlice.registerCanisterFor(bob, c, 'demo'))).toBe('Not authorized');
    expect(errOf(await fAlice.registerManagerFor(bob, c))).toBe('Not authorized');
    expect(errOf(await fAlice.deregisterCanisterFor(bob, c))).toBe('Not authorized');
    expect(errOf(await fAlice.deregisterManagerFor(bob, c))).toBe('Not authorized');
    await trap(fAlice.addAuthorizedForCaller(alice));
    await f.addAuthorizedForCaller(bob);
    expect(texts(await f.getAuthorizedForCallers())).toEqual([bob.toText()]);
    unwrap(await fBob.registerCanisterFor(carol, c, 'demo'));
    expect(await f.getUserWallet(carol)).toEqual([{ canisterId: c, appId: 'demo' }]);
    expect(errOf(await fBob.registerCanisterFor(anon, c, 'demo'))).toMatch(/anonymous/);
    expect(errOf(await fBob.registerManagerFor(anon, c))).toMatch(/anonymous/);
    expect(errOf(await fBob.deregisterCanisterFor(anon, c))).toMatch(/anonymous/);
    expect(errOf(await fBob.deregisterManagerFor(anon, c))).toMatch(/anonymous/);
    unwrap(await fBob.deregisterCanisterFor(carol, c));
    expect(await f.getUserWallet(carol)).toEqual([]);
    unwrap(await fBob.registerManagerFor(carol, c));
    expect(await f.getUserWallet(carol)).toEqual([{ canisterId: c, appId: '' }]);
    unwrap(await fBob.deregisterManagerFor(carol, c));
    unwrap(await fBob.deregisterManagerFor(carol, c)); // removing what is not there is fine
    await trap(fAlice.removeAuthorizedForCaller(bob));
    await f.removeAuthorizedForCaller(bob);
    expect(await f.getAuthorizedForCallers()).toEqual([]);
    expect(errOf(await fBob.registerCanisterFor(carol, c, 'demo'))).toBe('Not authorized');
    unwrap(await f.registerCanisterFor(carol, c, 'demo')); // admins always may
    unwrap(await f.deregisterCanisterFor(carol, c));
    // the admin bulk tools
    await trap(fAlice.adminRegisterCanister(bob, c, 'demo'));
    await trap(fAlice.adminBulkRegisterCanisters([[bob, c, 'demo']]));
    await f.adminRegisterCanister(bob, c, 'demo');
    expect(await f.adminBulkRegisterCanisters([[bob, c, 'demo'], [carol, c, 'x'], [dave, c, '']])).toBe(3n);
    expect(await f.getUserWallet(bob)).toEqual([{ canisterId: c, appId: 'demo' }]);
    expect(await f.getUserWallet(dave)).toEqual([{ canisterId: c, appId: '' }]);
    expect(await f.getRegisteredUserCount()).toBe(3n);
  });

  it('the legacy official-version registry is admin only and looks hashes up case-insensitively', async () => {
    const v = (major, hash) => ({ major, minor: 0n, patch: 0n, wasmHash: hash, wasmUrl: 'https://w', sourceUrl: 'https://s' });
    await trap(fAlice.addOfficialVersion(v(1n, 'ABCDEF')));
    await f.addOfficialVersion(v(1n, 'ABCDEF'));
    await f.addOfficialVersion(v(2n, '123456'));
    expect((await f.getOfficialVersions()).map((o) => o.major)).toEqual([1n, 2n]);
    expect((await f.getOfficialVersionByHash('abcdef'))[0].major).toBe(1n);
    expect(await f.getOfficialVersionByHash('zzz')).toEqual([]);
    await f.addOfficialVersion(v(3n, 'abcdef')); // same hash: replaced in place
    expect((await f.getOfficialVersions()).map((o) => o.major)).toEqual([3n, 2n]);
    expect(await f.updateOfficialVersion('ABCDEF', v(4n, 'abcdef'))).toBe(true);
    expect(await f.updateOfficialVersion('nope', v(4n, 'nope'))).toBe(false);
    expect((await f.getOfficialVersionByHash('ABCDEF'))[0].major).toBe(4n);
    await trap(fAlice.removeOfficialVersion('abcdef'));
    expect(await f.removeOfficialVersion('ABCDEF')).toBe(true);
    expect(await f.removeOfficialVersion('ABCDEF')).toBe(false);
    await trap(fAlice.setOfficialVersions([]));
    await f.setOfficialVersions([v(9n, 'ff')]);
    expect((await f.getOfficialVersions()).map((o) => o.major)).toEqual([9n]);
  });

  it('the legacy manager wasm and current version are admin or governance only', async () => {
    await trap(fAlice.setManagerWasm(wasmV1));
    await f.setManagerWasm(wasmV1);
    expect(await f.hasManagerWasm()).toBe(true);
    expect(await f.getManagerWasmSize()).toBe(BigInt(wasmV1.length));
    await trap(fAlice.setCurrentVersion({ major: 1n, minor: 2n, patch: 3n }));
    await f.setCurrentVersion({ major: 1n, minor: 2n, patch: 3n });
    expect(await f.getCurrentVersion()).toEqual({ major: 1n, minor: 2n, patch: 3n });
    await trap(fAlice.clearManagerWasm());
    await f.clearManagerWasm();
    expect(await f.hasManagerWasm()).toBe(false);
    expect(await f.getManagerWasmSize()).toBe(0n);
  });

  it('logs are empty before any mint; the audit logs are admin only', async () => {
    const q = { startIndex: [], limit: [], appIdFilter: [], minterFilter: [], fromTime: [], toTime: [] };
    expect(await f.getMintLog(q)).toEqual({ entries: [], totalCount: 0n, hasMore: false });
    expect(await f.getMintLogCount()).toBe(0n);
    expect(await f.getMintLogCountForApp('demo')).toBe(0n);
    expect(await f.getMintLogEntry(0n)).toEqual([]);
    expect(await f.lookupMintedCanister(factoryId)).toEqual([]);
    expect(await f.wasMintedByUs(factoryId)).toBe(false);
    const lq = { startIndex: [], limit: [], callerFilter: [], canisterFilter: [], fromTime: [], toTime: [] };
    const fq = { startIndex: [], limit: [], canisterFilter: [], fromTime: [], toTime: [] };
    await trap(fAlice.getCreationLog(lq));
    await trap(fAlice.getCreationLogCount());
    await trap(fAlice.getRecentCreations(5n));
    await trap(fAlice.getFinancialLog(fq));
    await trap(fAlice.getFinancialLogCount());
    await trap(fAlice.getMergedLog(lq));
    await trap(fAlice.getFactoryAggregates());
    await trap(fAlice.getOrphanCanisters());
    expect(await f.getOrphanCanisters()).toEqual([]);
    expect(await f.getCreationLog(lq)).toEqual({ entries: [], totalCount: 0n, hasMore: false });
    expect(await f.getCreationLogCount()).toBe(0n);
    expect(await f.getRecentCreations(5n)).toEqual([]);
    expect(await f.getFinancialLog(fq)).toEqual({ entries: [], totalCount: 0n, hasMore: false });
    expect(await f.getFinancialLogCount()).toBe(0n);
    expect(await f.getMergedLog(lq)).toEqual({ entries: [], totalCount: 0n, hasMore: false });
    const agg = await f.getFactoryAggregates();
    expect(agg.totalCanistersCreated).toBe(0n);
    expect(agg.totalIcpPaidE8s).toBe(0n);
    expect(await f.getAllPublisherStats()).toEqual([]);
    expect(await f.getAllAppRevenueStats()).toEqual([]);
    expect(await f.getPublisherStats(1n)).toEqual([]);
    expect(await f.getAppRevenueStats(0n)).toEqual([]);
    expect(await f.getDaoRevenueStats()).toEqual({ totalDaoCutReceivedE8s: 0n, totalDirectRevenueE8s: 0n, totalRevenueE8s: 0n });
    // the price quote needs no deposit; unknown apps quote zero
    const price = await f.getAppMintPrice('demo', alice);
    expect(price).toEqual({ regular: 100_000_000n, premium: 50_000_000n, applicable: 100_000_000n, isPremium: false });
    expect(await f.getAppMintPrice('nothing', alice)).toEqual({ regular: 0n, premium: 0n, applicable: 0n, isPremium: false });
    // the revenue subaccounts: 'P' + publisher id (8 bytes BE); 'A' + publisher id + app id
    const pSub = Array.from(await f.getPublisherRevenueSubaccount(1n));
    expect(pSub.length).toBe(32);
    expect(pSub.slice(0, 9)).toEqual([0x50, 0, 0, 0, 0, 0, 0, 0, 1]);
    const aSub = Array.from(await f.getAppRevenueSubaccount(1n, 0n));
    expect(aSub.slice(0, 17)).toEqual([0x41, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(await f.getPublisherRevenueBalance(1n)).toBe(0n);
    expect(await f.getAppRevenueBalance(1n, 0n)).toBe(0n);
    expect(await f.getIcpBalance()).toBe(0n);
  });

  it('keeps publishers, apps, versions, wasm blobs, wallets, authorized callers and settings across an upgrade', async () => {
    await f.addAuthorizedForCaller(carol);
    const before = {
      publishers: (await f.getPublishers()).sort((a, b) => Number(a.publisherId - b.publisherId)),
      apps: await f.getApps(),
      versions: await f.getAppVersions('demo'),
      wallets: (await f.getAllWallets()).sort(([a], [b]) => a.toText().localeCompare(b.toText())),
      authorized: texts(await f.getAuthorizedForCallers()),
      config: await f.getPaymentConfig(),
      official: await f.getOfficialVersions(),
      cut: await f.getEffectiveDaoCutForApp('demo'),
      current: await f.getCurrentVersion(),
      admins: texts(await f.getAdmins()),
      premium: await f.getSneedPremiumCanisterId(),
    };
    expect(before.versions.some((v) => v.hasWasm)).toBe(true);
    await pic.upgradeCanister({ sender: admin, canisterId: factoryId, wasm: wasm('sneedapp'), arg: IDL.encode([], []) });
    const after = {
      publishers: (await f.getPublishers()).sort((a, b) => Number(a.publisherId - b.publisherId)),
      apps: await f.getApps(),
      versions: await f.getAppVersions('demo'),
      wallets: (await f.getAllWallets()).sort(([a], [b]) => a.toText().localeCompare(b.toText())),
      authorized: texts(await f.getAuthorizedForCallers()),
      config: await f.getPaymentConfig(),
      official: await f.getOfficialVersions(),
      cut: await f.getEffectiveDaoCutForApp('demo'),
      current: await f.getCurrentVersion(),
      admins: texts(await f.getAdmins()),
      premium: await f.getSneedPremiumCanisterId(),
    };
    expect(after).toEqual(before);
    expect(await f.hasAppVersionWasm('demo', 1n, 0n, 0n)).toBe(true);
    expect(await f.hasAppVersionWasm('demo', 1n, 1n, 0n)).toBe(true);
    expect((await f.getAppByNumericId(0n))[0].appId).toBe('demo'); // the indexes are rebuilt
    expect((await f.getPublisher(0n))[0].name).toBe('Sneed DAO'); // not re-created
    expect(await f.getPublishers()).toHaveLength(2);
    // still fully functional: owners keep their rights, new apps get fresh numeric ids
    expect(unwrap(await fAlice.addApp(1n, appInput({ appId: 'after', name: 'After' })))).toBe(4n); // ids 2 and 3 went to the two 'tmp' apps; never reused
    unwrap(await f.removeApp(4n));
  }, 120_000);
});
