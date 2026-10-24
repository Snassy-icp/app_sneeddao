// Native Bitcoin activity, v1 (spec/sneed_wallet.md §5.5, §5.6, §8): pending sends with their
// recovery actions, then sent and received lists, and the send log as JSON for support.
//   unknown (no answer from the signer): coins stay reserved; after 30 minutes unseen, offer to
//     send the identical transaction again (same txid, so a duplicate is harmless; it costs the
//     signing cycles again and says so). "Ask mempool.space" is an opt-in click.
//   broadcast, never mined after 14 days: offer "Mark as dropped", which frees the coins.
// Explorer links and lookups are opt-in clicks; nothing is sent to mempool.space on its own.
// Moves (phase A3): each move to ckBTC (its send record + conversion state, with "Check / finish")
// and each move to the Bitcoin address (its own record, tracked with the minter), newest first.
// Phase A4: "Speed up" on a pending send that waited SPEEDUP_AFTER_BLOCKS (BtcSpeedUp: RBF or
// CPFP; Advanced offers it earlier); a replaced send is listed inside its faster version until one
// of them is mined; the support log shows every record's steps; opt-in explorer history.
import React, { useEffect, useMemo, useState } from 'react';
import { FaExternalLinkAlt, FaCopy, FaSync, FaBolt } from 'react-icons/fa';
import { formatAmount } from '../../utils/StringUtils';
import { reconcile, reconcileAll, updateRecord, canReissue, groupMembers, markMined, recordTxid, minedVersionNote, LOCKING_STATES } from '../../utils/btc/pending';
import { speedUpStatus } from '../../utils/btc/speedup';
import BtcSpeedUp from './BtcSpeedUp';
import {
    buildHistory, loadReceives, saveReceives, mergeReceives, receivesKey, ownTxids, checkTxOnMempool,
    explorerHistoryAllowed, setExplorerHistoryAllowed, fetchExplorerHistory,
} from '../../utils/btc/history';
import { reissueSend } from '../../utils/btc/send';
import { sendCycles, formatCycles } from '../../utils/btc/credit';
import { outpointKey } from '../../utils/btc/utxos';
import { movePhase, depositEta, MOVE_FINAL, WITHDRAW_FINAL, patchRecord } from '../../utils/btc/moves';
import { ckbtcWithdrawals, btcStatusText } from '../../utils/ckMinters';
import { Card, Button, Notice, Advanced, Pill, useC } from '../convert/ConvertUi';

const mono = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', overflowWrap: 'anywhere' };
const STATE_TONE = { submitting: 'pending', broadcast: 'pending', unknown: 'warning', confirmed: 'success', failed: 'error', replaced: 'muted', dropped: 'muted' };
const STATE_TEXT = {
    submitting: 'sending', broadcast: 'waiting for a block', unknown: 'outcome unknown', confirmed: 'confirmed', failed: 'failed', replaced: 'replaced', dropped: 'dropped',
};
const json = (v) => JSON.stringify(v, null, 2);
const short = (t) => (t ? `${t.slice(0, 10)}…` : '');

