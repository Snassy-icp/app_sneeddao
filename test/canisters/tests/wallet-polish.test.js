// Wallet polish (frontend utils): privacy mode masking in the shared amount formatter, and what a
// scanned QR code fills into a recipient field (src/app_sneeddao_frontend/src/utils/scanParse.js).
import { describe, it, expect, afterEach } from 'vitest';
import { Principal } from '@dfinity/principal';
import { encodeIcrcAccount } from '@dfinity/ledger-icrc';
import { setPrivacyMode, isPrivacyMode, PRIVACY_MASK, isTypingTarget } from '../../../src/app_sneeddao_frontend/src/utils/privacyMode.js';
import { formatAmount, formatAmountShown, formatAmountRaw } from '../../../src/app_sneeddao_frontend/src/utils/StringUtils.jsx';
import { parseScan } from '../../../src/app_sneeddao_frontend/src/utils/scanParse.js';

describe('privacy mode', () => {
    afterEach(() => setPrivacyMode(false));

    it('masks formatAmount, never the shown or raw (input) forms', () => {
        expect(formatAmount(123_450_000_000n, 8)).toBe((1234).toLocaleString() + '.5');
        setPrivacyMode(true);
        expect(isPrivacyMode()).toBe(true);
        expect(formatAmount(123_450_000_000n, 8)).toBe(PRIVACY_MASK);
        expect(formatAmountShown(123_450_000_000n, 8)).toBe((1234).toLocaleString() + '.5');
        expect(formatAmountRaw(123_450_000_000n, 8)).toBe('1234.5');
    });

    it('does not take the shortcut while typing', () => {
        expect(isTypingTarget({ tagName: 'INPUT' })).toBe(true);
        expect(isTypingTarget({ tagName: 'textarea' })).toBe(true);
        expect(isTypingTarget({ tagName: 'DIV', isContentEditable: true })).toBe(true);
        expect(isTypingTarget({ tagName: 'BUTTON' })).toBe(false);
        expect(isTypingTarget(null)).toBe(false);
    });
});

describe('QR scan parsing', () => {
    const p = 'ryjl3-tyaaa-aaaaa-aaaba-cai';
    const sub = new Uint8Array(32); sub[31] = 1;
    const account = encodeIcrcAccount({ owner: Principal.fromText(p), subaccount: sub });
    const accountId = 'd3e13d4777e22367532053190b6c6ccf57444a61337e996242b1abfb52cf92c8';

    it('reads principals and ICRC-1 accounts', () => {
        expect(parseScan(p, 'icrc')).toMatchObject({ ok: true, value: p });
        expect(parseScan(`  ${account}\n`, 'icrc')).toMatchObject({ ok: true, value: account });
    });

    it('takes an ICP account ID only for ICP', () => {
        expect(parseScan(accountId.toUpperCase(), 'icp')).toMatchObject({ ok: true, value: accountId });
        expect(parseScan(accountId, 'icrc').ok).toBe(false);
    });

    it('reads ICRC payment URIs, keeps the ledger, never the amount', () => {
        const r = parseScan(`icp:${p}/transfer?address=${encodeURIComponent(account)}&amount=100000000`, 'icrc');
        expect(r).toMatchObject({ ok: true, value: account, ledger: p });
        expect(r.note).toMatch(/100000000/);
        expect(parseScan(`icp:${p}`, 'icrc')).toMatchObject({ ok: true, value: p });
    });

    it('reads bitcoin: URIs and upper-case bech32 for BTC withdrawals', () => {
        const addr = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';
        expect(parseScan(`bitcoin:${addr}?amount=0.01&label=x`, 'btc')).toMatchObject({ ok: true, value: addr });
        expect(parseScan(`BITCOIN:${addr.toUpperCase()}`, 'btc')).toMatchObject({ ok: true, value: addr });
        expect(parseScan('1BoatSLRHtKNngkdXEeobR76b53LETtpyT', 'btc')).toMatchObject({ ok: true });
        expect(parseScan('lightning:lnbc1...', 'btc').ok).toBe(false);
        expect(parseScan(p, 'btc').ok).toBe(false);
        expect(parseScan(`bitcoin:${addr}`, 'icrc').ok).toBe(false);
    });

    it('reads ethereum: URIs, including ERC-20 transfer requests', () => {
        const a = '0x52908400098527886E0F7030069857D2E4169EE7';
        const token = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
        expect(parseScan(a, 'eth')).toMatchObject({ ok: true, value: a });
        expect(parseScan(`ethereum:${a}@1?value=1e18`, 'eth')).toMatchObject({ ok: true, value: a });
        expect(parseScan(`ethereum:${token}@1/transfer?address=${a}&uint256=1000000`, 'eth')).toMatchObject({ ok: true, value: a });
        expect(parseScan(`ethereum:${a}@137`, 'eth').ok).toBe(false);
    });

    it('explains what it could not use', () => {
        expect(parseScan('', 'icrc')).toMatchObject({ ok: false });
        expect(parseScan('hello world', 'icrc').error).toMatch(/No principal/);
    });
});
