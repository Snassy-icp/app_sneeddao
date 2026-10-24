// Speed up a stuck native Bitcoin send (spec/sneed_wallet.md §8, phase A4), on btc.html Activity.
// Custody-relevant: it signs a second transaction over coins that are already on their way.
//
// Casual: one rate preselected ("Fast"), one sensible way (RBF when the change pays the extra fee,
// else CPFP), every cost shown (extra network fee in sats and money, signing cycles), one button.
// Advanced: the other way, a custom rate, the BIP-125 numbers, the exact request. The amounts being
// signed are always shown, also in privacy mode (formatAmountShown). Fee suggestions come from
// mempool.space only while this panel is open (and never with "Don't look up fees"). No popups.
import React, { useEffect, useMemo, useState } from 'react';
import { FaBolt } from 'react-icons/fa';
import { useDenomination } from '../../contexts/DenominationContext';
import { formatAmountShown } from '../../utils/StringUtils';
import { TIERS, TIER_BLOCKS, validateCustomRate, feeLookupDisabled, feeNeedsExtraConfirm } from '../../utils/btc/fees';
import { planRbf, planCpfp, defaultSpeedUp, rbfCycles, cpfpCycles, INCREMENTAL_RELAY_RATE } from '../../utils/btc/speedup';
import { executeReplacement, executeCpfp, buildSendRequest, isAddressVerified, verifySignerAddress } from '../../utils/btc/send';
import { newId, recordTxid } from '../../utils/btc/pending';
import { ADDRESS_CYCLES, CYCLES_LEDGER_FEE, cyclesUsd, formatCycles } from '../../utils/btc/credit';
import { outpointKey } from '../../utils/btc/utxos';
import { Button, Notice, Advanced, Row, useC, inputStyle } from '../convert/ConvertUi';

const mono = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', overflowWrap: 'anywhere' };
const TIER_LABEL = { slow: 'Slow', normal: 'Normal', fast: 'Fast', custom: 'Custom' };
const json = (v) => JSON.stringify(v, (_, x) => (typeof x === 'bigint' ? x.toString() : x instanceof Uint8Array ? Array.from(x) : x), 2);

