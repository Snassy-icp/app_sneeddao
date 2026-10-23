// BTC <-> ckBTC on the /convert page. Deposit: the minter's BTC address for the user's account
// (with QR), then update_balance once Bitcoin has confirmed it. Withdraw: approve the minter on the
// ckBTC ledger, retrieve_btc_with_approval, and follow the request until it is confirmed.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FaSync, FaExternalLinkAlt } from 'react-icons/fa';
import ConfirmDialog from '../ConfirmDialog';
import { useDenomination } from '../../contexts/DenominationContext';
import { loadPrice, priceOf } from '../../utils/revenueData';
import { useStoreVersion } from '../../utils/revenueStore';
import { parseBtcAddress, btcAddressTypeLabel } from '../../utils/ckAddress';
import { maskIfPrivate } from '../../utils/privacyMode';
import QrScanButton from '../QrScanButton';
import {
    CKBTC, ckbtcInfo, ckbtcDepositAddress, ckbtcKnownUtxos, ckbtcCheckDeposit, ckbtcWithdraw, ckbtcWithdrawals,
    ckbtcMinter, ledgerInfo, planBtcWithdrawal, parseUnits, formatUnits, btcStatusText, btcTxidHex,
} from '../../utils/ckMinters';
import { Card, Label, Button, Notice, Advanced, CopyValue, QrCode, Pill, Row, Steps, inputStyle, useC } from './ConvertUi';

const btc = (sats) => formatUnits(sats ?? 0n, 8);
const mempoolTx = (txid) => `https://mempool.space/tx/${txid}`;
const ADDR_CACHE = 'sneed_ckbtc_deposit_address_v1';

function useUsd(ledger) {
    useStoreVersion();
    useEffect(() => { loadPrice(ledger).catch(() => {}); }, [ledger]);
    return priceOf(ledger);
}

function useMinterInfo(makeActor) {
    const [info, setInfo] = useState(null);
    const [error, setError] = useState('');
    useEffect(() => {
        let live = true;
        ckbtcInfo(makeActor).then((i) => live && setInfo(i)).catch((e) => live && setError(e.message));
        return () => { live = false; };
    }, [makeActor]);
    return { info, error };
}

function readCachedAddress(me) {
    try { return JSON.parse(localStorage.getItem(ADDR_CACHE) || '{}')[me] || null; } catch { return null; }
}
function writeCachedAddress(me, address) {
    try { const all = JSON.parse(localStorage.getItem(ADDR_CACHE) || '{}'); all[me] = address; localStorage.setItem(ADDR_CACHE, JSON.stringify(all)); } catch { /* storage blocked */ }
}

