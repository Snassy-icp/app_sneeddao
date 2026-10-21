// Pure helpers behind the /convert page (ck conversions), checked against DFINITY's official
// libraries where one exists (@icp-sdk/canisters: parseBtcAddress, encodePrincipalToEthAddress) and
// against published test vectors (BIP-173/BIP-350 addresses, EIP-55 checksums):
//   - Bitcoin address validation (utils/ckAddress.js) agrees with the minter's parser port
//   - Ethereum addresses with EIP-55 checksums
//   - principal -> bytes32 for the ckETH helper contract, and the helper's call data
//   - amounts and fee math (utils/ckMinters.js)
//   - the QR encoder (utils/qrcode.js) matches the python `qrcode` library module for module
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { Principal } from '@dfinity/principal';
import { parseBtcAddress as officialParseBtc } from '@icp-sdk/canisters/ckbtc';
import { encodePrincipalToEthAddress } from '@icp-sdk/canisters/cketh';
import {
  parseBtcAddress, parseEthAddress, toChecksumAddress, principalToBytes32, subaccountToBytes32,
  encodeDepositEth, encodeDepositErc20, encodeErc20Approve, encodeErc20Allowance, selectorOf, SELECTORS, decodeUint,
} from '../../../src/app_sneeddao_frontend/src/utils/ckAddress.js';
import {
  parseUnits, formatUnits, planBtcWithdrawal, planEthWithdrawal, planErc20Withdrawal, ckAssetForLedger, isCkLedger,
  erc20AssetsFromInfo, CKERC20_FALLBACK, btcTxidHex, btcStatusText, ethStatusText, updateBalanceErrorText, DEPOSITS_UNAVAILABLE,
} from '../../../src/app_sneeddao_frontend/src/utils/ckMinters.js';
import { encodeQr } from '../../../src/app_sneeddao_frontend/src/utils/qrcode.js';

const officialType = ['p2wpkh', 'p2pkh', 'p2sh', 'p2wsh', 'p2tr']; // BtcAddressType enum order
const official = (address) => { try { return officialType[officialParseBtc({ address }).type]; } catch { return null; } };

describe('Bitcoin addresses', () => {
  const valid = [
    ['BC1QW508D6QEJXTDG4Y5R3ZARVARY0C5XW7KV8F3T4', 'p2wpkh'],          // BIP-173, upper case
    ['bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4', 'p2wpkh'],
    ['bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq', 'p2wpkh'],
    ['bc1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qccfmv3', 'p2wsh'],
    ['bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0', 'p2tr'], // BIP-350
    ['bc1p5d7rjq7g6rdk2yhzks9smlaqtedr4dekq08ge8ztwac72sfr9rusxg3297', 'p2tr'],
    ['1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2', 'p2pkh'],
    ['1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa', 'p2pkh'],                     // genesis
    ['3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy', 'p2sh'],
  ];
  const invalid = [
    'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t5',            // checksum
    'bc1qW508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',            // mixed case
    'bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqh2y7hd', // taproot with a bech32 (not bech32m) checksum (BIP-350)
    'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kemeawh',            // v0 with a bech32m checksum (BIP-350)
    'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx',            // testnet
    'mipcBbFg9gMiCh81Kj8tqqdgoZub1ZJRfn',                    // testnet base58
    '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN3',                    // base58 checksum
    '0x18901044688D3756C35Ed2b36D93e6a5B8e00E68',            // an Ethereum address
    '', '   ', 'bc1', 'hello',
  ];

  it('accepts what the minter accepts, with the right type', () => {
    for (const [a, type] of valid) {
      const r = parseBtcAddress(a);
      expect(r, a).toMatchObject({ ok: true, type, network: 'mainnet' });
      expect(official(a), a).toBe(type); // DFINITY's port of the minter's parser agrees
    }
  });

  it('refuses typos, wrong checksums, other networks and other chains with a reason', () => {
    for (const a of invalid) {
      const r = parseBtcAddress(a);
      expect(r.ok, a).toBe(false);
      expect(typeof r.error).toBe('string');
      if (a.trim()) expect(official(a), a).toBe(null);
    }
    expect(parseBtcAddress('tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx').error).toMatch(/testnet/);
    expect(parseBtcAddress('tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx', 'testnet')).toMatchObject({ ok: true, type: 'p2wpkh' });
  });

  it('trims surrounding whitespace (pasted addresses)', () => {
    expect(parseBtcAddress('  bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq \n').ok).toBe(true);
  });
});

