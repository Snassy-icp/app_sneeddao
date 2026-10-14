// sneedapp (the SneedApp bot factory): minting app canisters. The user deposits
// ICP into a per-user subaccount of the factory (no ICRC-2 pull) and calls
// mintCanister; the factory splits the price into ICP for cycles (to its main
// account, then to the CMC), the publisher's share (a revenue subaccount) and
// the DAO cut (the fee destination), creates the canister with its own cycles,
// installs the version's wasm and hands control to the user alone. Only apps of
// verified publishers (and Sneed DAO's own) mint, and while payment is required
// the price must cover the cycles a new canister costs. Covered:
// refusals before payment, the exact ledger movements, Sneed Premium pricing,
// Sneed DAO apps, app-level payment accounts and publisher withdrawals, user
// withdrawals, the per-caller payment lock (interleaved calls), rollback of a
// failed payment (MockLedgerFaulty) or installation (the canister is deleted),
// the legacy createNeuronManager with the real ICP staking bot, the audit logs,
// admin ICP tools, upgrades of minted canisters by their owner and an upgrade
// of the factory. A few tests pin down debatable current behaviour; they say so
// in a NOTE comment.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Principal } from '@icp-sdk/core/principal';
import { IDL } from '@icp-sdk/core/candid';
import { createHash } from 'node:crypto';
import { crc32 } from 'node:zlib';
import {
  createPic, install, actorAs, account, admin, alice, bob, carol, user, principalToSubaccount, ICP_LEDGER_ID, T, unwrap, errOf, wasm,
} from '../lib/pic.js';
import { ledgerIdl, ledgerInit, cmcIdl, premiumIdl } from '../lib/idl.js';
import { idlFactory as factoryIdl } from '../build/sneedapp.did.js';
import { idlFactory as stakingBotIdl } from '../build/sneed_icp_staking_bot.did.js';

const CMC_ID = Principal.fromText('rkp4c-7iaaa-aaaaa-aaaca-cai');
const ICP_FEE = 10_000n;
const ICP = 100_000_000n;
const CYCLES_ICP = 60_000_000n; // 2 T cycles at 3.5 XDR/ICP plus 5%
const MIN_CYCLES_ICP = 30_000_000n; // 1 T cycles (what a creation spends) at the same rate
const treasury = user('treasury');
const dave = user('dave');
const faultIdl = ({ IDL }) => IDL.Service({
  set_fail_to: IDL.Func([IDL.Vec(IDL.Principal)], [], []),
  set_fail_from_main: IDL.Func([IDL.Vec(IDL.Principal)], [], []),
});
const premiumQueryIdl = ({ IDL }) => IDL.Service({
  checkMembership: IDL.Func([IDL.Principal], [IDL.Variant({ Active: IDL.Record({ expiration: IDL.Int }), Expired: IDL.Record({ expiredAt: IDL.Int }), NotFound: IDL.Null })], ['query']),
});
const wasmV1 = wasm('MockPremium');
const wasmV2 = wasm('MockCmc');
const trap = (p) => expect(p).rejects.toThrow();
const texts = (ps) => ps.map((p) => p.toText()).sort();
const LOGQ = { startIndex: [], limit: [], appIdFilter: [], minterFilter: [], fromTime: [], toTime: [] };
const CLOGQ = { startIndex: [], limit: [], callerFilter: [], canisterFilter: [], fromTime: [], toTime: [] };
const FLOGQ = { startIndex: [], limit: [], canisterFilter: [], fromTime: [], toTime: [] };

let pic, icpId, factoryId, premiumId;
let icp, fault, cmc, premium, f, fAlice, fBob, fCarol, fDave;

const depositAccount = (p) => account(factoryId, principalToSubaccount(p));
const deposit = (p, amount) => icp.mint(depositAccount(p), amount);
const bal = (acc) => icp.icrc1_balance_of(acc);
const pubSub = (id) => f.getPublisherRevenueSubaccount(id);
const txCount = async () => (await icp.get_transactions()).length;
const newTxs = async (from) => (await icp.get_transactions()).slice(from);
/// The legacy ICP account identifier, computed independently.
function accountId(principal) {
  const h = createHash('sha224').update(Buffer.concat([Buffer.from([0x0a]), Buffer.from('account-id'), Buffer.from(principal.toUint8Array()), Buffer.alloc(32)])).digest();
  const c = Buffer.alloc(4); c.writeUInt32BE(crc32(h) >>> 0);
  return Buffer.concat([c, h]);
}

