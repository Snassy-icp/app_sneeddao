// Native Bitcoin <-> ckBTC moves on btc.html (spec/sneed_wallet.md §6, phase A3). Custody-relevant.
//
// Both directions live on btc.html, the page without analytics:
//   - Bitcoin -> ckBTC signs a Bitcoin transaction, so it must (§4);
//   - ckBTC -> Bitcoin signs nothing on Bitcoin, but it chooses where the minter pays out (the
//     user's own address, derived on this page) and its record, tracking and "Check / finish" sit
//     in the same Moves list as the other direction. One page, one list, one set of rules.
// Casual: pick a direction, an amount (or Max), Review, Move. Advanced: fees, minter and ledger
// ids, the exact calls, block indexes. Amounts being signed are shown even in privacy mode
// (formatAmountShown); balances are masked (formatAmount). No browser popups.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FaArrowLeft, FaExchangeAlt, FaSync } from 'react-icons/fa';
import { useDenomination } from '../../contexts/DenominationContext';
import { formatAmount, formatAmountShown } from '../../utils/StringUtils';
import { parseBtcAddress } from '../../utils/ckAddress';
import { ckbtcInfo, ckbtcDepositAddress, ckbtcMinter, ledgerInfo, parseUnits, formatUnits } from '../../utils/ckMinters';
import { minterTerms, planMoveToBtc, newWithdrawRecord, executeWithdraw } from '../../utils/btc/moves';
import { isAddressVerified, verifySignerAddress } from '../../utils/btc/send';
import { ADDRESS_CYCLES, formatCycles } from '../../utils/btc/credit';
import { newId } from '../../utils/btc/pending';
import { Card, Label, inputStyle, Button, Notice, Advanced, Row, Steps, useC } from '../convert/ConvertUi';
import { BtcNetworkBadge } from './TestnetBadge';
import BtcSend from './BtcSend';

const mono = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', overflowWrap: 'anywhere' };
const nowNs = () => BigInt(Date.now()) * 1_000_000n;

/// The minter's terms for this network's pair (get_minter_info + get_deposit_fee, free queries).
function useTerms(w) {
    const [state, setState] = useState({ terms: null, error: null });
    const load = useCallback(() => {
        if (!w.makeActor || !w.ck) return;
        setState({ terms: null, error: null });
        ckbtcInfo(w.makeActor, w.ck.minter).then((i) => setState({ terms: minterTerms(i), error: null }))
            .catch((e) => setState({ terms: null, error: String(e?.message || e).split('\n')[0] }));
    }, [w.makeActor, w.ck]);
    useEffect(() => { load(); }, [load]);
    return { ...state, reload: load };
}

function MoveToCk({ w, onGoCredit, onGoActivity }) {
    const c = useC();
    const { terms, error: termsError, reload } = useTerms(w);
    const [dep, setDep] = useState({ address: null, error: null });
    const loadAddress = useCallback(() => {
        if (!w.makeActor || !w.ck || !w.me) return;
        setDep({ address: null, error: null });
        // the minter's deposit address for the user's Main account (an update call, no cost to the user)
        ckbtcDepositAddress(w.makeActor, w.me, null, w.ck.minter).then((a) => {
            const p = parseBtcAddress(a, w.cfg.network);
            if (!p.ok) setDep({ address: null, error: `The minter answered with an address this page can't use (${p.error}). Nothing was sent.` });
            else setDep({ address: a, error: null });
        }).catch((e) => setDep({ address: null, error: String(e?.message || e).split('\n')[0] }));
    }, [w.makeActor, w.ck, w.me, w.cfg.network]);
    useEffect(() => { loadAddress(); }, [loadAddress]);

    if (termsError || dep.error) {
        return (
            <Card>
                <Notice tone="error">Couldn't reach the {w.ck.symbol} minter: {termsError || dep.error}</Notice>
                <div style={{ marginTop: 10 }}><Button variant="ghost" onClick={() => { reload(); loadAddress(); }}><FaSync size={11} /> Try again</Button></div>
            </Card>
        );
    }
    if (!terms || !dep.address) return <Card><div style={{ fontSize: 13, color: c.mutedText }}>Asking the {w.ck.symbol} minter for your deposit address and its terms…</div></Card>;
    return <BtcSend w={w} move={{ pair: w.ck, terms, depositAddress: dep.address, owner: w.meText }} onGoCredit={onGoCredit} onGoActivity={onGoActivity} />;
}

