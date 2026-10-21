// The /convert page's call sequences (src/app_sneeddao_frontend/src/utils/ckMinters.js) against
// mock ckBTC and ckETH minters (canisters/MockCkBtcMinter.mo, MockCkEthMinter.mo) that are the
// minting accounts of real ICRC ledgers, as on mainnet: deposits mint with icrc1_transfer,
// withdrawals burn with icrc2_transfer_from after the user's icrc2_approve.
//   - ckBTC: deposit address, update_balance while unconfirmed and after, approve + retrieve_btc_with_approval,
//     the exact-amount approval (burns are fee-free) used up, status by account
//   - ckETH: approve + withdraw_eth, minimum, blocked recipient, withdrawal_status
//   - ckERC20: approve ckETH for gas (with margin) + approve the token + withdraw_erc20; a gas rise
//     inside the margin still works, above it fails readably
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { IDL } from '@icp-sdk/core/candid';
import { Principal } from '@icp-sdk/core/principal';
import { createPic, actorAs, account, admin, alice, bob, T, BUILD, wasm } from '../lib/pic.js';
import {
  ckbtcDepositAddress, ckbtcCheckDeposit, ckbtcKnownUtxos, ckbtcWithdraw, ckbtcWithdrawals, ckbtcInfo, ckbtcMinter, approveMinter,
  ckethWithdraw, ckerc20Withdraw, ckethWithdrawals, ckethGasPrice, ckethInfo, ckethDepositAddress, ckethMinter, ledgerInfo,
  planBtcWithdrawal, planErc20Withdrawal, btcStatusText, ethStatusText, erc20AssetsFromInfo, ckLedgerIdl, APPROVAL_TTL_NS,
} from '../../../src/app_sneeddao_frontend/src/utils/ckMinters.js';
import { parseBtcAddress, parseEthAddress } from '../../../src/app_sneeddao_frontend/src/utils/ckAddress.js';

const ledgerGz = resolve(BUILD, 'ledger.wasm.gz');
const haveWasms = existsSync(ledgerGz) && existsSync(resolve(BUILD, 'MockCkBtcMinter.wasm')) && existsSync(resolve(BUILD, 'MockCkEthMinter.wasm'));

const Account = IDL.Record({ owner: IDL.Principal, subaccount: IDL.Opt(IDL.Vec(IDL.Nat8)) });
const MetadataValue = IDL.Variant({ Nat: IDL.Nat, Int: IDL.Int, Text: IDL.Text, Blob: IDL.Vec(IDL.Nat8) });
const LedgerArg = IDL.Variant({
  Init: IDL.Record({
    minting_account: Account, transfer_fee: IDL.Nat, decimals: IDL.Opt(IDL.Nat8), token_symbol: IDL.Text, token_name: IDL.Text,
    metadata: IDL.Vec(IDL.Tuple(IDL.Text, MetadataValue)), initial_balances: IDL.Vec(IDL.Tuple(Account, IDL.Nat)),
    feature_flags: IDL.Opt(IDL.Record({ icrc2: IDL.Bool })),
    archive_options: IDL.Record({ num_blocks_to_archive: IDL.Nat64, trigger_threshold: IDL.Nat64, controller_id: IDL.Principal, cycles_for_archive_creation: IDL.Opt(IDL.Nat64) }),
  }),
  Upgrade: IDL.Opt(IDL.Record({})),
});
const BtcInit = IDL.Record({ ledger: IDL.Principal });
const EthInit = IDL.Record({ cketh_ledger: IDL.Principal, ckerc20_ledger: IDL.Principal, ckerc20_symbol: IDL.Text, erc20_address: IDL.Text });
const Utxo = IDL.Record({ outpoint: IDL.Record({ txid: IDL.Vec(IDL.Nat8), vout: IDL.Nat32 }), value: IDL.Nat64, height: IDL.Nat32 });
const RetrieveStatus = IDL.Variant({
  Unknown: IDL.Null, Pending: IDL.Null, Signing: IDL.Null, Sending: IDL.Record({ txid: IDL.Vec(IDL.Nat8) }), Submitted: IDL.Record({ txid: IDL.Vec(IDL.Nat8) }),
  AmountTooLow: IDL.Null, Confirmed: IDL.Record({ txid: IDL.Vec(IDL.Nat8) }),
  Reimbursed: IDL.Record({ account: Account, mint_block_index: IDL.Nat64, amount: IDL.Nat64, reason: IDL.Variant({ CallFailed: IDL.Null, TaintedDestination: IDL.Record({ kyt_fee: IDL.Nat64, kyt_provider: IDL.Principal }) }) }),
  WillReimburse: IDL.Record({ account: Account, amount: IDL.Nat64, reason: IDL.Variant({ CallFailed: IDL.Null, TaintedDestination: IDL.Record({ kyt_fee: IDL.Nat64, kyt_provider: IDL.Principal }) }) }),
});
const btcTestIdl = ({ IDL: I }) => I.Service({
  test_add_utxo: I.Func([I.Principal, I.Nat64, I.Nat32, I.Nat8], [], []),
  test_confirm_all: I.Func([I.Nat32], [], []),
  test_set_status: I.Func([I.Nat64, RetrieveStatus], [], []),
  test_calls: I.Func([], [I.Vec(I.Text)], ['query']),
});
const EthTx = IDL.Record({ transaction_hash: IDL.Text });
const WithdrawalStatus = IDL.Variant({
  Pending: IDL.Null, TxCreated: IDL.Null, TxSent: EthTx,
  TxFinalized: IDL.Variant({
    Success: IDL.Record({ transaction_hash: IDL.Text, effective_transaction_fee: IDL.Opt(IDL.Nat) }),
    Reimbursed: IDL.Record({ transaction_hash: IDL.Text, reimbursed_amount: IDL.Nat, reimbursed_in_block: IDL.Nat }),
    PendingReimbursement: EthTx,
  }),
});
const ethTestIdl = ({ IDL: I }) => I.Service({
  test_set_status: I.Func([I.Nat64, WithdrawalStatus], [], []),
  test_bump_gas: I.Func([I.Nat], [], []),
  test_calls: I.Func([], [I.Vec(I.Text)], ['query']),
});