export function BtcDeposit({ makeActor, me, onMinted }) {
    const c = useC();
    const { info, error: infoError } = useMinterInfo(makeActor);
    const meText = me?.toText();
    const [address, setAddress] = useState(() => (meText ? readCachedAddress(meText) : null));
    const [addrError, setAddrError] = useState('');
    const [checking, setChecking] = useState(false);
    const [check, setCheck] = useState(null);
    const [utxos, setUtxos] = useState(null);

    useEffect(() => {
        if (!meText) { setAddress(null); return; }
        const cached = readCachedAddress(meText);
        setAddress(cached);
        if (cached) return;
        let live = true;
        setAddrError('');
        ckbtcDepositAddress(makeActor, me).then((a) => { if (live) { setAddress(a); writeCachedAddress(meText, a); } }).catch((e) => live && setAddrError(e.message));
        return () => { live = false; };
    }, [makeActor, me, meText]);

    const loadUtxos = useCallback(() => {
        if (!me) return;
        ckbtcKnownUtxos(makeActor, me).then(setUtxos).catch(() => setUtxos(null));
    }, [makeActor, me]);
    useEffect(() => { loadUtxos(); }, [loadUtxos]);

    const doCheck = async () => {
        setChecking(true); setCheck(null);
        try {
            const r = await ckbtcCheckDeposit(makeActor, me);
            setCheck(r);
            if (r.minted.length) { onMinted?.(); loadUtxos(); }
        } catch (e) { setCheck({ message: e.message, error: true, minted: [], pending: [] }); }
        finally { setChecking(false); }
    };

    const confs = info ? Number(info.min_confirmations) : null;
    return (
        <Card>
            <h3 style={{ margin: '0 0 4px', color: c.primaryText }}>Bitcoin → ckBTC</h3>
            <p style={{ margin: '0 0 14px', color: c.secondaryText, fontSize: 14, lineHeight: 1.55 }}>
                Send BTC from any Bitcoin wallet or exchange to your personal address below. Once Bitcoin has confirmed it, press <b>Check for deposit</b> and the minter turns it into the same amount of ckBTC in your wallet (minus a small check fee).
            </p>
            {infoError && <Notice tone="error">Could not reach the ckBTC minter: {infoError}</Notice>}
            {addrError && <Notice tone="error">Could not get your deposit address: {addrError}</Notice>}
            {!address && !addrError && <div style={{ color: c.mutedText, fontSize: 14 }}>Asking the minter for your address…</div>}
            {address && (
                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
                    <QrCode text={`bitcoin:${address}`} />
                    <div style={{ flex: '1 1 240px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <Label hint="Bitcoin mainnet only">Your BTC deposit address</Label>
                        <CopyValue value={address} label="BTC address" />
                        <div style={{ fontSize: 12, color: c.mutedText, lineHeight: 1.5 }}>This address is yours for good (derived from your principal); you can reuse it.</div>
                    </div>
                </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 14 }}>
                <Notice tone="warning">
                    Send <b>only BTC on the Bitcoin network</b> to this address. Other coins, or BTC on another chain (Lightning, BSC, Base, …), are lost.
                    {info?.deposit_btc_min_amount?.[0] != null && <> Deposits under {btc(info.deposit_btc_min_amount[0])} BTC are ignored.</>}
                </Notice>
                <Notice>
                    The minter waits for {confs ?? '…'} Bitcoin confirmations{confs ? ` (about ${confs * 10} minutes, sometimes longer)` : ''}. Then press the button; nothing happens automatically.
                    {info?.deposit_fee != null && <> A check fee of {btc(info.deposit_fee)} BTC is taken from each deposit.</>}
                </Notice>
            </div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginTop: 14 }}>
                <Button onClick={doCheck} disabled={!address || checking}><FaSync style={checking ? { animation: 'ckspin 1s linear infinite' } : undefined} /> {checking ? 'Checking…' : 'Check for deposit'}</Button>
            </div>
            {check && <Notice tone={check.error ? 'error' : check.minted.length ? 'success' : 'info'} style={{ marginTop: 12 }}>{check.message}</Notice>}
            {check?.pending?.length > 0 && (
                <div style={{ marginTop: 10, fontSize: 13, color: c.secondaryText }}>
                    {check.pending.map((p) => (
                        <div key={`${btcTxidHex(p.outpoint.txid)}:${p.outpoint.vout}`} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                            <span>{maskIfPrivate(btc(p.value))} BTC</span>
                            <span>{String(p.confirmations)} / {confs ?? '?'} confirmations</span>
                        </div>
                    ))}
                </div>
            )}
            <Advanced title="Advanced: deposits the minter knows">
                {utxos == null && <div style={{ fontSize: 13, color: c.mutedText }}>Loading…</div>}
                {utxos && utxos.length === 0 && <div style={{ fontSize: 13, color: c.mutedText }}>None yet. A deposit shows here after the minter has processed it.</div>}
                {utxos && utxos.map((u) => {
                    const txid = btcTxidHex(u.outpoint.txid);
                    return (
                        <div key={`${txid}:${u.outpoint.vout}`} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 13, flexWrap: 'wrap', color: c.primaryText }}>
                            <span>{maskIfPrivate(btc(u.value))} BTC · block {String(u.height)}</span>
                            <a href={mempoolTx(txid)} target="_blank" rel="noreferrer" style={{ color: c.accent }}>{txid.slice(0, 10)}…:{u.outpoint.vout} <FaExternalLinkAlt size={10} /></a>
                        </div>
                    );
                })}
                {info && <Row k="Minimum confirmations" v={String(info.min_confirmations)} />}
                <div style={{ fontSize: 12, color: c.mutedText }}>Minter {CKBTC.minter}. The address is computed by the minter from your principal and the default subaccount; calling update_balance mints for confirmed deposits.</div>
            </Advanced>
        </Card>
    );
}