export default function BtcSpeedUp({ w, r, onClose }) {
    const c = useC();
    const { formatValue } = useDenomination();
    const { cfg, fees, market, locked } = w;
    const noLookup = feeLookupDisabled();
    const [tier, setTier] = useState(noLookup ? 'custom' : 'fast');
    const [customText, setCustomText] = useState('');
    const [way, setWay] = useState(null); // null = the default
    const [reduceOk, setReduceOk] = useState(false);
    const [realOk, setRealOk] = useState(false);
    const [extraOk, setExtraOk] = useState(false);
    const [busy, setBusy] = useState(false);
    const [progress, setProgress] = useState('');
    const [result, setResult] = useState(null);
    const [error, setError] = useState(null);

    const { refreshFees } = w;
    useEffect(() => { if (!noLookup) refreshFees(); }, [noLookup, refreshFees]);
    const tiers = !noLookup && fees.data?.ok ? fees.data.tiers : null;
    useEffect(() => { if (!tiers && tier !== 'custom' && (noLookup || fees.error)) setTier('custom'); }, [tiers, tier, noLookup, fees.error]);
    const custom = tier === 'custom' ? validateCustomRate(customText, tiers) : null;
    const feeRate = tier === 'custom' ? (custom?.ok ? custom.rate : null) : tiers?.[tier] ?? null;

    const utxos = w.btc.data?.utxos || [];
    const rbf = useMemo(() => (feeRate == null ? null : planRbf({ record: r, feeRate, network: cfg.network })), [r, feeRate, cfg.network]);
    const rbfReduced = useMemo(() => (feeRate == null || !rbf || rbf.ok || !rbf.canReduce ? null : planRbf({ record: r, feeRate, network: cfg.network, reduceAmount: true })), [r, feeRate, cfg.network, rbf]);
    const cpfp = useMemo(() => (feeRate == null ? null : planCpfp({ parent: r, feeRate, ownAddress: w.address, utxos, locked })), [r, feeRate, w.address, utxos, locked]);
    const def = defaultSpeedUp({ rbf, cpfp });
    const chosen = way || (def === 'cpfp' ? 'cpfp' : 'rbf');
    const plan = chosen === 'cpfp' ? cpfp : (rbf?.ok ? rbf : (rbfReduced || rbf));
    const needsReduce = chosen === 'rbf' && plan?.ok && plan.reduced;

    const realBtc = Boolean(cfg.devMode || cfg.beta);
    const verified = isAddressVerified(w.storage, cfg.network, w.meText, w.address);
    const signCycles = plan?.ok ? (chosen === 'cpfp' ? cpfpCycles(plan) : rbfCycles(plan)) : null;
    const charges = plan?.ok ? [signCycles, ...(verified ? [] : [ADDRESS_CYCLES])] : [];
    const ledgerFees = BigInt(charges.length + 1) * CYCLES_LEDGER_FEE;
    const totalCycles = charges.reduce((t, x) => t + x, 0n) + ledgerFees;
    const extraFee = plan?.ok ? (chosen === 'cpfp' ? plan.fee : plan.extraFee) : null;
    const satsUsd = (s) => (cfg.testnet || !market.btcUsd ? null : (Number(s) / 1e8) * market.btcUsd);
    const value = (usd) => (usd != null ? <span style={{ color: c.mutedText }}> · {formatValue(usd)}</span> : null);
    const btcShown = (sats) => <>{formatAmountShown(sats, 8)} {cfg.symbol}</>;
    const recipientAmount = BigInt(r.amount || 0);
    const extraReasons = plan?.ok && chosen === 'rbf' ? feeNeedsExtraConfirm({ fee: plan.fee, amount: plan.amount, feeRate: plan.feeRate, tiers }) : plan?.ok ? feeNeedsExtraConfirm({ fee: plan.packageFee, amount: recipientAmount || plan.amount, feeRate: plan.feeRate, tiers }) : [];
    const canGo = plan?.ok && !busy && !result && (!needsReduce || reduceOk) && (!realBtc || realOk) && (!extraReasons.length || extraOk);

    const go = async () => {
        if (!canGo) return;
        setBusy(true); setError(null);
        const id = newId();
        try {
            setProgress('Checking your coins…');
            const fresh = await w.refreshBtc();
            if (!fresh) throw new Error("Couldn't read your Bitcoin coins. Nothing was sent; try again.");
            const keys = new Set(fresh.utxos.map(outpointKey));
            const inputsUnspent = (r.request.inputs || []).filter((i) => !i.unconfirmed).every((i) => keys.has(outpointKey(i)));
            if (!inputsUnspent) throw new Error('This send was just mined (or its coins were spent). Nothing was sent.');
            if (chosen === 'cpfp' && keys.has(`${recordTxid(r)}:${r.changeVout}`)) throw new Error('This send was just mined. Nothing was sent.');
            setProgress('Approving the signing fee…');
            const pay = await w.ensureCredit(charges);
            if (!pay.ok) throw new Error(pay.shortfall ? `You need ${formatCycles(pay.shortfall)} more cycles of signing credit (Signing credit tab). Nothing was sent.` : pay.error);
            if (!verified) {
                setProgress('Checking your address with the signer…');
                const v = await verifySignerAddress({ signer: w.actors.signer, network: cfg.network, expected: w.address, storage: w.storage, principal: w.meText });
                if (!v.ok) throw new Error(v.error);
            }
            setProgress('Signing and broadcasting… keep this page open.');
            const args = { signer: w.actors.signer, store: w.store, plan, network: cfg.network, ownAddress: w.address, id, tipHeight: fresh.tipHeight, onSubmitting: () => { w.inFlight.current.add(id); w.loadRecords(); } };
            const res = chosen === 'cpfp' ? await executeCpfp({ ...args, parent: r }) : await executeReplacement({ ...args, original: r });
            setResult(res);
        } catch (e) {
            setError(String(e?.message || e));
        } finally {
            w.inFlight.current.delete(id);
            setBusy(false); setProgress('');
            w.loadRecords(); w.refreshBtc(); w.refreshCredit();
        }
    };

    const wayBtn = (k, label, p, note) => {
        const ok = p?.ok || (k === 'rbf' && rbfReduced?.ok);
        return (
            <button key={k} type="button" onClick={() => setWay(k)} disabled={!ok} aria-pressed={chosen === k}
                style={{ flex: '1 1 160px', minWidth: 0, textAlign: 'left', padding: '8px 10px', borderRadius: 10, cursor: ok ? 'pointer' : 'not-allowed', opacity: ok ? 1 : 0.55, background: chosen === k ? `${c.accent}22` : c.secondaryBg, border: `1px solid ${chosen === k ? c.accent : c.border}`, color: c.primaryText }}>
                <div style={{ fontWeight: 700, fontSize: 13 }}>{label}{def === k || (k === 'rbf' && def === 'rbf_reduce') ? ' · suggested' : ''}</div>
                <div style={{ fontSize: 11, color: c.mutedText }}>{ok ? note : (p?.message || '—')}</div>
            </button>
        );
    };

    if (result) {
        return (
            <div style={{ marginTop: 6 }}>
                {result.state === 'broadcast' && <Notice tone="success"><b>Sped up.</b> {chosen === 'cpfp' ? 'The speed-up transaction pays for both; they confirm together.' : 'The faster version is on its way. Both versions stay listed until one is mined; whichever confirms counts, and your coins can only be spent once.'}{result.drift ? ' (The transaction id differs from the computed one; logged for support.)' : ''}</Notice>}
                {['failed', 'unknown', 'not_sent', 'refused'].includes(result.state) && <Notice tone={result.state === 'unknown' ? 'warning' : 'error'}>{result.error}</Notice>}
                <div style={{ marginTop: 8 }}><Button variant="ghost" onClick={onClose}>Close</Button></div>
            </div>
        );
    }

    return (
        <div style={{ marginTop: 6, padding: '10px 12px', borderRadius: 10, border: `1px solid ${c.border}`, background: c.secondaryBg, display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
            <div style={{ fontWeight: 700, color: c.primaryText, display: 'flex', gap: 6, alignItems: 'center' }}><FaBolt size={12} /> Speed up this send</div>
            <div style={{ fontSize: 12, color: c.secondaryText }}>Now {r.feeRate} sat/vB, fee {String(r.fee)} sats. Pick a higher rate:</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {[...TIERS, 'custom'].map((t) => {
                    const rate = t === 'custom' ? null : tiers?.[t];
                    const dis = t !== 'custom' && (rate == null || rate <= Number(r.feeRate));
                    return (
                        <button key={t} type="button" disabled={dis} onClick={() => setTier(t)} aria-pressed={tier === t}
                            style={{ flex: '1 1 80px', minWidth: 0, padding: '6px 8px', borderRadius: 8, textAlign: 'left', cursor: dis ? 'not-allowed' : 'pointer', opacity: dis ? 0.5 : 1, background: tier === t ? `${c.accent}22` : c.primaryBg, border: `1px solid ${tier === t ? c.accent : c.border}`, color: c.primaryText, fontSize: 12 }}>
                            <b>{TIER_LABEL[t]}</b><div style={{ color: c.mutedText, fontSize: 11 }}>{t === 'custom' ? 'your own' : rate != null ? `${rate} sat/vB · ~${TIER_BLOCKS[t]} bl.` : '—'}</div>
                        </button>
                    );
                })}
            </div>
            {tier === 'custom' && (
                <div>
                    <input value={customText} onChange={(e) => setCustomText(e.target.value)} placeholder="sat/vB" inputMode="decimal" aria-label="Custom fee rate in sat per vbyte" style={{ ...inputStyle(c, customText && !custom?.ok), maxWidth: 180 }} />
                    {customText && !custom?.ok && <div style={{ color: c.error, fontSize: 12 }}>{custom.error}</div>}
                    {custom?.ok && custom.warn && <div style={{ color: c.warning, fontSize: 12 }}>{custom.warn}</div>}
                </div>
            )}
            {fees.error && !noLookup && <div style={{ fontSize: 11, color: c.mutedText }}>Couldn't get fee suggestions ({fees.error}); enter your own rate.</div>}
            {!fees.error && !noLookup && <div style={{ fontSize: 11, color: c.mutedText }}>Suggestions from mempool.space (third party; only current rates are asked).</div>}

            {feeRate != null && (
                <>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {wayBtn('rbf', 'Replace (RBF)', rbf, 'signs the same coins again with a higher fee')}
                        {wayBtn('cpfp', 'Child pays (CPFP)', cpfp, 'a second transaction pays extra for both')}
                    </div>
                    {plan && !plan.ok && <Notice tone="warning">{plan.message}</Notice>}
                    {plan?.ok && (
                        <div>
                            {chosen === 'rbf' ? (
                                <>
                                    <Row k="Recipient gets" v={<>{btcShown(plan.amount)}{value(satsUsd(plan.amount))}</>} strong sub={plan.reduced ? `${formatAmountShown(plan.reducedBy, 8)} ${cfg.symbol} less than before` : 'the same as before'} />
                                    <Row k="New network fee" v={<>{btcShown(plan.fee)}{value(satsUsd(plan.fee))}</>} sub={`${plan.feeRate} sat/vB × ${plan.vsize} vB${plan.dustToFee > 0n ? `, incl. ${plan.dustToFee} sats of leftover too small for change` : ''}`} />
                                    <Row k="Extra fee" v={<>{btcShown(extraFee)}{value(satsUsd(extraFee))}</>} sub={plan.change > 0n ? 'taken from your change' : 'your change is used up'} />
                                    {plan.change > 0n && <Row k="Change back to you" v={btcShown(plan.change)} />}
                                </>
                            ) : (
                                <>
                                    <Row k="Speed-up transaction" v={<>{btcShown(plan.amount)}</>} sub={`back to your own address${plan.extraCoins ? `, adding ${plan.extraCoins} more coin${plan.extraCoins === 1 ? '' : 's'}` : ''}`} />
                                    <Row k="Extra fee" v={<>{btcShown(extraFee)}{value(satsUsd(extraFee))}</>} sub={`both together pay ${plan.packageRate.toFixed(2)} sat/vB (${String(plan.packageFee)} sats for ${plan.packageVsize} vB)`} />
                                </>
                            )}
                            <Row k="Signing cost" v={<>{formatCycles(totalCycles)} cycles{value(cyclesUsd(totalCycles, market))}</>} sub={`signer ${formatCycles(signCycles)} (${plan.nInputs} coin${plan.nInputs === 1 ? '' : 's'})${verified ? '' : ` + address check ${formatCycles(ADDRESS_CYCLES)}`} + cycles-ledger fees up to ${formatCycles(ledgerFees)}`} />
                            {chosen === 'rbf' && <div style={{ fontSize: 11, color: c.mutedText, lineHeight: 1.5 }}>Replacing works because most Bitcoin nodes (Bitcoin Core 28 and later) accept a higher-fee version of an unconfirmed transaction. If the network keeps the old one, it still confirms as it was; you lose nothing but the signing cost.</div>}
                            {chosen === 'cpfp' && <div style={{ fontSize: 11, color: c.mutedText, lineHeight: 1.5 }}>Works while the stuck transaction is still in mempools. If it was dropped for a too-low fee, use Replace instead.</div>}
                        </div>
                    )}
                    {needsReduce && (
                        <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13, color: c.warning }}>
                            <input type="checkbox" checked={reduceOk} onChange={(e) => setReduceOk(e.target.checked)} disabled={busy} style={{ marginTop: 3 }} />
                            <span>There is no change to pay the higher fee. Send {formatAmountShown(plan.reducedBy, 8)} {cfg.symbol} less to the recipient: they get {formatAmountShown(plan.amount, 8)} instead of {formatAmountShown(recipientAmount, 8)} {cfg.symbol}.</span>
                        </label>
                    )}
                    {extraReasons.length > 0 && plan?.ok && (
                        <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13, color: c.warning }}>
                            <input type="checkbox" checked={extraOk} onChange={(e) => setExtraOk(e.target.checked)} disabled={busy} style={{ marginTop: 3 }} />
                            <span>Check this: {extraReasons.join(', and ')}. Tick to confirm.</span>
                        </label>
                    )}
                    {realBtc && plan?.ok && (
                        <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13, color: cfg.devMode ? '#d0021b' : c.primaryText, fontWeight: 600 }}>
                            <input type="checkbox" checked={realOk} onChange={(e) => setRealOk(e.target.checked)} disabled={busy} style={{ marginTop: 3 }} />
                            <span>{cfg.devMode ? 'This signs REAL bitcoin on Bitcoin MAINNET (staging developer mode).' : 'This signs real bitcoin and can\'t be undone.'} Tick to confirm.</span>
                        </label>
                    )}
                    {plan?.ok && (
                        <Advanced title="Advanced: the numbers and the exact request">
                            {chosen === 'rbf' && <div style={{ fontSize: 12, color: c.mutedText, lineHeight: 1.6 }}>Replacement rules: at least the old fee ({String(plan.rules.rule3)} sats), plus {INCREMENTAL_RELAY_RATE} sat/vB × {plan.vsize} vB ({String(plan.rules.rule4)} sats), and at least {plan.feeRate} sat/vB × {plan.vsize} vB ({String(plan.rules.rate)} sats). Same coins in the same order; replaces {recordTxid(r)}.</div>}
                            {chosen === 'cpfp' && <div style={{ fontSize: 12, color: c.mutedText, lineHeight: 1.6 }}>Spends {recordTxid(r)}:{r.changeVout} (unconfirmed, passed by hand) back to {w.address}. Parent {String(plan.parentFee)} sats / {plan.parentVsize} vB + child {String(plan.fee)} sats / {plan.vsize} vB.</div>}
                            <pre style={{ ...mono, fontSize: 11, color: c.secondaryText, background: c.primaryBg, padding: 8, borderRadius: 8, maxHeight: 220, overflow: 'auto', whiteSpace: 'pre-wrap' }}>
                                {json(buildSendRequest({ inputs: plan.inputs, outputs: chosen === 'cpfp' ? [plan.output] : plan.outputs, fee: plan.fee, network: cfg.network }))}
                            </pre>
                        </Advanced>
                    )}
                </>
            )}
            {error && <Notice tone="error">{error}</Notice>}
            {busy && <Notice>{progress}</Notice>}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <Button onClick={go} disabled={!canGo}><FaBolt size={11} /> {busy ? 'Working…' : plan?.ok ? `Speed up: +${formatAmountShown(extraFee, 8)} ${cfg.symbol} fee` : 'Speed up'}</Button>
                <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
            </div>
        </div>
    );
}