describe('Ethereum addresses (EIP-55)', () => {
  const vectors = [ // from EIP-55
    '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed', '0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359',
    '0xdbF03B407c01E7cD3CBea99509d93f8DDDC8C6FB', '0xD1220A0cf47c7B9Be7A2E6BA89F429762e7b9aDb',
  ];
  it('computes and checks checksums', () => {
    for (const v of vectors) {
      expect(toChecksumAddress(v.toLowerCase())).toBe(v);
      expect(parseEthAddress(v)).toMatchObject({ ok: true, address: v, checksummed: true });
      expect(parseEthAddress(v.toLowerCase())).toMatchObject({ ok: true, address: v, checksummed: false });
    }
  });
  it('catches a mixed-case typo, bad lengths, the zero address and BTC addresses', () => {
    expect(parseEthAddress('0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAeD').ok).toBe(false); // one letter's case flipped
    expect(parseEthAddress('0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeA').ok).toBe(false);
    expect(parseEthAddress('5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed').ok).toBe(false);
    expect(parseEthAddress('0x0000000000000000000000000000000000000000').ok).toBe(false);
    expect(parseEthAddress('bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq').ok).toBe(false);
  });
});

describe('principal as bytes32 for the ckETH helper contract', () => {
  const principals = [
    'aaaaa-aa', '2vxsx-fae', 'ryjl3-tyaaa-aaaaa-aaaba-cai', 'sv3dd-oaaaa-aaaar-qacoa-cai',
    'k2t6j-2nvnp-4zjm3-25dtz-6xhaa-c7boj-5gayf-oj3xs-i43lp-teztq-6ae',
    Principal.selfAuthenticating(new Uint8Array(44).fill(9)).toText(),
  ];
  it('matches DFINITY\'s encodePrincipalToEthAddress byte for byte', () => {
    for (const t of principals) {
      const p = Principal.fromText(t);
      expect(principalToBytes32(p), t).toBe(encodePrincipalToEthAddress(p));
      expect(principalToBytes32(t)).toBe(encodePrincipalToEthAddress(p));
    }
  });
  it('is a length byte, the principal bytes and zero padding', () => {
    const b = principalToBytes32('sv3dd-oaaaa-aaaar-qacoa-cai');
    expect(b).toMatch(/^0x[0-9a-f]{64}$/);
    expect(b.slice(2, 4)).toBe('0a'); // canister ids are 10 bytes
    expect(b.slice(4, 24)).toBe(Buffer.from(Principal.fromText('sv3dd-oaaaa-aaaar-qacoa-cai').toUint8Array()).toString('hex'));
    expect(b.slice(24)).toBe('0'.repeat(42)); // 32 - 1 - 10 bytes
    expect(subaccountToBytes32(null)).toBe(`0x${'0'.repeat(64)}`);
    expect(subaccountToBytes32(new Uint8Array(32).fill(1))).toBe(`0x${'01'.repeat(32)}`);
    expect(() => subaccountToBytes32(new Uint8Array(31))).toThrow();
  });
});

