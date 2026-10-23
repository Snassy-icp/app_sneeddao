// Native Bitcoin on the Bitcoin card (spec/sneed_wallet.md §2, §5.2, §10; phases A1/A2).
// One row: "Bitcoin address" with its balance (confirmed, plus pending when anything is
// unconfirmed), a Receive button that opens the address with copy and, on request, a QR code,
// and a Send button that leaves the SPA for btc.html with a normal navigation (sending lives on
// its own page without analytics; same origin, so the login carries over).
// Advanced: network, derivation, the canisters involved, and every UTXO with its confirmations.
//
// Rendered only behind the feature flag (utils/btc/network.js): staging with Bitcoin testnet4, or
// mainnet in developer mode (allowlisted principal + opt-in under Advanced; red banner), or prod
// mainnet once this browser turned on the Bitcoin (beta) switch (small Beta badge, one-time
// explanation). With the switch off, prod shows BtcBetaOffer instead and derives or reads nothing.
// Amounts go through formatAmount / formatValue, so privacy mode masks them. Theme colours only.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FaBitcoin, FaQrcode, FaSync, FaExternalLinkAlt, FaExclamationTriangle, FaPaperPlane } from 'react-icons/fa';
import { useTheme } from '../../contexts/ThemeContext';
import { useDenomination } from '../../contexts/DenominationContext';
import { usePockets } from '../../hooks/usePockets';
import { formatAmount, computeUsdValue } from '../../utils/StringUtils';
import { readNative, btcConfigFor } from '../../utils/pockets/adapters/btc_native';
import { bitcoinUri, deriveBtcAddress } from '../../utils/btc/address';
import { SIGNER_CANISTER, btcNative, btcSurface } from '../../utils/btc/network';
import { PocketLine } from '../PocketRows';
import { PocketButton } from '../PocketVisuals';
import { CopyValue, QrCode, Notice, Advanced } from '../convert/ConvertUi';
import TestnetBadge, { BtcNetworkBadge, MainnetDevBanner } from './TestnetBadge';
import MainnetDevToggle from './MainnetDevToggle';
import { BtcBetaOffer, BtcBetaIntro, BtcBetaSwitch } from './BtcBeta';

const REFRESH_MS = 60_000; // §5.2 step 5: every 60 s while visible, timers in the page only
const QR_KEY = 'sneed_btc_native_show_qr_v1';
const readQr = () => { try { return localStorage.getItem(QR_KEY) === '1'; } catch { return false; } };
const writeQr = (v) => { try { localStorage.setItem(QR_KEY, v ? '1' : '0'); } catch { /* storage blocked */ } };
const mono = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', overflowWrap: 'anywhere' };

export { TestnetBadge, BtcNetworkBadge };

/// The user's native Bitcoin read (cached 20 s in the adapter), refreshed every 60 s while visible.
function useNativeBtc(ctx) {
    const [state, setState] = useState({ data: null, error: null, loading: false });
    const live = useRef(true);
    const load = useCallback(async (fresh = false) => {
        if (!ctx) return;
        setState((s) => ({ ...s, loading: true }));
        try {
            const data = await readNative(ctx, { fresh });
            if (live.current) setState({ data, error: null, loading: false });
        } catch (e) {
            if (live.current) setState((s) => ({ ...s, error: String(e?.message || e), loading: false }));
        }
    }, [ctx]);
    useEffect(() => {
        live.current = true;
        load();
        const t = setInterval(() => { if (typeof document === 'undefined' || !document.hidden) load(true); }, REFRESH_MS);
        return () => { live.current = false; clearInterval(t); };
    }, [load]);
    return { ...state, reload: () => load(true) };
}

/// Sats as an amount (masked in privacy mode) with the network's symbol.
const Sats = ({ sats, cfg }) => <>{formatAmount(sats ?? 0n, 8)} {cfg.symbol}</>;

