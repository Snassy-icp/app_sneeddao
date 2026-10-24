// Send native Bitcoin (spec/sneed_wallet.md §5.3, phase A2). Lives on btc.html only (no analytics
// on any page that can sign BTC). Custody-relevant.
//
// Casual: address (paste or scan), amount or Max, "Normal" fee preselected, one review screen
// with every cost, Send. Advanced: fee tier or a custom sat/vB rate, coin control, the exact
// request. Fee suggestions come from mempool.space, fetched only while this form is open (or
// never, with "Don't look up fees"). The review step shows the amounts being signed even in
// privacy mode (formatAmountShown). No browser popups: confirmations are in the page.
//
// `move` (phase A3, BtcMove.jsx): the same send to the ck minter's deposit address for the user's
// account ({ pair, terms, depositAddress, owner }): the destination is fixed, the amount must clear
// the minter's minimum (moves.js depositGuard), the review shows the check fee, what arrives as
// ckBTC and the honest wait, and the pending record carries the conversion (kind 'toCkbtc').
//
// Phase A4:
//   - Sweep (Advanced → "Sweep", or `sweepTo` = { principal } from the later principal-migration
//     wizard): every confirmed, unreserved coin to one destination, no change (utils/btc/sweep.js);
//     the destination is an address or another principal's Sneed Wallet address derived offline
//     (shown with the principal); the review needs the destination's last 8 characters typed.
//   - Balance cross-check (utils/btc/verify.js): a send moving more than 25% of the balance or
//     more than 1,000,000 sats, and every sweep, first asks the signer's btc_caller_balance
//     (replicated, 0.113B cycles + 0.1B ledger fee, approved with the send) and stops on a
//     difference. Skippable only in the review's Advanced section, with a warning.
//   The principal field is a plain text field here: btc.html has no naming provider (and keeps its
//   bundle small, §4); the wizard in the SPA passes the principal it picked with PrincipalInput.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FaPaperPlane, FaSync, FaExternalLinkAlt, FaArrowLeft } from 'react-icons/fa';
import { useDenomination } from '../../contexts/DenominationContext';
import { formatAmount, formatAmountShown } from '../../utils/StringUtils';
import { parseBtcAddress, btcAddressTypeLabel } from '../../utils/ckAddress';
import { planSend, planShown, parseBtcAmount, satsToBtcText, spendable } from '../../utils/btc/select';
import { TIERS, TIER_BLOCKS, validateCustomRate, feeNeedsExtraConfirm, feeLookupDisabled, setFeeLookupDisabled } from '../../utils/btc/fees';
import { sendCycles, ADDRESS_CYCLES, CYCLES_LEDGER_FEE, cyclesUsd, formatCycles } from '../../utils/btc/credit';
import { executeSend, isAddressVerified, verifySignerAddress, buildSendRequest } from '../../utils/btc/send';
import { newId } from '../../utils/btc/pending';
import { planSweep, sweepTarget, confirmTailOk, confirmTailOf, CONFIRM_TAIL } from '../../utils/btc/sweep';
import { needsCrossCheck, crossCheckFresh, utxoTotal, utxoFingerprint, BALANCE_CYCLES } from '../../utils/btc/verify';
import { depositGuard, depositEta, depositMin, newDepositInfo } from '../../utils/btc/moves';
import { outpointKey } from '../../utils/btc/utxos';
import QrScanButton from '../QrScanButton';
import { Card, Label, inputStyle, Button, Notice, Advanced, Row, Pill, useC } from '../convert/ConvertUi';
import { BtcNetworkBadge } from './TestnetBadge';

const mono = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', overflowWrap: 'anywhere' };
const TIER_LABEL = { slow: 'Slow', normal: 'Normal', fast: 'Fast', custom: 'Custom' };
const FEE_POLL_MS = 60_000;
const json = (v) => JSON.stringify(v, (_, x) => (typeof x === 'bigint' ? x.toString() : x instanceof Uint8Array ? Array.from(x) : x), 2);