function PendingItem({ w, r, utxoKeys, records, older = [] }) {
    const c = useC();
    const { cfg } = w;
    const [busy, setBusy] = useState(false);
    const [ask, setAsk] = useState(null); // 'reissue' | 'drop'
    const [note, setNote] = useState(null);
    const [mempool, setMempool] = useState(null);
    const [speedUp, setSpeedUp] = useState(false);
    const d = reconcile(r, { utxoKeys, now: Date.now(), mempool, records });
    const cost = sendCycles(r.request.inputs.length, r.request.outputs.length);
    const txid = r.txid || r.expectedTxid;
    const su = speedUpStatus(r, { records, tipHeight: w.tipHeight, now: Date.now(), tiers: w.fees.data?.ok ? w.fees.data.tiers : null });

    const askMempool = async () => {
        setBusy(true);
        // an RBF group: ask about every version; the confirmed one settles the group
        const members = groupMembers(records, r);
        if (members.length > 1) {
            let winner = null; let seen = false; let err = null;
            for (const m of members) {
                const q = await checkTxOnMempool(cfg.network, recordTxid(m)); // eslint-disable-line no-await-in-loop
                if (q.error) err = q.error;
                if (q.seen) seen = true;
                if (q.confirmed) { winner = recordTxid(m); break; }
            }
            setBusy(false);
            if (winner) {
                w.store.mutate((rs) => reconcileAll(markMined(rs, winner, { now: Date.now(), via: 'mempool.space (asked by the user)' }), { utxoKeys, now: Date.now(), inFlight: w.inFlight.current }).records);
                w.loadRecords();
                setNote({ tone: 'success', text: `mempool.space shows ${short(winner)} confirmed.` });
            } else setNote({ tone: err && !seen ? 'warning' : 'info', text: err && !seen ? err : seen ? 'mempool.space has a version in its mempool; none is confirmed yet.' : 'mempool.space knows none of the versions.' });
            return;
        }
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
                {r.kind === 'cpfp'
                    ? <span style={{ color: c.primaryText, fontWeight: 600 }}><span style={{ color: c.mutedText, fontWeight: 400 }}>Speed-up (CPFP) for </span><span style={{ ...mono, fontWeight: 400 }}>{short(r.parentTxid)}</span>: {formatAmount(BigInt(r.amount), 8)} {cfg.symbol} back to you</span>
                    : <span style={{ color: c.primaryText, fontWeight: 600 }}>{r.kind === 'toCkbtc' && <span style={{ color: c.mutedText, fontWeight: 400 }}>Move to {r.ckbtc?.symbol}: </span>}{r.kind === 'sweep' && <span style={{ color: c.mutedText, fontWeight: 400 }}>Sweep: </span>}{formatAmount(BigInt(r.amount), 8)} {cfg.symbol} <span style={{ color: c.mutedText, fontWeight: 400 }}>to</span> <span style={{ ...mono, fontWeight: 400 }}>{r.request.outputs[0]?.address}</span></span>}
                <Pill tone={STATE_TONE[r.state]}>{r.replaces ? `faster version · ${STATE_TEXT[r.state]}` : STATE_TEXT[r.state]}</Pill>
            </div>
            {older.length > 0 && (
                <div style={{ fontSize: 12, color: c.secondaryText, lineHeight: 1.5 }}>
                    Replaces {older.map((o) => <span key={o.id} style={mono}>{short(recordTxid(o))} (fee {o.fee} sats{o.state === 'unknown' ? ', outcome unknown' : ''}) </span>)}. Both stay listed until one is mined; whichever confirms counts. The coins can only be spent once.
                </div>
            )}
            {d.action === 'identify' && <div style={{ fontSize: 12, color: c.secondaryText }}>Its coins were spent, so one version was mined. Finding out which (from the recipient's coins on the IC; or ask mempool.space below).</div>}
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
            {su.can && su.offer && !speedUp && <div style={{ fontSize: 12, color: c.warning }}>Not mined yet: {su.reason}. You can pay a higher fee to speed it up.</div>}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {su.can && su.offer && !speedUp && <Button onClick={() => setSpeedUp(true)} disabled={busy}><FaBolt size={10} /> Speed up…</Button>}
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
            {speedUp && <BtcSpeedUp w={w} r={r} onClose={() => setSpeedUp(false)} />}
            {su.can && !su.offer && !speedUp && (
                <Advanced title="Advanced: speed up now">
                    <div style={{ fontSize: 12, color: c.mutedText }}>Usually worth it only after {su.waited === 0 ? 'a couple of blocks' : 'another block'} without a confirmation ({su.reason} so far).</div>
                    <div><Button variant="ghost" onClick={() => setSpeedUp(true)}><FaBolt size={10} /> Speed up…</Button></div>
                </Advanced>
            )}
            {!su.can && r.state === 'broadcast' && su.why && r.kind !== 'cpfp' && !r.supersededBy && <div style={{ fontSize: 11, color: c.mutedText }}>{su.why}</div>}
        </div>
    );
}

/// Every record with its steps, for support (spec §8 "Help → BTC send log").
function SendLog({ records }) {
    const c = useC();
    if (!records.length) return <div style={{ fontSize: 12, color: c.mutedText }}>No records yet.</div>;
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {records.slice().sort((a, b) => b.createdAt - a.createdAt).map((r) => (
                <div key={r.id} style={{ fontSize: 11, borderTop: `1px solid ${c.border}`, paddingTop: 6, minWidth: 0 }}>
                    <div style={{ color: c.primaryText, ...mono }}>{r.kind || 'send'} · {r.state} · {r.id} · {recordTxid(r)}</div>
                    {(r.replaces || r.supersededBy || r.parent || r.cpfpBy || r.replacedBy) && (
                        <div style={{ color: c.mutedText, ...mono }}>
                            {r.replaces && `replaces ${r.replaces} `}{r.supersededBy && `superseded by ${r.supersededBy} `}{r.parent && `child of ${r.parent} `}{r.cpfpBy && `cpfp ${r.cpfpBy} `}{r.replacedBy && `replaced by tx ${r.replacedBy}`}
                        </div>
                    )}
                    {(r.log || []).map((e, i) => (
                        <div key={i} style={{ color: c.secondaryText, ...mono }}>{new Date(e.at).toLocaleString()} · {e.event}{e.detail ? ` · ${e.detail}` : ''}</div>
                    ))}
                </div>
            ))}
        </div>
    );
}

/// Full history from mempool.space (opt-in: it tells mempool.space which address is looked up).
function ExplorerHistory({ w }) {
    const c = useC();
    const { cfg } = w;
    const [allowed, setAllowed] = useState(() => explorerHistoryAllowed(w.storage));
    const [state, setState] = useState({ loading: false, txs: [], error: null, more: false, last: null });
    const load = async (after = null) => {
        setState((s) => ({ ...s, loading: true, error: null }));
        const r = await fetchExplorerHistory(cfg.network, w.address, { afterTxid: after });
        setState((s) => (r.ok ? { loading: false, error: null, txs: after ? [...s.txs, ...r.txs] : r.txs, more: r.more, last: r.last } : { ...s, loading: false, error: r.error }));
    };
    useEffect(() => { if (allowed) load(); }, [allowed]); // eslint-disable-line react-hooks/exhaustive-deps
    if (!allowed) {
        return (
            <div style={{ fontSize: 12, color: c.mutedText, lineHeight: 1.5 }}>
                The lists above show what this device did and the coins the IC sees. The full history of your address (also sends from elsewhere, and unconfirmed incoming) can come from mempool.space, a third-party explorer: it then learns which address you look up, from your IP. Asked once; remembered in this browser.
                <div style={{ marginTop: 6 }}><Button variant="ghost" onClick={() => { setExplorerHistoryAllowed(true, w.storage); setAllowed(true); }}>Yes, look up my address on mempool.space</Button></div>
            </div>
        );
    }
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ fontSize: 12, color: c.mutedText }}>From mempool.space, loaded when you open Activity. <button type="button" onClick={() => { setExplorerHistoryAllowed(false, w.storage); setAllowed(false); setState({ loading: false, txs: [], error: null, more: false, last: null }); }} style={{ background: 'none', border: 'none', color: c.accent, cursor: 'pointer', padding: 0, fontSize: 12 }}>Stop using it</button></div>
            {state.error && <Notice tone="warning">{state.error}</Notice>}
            {state.txs.map((t) => (
                <div key={t.txid} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', fontSize: 12, borderTop: `1px solid ${c.border}`, padding: '4px 0' }}>
                    <span style={{ color: t.net >= 0n ? c.success : c.primaryText }}>{t.net >= 0n ? '+' : '−'}{formatAmount(t.net >= 0n ? t.net : -t.net, 8)} {cfg.symbol} <span style={{ color: c.mutedText }}>{t.confirmed ? `block ${t.height}${t.time ? ` · ${new Date(t.time).toLocaleDateString()}` : ''}` : 'unconfirmed'}</span></span>
                    <a href={`${cfg.explorer}/tx/${t.txid}`} target="_blank" rel="noopener noreferrer" style={{ color: c.accent, ...mono }}>{short(t.txid)} <FaExternalLinkAlt size={9} /></a>
                </div>
            ))}
            {state.loading && <div style={{ fontSize: 12, color: c.mutedText }}>Loading…</div>}
            {!state.loading && !state.txs.length && !state.error && <div style={{ fontSize: 12, color: c.mutedText }}>No transactions.</div>}
            {state.more && !state.loading && <div><Button variant="ghost" onClick={() => load(state.last)}>Older</Button></div>}
        </div>
    );
}

