// /position: one ICPSwap position, everything you can do to it, from here.
//   /position?swap=<pool>&id=<id>   one position: information for everyone, actions for its owner
//   /position?swap=<pool>           create a new position in that pool
//   /position                       pick a pool first, or create a pool
// (/managelp is the old address and redirects here.)
// Every call goes to the pool canister as the logged-in user, the way Sneed
// Lock does it: one operation at a time, the pool's unused balances read
// before and after, and leftovers withdrawn so nothing is stranded.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { HttpAgent } from '@dfinity/agent';
import { Principal } from '@dfinity/principal';
import { principalToSubAccount } from '@dfinity/utils';
import { createActor as createIcpSwapActor } from 'external/icp_swap';
import { createActor as createLedgerActor } from 'external/icrc1_ledger';
import { createActor as createSneedLockActor, canisterId as sneedLockCanisterId } from 'declarations/sneed_lock';
import { createActor as createFactoryActor, canisterId as icpSwapFactoryCanisterId } from 'external/icp_swap_factory';
import { Actor } from '@dfinity/agent';
import TokenSelector from '../components/TokenSelector';
import PositionTransferGuide from '../components/PositionTransferGuide';
import Header from '../components/Header';
import PrincipalInput from '../components/PrincipalInput';
import SwapPoolPicker, { describeSwapPool } from '../components/SwapPoolPicker';
import { useAuth } from '../AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { useDenomination } from '../contexts/DenominationContext';
import { useWalletOptional } from '../contexts/WalletContext';
import { get_token_conversion_rate } from '../utils/TokenUtils';
import { getTokenInfo, checkAllowance, approve, transfer } from '../services/dex/tokenStandard';
import { lockFromLocks } from '../utils/PositionUtils';
import { customStyles } from '../health/TreeView.jsx';
import { FaWater, FaSpinner, FaLock, FaArrowUp, FaCoins, FaPlus, FaMinus, FaExchangeAlt, FaExternalLinkAlt, FaSync, FaCheck } from 'react-icons/fa';
import { isUntilDissolved } from '../utils/lockTime';
import { LockUntil } from '../components/LockUntil';

const HOST = 'https://icp-api.io';
const primary = '#06b6d4';
const MIN_TICK = -887272; const MAX_TICK = 887272;
// ICPSwap's pool creation: a passcode bought from the PasscodeManager (1 ICP in production), then the factory.
const PASSCODE_MANAGER = '7eikv-2iaaa-aaaag-qdgwa-cai';
const SWAP_CALCULATOR = 'phr2m-oyaaa-aaaag-qjuoq-cai';
const ICP_LEDGER = 'ryjl3-tyaaa-aaaaa-aaaba-cai';
const POOL_FEE = 3000n; // the only tier ICPSwap uses today
const SwapError = (IDL) => IDL.Variant({ CommonError: IDL.Null, InternalError: IDL.Text, UnsupportedToken: IDL.Text, InsufficientFunds: IDL.Null });
const passcodeIdl = ({ IDL }) => IDL.Service({
    metadata: IDL.Func([], [IDL.Record({ tokenCid: IDL.Principal, factoryCid: IDL.Principal, passcodePrice: IDL.Nat, governanceCid: IDL.Principal })], ['query']),
    balanceOf: IDL.Func([IDL.Principal], [IDL.Nat], ['query']),
    depositFrom: IDL.Func([IDL.Record({ amount: IDL.Nat, fee: IDL.Nat })], [IDL.Variant({ ok: IDL.Nat, err: SwapError(IDL) })], []),
    withdraw: IDL.Func([IDL.Record({ amount: IDL.Nat, fee: IDL.Nat })], [IDL.Variant({ ok: IDL.Nat, err: SwapError(IDL) })], []),
    requestPasscode: IDL.Func([IDL.Principal, IDL.Principal, IDL.Nat], [IDL.Variant({ ok: IDL.Text, err: SwapError(IDL) })], []),
});
const calculatorIdl = ({ IDL }) => IDL.Service({
    sortToken: IDL.Func([IDL.Text, IDL.Text], [IDL.Text, IDL.Text], ['query']),
    getSqrtPriceX96: IDL.Func([IDL.Float64, IDL.Float64, IDL.Float64], [IDL.Int], ['query']),
});
const TICK_SPACING = { 500: 10, 3000: 60, 10000: 200 };

// ---- v3 math: price <-> tick, amounts <-> liquidity (floats are fine for display and sizing; the pool decides) ----
const sqrtAtTick = (t) => 1.0001 ** (t / 2);
const tickAtPrice = (p) => Math.floor(Math.log(p) / Math.log(1.0001)); // p = token1 per token0, base units
const alignDown = (t, s) => Math.floor(t / s) * s;
const alignUp = (t, s) => Math.ceil(t / s) * s;
function amountsForLiquidity(L, tickLower, tickUpper, sqrtP) {
    const sl = sqrtAtTick(tickLower); const su = sqrtAtTick(tickUpper);
    if (sqrtP <= sl) return { amount0: L * (su - sl) / (sl * su), amount1: 0, inRange: false };
    if (sqrtP >= su) return { amount0: 0, amount1: L * (su - sl), inRange: false };
    return { amount0: L * (su - sqrtP) / (sqrtP * su), amount1: L * (sqrtP - sl), inRange: true };
}
/// Liquidity a range can take for given base-unit amounts at the current price (the smaller side binds).
function liquidityFor(amount0, amount1, tickLower, tickUpper, sqrtP) {
    const sl = sqrtAtTick(tickLower); const su = sqrtAtTick(tickUpper);
    if (sqrtP <= sl) return amount0 * (sl * su) / (su - sl);
    if (sqrtP >= su) return amount1 / (su - sl);
    const l0 = amount0 * (sqrtP * su) / (su - sqrtP); const l1 = amount1 / (sqrtP - sl);
    return Math.min(l0, l1);
}
const fmtUnits = (v, d, max = 6) => (Number(v) / 10 ** d).toLocaleString('en-US', { maximumFractionDigits: Math.min(d, max) });
const toUnits = (text, d) => { const t = String(text).trim(); if (!/^\d*(\.\d*)?$/.test(t) || t === '' || t === '.') return null; const [w, f = ''] = t.split('.'); return BigInt(w || '0') * 10n ** BigInt(d) + BigInt((f + '0'.repeat(d)).slice(0, d) || '0'); };
const fmtPrice = (p) => (p >= 1000 ? p.toLocaleString('en-US', { maximumFractionDigits: 2 }) : p.toPrecision(6).replace(/\.?0+$/, ''));
const errText = (e) => (e && typeof e === 'object' ? ('InternalError' in e ? e.InternalError : 'UnsupportedToken' in e ? `unsupported token ${e.UnsupportedToken}` : Object.keys(e)[0]) : String(e));

