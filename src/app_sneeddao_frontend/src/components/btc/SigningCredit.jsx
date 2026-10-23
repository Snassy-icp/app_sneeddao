// Signing credit (spec/sneed_wallet.md §2, §7; phase A0). Bitcoin signing is paid in cycles from
// the user's own cycles-ledger account (users always pay; no sponsorship).
//   Casual: "Signing credit: enough for ~N sends" and "Top up from ICP" (an ICP transfer to the
//           CMC with memo MINT, then notify_mint_cycles; utils/cyclesTopUp.js mintCyclesWithIcp,
//           which never pays twice for an interrupted top-up).
//   Advanced: the exact balance, the signer's current allowance and expiry, revoke, the cost table.
import React, { useMemo, useState } from 'react';
import { FaSync } from 'react-icons/fa';
import { useDenomination } from '../../contexts/DenominationContext';
import { formatAmount, formatAmountShown } from '../../utils/StringUtils';
import { maskIfPrivate } from '../../utils/privacyMode';
import {
    sendsAffordable, cyclesUsd, formatCycles, revokeSigner, icpForCycles, cyclesForIcp, withAllowanceFee,
    TYPICAL_SEND_CYCLES, SEND_BASE_CYCLES, SEND_PER_INPUT_CYCLES, SEND_PER_OUTPUT_CYCLES, ADDRESS_CYCLES, CYCLES_LEDGER_FEE, CYCLES_LEDGER,
} from '../../utils/btc/credit';
import { SIGNER_CANISTER } from '../../utils/btc/network';
import { mintCyclesWithIcp, finishPendingTopUp, getPendingTopUp, mintKey, describeTopUpResult, ICP_FEE_E8S } from '../../utils/cyclesTopUp';
import { Card, Label, inputStyle, Button, Notice, Advanced, Row, useC } from '../convert/ConvertUi';

const PRESETS = [3, 10, 30]; // sends
const nowNs = () => BigInt(Date.now()) * 1_000_000n;

/// ICP text → e8s, or null.
function parseIcp(text) {
    const m = /^(\d*)(?:\.(\d{0,8}))?$/.exec(String(text || '').trim());
    if (!m || (!m[1] && !m[2])) return null;
    const v = BigInt(m[1] || '0') * 100_000_000n + BigInt((m[2] || '').padEnd(8, '0') || '0');
    return v > 0n ? v : null;
}

