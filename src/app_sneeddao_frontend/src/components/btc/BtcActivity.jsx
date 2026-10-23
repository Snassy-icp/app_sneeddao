// Native Bitcoin activity, v1 (spec/sneed_wallet.md §5.5, §5.6, §8): pending sends with their
// recovery actions, then sent and received lists, and the send log as JSON for support.
//   unknown (no answer from the signer): coins stay reserved; after 30 minutes unseen, offer to
//     send the identical transaction again (same txid, so a duplicate is harmless; it costs the
//     signing cycles again and says so). "Ask mempool.space" is an opt-in click.
//   broadcast, never mined after 14 days: offer "Mark as dropped", which frees the coins.
// Explorer links and lookups are opt-in clicks; nothing is sent to mempool.space on its own.
import React, { useMemo, useState } from 'react';
import { FaExternalLinkAlt, FaCopy } from 'react-icons/fa';
import { formatAmount } from '../../utils/StringUtils';
import { reconcile, updateRecord, canReissue } from '../../utils/btc/pending';
import { buildHistory, loadReceives, saveReceives, mergeReceives, receivesKey, ownTxids, checkTxOnMempool } from '../../utils/btc/history';
import { reissueSend } from '../../utils/btc/send';
import { sendCycles, formatCycles } from '../../utils/btc/credit';
import { outpointKey } from '../../utils/btc/utxos';
import { Card, Button, Notice, Advanced, Pill, useC } from '../convert/ConvertUi';

const mono = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', overflowWrap: 'anywhere' };
const STATE_TONE = { submitting: 'pending', broadcast: 'pending', unknown: 'warning', confirmed: 'success', failed: 'error', replaced: 'muted', dropped: 'muted' };
const STATE_TEXT = {
    submitting: 'sending', broadcast: 'waiting for a block', unknown: 'outcome unknown', confirmed: 'confirmed', failed: 'failed', replaced: 'replaced', dropped: 'dropped',
};
const json = (v) => JSON.stringify(v, null, 2);