function Position() {
    const { theme } = useTheme();
    const navigate = useNavigate();
    const [params] = useSearchParams();
    const { identity, isAuthenticated } = useAuth();
    const { formatValue } = useDenomination();
    const walletCtx = useWalletOptional();
    const meText = identity?.getPrincipal?.().toText?.() || null;
    const me = useMemo(() => (meText ? Principal.fromText(meText) : null), [meText]);
    const poolId = params.get('swap') || '';
    const positionParam = params.get('id') || params.get('position');
    const positionId = positionParam && /^\d+$/.test(positionParam) ? BigInt(positionParam) : null;

    const [pool, setPool] = useState(null);        // { poolId, fee, token0, token1 } from describeSwapPool
    const [meta, setMeta] = useState(null);        // pool metadata: sqrtPriceX96, tick, liquidity
    const [standards, setStandards] = useState({}); // ledger -> 'icrc2' | 'icrc1'
    const [position, setPosition] = useState(null); // { liquidity, tickLower, tickUpper, tokensOwed0, tokensOwed1 }
    const [owner, setOwner] = useState('unknown'); // 'me' | 'sneedlock' | 'other' | 'unknown'
    const [lock, setLock] = useState(null);
    const [unused, setUnused] = useState(null);    // { balance0, balance1 }
    const [wallet, setWallet] = useState(null);    // { b0, b1 } my ledger balances
    const [usd, setUsd] = useState(null);          // { p0, p1 } USD per whole token, for the chosen denomination
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [tab, setTab] = useState('add');
    const [busy, setBusy] = useState('');          // current step text while an action runs
    const [log, setLog] = useState([]);            // step log of the last action
    const [done, setDone] = useState(null);
    // action inputs
    const [amt, setAmt] = useState({ a0: '', a1: '', last: 0 });
    const [removePct, setRemovePct] = useState(50);
    const [range, setRange] = useState({ preset: 'p25', lower: '', upper: '' });
    const [recipient, setRecipient] = useState('');
    const [custody, setCustody] = useState(null); // ClaimedPosition when Sneed Lock holds this position for me
    const [arrival, setArrival] = useState({ status: 'idle', checks: 0, arrived: [] }); // foreign position: watch for it to become mine
    const arrivalRef = useRef(null);
    const [create, setCreate] = useState({ t0: '', t1: '', price: '', info: null, checking: false, exists: null, passcodePrice: null, suggestion: null, suggesting: false });
    const runLock = useRef(false);

    const say = (m) => setLog((l) => [...l, `${new Date().toLocaleTimeString()} ${m}`]);
    const agent = useMemo(() => (identity ? new HttpAgent({ host: HOST, identity }) : null), [identity]);
    const poolActor = useCallback(() => createIcpSwapActor(poolId, { agentOptions: { host: HOST, ...(identity ? { identity } : {}) } }), [poolId, identity]);

    // ---- loading ----
    const load = useCallback(async () => {
        if (!poolId) return;
        setLoading(true); setError('');
        try {
            const p = await describeSwapPool(poolId);
            setPool(p);
            const a = poolActor();
            const m = await a.metadata();
            if (!('ok' in m)) throw new Error(errText(m.err));
            setMeta({ sqrtPriceX96: BigInt(m.ok.sqrtPriceX96), tick: Number(m.ok.tick), liquidity: BigInt(m.ok.liquidity), fee: Number(m.ok.fee) });
            Promise.all([get_token_conversion_rate(p.token0.ledgerId, p.token0.decimals).catch(() => null), get_token_conversion_rate(p.token1.ledgerId, p.token1.decimals).catch(() => null)]).then(([p0, p1]) => setUsd({ p0: p0 || null, p1: p1 || null }));
            if (agent) {
                const [i0, i1] = await Promise.all([getTokenInfo(p.token0.ledgerId, agent).catch(() => null), getTokenInfo(p.token1.ledgerId, agent).catch(() => null)]);
                setStandards({ [p.token0.ledgerId]: i0?.supportedStandards?.includes('icrc2') ? 'icrc2' : 'icrc1', [p.token1.ledgerId]: i1?.supportedStandards?.includes('icrc2') ? 'icrc2' : 'icrc1' });
            }
            if (positionId !== null) {
                const r = await a.getUserPosition(positionId);
                if (!('ok' in r)) throw new Error(`position #${positionId}: ${errText(r.err)}`);
                setPosition({ liquidity: BigInt(r.ok.liquidity), tickLower: Number(r.ok.tickLower), tickUpper: Number(r.ok.tickUpper), tokensOwed0: BigInt(r.ok.tokensOwed0), tokensOwed1: BigInt(r.ok.tokensOwed1) });
                let who = 'unknown'; let lk = null;
                if (me) {
                    const mine = await a.getUserPositionIdsByPrincipal(me);
                    if ('ok' in mine && mine.ok.some((id) => BigInt(id) === positionId)) who = 'me';
                    // the wallet already resolved ownership for its own pools; trust it when the pool query disagrees
                    const lp = (walletCtx?.liquidityPositions || []).find((x) => (typeof x.swapCanisterId === 'string' ? x.swapCanisterId : x.swapCanisterId?.toText?.()) === poolId);
                    const inWallet = lp?.positions?.find((x) => BigInt(x.positionId) === positionId);
                    if (who !== 'me' && inWallet?.frontendOwnership) who = 'me';
                }
                let held = null;
                if (who !== 'me') {
                    try {
                        const sl = createSneedLockActor(sneedLockCanisterId, me ? { agentOptions: { identity } } : undefined);
                        const locks = await sl.get_swap_position_locks(Principal.fromText(poolId));
                        const found = lockFromLocks(positionId, locks);
                        if (found) { who = 'sneedlock'; lk = found[2]; } else who = 'other';
                        if (me) {
                            // Sneed Lock may hold it for me without an active lock (lock ended, or deposited and never locked)
                            const claimed = await sl.get_claimed_positions_for_principal(me);
                            held = claimed.find((c) => c.swap_canister_id.toText() === poolId && BigInt(c.position_id) === positionId) || null;
                            if (held) who = 'sneedlock';
                        }
                    } catch { who = who === 'unknown' ? 'other' : who; }
                }
                setOwner(who); setLock(lk); setCustody(held);
            } else { setPosition(null); setOwner('me'); setLock(null); }
            if (me) {
                const [u, b0, b1] = await Promise.all([
                    a.getUserUnusedBalance(me).catch(() => null),
                    createLedgerActor(p.token0.ledgerId, { agentOptions: { host: HOST } }).icrc1_balance_of({ owner: me, subaccount: [] }).catch(() => null),
                    createLedgerActor(p.token1.ledgerId, { agentOptions: { host: HOST } }).icrc1_balance_of({ owner: me, subaccount: [] }).catch(() => null),
                ]);
                setUnused(u && 'ok' in u ? { balance0: BigInt(u.ok.balance0), balance1: BigInt(u.ok.balance1) } : null);
                setWallet({ b0: b0 === null ? null : BigInt(b0), b1: b1 === null ? null : BigInt(b1) });
            }
        } catch (e) { setError(e?.message || String(e)); }
        finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [poolId, positionId, meText, agent, poolActor]);
    useEffect(() => { load(); }, [load]);
    useEffect(() => { setTab(positionId === null ? 'new' : 'add'); setDone(null); setLog([]); }, [positionId, poolId]);

    // ---- derived ----
    const d0 = pool?.token0.decimals ?? 8; const d1 = pool?.token1.decimals ?? 8;
    const sqrtP = meta ? Number(meta.sqrtPriceX96) / 2 ** 96 : null;
    const priceBase = sqrtP !== null ? sqrtP * sqrtP : null; // token1 base units per token0 base unit
    const priceHuman = priceBase !== null ? priceBase * 10 ** (d0 - d1) : null; // token1 per token0
    const tickSpacing = TICK_SPACING[meta?.fee] || 60;
    const posAmounts = position && sqrtP !== null ? amountsForLiquidity(Number(position.liquidity), position.tickLower, position.tickUpper, sqrtP) : null;
    const tickToHuman = (t) => 1.0001 ** t * 10 ** (d0 - d1);
    const canAct = isAuthenticated && !!me && owner === 'me' && !busy;

    // the range for a new position or a move
    const chosenTicks = useMemo(() => {
        if (!meta) return null;
        const cur = meta.tick;
        const pct = { p10: 0.10, p25: 0.25, p50: 0.50 }[range.preset];
        if (range.preset === 'full') return { lower: alignUp(MIN_TICK, tickSpacing), upper: alignDown(MAX_TICK, tickSpacing) };
        if (pct !== undefined) {
            const lo = tickAtPrice((1.0001 ** cur) * (1 - pct)); const hi = tickAtPrice((1.0001 ** cur) * (1 + pct));
            return { lower: alignDown(lo, tickSpacing), upper: alignUp(hi, tickSpacing) };
        }
        const lp = Number(range.lower); const up = Number(range.upper);
        if (!(lp > 0) || !(up > lp)) return null;
        const lo = tickAtPrice(lp / 10 ** (d0 - d1)); const hi = tickAtPrice(up / 10 ** (d0 - d1));
        return { lower: alignDown(lo, tickSpacing), upper: alignUp(hi, tickSpacing) };
    }, [meta, range, tickSpacing, d0, d1]);

    /// Keep the two amounts consistent with the price and the range: the last edited side rules.
    const pairFor = (ticks) => (text, side) => {
        if (!meta || !ticks) return { a0: side === 0 ? text : '', a1: side === 1 ? text : '' };
        const units = toUnits(text, side === 0 ? d0 : d1);
        if (units === null) return { a0: side === 0 ? text : amt.a0, a1: side === 1 ? text : amt.a1 };
        const L = side === 0 ? liquidityFor(Number(units), Infinity, ticks.lower, ticks.upper, sqrtP) : liquidityFor(Infinity, Number(units), ticks.lower, ticks.upper, sqrtP);
        const other = amountsForLiquidity(L, ticks.lower, ticks.upper, sqrtP);
        const o = side === 0 ? other.amount1 / 10 ** d1 : other.amount0 / 10 ** d0;
        const oText = Number.isFinite(o) ? o.toFixed(Math.min(side === 0 ? d1 : d0, 8)).replace(/\.?0+$/, '') : '0';
        return side === 0 ? { a0: text, a1: oText } : { a0: oText, a1: text };
    };

    // ---- the pool playbook ----
    const readUnused = async (a) => { const u = await a.getUserUnusedBalance(me); if (!('ok' in u)) throw new Error(`unused balance: ${errText(u.err)}`); return { balance0: BigInt(u.ok.balance0), balance1: BigInt(u.ok.balance1) }; };
    const withdrawAll = async (a, why) => {
        const u = await readUnused(a);
        for (const [bal, tok] of [[u.balance0, pool.token0], [u.balance1, pool.token1]]) {
            if (bal > tok.fee) {
                say(`${why}: withdrawing ${fmtUnits(bal, tok.decimals)} ${tok.symbol} to your wallet`);
                const r = await a.withdraw({ token: tok.ledgerId, amount: bal, fee: tok.fee });
                if (!('err' in r)) continue;
                throw new Error(`withdraw ${tok.symbol}: ${errText(r.err)}`);
            }
        }
    };
    /// Put `amount` of a token into my balance inside the pool (ICRC-2 pull, or transfer-then-deposit).
    const depositInto = async (a, tok, amount) => {
        if (amount <= 0n) return;
        const std = standards[tok.ledgerId] || 'icrc1';
        const poolP = Principal.fromText(poolId);
        if (std === 'icrc2') {
            const needed = amount + tok.fee;
            const { allowance } = await checkAllowance(tok.ledgerId, agent, me, poolP);
            if (allowance < needed) { say(`approving ${tok.symbol} for the pool`); await approve(tok.ledgerId, agent, poolP, needed); }
            say(`depositing ${fmtUnits(amount, tok.decimals)} ${tok.symbol}`);
            const r = await a.depositFrom({ token: tok.ledgerId, amount, fee: tok.fee });
            if ('err' in r) throw new Error(`deposit ${tok.symbol}: ${errText(r.err)}`);
        } else {
            say(`sending ${fmtUnits(amount + tok.fee, tok.decimals)} ${tok.symbol} to your pool subaccount`);
            await transfer(tok.ledgerId, agent, poolP, amount + tok.fee, principalToSubAccount(me));
            say(`depositing ${tok.symbol}`);
            const r = await a.deposit({ token: tok.ledgerId, amount, fee: tok.fee });
            if ('err' in r) throw new Error(`deposit ${tok.symbol}: ${errText(r.err)}`);
        }
    };
    const run = async (label, fn) => {
        if (runLock.current) return;
        runLock.current = true; setBusy(label); setLog([]); setDone(null); setError('');
        try { const r = await fn(poolActor()); setDone(r || `${label}: done`); }
        catch (e) { setError(`${label}: ${e?.message || String(e)}`); say('stopped; anything left in the pool shows under "In the pool" and can be withdrawn'); }
        finally { runLock.current = false; setBusy(''); load(); }
    };

    const doWithdrawUnused = () => run('Withdraw', async (a) => { await withdrawAll(a, 'unused balance'); });
    const doCollect = () => run('Collect fees', async (a) => {
        say(`collecting fees of position #${positionId}`);
        const r = await a.claim({ positionId: Number(positionId) });
        if ('err' in r) throw new Error(errText(r.err));
        say(`collected ${fmtUnits(r.ok.amount0, d0)} ${pool.token0.symbol} and ${fmtUnits(r.ok.amount1, d1)} ${pool.token1.symbol}`);
        await withdrawAll(a, 'fees');
    });
    const requireQuiet = async (a) => {
        const u = await readUnused(a);
        if (u.balance0 > pool.token0.fee || u.balance1 > pool.token1.fee) throw new Error('you still have an unused balance in this pool; withdraw it first (button under "In the pool") so the amounts are unambiguous');
    };
    const doAdd = () => run('Add liquidity', async (a) => {
        const u0 = toUnits(amt.a0 || '0', d0); const u1 = toUnits(amt.a1 || '0', d1);
        if (u0 === null || u1 === null || (u0 === 0n && u1 === 0n)) throw new Error('enter an amount');
        await requireQuiet(a);
        await depositInto(a, pool.token0, u0); await depositInto(a, pool.token1, u1);
        const u = await readUnused(a);
        say(`adding ${fmtUnits(u.balance0, d0)} ${pool.token0.symbol} + ${fmtUnits(u.balance1, d1)} ${pool.token1.symbol} to position #${positionId}`);
        const r = await a.increaseLiquidity({ positionId: Number(positionId), amount0Desired: u.balance0.toString(), amount1Desired: u.balance1.toString() });
        if ('err' in r) throw new Error(errText(r.err));
        await withdrawAll(a, 'leftovers');
        return `Liquidity added to position #${positionId}.`;
    });
    const doRemove = (pct) => run(pct >= 100 ? 'Remove all liquidity' : `Remove ${pct}%`, async (a) => {
        const part = pct >= 100 ? position.liquidity : (position.liquidity * BigInt(Math.round(pct * 100))) / 10000n;
        if (part <= 0n) throw new Error('nothing to remove');
        say(`removing ${pct}% of the liquidity of position #${positionId}`);
        const r = await a.decreaseLiquidity({ positionId: Number(positionId), liquidity: part.toString() });
        if ('err' in r) throw new Error(errText(r.err));
        say(`freed ${fmtUnits(r.ok.amount0, d0)} ${pool.token0.symbol} and ${fmtUnits(r.ok.amount1, d1)} ${pool.token1.symbol}`);
        await withdrawAll(a, 'removed liquidity');
        return pct >= 100 ? `Position #${positionId} emptied; the tokens are in your wallet.` : `${pct}% removed; the tokens are in your wallet.`;
    });
    const mintWithUnused = async (a, ticks) => {
        const u = await readUnused(a);
        if (u.balance0 <= 0n && u.balance1 <= 0n) throw new Error('nothing deposited to mint with');
        say(`minting a position in ticks ${ticks.lower} to ${ticks.upper} with ${fmtUnits(u.balance0, d0)} ${pool.token0.symbol} + ${fmtUnits(u.balance1, d1)} ${pool.token1.symbol}`);
        const r = await a.mint({ token0: pool.token0.ledgerId, token1: pool.token1.ledgerId, fee: BigInt(meta.fee), tickLower: BigInt(ticks.lower), tickUpper: BigInt(ticks.upper), amount0Desired: u.balance0.toString(), amount1Desired: u.balance1.toString() });
        if ('err' in r) throw new Error(`mint: ${errText(r.err)}`);
        const newId = BigInt(r.ok);
        say(`position #${newId} minted`);
        await withdrawAll(a, 'leftovers');
        return newId;
    };
    const doMove = () => run('Move range', async (a) => {
        if (!chosenTicks) throw new Error('choose a valid range');
        await requireQuiet(a);
        say(`removing all liquidity of position #${positionId}`);
        const r = await a.decreaseLiquidity({ positionId: Number(positionId), liquidity: position.liquidity.toString() });
        if ('err' in r) throw new Error(`remove: ${errText(r.err)}`);
        if (position.tokensOwed0 > 0n || position.tokensOwed1 > 0n) { say('collecting its fees'); const c = await a.claim({ positionId: Number(positionId) }); if ('err' in c) say(`fee claim failed (${errText(c.err)}), continuing`); }
        const newId = await mintWithUnused(a, chosenTicks);
        setTimeout(() => navigate(`/position?swap=${poolId}&id=${newId}`), 800);
        return `Moved: new position #${newId} (the old id #${positionId} is now empty).`;
    });
    const doNew = () => run('Create position', async (a) => {
        if (!chosenTicks) throw new Error('choose a valid range');
        const u0 = toUnits(amt.a0 || '0', d0); const u1 = toUnits(amt.a1 || '0', d1);
        if (u0 === null || u1 === null || (u0 === 0n && u1 === 0n)) throw new Error('enter an amount');
        await requireQuiet(a);
        await depositInto(a, pool.token0, u0); await depositInto(a, pool.token1, u1);
        const newId = await mintWithUnused(a, chosenTicks);
        setTimeout(() => navigate(`/position?swap=${poolId}&id=${newId}`), 800);
        return `Position #${newId} created and owned by your Sneed wallet.`;
    });
    const doTransfer = () => run('Transfer', async (a) => {
        let to; try { to = Principal.fromText(recipient.trim()); } catch { throw new Error('recipient: a principal is needed'); }
        say(`transferring position #${positionId} to ${to.toText()}`);
        const r = await a.transferPosition(me, to, Number(positionId));
        if ('err' in r) throw new Error(errText(r.err));
        return `Position #${positionId} transferred to ${to.toText()}.`;
    });

    const lockActive = (l) => l && l.expiry !== undefined && Number(BigInt(l.expiry) / 1000000n) > Date.now();
    const custodyUnlocked = !!custody && !lockActive(custody.position_lock?.[0]);
    const doWithdrawCustody = () => run('Withdraw from Sneed Lock', async () => {
        say(`asking Sneed Lock to hand position #${positionId} back to your wallet`);
        const sl = createSneedLockActor(sneedLockCanisterId, { agentOptions: { identity } });
        const r = await sl.transfer_position(me, Principal.fromText(poolId), positionId);
        if (r && typeof r === 'object' && 'err' in r) throw new Error(typeof r.err === 'string' ? r.err : JSON.stringify(r.err, (k, v) => (typeof v === 'bigint' ? v.toString() : v)));
        return `Position #${positionId} is back in your wallet; everything on this page works on it now.`;
    });
    // Foreign position: once the owner transfers it to this principal on ICPSwap, the page notices.
    const startArrivalWatch = () => {
        if (!me) return;
        if (arrivalRef.current) clearInterval(arrivalRef.current);
        setArrival({ status: 'watching', checks: 0, arrived: [] });
        const started = Date.now();
        const tick = async () => {
            try {
                const r = await poolActor().getUserPositionIdsByPrincipal(me);
                if ('ok' in r && r.ok.some((id) => BigInt(id) === positionId)) { clearInterval(arrivalRef.current); arrivalRef.current = null; setArrival({ status: 'arrived', checks: 0, arrived: [positionId.toString()] }); load(); return; }
                setArrival((a) => ({ ...a, checks: a.checks + 1 }));
            } catch { /* try again */ }
            if (Date.now() - started > 10 * 60 * 1000) { clearInterval(arrivalRef.current); arrivalRef.current = null; setArrival((a) => ({ ...a, status: 'timeout' })); }
        };
        arrivalRef.current = setInterval(tick, 15000);
    };
    const stopArrivalWatch = () => { if (arrivalRef.current) clearInterval(arrivalRef.current); arrivalRef.current = null; setArrival((a) => ({ ...a, status: 'idle' })); };
    useEffect(() => () => { if (arrivalRef.current) clearInterval(arrivalRef.current); }, []);

    // ---- creating a pool ----
    const checkPair = async () => {
        let p0, p1; try { p0 = Principal.fromText(create.t0.trim()).toText(); p1 = Principal.fromText(create.t1.trim()).toText(); } catch { setError('two ledger canister ids are needed'); return; }
        if (p0 === p1) { setError('two different tokens are needed'); return; }
        setCreate((c) => ({ ...c, checking: true, info: null, exists: null })); setError('');
        try {
            const anon = new HttpAgent({ host: HOST });
            const calc = Actor.createActor(calculatorIdl, { agent: anon, canisterId: SWAP_CALCULATOR });
            const [s0, s1] = await calc.sortToken(p0, p1);
            const [i0, i1, pm] = await Promise.all([getTokenInfo(s0, anon), getTokenInfo(s1, anon), Actor.createActor(passcodeIdl, { agent: anon, canisterId: PASSCODE_MANAGER }).metadata().catch(() => null)]);
            const std = (id, info) => (id === ICP_LEDGER ? 'ICP' : info?.supportedStandards?.includes('icrc2') ? 'ICRC2' : 'ICRC1');
            const token0 = { address: s0, standard: std(s0, i0) }; const token1 = { address: s1, standard: std(s1, i1) };
            const factory = createFactoryActor(icpSwapFactoryCanisterId, { agentOptions: { host: HOST } });
            const existing = await factory.getPool({ token0, token1, fee: POOL_FEE });
            setCreate((c) => ({ ...c, checking: false, info: { token0, token1, i0, i1 }, exists: 'ok' in existing ? existing.ok.canisterId.toText() : null, passcodePrice: pm ? BigInt(pm.passcodePrice) : null }));
            if (!('ok' in existing)) suggestPrice({ token0, token1, i0, i1 }, true);
        } catch (e) { setCreate((c) => ({ ...c, checking: false })); setError(`could not check the pair: ${e?.message || e}`); }
    };
    /// A starting price from pools that already exist: each token's price in USD through
    /// whatever route the price service finds, then the ratio. Fills the field when it was empty.
    const suggestPrice = async (info, fillIfEmpty) => {
        const { token0, token1, i0, i1 } = info || create.info || {};
        if (!token0) return;
        setCreate((c) => ({ ...c, suggesting: true, suggestion: null }));
        try {
            const [u0, u1] = await Promise.all([get_token_conversion_rate(token0.address, i0.decimals).catch(() => null), get_token_conversion_rate(token1.address, i1.decimals).catch(() => null)]);
            if (!(u0 > 0) || !(u1 > 0)) {
                const missing = [!(u0 > 0) ? i0.symbol : null, !(u1 > 0) ? i1.symbol : null].filter(Boolean).join(' and ');
                setCreate((c) => ({ ...c, suggesting: false, suggestion: { price: null, note: `no existing pool gives a price for ${missing}; set the starting price yourself` } }));
                return;
            }
            const price = u0 / u1; // token1 per token0
            const text = price >= 1000 ? price.toFixed(2) : price.toPrecision(6).replace(/\.?0+$/, '');
            setCreate((c) => ({ ...c, suggesting: false, suggestion: { price: text, note: `${i0.symbol} ≈ ${formatValue(u0)} and ${i1.symbol} ≈ ${formatValue(u1)} on existing pools, so ${text} ${i1.symbol} per ${i0.symbol}` }, price: fillIfEmpty && !c.price ? text : c.price }));
        } catch (e) { setCreate((c) => ({ ...c, suggesting: false, suggestion: { price: null, note: `could not look up prices: ${e?.message || e}` } })); }
    };
    const doCreatePool = () => run('Create pool', async () => {
        const { token0, token1, i0, i1 } = create.info || {};
        if (!token0) throw new Error('check the pair first');
        const price = Number(create.price);
        if (!(price > 0)) throw new Error(`a starting price is needed: how many ${i1.symbol} one ${i0.symbol} is worth`);
        const anon = new HttpAgent({ host: HOST });
        const calc = Actor.createActor(calculatorIdl, { agent: anon, canisterId: SWAP_CALCULATOR });
        const sqrt = await calc.getSqrtPriceX96(price, i0.decimals, i1.decimals);
        say(`starting price ${price} ${i1.symbol} per ${i0.symbol} (sqrtPriceX96 ${sqrt})`);
        const pm = Actor.createActor(passcodeIdl, { agent, canisterId: PASSCODE_MANAGER });
        const meta = await pm.metadata();
        const priceIcp = BigInt(meta.passcodePrice); const icpFee = 10_000n;
        const have = BigInt(await pm.balanceOf(me));
        if (have < priceIcp) {
            const need = priceIcp - have;
            say(`buying the passcode: ${fmtUnits(need, 8)} ICP to ICPSwap's PasscodeManager`);
            const { allowance } = await checkAllowance(ICP_LEDGER, agent, me, Principal.fromText(PASSCODE_MANAGER));
            if (allowance < need + icpFee) await approve(ICP_LEDGER, agent, Principal.fromText(PASSCODE_MANAGER), need + icpFee);
            const d = await pm.depositFrom({ amount: need, fee: icpFee });
            if ('err' in d) throw new Error(`deposit to PasscodeManager: ${errText(d.err)}`);
        } else say('the PasscodeManager already holds your passcode price from an earlier try');
        say('requesting the passcode');
        const pc = await pm.requestPasscode(Principal.fromText(token0.address), Principal.fromText(token1.address), POOL_FEE);
        if ('err' in pc) throw new Error(`passcode: ${errText(pc.err)}`);
        say('creating the pool');
        const factory = createFactoryActor(icpSwapFactoryCanisterId, { agentOptions: { identity, host: HOST } });
        const r = await factory.createPool({ token0, token1, fee: POOL_FEE, sqrtPriceX96: sqrt.toString(), subnet: [] });
        if ('err' in r) throw new Error(`createPool: ${errText(r.err)}`);
        const newPool = r.ok.canisterId.toText();
        say(`pool ${newPool} created`);
        setTimeout(() => navigate(`/position?swap=${newPool}`), 800);
        return `Pool ${newPool} created for ${i0.symbol}/${i1.symbol}. Add the first position below.`;
    });

    // ---- rendering ----
    const card = { border: `1px solid ${theme.colors.border}`, borderRadius: 14, padding: '1rem 1.1rem', background: theme.colors.cardBg, marginBottom: '1rem' };
    const input = { padding: '8px 10px', borderRadius: 8, border: `1px solid ${theme.colors.border}`, background: theme.colors.primaryBg, color: theme.colors.primaryText, fontSize: '0.9rem', width: '100%', boxSizing: 'border-box' };
    const label = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.82rem', color: theme.colors.secondaryText };
    const btn = (isPrimary, disabled) => ({ padding: '9px 14px', borderRadius: 10, border: `1px solid ${isPrimary ? primary : theme.colors.border}`, background: isPrimary ? primary : 'transparent', color: isPrimary ? '#fff' : theme.colors.primaryText, fontWeight: 700, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.6 : 1, display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: '0.85rem' });
    const tabStyle = (active) => ({ padding: '8px 14px', borderRadius: 10, border: `1px solid ${active ? primary : theme.colors.border}`, background: active ? `${primary}22` : 'transparent', color: theme.colors.primaryText, cursor: 'pointer', fontSize: '0.85rem', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 6 });
    const mono = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', fontSize: '0.8rem' };
    const sym0 = pool?.token0.symbol || 'token0'; const sym1 = pool?.token1.symbol || 'token1';

    const amountInputs = (ticks) => (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
            <label style={label}>{sym0}{wallet?.b0 !== null && wallet?.b0 !== undefined && <span style={{ color: theme.colors.mutedText }}> · in wallet {fmtUnits(wallet.b0, d0)}</span>}
                <input style={input} value={amt.a0} onChange={(e) => setAmt({ ...pairFor(ticks)(e.target.value, 0), last: 0 })} placeholder="0" />
            </label>
            <label style={label}>{sym1}{wallet?.b1 !== null && wallet?.b1 !== undefined && <span style={{ color: theme.colors.mutedText }}> · in wallet {fmtUnits(wallet.b1, d1)}</span>}
                <input style={input} value={amt.a1} onChange={(e) => setAmt({ ...pairFor(ticks)(e.target.value, 1), last: 1 })} placeholder="0" />
            </label>
            <div style={{ gridColumn: '1 / -1', fontSize: '0.78rem', color: theme.colors.mutedText }}>Type one side; the other follows from the current price and the range. Each token costs two ledger fees on the way in (approval or transfer, then deposit). Whatever the range cannot use comes straight back.</div>
        </div>
    );
    const rangePicker = (
        <div style={{ display: 'grid', gap: 8 }}>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {[['p10', '±10%'], ['p25', '±25%'], ['p50', '±50%'], ['full', 'Full range'], ['custom', 'Custom']].map(([k, t]) => (
                    <button key={k} type="button" style={tabStyle(range.preset === k)} onClick={() => setRange((r) => ({ ...r, preset: k }))}>{t}</button>
                ))}
            </div>
            {range.preset === 'custom' && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
                    <label style={label}>Lower price ({sym1} per {sym0})<input style={input} value={range.lower} onChange={(e) => setRange((r) => ({ ...r, lower: e.target.value }))} placeholder={priceHuman ? fmtPrice(priceHuman * 0.8) : ''} /></label>
                    <label style={label}>Upper price<input style={input} value={range.upper} onChange={(e) => setRange((r) => ({ ...r, upper: e.target.value }))} placeholder={priceHuman ? fmtPrice(priceHuman * 1.25) : ''} /></label>
                </div>
            )}
            {chosenTicks && <div style={{ fontSize: '0.8rem', color: theme.colors.secondaryText }}>Range {fmtPrice(tickToHuman(chosenTicks.lower))} to {fmtPrice(tickToHuman(chosenTicks.upper))} {sym1} per {sym0} (ticks {chosenTicks.lower} to {chosenTicks.upper}, spacing {tickSpacing}). {meta && (meta.tick < chosenTicks.lower || meta.tick >= chosenTicks.upper) ? 'The current price is outside it: only one token goes in until the price enters the range.' : 'The current price is inside it.'}</div>}
        </div>
    );

    return (
        <div className="page-container" style={{ background: theme.colors.primaryGradient, minHeight: '100vh' }}>
            <style>{customStyles}</style>
            <Header />
            <main style={{ maxWidth: 980, margin: '0 auto', padding: '1.25rem 16px 3rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', marginBottom: '1rem' }}>
                    <div style={{ width: 52, height: 52, borderRadius: 14, background: `${primary}22`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><FaWater size={24} color={primary} /></div>
                    <div style={{ flex: 1, minWidth: 220 }}>
                        <h1 style={{ margin: 0, fontSize: '1.6rem', fontWeight: 800, color: theme.colors.primaryText }}>{positionId !== null ? `Position #${positionId}` : 'New liquidity position'} <Link to={poolId ? `/positions?swap=${poolId}` : '/positions'} style={{ fontSize: '0.8rem', fontWeight: 600, color: primary, marginLeft: 10 }}>browse positions</Link></h1>
                        <div style={{ color: theme.colors.secondaryText, fontSize: '0.9rem' }}>ICPSwap liquidity, managed from your Sneed wallet: create, add, remove, collect, move the range, transfer, lock. Every step runs as you against the pool canister; nothing passes through Sneed.</div>
                    </div>
                </div>

                {!poolId && (
                    <div style={card}>
                        <h2 style={{ margin: '0 0 8px', fontSize: '1.05rem', color: theme.colors.primaryText }}>Which pool?</h2>
                        <SwapPoolPicker onPoolChange={(id, p, status) => { if (status === 'ready' && p) navigate(`/position?swap=${id}`); }} accentColor={primary} />
                        <div style={{ marginTop: 16, paddingTop: 12, borderTop: `1px solid ${theme.colors.border}` }}>
                            <h2 style={{ margin: '0 0 6px', fontSize: '1.05rem', color: theme.colors.primaryText }}>No pool for the pair yet? Create one</h2>
                            <div style={{ fontSize: '0.82rem', color: theme.colors.secondaryText, marginBottom: 10, lineHeight: 1.5 }}>ICPSwap sells pool creation through its PasscodeManager: the price is read from it live (1 ICP in production), paid from your wallet, and the pool is then created on the ICPSwap factory as you. The pool belongs to ICPSwap; your first position is minted into it right after.</div>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 10 }}>
                                <div><TokenSelector value={create.t0} onChange={(id) => setCreate((c) => ({ ...c, t0: id, info: null, exists: null }))} placeholder="First token (pick, or a ledger id)" allowCustom /></div>
                                <div><TokenSelector value={create.t1} onChange={(id) => setCreate((c) => ({ ...c, t1: id, info: null, exists: null }))} placeholder="Second token" allowCustom /></div>
                            </div>
                            <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                                <button type="button" style={btn(false, create.checking || !create.t0 || !create.t1)} disabled={create.checking || !create.t0 || !create.t1} onClick={checkPair}>{create.checking ? <FaSpinner className="health-spin" /> : null} Check the pair</button>
                                {create.exists && <span style={{ fontSize: '0.85rem', color: theme.colors.secondaryText }}>A pool exists already: <Link to={`/position?swap=${create.exists}`} style={{ color: primary }}>open it</Link></span>}
                            </div>
                            {create.info && !create.exists && (
                                <div style={{ marginTop: 10, display: 'grid', gap: 10 }}>
                                    <div style={{ fontSize: '0.85rem', color: theme.colors.secondaryText }}>ICPSwap orders the pair as <b>{create.info.i0.symbol}</b> / <b>{create.info.i1.symbol}</b> ({create.info.token0.standard}, {create.info.token1.standard}). Passcode price: {create.passcodePrice !== null ? `${fmtUnits(create.passcodePrice, 8)} ICP` : 'unknown'} plus ledger fees.</div>
                                    <label style={label}>Starting price: {create.info.i1.symbol} per one {create.info.i0.symbol}
                                        <div style={{ display: 'flex', gap: 8 }}>
                                            <input style={input} value={create.price} onChange={(e) => setCreate((c) => ({ ...c, price: e.target.value }))} placeholder="e.g. 0.5" />
                                            <button type="button" style={btn(false, create.suggesting)} disabled={create.suggesting} onClick={() => suggestPrice(null, false).then(() => setCreate((c) => (c.suggestion?.price ? { ...c, price: c.suggestion.price } : c)))}>{create.suggesting ? <FaSpinner className="health-spin" /> : null} Suggest</button>
                                        </div>
                                    </label>
                                    {create.suggestion && <div style={{ fontSize: '0.8rem', color: create.suggestion.price ? '#22c55e' : '#f59e0b' }}>{create.suggestion.note}</div>}
                                    <div style={{ fontSize: '0.78rem', color: theme.colors.mutedText }}>The first position sets the real price; this only places the pool's starting tick. A suggestion comes from the tokens' prices on pools that already exist (through whatever route the price service finds); check it against where you intend to trade, or your first position will be one-sided.</div>
                                    <div><button type="button" style={btn(true, !!busy || !isAuthenticated || !create.price)} disabled={!!busy || !isAuthenticated || !create.price} onClick={doCreatePool}>{busy === 'Create pool' ? <FaSpinner className="health-spin" /> : <FaPlus size={12} />} Buy the passcode and create the pool</button></div>
                                </div>
                            )}
                            {(busy === 'Create pool' || (log.length > 0 && !pool)) && (
                                <div style={{ marginTop: 12, padding: 10, borderRadius: 10, background: theme.colors.secondaryBg, fontSize: '0.8rem', color: theme.colors.secondaryText }}>
                                    {busy && <div style={{ color: theme.colors.primaryText, fontWeight: 700 }}><FaSpinner className="health-spin" /> {busy}…</div>}
                                    {done && <div style={{ color: '#22c55e', fontWeight: 700 }}><FaCheck /> {done}</div>}
                                    {error && <div style={{ color: '#ef4444' }}>{error}</div>}
                                    <pre style={{ ...mono, whiteSpace: 'pre-wrap', margin: 0 }}>{log.join('\n')}</pre>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {poolId && (
                    <div style={card}>
                        {loading && !pool && <div style={{ color: theme.colors.mutedText }}><FaSpinner className="health-spin" /> Reading the pool…</div>}
                        {pool && (
                            <>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                                    <div style={{ display: 'flex' }}>
                                        {[pool.token0, pool.token1].map((t, i) => t.logo ? <img key={i} src={t.logo} alt={t.symbol} style={{ width: 36, height: 36, borderRadius: 18, marginLeft: i ? -10 : 0, background: theme.colors.secondaryBg, border: `2px solid ${theme.colors.cardBg}` }} /> : <div key={i} style={{ width: 36, height: 36, borderRadius: 18, marginLeft: i ? -10 : 0, background: theme.colors.secondaryBg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, color: theme.colors.mutedText }}>{t.symbol.slice(0, 2)}</div>)}
                                    </div>
                                    <div style={{ flex: 1, minWidth: 200 }}>
                                        <div style={{ fontWeight: 800, color: theme.colors.primaryText, fontSize: '1.1rem' }}>{sym0}/{sym1} <span style={{ color: theme.colors.mutedText, fontWeight: 400, fontSize: '0.85rem' }}>fee {(Number(pool.fee) / 10000).toFixed(2)}%</span></div>
                                        <div style={{ ...mono, color: theme.colors.mutedText }}>{poolId} <a href={`https://app.icpswap.com/liquidity/position?pool=${poolId}`} target="_blank" rel="noopener noreferrer" style={{ color: primary, marginLeft: 6 }}>ICPSwap <FaExternalLinkAlt size={9} /></a></div>
                                        {priceHuman !== null && <div style={{ fontSize: '0.88rem', color: theme.colors.secondaryText }}>Price {fmtPrice(priceHuman)} {sym1} per {sym0} ({fmtPrice(1 / priceHuman)} {sym0} per {sym1}), tick {meta.tick}</div>}
                                    </div>
                                    <button type="button" style={btn(false, loading)} disabled={loading} onClick={load}><FaSync size={11} className={loading ? 'health-spin' : undefined} /> Refresh</button>
                                </div>

                                {position && posAmounts && (
                                    <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, fontSize: '0.88rem', color: theme.colors.secondaryText }}>
                                        <div><div style={{ color: theme.colors.mutedText, fontSize: '0.75rem', textTransform: 'uppercase' }}>Range</div>{fmtPrice(tickToHuman(position.tickLower))} to {fmtPrice(tickToHuman(position.tickUpper))} {sym1} per {sym0}<div style={{ color: posAmounts.inRange ? '#22c55e' : '#f59e0b', fontWeight: 700 }}>{posAmounts.inRange ? 'in range, earning fees' : 'out of range, earning nothing'}</div></div>
                                        <div><div style={{ color: theme.colors.mutedText, fontSize: '0.75rem', textTransform: 'uppercase' }}>Holds</div>{fmtUnits(posAmounts.amount0, d0)} {sym0}<br />{fmtUnits(posAmounts.amount1, d1)} {sym1}{usd && (usd.p0 || usd.p1) && <div style={{ color: theme.colors.primaryText, fontWeight: 700 }}>{formatValue(posAmounts.amount0 / 10 ** d0 * (usd.p0 || 0) + posAmounts.amount1 / 10 ** d1 * (usd.p1 || 0))}</div>}</div>
                                        <div><div style={{ color: theme.colors.mutedText, fontSize: '0.75rem', textTransform: 'uppercase' }}>Uncollected fees</div>{fmtUnits(position.tokensOwed0, d0)} {sym0}<br />{fmtUnits(position.tokensOwed1, d1)} {sym1}{usd && (usd.p0 || usd.p1) && <div style={{ color: theme.colors.primaryText, fontWeight: 700 }}>{formatValue(Number(position.tokensOwed0) / 10 ** d0 * (usd.p0 || 0) + Number(position.tokensOwed1) / 10 ** d1 * (usd.p1 || 0))}</div>}</div>
                                        <div><div style={{ color: theme.colors.mutedText, fontSize: '0.75rem', textTransform: 'uppercase' }}>Owner</div>{owner === 'me' ? 'you (Sneed wallet)' : owner === 'sneedlock' ? <span><FaLock size={11} /> locked in Sneed Lock{lock?.expiry ? (isUntilDissolved(lock.expiry) ? <>, until <LockUntil lockId={lock.lock_id} expiry={lock.expiry} fmt={(d) => d.toLocaleDateString()} /></> : `, until ${new Date(Number(BigInt(lock.expiry) / 1000000n)).toLocaleDateString()}`) : ''}</span> : owner === 'other' ? 'someone else' : '…'}<br /><span style={{ color: theme.colors.mutedText }}>liquidity {position.liquidity.toString()}</span></div>
                                    </div>
                                )}

                                {me && unused && (unused.balance0 > 0n || unused.balance1 > 0n) && (
                                    <div style={{ marginTop: 12, padding: 10, borderRadius: 10, background: '#f59e0b14', border: '1px solid #f59e0b55', fontSize: '0.85rem', color: theme.colors.primaryText, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                                        <span><b>In the pool, not in a position:</b> {fmtUnits(unused.balance0, d0)} {sym0} and {fmtUnits(unused.balance1, d1)} {sym1} sit in your balance inside the pool (a step stopped before they were used, or they are left over).</span>
                                        <button type="button" style={btn(true, !!busy || !isAuthenticated)} disabled={!!busy || !isAuthenticated} onClick={doWithdrawUnused}><FaArrowUp size={11} /> Withdraw to wallet</button>
                                    </div>
                                )}
                                {!isAuthenticated && <div style={{ marginTop: 10, color: theme.colors.mutedText, fontSize: '0.85rem' }}>Log in with your Sneed wallet to act on this position.</div>}
                                {positionId !== null && owner === 'other' && (
                                    <div style={{ marginTop: 12, padding: 12, borderRadius: 10, background: `${primary}10`, border: `1px solid ${primary}40`, fontSize: '0.88rem', color: theme.colors.primaryText }}>
                                        <div style={{ fontWeight: 700, marginBottom: 4 }}>Is this your position?</div>
                                        <div style={{ color: theme.colors.secondaryText, marginBottom: 6 }}>It is not owned by {isAuthenticated ? 'your Sneed wallet' : 'a Sneed wallet you are logged in with'}, so this page can only show it. A position created on ICPSwap belongs to your ICPSwap login; transfer it to your Sneed wallet principal and everything here works on it: add, remove, collect, move the range, lock.</div>
                                        <PositionTransferGuide token0Symbol={sym0} token1Symbol={sym1} compact accentColor={primary} intro="" watch={arrival} onWatch={isAuthenticated ? startArrivalWatch : undefined} onStopWatch={stopArrivalWatch} />
                                    </div>
                                )}
                                {isAuthenticated && owner === 'sneedlock' && custodyUnlocked && (
                                    <div style={{ marginTop: 12, padding: 12, borderRadius: 10, background: '#22c55e14', border: '1px solid #22c55e55', fontSize: '0.88rem', color: theme.colors.primaryText, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                                        <span><b>Sneed Lock holds this position for you, and it is not locked.</b> Withdraw it to your wallet to manage it here.</span>
                                        <button type="button" style={btn(true, !!busy)} disabled={!!busy} onClick={doWithdrawCustody}>{busy === 'Withdraw from Sneed Lock' ? <FaSpinner className="health-spin" /> : <FaArrowUp size={11} />} Withdraw to my wallet</button>
                                    </div>
                                )}
                                {isAuthenticated && owner === 'sneedlock' && !custodyUnlocked && <div style={{ marginTop: 10, color: '#f59e0b', fontSize: '0.85rem' }}>Locked positions cannot be changed until the lock ends; that is what the lock is for. Fees on locked positions are collected from the wallet card.</div>}
                            </>
                        )}
                        {error && !busy && <div style={{ marginTop: 10, color: '#ef4444', fontSize: '0.88rem' }}>{error}</div>}
                    </div>
                )}

                {pool && meta && (positionId === null ? (owner === 'me' && isAuthenticated) : canAct || busy) && (
                    <div style={card}>
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
                            {positionId === null ? (
                                <button type="button" style={tabStyle(true)}><FaPlus size={11} /> New position</button>
                            ) : (
                                <>
                                    <button type="button" style={tabStyle(tab === 'add')} onClick={() => setTab('add')}><FaPlus size={11} /> Add</button>
                                    <button type="button" style={tabStyle(tab === 'remove')} onClick={() => setTab('remove')}><FaMinus size={11} /> Remove</button>
                                    <button type="button" style={tabStyle(tab === 'collect')} onClick={() => setTab('collect')}><FaCoins size={11} /> Collect fees</button>
                                    <button type="button" style={tabStyle(tab === 'move')} onClick={() => setTab('move')}><FaExchangeAlt size={11} /> Move range</button>
                                    <button type="button" style={tabStyle(tab === 'transfer')} onClick={() => setTab('transfer')}><FaArrowUp size={11} /> Transfer</button>
                                    <Link to={`/lock_wizard?type=position&token=${pool.token0.ledgerId}`} style={{ ...tabStyle(false), textDecoration: 'none' }}><FaLock size={11} /> Lock in Sneed Lock</Link>
                                </>
                            )}
                        </div>

                        {positionId === null && (
                            <div style={{ display: 'grid', gap: 12 }}>
                                <div style={{ fontSize: '0.85rem', color: theme.colors.secondaryText }}>The position is minted to your Sneed wallet principal, so it shows up under your liquidity at once and can be locked right after.</div>
                                {rangePicker}
                                {amountInputs(chosenTicks)}
                                <div><button type="button" style={btn(true, !!busy || !chosenTicks)} disabled={!!busy || !chosenTicks} onClick={doNew}>{busy === 'Create position' ? <FaSpinner className="health-spin" /> : <FaPlus size={12} />} Deposit and mint</button></div>
                            </div>
                        )}
                        {positionId !== null && tab === 'add' && (
                            <div style={{ display: 'grid', gap: 12 }}>
                                {amountInputs(position ? { lower: position.tickLower, upper: position.tickUpper } : null)}
                                <div><button type="button" style={btn(true, !!busy)} disabled={!!busy} onClick={doAdd}>{busy === 'Add liquidity' ? <FaSpinner className="health-spin" /> : <FaPlus size={12} />} Deposit and add</button></div>
                            </div>
                        )}
                        {positionId !== null && tab === 'remove' && (
                            <div style={{ display: 'grid', gap: 12 }}>
                                <label style={label}>How much: {removePct}%<input type="range" min={1} max={100} value={removePct} onChange={(e) => setRemovePct(Number(e.target.value))} /></label>
                                {posAmounts && <div style={{ fontSize: '0.85rem', color: theme.colors.secondaryText }}>About {fmtUnits(posAmounts.amount0 * removePct / 100, d0)} {sym0} and {fmtUnits(posAmounts.amount1 * removePct / 100, d1)} {sym1} come back to your wallet, plus the uncollected fees when you remove everything.</div>}
                                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                    <button type="button" style={btn(true, !!busy)} disabled={!!busy} onClick={() => doRemove(removePct)}>{busy.startsWith('Remove') ? <FaSpinner className="health-spin" /> : <FaMinus size={12} />} Remove {removePct}% and withdraw</button>
                                    <button type="button" style={btn(false, !!busy)} disabled={!!busy} onClick={() => doRemove(100)}>Remove everything</button>
                                </div>
                            </div>
                        )}
                        {positionId !== null && tab === 'collect' && (
                            <div style={{ display: 'grid', gap: 12 }}>
                                <div style={{ fontSize: '0.85rem', color: theme.colors.secondaryText }}>Uncollected: {fmtUnits(position?.tokensOwed0 || 0n, d0)} {sym0} and {fmtUnits(position?.tokensOwed1 || 0n, d1)} {sym1}. Collecting moves them into your balance inside the pool; they are withdrawn to your wallet in the same go.</div>
                                <div><button type="button" style={btn(true, !!busy)} disabled={!!busy} onClick={doCollect}>{busy === 'Collect fees' ? <FaSpinner className="health-spin" /> : <FaCoins size={12} />} Collect and withdraw</button></div>
                            </div>
                        )}
                        {positionId !== null && tab === 'move' && (
                            <div style={{ display: 'grid', gap: 12 }}>
                                <div style={{ fontSize: '0.85rem', color: theme.colors.secondaryText }}>A range cannot be changed in place. Moving removes all liquidity from #{positionId}, collects its fees, mints a new position with the new range from what came out, and withdraws what the new range cannot use. The new position gets a new id; this page follows it.</div>
                                {rangePicker}
                                <div><button type="button" style={btn(true, !!busy || !chosenTicks)} disabled={!!busy || !chosenTicks} onClick={doMove}>{busy === 'Move range' ? <FaSpinner className="health-spin" /> : <FaExchangeAlt size={12} />} Remove, re-mint, withdraw leftovers</button></div>
                            </div>
                        )}
                        {positionId !== null && tab === 'transfer' && (
                            <div style={{ display: 'grid', gap: 12 }}>
                                <div style={{ fontSize: '0.85rem', color: theme.colors.secondaryText }}>Transfers ownership of the position on ICPSwap to another principal: another Sneed wallet, or an ICPSwap login (its principal is shown on ICPSwap's wallet page). The recipient then manages it from the matching place.</div>
                                <PrincipalInput value={recipient} onChange={setRecipient} placeholder="Recipient principal or name" defaultTab="all" style={{ width: '100%' }} inputStyle={input} />
                                <div><button type="button" style={btn(true, !!busy || !recipient)} disabled={!!busy || !recipient} onClick={doTransfer}>{busy === 'Transfer' ? <FaSpinner className="health-spin" /> : <FaArrowUp size={12} />} Transfer position</button></div>
                            </div>
                        )}

                        {(busy || log.length > 0 || done) && (
                            <div style={{ marginTop: 14, padding: 10, borderRadius: 10, background: theme.colors.secondaryBg, fontSize: '0.8rem', color: theme.colors.secondaryText }}>
                                {busy && <div style={{ color: theme.colors.primaryText, fontWeight: 700, marginBottom: 4 }}><FaSpinner className="health-spin" /> {busy}…</div>}
                                {done && <div style={{ color: '#22c55e', fontWeight: 700, marginBottom: 4 }}><FaCheck /> {done}</div>}
                                {error && <div style={{ color: '#ef4444', marginBottom: 4 }}>{error}</div>}
                                <pre style={{ ...mono, whiteSpace: 'pre-wrap', margin: 0 }}>{log.join('\n')}</pre>
                            </div>
                        )}
                    </div>
                )}

                <div style={{ color: theme.colors.mutedText, fontSize: '0.78rem', lineHeight: 1.6 }}>
                    How it works: ICPSwap keeps a balance per user inside each pool. Tokens go in by an ICRC-2 pull (after an approval) or by a transfer to your subaccount of the pool followed by a deposit; positions are minted or grown from that balance; removing liquidity and collecting fees land there too, and a withdraw moves it to your wallet. This page never starts a deposit while that balance is non-zero, uses exactly what was deposited, and withdraws what is left, so a stopped step leaves nothing behind that it does not show you.
                </div>
            </main>
        </div>
    );
}

export default Position;