const PHASE = {
    submitting: ['pending', 'sending'],
    unknown: ['warning', 'send outcome unknown'],
    failed: ['error', 'send failed'],
    replaced: ['muted', 'send replaced'],
    dropped: ['muted', 'send dropped'],
    waiting_confs: ['pending', 'waiting for confirmations'],
    minting: ['pending', 'minting'],
    minted: ['success', 'minted'],
    too_small: ['error', 'too small, not minted'],
    tainted: ['error', 'quarantined by the minter'],
};
const WSTATE = {
    approving: ['pending', 'approving'], requesting: ['pending', 'requesting'], requested: ['pending', 'on its way'], unknown: ['warning', 'outcome unknown'],
    failed: ['error', 'failed'], confirmed: ['success', 'arrived'], reimbursing: ['warning', 'being refunded'], reimbursed: ['warning', 'refunded as ck'], too_low: ['error', 'too small'], dismissed: ['muted', 'dismissed'],
};
const WSTATUS = {
    Pending: 'queued at the minter', Signing: 'the minter is signing the Bitcoin transaction', Sending: 'handing it to the Bitcoin network',
    Submitted: 'on the Bitcoin network, waiting for confirmations',
};
const Detail = ({ k, v }) => {
    const c = useC();
    return v == null || v === '' ? null : <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', fontSize: 12 }}><span style={{ color: c.mutedText }}>{k}</span><span style={{ ...mono, color: c.primaryText, textAlign: 'right' }}>{v}</span></div>;
};