export default function BtcSend({ w, onGoCredit, onGoActivity, move = null, sweepTo = null }) {
    const c = useC();
    const { formatValue } = useDenomination();
    const { cfg, address, btc, fees, records, market, locked } = w;
    const [to, setTo] = useState('');
    const [scanNote, setScanNote] = useState(null);
    const [amountText, setAmountText] = useState('');
    const [max, setMax] = useState(false);
    const [tier, setTier] = useState('normal');
    const [customText, setCustomText] = useState('');
    const [noLookup, setNoLookupState] = useState(() => feeLookupDisabled());
    const [chosen, setChosen] = useState(null); // coin control: Set of outpoint keys, or null = automatic
    const [step, setStep] = useState('edit'); // edit | review | sending | done
    const [extraOk, setExtraOk] = useState(false);
    const [mainnetOk, setMainnetOk] = useState(false); // real BTC (beta or developer mode) must be ticked
    const [progress, setProgress] = useState('');
    const [result, setResult] = useState(null);
    const [error, setError] = useState(null);
    // sweep (A4): everything to one destination; to an address or to another principal's address
    const [sweepMode, setSweepMode] = useState(Boolean(sweepTo) && !move);
    const [sweepKind, setSweepKind] = useState(sweepTo ? 'principal' : 'address');
    const [principalText, setPrincipalText] = useState(sweepTo?.principal || '');
    const [dropUneconomic, setDropUneconomic] = useState(false);
    const [confirmText, setConfirmText] = useState('');
    // balance cross-check (A4): skippable in the review's Advanced section only
    const [skipCheck, setSkipCheck] = useState(false);

    // fees: fetched only while this form is open, and only when lookups are on
    const { refreshFees } = w;
    useEffect(() => {
        if (noLookup) return undefined;
        refreshFees();
        const t = setInterval(() => { if (!document.hidden) refreshFees(); }, FEE_POLL_MS);
        return () => clearInterval(t);
    }, [noLookup, refreshFees]);
    const setNoLookup = (v) => { setNoLookupState(v); setFeeLookupDisabled(v); if (v) setTier('custom'); };
    const tiers = !noLookup && fees.data?.ok ? fees.data.tiers : null;
    useEffect(() => { if (!tiers && tier !== 'custom' && (noLookup || fees.error)) setTier('custom'); }, [tiers, tier, noLookup, fees.error]);

    const custom = tier === 'custom' ? validateCustomRate(customText, tiers) : null;
    const feeRate = tier === 'custom' ? (custom?.ok ? custom.rate : null) : tiers?.[tier] ?? null;

    const sweep = sweepMode && !move;
    const target = sweep && sweepKind === 'principal' ? sweepTarget(principalText, cfg.network, { me: w.meText }) : null;
    const dest = move ? move.depositAddress : target ? (target.ok ? target.address : '') : to.trim();
    const parsedTo = dest ? parseBtcAddress(dest, cfg.network) : null;
    const amount = max ? null : parseBtcAmount(amountText);
    const utxos = btc.data?.utxos || [];
    const coins = useMemo(() => spendable(utxos, { locked }), [utxos, locked]);
    const chosenList = chosen ? coins.filter((u) => chosen.has(outpointKey(u))) : null;

    const livePlan = useMemo(() => {
        if (!btc.data || !parsedTo?.ok || feeRate == null) return null;
        if (sweep) return planSweep({ utxos, locked, feeRate, destType: parsedTo.type, dropUneconomic });
        if (!max && !amount?.ok) return null;
        return planSend({ utxos, locked, amount: max ? null : amount.sats, max, feeRate, destType: parsedTo.type, inputs: chosenList });
    }, [btc.data, parsedTo?.ok, parsedTo?.type, feeRate, max, amount?.ok, amount?.sats, utxos, locked, chosenList, sweep, dropUneconomic]); // eslint-disable-line react-hooks/exhaustive-deps
    const [sendingPlan, setSendingPlan] = useState(null);
    const plan = planShown({ step, sendingPlan, livePlan });

    // real bitcoin (prod beta, or staging developer mode) needs the review tick; testnet4 doesn't
    const realBtc = Boolean(cfg.devMode || cfg.beta);
    const verified = isAddressVerified(w.storage, cfg.network, w.meText, address);
    const signCycles = plan?.ok ? sendCycles(plan.nInputs, 1) : null;
    // the cross-check before a large send (a passed one is reused for 10 minutes on the same coins)
    const fingerprint = utxoFingerprint(utxos);
    const cc = plan?.ok ? needsCrossCheck({ leaving: plan.amount + plan.fee, balance: utxoTotal(utxos), sweep }) : { needed: false, reasons: [] };
    const ccFresh = crossCheckFresh(w.lastCheck.current, { fingerprint, now: Date.now() });
    const ccRun = cc.needed && !skipCheck && !ccFresh;
    const charges = plan?.ok ? [signCycles, ...(verified ? [] : [ADDRESS_CYCLES]), ...(ccRun ? [BALANCE_CYCLES] : [])] : [];
    const ledgerFees = BigInt(charges.length + 1) * CYCLES_LEDGER_FEE; // one withdraw fee per call + one approve (at most)
    const totalCycles = charges.reduce((t, x) => t + x, 0n) + ledgerFees;
    const satsUsd = (s) => (cfg.testnet || !market.btcUsd ? null : (Number(s) / 1e8) * market.btcUsd);
    const cycUsd = (x) => cyclesUsd(x, market);
    const extraReasons = plan?.ok ? feeNeedsExtraConfirm({ fee: plan.fee, amount: plan.amount, feeRate: plan.feeRate, tiers }) : [];
    const ownAddress = !move && parsedTo?.ok && dest === address;
    const storeBlocked = !records.ok;
    // a move must arrive above the minter's minimum and check fee, or nothing is minted
    const guard = move && plan?.ok ? depositGuard({ amount: plan.amount, terms: move.terms, symbol: move.pair.symbol }) : null;
    const canReview = plan?.ok && !storeBlocked && step === 'edit' && (!guard || guard.ok) && (!target || target.ok);
    const sweepConfirmed = !sweep || confirmTailOk(confirmText, dest);
    const eta = move ? depositEta(move.terms.minConfirmations) : null;

    const value = (usd) => (usd != null ? <span style={{ color: c.mutedText }}> · {formatValue(usd)}</span> : null);
    const btcShown = (sats) => <>{formatAmountShown(sats, 8)} {cfg.symbol}</>;

    const doSend = useCallback(async () => {
        if (!plan?.ok) return;
        if (realBtc && !mainnetOk) return; // real BTC: the review tick is required
        setError(null);
        setSendingPlan(plan);
        setStep('sending');
        try {
            // 1. pending store must be readable, and the plan's coins must still be free and unspent
            setProgress('Checking your coins…');
            const recs = w.loadRecords();
            if (!recs.ok) throw new Error(recs.error);
            const fresh = await w.refreshBtc();
            if (!fresh) throw new Error("Couldn't read your Bitcoin coins. Nothing was sent; try again.");
            const freeNow = new Set(spendable(fresh.utxos, { locked: w.locked }).map(outpointKey));
            const lockedNow = new Set(recs.records.filter((r) => ['submitting', 'broadcast', 'unknown'].includes(r.state)).flatMap((r) => r.request.inputs.map(outpointKey)));
            if (plan.inputs.some((u) => !freeNow.has(outpointKey(u)) || lockedNow.has(outpointKey(u)))) {
                throw new Error('Your coins changed since you reviewed this send. Nothing was sent; check the summary again.');
            }
            // 2. signing credit: approve exactly what these calls cost
            setProgress('Approving the signing fee…');
            const pay = await w.ensureCredit(charges);
            if (!pay.ok) {
                if (pay.shortfall) { setStep('review'); setError({ text: `You need ${formatCycles(pay.shortfall)} more cycles of signing credit. Nothing was sent.`, topUp: pay.shortfall }); return; }
                throw new Error(pay.error);
            }
            // 3. a large send: the replicated balance must match the coins this page read (0.113B)
            if (ccRun) {
                setProgress('Cross-checking your balance with the Bitcoin canister (all replicas agree on this answer)…');
                const v = await w.verifyBalance({ pay: false });
                if (!v.ok) throw new Error(v.error);
            }
            // 3b. first send on this device: check our address with the signer (0.079B)
            if (!verified) {
                setProgress('Checking your address with the signer…');
                const v = await verifySignerAddress({ signer: w.actors.signer, network: cfg.network, expected: address, storage: w.storage, principal: w.meText });
                if (!v.ok) throw new Error(v.error);
            }
            // 4. send (the pending record is written before the call)
            setProgress('Signing and broadcasting… this takes about 10–40 seconds per coin. Keep this page open.');
            const id = newId();
            if (move && !depositGuard({ amount: plan.amount, terms: move.terms }).ok) throw new Error('This amount is below the minter\'s minimum. Nothing was sent.');
            const r = await executeSend({
                signer: w.actors.signer, store: w.store, plan, toAddress: dest, network: cfg.network, ownAddress: address, id,
                kind: move ? 'toCkbtc' : sweep ? 'sweep' : 'send',
                extra: move ? { ckbtc: newDepositInfo({ pair: move.pair, owner: move.owner, depositAddress: move.depositAddress, terms: move.terms, amount: plan.amount }) }
                    : sweep ? { sweep: { principal: target?.ok ? target.principal : null, uneconomicIncluded: !dropUneconomic, crossChecked: ccRun || ccFresh } } : null,
                tipHeight: fresh.tipHeight,
                onSubmitting: () => { w.inFlight.current.add(id); w.loadRecords(); },
            });
            w.inFlight.current.delete(id);
            w.loadRecords();
            setResult(r);
            setStep('done');
            w.refreshCredit();
            w.refreshBtc();
        } catch (e) {
            setError({ text: String(e?.message || e) });
            setStep('review');
        } finally {
            setProgress('');
        }
    }, [plan, w, charges, verified, cfg.network, realBtc, mainnetOk, address, dest, move, ccRun, ccFresh, sweep, target, dropUneconomic]);

    const reset = () => { setStep('edit'); setResult(null); setError(null); setExtraOk(false); setMainnetOk(false); setTo(''); setAmountText(''); setMax(false); setChosen(null); setConfirmText(''); setSkipCheck(false); if (!sweepTo) setSweepMode(false); };
    const ckSym = move?.pair.symbol;

    // ---------------------------------------------------------------- done
    if (step === 'done' && result) {
        const txid = result.txid || result.record?.expectedTxid;
        return (
            <Card>
                {result.state === 'broadcast' && move && (
                    <Notice tone="success">
                        <b>On its way to the ckBTC minter.</b> The minter mints {ckSym} after {move.terms.minConfirmations} Bitcoin confirmations, {eta.text}; it can take longer when blocks are slow.
                        {' '}Keep this page open and it finishes by itself, or come back any time and press <b>Check / finish</b> under Activity → Moves.
                        {result.drift && <div style={{ marginTop: 6 }}>Note: the transaction id differs from the one this page computed. Your coins are fine; this is logged for support.</div>}
                    </Notice>
                )}
                {result.state === 'broadcast' && !move && (
                    <Notice tone="success">
                        <b>Sent.</b> The signer handed your transaction to the Bitcoin network. It counts as done after its first confirmation (about 10 minutes, longer at a low fee).
                        {result.drift && <div style={{ marginTop: 6 }}>Note: the transaction id differs from the one this page computed. Your coins are fine; this is logged for support.</div>}
                    </Notice>
                )}
                {result.state === 'failed' && <Notice tone="error">{result.error}</Notice>}
                {result.state === 'unknown' && <Notice tone="warning">{result.error}</Notice>}
                {result.state === 'not_sent' && <Notice tone="error">{result.error}</Notice>}
                {txid && result.state !== 'not_sent' && result.state !== 'failed' && (
                    <div style={{ marginTop: 10, fontSize: 13 }}>
                        <div style={{ color: c.mutedText }}>Transaction id</div>
                        <div style={{ ...mono, color: c.primaryText }}>{txid}</div>
                        <a href={`${cfg.explorer}/tx/${txid}`} target="_blank" rel="noopener noreferrer" style={{ color: c.accent, fontSize: 13 }}>
                            Open on mempool.space <FaExternalLinkAlt size={10} />
                        </a>
                    </div>
                )}
                {result.info?.topUp && <div style={{ marginTop: 10 }}><Button onClick={() => onGoCredit(null)}>Top up signing credit</Button></div>}
                <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
                    <Button variant="ghost" onClick={reset}>{move ? 'New move' : 'New send'}</Button>
                    <Button variant="ghost" onClick={onGoActivity}>Activity</Button>
                </div>
            </Card>
        );
    }

    // ---------------------------------------------------------------- review
    if ((step === 'review' || step === 'sending') && plan?.ok) {
        const sending = step === 'sending';
        return (
            <Card>
                <button type="button" onClick={() => { setStep('edit'); setError(null); setMainnetOk(false); }} disabled={sending}
                    style={{ background: 'none', border: 'none', color: c.secondaryText, cursor: 'pointer', padding: 0, fontSize: 13, display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                    <FaArrowLeft size={11} /> Edit
                </button>
                <h2 style={{ fontSize: 18, margin: '10px 0', color: c.primaryText, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>{move ? `Review the move to ${ckSym}` : sweep ? 'Review the sweep' : 'Review the send'} <BtcNetworkBadge cfg={cfg} /></h2>
                {target?.ok && (
                    <>
                        <div style={{ fontSize: 13, color: c.mutedText }}>To the Sneed Wallet of principal</div>
                        <div style={{ ...mono, fontSize: 14, color: c.primaryText, marginBottom: 4 }}>{target.principal}</div>
                        <div style={{ fontSize: 12, color: c.mutedText, marginBottom: 4 }}>whose Bitcoin address, computed on this page the way the signer computes it, is</div>
                    </>
                )}
                <div style={{ fontSize: 13, color: c.mutedText }}>{move ? `To the ${ckSym} minter's deposit address for your account` : target?.ok ? 'Address' : 'To'}</div>
                <div style={{ ...mono, fontSize: 14, color: c.primaryText, marginBottom: 8 }}>{dest} <span style={{ color: c.mutedText }}>({btcAddressTypeLabel(parsedTo.type)})</span></div>
                {ownAddress && <Notice tone="warning">This is your own address: the coins come back to you, minus the fee.</Notice>}
                {move ? (
                    <>
                        <Row k="Moves" v={<>{btcShown(plan.amount)}{value(satsUsd(plan.amount))}</>} />
                        <Row k="Minter's check fee" v={btcShown(BigInt(move.terms.checkFee))} sub="taken from the deposit by the minter" />
                        <Row k={`You get about`} v={<>{formatAmountShown(guard?.receive ?? 0n, 8)} {ckSym}{value(satsUsd(guard?.receive ?? 0n))}</>} strong
                            sub={`after ${move.terms.minConfirmations} Bitcoin confirmations, ${eta.text}; sometimes longer`} />
                    </>
                ) : <Row k="Recipient gets" v={<>{btcShown(plan.amount)}{value(satsUsd(plan.amount))}</>} strong />}
                <Row k="Network fee" v={<>{btcShown(plan.fee)}{value(satsUsd(plan.fee))}</>}
                    sub={`${plan.feeRate} sat/vB × ${plan.vsize} vB${tier !== 'custom' ? ` · ${TIER_LABEL[tier]}, about ${TIER_BLOCKS[tier]} block${TIER_BLOCKS[tier] === 1 ? '' : 's'}` : ' · custom rate'}${plan.dustToFee > 0n ? ` · includes ${plan.dustToFee} sats of leftover too small to return as change` : ''}`} />
                <Row k="Leaves your address" v={btcShown(plan.amount + plan.fee)} />
                {sweep && plan.uneconomic?.count > 0 && plan.uneconomic.included && <Row k="Small coins included" v={`${plan.uneconomic.count} (${String(plan.uneconomic.sats)} sats)`} sub="they cost about as much fee to spend as they are worth; included so nothing stays behind (Advanced can leave them out)" />}
                {sweep && (plan.leftBehind?.reserved > 0n || plan.leftBehind?.uneconomic > 0n) && <Row k="Stays behind" v={btcShown(plan.leftBehind.reserved + plan.leftBehind.uneconomic)} sub={`${plan.leftBehind.reserved > 0n ? `${formatAmountShown(plan.leftBehind.reserved, 8)} reserved by pending sends` : ''}${plan.leftBehind.reserved > 0n && plan.leftBehind.uneconomic > 0n ? ', ' : ''}${plan.leftBehind.uneconomic > 0n ? `${formatAmountShown(plan.leftBehind.uneconomic, 8)} in small coins left out` : ''}`} />}
                {plan.change > 0n && <Row k="Change back to you" v={btcShown(plan.change)} />}
                <Row k="Signing cost" v={<>{formatCycles(totalCycles)} cycles{value(cycUsd(totalCycles))}</>}
                    sub={`signer ${formatCycles(signCycles)} (${plan.nInputs} coin${plan.nInputs === 1 ? '' : 's'})${verified ? '' : ` + one-time address check ${formatCycles(ADDRESS_CYCLES)}`}${ccRun ? ` + balance cross-check ${formatCycles(BALANCE_CYCLES)}` : ''} + cycles-ledger fees up to ${formatCycles(ledgerFees)}; paid from your signing credit`} />
                {cc.needed && (
                    <Row k="Balance cross-check" v={ccFresh ? 'done a moment ago' : skipCheck ? 'skipped' : `${formatCycles(BALANCE_CYCLES + CYCLES_LEDGER_FEE)} cycles`}
                        sub={`because ${cc.reasons.join(' and ')}: before signing, the Bitcoin canister's replicated balance must match the coins this page read`} />
                )}
                {sweep && (
                    <div style={{ marginTop: 10 }}>
                        <label style={{ fontSize: 13, color: c.primaryText, fontWeight: 600 }} htmlFor="sweep-confirm">Type the last {CONFIRM_TAIL} characters of the destination address to confirm: <span style={mono}>…{confirmTailOf(dest)}</span></label>
                        <input id="sweep-confirm" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} disabled={sending} spellCheck={false} autoComplete="off" style={{ ...inputStyle(c, confirmText && !sweepConfirmed), ...mono, maxWidth: 220, marginTop: 4 }} />
                    </div>
                )}
                {extraReasons.length > 0 && (
                    <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: 10, fontSize: 13, color: c.warning }}>
                        <input type="checkbox" checked={extraOk} onChange={(e) => setExtraOk(e.target.checked)} disabled={sending} style={{ marginTop: 3 }} />
                        <span>Check this: {extraReasons.join(', and ')}. Tick to confirm the fee is what you want.</span>
                    </label>
                )}
                {cfg.beta && !cfg.devMode && (
                    <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: 10, fontSize: 13, color: c.primaryText, fontWeight: 600 }}>
                        <input type="checkbox" checked={mainnetOk} onChange={(e) => setMainnetOk(e.target.checked)} disabled={sending} style={{ marginTop: 3 }} />
                        <span>{move ? `I checked the amount. This sends real bitcoin to the ${ckSym} minter and can't be undone; it comes back as ${ckSym}.` : "I checked the address and amount. This sends real bitcoin and can't be undone."}</span>
                    </label>
                )}
                {cfg.devMode && (
                    <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: 10, fontSize: 13, color: '#d0021b', fontWeight: 700 }}>
                        <input type="checkbox" checked={mainnetOk} onChange={(e) => setMainnetOk(e.target.checked)} disabled={sending} style={{ marginTop: 3 }} />
                        <span>This sends REAL bitcoin on Bitcoin MAINNET (staging developer mode). It can't be undone. Tick to confirm.</span>
                    </label>
                )}
                {cc.needed && !ccFresh && (
                    <Advanced title="Advanced: skip the balance cross-check">
                        <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13, color: c.warning }}>
                            <input type="checkbox" checked={skipCheck} onChange={(e) => setSkipCheck(e.target.checked)} disabled={sending} style={{ marginTop: 3 }} />
                            <span>Skip it for this send. Not recommended: the coins shown come from one IC replica's unverified answer. A wrong answer can't make you overpay (signatures commit to each coin's value), but it can make this send fail after the signing cycles are spent, or hide coins.</span>
                        </label>
                    </Advanced>
                )}
                <Advanced title="Advanced: the exact request">
                    {move && (
                        <div style={{ fontSize: 12, color: c.mutedText, lineHeight: 1.6 }}>
                            Minter {move.pair.minter} · ledger {move.pair.ledger}<br />
                            Deposit address from get_btc_address {'{'} owner = {String(move.owner)}, subaccount = none (Main) {'}'}<br />
                            Then update_balance as you once the deposit has {move.terms.minConfirmations} confirmations. Minimum deposit {String(move.terms.minDeposit ?? 0n)} sats, check fee {String(move.terms.checkFee)} sats.
                        </div>
                    )}
                    <div style={{ fontSize: 12, color: c.mutedText }}>btc_caller_send to the Chain Fusion Signer, paid with CallerPaysIcrc2Cycles. Coins are spent in this order; the change output, if any, comes last.</div>
                    <pre style={{ ...mono, fontSize: 11, color: c.secondaryText, background: c.secondaryBg, padding: 8, borderRadius: 8, maxHeight: 260, overflow: 'auto', whiteSpace: 'pre-wrap' }}>
                        {json(buildSendRequest({ inputs: plan.inputs, outputs: [{ address: dest, value: plan.amount }], fee: plan.fee, network: cfg.network }))}
                    </pre>
                </Advanced>
                {error && (
                    <Notice tone="error" style={{ marginTop: 10 }}>
                        {error.text}
                        {error.topUp && <div style={{ marginTop: 8 }}><Button onClick={() => onGoCredit(error.topUp)}>Top up signing credit</Button></div>}
                    </Notice>
                )}
                {sending && <Notice style={{ marginTop: 10 }}>{progress}</Notice>}
                <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
                    <Button onClick={doSend} disabled={sending || (extraReasons.length > 0 && !extraOk) || (realBtc && !mainnetOk) || !sweepConfirmed}>
                        <FaPaperPlane size={12} /> {sending ? 'Sending…' : `${move ? 'Move' : sweep ? 'Sweep' : 'Send'} ${formatAmountShown(plan.amount, 8)} ${cfg.symbol}${move ? ` to ${ckSym}` : ''}${cfg.devMode ? ' on MAINNET' : ''}`}
                    </Button>
                </div>
            </Card>
        );
    }

    // ---------------------------------------------------------------- edit
    const s = btc.data?.summary;
    const tierBtn = (t) => {
        const rate = t === 'custom' ? null : tiers?.[t];
        const disabled = t !== 'custom' && rate == null;
        const est = plan?.ok && tier === t ? plan.fee : null;
        return (
            <button key={t} type="button" disabled={disabled} onClick={() => setTier(t)} aria-pressed={tier === t}
                style={{ flex: '1 1 90px', minWidth: 0, textAlign: 'left', padding: '8px 10px', borderRadius: 10, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1, background: tier === t ? `${c.accent}22` : c.secondaryBg, border: `1px solid ${tier === t ? c.accent : c.border}`, color: c.primaryText }}>
                <div style={{ fontWeight: 700, fontSize: 13 }}>{TIER_LABEL[t]}</div>
                <div style={{ fontSize: 11, color: c.mutedText }}>
                    {t === 'custom' ? 'your own sat/vB' : rate != null ? `${rate} sat/vB · ~${TIER_BLOCKS[t]} block${TIER_BLOCKS[t] === 1 ? '' : 's'}` : '—'}
                    {est != null && <div>≈ {String(est)} sats</div>}
                </div>
            </button>
        );
    };
    return (
        <Card>
            {storeBlocked && <Notice tone="error" style={{ marginBottom: 10 }}>{records.error}</Notice>}
            <div style={{ fontSize: 13, color: c.mutedText, marginBottom: 12 }}>
                Spendable: <b style={{ color: c.primaryText }}>{s ? <>{formatAmount(coins.reduce((t, u) => t + u.value, 0n), 8)} {cfg.symbol}</> : '…'}</b>
                {s && s.locked > 0n && <> · {formatAmount(s.locked, 8)} reserved by pending sends</>}
                <button type="button" onClick={() => w.refreshBtc()} title="Refresh" style={{ marginLeft: 8, background: 'none', border: 'none', color: c.accent, cursor: 'pointer' }}><FaSync size={11} /></button>
            </div>

            {move ? (
                <div style={{ fontSize: 13, color: c.secondaryText, lineHeight: 1.55 }}>
                    Sends bitcoin from your address to the {ckSym} minter's deposit address for your account; the minter then mints the same amount of {ckSym} to your wallet's Main account, minus a {String(move.terms.checkFee)} sats check fee.
                    {' '}It waits for {move.terms.minConfirmations} Bitcoin confirmations first: {eta.text}, sometimes longer.
                    <div style={{ ...mono, fontSize: 12, color: c.mutedText, marginTop: 4 }}>Deposit address {dest}</div>
                </div>
            ) : (<>
            {sweep && (
                <Notice tone="warning" style={{ marginBottom: 12 }}>
                    <b>Sweep:</b> sends every confirmed coin at your address to one destination, minus the network fee. Nothing comes back as change.
                    {!sweepTo && <div style={{ marginTop: 6 }}><Button variant="ghost" onClick={() => { setSweepMode(false); setConfirmText(''); }}>Back to a normal send</Button></div>}
                    <div style={{ display: 'flex', gap: 14, marginTop: 8, flexWrap: 'wrap', fontSize: 13 }}>
                        <label><input type="radio" checked={sweepKind === 'address'} onChange={() => setSweepKind('address')} disabled={Boolean(sweepTo)} /> to a Bitcoin address</label>
                        <label><input type="radio" checked={sweepKind === 'principal'} onChange={() => setSweepKind('principal')} disabled={Boolean(sweepTo)} /> to another principal's Sneed Wallet</label>
                    </div>
                </Notice>
            )}
            {sweep && sweepKind === 'principal' ? (<>
                <Label hint="the address is computed here, offline, the way the signer computes it">To (principal)</Label>
                <input value={principalText} onChange={(e) => setPrincipalText(e.target.value)} placeholder="aaaaa-…-cai" spellCheck={false} autoComplete="off" disabled={Boolean(sweepTo)}
                    style={{ ...inputStyle(c, principalText && !target?.ok), ...mono }} aria-label="Principal to sweep to" />
                {principalText && !target?.ok && <div style={{ color: c.error, fontSize: 12, marginTop: 4 }}>{target?.error}</div>}
                {target?.ok && <div style={{ color: c.mutedText, fontSize: 12, marginTop: 4, ...mono }}>Its Sneed Wallet address: {target.address}</div>}
            </>) : (<>
            <Label hint={cfg.testnet ? 'testnet4 addresses (tb1…, m…, n…, 2…)' : null}>To (Bitcoin address)</Label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input value={to} onChange={(e) => { setTo(e.target.value); setScanNote(null); }} placeholder={cfg.testnet ? 'tb1q…' : 'bc1q…'} spellCheck={false} autoComplete="off"
                    style={{ ...inputStyle(c, parsedTo && !parsedTo.ok), ...mono }} aria-label="Recipient Bitcoin address" />
                <QrScanButton target="btc" title="Scan a Bitcoin address QR code" onScan={(v, r) => { setTo(v); setScanNote(r.note || null); }} />
            </div>
            {parsedTo && !parsedTo.ok && <div style={{ color: c.error, fontSize: 12, marginTop: 4 }}>{parsedTo.error}</div>}
            {parsedTo?.ok && <div style={{ color: c.mutedText, fontSize: 12, marginTop: 4 }}>{btcAddressTypeLabel(parsedTo.type)}{ownAddress ? ' · your own address' : ''}</div>}
            {scanNote && <div style={{ color: c.mutedText, fontSize: 12, marginTop: 4 }}>{scanNote}</div>}
            </>)}
            </>)}

            {sweep ? (
                <div style={{ marginTop: 14, fontSize: 13, color: c.secondaryText }}>
                    Amount: <b style={{ color: c.primaryText }}>{plan?.ok ? <>{formatAmountShown(plan.amount, 8)} {cfg.symbol}</> : 'everything'}</b> after the network fee{plan?.ok ? ` (${plan.nInputs} coin${plan.nInputs === 1 ? '' : 's'})` : ''}.
                </div>
            ) : (
            <div style={{ marginTop: 14 }}>
                <Label hint={amount?.ok && !max ? `${amount.sats} sats` : move ? `at least ${String(depositMin(move.terms))} sats` : null}>Amount ({cfg.symbol})</Label>
                <div style={{ display: 'flex', gap: 8 }}>
                    <input value={max ? (plan?.ok ? satsToBtcText(plan.amount) : '') : amountText} onChange={(e) => { setMax(false); setAmountText(e.target.value); }} placeholder="0.001" inputMode="decimal" disabled={max}
                        style={inputStyle(c, !max && amountText && !amount?.ok)} aria-label="Amount" />
                    <Button variant={max ? 'primary' : 'ghost'} onClick={() => setMax(!max)} title={move ? 'Move everything spendable, minus the network fee (no change)' : 'Send everything spendable, minus the fee (no change)'}>Max</Button>
                </div>
                {!max && amountText && !amount?.ok && <div style={{ color: c.error, fontSize: 12, marginTop: 4 }}>{amount.error}</div>}
                {max && <div style={{ color: c.mutedText, fontSize: 12, marginTop: 4 }}>Sends every spendable coin{chosenList ? ' you chose' : ''}, minus the network fee. No change comes back.</div>}
            </div>
            )}

            <div style={{ marginTop: 14 }}>
                <Label>Network fee</Label>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{[...TIERS, 'custom'].map(tierBtn)}</div>
                {tier === 'custom' && (
                    <div style={{ marginTop: 8 }}>
                        <input value={customText} onChange={(e) => setCustomText(e.target.value)} placeholder="sat/vB, e.g. 3" inputMode="decimal"
                            style={{ ...inputStyle(c, customText && !custom?.ok), maxWidth: 200 }} aria-label="Custom fee rate in sat per vbyte" />
                        {customText && !custom?.ok && <div style={{ color: c.error, fontSize: 12, marginTop: 4 }}>{custom.error}</div>}
                        {custom?.ok && custom.warn && <div style={{ color: c.warning, fontSize: 12, marginTop: 4 }}>{custom.warn}</div>}
                    </div>
                )}
                <div style={{ fontSize: 12, color: c.mutedText, marginTop: 6, lineHeight: 1.5 }}>
                    {noLookup
                        ? 'Fee lookups are off: enter a rate from a source you trust.'
                        : fees.error
                            ? <>Couldn't get fee suggestions ({fees.error}). Enter your own rate.</>
                            : <>Fee suggestions come from <a href={cfg.testnet ? 'https://mempool.space/testnet4' : 'https://mempool.space'} target="_blank" rel="noopener noreferrer" style={{ color: c.accent }}>mempool.space</a>, a third-party service (we only ask it for current rates, never your address). You can always enter your own rate under Custom.</>}
                </div>
            </div>

            {guard && !guard.ok && <Notice tone="warning" style={{ marginTop: 12 }}>{guard.error}</Notice>}
            {plan && !plan.ok && <Notice tone={plan.code === 'insufficient' || plan.code === 'max_too_small' ? 'warning' : 'error'} style={{ marginTop: 12 }}>{plan.message}{plan.needed != null ? ` (needs ${plan.needed} sats, ${plan.available} spendable)` : ''}</Notice>}
            {plan?.ok && (
                <div style={{ marginTop: 14, padding: '10px 12px', borderRadius: 10, background: c.secondaryBg, border: `1px solid ${c.border}`, fontSize: 13, color: c.secondaryText, lineHeight: 1.6 }}>
                    Network fee ≈ <b style={{ color: c.primaryText }}>{String(plan.fee)} sats</b>{value(satsUsd(plan.fee))} · signing ≈ <b style={{ color: c.primaryText }}>{formatCycles(totalCycles)} cycles</b>{value(cycUsd(totalCycles))}
                    {plan.dustToFee > 0n && <div style={{ color: c.warning }}>≈ {String(plan.dustToFee)} sats added to the fee (leftover below 1,000 sats can't come back as change).</div>}
                    {guard?.ok && <div>You get about <b style={{ color: c.primaryText }}>{formatAmount(guard.receive, 8)} {ckSym}</b> after the minter's {String(move.terms.checkFee)} sats check fee.</div>}
                </div>
            )}

            <Advanced title="Advanced">
                <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, color: c.secondaryText }}>
                    <input type="checkbox" checked={noLookup} onChange={(e) => setNoLookup(e.target.checked)} />
                    Don't look up fees (enter my own). Remembered in this browser.
                </label>
                {!move && !sweep && (
                    <div>
                        <Button variant="ghost" onClick={() => { setSweepMode(true); setMax(false); setChosen(null); }}>Sweep: empty this address…</Button>
                        <div style={{ fontSize: 12, color: c.mutedText, marginTop: 4 }}>Every confirmed coin to one address, or to another principal's Sneed Wallet. Unlike Max, it also takes the tiny coins that cost about as much to spend as they are worth.</div>
                    </div>
                )}
                {sweep && (
                    <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, color: c.secondaryText }}>
                        <input type="checkbox" checked={dropUneconomic} onChange={(e) => setDropUneconomic(e.target.checked)} />
                        Leave out coins that cost more to spend than they are worth{plan?.uneconomic?.count ? ` (${plan.uneconomic.count} now, ${String(plan.uneconomic.sats)} sats)` : ''}.
                    </label>
                )}
                {!sweep && <div>
                    <div style={{ fontSize: 13, color: c.secondaryText, fontWeight: 600, marginBottom: 4 }}>Coin control {chosen ? <Pill tone="pending">manual</Pill> : <Pill>automatic</Pill>}</div>
                    <div style={{ fontSize: 12, color: c.mutedText, marginBottom: 6 }}>Automatic picks the largest coins first and as few as possible (each coin costs 37B cycles to sign). Coins reserved by pending sends and unconfirmed coins are not listed.</div>
                    {coins.map((u) => {
                        const k = outpointKey(u);
                        const on = chosen ? chosen.has(k) : false;
                        return (
                            <label key={k} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, borderTop: `1px solid ${c.border}`, padding: '4px 0', minWidth: 0 }}>
                                <input type="checkbox" checked={on} onChange={() => {
                                    const next = new Set(chosen || []);
                                    if (on) next.delete(k); else next.add(k);
                                    setChosen(next.size ? next : null);
                                }} />
                                <span style={{ ...mono, color: c.secondaryText, flex: 1, minWidth: 0 }}>{u.txid.slice(0, 10)}…:{u.vout}</span>
                                <span style={{ color: c.primaryText }}>{formatAmount(u.value, 8)} · {u.confirmations} conf</span>
                            </label>
                        );
                    })}
                    {!coins.length && <div style={{ fontSize: 12, color: c.mutedText }}>No spendable coins.</div>}
                </div>}
            </Advanced>

            <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap', alignItems: 'center' }}>
                <Button onClick={() => { setExtraOk(false); setError(null); setConfirmText(''); setStep('review'); }} disabled={!canReview}>Review</Button>
                {!btc.data && !btc.error && <span style={{ fontSize: 12, color: c.mutedText }}>Reading your coins…</span>}
                {btc.error && <span style={{ fontSize: 12, color: c.warning }}>Couldn't read Bitcoin: {btc.error}</span>}
            </div>
            <div style={{ fontSize: 11, color: c.mutedText, marginTop: 12, lineHeight: 1.5 }}>
                Signed by DFINITY's Chain Fusion Signer with the IC's threshold key for your principal. Bitcoin sends can't be reversed.
            </div>
        </Card>
    );
}