describe('sneedapp minting and payments', () => {
  beforeAll(async () => {
    ({ pic } = await createPic());
    icpId = await install(pic, { name: 'MockLedgerFaulty', initTypes: ledgerInit, initArgs: [{ fee: ICP_FEE, symbol: 'ICP', decimals: 8 }], targetCanisterId: ICP_LEDGER_ID });
    await install(pic, { name: 'MockCmc', targetCanisterId: CMC_ID });
    premiumId = await install(pic, { name: 'MockPremium' });
    factoryId = await install(pic, { name: 'sneedapp', cycles: 100n * T });
    icp = actorAs(pic, ledgerIdl, icpId, admin);
    fault = actorAs(pic, faultIdl, icpId, admin);
    cmc = actorAs(pic, cmcIdl, CMC_ID, admin);
    premium = actorAs(pic, premiumIdl, premiumId, admin);
    f = actorAs(pic, factoryIdl, factoryId, admin);
    fAlice = actorAs(pic, factoryIdl, factoryId, alice);
    fBob = actorAs(pic, factoryIdl, factoryId, bob);
    fCarol = actorAs(pic, factoryIdl, factoryId, carol);
    fDave = actorAs(pic, factoryIdl, factoryId, dave);
    await f.setFeeDestination(account(treasury));
    await f.setSneedPremiumCanisterId([premiumId]);
    // alice publishes "demo" (unverified publisher, 25% DAO cut): 1 ICP, 0.8 ICP for members
    unwrap(await fAlice.createPublisher({ name: 'Alice Labs', description: '', websiteUrl: [], logoUrl: [], links: [], defaultPaymentAccount: account(alice) }));
    await f.setPublisherDaoCut(1n, 2500n);
    unwrap(await fAlice.addApp(1n, { appId: 'demo', name: 'Demo', description: '', iconUrl: [], mintPriceE8s: ICP, premiumMintPriceE8s: 80_000_000n, viewUrl: [], manageUrl: [], mintUrl: [], families: [] }));
    const v = (major, minor) => ({ major, minor, patch: 0n, wasmHash: '', wasmUrl: [], sourceUrl: [], releaseNotes: '', releaseDate: 0n });
    await fAlice.addAppVersion('demo', v(1n, 0n));
    await fAlice.uploadAppVersionWasm('demo', 1n, 0n, 0n, wasmV1);
    await fAlice.addAppVersion('demo', v(1n, 1n));
    await fAlice.uploadAppVersionWasm('demo', 1n, 1n, 0n, wasmV2);
    await fAlice.addAppVersion('demo', v(2n, 0n)); // metadata only, no wasm
    // a Sneed DAO app (publisher 0), 1 ICP
    unwrap(await f.addApp(0n, { appId: 'dao-app', name: 'DAO App', description: '', iconUrl: [], mintPriceE8s: ICP, premiumMintPriceE8s: ICP / 2n, viewUrl: [], manageUrl: [], mintUrl: [], families: ['sneed-bots'] }));
    await f.addAppVersion('dao-app', v(1n, 0n));
    await f.uploadAppVersionWasm('dao-app', 1n, 0n, 0n, wasmV1);
    unwrap(await f.setAppEnabled(1n, true));
  }, 120_000);
  afterAll(async () => { await pic?.tearDown(); });

  it('refuses unknown and disabled apps, apps of unverified publishers, unknown or wasm-less versions and a lack of cycles before touching the deposit', async () => {
    await deposit(carol, ICP);
    expect(errOf(await fCarol.mintCanister('nothing', [], [], []))).toEqual({ AppNotFound: null });
    expect(errOf(await fCarol.mintCanister('demo', [], [], []))).toEqual({ AppDisabled: null });
    unwrap(await fAlice.setAppEnabled(0n, true));
    expect((await f.getPublisher(1n))[0].verified).toBe(false);
    expect(errOf(await fCarol.mintCanister('demo', [], [], []))).toEqual({ PublisherNotVerified: null });
    await f.verifyPublisher(1n);
    expect(errOf(await fCarol.mintCanister('demo', [9n], [0n], [0n]))).toEqual({ VersionNotFound: null });
    expect(errOf(await fCarol.mintCanister('demo', [2n], [0n], [0n]))).toEqual({ NoWasmForVersion: null });
    // a partial version means "latest"
    await f.setCanisterCreationCycles(1000n * T);
    expect(errOf(await fCarol.mintCanister('demo', [1n], [], []))).toEqual({ InsufficientCycles: null });
    await f.setCanisterCreationCycles(1n * T);
    expect(await bal(depositAccount(carol))).toBe(ICP);
    expect(await f.getMintLogCount()).toBe(0n);
  });

  it('takes nothing and says how much is missing when the deposit is short', async () => {
    await deposit(bob, 50_000_000n);
    expect(await f.getUserPaymentBalance(bob)).toBe(50_000_000n);
    expect(Array.from(await f.getPaymentSubaccount(bob))).toEqual(Array.from(principalToSubaccount(bob)));
    const before = await txCount();
    expect(errOf(await fBob.mintCanister('demo', [], [], []))).toEqual({ InsufficientPayment: { required: ICP, provided: 50_000_000n } });
    expect(await txCount()).toBe(before);
    expect(await f.getUserPaymentBalance(bob)).toBe(50_000_000n);
  });

  it('mints a publisher app: cycles ICP (plus the CMC transfer fee) to its main account, 75% of the profit to the publisher subaccount, 25% to the fee destination; the user alone controls the canister', async () => {
    const txFrom = await txCount();
    const cyclesBefore = await f.getCyclesBalance();
    const res = unwrap(await fCarol.mintCanister('demo', [], [], []));
    const id = res.canisterId;
    expect(Buffer.from(res.accountId).equals(accountId(id))).toBe(true);
    // profit = 1 ICP - 0.6 ICP for cycles - 4 transfer fees (3 from the deposit, 1 to the CMC); DAO cut 25%
    const profit = ICP - CYCLES_ICP - 4n * ICP_FEE;
    const daoCut = (profit * 2500n) / 10_000n;
    const share = profit - daoCut;
    expect([profit, daoCut, share]).toEqual([39_960_000n, 9_990_000n, 29_970_000n]);
    const txs = await newTxs(txFrom);
    expect(txs.map((t) => [t.to.owner.toText(), t.amount])).toEqual([
      [factoryId.toText(), CYCLES_ICP + ICP_FEE], [factoryId.toText(), share], [treasury.toText(), daoCut], [CMC_ID.toText(), CYCLES_ICP],
    ]);
    expect(txs.slice(0, 3).every((t) => t.from.owner.toText() === factoryId.toText() && Buffer.from(t.from.subaccount[0]).equals(Buffer.from(principalToSubaccount(carol))))).toBe(true);
    expect(txs[3].from.owner.toText()).toBe(factoryId.toText()); // the CMC transfer comes from the main account
    expect(txs[3].from.subaccount.length === 0 || Buffer.from(txs[3].from.subaccount[0]).equals(Buffer.alloc(32))).toBe(true);
    expect(await f.getUserPaymentBalance(carol)).toBe(0n); // exactly the price, fees included
    expect(await bal(account(treasury))).toBe(daoCut);
    expect(await f.getPublisherRevenueBalance(1n)).toBe(share);
    expect(await bal(account(factoryId, await pubSub(1n)))).toBe(share);
    // the canister: installed with the latest version that has a wasm (1.1.0 = MockCmc), carol its only controller
    expect(texts(await pic.getControllers(id))).toEqual([carol.toText()]);
    const minted = actorAs(pic, cmcIdl, id, carol);
    expect((await minted.get_icp_xdr_conversion_rate()).data.xdr_permyriad_per_icp).toBe(35_000n);
    const childCycles = await pic.getCyclesBalance(id);
    expect(childCycles > 0n && childCycles <= 1n * T).toBe(true);
    expect(cyclesBefore - (await f.getCyclesBalance()) >= 1n * T).toBe(true);
    // wallet and mint log
    expect(await fCarol.getMyWallet()).toEqual([{ canisterId: id, appId: 'demo' }]);
    expect(await f.wasMintedByUs(id)).toBe(true);
    const entry = (await f.lookupMintedCanister(id))[0];
    expect(entry).toMatchObject({ index: 0n, appId: 'demo', numericAppId: 0n, publisherId: 1n, versionMajor: 1n, versionMinor: 1n, versionPatch: 0n, icpPaidE8s: ICP, wasPremium: false, daoCutE8s: daoCut, publisherRevenueE8s: share });
    expect(entry.minter.toText()).toBe(carol.toText());
    // stats
    expect(await f.getPublisherStats(1n)).toEqual([{ publisherId: 1n, totalRevenueE8s: share, totalWithdrawnE8s: 0n, totalDaoCutE8s: daoCut, totalMintCount: 1n }]);
    expect(await f.getAppRevenueStats(0n)).toEqual([{ numericAppId: 0n, publisherId: 1n, totalRevenueE8s: share, totalWithdrawnE8s: 0n, totalDaoCutE8s: daoCut, mintCount: 1n }]);
    expect(await f.getDaoRevenueStats()).toEqual({ totalDaoCutReceivedE8s: daoCut, totalDirectRevenueE8s: 0n, totalRevenueE8s: daoCut });
  }, 120_000);

  it('the first mint already buys its cycles: the main account receives the CMC transfer fee too and forwards exactly the cycles ICP; the fee is counted', async () => {
    const notes = await cmc.get_notifications();
    expect(notes.length).toBe(1);
    expect(notes[0][1].toText()).toBe(factoryId.toText());
    expect(await f.getIcpBalance()).toBe(0n); // nothing left behind in the main account
    const fin = (await f.getFinancialLog(FLOGQ)).entries[0];
    expect(fin.cyclesReceivedFromCmc).toBe(1n * T); // what the mock CMC answers
    expect(fin.icpForCyclesE8s).toBe(CYCLES_ICP);
    expect(fin.cyclesSpentOnCreation).toBe(1n * T);
    expect(fin.icpTransferFeesE8s).toBe(4n * ICP_FEE); // the CMC transfer's fee included
  });

  it('charges Sneed Premium members the member price', async () => {
    const now = BigInt(Math.round(await pic.getTime())) * 1_000_000n;
    await premium.set_member(bob, now + 3_600n * 1_000_000_000n);
    expect(await f.getAppMintPrice('demo', bob)).toEqual({ regular: ICP, premium: 80_000_000n, applicable: 80_000_000n, isPremium: true });
    await deposit(bob, 30_000_000n); // 0.8 ICP in total now
    const id = unwrap(await fBob.mintCanister('demo', [], [], [])).canisterId;
    const profit = 80_000_000n - CYCLES_ICP - 4n * ICP_FEE;
    const daoCut = (profit * 2500n) / 10_000n;
    expect(await f.getUserPaymentBalance(bob)).toBe(0n);
    const entry = (await f.lookupMintedCanister(id))[0];
    expect(entry.wasPremium).toBe(true);
    expect(entry.icpPaidE8s).toBe(80_000_000n);
    expect(entry.daoCutE8s).toBe(daoCut);
    expect(entry.publisherRevenueE8s).toBe(profit - daoCut);
    // every mint tops up the cycles it paid for
    const notes = await cmc.get_notifications();
    expect(notes.length).toBe(2);
    expect(notes[1][1].toText()).toBe(factoryId.toText());
    expect(await f.getIcpBalance()).toBe(0n);
    const fin = (await f.getFinancialLog({ ...FLOGQ, canisterFilter: [id] })).entries[0];
    expect(fin.cyclesReceivedFromCmc).toBe(1n * T); // what the mock CMC answers
    // the membership is cached until it expires, then the regular price applies
    await pic.advanceTime(2 * 3_600 * 1000); await pic.tick(2);
    expect(await f.getAppMintPrice('demo', bob)).toMatchObject({ applicable: ICP, isPremium: false });
  }, 120_000);

  it('mints a specific version on request', async () => {
    await deposit(dave, ICP);
    const id = unwrap(await fDave.mintCanister('demo', [1n], [0n], [0n])).canisterId;
    expect((await f.lookupMintedCanister(id))[0]).toMatchObject({ versionMajor: 1n, versionMinor: 0n, versionPatch: 0n });
    const minted = actorAs(pic, premiumQueryIdl, id, dave); // 1.0.0 is MockPremium
    expect(await minted.checkMembership(dave)).toEqual({ NotFound: null });
    expect(await f.getMintLogCountForApp('demo')).toBe(3n);
  }, 120_000);

  it('Sneed DAO apps: two transfers from the deposit, the whole profit to the fee destination, counted as direct revenue', async () => {
    await deposit(carol, ICP);
    const treasuryBefore = await bal(account(treasury));
    const txFrom = await txCount();
    const id = unwrap(await fCarol.mintCanister('dao-app', [], [], [])).canisterId;
    const profit = ICP - CYCLES_ICP - 3n * ICP_FEE;
    const txs = await newTxs(txFrom);
    expect(txs.map((t) => [t.to.owner.toText(), t.amount])).toEqual([[factoryId.toText(), CYCLES_ICP + ICP_FEE], [treasury.toText(), profit], [CMC_ID.toText(), CYCLES_ICP]]);
    expect((await bal(account(treasury))) - treasuryBefore).toBe(profit);
    expect(await f.getUserPaymentBalance(carol)).toBe(0n);
    expect((await f.lookupMintedCanister(id))[0]).toMatchObject({ publisherId: 0n, numericAppId: 1n, daoCutE8s: profit, publisherRevenueE8s: 0n });
    const dao = await f.getDaoRevenueStats();
    expect(dao.totalDirectRevenueE8s).toBe(profit);
    expect(dao.totalRevenueE8s).toBe(dao.totalDirectRevenueE8s + dao.totalDaoCutReceivedE8s);
    expect((await f.getPublisherStats(0n))[0]).toMatchObject({ totalRevenueE8s: 0n, totalDaoCutE8s: profit, totalMintCount: 1n });
    expect(await f.getPublisherRevenueBalance(0n)).toBe(0n);
    expect((await fCarol.getMyWallet()).map((e) => e.appId)).toEqual(['demo', 'dao-app']);
  }, 120_000);

  it('publisher withdrawals: owners only (not even admins), everything less one fee to the default payment account, stats follow', async () => {
    const owed = await f.getPublisherRevenueBalance(1n);
    expect(owed > 0n).toBe(true);
    expect(errOf(await fBob.withdrawPublisherFunds(1n))).toBe('Not authorized');
    expect(errOf(await f.withdrawPublisherFunds(1n))).toBe('Not authorized');
    expect(errOf(await fAlice.withdrawPublisherFunds(9n))).toBe('Not authorized');
    const aliceBefore = await bal(account(alice));
    expect(unwrap(await fAlice.withdrawPublisherFunds(1n))).toBe(owed - ICP_FEE);
    expect((await bal(account(alice))) - aliceBefore).toBe(owed - ICP_FEE);
    expect(await f.getPublisherRevenueBalance(1n)).toBe(0n);
    expect((await f.getPublisherStats(1n))[0].totalWithdrawnE8s).toBe(owed - ICP_FEE);
    expect(errOf(await fAlice.withdrawPublisherFunds(1n))).toMatch(/Insufficient balance/);
  });

  it('an app with its own payment account collects in an app subaccount that only withdrawAppFunds pays out, to that account', async () => {
    unwrap(await fAlice.setAppPaymentAccount(0n, [account(dave)]));
    await deposit(carol, ICP);
    unwrap(await fCarol.mintCanister('demo', [], [], []));
    const share = 29_970_000n;
    expect(await f.getAppRevenueBalance(1n, 0n)).toBe(share);
    expect(await bal(account(factoryId, await f.getAppRevenueSubaccount(1n, 0n)))).toBe(share);
    expect(await f.getPublisherRevenueBalance(1n)).toBe(0n);
    expect(errOf(await fAlice.withdrawPublisherFunds(1n))).toMatch(/Insufficient balance/);
    expect(errOf(await fBob.withdrawAppFunds(1n, 0n))).toBe('Not authorized');
    expect(errOf(await fAlice.withdrawAppFunds(1n, 9n))).toBe('App not found');
    expect(errOf(await fAlice.withdrawAppFunds(1n, 1n))).toBe('App does not belong to this publisher'); // dao-app is publisher 0's
    // NOTE (current behaviour): with the override removed, the money already in
    // the app subaccount cannot be withdrawn by anyone until it is set again.
    unwrap(await fAlice.setAppPaymentAccount(0n, []));
    expect(errOf(await fAlice.withdrawAppFunds(1n, 0n))).toMatch(/no payment account override/);
    unwrap(await fAlice.setAppPaymentAccount(0n, [account(dave)]));
    const daveBefore = await bal(account(dave));
    expect(unwrap(await fAlice.withdrawAppFunds(1n, 0n))).toBe(share - ICP_FEE);
    expect((await bal(account(dave))) - daveBefore).toBe(share - ICP_FEE);
    expect((await f.getAppRevenueStats(0n))[0].totalWithdrawnE8s).toBe(share - ICP_FEE);
    expect(errOf(await fAlice.withdrawAppFunds(1n, 0n))).toMatch(/Insufficient balance/);
    unwrap(await fAlice.setAppPaymentAccount(0n, []));
  }, 120_000);

  it('withdrawUserPayment returns an unused deposit less one fee, and refuses dust', async () => {
    expect(errOf(await fDave.withdrawUserPayment())).toEqual({ InsufficientFunds: { balance: 0n } });
    await deposit(dave, 5_000n);
    expect(errOf(await fDave.withdrawUserPayment())).toEqual({ InsufficientFunds: { balance: 5_000n } });
    await deposit(dave, 1_000_000n);
    const before = await bal(account(dave));
    unwrap(await fDave.withdrawUserPayment());
    expect((await bal(account(dave))) - before).toBe(1_005_000n - ICP_FEE);
    expect(await f.getUserPaymentBalance(dave)).toBe(0n);
  });

  it('serializes payment operations per caller: a second mint and a withdrawal during a mint are refused, other callers are not blocked', async () => {
    await deposit(carol, 2n * ICP);
    await deposit(dave, ICP);
    const deferred = pic.createDeferredActor({ idlFactory: factoryIdl, canisterId: factoryId });
    deferred.setPrincipal(carol);
    const mint1 = await deferred.mintCanister('demo', [], [], []);
    const withdraw = await deferred.withdrawUserPayment();
    const mint2 = await deferred.mintCanister('demo', [], [], []);
    const other = pic.createDeferredActor({ idlFactory: factoryIdl, canisterId: factoryId });
    other.setPrincipal(dave);
    const daveMint = await other.mintCanister('demo', [], [], []);
    const [r1, rw, r2, rd] = [await mint1(), await withdraw(), await mint2(), await daveMint()];
    // PocketIC does not run the ingress messages of one round in submission
    // order: whichever of carol's three calls runs first holds the lock, the
    // other two are refused
    const won = [r1, rw, r2].filter((r) => 'Ok' in r);
    expect(won.length).toBe(1);
    for (const r of [r1, r2]) if ('Err' in r) expect(r.Err.TransferFailed).toMatch(/already in progress/);
    if ('Err' in rw) expect(rw.Err).toEqual({ TemporarilyUnavailable: null });
    unwrap(rd); // dave was never blocked
    // either one price was taken (not two), or the whole deposit was withdrawn
    expect(await f.getUserPaymentBalance(carol)).toBe('Ok' in rw ? 0n : ICP);
    if ('Ok' in rw) await deposit(carol, ICP);
    // the lock is released afterwards
    unwrap(await fCarol.mintCanister('demo', [], [], []));
    expect(await f.getUserPaymentBalance(carol)).toBe(0n);
  }, 180_000);

  it('rolls the payment back when the DAO cut transfer fails: the deposit is back less four fees, nothing is minted', async () => {
    await deposit(carol, ICP);
    const mints = await f.getMintLogCount();
    const pubBefore = await f.getPublisherRevenueBalance(1n);
    const mainBefore = await f.getIcpBalance();
    await fault.set_fail_to([treasury]);
    try {
      const err = errOf(await fCarol.mintCanister('demo', [], [], []));
      expect(err.TransferFailed).toMatch(/Failed to transfer DAO cut; your deposit \(less ledger fees\) remains/);
      expect(await f.getUserPaymentBalance(carol)).toBe(ICP - 4n * ICP_FEE);
      expect(await f.getPublisherRevenueBalance(1n)).toBe(pubBefore);
      expect(await f.getIcpBalance()).toBe(mainBefore);
      expect(await f.getMintLogCount()).toBe(mints);
      expect(await f.getOrphanCanisters()).toEqual([]); // the canister created for it was deleted
      // same for a Sneed DAO app (its single external transfer is the profit)
      await deposit(carol, 4n * ICP_FEE);
      expect(errOf(await fCarol.mintCanister('dao-app', [], [], [])).TransferFailed).toMatch(/Failed to transfer DAO profit/);
      expect(await f.getUserPaymentBalance(carol)).toBe(ICP - 2n * ICP_FEE);
    } finally {
      await fault.set_fail_to([]);
    }
    unwrap(await fCarol.withdrawUserPayment());
  }, 120_000);

  it('says how much ICP is stuck in the factory when the rollback fails too, which an admin can return by hand', async () => {
    await deposit(carol, ICP);
    await fault.set_fail_to([treasury]);
    await fault.set_fail_from_main([factoryId]); // the undo of the cycles transfer comes from the main account
    try {
      const err = errOf(await fCarol.mintCanister('demo', [], [], []));
      expect(err.TransferFailed).toMatch(/Failed to transfer DAO cut; returning 60010000 e8s .* held inside the factory canister pending manual return/);
      expect(await f.getUserPaymentBalance(carol)).toBe(ICP - CYCLES_ICP - 4n * ICP_FEE); // the publisher share came back
    } finally {
      await fault.set_fail_to([]);
      await fault.set_fail_from_main([]);
    }
    await trap(fCarol.adminWithdrawIcp(CYCLES_ICP, depositAccount(carol)));
    unwrap(await f.adminWithdrawIcp(CYCLES_ICP, depositAccount(carol)));
    expect(await f.getUserPaymentBalance(carol)).toBe(ICP - 4n * ICP_FEE); // fees: cycles, share, share undo, the manual return
    unwrap(await fCarol.withdrawUserPayment());
  }, 120_000);

  it('the factory never mints at its own expense: apps of unverified publishers are refused, and so is any price that cannot buy the cycles a creation spends', async () => {
    // Anyone may create a publisher, add an app, upload a wasm and enable it.
    const pid = unwrap(await fDave.createPublisher({ name: 'Free Stuff', description: '', websiteUrl: [], logoUrl: [], links: [], defaultPaymentAccount: account(dave) }));
    const numId = unwrap(await fDave.addApp(pid, { appId: 'free', name: 'Free', description: '', iconUrl: [], mintPriceE8s: 0n, premiumMintPriceE8s: 0n, viewUrl: [], manageUrl: [], mintUrl: [], families: [] }));
    await fDave.addAppVersion('free', { major: 1n, minor: 0n, patch: 0n, wasmHash: '', wasmUrl: [], sourceUrl: [], releaseNotes: '', releaseDate: 0n });
    await fDave.uploadAppVersionWasm('free', 1n, 0n, 0n, wasmV1);
    unwrap(await fDave.setAppEnabled(numId, true));
    expect(await f.getUserPaymentBalance(dave)).toBe(0n);
    const cyclesBefore = await f.getCyclesBalance();
    const txFrom = await txCount();
    const mints = await f.getMintLogCount();
    // unverified: refused outright
    expect(errOf(await fDave.mintCanister('free', [], [], []))).toEqual({ PublisherNotVerified: null });
    // verified, but a zero price buys no cycles
    await f.verifyPublisher(pid);
    expect(errOf(await fDave.mintCanister('free', [], [], [])).CanisterCreationFailed).toMatch(/too low to cover the cycles .* nothing was charged/);
    // neither do 3 ledger fees, nor one e8 less than 1 T cycles plus the 4 fees
    unwrap(await fDave.setAppPricing(numId, 3n * ICP_FEE, 3n * ICP_FEE));
    await deposit(dave, 3n * ICP_FEE);
    expect(errOf(await fDave.mintCanister('free', [], [], [])).CanisterCreationFailed).toMatch(/too low/);
    const minimum = MIN_CYCLES_ICP + 4n * ICP_FEE;
    unwrap(await fDave.setAppPricing(numId, minimum - 1n, minimum - 1n));
    await deposit(dave, minimum - 3n * ICP_FEE);
    expect(errOf(await fDave.mintCanister('free', [], [], [])).CanisterCreationFailed).toMatch(new RegExp(`at least ${minimum} e8s`));
    expect(await txCount()).toBe(txFrom + 2); // only the two test deposits
    expect(await f.getUserPaymentBalance(dave)).toBe(minimum);
    expect(await f.getMintLogCount()).toBe(mints);
    expect(cyclesBefore - (await f.getCyclesBalance()) < T / 10n).toBe(true); // no canister was created
    // at exactly the minimum it mints, and all of it (less fees) buys cycles
    unwrap(await fDave.setAppPricing(numId, minimum, minimum));
    const txFrom2 = await txCount();
    const id = unwrap(await fDave.mintCanister('free', [], [], [])).canisterId;
    expect((await newTxs(txFrom2)).map((t) => [t.to.owner.toText(), t.amount])).toEqual([[factoryId.toText(), MIN_CYCLES_ICP + ICP_FEE], [CMC_ID.toText(), MIN_CYCLES_ICP]]);
    expect(await f.getUserPaymentBalance(dave)).toBe(2n * ICP_FEE); // the fees of the skipped zero transfers stay
    expect((await f.lookupMintedCanister(id))[0]).toMatchObject({ daoCutE8s: 0n, publisherRevenueE8s: 0n, icpPaidE8s: minimum });
    unwrap(await fDave.withdrawUserPayment());
    unwrap(await fDave.setAppEnabled(numId, false));
  }, 120_000);

  it('a version whose wasm cannot be installed costs nothing but fees: the payment comes back and the canister is deleted', async () => {
    await fAlice.addAppVersion('demo', { major: 3n, minor: 0n, patch: 0n, wasmHash: '', wasmUrl: [], sourceUrl: [], releaseNotes: 'broken', releaseDate: 0n });
    await fAlice.uploadAppVersionWasm('demo', 3n, 0n, 0n, Uint8Array.from([0, 97, 115, 109, 1, 0, 0, 0, 255])); // the magic is right, the body is not
    try {
      await deposit(carol, ICP - (await f.getUserPaymentBalance(carol)));
      const mints = await f.getMintLogCount();
      const wallet = (await fCarol.getMyWallet()).length;
      const notes = (await cmc.get_notifications()).length;
      const mainBefore = await f.getIcpBalance();
      const pubBefore = await f.getPublisherRevenueBalance(1n);
      const treasuryBefore = await bal(account(treasury));
      const err = errOf(await fCarol.mintCanister('demo', [3n], [0n], [0n]));
      expect(err.CanisterCreationFailed).toMatch(/Wasm module is not valid.*; your deposit \(less ledger fees\) remains in your payment subaccount/s);
      // fees: cycles transfer, share transfer and their two undos
      expect(await f.getUserPaymentBalance(carol)).toBe(ICP - 4n * ICP_FEE);
      expect(await f.getIcpBalance()).toBe(mainBefore);
      expect(await f.getPublisherRevenueBalance(1n)).toBe(pubBefore);
      expect(await bal(account(treasury))).toBe(treasuryBefore); // nothing left the factory
      expect((await cmc.get_notifications()).length).toBe(notes);
      expect(await f.getMintLogCount()).toBe(mints);
      expect((await fCarol.getMyWallet()).length).toBe(wallet);
      expect(await f.getOrphanCanisters()).toEqual([]); // stopped and deleted, nothing left behind
    } finally {
      await fAlice.removeAppVersion('demo', 3n, 0n, 0n);
    }
    unwrap(await fCarol.withdrawUserPayment());
  }, 120_000);

  it('minted canisters are upgraded by their owner directly: the factory is no controller and has no upgrade call; others are refused', async () => {
    const entry = (await f.getMintLog({ ...LOGQ, minterFilter: [dave], appIdFilter: ['demo'] })).entries[0];
    const id = entry.canisterId;
    expect(entry.versionMinor).toBe(0n); // 1.0.0, MockPremium
    expect(texts(await pic.getControllers(id))).toEqual([dave.toText()]);
    await expect(pic.upgradeCanister({ sender: bob, canisterId: id, wasm: wasmV2 })).rejects.toThrow();
    await expect(pic.upgradeCanister({ sender: factoryId, canisterId: id, wasm: wasmV2 })).rejects.toThrow();
    await pic.reinstallCode({ sender: dave, canisterId: id, wasm: wasmV2, arg: IDL.encode([], []) }); // to 1.1.0 (a different actor)
    const minted = actorAs(pic, cmcIdl, id, dave);
    expect((await minted.get_icp_xdr_conversion_rate()).data.xdr_permyriad_per_icp).toBe(35_000n);
    // NOTE (current behaviour): the mint log keeps the minted version; the factory does not track upgrades
    expect((await f.lookupMintedCanister(id))[0].versionMinor).toBe(0n);
    expect(texts(await pic.getControllers(id))).toEqual([dave.toText()]);
  }, 120_000);

  it('works without payment when an admin turns payment off: nothing is charged and the logs say so', async () => {
    await f.setPaymentRequired(false);
    try {
      const txFrom = await txCount();
      const res = unwrap(await fBob.mintCanister('demo', [], [], []));
      expect(await txCount()).toBe(txFrom);
      const entry = (await f.lookupMintedCanister(res.canisterId))[0];
      expect(entry.icpPaidE8s).toBe(0n);
      expect(entry.daoCutE8s).toBe(0n);
    } finally {
      await f.setPaymentRequired(true);
    }
  }, 120_000);

  it('the legacy createNeuronManager installs the real ICP staking bot, charges the creation fee and logs it as an icp-staking-bot mint', async () => {
    await f.setManagerWasm(wasm('sneed_icp_staking_bot'));
    await f.setCurrentVersion({ major: 7n, minor: 8n, patch: 9n });
    await deposit(alice, 50_000_000n);
    expect(errOf(await fAlice.createNeuronManager())).toEqual({ InsufficientPayment: { required: ICP, provided: 50_000_000n } });
    await deposit(alice, 50_000_000n);
    const treasuryBefore = await bal(account(treasury));
    const res = unwrap(await fAlice.createNeuronManager());
    const id = res.canisterId;
    expect(Buffer.from(res.accountId).equals(accountId(id))).toBe(true);
    expect((await bal(account(treasury))) - treasuryBefore).toBe(ICP - CYCLES_ICP - 3n * ICP_FEE);
    expect(await f.getUserPaymentBalance(alice)).toBe(0n);
    expect(texts(await pic.getControllers(id))).toEqual([alice.toText()]);
    const bot = actorAs(pic, stakingBotIdl, id, alice);
    const v = await bot.getVersion();
    expect(typeof v.major).toBe('bigint');
    expect(await fAlice.getMyWalletForApp('icp-staking-bot')).toEqual([{ canisterId: id, appId: 'icp-staking-bot' }]);
    expect((await f.lookupMintedCanister(id))[0]).toMatchObject({ appId: 'icp-staking-bot', publisherId: 0n, numericAppId: 0n, versionMajor: 7n, versionMinor: 8n, versionPatch: 9n, icpPaidE8s: ICP });
    // members pay the premium creation fee
    const now = BigInt(Math.round(await pic.getTime())) * 1_000_000n;
    await premium.set_member(alice, now + 3_600n * 1_000_000_000n);
    await deposit(alice, 50_000_000n);
    const res2 = unwrap(await fAlice.createNeuronManager());
    expect((await f.lookupMintedCanister(res2.canisterId))[0]).toMatchObject({ icpPaidE8s: 50_000_000n, wasPremium: true });
  }, 180_000);

  it('createNeuronManager checks that a manager wasm exists (and is one) before it takes any payment', async () => {
    await f.clearManagerWasm();
    await premium.set_member(alice, 0n);
    await pic.advanceTime(2 * 3_600 * 1000); await pic.tick(2); // let the cached membership lapse
    const leftover = await f.getUserPaymentBalance(alice); // 1 fee left by the capped premium mint above
    await deposit(alice, ICP);
    const mints = await f.getMintLogCount();
    const txFrom = await txCount();
    const err = errOf(await fAlice.createNeuronManager());
    expect(err.CanisterCreationFailed).toMatch(/No manager WASM uploaded/);
    await f.setManagerWasm(Uint8Array.from([1, 2, 3, 4]));
    expect(errOf(await fAlice.createNeuronManager()).CanisterCreationFailed).toMatch(/not a WebAssembly module/);
    await f.clearManagerWasm();
    expect(await txCount()).toBe(txFrom); // nothing charged
    expect(await f.getUserPaymentBalance(alice)).toBe(leftover + ICP);
    expect(await f.getMintLogCount()).toBe(mints);
    unwrap(await fAlice.withdrawUserPayment());
  }, 120_000);

  it('the mint log filters and pages; the admin audit logs agree with it', async () => {
    const all = await f.getMintLog(LOGQ);
    const n = await f.getMintLogCount();
    expect(all.totalCount).toBe(n);
    expect(all.entries.map((e) => e.index)).toEqual([...Array(Number(n)).keys()].map(BigInt));
    const page = await f.getMintLog({ ...LOGQ, startIndex: [1n], limit: [2n] });
    expect(page.entries.map((e) => e.index)).toEqual([1n, 2n]);
    expect(page.hasMore).toBe(true);
    const carolDemo = await f.getMintLog({ ...LOGQ, appIdFilter: ['demo'], minterFilter: [carol] });
    expect(carolDemo.entries.every((e) => e.appId === 'demo' && e.minter.toText() === carol.toText())).toBe(true);
    expect(carolDemo.totalCount).toBe(BigInt((await fCarol.getMyWalletForApp('demo')).length));
    expect((await f.getMintLog({ ...LOGQ, fromTime: [all.entries.at(-1).mintedAt + 1n] })).totalCount).toBe(0n);
    expect((await f.getMintLog({ ...LOGQ, toTime: [all.entries[0].mintedAt] })).totalCount >= 1n).toBe(true);
    expect((await f.getMintLogEntry(0n))[0].index).toBe(0n);
    expect(await f.getMintLogEntry(n)).toEqual([]);
    // creation and financial logs: one entry per created canister, in the same order
    expect(await f.getCreationLogCount()).toBe(n);
    expect(await f.getFinancialLogCount()).toBe(n);
    const creations = await f.getCreationLog(CLOGQ);
    expect(creations.entries.map((e) => e.canisterId.toText())).toEqual(all.entries.map((e) => e.canisterId.toText()));
    expect((await f.getCreationLog({ ...CLOGQ, callerFilter: [carol] })).totalCount).toBe(BigInt(all.entries.filter((e) => e.minter.toText() === carol.toText()).length));
    expect((await f.getCreationLog({ ...CLOGQ, canisterFilter: [all.entries[0].canisterId] })).totalCount).toBe(1n);
    const recent = await f.getRecentCreations(2n);
    expect(recent.map((e) => e.index)).toEqual([n - 1n, n - 2n]);
    const merged = await f.getMergedLog({ ...CLOGQ, limit: [3n] });
    expect(merged.entries.length).toBe(3);
    expect(merged.hasMore).toBe(true);
    expect(merged.entries[0].financialData[0].icpPaidE8s).toBe(all.entries[0].icpPaidE8s);
    const fin = await f.getFinancialLog(FLOGQ);
    const agg = await f.getFactoryAggregates();
    expect(agg.totalCanistersCreated).toBe(n);
    expect(agg.totalIcpPaidE8s).toBe(fin.entries.reduce((s, e) => s + e.icpPaidE8s, 0n));
    expect(agg.totalIcpForCyclesE8s).toBe(fin.entries.reduce((s, e) => s + e.icpForCyclesE8s, 0n));
    expect(agg.totalCyclesSpentOnCreation).toBe(n * T);
    expect(agg.totalCyclesReceivedFromCmc).toBe(fin.entries.reduce((s, e) => s + e.cyclesReceivedFromCmc, 0n));
    // the stats add up to the mint log
    const stats = await f.getAllPublisherStats();
    const pub1 = stats.find((s) => s.publisherId === 1n);
    const pub1Mints = all.entries.filter((e) => e.publisherId === 1n);
    expect(pub1.totalMintCount).toBe(BigInt(pub1Mints.length));
    expect(pub1.totalRevenueE8s).toBe(pub1Mints.reduce((s, e) => s + e.publisherRevenueE8s, 0n));
    expect((await f.getAllAppRevenueStats()).length >= 2).toBe(true);
    // NOTE (current behaviour): legacy createNeuronManager mints are in the mint log but not in the publisher stats
    const legacy = all.entries.filter((e) => e.appId === 'icp-staking-bot').length;
    expect((await f.getPublisherStats(0n))[0].totalMintCount).toBe(BigInt(all.entries.filter((e) => e.publisherId === 0n).length - legacy));
  });

  it('admin ICP tools: withdraw from the main account and top up cycles through the CMC, admins only', async () => {
    await icp.mint(account(factoryId), ICP);
    const main = await f.getIcpBalance();
    await trap(fAlice.adminTopUpCycles(ICP / 2n));
    const notes = (await cmc.get_notifications()).length;
    expect(unwrap(await f.adminTopUpCycles(ICP / 2n))).toBe(1n * T);
    expect((await cmc.get_notifications()).length).toBe(notes + 1);
    expect(await f.getIcpBalance()).toBe(main - ICP / 2n - ICP_FEE);
    await trap(fAlice.adminWithdrawIcp(1n, account(alice)));
    const before = await bal(account(carol));
    unwrap(await f.adminWithdrawIcp(1_000_000n, account(carol)));
    expect((await bal(account(carol))) - before).toBe(1_000_000n);
    expect(errOf(await f.adminWithdrawIcp(10n * ICP, account(carol)))).toHaveProperty('InsufficientFunds');
  });

  it('keeps the mint log, wallets, logs, stats and revenue across an upgrade, and mints afterwards', async () => {
    const snap = async () => ({
      log: await f.getMintLog({ ...LOGQ, limit: [100n] }),
      wallets: (await f.getAllWallets()).sort(([a], [b]) => a.toText().localeCompare(b.toText())),
      creations: await f.getCreationLog({ ...CLOGQ, limit: [100n] }),
      fin: await f.getFinancialLog({ ...FLOGQ, limit: [100n] }),
      agg: await f.getFactoryAggregates(),
      pubStats: (await f.getAllPublisherStats()).sort((a, b) => Number(a.publisherId - b.publisherId)),
      appStats: (await f.getAllAppRevenueStats()).sort((a, b) => Number(a.numericAppId - b.numericAppId)),
      dao: await f.getDaoRevenueStats(),
      config: await f.getPaymentConfig(),
    });
    const before = await snap();
    const someId = before.log.entries[0].canisterId;
    await pic.upgradeCanister({ sender: admin, canisterId: factoryId, wasm: wasm('sneedapp'), arg: IDL.encode([], []) });
    expect(await snap()).toEqual(before);
    expect(await f.wasMintedByUs(someId)).toBe(true); // the lookup index is restored
    expect((await f.lookupMintedCanister(someId))[0].index).toBe(0n);
    await deposit(bob, ICP);
    const id = unwrap(await fBob.mintCanister('demo', [], [], [])).canisterId;
    expect((await f.lookupMintedCanister(id))[0].index).toBe(before.log.totalCount);
  }, 180_000);
});