function DepositItem({ w, mv, r }) {
    const c = useC();
    const { cfg } = w;
    const ck = r.ckbtc;
    const phase = movePhase(r);
    const [tone, label] = PHASE[phase] || ['muted', phase];
    const busy = mv.busyIds.has(r.id);
    const note = mv.notes[r.id];
    const txid = r.txid || r.expectedTxid;
    const sent = ['broadcast', 'confirmed'].includes(r.state);
    const confs = ck.confirmations;
    const eta = depositEta(ck.minConfirmations, confs || 0);
    return (
        <div style={{ borderTop: `1px solid ${c.border}`, padding: '10px 0', display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ color: c.primaryText, fontWeight: 600 }}>{formatAmount(BigInt(r.amount), 8)} {cfg.symbol} → {ck.symbol}</span>
                <Pill tone={tone}>{label}</Pill>
            </div>
            <div style={{ fontSize: 12, color: c.mutedText }}>
                {new Date(r.createdAt).toLocaleString()}
                {phase === 'minted' && ck.mintedAmount != null && <> · minted {formatAmount(BigInt(ck.mintedAmount), 8)} {ck.symbol}</>}
                {phase === 'waiting_confs' && sent && <> · {confs ?? 0} of {ck.minConfirmations} confirmations · {eta.text}</>}
                {phase === 'minting' && <> · {ck.minConfirmations}+ confirmations, the minter is finishing</>}
            </div>
            {['submitting', 'unknown'].includes(phase) && <div style={{ fontSize: 12, color: c.secondaryText }}>The Bitcoin send is still pending above; the minter is asked once it has gone out.</div>}
            {ck.message && !note && <div style={{ fontSize: 12, color: ['too_small', 'tainted'].includes(phase) ? c.error : c.secondaryText }}>{ck.message}</div>}
            {note && <Notice tone={note.tone}>{note.text}</Notice>}
            {!MOVE_FINAL.includes(phase) && (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                    <Button variant="ghost" onClick={() => mv.checkDeposit(r.id, true)} disabled={busy || !sent} title="Ask the minter now (update_balance)">
                        <FaSync size={10} /> {busy ? 'Checking…' : 'Check / finish'}
                    </Button>
                    <span style={{ fontSize: 11, color: c.mutedText }}>Runs by itself every minute while this page is open.</span>
                </div>
            )}
            <Advanced title="Details">
                <Detail k="Transaction" v={txid ? <a href={`${cfg.explorer}/tx/${txid}`} target="_blank" rel="noopener noreferrer" style={{ color: c.accent }}>{txid} <FaExternalLinkAlt size={9} /></a> : null} />
                <Detail k="Deposit address" v={ck.depositAddress} />
                <Detail k="Minter / ledger" v={`${ck.minter} / ${ck.ledger}`} />
                <Detail k="Check fee" v={`${ck.checkFee} sats`} />
                <Detail k="Network fee" v={`${r.fee} sats`} />
                <Detail k="Mint block (ledger index)" v={ck.mintBlock} />
                <Detail k="Checks" v={String(ck.checks || 0)} />
                <Detail k="Next automatic check" v={ck.nextCheckAt ? new Date(ck.nextCheckAt).toLocaleTimeString() : null} />
            </Advanced>
        </div>
    );
}