describe('helper contract and ERC-20 call data', () => {
  it('selectors are keccak256 of the signatures (checked against the deployed helper 0x1890…0E68 bytecode)', () => {
    expect(selectorOf('depositEth(bytes32,bytes32)')).toBe(SELECTORS.depositEth);
    expect(selectorOf('depositErc20(address,uint256,bytes32,bytes32)')).toBe(SELECTORS.depositErc20);
    expect(selectorOf('approve(address,uint256)')).toBe('095ea7b3');
    expect(selectorOf('allowance(address,address)')).toBe('dd62ed3e');
    expect(selectorOf('balanceOf(address)')).toBe('70a08231');
  });
  it('lays out static ABI arguments in 32-byte words', () => {
    const me = Principal.fromText('k2t6j-2nvnp-4zjm3-25dtz-6xhaa-c7boj-5gayf-oj3xs-i43lp-teztq-6ae');
    const p32 = principalToBytes32(me).slice(2);
    expect(encodeDepositEth(me)).toBe(`0x17c819c4${p32}${'0'.repeat(64)}`);
    const usdc = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
    const d = encodeDepositErc20(usdc, 1_500_000n, me);
    expect(d.length).toBe(2 + 8 + 4 * 64);
    expect(d.slice(10, 74)).toBe(`000000000000000000000000${usdc.slice(2).toLowerCase()}`);
    expect(BigInt(`0x${d.slice(74, 138)}`)).toBe(1_500_000n);
    expect(d.slice(138, 202)).toBe(p32);
    expect(encodeErc20Approve('0x18901044688D3756C35Ed2b36D93e6a5B8e00E68', 0n)).toBe(`0x095ea7b3${'0'.repeat(24)}18901044688d3756c35ed2b36d93e6a5b8e00e68${'0'.repeat(64)}`);
    expect(encodeErc20Allowance(usdc, usdc)).toMatch(/^0xdd62ed3e[0-9a-f]{128}$/);
    expect(decodeUint(`0x${'0'.repeat(62)}ff`)).toBe(255n);
    expect(decodeUint('0x')).toBe(0n);
    expect(() => encodeDepositErc20('0x123', 1n, me)).toThrow();
    expect(() => encodeErc20Approve(usdc, -1n)).toThrow();
  });
});

describe('amounts and fees', () => {
  it('parses and formats decimal amounts exactly', () => {
    expect(parseUnits('1.5', 8)).toBe(150_000_000n);
    expect(parseUnits('0.00000001', 8)).toBe(1n);
    expect(parseUnits('0.000000001', 8)).toBe(null); // more precision than the token has
    expect(parseUnits('.5', 6)).toBe(500_000n);
    expect(parseUnits('1,000', 2)).toBe(100_000n);
    for (const bad of ['', '.', 'abc', '-1', '1e5', '1.2.3']) expect(parseUnits(bad, 8), bad).toBe(null);
    expect(parseUnits('0.123456789012345678', 18)).toBe(123_456_789_012_345_678n);
    expect(formatUnits(150_000_000n, 8)).toBe('1.5');
    expect(formatUnits(1n, 18, 6)).toBe('0');
    expect(formatUnits(123_456_789n, 6, 2)).toBe('123.45');
    expect(formatUnits(10n ** 21n, 18)).toBe('1,000');
    for (const s of ['0.1', '21000000', '0.00012345']) expect(formatUnits(parseUnits(s, 8), 8).replace(/,/g, '')).toBe(s);
  });

  it('ckBTC: approve exactly the amount, pay one ledger fee, receive the amount minus the BTC fees', () => {
    const fee = { bitcoin_fee: 639n, minter_fee: 300n };
    const p = planBtcWithdrawal({ amount: 100_000n, balance: 200_000n, ledgerFee: 10n, minAmount: 50_000n, fee });
    expect(p).toMatchObject({ ok: true, approveAmount: 100_000n, spend: 100_010n, receive: 99_061n, networkFee: 939n, max: 199_990n });
    expect(planBtcWithdrawal({ amount: 49_999n, balance: 200_000n, ledgerFee: 10n, minAmount: 50_000n, fee }).errors.join()).toMatch(/minimum/);
    expect(planBtcWithdrawal({ amount: 199_991n, balance: 200_000n, ledgerFee: 10n, minAmount: 50_000n, fee }).errors.join()).toMatch(/Not enough/);
    expect(planBtcWithdrawal({ amount: 199_990n, balance: 200_000n, ledgerFee: 10n, minAmount: 50_000n, fee }).ok).toBe(true);
    expect(planBtcWithdrawal({ amount: 900n, balance: 200_000n, ledgerFee: 10n, minAmount: 0n, fee }).errors.join()).toMatch(/does not cover/);
    expect(planBtcWithdrawal({ amount: null, balance: 1n, ledgerFee: 10n }).max).toBe(0n);
  });

  it('ckETH: the transaction fee comes out of the amount', () => {
    const price = { max_transaction_fee: 43_190_985_432_000n };
    const p = planEthWithdrawal({ amount: 10n ** 16n, balance: 10n ** 17n, ledgerFee: 2_000_000_000_000n, minAmount: 5n * 10n ** 15n, price });
    expect(p).toMatchObject({ ok: true, spend: 10n ** 16n + 2_000_000_000_000n, receive: 10n ** 16n - 43_190_985_432_000n });
    expect(planEthWithdrawal({ amount: 10n ** 15n, balance: 10n ** 17n, ledgerFee: 0n, minAmount: 5n * 10n ** 15n, price }).errors.join()).toMatch(/minimum/);
  });

  it('ckERC20: gas in ckETH with a 20% margin, the token arrives in full', () => {
    const price = { max_transaction_fee: 133_686_383_480_000n };
    const base = { tokenBalance: 50_000_000n, tokenLedgerFee: 10_000n, ckethLedgerFee: 2_000_000_000_000n, price, symbol: 'ckUSDC', decimals: 6 };
    const p = planErc20Withdrawal({ ...base, amount: 20_000_000n, ckethBalance: 10n ** 15n });
    expect(p.gasApprove).toBe(160_423_660_176_000n); // ceil(1.2 x estimate)
    expect(p.ckethSpend).toBe(160_423_660_176_000n + 2_000_000_000_000n);
    expect(p).toMatchObject({ ok: true, receive: 20_000_000n, spend: 20_010_000n, max: 49_990_000n });
    const poor = planErc20Withdrawal({ ...base, amount: 20_000_000n, ckethBalance: 10n ** 14n });
    expect(poor.ok).toBe(false);
    expect(poor.errors.join()).toMatch(/ckETH for the Ethereum gas/);
  });
});