function MoveToBtc({ w, mv, onGoCredit, onGoActivity }) {
    const c = useC();
    const { formatValue } = useDenomination();
    const { ck, cfg, makeActor, me, address, market } = w;
    const { terms, error: termsError } = useTerms(w);
    const [bal, setBal] = useState(null);
    const [balError, setBalError] = useState(null);
    const [amountText, setAmountText] = useState('');
    const [max, setMax] = useState(false);
    const [fee, setFee] = useState(null);
    const [step, setStep] = useState('edit'); // edit | review | sending | done
    const [progress, setProgress] = useState(null);
    const [result, setResult] = useState(null);
    const [error, setError] = useState(null);

    const loadBal = useCallback(() => {
        if (!makeActor || !me) return;
        ledgerInfo(makeActor, ck.ledger, me).then((b) => { setBal({ balance: BigInt(b.balance), fee: BigInt(b.fee) }); setBalError(null); })
            .catch((e) => setBalError(String(e?.message || e).split('\n')[0]));
    }, [makeActor, me, ck.ledger]);
    useEffect(() => { loadBal(); }, [loadBal]);

    const maxAmount = bal ? (bal.balance > bal.fee ? bal.balance - bal.fee : 0n) : null;
    const amount = max ? maxAmount : parseUnits(amountText, 8);
    // the minter's fee estimate for this amount (a free query, debounced)
    useEffect(() => {
        if (!makeActor) return undefined;
        const t = setTimeout(() => {
            ckbtcMinter(makeActor, ck.minter).estimate_withdrawal_fee({ amount: amount ? [amount] : [] }).then(setFee).catch(() => {});
        }, 400);
        return () => clearTimeout(t);
    }, [makeActor, ck.minter, amount]);

    const plan = planMoveToBtc({ amount, balance: bal?.balance, ledgerFee: bal?.fee, minAmount: terms?.retrieveMin, fee });
    const verified = isAddressVerified(w.storage, cfg.network, w.meText, address);
    const satsUsd = (x) => (cfg.testnet || !market.btcUsd || x == null ? null : (Number(x) / 1e8) * market.btcUsd);
    const value = (usd) => (usd != null ? <span style={{ color: c.mutedText }}> · {formatValue(usd)}</span> : null);
    const shown = (x, sym) => <>{formatAmountShown(x ?? 0n, 8)} {sym}</>;
    const storeOk = Boolean(w.movesStore);
    // review only with the minter's terms, the balance and a fee estimate in hand
    const ready = plan.ok && Boolean(bal && terms && fee);

    const run = async () => {
        setError(null); setStep('sending');
        try {
            // the payout goes to the address this page derives: check it with the signer once per device
            if (!verified) {
                setProgress('verify');
                const pay = await w.ensureCredit([ADDRESS_CYCLES]);
                if (!pay.ok) {
                    if (pay.shortfall) { setStep('review'); setError({ text: `Checking your address with the signer needs ${formatCycles(pay.shortfall)} more cycles of signing credit (once per device). Nothing was moved.`, topUp: pay.shortfall }); return; }
                    throw new Error(pay.error);
                }
                const v = await verifySignerAddress({ signer: w.actors.signer, network: cfg.network, expected: address, storage: w.storage, principal: w.meText });
                if (!v.ok) throw new Error(v.error);
            }
            const fresh = await ledgerInfo(makeActor, ck.ledger, me);
            const p2 = planMoveToBtc({ amount, balance: fresh.balance, ledgerFee: fresh.fee, minAmount: terms?.retrieveMin, fee });
            if (!p2.ok) throw new Error(`${p2.errors.join(' ')} Nothing was moved.`);
            const record = newWithdrawRecord({ id: newId(), network: cfg.network, pair: ck, plan: p2, amount, ledgerFee: BigInt(fresh.fee), address, owner: w.meText, now: Date.now() });
            const r = await executeWithdraw({ makeActor, store: w.movesStore, record, nowNs: nowNs(), onStep: setProgress });
            setResult({ ...r, record });
            setStep('done');
            mv.loadMoves();
            loadBal();
        } catch (e) {
            setError({ text: String(e?.message || e) });
            setStep('review');
        } finally {
            setProgress(null);
        }
    };
    const reset = () => { setStep('edit'); setResult(null); setError(null); setAmountText(''); setMax(false); };

    if (termsError || balError) return <Card><Notice tone="error">Couldn't reach the {ck.symbol} {termsError ? 'minter' : 'ledger'}: {termsError || balError}</Notice></Card>;

    if (step === 'done' && result) {
        return (
            <Card>
                {result.state === 'requested' && (
                    <Notice tone="success">
                        <b>Requested.</b> The minter burned {formatAmountShown(BigInt(result.record.amount), 8)} {ck.symbol} (block {String(result.blockIndex)}) and pays it out to your Bitcoin address in its next Bitcoin transaction, minus the fees. That usually takes under an hour, sometimes a few. Track it under Activity → Moves.
                    </Notice>
                )}
                {result.state !== 'requested' && <Notice tone={result.state === 'unknown' ? 'warning' : 'error'}>{result.error}</Notice>}
                <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
                    <Button variant="ghost" onClick={reset}>New move</Button>
                    <Button variant="ghost" onClick={onGoActivity}>Activity</Button>
                </div>
            </Card>
        );
    }

    if ((step === 'review' || step === 'sending') && ready) {
        const sending = step === 'sending';
        return (
            <Card>
                <button type="button" onClick={() => { setStep('edit'); setError(null); }} disabled={sending}
                    style={{ background: 'none', border: 'none', color: c.secondaryText, cursor: 'pointer', padding: 0, fontSize: 13, display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                    <FaArrowLeft size={11} /> Edit
                </button>
                <h2 style={{ fontSize: 18, margin: '10px 0', color: c.primaryText, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>Review the move to your Bitcoin address <BtcNetworkBadge cfg={cfg} /></h2>
                <div style={{ fontSize: 13, color: c.mutedText }}>To your own {cfg.label} address</div>
                <div style={{ ...mono, fontSize: 14, color: c.primaryText, marginBottom: 8 }}>{address}</div>
                <Row k="Burns" v={<>{shown(amount, ck.symbol)}{value(satsUsd(amount))}</>} sub={`plus the ${String(bal.fee)} sats ledger fee for the approval`} />
                <Row k="Bitcoin network + minter fee" v={plan.networkFee != null ? <>{shown(plan.networkFee, 'BTC')}{value(satsUsd(plan.networkFee))}</> : '…'} sub="the minter's estimate now; it takes the actual fee from the amount" />
                <Row k="You get about" v={plan.receive != null ? <>{shown(plan.receive, cfg.symbol)}{value(satsUsd(plan.receive))}</> : '…'} strong sub="usually within an hour, sometimes a few" />
                {!verified && <Row k="One-time address check" v={`${formatCycles(ADDRESS_CYCLES)} cycles`} sub="the signer confirms your address once per device before the first payout to it (signing credit)" />}
                <Advanced title="Advanced: the exact calls">
                    <div style={{ fontSize: 12, color: c.mutedText, lineHeight: 1.6 }}>
                        1. icrc2_approve on the {ck.symbol} ledger {ck.ledger}: spender {ck.minter}, amount {String(plan.approveAmount)} (the amount plus one ledger fee of headroom; anything unused lapses), expires in 1 hour.<br />
                        2. retrieve_btc_with_approval {'{'} address = {address}, amount = {String(amount)}, from_subaccount = none {'}'} on the minter.<br />
                        Minimum {String(terms?.retrieveMin ?? '…')} sats{fee ? ` · Bitcoin fee ${String(fee.bitcoin_fee)} + minter fee ${String(fee.minter_fee)} sats` : ''}.
                    </div>
                </Advanced>
                {error && (
                    <Notice tone="error" style={{ marginTop: 10 }}>
                        {error.text}
                        {error.topUp && <div style={{ marginTop: 8 }}><Button onClick={() => onGoCredit(error.topUp)}>Top up signing credit</Button></div>}
                    </Notice>
                )}
                {sending && progress && (
                    <div style={{ marginTop: 10 }}>
                        <Steps current={progress} steps={[
                            ...(!verified ? [{ key: 'verify', label: 'Check your address with the signer (once)' }] : []),
                            { key: 'approve', label: `Approve the minter on the ${ck.symbol} ledger` },
                            { key: 'withdraw', label: 'Ask the minter to pay out to your address' },
                        ]} />
                    </div>
                )}
                <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
                    <Button onClick={run} disabled={sending || !storeOk}>
                        <FaExchangeAlt size={12} /> {sending ? 'Moving…' : `Move ${formatAmountShown(amount, 8)} ${ck.symbol} to my Bitcoin address`}
                    </Button>
                </div>
            </Card>
        );
    }

    return (
        <Card>
            <div style={{ fontSize: 13, color: c.secondaryText, lineHeight: 1.55, marginBottom: 12 }}>
                Burns {ck.symbol} from your wallet's Main account; the minter pays the same amount in bitcoin to <b>your own Bitcoin address</b>, minus the Bitcoin network fee and its fee. No signing credit needed{verified ? '' : ' (except a one-time address check on this device)'}.
            </div>
            <div style={{ fontSize: 13, color: c.mutedText, marginBottom: 12 }}>
                Available: <b style={{ color: c.primaryText }}>{bal ? <>{formatAmount(bal.balance, 8)} {ck.symbol}</> : '…'}</b>
                <button type="button" onClick={loadBal} title="Refresh" style={{ marginLeft: 8, background: 'none', border: 'none', color: c.accent, cursor: 'pointer' }}><FaSync size={11} /></button>
            </div>
            <Label hint={amount != null && amount > 0n && !max ? `${String(amount)} sats` : terms ? `at least ${String(terms.retrieveMin)} sats` : null}>Amount ({ck.symbol})</Label>
            <div style={{ display: 'flex', gap: 8 }}>
                <input value={max ? (maxAmount != null ? formatUnits(maxAmount, 8).replace(/,/g, '') : '') : amountText} onChange={(e) => { setMax(false); setAmountText(e.target.value); }}
                    placeholder="0.001" inputMode="decimal" disabled={max} style={inputStyle(c, !max && amountText !== '' && amount == null)} aria-label={`Amount in ${ck.symbol}`} />
                <Button variant={max ? 'primary' : 'ghost'} onClick={() => setMax(!max)} disabled={!maxAmount} title={`Everything, minus the ${ck.symbol} ledger fee for the approval`}>Max</Button>
            </div>
            {amountText !== '' && !max && amount == null && <div style={{ color: c.error, fontSize: 12, marginTop: 4 }}>Enter an amount like 0.001 (at most 8 decimals).</div>}
            {amount != null && amount > 0n && (
                <div style={{ marginTop: 12, padding: '8px 12px', borderRadius: 10, background: c.secondaryBg, border: `1px solid ${c.border}` }}>
                    <Row k="Bitcoin network + minter fee (estimate)" v={plan.networkFee != null ? <>{formatAmount(plan.networkFee, 8)} BTC{value(satsUsd(plan.networkFee))}</> : '…'} />
                    <Row k="You get about" v={plan.receive != null ? <>{formatAmount(plan.receive, 8)} {cfg.symbol}{value(satsUsd(plan.receive))}</> : '…'} strong />
                </div>
            )}
            {amount != null && amount > 0n && plan.errors.map((e) => <div key={e} style={{ color: c.error, fontSize: 13, marginTop: 6 }}>{e}</div>)}
            {!storeOk && <Notice tone="error" style={{ marginTop: 10 }}>This browser can't save the move's record, so moves are paused. Allow site storage for this page.</Notice>}
            <Advanced title="Advanced">
                {terms && <Row k="Minimum" v={`${formatUnits(terms.retrieveMin, 8)} ${ck.symbol}`} />}
                {bal && <Row k={`${ck.symbol} ledger fee (approval)`} v={`${String(bal.fee)} sats`} />}
                {fee && <Row k="Bitcoin fee / minter fee" v={`${String(fee.bitcoin_fee)} / ${String(fee.minter_fee)} sats`} />}
                <div style={{ fontSize: 12, color: c.mutedText, lineHeight: 1.55 }}>Minter {ck.minter} · ledger {ck.ledger}. Payout address {address} (derived here from your principal{verified ? ', checked with the signer on this device' : ''}).</div>
            </Advanced>
            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                <Button onClick={() => { setError(null); setStep('review'); }} disabled={!ready || !storeOk || !address}>Review</Button>
            </div>
        </Card>
    );
}

const DIRS = ['tock', 'tobtc'];

/// The Move tab. `dir`: 'tock' (native → ck) or 'tobtc' (ck → native).
export default function BtcMove({ w, mv, dir, onDir, onGoCredit, onGoActivity }) {
    const c = useC();
    const labels = useMemo(() => ({ tock: `Bitcoin → ${w.ck?.symbol}`, tobtc: `${w.ck?.symbol} → Bitcoin` }), [w.ck]);
    if (!w.ck) return <Card><Notice>Moves between Bitcoin and ckBTC aren't available on this network.</Notice></Card>;
    return (
        <div>
            <div role="tablist" style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
                {DIRS.map((k) => (
                    <button key={k} type="button" role="tab" aria-selected={dir === k} onClick={() => onDir(k)}
                        style={{ padding: '6px 12px', borderRadius: 999, border: `1px solid ${dir === k ? c.accent : c.border}`, background: dir === k ? `${c.accent}22` : 'transparent', color: c.primaryText, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
                        {labels[k]}
                    </button>
                ))}
            </div>
            {dir === 'tobtc'
                ? <MoveToBtc w={w} mv={mv} onGoCredit={onGoCredit} onGoActivity={onGoActivity} />
                : <MoveToCk w={w} onGoCredit={onGoCredit} onGoActivity={onGoActivity} />}
        </div>
    );
}