function WithdrawItem({ w, mv, r }) {
    const c = useC();
    const { cfg } = w;
    const [tone, label] = WSTATE[r.state] || ['muted', r.state];
    const busy = mv.busyIds.has(r.id);
    const note = mv.notes[r.id];
    const [list, setList] = useState(null);
    const showList = async () => {
        try { setList(await ckbtcWithdrawals(w.makeActor, w.me, null, r.minter)); } catch (e) { setList({ error: String(e?.message || e).split('\n')[0] }); }
    };
    const dismiss = () => { w.movesStore.mutate((rs) => patchRecord(rs, r.id, { state: 'dismissed' }, { now: Date.now(), event: '-> dismissed', detail: 'by the user' })); mv.loadMoves(); };
    return (
        <div style={{ borderTop: `1px solid ${c.border}`, padding: '10px 0', display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ color: c.primaryText, fontWeight: 600 }}>{formatAmount(BigInt(r.amount), 8)} {r.symbol} → {cfg.symbol}</span>
                <Pill tone={tone}>{label}</Pill>
            </div>
            <div style={{ fontSize: 12, color: c.mutedText }}>
                {new Date(r.createdAt).toLocaleString()}{r.state === 'requested' && WSTATUS[r.status] ? ` · ${WSTATUS[r.status]}` : ''}
                {r.reimbursed && <> · {formatAmount(BigInt(r.reimbursed), 8)} {r.symbol} returned</>}
            </div>
            {r.txid && <div style={{ fontSize: 12, ...mono }}><a href={`${cfg.explorer}/tx/${r.txid}`} target="_blank" rel="noopener noreferrer" style={{ color: c.accent }}>{r.txid} <FaExternalLinkAlt size={9} /></a></div>}
            {r.error && ['failed', 'unknown'].includes(r.state) && <div style={{ fontSize: 12, color: r.state === 'failed' ? c.error : c.warning }}>{r.error}</div>}
            {note && <Notice tone={note.tone}>{note.text}</Notice>}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {r.blockIndex != null && !WITHDRAW_FINAL.includes(r.state) && <Button variant="ghost" onClick={() => mv.refreshWithdrawal(r, true)} disabled={busy}><FaSync size={10} /> {busy ? 'Checking…' : 'Refresh'}</Button>}
                {r.state === 'unknown' && <Button variant="ghost" onClick={showList}>Show the minter's list</Button>}
                {r.state === 'unknown' && <Button variant="ghost" onClick={dismiss}>Dismiss</Button>}
            </div>
            {list && (
                <div style={{ fontSize: 12, color: c.secondaryText }}>
                    {list.error ? `Couldn't read the minter's list (${list.error}).` : !list.length ? 'The minter has no withdrawals for your account: nothing was burned.' : list.slice(0, 10).map((x) => <div key={String(x.blockIndex)}>Burn #{String(x.blockIndex)}: {btcStatusText(x.status).label}</div>)}
                </div>
            )}
            <Advanced title="Details">
                <Detail k="To" v={r.address} />
                <Detail k="Burn block (ledger index)" v={r.blockIndex} />
                <Detail k="Approve block" v={r.approveBlock} />
                <Detail k="Allowance" v={`${r.approveAmount} sats (amount + ledger fee ${r.ledgerFee})`} />
                <Detail k="Fee estimate when requested" v={r.estimateFee != null ? `${r.estimateFee} sats` : null} />
                <Detail k="Minter status" v={r.status} />
                <Detail k="Minter / ledger" v={`${r.minter} / ${r.ledger}`} />
            </Advanced>
        </div>
    );
}

/// Moves between native Bitcoin and ck, newest first.
export function BtcMoves({ w, mv }) {
    const c = useC();
    const recs = w.records.ok ? w.records.records : [];
    const items = [
        // a move whose send was replaced by its own faster version is listed once, as that version
        ...recs.filter((r) => r.kind === 'toCkbtc' && r.ckbtc && !(r.supersededBy && recs.some((x) => x.id === r.supersededBy && x.state !== 'failed')) && !(r.state === 'replaced' && r.replacedBy && recs.some((x) => recordTxid(x) === r.replacedBy))).map((r) => ({ at: r.createdAt, el: <DepositItem key={r.id} w={w} mv={mv} r={r} /> })),
        ...(mv.moves.ok ? mv.moves.records : []).filter((r) => r.kind === 'toBtc').map((r) => ({ at: r.createdAt, el: <WithdrawItem key={r.id} w={w} mv={mv} r={r} /> })),
    ].sort((a, b) => b.at - a.at);
    return (
        <>
            <h3 style={{ fontSize: 15, margin: '18px 0 6px', color: c.primaryText }}>Moves</h3>
            {!mv.moves.ok && <Notice tone="error">{mv.moves.error}</Notice>}
            {!items.length && <div style={{ fontSize: 13, color: c.mutedText }}>No moves between Bitcoin and {w.ck?.symbol} from this device yet.</div>}
            {items.map((x) => x.el)}
        </>
    );
}

export default function BtcActivity({ w, mv = null }) {
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
    // a send superseded by its own pending faster version is shown inside that version
    const live = (id) => recs.some((x) => x.id === id && x.state !== 'failed');
    const pending = h.sends.filter((s) => LOCKING_STATES.includes(s.state) && !(s.record.supersededBy && live(s.record.supersededBy)));
    const olderOf = (r) => groupMembers(recs, r).filter((x) => x.id !== r.id && x.createdAt < r.createdAt && LOCKING_STATES.includes(x.state));
    // finished moves to ckBTC are listed under Moves, not Sent
    const done = h.sends.filter((s) => !['submitting', 'broadcast', 'unknown'].includes(s.state) && s.kind !== 'toCkbtc');
    const copyLog = async () => {
        try { await navigator.clipboard.writeText(json({ network: cfg.network, principal: w.meText, address: w.address, records: recs, moves: mv?.moves?.ok ? mv.moves.records : [] })); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard blocked */ }
    };

    return (
        <Card>
            {!records.ok && <Notice tone="error">{records.error}</Notice>}
            <h3 style={{ fontSize: 15, margin: '0 0 6px', color: c.primaryText }}>Pending</h3>
            {!pending.length && <div style={{ fontSize: 13, color: c.mutedText }}>Nothing pending.</div>}
            {pending.map((s) => <PendingItem key={s.id} w={w} r={s.record} utxoKeys={utxoKeys} records={recs} older={olderOf(s.record)} />)}

            {mv && w.ck && <BtcMoves w={w} mv={mv} />}

            <h3 style={{ fontSize: 15, margin: '18px 0 6px', color: c.primaryText }}>Sent</h3>
            {!done.length && <div style={{ fontSize: 13, color: c.mutedText }}>No sends from this device yet.</div>}
            {done.map((s) => (
                <div key={s.id} style={{ borderTop: `1px solid ${c.border}`, padding: '6px 0', fontSize: 13, display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', minWidth: 0 }}>
                    <span style={{ color: c.primaryText, minWidth: 0 }}>{s.kind === 'cpfp' ? <span style={{ color: c.mutedText }}>Speed-up to yourself: </span> : s.kind === 'sweep' ? <span style={{ color: c.mutedText }}>Sweep: </span> : null}{formatAmount(s.amount, 8)} {cfg.symbol} <span style={{ color: c.mutedText }}>to</span> <span style={mono}>{s.to?.slice(0, 12)}…</span> <span style={{ color: c.mutedText }}>{new Date(s.at).toLocaleDateString()}</span></span>
                    <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
                        <Pill tone={STATE_TONE[s.state]}>{STATE_TEXT[s.state]}</Pill>
                        {s.state !== 'failed' && <a href={`${cfg.explorer}/tx/${s.txid}`} target="_blank" rel="noopener noreferrer" style={{ color: c.accent }} aria-label="Open on mempool.space"><FaExternalLinkAlt size={10} /></a>}
                    </span>
                    {s.state === 'failed' && s.record.error && <div style={{ width: '100%', fontSize: 12, color: c.mutedText }}>{s.record.error}</div>}
                    {s.state === 'replaced' && s.record.replacedBy && <div style={{ width: '100%', fontSize: 12, color: c.mutedText }}>Another version was mined instead: <span style={mono}>{short(s.record.replacedBy)}</span>{minedVersionNote(s.record, recs)}. These coins were spent only once.</div>}
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

            <Advanced title="Advanced: full history from mempool.space">
                <ExplorerHistory w={w} />
            </Advanced>

            <Advanced title="Advanced: send log for support">
                <div style={{ fontSize: 12, color: c.mutedText }}>Every send this device made, with each step. Sends are kept in this browser only for now, so sends from another device are not listed here.</div>
                <div><Button variant="ghost" onClick={copyLog}><FaCopy size={11} /> {copied ? 'Copied' : 'Copy log (JSON)'}</Button></div>
                <SendLog records={recs} />
            </Advanced>
        </Card>
    );
}
