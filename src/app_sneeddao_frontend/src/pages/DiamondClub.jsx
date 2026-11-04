// /diamond-club: the Sneed Diamond Club moves from its EXT canister to ICRC-7 (sneed_nft, with every
// image on-chain), one way, 1:1 by card number (spec/diamond_club_icrc7.md §3.3, §3.5).
//
// Swap by send: cards go to the user's swap address (from the Sneed Hub wallet with one click, or
// from any other wallet by hand), then claim_swap(me) delivers. Proof by payment, for a wallet that
// can send tokens but not NFTs: a little ICP (to the proof address's account ID, which Plug mobile
// can pay) or SNEED (to its ICRC-1 account) from that wallet; the page finds the payment through
// the ledger's index and calls claim_by_proof. The old cards stay in that wallet and are retired.
// Everything here is public on-chain: the page shows the principal the cards go to.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Principal } from '@dfinity/principal';
import { FaGem, FaSyncAlt, FaQrcode, FaExchangeAlt, FaWallet } from 'react-icons/fa';
import Header from '../components/Header';
import PrincipalInput from '../components/PrincipalInput';
import { useAuth } from '../AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { Card, Label, Button, Notice, Advanced, CopyValue, QrCode, Pill, inputStyle } from '../components/convert/ConvertUi';
import { appAlert, appConfirm } from '../utils/appDialog';
import { encodeAccount } from '../utils/pockets/subaccount';
import { listTokens, transferExt, accountId } from '../utils/ExtUtils';
import {
    SNEED_NFT_ID, DC_EXT_ID, SNEED_LEDGER, ICP_LEDGER, DC_SUPPLY, findPayments, REGISTRY_CACHE_MS, cardImageUrl, cardNumber, extAgent, getStatus, getSwapAddress,
    getProofAddress, swapState, tokensOf, swapsOf, getSwap, listRetired, proofsFor, getProof, ledgerInfo, claimSwap, claimByProof,
    retryRefund, refundState, variantName, toHex,
} from '../utils/sneedNft';

const SEND_PARALLEL = 4;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const dateOf = (ns) => new Date(Number(BigInt(ns) / 1_000_000n)).toLocaleString();
const fmtUnits = (v, decimals) => {
    const n = BigInt(v); const d = 10n ** BigInt(decimals);
    const frac = (n % d).toString().padStart(decimals, '0').replace(/0+$/, '');
    return `${(n / d).toString()}${frac ? `.${frac}` : ''}`;
};
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

