// What a scanned QR code means for the recipient field it fills. Pure, so it can be tested.
//
//   parseScan(text, target) -> { ok: true, value, note? } | { ok: false, error }
//
// target: 'icrc' (principal or ICRC-1 textual account), 'icp' (the same, or a 64-hex ICP account
// ID), 'btc' (a Bitcoin address, also from a BIP-21 `bitcoin:` URI) or 'eth' (an Ethereum
// address, also from an EIP-681 `ethereum:` URI). `value` is what goes into the field; the field's
// own validation still runs on it. A payment URI's amount is never filled in: `note` mentions it
// so the user can type it, and nothing is ever sent from a scan.
import { Principal } from '@dfinity/principal';
import { decodeIcrcAccount } from '@dfinity/ledger-icrc';

const HEX64 = /^(0x)?[0-9a-fA-F]{64}$/;
const ETH_ADDR = /^0x[0-9a-fA-F]{40}$/;
// Base58 legacy/P2SH or bech32/bech32m (mainnet and testnet); the BTC form checks it properly.
const BTC_ADDR = /^([13mn2][1-9A-HJ-NP-Za-km-z]{25,39}|(bc1|tb1|bcrt1)[02-9ac-hj-np-z]{6,87})$/;

const isPrincipal = (s) => {
    try { return Principal.fromText(s).toText() === s; } catch { return false; }
};
const isIcrcAccount = (s) => {
    try { return !!decodeIcrcAccount(s)?.owner; } catch { return false; }
};

function splitUri(text) {
    const m = /^([a-zA-Z][a-zA-Z0-9+.-]*):(.*)$/.exec(text);
    if (!m) return null;
    const scheme = m[1].toLowerCase();
    let rest = m[2];
    if (rest.startsWith('//')) rest = rest.slice(2);
    const q = rest.indexOf('?');
    const path = q >= 0 ? rest.slice(0, q) : rest;
    const params = new URLSearchParams(q >= 0 ? rest.slice(q + 1) : '');
    return { scheme, path, params };
}

const amountNote = (amount, unit) => (amount ? `The code also asks for ${amount}${unit ? ` ${unit}` : ''}; type the amount yourself if you want to send it.` : undefined);

function parseIc(text, target) {
    const s = text.trim();
    if (HEX64.test(s)) {
        if (target === 'icp') return { ok: true, value: s.replace(/^0x/, '').toLowerCase() };
        return { ok: false, error: 'That is an ICP account ID. It only works for sending ICP; this token needs a principal or an ICRC-1 account.' };
    }
    if (s.includes('.') && isIcrcAccount(s)) return { ok: true, value: s };
    if (isPrincipal(s)) return { ok: true, value: s };
    return null;
}

export function parseScan(raw, target = 'icrc') {
    const text = String(raw ?? '').trim();
    if (!text) return { ok: false, error: 'The QR code is empty.' };
    const uri = splitUri(text);

    if (target === 'btc') {
        let addr = text;
        let note;
        if (uri) {
            if (uri.scheme === 'lightning') return { ok: false, error: 'That is a Lightning invoice. This withdraws on the Bitcoin network only.' };
            if (uri.scheme !== 'bitcoin') return { ok: false, error: `That is a ${uri.scheme}: code, not a Bitcoin address.` };
            addr = decodeURIComponent(uri.path);
            note = amountNote(uri.params.get('amount'), 'BTC');
        }
        // QR alphanumeric mode upper-cases bech32 addresses; bech32 is case-insensitive.
        if (/^(BC1|TB1|BCRT1)[0-9A-Z]+$/.test(addr)) addr = addr.toLowerCase();
        if (!BTC_ADDR.test(addr)) return { ok: false, error: 'No Bitcoin address found in that code.' };
        return { ok: true, value: addr, note };
    }

    if (target === 'eth') {
        let addr = text;
        let note;
        if (uri) {
            if (uri.scheme !== 'ethereum') return { ok: false, error: `That is a ${uri.scheme}: code, not an Ethereum address.` };
            // EIP-681: ethereum:[pay-]<target>[@chainId][/function]?params
            const m = /^(?:pay-)?([^@/]+)(?:@(\d+))?(?:\/(\w+))?$/.exec(uri.path);
            if (!m) return { ok: false, error: 'Could not read that ethereum: code.' };
            const [, targetAddr, chainId, fn] = m;
            if (chainId && chainId !== '1') return { ok: false, error: `That code is for chain ${chainId}. Withdrawals go to Ethereum mainnet only.` };
            if (fn === 'transfer') {
                // An ERC-20 transfer request: the target is the token contract, the recipient is `address`.
                addr = uri.params.get('address') || '';
                note = amountNote(uri.params.get('uint256'), 'base units');
            } else {
                addr = targetAddr;
                note = amountNote(uri.params.get('value'), 'wei');
            }
        }
        if (!ETH_ADDR.test(addr)) return { ok: false, error: 'No Ethereum address found in that code.' };
        return { ok: true, value: addr, note };
    }

    // Internet Computer: principal, ICRC-1 account, ICP account ID, or a payment URI around one.
    if (uri && !isPrincipal(text)) {
        if (uri.scheme === 'bitcoin' || uri.scheme === 'lightning') return { ok: false, error: 'That is a Bitcoin code. Use Convert to withdraw ckBTC to Bitcoin.' };
        if (uri.scheme === 'ethereum') return { ok: false, error: 'That is an Ethereum code. Use Convert to withdraw to Ethereum.' };
        // ICRC-22 style: icp:<ledger>/transfer?address=<account>&amount=… ; or just <scheme>:<account>.
        const [head, fn] = uri.path.split('/');
        const fromParam = uri.params.get('address') || uri.params.get('to') || uri.params.get('recipient') || uri.params.get('account');
        const candidate = fn ? fromParam : (fromParam || decodeURIComponent(head));
        const parsed = candidate ? parseIc(decodeURIComponent(candidate), target) : null;
        if (!parsed) return { ok: false, error: 'No principal or account found in that code.' };
        if (!parsed.ok) return parsed;
        const ledger = fn && isPrincipal(head) ? head : null;
        return { ...parsed, ledger, note: amountNote(uri.params.get('amount'), 'base units') };
    }
    const parsed = parseIc(text, target);
    if (parsed) return parsed;
    if (BTC_ADDR.test(text) || /^bitcoin:/i.test(text)) return { ok: false, error: 'That is a Bitcoin address. Use Convert to withdraw ckBTC to Bitcoin.' };
    if (ETH_ADDR.test(text)) return { ok: false, error: 'That is an Ethereum address. Use Convert to withdraw to Ethereum.' };
    return { ok: false, error: 'No principal or account found in that code.' };
}