function ReceiveBtc({ address, cfg }) {
    const { theme } = useTheme();
    const c = theme.colors;
    const [showQr, setShowQrState] = useState(readQr);
    const setShowQr = (v) => { setShowQrState(v); writeQr(v); };
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 10, minWidth: 0 }}>
            {cfg.testnet && (
                <Notice tone="warning">
                    <b>Testnet only.</b> This is a Bitcoin <b>testnet4</b> address for trying Sneed Wallet on staging. Send only testnet4 coins from a faucet. It is not a real Bitcoin address and real BTC can't be sent to it.
                </Notice>
            )}
            {cfg.devMode && (
                <Notice tone="error">
                    <b>Bitcoin MAINNET, real BTC (developer mode).</b> This is a real bc1… address on staging. Send only small test amounts to it.
                </Notice>
            )}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-start', minWidth: 0 }}>
                {showQr && <QrCode text={bitcoinUri(address)} size={160} />}
                <div style={{ flex: '1 1 220px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <div style={{ fontSize: '0.75rem', color: c.mutedText, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                        Your {cfg.label} address (Native SegWit) <BtcNetworkBadge cfg={cfg} />
                    </div>
                    <CopyValue value={address} label="Bitcoin address" />
                    <button type="button" onClick={(e) => { e.stopPropagation(); setShowQr(!showQr); }}
                        style={{ alignSelf: 'flex-start', background: 'none', border: 'none', padding: 0, color: c.accent, cursor: 'pointer', fontSize: '0.78rem', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                        <FaQrcode size={10} /> {showQr ? 'Hide QR' : 'Show QR'}
                    </button>
                </div>
            </div>
            <Notice>
                <b>Sending</b> opens Sneed Wallet's Bitcoin page (no analytics there); it needs a little signing credit in cycles. Moving to ckBTC comes in a later release.
            </Notice>
            <div style={{ fontSize: '0.72rem', color: c.mutedText, lineHeight: 1.5 }}>
                The address belongs to your principal: the IC's threshold key behind DFINITY's Chain Fusion Signer holds it, there is no seed phrase. Anyone who knows your principal can compute it. It differs from your Oisy address, because Sneed Hub and Oisy sign you in as different principals.
            </div>
        </div>
    );
}

function AdvancedBtc({ data, cfg, me }) {
    const { theme } = useTheme();
    const c = theme.colors;
    const d = data ? deriveBtcAddress(me, cfg.network) : null;
    const row = (k, v) => (
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: '0.75rem', flexWrap: 'wrap', minWidth: 0 }}>
            <span style={{ color: c.mutedText }}>{k}</span>
            <span style={{ color: c.primaryText, textAlign: 'right', minWidth: 0, ...mono }}>{v}</span>
        </div>
    );
    return (
        <Advanced title="Advanced">
            <MainnetDevToggle status={btcNative(me)} />
            {btcSurface(btcNative(me)).betaSwitch && <BtcBetaSwitch on />}
            {row('Network', cfg.label)}
            {row('Address type', 'P2WPKH (Native SegWit)')}
            {d && row('Derivation path', `[${d.path.map((h) => `0x${h}`).join(', ')}]`)}
            {d && row('Public key', d.publicKey)}
            {row('Signer', SIGNER_CANISTER)}
            {row('Bitcoin canister', cfg.bitcoinCanister)}
            {data && row('Chain tip seen by the IC', `block ${data.tipHeight}`)}
            {data?.summary?.settling > 0n && row('Under 6 confirmations', <Sats sats={data.summary.settling} cfg={cfg} />)}
            {data && data.canisterBalance != null && row('Bitcoin canister balance (cross-check)', <><Sats sats={data.canisterBalance} cfg={cfg} />{data.mismatch ? ' · differs from the UTXO sum; refresh' : ''}</>)}
            <div style={{ fontSize: '0.72rem', color: c.mutedText, lineHeight: 1.5 }}>
                Derived in your browser from your principal and the signer's public key, at no cost. A paid check of the address against the signer (about 0.08B cycles) comes with signing credit, before the first send.
                The IC's Bitcoin canister sees mined blocks only, so incoming coins show after their first confirmation.
            </div>
            {data && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <div style={{ fontSize: '0.75rem', color: c.secondaryText, fontWeight: 600 }}>UTXOs ({data.utxos.length}{data.complete ? '' : ', more not read'})</div>
                    {!data.utxos.length && <div style={{ fontSize: '0.75rem', color: c.mutedText }}>None yet.</div>}
                    {data.utxos.map((u) => (
                        <div key={`${u.txid}:${u.vout}`} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', fontSize: '0.72rem', borderTop: `1px solid ${c.border}`, paddingTop: 4, minWidth: 0 }}>
                            <a href={`${cfg.explorer}/tx/${u.txid}`} target="_blank" rel="noopener noreferrer" style={{ color: c.accent, minWidth: 0, ...mono }}>
                                {u.txid.slice(0, 10)}…{u.txid.slice(-6)}:{u.vout} <FaExternalLinkAlt size={8} />
                            </a>
                            <span style={{ color: c.primaryText }}><Sats sats={u.value} cfg={cfg} /> · {u.confirmations} conf{u.confirmations === 1 ? '' : 's'}</span>
                        </div>
                    ))}
                </div>
            )}
        </Advanced>
    );
}

