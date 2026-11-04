// /diamond-club: the Sneed Diamond Club moves from its EXT canister to ICRC-7 (sneed_nft, with every
// image on-chain), one way, 1:1 by card number (spec/diamond_club_icrc7.md §3.3, §3.5).
//
// Swap by send: cards go to the user's swap address (from the Sneed Hub wallet with one click, or
// from any other wallet by hand), then claim_swap(me) delivers. Proof by payment, for a wallet that
// can send tokens but not NFTs: a little SNEED from that wallet to the user's proof address, then
// claim_by_proof with the block index; the old cards stay in that wallet and are retired.
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
import { listTokens, transferExt } from '../utils/ExtUtils';
import {
    SNEED_NFT_ID, DC_EXT_ID, SNEED_LEDGER, DC_SUPPLY, REGISTRY_CACHE_MS, cardImageUrl, cardNumber, extAgent, getStatus, getSwapAddress,
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

    const state = swapState(status);
    const proofLedgers = status?.proof_ledgers || [];
    const ledgerEntry = proofLedgers.find((l) => l.ledger.toText() === ledger) || null;
    const ledgerIsIcp = variantName(ledgerEntry?.kind) === 'icp';

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

    const submitProof = async () => {
        const b = block.trim();
        if (!/^\d+$/.test(b)) { await appAlert('Enter the block index of your payment (a whole number; your wallet shows it in the transaction details).', { type: 'error', title: 'Block index' }); return; }
        let sender = null;
        if (ledgerIsIcp) {
            try { sender = { owner: Principal.fromText(icpSender.trim()), subaccount: [] }; }
            catch { await appAlert('An ICP payment needs the paying wallet\'s principal.', { type: 'error', title: 'Paying wallet' }); return; }
        }
        const ok = await appConfirm(
            `Claim by proof with ledger block ${b}?\n\nEvery unswapped old card held by the wallet that paid goes to your principal ${meText} on ICRC-7, and the payment comes back to that wallet minus the ledger fee.\n\nThe old EXT cards stay in that wallet, are marked retired, and can never be swapped again. Do not sell them: buyers can see the retired list on this page.`,
            { title: 'Claim by proof', type: 'warning', confirmText: 'Claim' },
        );
        if (!ok) return;
        setProofBusy('Checking the payment on the ledger…'); setProofResult(null);
        try {
            const p = await claimByProof(identity, me, ledger, b, sender);
            setProofResult(p); setBlock('');
        } catch (e) { await appAlert(e, { type: 'error', title: 'Claim by proof failed' }); }
        finally { setProofBusy(''); loadProofs(); loadMine(); loadPublic(); }
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
    const ledgerName = ledgerMeta?.symbol || (ledger === SNEED_LEDGER ? 'SNEED' : 'tokens');
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
                                        <Label>1. From the wallet that holds the cards, send a little {ledgerName} to your proof address</Label>
                                        {proofText ? <CopyValue value={proofText} label="proof address" /> : <div style={{ color: c.mutedText, fontSize: 13 }}>Loading…</div>}
                                        <div style={{ fontSize: 12, color: c.mutedText, marginTop: 6 }}>
                                            Send more than the ledger fee{ledgerMeta ? ` (${fmtUnits(ledgerMeta.fee, ledgerMeta.decimals)} ${ledgerMeta.symbol})` : ''}, for example 0.01 {ledgerName}, from the wallet's main account. Your wallet must accept an ICRC-1 account with a subaccount (the text above).
                                        </div>
                                    </div>
                                    <div>
                                        <Label hint="your wallet shows it in the transaction's details">2. Enter the payment's block index</Label>
                                        <input value={block} onChange={(e) => setBlock(e.target.value.replace(/[^\d]/g, ''))} inputMode="numeric" placeholder="e.g. 3456789" style={inputStyle(c)} />
                                        {ledgerIsIcp && (
                                            <div style={{ marginTop: 8 }}>
                                                <Label>The paying wallet's principal (ICP records only an account ID)</Label>
                                                <PrincipalInput value={icpSender} onChange={setIcpSender} placeholder="Principal of the wallet that paid" defaultTab="all" style={{ width: '100%' }} inputStyle={inputStyle(c)} />
                                            </div>
                                        )}
                                    </div>
                                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                        <Button onClick={submitProof} disabled={!state.open || !!proofBusy || !block}>3. Claim by proof</Button>
                                        <Button variant="ghost" onClick={checkPayment} disabled={!!proofBusy || !block}>Check this payment</Button>
                                    </div>
                                    {proofBusy && <Notice>{proofBusy}</Notice>}
                                    {proofResult && <ProofView proof={proofResult} meta={ledgerMeta} onRetry={doRetry} busy={!!proofBusy} />}

                                    <Advanced title="Advanced: the proof address in detail, ledgers, my proofs">
                                        {proofAddr && (
                                            <>
                                                <Label>Owner (the collection canister)</Label>
                                                <CopyValue value={proofAddr.account.owner.toText()} label="owner" />
                                                <Label hint={'SHA-256("sdc-proof" ‖ your principal)'}>Subaccount (hex)</Label>
                                                <CopyValue value={toHex(proofAddr.account.subaccount[0])} label="subaccount" />
                                                <Label hint="for the ICP ledger only">Account identifier</Label>
                                                <CopyValue value={proofAddr.account_id} label="account identifier" />
                                            </>
                                        )}
                                        <Label>Proof ledger</Label>
                                        {proofLedgers.length > 1 ? (
                                            <select value={ledger} onChange={(e) => setLedger(e.target.value)} style={selectStyle}>
                                                {proofLedgers.map((l) => <option key={l.ledger.toText()} value={l.ledger.toText()} style={{ background: c.secondaryBg, color: c.primaryText }}>{l.ledger.toText() === SNEED_LEDGER ? 'SNEED' : l.ledger.toText()} ({variantName(l.kind)})</option>)}
                                            </select>
                                        ) : <CopyValue value={ledger} label="ledger" />}
                                        <div style={{ fontSize: 12, color: c.mutedText }}>Only ledgers accepted by Sneed DAO proposal count, because a fake ledger could report any payment. Only a wallet's own key can prove: payments from a canister (an exchange, a marketplace) or made with an approval are refused.</div>
                                        <Label>My proofs</Label>
                                        {proofs === null ? <div style={{ color: c.mutedText, fontSize: 13 }}>Loading…</div>
                                            : proofs.length === 0 ? <div style={{ color: c.mutedText, fontSize: 13 }}>None.</div>
                                            : proofs.map((x) => <ProofView key={x.key} proof={x} meta={x.ledger.toText() === ledger ? ledgerMeta : null} onRetry={doRetry} busy={!!proofBusy} />)}
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