function PendingItem({ w, r, utxoKeys }) {
    const c = useC();
    const { cfg } = w;
    const [busy, setBusy] = useState(false);
    const [ask, setAsk] = useState(null); // 'reissue' | 'drop'
    const [note, setNote] = useState(null);
    const [mempool, setMempool] = useState(null);
    const d = reconcile(r, { utxoKeys, now: Date.now(), mempool });
    const cost = sendCycles(r.request.inputs.length, r.request.outputs.length);
    const txid = r.txid || r.expectedTxid;

    const askMempool = async () => {
        setBusy(true);
        const m = await checkTxOnMempool(cfg.network, txid);
        setBusy(false);
        if (m.error) { setNote({ tone: 'warning', text: m.error }); return; }
        setMempool(m);
        const next = reconcile(r, { utxoKeys, now: Date.now(), mempool: m });
        if (next.state !== r.state) { w.store.mutate((rs) => updateRecord(rs, r.id, { state: next.state, ...(next.state === 'broadcast' ? { txid, broadcastAt: r.broadcastAt || Date.now() } : {}) }, { now: Date.now(), event: `-> ${next.state}`, detail: `mempool.space: ${next.reason}` })); w.loadRecords(); }
        setNote({ tone: m.seen ? 'success' : 'info', text: m.seen ? (m.confirmed ? 'mempool.space shows it confirmed.' : 'mempool.space has it in its mempool. Waiting for a block.') : 'mempool.space does not know this transaction.' });
    };
    const reissue = async () => {
        setBusy(true); setAsk(null); setNote(null);
        try {
            const pay = await w.ensureCredit([cost]);
            if (!pay.ok) { setNote({ tone: 'error', text: pay.shortfall ? `You need ${formatCycles(pay.shortfall)} more cycles of signing credit (Signing credit tab).` : pay.error }); return; }
            w.inFlight.current.add(r.id);
            const res = await reissueSend({ signer: w.actors.signer, store: w.store, record: r, utxoKeys });
            w.inFlight.current.delete(r.id);
            setNote({ tone: res.state === 'broadcast' ? 'success' : 'warning', text: res.state === 'broadcast' ? `Sent again; txid ${res.txid}.` : res.error });
        } finally { setBusy(false); w.loadRecords(); w.refreshBtc(); w.refreshCredit(); }
    };
    const drop = () => {
        setAsk(null);
        w.store.mutate((rs) => updateRecord(rs, r.id, { state: 'dropped' }, { now: Date.now(), event: '-> dropped', detail: 'marked by the user' }));
        w.loadRecords();
    };

    return (
        <div style={{ borderTop: `1px solid ${c.border}`, padding: '10px 0', display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ color: c.primaryText, fontWeight: 600 }}>{formatAmount(BigInt(r.amount), 8)} {cfg.symbol} <span style={{ color: c.mutedText, fontWeight: 400 }}>to</span> <span style={{ ...mono, fontWeight: 400 }}>{r.request.outputs[0]?.address}</span></span>
                <Pill tone={STATE_TONE[r.state]}>{STATE_TEXT[r.state]}</Pill>
            </div>
            <div style={{ fontSize: 12, color: c.mutedText }}>
                fee {r.fee} sats · {new Date(r.createdAt).toLocaleString()} · {r.request.inputs.length} coin{r.request.inputs.length === 1 ? '' : 's'} reserved{r.attempts > 1 ? ` · ${r.attempts} attempts` : ''}
            </div>
            <div style={{ fontSize: 12, ...mono }}>
                <a href={`${cfg.explorer}/tx/${txid}`} target="_blank" rel="noopener noreferrer" style={{ color: c.accent }}>{txid} <FaExternalLinkAlt size={9} /></a>
            </div>
            {r.state === 'unknown' && (
                <div style={{ fontSize: 12, color: c.secondaryText, lineHeight: 1.5 }}>
                    The signer gave no answer, so we don't know yet if this went out. Its coins stay reserved. When it is mined they disappear from your coins and this turns to confirmed.
                    {d.action === 'offer_reissue' ? ' It has not shown up for 30 minutes: you can send the identical transaction again. If the first one did go out, the second is the same transaction and changes nothing.' : ' If it hasn\'t shown up after 30 minutes you can send it again.'}
                </div>
            )}
            {r.error && r.state !== 'broadcast' && <div style={{ fontSize: 12, color: c.warning }}>{r.error}</div>}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <Button variant="ghost" onClick={askMempool} disabled={busy} title="Tells mempool.space this transaction id">Ask mempool.space</Button>
                {d.action === 'offer_reissue' && canReissue(r, utxoKeys) && (ask === 'reissue'
                    ? <><Button onClick={reissue} disabled={busy}>Send again for {formatCycles(cost)} cycles</Button><Button variant="ghost" onClick={() => setAsk(null)}>Cancel</Button></>
                    : <Button onClick={() => setAsk('reissue')} disabled={busy}>Send again…</Button>)}
                {d.action === 'offer_drop' && (ask === 'drop'
                    ? <><Button variant="danger" onClick={drop}>Yes, mark dropped</Button><Button variant="ghost" onClick={() => setAsk(null)}>Cancel</Button></>
                    : <Button variant="ghost" onClick={() => setAsk('drop')}>Mark as dropped…</Button>)}
            </div>
            {ask === 'drop' && <div style={{ fontSize: 12, color: c.secondaryText }}>Only if it is in no mempool any more: its coins become spendable again. If it still confirms later, a new send that used the same coins fails harmlessly.</div>}
            {note && <Notice tone={note.tone}>{note.text}</Notice>}
        </div>
    );
}