const BTC_FEE = 10n;
const ETH_FEE = 2_000_000_000_000n;
const USDC_FEE = 10_000n;
const USDC_ERC20 = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const BTC_ADDR = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';
const ETH_ADDR = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed';

let pic, appSubnet, btcMinter, btcLedger, ethMinter, ethLedger, usdcLedger;
const P = (id) => (typeof id === 'string' ? Principal.fromText(id) : id);
// the page's makeActor, calling as `who`
const makeActorAs = (who) => (idl, id) => actorAs(pic, idl, P(id), who);
const asAlice = () => makeActorAs(alice);
const ledgerNow = async () => BigInt(Math.round(await pic.getTime())) * 1_000_000n;

async function installLedger(id, minter, symbol, fee, decimals, balances) {
  await pic.installCode({ sender: admin, canisterId: id, wasm: readFileSync(ledgerGz), arg: IDL.encode([LedgerArg], [{ Init: {
    minting_account: account(minter), transfer_fee: fee, decimals: [decimals], token_symbol: symbol, token_name: symbol, metadata: [],
    initial_balances: balances, feature_flags: [{ icrc2: true }],
    archive_options: { num_blocks_to_archive: 1000n, trigger_threshold: 2000n, controller_id: admin, cycles_for_archive_creation: [10n * T] },
  } }]) });
}
const create = () => pic.createCanister({ sender: admin, cycles: 100n * T, targetSubnetId: appSubnet, controllers: [admin] });
const balanceOf = async (ledger, who) => (await ledgerInfo(makeActorAs(who), ledger, who)).balance;
const allowance = async (ledger, owner, spender) => (await actorAs(pic, ckLedgerIdl, ledger, owner).icrc2_allowance({ account: account(owner), spender: account(spender) }));