export default function SigningCredit({ w, need = null }) {
    const c = useC();
    const { formatValue } = useDenomination();
    const { credit, market } = w;
    const d = credit.data;
    const rate = market.xdrPermyriadPerIcp;
    const [choice, setChoice] = useState(need ? 'need' : 10);
    const [customIcp, setCustomIcp] = useState('');
    const [reviewing, setReviewing] = useState(false);
    const [busy, setBusy] = useState(false);
    const [msg, setMsg] = useState(null);
    const [revokeAsk, setRevokeAsk] = useState(false);
    const pendingMint = w.meText ? getPendingTopUp(mintKey(w.meText)) : null;
    const usd = (x) => { const v = cyclesUsd(x, market); return v != null ? <span style={{ color: c.mutedText }}> · {formatValue(v)}</span> : null; };

    // the ICP amount for the choice (fee on top is the ICP ledger's 0.0001)
    const e8s = useMemo(() => {
        if (choice === 'custom') return parseIcp(customIcp);
        if (!rate) return null;
        // a margin of one ledger fee per send plus the approve fee; the cycles ledger keeps 0.1B of a deposit
        const cycles = choice === 'need'
            ? BigInt(need || 0n) + 2n * CYCLES_LEDGER_FEE
            : BigInt(choice) * withAllowanceFee(TYPICAL_SEND_CYCLES) + 2n * CYCLES_LEDGER_FEE;
        return icpForCycles(cycles, rate);
    }, [choice, customIcp, rate, need]);
    const cyclesOut = e8s && rate ? cyclesForIcp(e8s, rate) : null;
    const enough = market.icpBalance == null || e8s == null || market.icpBalance >= e8s + ICP_FEE_E8S;

    const topUp = async () => {
        setBusy(true); setMsg(null);
        try {
            const r = await mintCyclesWithIcp({ ledger: w.actors.icpLedger, cmc: w.actors.cmc, owner: w.meText, amountE8s: e8s });
            setMsg({ ok: r.status === 'ok' && !r.resumed, text: describeTopUpResult(r, (n) => formatCycles(BigInt(Math.round(n)))) });
            setReviewing(false);
        } catch (e) {
            setMsg({ ok: false, text: String(e?.message || e) });
        } finally {
            setBusy(false);
            w.refreshCredit(); w.refreshMarket();
        }
    };
    const finish = async () => {
        setBusy(true); setMsg(null);
        try {
            const r = await finishPendingTopUp({ ledger: w.actors.icpLedger, cmc: w.actors.cmc, canisterId: mintKey(w.meText), owner: w.meText });
            setMsg({ ok: r.status === 'ok', text: describeTopUpResult(r, (n) => formatCycles(BigInt(Math.round(n)))) });
        } finally { setBusy(false); w.refreshCredit(); }
    };
    const revoke = async () => {
        setBusy(true); setMsg(null); setRevokeAsk(false);
        try {
            const r = await revokeSigner(w.actors.cyclesLedger, { nowNs: nowNs() });
            setMsg({ ok: r.ok, text: r.ok ? 'The signer can no longer take cycles from your account.' : r.error });
        } catch (e) { setMsg({ ok: false, text: String(e?.message || e) }); } finally { setBusy(false); w.refreshCredit(); }
    };

    const expiry = d?.expiresAt != null ? new Date(Number(d.expiresAt / 1_000_000n)) : null;
    const allowanceLive = d && d.allowance > 0n && (expiry == null || expiry.getTime() > Date.now());

    return (
        <Card>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                <div>
                    <div style={{ fontSize: 13, color: c.mutedText }}>Signing credit</div>
                    <div style={{ fontSize: 20, fontWeight: 700, color: c.primaryText }}>
                        {d ? <>{maskIfPrivate(formatCycles(d.balance))} cycles{usd(d.balance)}</> : credit.error ? '—' : '…'}
                    </div>
                    {d && <div style={{ fontSize: 13, color: c.secondaryText }}>enough for about {sendsAffordable(d.balance)} send{sendsAffordable(d.balance) === 1 ? '' : 's'}</div>}
                </div>
                <button type="button" onClick={() => w.refreshCredit()} title="Refresh" style={{ background: 'none', border: 'none', color: c.accent, cursor: 'pointer' }}><FaSync size={12} /></button>
            </div>
            {credit.error && <Notice tone="warning" style={{ marginTop: 8 }}>Couldn't read the cycles ledger: {credit.error}</Notice>}
            <div style={{ fontSize: 12, color: c.mutedText, marginTop: 8, lineHeight: 1.5 }}>
                Each Bitcoin send costs about {formatCycles(withAllowanceFee(TYPICAL_SEND_CYCLES))} cycles{usd(withAllowanceFee(TYPICAL_SEND_CYCLES))} for the threshold signature and broadcast, paid to DFINITY's Chain Fusion Signer from your own account on the cycles ledger. The network fee is separate and paid in bitcoin.
            </div>

            {pendingMint && (
                <Notice tone="warning" style={{ marginTop: 12 }}>
                    A top-up of {formatAmountShown(BigInt(pendingMint.amountE8s), 8)} ICP is not finished{pendingMint.blockIndex ? ` (ICP block ${pendingMint.blockIndex})` : ''}. Finishing never sends ICP again.
                    <div style={{ marginTop: 8 }}><Button onClick={finish} disabled={busy}>Finish top-up</Button></div>
                </Notice>
            )}

            <div style={{ marginTop: 16 }}>
                <Label hint={market.icpBalance != null ? `ICP balance ${formatAmount(market.icpBalance, 8)}` : null}>Top up from ICP</Label>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {need && <Button variant={choice === 'need' ? 'primary' : 'ghost'} onClick={() => { setChoice('need'); setReviewing(false); }}>What this send needs</Button>}
                    {PRESETS.map((n) => <Button key={n} variant={choice === n ? 'primary' : 'ghost'} onClick={() => { setChoice(n); setReviewing(false); }}>~{n} sends</Button>)}
                    <Button variant={choice === 'custom' ? 'primary' : 'ghost'} onClick={() => { setChoice('custom'); setReviewing(false); }}>Other amount</Button>
                </div>
                {choice === 'custom' && (
                    <input value={customIcp} onChange={(e) => { setCustomIcp(e.target.value); setReviewing(false); }} placeholder="ICP, e.g. 0.5" inputMode="decimal" style={{ ...inputStyle(c, customIcp && !parseIcp(customIcp)), maxWidth: 220, marginTop: 8 }} aria-label="ICP amount" />
                )}
                {e8s != null && (
                    <div style={{ marginTop: 10 }}>
                        <Row k="You pay" v={<>{formatAmountShown(e8s, 8)} ICP</>} sub={`+ ${formatAmountShown(ICP_FEE_E8S, 8)} ICP ledger fee`} />
                        <Row k="You get about" v={cyclesOut != null ? <>{formatCycles(cyclesOut)} cycles{usd(cyclesOut)}</> : '…'} sub="at the CMC's current ICP/XDR rate (1T cycles = 1 XDR); the cycles ledger keeps 0.1B of the deposit" />
                    </div>
                )}
                {!enough && <Notice tone="warning" style={{ marginTop: 8 }}>Not enough ICP in your wallet's main account for this top-up.</Notice>}
                {!reviewing
                    ? <div style={{ marginTop: 10 }}><Button onClick={() => setReviewing(true)} disabled={!e8s || !enough || busy || !w.actors}>Top up…</Button></div>
                    : (
                        <Notice style={{ marginTop: 10 }}>
                            Send {formatAmountShown(e8s, 8)} ICP (+ fee) from your wallet's main account to the cycles minting canister, to be minted as cycles to your own cycles-ledger account {w.meText}? This is public on chain.
                            <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                                <Button onClick={topUp} disabled={busy}>{busy ? 'Topping up…' : 'Yes, top up'}</Button>
                                <Button variant="ghost" onClick={() => setReviewing(false)} disabled={busy}>Cancel</Button>
                            </div>
                        </Notice>
                    )}
            </div>
            {msg && <Notice tone={msg.ok ? 'success' : 'warning'} style={{ marginTop: 10 }}>{msg.text}</Notice>}

            <Advanced title="Advanced">
                <Row k="Balance (exact)" v={d ? `${maskIfPrivate(d.balance.toLocaleString('en-US'))} cycles` : '…'} sub={`cycles ledger ${CYCLES_LEDGER}, account ${w.meText || ''}`} />
                <Row k="Allowance to the signer" v={d ? `${formatCycles(d.allowance)} cycles` : '…'}
                    sub={d ? (d.allowance === 0n ? 'none' : expiry ? `${allowanceLive ? 'expires' : 'expired'} ${expiry.toLocaleString()}` : 'no expiry') : null} />
                <div style={{ fontSize: 12, color: c.mutedText, lineHeight: 1.5 }}>
                    Each send approves exactly what it costs for one hour, so nothing is left for the signer ({SIGNER_CANISTER}) to take later. Revoking sets the allowance to 0 and costs the 0.1B ledger fee.
                </div>
                {!revokeAsk
                    ? <div><Button variant="ghost" onClick={() => setRevokeAsk(true)} disabled={busy || !allowanceLive}>Revoke allowance</Button></div>
                    : (
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', fontSize: 13, color: c.secondaryText }}>
                            Revoke for {formatCycles(CYCLES_LEDGER_FEE)} cycles?
                            <Button variant="danger" onClick={revoke} disabled={busy}>Yes, revoke</Button>
                            <Button variant="ghost" onClick={() => setRevokeAsk(false)}>Cancel</Button>
                        </div>
                    )}
                <div style={{ fontSize: 13, color: c.secondaryText, fontWeight: 600, marginTop: 6 }}>What the signer charges</div>
                <Row k="Send, base" v={`${formatCycles(SEND_BASE_CYCLES)}`} />
                <Row k="… per coin spent" v={`+ ${formatCycles(SEND_PER_INPUT_CYCLES)}`} />
                <Row k="… per output (always one extra for change)" v={`+ ${formatCycles(SEND_PER_OUTPUT_CYCLES)}`} />
                <Row k="Typical send (1 coin, 1 recipient)" v={`${formatCycles(TYPICAL_SEND_CYCLES)}`} />
                <Row k="Address check (once per device)" v={`${formatCycles(ADDRESS_CYCLES)}`} />
                <Row k="Cycles-ledger fee per approve and per charge" v={`${formatCycles(CYCLES_LEDGER_FEE)}`} />
            </Advanced>
        </Card>
    );
}