export default function BtcActivity({ w }) {
    const c = useC();
    const { cfg, btc, records } = w;
    const [copied, setCopied] = useState(false);
    const utxos = btc.data?.utxos || [];
    const utxoKeys = useMemo(() => new Set(utxos.map(outpointKey)), [utxos]);
    const recs = records.ok ? records.records : [];
    const receives = useMemo(() => {
        if (!w.meText || !btc.data) return [];
        const key = receivesKey(cfg.network, w.meText);
        const merged = mergeReceives(loadReceives(w.storage, key), utxos, ownTxids(recs));
        saveReceives(w.storage, key, merged);
        return merged;
    }, [w.meText, w.storage, btc.data, cfg.network, utxos, recs]);
    const h = buildHistory({ records: recs, receives, tipHeight: btc.data?.tipHeight ?? null, unspent: utxoKeys });
    const pending = h.sends.filter((s) => ['submitting', 'broadcast', 'unknown'].includes(s.state));
    const done = h.sends.filter((s) => !['submitting', 'broadcast', 'unknown'].includes(s.state));
    const copyLog = async () => {
        try { await navigator.clipboard.writeText(json({ network: cfg.network, principal: w.meText, address: w.address, records: recs })); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard blocked */ }
    };

    return (
        <Card>
            {!records.ok && <Notice tone="error">{records.error}</Notice>}
            <h3 style={{ fontSize: 15, margin: '0 0 6px', color: c.primaryText }}>Pending</h3>
            {!pending.length && <div style={{ fontSize: 13, color: c.mutedText }}>Nothing pending.</div>}
            {pending.map((s) => <PendingItem key={s.id} w={w} r={s.record} utxoKeys={utxoKeys} />)}

            <h3 style={{ fontSize: 15, margin: '18px 0 6px', color: c.primaryText }}>Sent</h3>
            {!done.length && <div style={{ fontSize: 13, color: c.mutedText }}>No sends from this device yet.</div>}
            {done.map((s) => (
                <div key={s.id} style={{ borderTop: `1px solid ${c.border}`, padding: '6px 0', fontSize: 13, display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', minWidth: 0 }}>
                    <span style={{ color: c.primaryText, minWidth: 0 }}>{formatAmount(s.amount, 8)} {cfg.symbol} <span style={{ color: c.mutedText }}>to</span> <span style={mono}>{s.to?.slice(0, 12)}…</span> <span style={{ color: c.mutedText }}>{new Date(s.at).toLocaleDateString()}</span></span>
                    <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
                        <Pill tone={STATE_TONE[s.state]}>{STATE_TEXT[s.state]}</Pill>
                        {s.state !== 'failed' && <a href={`${cfg.explorer}/tx/${s.txid}`} target="_blank" rel="noopener noreferrer" style={{ color: c.accent }} aria-label="Open on mempool.space"><FaExternalLinkAlt size={10} /></a>}
                    </span>
                    {s.state === 'failed' && s.record.error && <div style={{ width: '100%', fontSize: 12, color: c.mutedText }}>{s.record.error}</div>}
                </div>
            ))}

            <h3 style={{ fontSize: 15, margin: '18px 0 6px', color: c.primaryText }}>Received</h3>
            {!h.receives.length && <div style={{ fontSize: 13, color: c.mutedText }}>{btc.data ? 'Nothing received yet. Received coins show after their first confirmation.' : '…'}</div>}
            {h.receives.map((x) => (
                <div key={x.id} style={{ borderTop: `1px solid ${c.border}`, padding: '6px 0', fontSize: 13, display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ color: c.primaryText }}>{formatAmount(x.amount, 8)} {cfg.symbol} <span style={{ color: c.mutedText }}>block {x.height}{x.confirmations != null ? ` · ${x.confirmations} conf` : ''}{x.spent ? ' · spent' : ''}</span></span>
                    <a href={`${cfg.explorer}/tx/${x.txid}`} target="_blank" rel="noopener noreferrer" style={{ color: c.accent, ...mono, fontSize: 12 }}>{x.txid.slice(0, 10)}…:{x.vout} <FaExternalLinkAlt size={9} /></a>
                </div>
            ))}

            <Advanced title="Advanced: send log for support">
                <div style={{ fontSize: 12, color: c.mutedText }}>Every send this device made, with each step. Sends are kept in this browser only for now, so sends from another device are not listed here.</div>
                <div><Button variant="ghost" onClick={copyLog}><FaCopy size={11} /> {copied ? 'Copied' : 'Copy log (JSON)'}</Button></div>
            </Advanced>
        </Card>
    );
}