export function BtcWithdraw({ makeActor, me, onDone }) {
    const c = useC();
    const { formatValue } = useDenomination();
    const usdPrice = useUsd(CKBTC.ledger);
    const { info } = useMinterInfo(makeActor);
    const [bal, setBal] = useState(null);
    const [amountText, setAmountText] = useState('');
    const [address, setAddress] = useState('');
    const [scanNote, setScanNote] = useState(null);
    const [fee, setFee] = useState(null);
    const [ack, setAck] = useState(false);
    const [confirm, setConfirm] = useState(false);
    const [step, setStep] = useState(null);
    const [result, setResult] = useState(null);
    const [error, setError] = useState('');
    const [history, setHistory] = useState(null);

    const loadBal = useCallback(() => {
        if (!me) return;
        ledgerInfo(makeActor, CKBTC.ledger, me).then(setBal).catch(() => {});
    }, [makeActor, me]);
    useEffect(() => { loadBal(); }, [loadBal]);

    const loadHistory = useCallback(() => {
        if (!me) return;
        ckbtcWithdrawals(makeActor, me).then(setHistory).catch(() => {});
    }, [makeActor, me]);
    useEffect(() => { loadHistory(); }, [loadHistory]);
    const anyPending = history?.some((h) => ['pending'].includes(btcStatusText(h.status).tone));
    useEffect(() => {
        if (!anyPending) return undefined;
        const t = setInterval(loadHistory, 30_000);
        return () => clearInterval(t);
    }, [anyPending, loadHistory]);

    const amount = parseUnits(amountText, 8);
    // fee estimate for the amount (debounced)
    useEffect(() => {
        const t = setTimeout(() => {
            ckbtcMinter(makeActor).estimate_withdrawal_fee({ amount: amount ? [amount] : [] }).then(setFee).catch(() => {});
        }, 400);
        return () => clearTimeout(t);
    }, [makeActor, amount]);

    const addr = useMemo(() => (address.trim() ? parseBtcAddress(address) : null), [address]);
    const plan = planBtcWithdrawal({ amount, balance: bal?.balance, ledgerFee: bal?.fee, minAmount: info?.retrieve_btc_min_amount, fee });
    const usd = (sats) => (usdPrice != null && sats != null ? formatValue((Number(sats) / 1e8) * usdPrice) : null);
    const canSubmit = !!me && plan.ok && addr?.ok && ack && !step;

    const run = async () => {
        setConfirm(false); setError(''); setResult(null);
        try {
            const r = await ckbtcWithdraw(makeActor, { address, amount, ledgerFee: bal?.fee, onStep: setStep });
            setResult(r); setAmountText(''); setAck(false);
            loadBal(); loadHistory(); onDone?.();
        } catch (e) { setError(e.message); }
        finally { setStep(null); }
    };

    return (
        <Card>
            <h3 style={{ margin: '0 0 4px', color: c.primaryText }}>ckBTC → Bitcoin</h3>
            <p style={{ margin: '0 0 14px', color: c.secondaryText, fontSize: 14, lineHeight: 1.55 }}>
                Burn ckBTC and receive real BTC at any Bitcoin address. The minter sends it in its next Bitcoin transaction; that usually takes under an hour, sometimes a few.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div>
                    <Label hint={bal ? `Balance ${maskIfPrivate(btc(bal.balance))} ckBTC` : null}>Amount (ckBTC)</Label>
                    <div style={{ display: 'flex', gap: 8 }}>
                        <input inputMode="decimal" placeholder="0.001" value={amountText} onChange={(e) => setAmountText(e.target.value)} style={inputStyle(c, amountText !== '' && amount == null)} aria-label="Amount in ckBTC" />
                        <Button variant="ghost" onClick={() => plan.max != null && setAmountText(formatUnits(plan.max, 8).replace(/,/g, ''))} disabled={!plan.max}>Max</Button>
                    </div>
                    {amount != null && usd(amount) && <div style={{ fontSize: 12, color: c.mutedText, marginTop: 4 }}>≈ {usd(amount)}</div>}
                </div>
                <div>
                    <Label hint={addr?.ok ? btcAddressTypeLabel(addr.type) : null}>Bitcoin address</Label>
                    <div style={{ display: 'flex', gap: 8 }}>
                        <input placeholder="bc1q…" value={address} onChange={(e) => { setAddress(e.target.value); setScanNote(null); }} spellCheck={false} autoCapitalize="none" autoCorrect="off" style={{ ...inputStyle(c, addr && !addr.ok), fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 14, flex: 1, minWidth: 0 }} aria-label="Bitcoin address" />
                        <QrScanButton target="btc" title="Scan a Bitcoin address QR code" onScan={(value, r) => { setAddress(value); setScanNote(r.note || null); }} />
                    </div>
                    {scanNote && <div style={{ fontSize: 12, color: c.warning, marginTop: 4 }}>{scanNote}</div>}
                    {addr && !addr.ok && <div style={{ color: c.error, fontSize: 12, marginTop: 4 }}>{addr.error}</div>}
                </div>
                {amount != null && amount > 0n && (
                    <div style={{ background: c.secondaryBg, border: `1px solid ${c.border}`, borderRadius: 12, padding: '8px 12px' }}>
                        <Row k="You burn" v={`${btc(amount)} ckBTC`} sub={usd(amount)} />
                        <Row k="Bitcoin network + minter fee (estimate)" v={plan.networkFee != null ? `${btc(plan.networkFee)} BTC` : '…'} sub={usd(plan.networkFee)} />
                        <Row k="You receive about" v={plan.receive != null ? `${btc(plan.receive)} BTC` : '…'} sub={usd(plan.receive)} strong />
                    </div>
                )}
                {plan.errors.length > 0 && amountText !== '' && plan.errors.map((e) => <div key={e} style={{ color: c.error, fontSize: 13 }}>{e}</div>)}
                <Notice tone="warning">
                    Bitcoin transactions cannot be reversed. Check the address character by character; BTC sent to a wrong address is gone.
                    {info && <> The minimum is {btc(info.retrieve_btc_min_amount)} BTC.</>}
                </Notice>
                <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 14, color: c.primaryText, cursor: 'pointer' }}>
                    <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} style={{ marginTop: 3 }} />
                    I checked the address, and I understand this cannot be undone.
                </label>
                <Button onClick={() => setConfirm(true)} disabled={!canSubmit}>Withdraw to Bitcoin</Button>
                {step && <Steps current={step} steps={[{ key: 'approve', label: 'Approve the minter on the ckBTC ledger' }, { key: 'withdraw', label: 'Ask the minter to send BTC' }]} />}
                {error && <Notice tone="error">{error}</Notice>}
                {result && <Notice tone="success">Withdrawal requested (burn #{String(result.blockIndex)}). It shows below; the BTC arrives once the minter's Bitcoin transaction is confirmed.</Notice>}
            </div>
            <Advanced title="Advanced: details">
                {bal && <Row k="ckBTC ledger fee (for the approval)" v={`${btc(bal.fee)} ckBTC`} />}
                {fee && <Row k="Bitcoin fee / minter fee" v={`${btc(fee.bitcoin_fee)} / ${btc(fee.minter_fee)} BTC`} />}
                {info && <Row k="Minimum withdrawal" v={`${btc(info.retrieve_btc_min_amount)} BTC`} />}
                <div style={{ fontSize: 12, color: c.mutedText, lineHeight: 1.55 }}>
                    Two calls: icrc2_approve on the ckBTC ledger ({CKBTC.ledger}) lets the minter ({CKBTC.minter}) take exactly this amount within an hour, then retrieve_btc_with_approval burns it and queues the Bitcoin payment. The fee is an estimate for the current Bitcoin network; the minter takes the actual fee from the amount.
                </div>
            </Advanced>
            <WithdrawalHistory history={history} onRefresh={loadHistory} />
            <ConfirmDialog isOpen={confirm} onClose={() => setConfirm(false)} onConfirm={run} type="warning" title="Withdraw to Bitcoin?"
                confirmText="Withdraw" confirmVariant="primary"
                message={<div style={{ textAlign: 'left', lineHeight: 1.6 }}>
                    <div>Burn <b>{btc(amount)} ckBTC</b> and send about <b>{plan.receive != null ? btc(plan.receive) : '…'} BTC</b> to</div>
                    <code style={{ wordBreak: 'break-all', display: 'block', margin: '6px 0' }}>{address.trim()}</code>
                    <div>This cannot be reversed.</div>
                </div>} />
        </Card>
    );
}