describe.skipIf(!haveWasms)('ck conversions against mock minters + real ledgers', () => {
  beforeAll(async () => {
    ({ pic, appSubnet } = await createPic());
    btcMinter = await create(); btcLedger = await create();
    ethMinter = await create(); ethLedger = await create(); usdcLedger = await create();
    await installLedger(btcLedger, btcMinter, 'ckBTC', BTC_FEE, 8, [[account(alice), 1_000_000n]]);
    await installLedger(ethLedger, ethMinter, 'ckETH', ETH_FEE, 18, [[account(alice), 5n * 10n ** 16n], [account(bob), 10n ** 14n]]);
    await installLedger(usdcLedger, ethMinter, 'ckUSDC', USDC_FEE, 6, [[account(alice), 100_000_000n], [account(bob), 100_000_000n]]);
    await pic.installCode({ sender: admin, canisterId: btcMinter, wasm: wasm('MockCkBtcMinter'), arg: IDL.encode([BtcInit], [{ ledger: btcLedger }]) });
    await pic.installCode({ sender: admin, canisterId: ethMinter, wasm: wasm('MockCkEthMinter'), arg: IDL.encode([EthInit], [{ cketh_ledger: ethLedger, ckerc20_ledger: usdcLedger, ckerc20_symbol: 'ckUSDC', erc20_address: USDC_ERC20 }]) });
  }, 180_000);
  afterAll(async () => { await pic?.tearDown(); });

  describe('ckBTC', () => {
    it('reads the minter info and gives a valid deposit address', async () => {
      const info = await ckbtcInfo(asAlice(), btcMinter);
      expect(info).toMatchObject({ min_confirmations: 4, retrieve_btc_min_amount: 50_000n, deposit_fee: 100n });
      const addr = await ckbtcDepositAddress(asAlice(), alice, null, btcMinter);
      expect(parseBtcAddress(addr).ok).toBe(true);
    });

    it('check for deposit: pending while unconfirmed, minted (minus the check fee) once confirmed', async () => {
      const t = actorAs(pic, btcTestIdl, btcMinter, admin);
      await t.test_add_utxo(alice, 100_000n, 2, 1);
      const early = await ckbtcCheckDeposit(asAlice(), alice, null, btcMinter);
      expect(early.minted).toEqual([]);
      expect(early.error).toBe(false);
      expect(early.pending).toHaveLength(1);
      expect(early.message).toMatch(/2 of 4 confirmations/);
      expect(await balanceOf(btcLedger, alice)).toBe(1_000_000n);

      await t.test_confirm_all(6);
      const done = await ckbtcCheckDeposit(asAlice(), alice, null, btcMinter);
      expect(done.minted).toHaveLength(1);
      expect(done.minted[0].amount).toBe(99_900n);
      expect(done.message).toMatch(/Minted 0\.000999 ckBTC/);
      expect(await balanceOf(btcLedger, alice)).toBe(1_099_900n);
      expect(await ckbtcKnownUtxos(asAlice(), alice, null, btcMinter)).toHaveLength(1);

      const again = await ckbtcCheckDeposit(asAlice(), alice, null, btcMinter);
      expect(again.minted).toEqual([]);
      expect(again.message).toMatch(/No new Bitcoin deposit/);
    });

    it('withdraw: approves exactly the amount (expiring in an hour), the minter burns it, nothing is left approved', async () => {
      const before = await balanceOf(btcLedger, alice);
      const fee = await ckbtcMinter(asAlice(), btcMinter).estimate_withdrawal_fee({ amount: [60_000n] });
      const plan = planBtcWithdrawal({ amount: 60_000n, balance: before, ledgerFee: BTC_FEE, minAmount: 50_000n, fee });
      expect(plan.ok).toBe(true);
      const steps = [];
      const now = await ledgerNow();
      const r = await ckbtcWithdraw(asAlice(), { address: BTC_ADDR, amount: 60_000n, ledgerFee: BTC_FEE, ledgerId: btcLedger, minterId: btcMinter, nowNs: now, onStep: (s) => steps.push(s) });
      expect(steps).toEqual(['approve', 'withdraw', 'done']);
      expect(await balanceOf(btcLedger, alice)).toBe(before - 60_000n - BTC_FEE); // the burn has no fee; the approval has one
      expect((await allowance(btcLedger, alice, btcMinter)).allowance).toBe(0n);
      const calls = await actorAs(pic, btcTestIdl, btcMinter, admin).test_calls();
      expect(calls.filter((c) => c === 'retrieve_btc_with_approval')).toHaveLength(1);

      const list = await ckbtcWithdrawals(asAlice(), alice, null, btcMinter);
      expect(list[0].blockIndex).toBe(r.blockIndex);
      expect(btcStatusText(list[0].status).label).toBe('Queued');
      const txid = Uint8Array.from({ length: 32 }, (_, i) => 255 - i);
      await actorAs(pic, btcTestIdl, btcMinter, admin).test_set_status(r.blockIndex, { Submitted: { txid } });
      const s = btcStatusText((await ckbtcWithdrawals(asAlice(), alice, null, btcMinter))[0].status);
      expect(s).toMatchObject({ label: 'Submitted', txid: Buffer.from(txid).reverse().toString('hex') });
    });

    it('approval carries the one-hour expiry', async () => {
      const now = await ledgerNow();
      await approveMinter(asAlice(), { ledgerId: btcLedger.toText(), spender: btcMinter.toText(), amount: 1_234n, fee: BTC_FEE, nowNs: now });
      const a = await allowance(btcLedger, alice, btcMinter);
      expect(a.allowance).toBe(1_234n);
      expect(a.expires_at[0]).toBe(now + APPROVAL_TTL_NS);
      await approveMinter(asAlice(), { ledgerId: btcLedger.toText(), spender: btcMinter.toText(), amount: 0n, fee: BTC_FEE, nowNs: now }); // tidy up
    });

    it('withdraw errors come back as sentences, and a refused withdrawal burns nothing', async () => {
      const before = await balanceOf(btcLedger, alice);
      await expect(ckbtcWithdraw(asAlice(), { address: BTC_ADDR, amount: 1_000n, ledgerFee: BTC_FEE, ledgerId: btcLedger, minterId: btcMinter, nowNs: await ledgerNow() }))
        .rejects.toThrow(/minimum is 0\.0005 BTC/);
      expect(await balanceOf(btcLedger, alice)).toBe(before - BTC_FEE); // only the approval's fee
      // a wrong ledger fee is refused by the ledger before anything happens
      await expect(ckbtcWithdraw(asAlice(), { address: BTC_ADDR, amount: 60_000n, ledgerFee: 1n, ledgerId: btcLedger, minterId: btcMinter, nowNs: await ledgerNow() }))
        .rejects.toThrow(/Approving the minter failed: The ledger wants a fee of 10/);
      // bob has no ckBTC: the approval itself fails for want of the fee
      await expect(ckbtcWithdraw(makeActorAs(bob), { address: BTC_ADDR, amount: 60_000n, ledgerFee: BTC_FEE, ledgerId: btcLedger, minterId: btcMinter, nowNs: await ledgerNow() }))
        .rejects.toThrow(/Not enough balance to pay the ledger fee/);
    });
  });

  describe('ckETH and ckERC20', () => {
    it('lists the minter\'s ckERC20 tokens and helper contracts', async () => {
      const info = await ckethInfo(asAlice(), ethMinter);
      expect(info.deposit_with_subaccount_helper_contract_address[0]).toBe('0x18901044688D3756C35Ed2b36D93e6a5B8e00E68');
      // a ledger this release does not know has no decimals until they are read from it
      expect(erc20AssetsFromInfo(info)[0].decimals).toBe(null);
      const decimals = await actorAs(pic, ckLedgerIdl, usdcLedger, alice).icrc1_decimals();
      const assets = erc20AssetsFromInfo(info, { [usdcLedger.toText()]: Number(decimals) });
      expect(assets).toHaveLength(1);
      expect(assets[0]).toMatchObject({ symbol: 'ckUSDC', ledger: usdcLedger.toText(), erc20: USDC_ERC20, decimals: 6 });
    });

    it('withdraw ETH: approve + withdraw_eth burns exactly the amount; status by account', async () => {
      const before = await balanceOf(ethLedger, alice);
      const amount = 10n ** 16n;
      const r = await ckethWithdraw(asAlice(), { recipient: ETH_ADDR, amount, ledgerFee: ETH_FEE, ledgerId: ethLedger, minterId: ethMinter, nowNs: await ledgerNow() });
      expect(await balanceOf(ethLedger, alice)).toBe(before - amount - ETH_FEE);
      expect((await allowance(ethLedger, alice, ethMinter)).allowance).toBe(0n);
      const list = await ckethWithdrawals(asAlice(), alice, null, ethMinter);
      expect(list[0]).toMatchObject({ token_symbol: 'ckETH', withdrawal_amount: amount, recipient_address: ETH_ADDR });
      expect(BigInt(list[0].withdrawal_id)).toBe(BigInt(r.blockIndex));
      await actorAs(pic, ethTestIdl, ethMinter, admin).test_set_status(list[0].withdrawal_id, { TxSent: { transaction_hash: '0xabc' } });
      expect(ethStatusText((await ckethWithdrawals(asAlice(), alice, null, ethMinter))[0].status)).toMatchObject({ label: 'Sent', tx: '0xabc' });
    });

    it('withdraw ETH refusals: below the minimum, blocked recipient', async () => {
      await expect(ckethWithdraw(asAlice(), { recipient: ETH_ADDR, amount: 10n ** 15n, ledgerFee: ETH_FEE, ledgerId: ethLedger, minterId: ethMinter, nowNs: await ledgerNow() }))
        .rejects.toThrow(/minimum is 0\.005 ETH/);
      const blocked = '0x000000000000000000000000000000000000dEaD';
      expect(parseEthAddress(blocked).ok).toBe(true);
      expect(await ckethMinter(asAlice(), ethMinter).is_address_blocked(blocked)).toBe(true);
      await expect(ckethWithdraw(asAlice(), { recipient: blocked, amount: 10n ** 16n, ledgerFee: ETH_FEE, ledgerId: ethLedger, minterId: ethMinter, nowNs: await ledgerNow() }))
        .rejects.toThrow(/blocked address/);
    });

    it('withdraw ERC-20: approves gas in ckETH (with margin) and the token, burns both, the token in full', async () => {
      const ethBefore = await balanceOf(ethLedger, alice);
      const usdcBefore = await balanceOf(usdcLedger, alice);
      const price = await ckethGasPrice(asAlice(), usdcLedger, ethMinter);
      expect(price.gas_limit).toBe(65_000n);
      const plan = planErc20Withdrawal({ amount: 25_000_000n, tokenBalance: usdcBefore, tokenLedgerFee: USDC_FEE, ckethBalance: ethBefore, ckethLedgerFee: ETH_FEE, price, symbol: 'ckUSDC', decimals: 6 });
      expect(plan.ok).toBe(true);
      const steps = [];
      const r = await ckerc20Withdraw(asAlice(), {
        recipient: ETH_ADDR, amount: 25_000_000n, tokenLedgerId: usdcLedger, gasApprove: plan.gasApprove, ckethLedgerFee: ETH_FEE, tokenLedgerFee: USDC_FEE,
        ckethLedgerId: ethLedger, minterId: ethMinter, nowNs: await ledgerNow(), onStep: (s) => steps.push(s),
      });
      expect(steps).toEqual(['approve-gas', 'approve-token', 'withdraw', 'done']);
      const gas = price.max_transaction_fee;
      expect(await balanceOf(ethLedger, alice)).toBe(ethBefore - gas - ETH_FEE);
      expect(await balanceOf(usdcLedger, alice)).toBe(usdcBefore - 25_000_000n - USDC_FEE);
      expect((await allowance(ethLedger, alice, ethMinter)).allowance).toBe(plan.gasApprove - gas); // the unused margin, expiring
      expect((await allowance(usdcLedger, alice, ethMinter)).allowance).toBe(0n);
      const list = await ckethWithdrawals(asAlice(), alice, null, ethMinter);
      expect(list.find((w) => BigInt(w.withdrawal_id) === BigInt(r.ckethBlock))).toMatchObject({ token_symbol: 'ckUSDC', withdrawal_amount: 25_000_000n });
    });

    it('ERC-20 gas: a rise inside the 20% margin still goes through, a bigger one fails readably and burns no token', async () => {
      const t = actorAs(pic, ethTestIdl, ethMinter, admin);
      const price = await ckethGasPrice(asAlice(), usdcLedger, ethMinter); // the user's estimate
      const plan = planErc20Withdrawal({ amount: 1_000_000n, tokenBalance: 10n ** 9n, tokenLedgerFee: USDC_FEE, ckethBalance: 10n ** 17n, ckethLedgerFee: ETH_FEE, price });
      const go = async () => ckerc20Withdraw(asAlice(), {
        recipient: ETH_ADDR, amount: 1_000_000n, tokenLedgerId: usdcLedger, gasApprove: plan.gasApprove, ckethLedgerFee: ETH_FEE, tokenLedgerFee: USDC_FEE,
        ckethLedgerId: ethLedger, minterId: ethMinter, nowNs: await ledgerNow(),
      });
      await t.test_bump_gas(300_000_000n); // +15%
      await expect(go()).resolves.toMatchObject({ ckerc20Block: expect.anything() });
      await t.test_bump_gas(500_000_000n); // +25%
      const usdcBefore = await balanceOf(usdcLedger, alice);
      await expect(go()).rejects.toThrow(/Paying the gas in ckETH failed: the ckETH allowance is too low/);
      expect(await balanceOf(usdcLedger, alice)).toBe(usdcBefore - USDC_FEE); // only the token approval's fee
      await t.test_bump_gas(0n);
    });

    it('ERC-20 withdrawal needs ckETH for gas: bob has too little, the plan says so', async () => {
      const price = await ckethGasPrice(makeActorAs(bob), usdcLedger, ethMinter);
      const plan = planErc20Withdrawal({ amount: 1_000_000n, tokenBalance: await balanceOf(usdcLedger, bob), tokenLedgerFee: USDC_FEE, ckethBalance: await balanceOf(ethLedger, bob), ckethLedgerFee: ETH_FEE, price, symbol: 'ckUSDC' });
      expect(plan.ok).toBe(false);
      expect(plan.errors.join()).toMatch(/ckETH for the Ethereum gas/);
    });

    it('personal deposit address (deposit_eth)', async () => {
      const d = await ckethDepositAddress(asAlice(), { id: ethMinter });
      expect(parseEthAddress(d.address)).toMatchObject({ ok: true, checksummed: true });
      expect(d.minimum).toBe(5n * 10n ** 15n);
      expect('Scanning' in d.status).toBe(true);
    });
  });
});