describe('assets and statuses', () => {
  it('knows the ck ledgers, and refreshes the ckERC20 list from the minter', () => {
    expect(ckAssetForLedger('mxzaz-hqaaa-aaaar-qaada-cai')).toMatchObject({ kind: 'btc', native: 'BTC' });
    expect(ckAssetForLedger(Principal.fromText('ss2fx-dyaaa-aaaar-qacoq-cai'))).toMatchObject({ kind: 'eth', decimals: 18 });
    expect(ckAssetForLedger('xevnm-gaaaa-aaaar-qafnq-cai')).toMatchObject({ kind: 'erc20', symbol: 'ckUSDC', decimals: 6, native: 'USDC' });
    expect(isCkLedger('ryjl3-tyaaa-aaaaa-aaaba-cai')).toBe(false);
    const listed = erc20AssetsFromInfo({ supported_ckerc20_tokens: [[
      { ckerc20_token_symbol: 'ckUSDC', erc20_contract_address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', ledger_canister_id: Principal.fromText('xevnm-gaaaa-aaaar-qafnq-cai') },
      { ckerc20_token_symbol: 'ckNEW', erc20_contract_address: '0x1111111111111111111111111111111111111111', ledger_canister_id: Principal.fromText('aaaaa-aa') },
    ]] }, { 'aaaaa-aa': 9 });
    expect(listed.map((a) => [a.symbol, a.decimals, a.native])).toEqual([['ckUSDC', 6, 'USDC'], ['ckNEW', 9, 'NEW']]);
    expect(erc20AssetsFromInfo(null)).toBe(CKERC20_FALLBACK);
    expect(DEPOSITS_UNAVAILABLE).toBe(2n ** 256n - 1n);
  });

  it('shows Bitcoin txids in the usual byte-reversed order', () => {
    const internal = Uint8Array.from({ length: 32 }, (_, i) => i);
    expect(btcTxidHex(internal)).toBe(Buffer.from(internal).reverse().toString('hex'));
    expect(btcStatusText({ Submitted: { txid: internal } })).toMatchObject({ label: 'Submitted', tone: 'pending', txid: btcTxidHex(internal) });
    expect(btcStatusText({ Confirmed: { txid: internal } }).tone).toBe('success');
    expect(btcStatusText({ Unknown: null }).tone).toBe('muted');
    expect(ethStatusText({ TxFinalized: { Success: { transaction_hash: '0xab', effective_transaction_fee: [] } } })).toMatchObject({ label: 'Done', tx: '0xab' });
    expect(ethStatusText({ TxFinalized: { Reimbursed: { transaction_hash: '0xab', reimbursed_amount: 1n, reimbursed_in_block: 2n } } }).tone).toBe('warning');
    expect(updateBalanceErrorText({ NoNewUtxos: { current_confirmations: [], required_confirmations: 4, pending_utxos: [[{ outpoint: { txid: internal, vout: 0 }, value: 1000n, confirmations: 2 }]], suspended_utxos: [] } })).toMatch(/2 of 4 confirmations/);
  });
});

// [text index, level, version, mask, first 16 hex of sha256(rows)] from python `qrcode` 8.x
const QR_TEXTS = ['bitcoin:bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq', 'hi', '0x18901044688D3756C35Ed2b36D93e6a5B8e00E68', 'x'.repeat(100), 'bc1p5d7rjq7g6rdk2yhzks9smlaqtedr4dekq08ge8ztwac72sfr9rusxg3297', '€uro ünïcode'];
const QR_REFERENCE = [
  [0, "L", 3, 1, "1f7d4c179f382bde"],
  [0, "L", 7, 5, "512e63a0603049bd"],
  [0, "M", 5, 0, "227533d0b38c9d1c"],
  [0, "Q", 5, 1, "2ec6c0be5fb05d58"],
  [0, "H", 7, 0, "a4ebe0c898a29db7"],
  [1, "L", 2, 7, "bf2d3f0fad45ac8b"],
  [1, "L", 5, 0, "6a8aa7cb7fdadb27"],
  [1, "M", 1, 5, "add69b2b9199b2da"],
  [1, "M", 4, 6, "e314df03ee307602"],
  [1, "M", 10, 0, "95dae16c51573cf8"],
  [1, "Q", 3, 4, "ee06c487dc9ee12a"],
  [1, "Q", 7, 0, "06de16f3ca85e703"],
  [1, "H", 2, 2, "7dc3e771b13d3da8"],
  [1, "H", 5, 3, "c36ccfd00e087f56"],
  [2, "L", 3, 3, "c34e98daae95f79a"],
  [2, "L", 7, 7, "5536283da57fbfe6"],
  [2, "M", 4, 7, "68e8f10ee7829880"],
  [2, "M", 10, 1, "1738816f937b5ac4"],
  [2, "Q", 7, 1, "ee23592b4aa83cd6"],
  [2, "H", 7, 2, "adb19526314661aa"],
  [3, "L", 7, 0, "3b86d3e2498dbbd8"],
  [3, "M", 10, 2, "f5426ff01aea00d6"],
  [4, "L", 4, 0, "19649b74ef4f2535"],
  [4, "L", 10, 2, "70cf6317d1ade9a4"],
  [4, "M", 7, 2, "e4af1711f024c5af"],
  [4, "Q", 10, 4, "bb5cecedf0275bb8"],
  [5, "L", 1, 0, "9a906d3c44cc704e"],
  [5, "L", 4, 1, "ca50c6834b86159b"],
  [5, "L", 10, 3, "ba2b3477f0ddd7db"],
  [5, "M", 4, 2, "2403f116bbd562f5"],
  [5, "M", 10, 4, "f43dfa443ff14c00"],
  [5, "Q", 4, 3, "8bc292666deea165"],
  [5, "Q", 10, 5, "fa429a7ff4bb510d"],
  [5, "H", 5, 7, "87932ea7bf27f0a7"]
];

describe('QR codes', () => {
  it('match the python qrcode library module for module (versions 1-10, every level, all masks)', () => {
    for (const [ti, ecl, version, mask, hash] of QR_REFERENCE) {
      const qr = encodeQr(QR_TEXTS[ti], { ecl, version, mask });
      const rows = qr.modules.map((r) => r.map((b) => (b ? '1' : '0')).join('')).join('\n');
      expect(createHash('sha256').update(rows).digest('hex').slice(0, 16), `${ti} ${ecl} v${version} m${mask}`).toBe(hash);
    }
  });
  it('picks the smallest version that fits and refuses text that does not', () => {
    expect(encodeQr('hi').version).toBe(1);
    expect(encodeQr('bitcoin:bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq').version).toBe(4);
    expect(encodeQr('x'.repeat(213), { ecl: 'M' }).version).toBe(10);
    expect(() => encodeQr('x'.repeat(214), { ecl: 'M' })).toThrow();
    const q = encodeQr('hello');
    expect(q.mask).toBeGreaterThanOrEqual(0);
    expect(q.modules.length).toBe(q.size);
  });
});