function WithdrawalHistory({ history, onRefresh }) {
    const c = useC();
    if (!history) return null;
    return (
        <div style={{ marginTop: 18 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: c.secondaryText }}>Your BTC withdrawals</span>
                <Button variant="ghost" onClick={onRefresh} style={{ padding: '4px 10px', fontSize: 12 }}><FaSync size={10} /> Refresh</Button>
            </div>
            {history.length === 0 && <div style={{ fontSize: 13, color: c.mutedText }}>None yet.</div>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {history.slice(0, 20).map((h) => {
                    const s = btcStatusText(h.status);
                    return (
                        <div key={String(h.blockIndex)} style={{ border: `1px solid ${c.border}`, borderRadius: 10, padding: '8px 10px', fontSize: 13, color: c.primaryText }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                                <span>Burn #{String(h.blockIndex)}</span>
                                <Pill tone={s.tone}>{s.label}</Pill>
                            </div>
                            <div style={{ color: c.mutedText, fontSize: 12, marginTop: 4 }}>{s.detail}</div>
                            {s.txid && <a href={mempoolTx(s.txid)} target="_blank" rel="noreferrer" style={{ color: c.accent, fontSize: 12, wordBreak: 'break-all' }}>{s.txid} <FaExternalLinkAlt size={9} /></a>}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