function CardTile({ n, sub, children, href }) {
    const { theme } = useTheme();
    const c = theme.colors;
    const [failed, setFailed] = useState(false);
    const img = (
        <div style={{ aspectRatio: '1', background: c.secondaryBg, display: 'grid', placeItems: 'center' }}>
            {failed ? <FaGem size={28} color={c.mutedText} /> : <img src={cardImageUrl(n, 'thumb')} alt={`Sneed Diamond Club #${n}`} loading="lazy" onError={() => setFailed(true)} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />}
        </div>
    );
    return (
        <div style={{ border: `1px solid ${c.border}`, borderRadius: 12, overflow: 'hidden', background: c.cardBg, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            {href ? <Link to={href}>{img}</Link> : img}
            <div style={{ padding: '6px 8px', display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: c.primaryText }}>#{n}</div>
                {sub && <div style={{ fontSize: 11, color: c.mutedText }}>{sub}</div>}
                {children}
            </div>
        </div>
    );
}

const grid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(112px, 1fr))', gap: 10 };

function ClaimResults({ results }) {
    if (!results) return null;
    const { delivered = [], already = [], unavailable = [], sendErrors = [] } = results;
    const nothing = !delivered.length && !already.length && !unavailable.length && !sendErrors.length;
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {delivered.length > 0 && <Notice tone="success">Delivered {plural(delivered.length, 'card')} on ICRC-7: {delivered.map((d) => `#${d.token_id.toString()}`).join(', ')}.</Notice>}
            {already.length > 0 && <Notice>Swapped before (nothing more to deliver): {already.map((i) => `#${cardNumber(i)}`).join(', ')}.</Notice>}
            {unavailable.length > 0 && <Notice tone="warning">Could not deliver {unavailable.map((i) => `#${cardNumber(i)}`).join(', ')}: the ICRC-7 card is not in the swap account. Report it on the feedback page; the collection logs every case.</Notice>}
            {sendErrors.map((e) => <Notice key={e.n} tone="error">Card #{e.n} was not sent: {e.error}</Notice>)}
            {nothing && <Notice>No cards were waiting at your swap address. If you sent some from another wallet, wait for that transfer to finish and claim again.</Notice>}
        </div>
    );
}

export default function DiamondClub() {
    const { isAuthenticated, identity, login } = useAuth();
    const { theme } = useTheme();
    const c = theme.colors;
    const me = identity && isAuthenticated ? identity.getPrincipal() : null;
    const meText = me ? me.toText() : '';

    const [status, setStatus] = useState(null);
    const [statusError, setStatusError] = useState('');
    const [swapAddr, setSwapAddr] = useState('');
    const [proofAddr, setProofAddr] = useState(null);
    const [walletCards, setWalletCards] = useState(null); // EXT indexes in the Sneed Hub wallet
    const [waiting, setWaiting] = useState([]);           // EXT indexes at the swap address, not swapped yet
    const [myTokens, setMyTokens] = useState(null);       // ICRC-7 ids held
    const [loadError, setLoadError] = useState('');
    const [busy, setBusy] = useState('');
    const [results, setResults] = useState(null);
    const [showQr, setShowQr] = useState(false);

    const [retired, setRetired] = useState(null);
    const [lookup, setLookup] = useState({ n: '', busy: false, text: '', tone: 'info' });

    const [proofOpen, setProofOpen] = useState(false);
    const [ledger, setLedger] = useState(SNEED_LEDGER);
    const [ledgerMeta, setLedgerMeta] = useState(null);
    const [block, setBlock] = useState('');
    const [icpSender, setIcpSender] = useState('');
    const [proofs, setProofs] = useState(null);
    const [proofBusy, setProofBusy] = useState('');
    const [proofResult, setProofResult] = useState(null);
    const [metas, setMetas] = useState({});               // ledger -> { symbol, decimals, fee }
    const [payments, setPayments] = useState(null);       // found transfers into the proof address
    const [paymentsError, setPaymentsError] = useState('');
    const [searching, setSearching] = useState(false);
    const [polling, setPolling] = useState(0);            // seconds of looking left after "I've sent it"
    const [payers, setPayers] = useState({});             // `${ledger}:${block}` -> principal text typed for an ICP payment
    const [showProofQr, setShowProofQr] = useState(false);

    const state = swapState(status);
    const proofLedgers = status?.proof_ledgers || [];
    const ledgerEntry = proofLedgers.find((l) => l.ledger.toText() === ledger) || null;
    const ledgerIsIcp = variantName(ledgerEntry?.kind) === 'icp';
    const icpAccepted = proofLedgers.some((l) => l.ledger.toText() === ICP_LEDGER);
    const sneedAccepted = proofLedgers.some((l) => l.ledger.toText() === SNEED_LEDGER);
    const usedProofs = useMemo(() => new Map((proofs || []).map((x) => [`${x.ledger.toText()}:${x.block_index.toString()}`, x])), [proofs]);

    const loadPublic = useCallback(async () => {
        if (!SNEED_NFT_ID) return;
        try { setStatus(await getStatus()); setStatusError(''); } catch (e) { setStatusError(e?.message || String(e)); }
        try { setRetired(await listRetired()); } catch { setRetired(null); }
    }, []);

    const loadMine = useCallback(async () => {
        if (!SNEED_NFT_ID || !me) return;
        setLoadError('');
        try {
            const agent = await extAgent(null);
            const [addr, paddr, held, tokens] = await Promise.all([getSwapAddress(me), getProofAddress(me), listTokens(DC_EXT_ID, me, agent), tokensOf(me)]);
            setSwapAddr(addr); setProofAddr(paddr); setWalletCards(held); setMyTokens(tokens);
            const atAddr = await listTokens(DC_EXT_ID, addr, agent);
            const swapped = await swapsOf(atAddr);
            setWaiting(atAddr.filter((i) => !swapped.get(i)));
        } catch (e) { setLoadError(e?.message || String(e)); }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [meText]);

    const loadProofs = useCallback(async () => {
        if (!SNEED_NFT_ID || !me) return;
        try { setProofs(await proofsFor(me)); } catch { setProofs(null); }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [meText]);

    useEffect(() => { loadPublic(); }, [loadPublic]);
    useEffect(() => { loadMine(); }, [loadMine]);
    useEffect(() => { if (proofOpen) loadProofs(); }, [proofOpen, loadProofs]);
    useEffect(() => {
        if (!proofOpen || !ledger) return;
        let alive = true;
        setLedgerMeta(null);
        ledgerInfo(ledger).then((m) => { if (alive) setLedgerMeta(m); }).catch(() => {});
        return () => { alive = false; };
    }, [proofOpen, ledger]);
    useEffect(() => {
        if (!proofOpen) return;
        for (const l of proofLedgers) {
            const id = l.ledger.toText();
            if (metas[id]) continue;
            ledgerInfo(id).then((m) => setMetas((x) => ({ ...x, [id]: m }))).catch(() => {});
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [proofOpen, status]);

    /// Every transfer into the proof address on the accepted ledgers (their index canisters).
    const searchPayments = useCallback(async () => {
        if (!proofAddr || !proofLedgers.length) return [];
        setSearching(true);
        const errors = [];
        const found = [];
        await Promise.all(proofLedgers.map(async (l) => {
            try { found.push(...await findPayments(l.ledger.toText(), variantName(l.kind), proofAddr)); }
            catch (e) { errors.push(`${l.ledger.toText() === ICP_LEDGER ? 'ICP' : l.ledger.toText() === SNEED_LEDGER ? 'SNEED' : l.ledger.toText()}: ${e?.message || String(e)}`); }
        }));
        found.sort((a, b) => (b.atMs || 0) - (a.atMs || 0));
        setPayments(found); setPaymentsError(errors.join('; ')); setSearching(false);
        return found;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [proofAddr, status]);
    useEffect(() => { if (proofOpen && proofAddr && status) searchPayments(); }, [proofOpen, proofAddr, status, searchPayments]);
    // "I've sent it": the index canisters take a few seconds; look every 5 s for a minute, until a new payment shows
    useEffect(() => {
        if (polling <= 0) return undefined;
        const t = setTimeout(async () => {
            const before = (payments || []).length;
            const found = await searchPayments();
            setPolling((s) => (found.length > before ? 0 : Math.max(0, s - 5)));
        }, 5000);
        return () => clearTimeout(t);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [polling]);

    useEffect(() => {
        // the default proof ledger is SNEED; if the canister accepts others but not SNEED, the first one
        if (proofLedgers.length && !proofLedgers.some((l) => l.ledger.toText() === ledger)) setLedger(proofLedgers[0].ledger.toText());
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [status]);

    // ---- swap by send ----

    /// claim_swap(me); if cards are still waiting at the swap address afterwards (the canister reads
    /// the EXT registry at most every 30 s), once more after the cache has run out.
    const runClaim = async (sendErrors = []) => {
        const delivered = []; const seen = new Set();
        const merge = (r) => { for (const d of r.delivered) { delivered.push(d); seen.add(Number(d.ext_index)); } return r; };
        try {
            setBusy('Claiming…');
            let r = merge(await claimSwap(identity, me));
            const agent = await extAgent(null);
            const atAddr = await listTokens(DC_EXT_ID, swapAddr, agent);
            const swapped = await swapsOf(atAddr);
            if (atAddr.some((i) => !swapped.get(i) && !seen.has(i))) {
                for (let s = Math.ceil(REGISTRY_CACHE_MS / 1000) + 2; s > 0; s--) { setBusy(`Your cards have arrived; the collection sees them within half a minute. Claiming again in ${s} s…`); await wait(1000); }
                setBusy('Claiming again…');
                r = merge(await claimSwap(identity, me));
            }
            setResults({ delivered, already: r.already_swapped.filter((i) => !seen.has(Number(i))), unavailable: r.unavailable, sendErrors });
        } catch (e) {
            setResults({ delivered, sendErrors });
            await appAlert(e, { type: 'error', title: 'Claim failed' });
        } finally {
            setBusy('');
            loadMine(); loadPublic();
        }
    };

    const swapFromWallet = async (indexes) => {
        if (!state.open || !swapAddr || !indexes.length) return;
        const n = indexes.length;
        const ok = await appConfirm(
            `Send ${plural(n, 'old EXT card')} (${indexes.map((i) => `#${cardNumber(i)}`).join(', ')}) from your Sneed Hub wallet to your swap address, and receive the same card numbers on ICRC-7?\n\nThe ICRC-7 cards go to your principal ${meText}. The old cards stay in the swap canister for good. This cannot be undone.`,
            { title: 'Swap to ICRC-7', type: 'warning', confirmText: n === 1 ? 'Swap' : `Swap ${n}` },
        );
        if (!ok) return;
        setResults(null);
        const sendErrors = [];
        try {
            const agent = await extAgent(identity);
            let done = 0;
            for (let k = 0; k < n; k += SEND_PARALLEL) {
                await Promise.all(indexes.slice(k, k + SEND_PARALLEL).map(async (i) => {
                    try { await transferExt(DC_EXT_ID, i, me, { address: swapAddr }, agent, { requireArrival: true }); }
                    catch (e) { sendErrors.push({ n: cardNumber(i), error: e?.message || String(e) }); }
                    done += 1;
                    setBusy(`Sending to your swap address: ${done} of ${n}…`);
                }));
            }
        } catch (e) { sendErrors.push({ n: '?', error: e?.message || String(e) }); }
        if (sendErrors.length === n) { setResults({ sendErrors }); setBusy(''); loadMine(); return; }
        await runClaim(sendErrors);
    };

    // ---- proof by payment ----

    /// claim_by_proof for one payment (ledger, block); `sender` only for ICP.
    const claimPayment = async (ledgerId, b, sender) => {
        const ok = await appConfirm(
            `Claim by proof with ${ledgerId === ICP_LEDGER ? 'ICP' : ledgerId === SNEED_LEDGER ? 'SNEED' : ledgerId} ledger block ${b}?\n\nEvery unswapped old card held by the wallet that paid goes to your principal ${meText} on ICRC-7, and the payment comes back to that wallet minus the ledger fee.\n\nThe old EXT cards stay in that wallet, are marked retired, and can never be swapped again. Do not sell them: buyers can see the retired list on this page.`,
            { title: 'Claim by proof', type: 'warning', confirmText: 'Claim' },
        );
        if (!ok) return;
        setProofBusy('Checking the payment on the ledger…'); setProofResult(null);
        try {
            const p = await claimByProof(identity, me, ledgerId, b, sender);
            setProofResult(p); setBlock('');
        } catch (e) { await appAlert(e, { type: 'error', title: 'Claim by proof failed' }); }
        finally { setProofBusy(''); loadProofs(); loadMine(); loadPublic(); }
    };

    /// The manual fallback (Advanced): a block index typed in, on the selected ledger.
    const submitProof = async () => {
        const b = block.trim();
        if (!/^\d+$/.test(b)) { await appAlert('Enter the block index of your payment (a whole number; your wallet shows it in the transaction details).', { type: 'error', title: 'Block index' }); return; }
        let sender = null;
        if (ledgerIsIcp) {
            try { sender = { owner: Principal.fromText(icpSender.trim()), subaccount: [] }; }
            catch { await appAlert('An ICP payment needs the paying wallet\'s principal.', { type: 'error', title: 'Paying wallet' }); return; }
        }
        await claimPayment(ledger, b, sender);
    };

    /// An ICP payment names only the sender's account ID: the principal typed for it must hash to it.
    const payerCheck = (pay) => {
        const text = (payers[`${pay.ledger}:${pay.block}`] || '').trim();
        if (!text) return { ok: false, text, msg: '' };
        let principal;
        try { principal = Principal.fromText(text); } catch { return { ok: false, text, msg: 'That is not a valid principal.' }; }
        if (accountId(principal) === pay.fromAccountId) return { ok: true, text, principal, msg: 'Matches the account that paid.' };
        return { ok: false, text, msg: 'This principal\'s main account did not make this payment. It may have been paid from a subaccount, or from a different wallet: use that wallet\'s principal.' };
    };

    const doRetry = async (p) => {
        setProofBusy('Sending the refund again…');
        try { const x = await retryRefund(identity, p.ledger, p.block_index); if (proofResult && proofResult.key === x.key) setProofResult(x); }
        catch (e) { await appAlert(e, { type: 'error', title: 'Refund retry failed' }); }
        finally { setProofBusy(''); loadProofs(); }
    };

    const checkPayment = async () => {
        const b = block.trim();
        if (!/^\d+$/.test(b)) return;
        setProofBusy('Looking up…');
        try { const p = await getProof(ledger, b); setProofResult(p); if (!p) await appAlert('No claim has used this payment yet.', { title: 'Not used yet' }); }
        catch (e) { await appAlert(e, { type: 'error' }); }
        finally { setProofBusy(''); }
    };

    // ---- public: check an EXT card ----

    const checkCard = async () => {
        const n = Number(lookup.n);
        if (!Number.isInteger(n) || n < 1 || n > DC_SUPPLY) { setLookup((l) => ({ ...l, text: `A card number is 1 to ${DC_SUPPLY}.`, tone: 'error' })); return; }
        setLookup((l) => ({ ...l, busy: true, text: '' }));
        try {
            const s = await getSwap(n - 1);
            const text = !s ? `Card #${n} has not been swapped: the old EXT card is still the live one.`
                : variantName(s.method) === 'proof' ? `Card #${n} is RETIRED: it was swapped by proof on ${dateOf(s.at)}. The old EXT card is worthless; the ICRC-7 card went to ${s.recipient.toText()}.`
                : `Card #${n} was swapped on ${dateOf(s.at)}: the old EXT card is locked in the swap canister, the ICRC-7 card went to ${s.recipient.toText()}.`;
            setLookup((l) => ({ ...l, busy: false, text, tone: !s ? 'info' : variantName(s.method) === 'proof' ? 'warning' : 'success' }));
        } catch (e) { setLookup((l) => ({ ...l, busy: false, text: e?.message || String(e), tone: 'error' })); }
    };

    const proofText = useMemo(() => { try { return proofAddr ? encodeAccount({ owner: proofAddr.account.owner, subaccount: proofAddr.account.subaccount[0] }) : ''; } catch { return ''; } }, [proofAddr]);
    const h2 = { margin: '0 0 8px', fontSize: '1.15rem', color: c.primaryText, display: 'flex', alignItems: 'center', gap: 8 };
    const p = { margin: '0 0 10px', color: c.secondaryText, fontSize: 14, lineHeight: 1.6 };
    const selectStyle = { ...inputStyle(c), background: c.secondaryBg, color: c.primaryText };

    return (
        <>
            <Header />
            <div style={{ maxWidth: 1000, margin: '0 auto', padding: '1.5rem 16px 3rem', display: 'flex', flexDirection: 'column', gap: 16 }}>
                <section style={{ borderRadius: 20, padding: '26px 20px', border: `1px solid ${c.border}`, background: `radial-gradient(120% 120% at 50% 0%, ${c.accent}22 0%, transparent 60%), ${c.cardBg}`, display: 'flex', gap: 20, alignItems: 'center', flexWrap: 'wrap' }}>
                    <img src={cardImageUrl(DC_SUPPLY, 'thumb')} alt="Sneed Diamond Club #1000" style={{ width: 112, height: 112, borderRadius: 16, objectFit: 'cover', flexShrink: 0, background: c.secondaryBg }} />
                    <div style={{ flex: '1 1 260px', minWidth: 0 }}>
                        <h1 style={{ margin: 0, fontSize: '1.7rem', color: c.primaryText }}>Sneed Diamond Club: move your cards to ICRC-7</h1>
                        <p style={{ ...p, margin: '10px 0 0' }}>
                            The 1,000 Diamond Club cards move from the old EXT canister, whose images are hosted off-chain and no longer load, to a DAO-owned ICRC-7 collection that stores every image on-chain. The swap is one way and 1:1: you give an old card and get the same card number.
                        </p>
                    </div>
                </section>

                {!SNEED_NFT_ID && <Notice tone="warning">The Diamond Club collection is not available on this network.</Notice>}
                {statusError && <Notice tone="error">Could not read the collection: {statusError}</Notice>}
                {status && (state.open
                    ? <Notice tone="success">The swap is open. {plural(Number(status.swaps), 'card')} swapped so far, {Number(status.retired)} of them retired by proof.</Notice>
                    : <Notice tone="warning"><strong>The swap is not open yet.</strong> {state.reason} (metadata frozen: {status.metadata_frozen ? 'yes' : 'no'}; minting locked: {status.minting_locked ? 'yes' : 'no'}; paused: {status.swaps_paused ? 'yes' : 'no'}). Wait for it to open before you send any card.</Notice>)}

                {SNEED_NFT_ID && !me && (
                    <Card>
                        <h2 style={h2}><FaWallet /> Sign in to swap</h2>
                        <p style={p}>Sign in to see your swap address, the old cards in your Sneed Hub wallet and the ICRC-7 cards you hold.</p>
                        <Button onClick={login}>Sign in</Button>
                    </Card>
                )}

                {SNEED_NFT_ID && me && (
                    <>
                        <Card>
                            <h2 style={h2}><FaExchangeAlt /> Your swap address</h2>
                            <p style={p}>Old cards sent to this address are swapped for <strong>your</strong> principal below, whoever sends them. Swaps are public on-chain.</p>
                            <Label>Your principal (receives the ICRC-7 cards)</Label>
                            <CopyValue value={meText} label="principal" />
                            <div style={{ height: 10 }} />
                            <Label hint="an EXT account ID">Swap address</Label>
                            {swapAddr ? (
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-start' }}>
                                    {showQr && <QrCode text={swapAddr} size={160} />}
                                    <div style={{ flex: '1 1 260px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                                        <CopyValue value={swapAddr} label="swap address" />
                                        <button type="button" onClick={() => setShowQr(!showQr)} style={{ alignSelf: 'flex-start', background: 'none', border: 'none', padding: 0, color: c.accent, cursor: 'pointer', fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                                            <FaQrcode size={11} /> {showQr ? 'Hide QR' : 'Show QR'}
                                        </button>
                                    </div>
                                </div>
                            ) : <div style={{ color: c.mutedText, fontSize: 13 }}>{loadError ? `Could not load: ${loadError}` : 'Loading…'}</div>}
                        </Card>

                        <Card>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                <h2 style={h2}><FaGem /> Old cards in your Sneed Hub wallet</h2>
                                <Button variant="ghost" onClick={() => { loadMine(); loadPublic(); }} disabled={!!busy} style={{ padding: '6px 10px', fontSize: 13 }}><FaSyncAlt size={11} /> Refresh</Button>
                            </div>
                            {walletCards === null ? <div style={{ color: c.mutedText, fontSize: 13 }}>{loadError ? `Could not load: ${loadError}` : 'Loading…'}</div>
                                : walletCards.length === 0 ? <p style={p}>None. Cards in another wallet (Plug, Stoic, …): see below.</p>
                                : (
                                    <>
                                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
                                            <span style={{ color: c.secondaryText, fontSize: 14 }}>{plural(walletCards.length, 'card')}</span>
                                            {walletCards.length > 1 && <Button onClick={() => swapFromWallet(walletCards)} disabled={!state.open || !!busy || !swapAddr}>Swap all {walletCards.length}</Button>}
                                        </div>
                                        <div style={grid}>
                                            {walletCards.map((i) => (
                                                <CardTile key={i} n={cardNumber(i)} sub={`EXT index ${i}`}>
                                                    <Button onClick={() => swapFromWallet([i])} disabled={!state.open || !!busy || !swapAddr} style={{ padding: '5px 8px', fontSize: 12 }}>Swap</Button>
                                                </CardTile>
                                            ))}
                                        </div>
                                    </>
                                )}
                            {!state.open && walletCards?.length > 0 && <div style={{ marginTop: 8, fontSize: 12, color: c.mutedText }}>The Swap buttons work once the swap is open.</div>}
                        </Card>

                        <Card>
                            <h2 style={h2}>Cards in another wallet</h2>
                            <ol style={{ ...p, paddingLeft: 20 }}>
                                <li>Delist the cards first if they are listed on a marketplace.</li>
                                <li>In that wallet, send each card to your <strong>swap address</strong> above (as an account ID). The cards are swapped for your principal shown above, whoever sends them.</li>
                                <li>Come back here and click <strong>Claim</strong>.</li>
                            </ol>
                            {waiting.length > 0 && <Notice style={{ marginBottom: 10 }}>{plural(waiting.length, 'card')} waiting at your swap address: {waiting.map((i) => `#${cardNumber(i)}`).join(', ')}.</Notice>}
                            <Button onClick={() => { setResults(null); runClaim(); }} disabled={!state.open || !!busy || !swapAddr}>Claim</Button>
                            <div style={{ marginTop: 6, fontSize: 12, color: c.mutedText }}>The collection reads the old registry at most every 30 seconds, so a card sent a moment ago may need half a minute; this page claims again by itself when it sees cards waiting.</div>
                        </Card>

                        {(busy || results) && (
                            <Card>
                                {busy && <Notice tone="info" style={{ marginBottom: results ? 10 : 0 }}>{busy}</Notice>}
                                <ClaimResults results={results} />
                            </Card>
                        )}

                        <Card>
                            <h2 style={h2}><FaGem /> Your ICRC-7 cards</h2>
                            {myTokens === null ? <div style={{ color: c.mutedText, fontSize: 13 }}>Loading…</div>
                                : myTokens.length === 0 ? <p style={p}>None yet.</p>
                                : (
                                    <>
                                        <p style={p}>{plural(myTokens.length, 'card')}. They are in your <Link to="/nft" style={{ color: c.accent }}>NFT wallet</Link> too.</p>
                                        <div style={grid}>
                                            {myTokens.map((n) => <CardTile key={n} n={n} href={`/nft_item?collection=${SNEED_NFT_ID}&id=${n}`} />)}
                                        </div>
                                    </>
                                )}
                        </Card>

                        <Card>
                            <button type="button" onClick={() => setProofOpen(!proofOpen)} aria-expanded={proofOpen} style={{ ...h2, margin: 0, background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left' }}>
                                {proofOpen ? '▼' : '▶'} My wallet can't send NFTs
                            </button>
                            {proofOpen && (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 12 }}>
                                    <Notice>
                                        <strong>Try this first:</strong> your wallet's key lives in its seed phrase. Import the seed phrase into another install of the same wallet (for example the Plug browser extension when the Plug mobile app can't send) and send the cards to your swap address from there. Then the old cards are locked in the swap canister. Never type your seed phrase into a website, and nobody from Sneed will ever ask for it.
                                    </Notice>
                                    <Notice tone="warning">
                                        <strong>Proof by payment</strong> swaps without moving the old cards: the wallet proves it is yours by paying a small amount to your proof address. Every unswapped card it holds goes to your principal on ICRC-7, and the payment comes back minus the ledger fee. <strong>The old cards stay in that wallet, are retired, and can never be swapped again.</strong> They are listed publicly as retired below.
                                    </Notice>
                                    <div>
                                        <Label>1. From the wallet that holds the cards, pay a small amount to your proof address</Label>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                                            {icpAccepted && proofAddr && (
                                                <div style={{ border: `1px solid ${c.border}`, borderRadius: 12, padding: 12, background: c.secondaryBg }}>
                                                    <div style={{ fontWeight: 700, color: c.primaryText, marginBottom: 4 }}>Pay ICP <span style={{ fontWeight: 400, color: c.mutedText, fontSize: 13 }}>(works from Plug and most wallets)</span></div>
                                                    <div style={{ fontSize: 13, color: c.secondaryText, marginBottom: 8 }}>Send <strong>0.001 ICP</strong> to this account ID{metas[ICP_LEDGER] ? ` (the ledger fee is ${fmtUnits(metas[ICP_LEDGER].fee, 8)} ICP; the rest comes back)` : ''}:</div>
                                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-start' }}>
                                                        {showProofQr && <QrCode text={proofAddr.account_id} size={150} />}
                                                        <div style={{ flex: '1 1 240px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                                                            <CopyValue value={proofAddr.account_id} label="ICP account ID" />
                                                            <button type="button" onClick={() => setShowProofQr(!showProofQr)} style={{ alignSelf: 'flex-start', background: 'none', border: 'none', padding: 0, color: c.accent, cursor: 'pointer', fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                                                                <FaQrcode size={11} /> {showProofQr ? 'Hide QR' : 'Show QR'}
                                                            </button>
                                                        </div>
                                                    </div>
                                                </div>
                                            )}
                                            {sneedAccepted && (
                                                <div style={{ border: `1px solid ${c.border}`, borderRadius: 12, padding: 12, background: c.secondaryBg }}>
                                                    <div style={{ fontWeight: 700, color: c.primaryText, marginBottom: 4 }}>Pay SNEED <span style={{ fontWeight: 400, color: c.mutedText, fontSize: 13 }}>(wallets that can send to a subaccount)</span></div>
                                                    <div style={{ fontSize: 13, color: c.secondaryText, marginBottom: 8 }}>Send a little SNEED, more than the fee{metas[SNEED_LEDGER] ? ` (${fmtUnits(metas[SNEED_LEDGER].fee, metas[SNEED_LEDGER].decimals)} SNEED)` : ''}, to this ICRC-1 account:</div>
                                                    {proofText ? <CopyValue value={proofText} label="proof address" /> : <div style={{ color: c.mutedText, fontSize: 13 }}>Loading…</div>}
                                                </div>
                                            )}
                                            {!proofAddr && <div style={{ color: c.mutedText, fontSize: 13 }}>Loading…</div>}
                                        </div>
                                        <div style={{ fontSize: 12, color: c.mutedText, marginTop: 6 }}>Pay from the main account of the wallet that holds the cards: that wallet's cards are the ones swapped.</div>
                                    </div>
                                    <div>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 6 }}>
                                            <span style={{ fontSize: 13, fontWeight: 600, color: c.secondaryText }}>2. Find your payment and claim</span>
                                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                                <Button variant="ghost" onClick={() => setPolling(60)} disabled={searching || polling > 0 || !proofAddr} style={{ padding: '6px 10px', fontSize: 13 }}>I've sent it</Button>
                                                <Button variant="ghost" onClick={() => searchPayments()} disabled={searching || !proofAddr} style={{ padding: '6px 10px', fontSize: 13 }}><FaSyncAlt size={11} /> {searching ? 'Looking…' : 'Find my payment'}</Button>
                                            </div>
                                        </div>
                                        {polling > 0 && <Notice style={{ marginBottom: 8 }}>Looking for your payment every few seconds (the ledgers' index canisters take a moment)…</Notice>}
                                        {paymentsError && <Notice tone="error" style={{ marginBottom: 8 }}>Could not read: {paymentsError}</Notice>}
                                        {payments === null ? <div style={{ color: c.mutedText, fontSize: 13 }}>{searching ? 'Looking…' : ''}</div>
                                            : payments.length === 0 ? <div style={{ color: c.mutedText, fontSize: 13 }}>No payment to your proof address yet.</div>
                                            : (
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                                    {payments.map((pay) => {
                                                        const key = `${pay.ledger}:${pay.block.toString()}`;
                                                        const used = usedProofs.get(key);
                                                        const m = metas[pay.ledger];
                                                        const sym = pay.ledger === ICP_LEDGER ? 'ICP' : pay.ledger === SNEED_LEDGER ? 'SNEED' : (m?.symbol || '');
                                                        if (used) return <ProofView key={key} proof={used} meta={m} onRetry={doRetry} busy={!!proofBusy} />;
                                                        const chk = pay.kind === 'icp' ? payerCheck(pay) : null;
                                                        return (
                                                            <div key={key} style={{ border: `1px solid ${c.border}`, borderRadius: 12, padding: 12, background: c.secondaryBg, display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, color: c.primaryText, minWidth: 0 }}>
                                                                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                                                                    <strong>{m ? fmtUnits(pay.amount, m.decimals) : pay.amount.toString()} {sym}</strong>
                                                                    <span style={{ color: c.mutedText }}>{pay.atMs ? new Date(pay.atMs).toLocaleString() : ''} · block {pay.block.toString()}</span>
                                                                </div>
                                                                <div style={{ color: c.secondaryText, wordBreak: 'break-all' }}>
                                                                    From {pay.kind === 'icp' ? <>account ID <code>{pay.fromAccountId}</code></> : <><code>{pay.fromPrincipal}</code>{pay.fromSubaccount ? <> (subaccount {pay.fromSubaccount.slice(0, 12)}…)</> : null}</>}
                                                                </div>
                                                                {pay.spender ? <Notice tone="warning">Made with an approval (by a spender), so it proves nothing: not accepted.</Notice> : (
                                                                    <>
                                                                        {chk && (
                                                                            <div>
                                                                                <Label>The principal of the wallet that paid (e.g. your Plug principal)</Label>
                                                                                <PrincipalInput value={chk.text} onChange={(v) => setPayers((x) => ({ ...x, [key]: v }))} placeholder="Principal of the paying wallet" defaultTab="all" style={{ width: '100%' }} inputStyle={inputStyle(c)} />
                                                                                {chk.msg && <div style={{ fontSize: 12, marginTop: 4, color: chk.ok ? c.success : c.error }}>{chk.msg}</div>}
                                                                            </div>
                                                                        )}
                                                                        <Button onClick={() => claimPayment(pay.ledger, pay.block.toString(), chk ? { owner: chk.principal, subaccount: [] } : null)} disabled={!state.open || !!proofBusy || (chk && !chk.ok)} style={{ alignSelf: 'flex-start' }}>Claim with this payment</Button>
                                                                    </>
                                                                )}
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            )}
                                    </div>
                                    {proofBusy && <Notice>{proofBusy}</Notice>}
                                    {proofResult && <ProofView proof={proofResult} meta={metas[proofResult.ledger.toText()] || ledgerMeta} onRetry={doRetry} busy={!!proofBusy} />}

                                    <Advanced title="Advanced: enter a block index, the proof address in detail, my proofs">
                                        <Label>Proof ledger</Label>
                                        {proofLedgers.length > 1 ? (
                                            <select value={ledger} onChange={(e) => setLedger(e.target.value)} style={selectStyle}>
                                                {proofLedgers.map((l) => <option key={l.ledger.toText()} value={l.ledger.toText()} style={{ background: c.secondaryBg, color: c.primaryText }}>{l.ledger.toText() === SNEED_LEDGER ? 'SNEED' : l.ledger.toText() === ICP_LEDGER ? 'ICP' : l.ledger.toText()} ({variantName(l.kind)})</option>)}
                                            </select>
                                        ) : <CopyValue value={ledger} label="ledger" />}
                                        <Label hint="your wallet shows it in the transaction's details">The payment's block index</Label>
                                        <input value={block} onChange={(e) => setBlock(e.target.value.replace(/[^\d]/g, ''))} inputMode="numeric" placeholder="e.g. 3456789" style={inputStyle(c)} />
                                        {ledgerIsIcp && (
                                            <div>
                                                <Label>The paying wallet's principal (ICP records only an account ID)</Label>
                                                <PrincipalInput value={icpSender} onChange={setIcpSender} placeholder="Principal of the wallet that paid" defaultTab="all" style={{ width: '100%' }} inputStyle={inputStyle(c)} />
                                            </div>
                                        )}
                                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                            <Button onClick={submitProof} disabled={!state.open || !!proofBusy || !block}>Claim by proof</Button>
                                            <Button variant="ghost" onClick={checkPayment} disabled={!!proofBusy || !block}>Check this payment</Button>
                                        </div>
                                        {proofAddr && (
                                            <>
                                                <Label>Owner (the collection canister)</Label>
                                                <CopyValue value={proofAddr.account.owner.toText()} label="owner" />
                                                <Label hint={'SHA-256("sdc-proof" ‖ your principal)'}>Subaccount (hex)</Label>
                                                <CopyValue value={toHex(proofAddr.account.subaccount[0])} label="subaccount" />
                                                <Label hint="for the ICP ledger">Account identifier</Label>
                                                <CopyValue value={proofAddr.account_id} label="account identifier" />
                                            </>
                                        )}
                                        <div style={{ fontSize: 12, color: c.mutedText }}>Only ledgers accepted by Sneed DAO proposal count, because a fake ledger could report any payment. Only a wallet's own key can prove: payments from a canister (an exchange, a marketplace) or made with an approval are refused.</div>
                                        <Label>My proofs</Label>
                                        {proofs === null ? <div style={{ color: c.mutedText, fontSize: 13 }}>Loading…</div>
                                            : proofs.length === 0 ? <div style={{ color: c.mutedText, fontSize: 13 }}>None.</div>
                                            : proofs.map((x) => <ProofView key={x.key} proof={x} meta={metas[x.ledger.toText()]} onRetry={doRetry} busy={!!proofBusy} />)}
                                    </Advanced>
                                </div>
                            )}
                        </Card>
                    </>
                )}

                {SNEED_NFT_ID && (
                    <Card>
                        <h2 style={h2}>Swap progress and retired cards</h2>
                        {status && (
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10, marginBottom: 12 }}>
                                {[['Swapped', Number(status.swaps)], ['Retired by proof', Number(status.retired)], ['Still on EXT', DC_SUPPLY - Number(status.swaps)]].map(([k, v]) => (
                                    <div key={k} style={{ border: `1px solid ${c.border}`, borderRadius: 12, padding: '10px 12px', background: c.secondaryBg }}>
                                        <div style={{ fontSize: 12, color: c.mutedText }}>{k}</div>
                                        <div style={{ fontSize: 22, fontWeight: 800, color: c.primaryText, fontVariantNumeric: 'tabular-nums' }}>{v.toLocaleString()}</div>
                                    </div>
                                ))}
                            </div>
                        )}
                        <p style={p}>Buying an old EXT card? Check it first. A <strong>retired</strong> card was swapped by proof: it still sits in its old wallet but can never be swapped again.</p>
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
                            <input value={lookup.n} onChange={(e) => setLookup((l) => ({ ...l, n: e.target.value.replace(/[^\d]/g, '') }))} onKeyDown={(e) => { if (e.key === 'Enter') checkCard(); }} inputMode="numeric" placeholder={`Card number (1–${DC_SUPPLY})`} style={{ ...inputStyle(c), flex: '1 1 160px', width: 'auto' }} />
                            <Button onClick={checkCard} disabled={lookup.busy || !lookup.n}>Check card</Button>
                        </div>
                        {lookup.text && <Notice tone={lookup.tone} style={{ marginBottom: 10 }}>{lookup.text}</Notice>}
                        <Label>Retired cards</Label>
                        {retired === null ? <div style={{ color: c.mutedText, fontSize: 13 }}>Loading…</div>
                            : retired.length === 0 ? <div style={{ color: c.mutedText, fontSize: 13 }}>None.</div>
                            : <div style={grid}>{retired.map((s) => <CardTile key={s.ext_index} n={cardNumber(s.ext_index)} sub={<>EXT index {s.ext_index} · <Pill tone="warning">retired</Pill></>} />)}</div>}
                    </Card>
                )}
            </div>
        </>
    );
}

function ProofView({ proof, meta, onRetry, busy }) {
    const { theme } = useTheme();
    const c = theme.colors;
    const rs = refundState(proof);
    const amt = (v) => (meta ? `${fmtUnits(v, meta.decimals)} ${meta.symbol}` : v.toString());
    return (
        <div style={{ border: `1px solid ${c.border}`, borderRadius: 12, padding: 12, background: c.secondaryBg, display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, color: c.primaryText }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                <strong>Payment at block {proof.block_index.toString()}</strong>
                <span style={{ color: c.mutedText }}>{dateOf(proof.at)}</span>
            </div>
            <div style={{ color: c.secondaryText }}>
                {proof.delivered.length ? `Delivered ${plural(proof.delivered.length, 'card')}: ${proof.delivered.map((d) => `#${d.token_id.toString()}`).join(', ')}` : 'No unswapped cards were held by the paying wallet.'}
            </div>
            <div style={{ color: c.secondaryText }}>Paid {amt(proof.amount)}; refund {amt(proof.refund_amount)} (ledger fee {amt(proof.fee)}).</div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <Pill tone={rs.tone}>{variantName(proof.refund).replace('_', ' ')}</Pill>
                <span style={{ color: c.secondaryText }}>{rs.label}</span>
                {rs.retry && <Button variant="ghost" onClick={() => onRetry(proof)} disabled={busy} style={{ padding: '4px 10px', fontSize: 12 }}>Retry refund</Button>}
            </div>
        </div>
    );
}