/// The native Bitcoin row of the Bitcoin card. `token` = the ckBTC token (its price values mainnet
/// BTC; testnet coins are never valued).
export default function BtcNativeSection({ token = null, hideButtons = false, first = false }) {
    const { theme } = useTheme();
    const c = theme.colors;
    const { formatValue } = useDenomination();
    const pk = usePockets();
    const ctx = pk.ctx;
    const cfg = btcConfigFor(ctx);
    // no read (and so no address derivation) without a network and a principal
    const { data, error, loading, reload } = useNativeBtc(cfg && ctx?.me ? ctx : null);
    const [receiving, setReceiving] = useState(false);
    if (!cfg && btcSurface(btcNative(ctx?.me ?? null)).offer) return hideButtons ? null : <BtcBetaOffer style={{ padding: '8px 0' }} />;
    if (!ctx || !cfg) return null;
    const status = btcNative(ctx.me);
    const address = data?.address || null;
    const s = data?.summary;
    const usd = !cfg.testnet && s && token?.conversion_rate ? computeUsdValue(s.confirmed, 8, token.conversion_rate) : null;
    const amount = error && !data
        ? <span style={{ fontSize: '0.78rem', color: c.warning, display: 'inline-flex', alignItems: 'center', gap: 5 }}><FaExclamationTriangle size={10} /> couldn't read Bitcoin</span>
        : (
            <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: '0.88rem', color: c.primaryText, overflowWrap: 'anywhere' }}>
                    {s ? formatAmount(s.confirmed, 8) : '…'} <span style={{ color: c.secondaryText, fontWeight: 600 }}>{cfg.symbol}</span>
                </div>
                {usd != null && usd > 0 ? <div style={{ fontSize: '0.72rem', color: c.mutedText }}>{formatValue(usd)}</div> : null}
            </div>
        );
    const actions = hideButtons ? [] : [
        { key: 'receive', icon: FaQrcode, label: 'Receive', onClick: () => setReceiving((r) => !r), disabled: !address },
        // a full page load, not a router push: btc.html must start without the SPA's gtag.js
        { key: 'send', icon: FaPaperPlane, label: 'Send', onClick: () => { window.location.assign(status.devSource === 'param' ? '/btc.html?btcnet=mainnet#send' : '/btc.html#send'); }, disabled: !address },
    ];
    return (
        <PocketLine first={first}
            avatar={<div style={{ width: 26, height: 26, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: c.tertiaryBg, border: `1px solid ${c.border}` }}><FaBitcoin size={16} color={cfg.testnet ? c.mutedText : '#f7931a'} /></div>}
            name="Bitcoin address"
            badge={cfg.testnet || cfg.devMode || cfg.beta ? <BtcNetworkBadge cfg={cfg} /> : null}
            amount={amount}
            sub={s && s.pending > 0n ? <>+ <Sats sats={s.pending} cfg={cfg} /> pending</> : cfg.testnet ? 'test coins, no value' : cfg.devMode ? 'REAL BTC · developer mode' : null}
            note={error && data ? `couldn't refresh: ${error}` : null}
            actions={actions}>
            <MainnetDevBanner cfg={cfg} style={{ marginTop: 8 }} />
            {cfg.beta && <BtcBetaIntro style={{ marginTop: 8 }} />}
            {receiving && address && <ReceiveBtc address={address} cfg={cfg} />}
            {receiving && (
                <div style={{ marginTop: 6 }}>
                    <PocketButton small icon={FaSync} disabled={loading} onClick={reload}>{loading ? 'Reading…' : 'Refresh'}</PocketButton>
                </div>
            )}
            {receiving && <AdvancedBtc data={data} cfg={cfg} me={ctx.me} />}
        </PocketLine>
    );
}

/// The Bitcoin card for a wallet without ckBTC: the native row on its own card.
export function BitcoinCard() {
    const { theme } = useTheme();
    const c = theme.colors;
    const pk = usePockets();
    const cfg = btcConfigFor(pk.ctx);
    if (!cfg && btcSurface(btcNative(pk.ctx?.me ?? null)).offer) {
        // prod, Bitcoin (beta) off in this browser: only the explanation and the switch
        return (
            <div className="card" style={{ minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
                    <FaBitcoin size={28} color="#f7931a" />
                    <span style={{ fontWeight: 700, fontSize: '1.05rem', color: c.primaryText }}>Bitcoin</span>
                </div>
                <BtcBetaOffer />
            </div>
        );
    }
    if (!pk.ctx || !cfg) return null;
    return (
        <div className="card" style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
                <FaBitcoin size={28} color={cfg.testnet ? c.mutedText : '#f7931a'} />
                <span style={{ fontWeight: 700, fontSize: '1.05rem', color: c.primaryText }}>Bitcoin</span>
                <BtcNetworkBadge cfg={cfg} big />
            </div>
            <div style={{ fontSize: '0.75rem', color: c.mutedText, marginBottom: 4 }}>Your native Bitcoin address. Add ckBTC to your wallet to see both on this card.</div>
            <BtcNativeSection first />
        </div>
    );
}
