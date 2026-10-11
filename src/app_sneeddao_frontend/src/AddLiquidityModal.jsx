// AddLiquidityModal.jsx
// Add liquidity to a locked ICPSwap position. Funds come from the user's
// backend wallet (their subaccount on sneed_lock) first and any shortfall is
// moved over from the frontend wallet.
//
// The dialog reads every balance it needs directly from the ledgers and from
// sneed_lock when it opens, keyed strictly by the position's own token ledgers.
// It deliberately does not depend on the wallet page's token list, which is
// rebuilt during refreshes and may not contain these tokens at all.
import React, { useState, useEffect, useMemo } from 'react';
import { Principal } from '@dfinity/principal';
import { formatAmount, parseAmountToBigInt } from './utils/StringUtils';
import { readBackendWalletBalance } from './utils/FeeForwarding';
import { createActor as createLedgerActor } from 'external/icrc1_ledger';
import { createActor as createSneedLockActor, canisterId as sneedLockCanisterId } from 'declarations/sneed_lock';
import { useTheme } from './contexts/ThemeContext';
import { principalText } from './utils/IdUtils';

const accent = '#3b82f6';
const accentDark = '#2563eb';

const idText = (p) => principalText(p);
const toPrincipal = (p) => Principal.fromText(principalText(p));

// Plain decimal string (no locale separators) for prefilling an input.
const toPlainAmount = (value, decimals) => {
  const d = Number(decimals);
  const str = BigInt(value).toString().padStart(d + 1, '0');
  const intPart = str.slice(0, str.length - d);
  const fracPart = d > 0 ? str.slice(str.length - d).replace(/0+$/, '') : '';
  return fracPart ? `${intPart}.${fracPart}` : intPart;
};

// Balances for one token of the position: ledger fee, frontend wallet balance,
// backend wallet balance and the part of it that is locked.
const loadFunds = async (ledgerId, identity, lockedByLedger) => {
  const principal = toPrincipal(ledgerId);
  const ledger = createLedgerActor(principal);
  const user = identity.getPrincipal();
  const [fee, frontend, backend] = await Promise.all([
    ledger.icrc1_fee().then(BigInt),
    ledger.icrc1_balance_of({ owner: user, subaccount: [] }).then(BigInt),
    readBackendWalletBalance(principal, user)
  ]);
  const locked = lockedByLedger.get(principal.toText()) ?? 0n;
  const availableBackend = backend > locked ? backend - locked : 0n;
  return { fee, frontend, backend, locked, availableBackend };
};

function AddLiquidityModal({ show, onClose, position, positionDetails, identity, onAddLiquidity }) {
  const { theme } = useTheme();
  const [amount0, setAmount0] = useState('');
  const [amount1, setAmount1] = useState('');
  const [funds, setFunds] = useState(null);        // { f0, f1 } once loaded
  const [fundsError, setFundsError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorText, setErrorText] = useState('');
  const [result, setResult] = useState(null);

  const token0Id = position ? idText(position.token0) : null;
  const token1Id = position ? idText(position.token1) : null;
  const decimals0 = position ? Number(position.token0Decimals ?? 8) : 8;
  const decimals1 = position ? Number(position.token1Decimals ?? 8) : 8;
  const symbol0 = position?.token0Symbol ?? 'token0';
  const symbol1 = position?.token1Symbol ?? 'token1';

  // Load balances for exactly this position's two ledgers whenever the dialog opens.
  useEffect(() => {
    if (!show || !position || !identity) return;
    let cancelled = false;
    setAmount0('');
    setAmount1('');
    setErrorText('');
    setResult(null);
    setIsLoading(false);
    setFunds(null);
    setFundsError('');
    (async () => {
      try {
        const sneedLock = createSneedLockActor(sneedLockCanisterId, { agentOptions: { identity } });
        const summed = await sneedLock.get_summed_locks();
        const lockedByLedger = new Map(summed.map(([ledger, amount]) => [idText(ledger), BigInt(amount)]));
        const [f0, f1] = await Promise.all([
          loadFunds(token0Id, identity, lockedByLedger),
          loadFunds(token1Id, identity, lockedByLedger)
        ]);
        if (!cancelled) setFunds({ f0, f1 });
      } catch (e) {
        console.error('Failed to load balances for add liquidity:', e);
        if (!cancelled) setFundsError('Could not load your balances. Please close and try again.');
      }
    })();
    return () => { cancelled = true; };
  }, [show, token0Id, token1Id, identity]);

  // Current position amounts define the ratio the pool will accept at the
  // current price. A zero on one side means the position is out of range and
  // only the other token is needed.
  const posAmount0 = positionDetails?.token0Amount !== undefined ? BigInt(positionDetails.token0Amount) : 0n;
  const posAmount1 = positionDetails?.token1Amount !== undefined ? BigInt(positionDetails.token1Amount) : 0n;
  const needs0 = posAmount0 > 0n || posAmount1 === 0n;
  const needs1 = posAmount1 > 0n || posAmount0 === 0n;
  const inRange = posAmount0 > 0n && posAmount1 > 0n;

  // The pool only ever adds at the position's current ratio, so the two inputs
  // stay linked both ways while the position is in range.
  const deriveOther = (value, fromSide) => {
    if (!inRange) return;
    let base;
    try { base = parseAmountToBigInt(value, fromSide === 0 ? decimals0 : decimals1); } catch { return; }
    if (base <= 0n) return;
    if (fromSide === 0) {
      setAmount1(toPlainAmount(base * posAmount1 / posAmount0, decimals1));
    } else {
      setAmount0(toPlainAmount(base * posAmount0 / posAmount1, decimals0));
    }
  };

  // Largest amount of one token that both wallets can fund after fees:
  // backend minus the pool-transfer fee, plus frontend minus its transfer fee.
  const maxAddable = (f) => {
    if (!f) return 0n;
    const total = f.availableBackend + (f.frontend > f.fee ? f.frontend - f.fee : 0n);
    const max = total > f.fee ? total - f.fee : 0n;
    return max > 2n * f.fee ? max : 0n;
  };

  // Plan for one token: where the funds come from and which fees apply.
  //   needs amount + fee in the backend wallet (fee = transfer into the pool);
  //   any shortfall is topped up from the frontend wallet at one more fee.
  const planToken = (amt, f, symbol, decimals) => {
    if (amt === 0n) return { topUp: 0n, feeCount: 0, fee: 0n, error: null };
    if (!f) return { topUp: 0n, feeCount: 0, fee: 0n, error: `${symbol}: balances not loaded yet.` };
    if (amt <= 2n * f.fee) return { topUp: 0n, feeCount: 2, fee: f.fee, error: `${symbol}: amount must exceed two transaction fees (${formatAmount(2n * f.fee, decimals)}).` };
    const needed = amt + f.fee;
    if (needed <= f.availableBackend) return { topUp: 0n, feeCount: 2, fee: f.fee, error: null };
    const topUp = needed - f.availableBackend;
    if (topUp + f.fee > f.frontend) {
      return { topUp: 0n, feeCount: 3, fee: f.fee, error: `${symbol}: not enough across both wallets. Maximum you can add is ${formatAmount(maxAddable(f), decimals)} after fees.` };
    }
    return { topUp, feeCount: 3, fee: f.fee, error: null };
  };

  // MAX: the most that both wallets can fund at the position's ratio. The side
  // that runs out first is set to its exact maximum and the other is derived
  // from it once (floored), so the result does not depend on which token the
  // user holds more of.
  const handleMax = () => {
    if (!funds) return;
    const max0 = maxAddable(funds.f0);
    const max1 = maxAddable(funds.f1);
    if (!inRange) {
      if (needs0) setAmount0(toPlainAmount(max0, decimals0));
      if (needs1) setAmount1(toPlainAmount(max1, decimals1));
      return;
    }
    const a1FromMax0 = max0 * posAmount1 / posAmount0;
    if (a1FromMax0 <= max1) {
      setAmount0(toPlainAmount(max0, decimals0));
      setAmount1(toPlainAmount(a1FromMax0, decimals1));
    } else {
      setAmount1(toPlainAmount(max1, decimals1));
      setAmount0(toPlainAmount(max1 * posAmount0 / posAmount1, decimals0));
    }
  };

  // Live plan for the fee breakdown shown under the inputs.
  const livePlan = useMemo(() => {
    if (!funds) return null;
    const parse = (text, decimals) => { try { return text.trim() === '' ? 0n : parseAmountToBigInt(text, decimals); } catch { return null; } };
    const a0 = parse(amount0, decimals0);
    const a1 = parse(amount1, decimals1);
    if (a0 === null || a1 === null) return null;
    return { a0, a1, p0: planToken(a0, funds.f0, symbol0, decimals0), p1: planToken(a1, funds.f1, symbol1, decimals1) };
  }, [amount0, amount1, funds]);

  const handleSubmit = async () => {
    setErrorText('');
    if (!funds) { setErrorText('Balances are still loading.'); return; }
    let a0 = 0n, a1 = 0n;
    try {
      a0 = amount0.trim() === '' ? 0n : parseAmountToBigInt(amount0, decimals0);
      a1 = amount1.trim() === '' ? 0n : parseAmountToBigInt(amount1, decimals1);
    } catch {
      setErrorText('Invalid amount. Please enter valid numbers.');
      return;
    }
    if (a0 < 0n || a1 < 0n || (a0 === 0n && a1 === 0n)) {
      setErrorText('Enter an amount for at least one token.');
      return;
    }
    const p0 = planToken(a0, funds.f0, symbol0, decimals0);
    const p1 = planToken(a1, funds.f1, symbol1, decimals1);
    if (p0.error || p1.error) {
      setErrorText([p0.error, p1.error].filter(Boolean).join(' '));
      return;
    }
    try {
      setIsLoading(true);
      const res = await onAddLiquidity({
        swapCanisterId: position.swapCanisterId,
        positionId: positionDetails.positionId,
        amount0: a0,
        amount1: a1,
        topUp0: p0.topUp,
        topUp1: p1.topUp,
        token0Ledger: token0Id,
        token1Ledger: token1Id,
        symbol0,
        symbol1
      });
      setResult(res);
    } catch (error) {
      console.error('Add liquidity failed:', error);
      setErrorText(error.message || error.toString());
    } finally {
      setIsLoading(false);
    }
  };

  if (!show || !position || !positionDetails) return null;

  const inputStyle = {
    width: '100%',
    padding: '0.875rem',
    background: theme.colors.secondaryBg,
    border: `1px solid ${theme.colors.border}`,
    borderRadius: '10px',
    color: theme.colors.primaryText,
    fontSize: '1rem',
    boxSizing: 'border-box',
    outline: 'none'
  };

  const renderInput = (side) => {
    const needed = side === 0 ? needs0 : needs1;
    const symbol = side === 0 ? symbol0 : symbol1;
    const decimals = side === 0 ? decimals0 : decimals1;
    const f = funds ? (side === 0 ? funds.f0 : funds.f1) : null;
    const value = side === 0 ? amount0 : amount1;
    const setValue = side === 0 ? setAmount0 : setAmount1;
    return (
      <div style={{ marginBottom: '1rem' }}>
        <label style={{ display: 'block', color: theme.colors.primaryText, marginBottom: '0.4rem', fontWeight: '500', fontSize: '0.9rem' }}>
          {symbol}
          <span style={{ color: theme.colors.mutedText, fontSize: '0.8rem', marginLeft: '0.5rem' }}>
            {f
              ? `wallet: ${formatAmount(f.frontend, decimals)} · backend wallet: ${formatAmount(f.availableBackend, decimals)}${f.locked > 0n ? ` (+${formatAmount(f.locked, decimals)} locked)` : ''}`
              : 'loading balances…'}
          </span>
        </label>
        {needed ? (
          <input
            type="text"
            inputMode="decimal"
            value={value}
            disabled={isLoading || !funds}
            onChange={(e) => { setValue(e.target.value); deriveOther(e.target.value, side); }}
            placeholder="0.00"
            style={inputStyle}
          />
        ) : (
          <div style={{ color: theme.colors.mutedText, fontSize: '0.85rem' }}>
            Not needed: the position is currently out of range on this side.
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, width: '100%', height: '100%',
      background: 'rgba(0, 0, 0, 0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 1000, backdropFilter: 'blur(4px)'
    }}>
      <div style={{
        background: `linear-gradient(135deg, ${theme.colors.primaryBg} 0%, ${accent}08 100%)`,
        border: `1px solid ${theme.colors.border}`,
        boxShadow: `0 20px 60px rgba(0, 0, 0, 0.4), 0 0 40px ${accent}15`,
        borderRadius: '16px', padding: '0', width: '480px', maxWidth: '90vw', maxHeight: '90vh', overflow: 'auto'
      }}>
        <div style={{
          background: `linear-gradient(135deg, ${accent}, ${accentDark})`,
          padding: '1.25rem 1.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between'
        }}>
          <h2 style={{ color: 'white', margin: 0, fontSize: '1.2rem', fontWeight: '600' }}>
            + Add Liquidity to Locked Position
          </h2>
          <button
            onClick={onClose}
            disabled={isLoading}
            style={{
              background: 'rgba(255, 255, 255, 0.2)', border: 'none', fontSize: '1.25rem',
              cursor: isLoading ? 'not-allowed' : 'pointer', color: 'white', width: '32px', height: '32px',
              borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center'
            }}
          >
            ×
          </button>
        </div>

        <div style={{ padding: '1.5rem' }}>
          <div style={{ color: theme.colors.mutedText, fontSize: '0.85rem', marginBottom: '1rem', lineHeight: 1.4 }}>
            {symbol0}/{symbol1} position #{String(positionDetails.positionId)}. Tokens are taken from your backend
            wallet first and, if that is not enough, the rest is moved over from your wallet automatically. Liquidity
            is added in the position's existing price range; anything the pool cannot use at the current price is
            returned to your backend wallet.
          </div>

          <div style={{
            display: 'inline-block', padding: '0.25rem 0.6rem', borderRadius: '999px', fontSize: '0.8rem', fontWeight: '600',
            marginBottom: '1rem',
            background: inRange ? '#22c55e22' : '#f59e0b22', color: inRange ? '#22c55e' : '#f59e0b',
            border: `1px solid ${inRange ? '#22c55e55' : '#f59e0b55'}`
          }}>
            {inRange
              ? 'In range: both tokens are added at the current ratio'
              : `Out of range: only ${needs0 ? symbol0 : symbol1} is needed right now`}
          </div>

          {fundsError && (
            <div style={{ color: '#ef4444', fontSize: '0.85rem', marginBottom: '1rem' }}>{fundsError}</div>
          )}

          {result ? (
            <div>
              <div style={{
                background: `linear-gradient(135deg, ${theme.colors.secondaryBg} 0%, ${accent}08 100%)`,
                borderRadius: '12px', padding: '1rem', marginBottom: '1rem', border: `1px solid ${accent}25`,
                color: theme.colors.primaryText, fontSize: '0.9rem', lineHeight: 1.6
              }}>
                <div><strong>Added:</strong> {formatAmount(result.used0, decimals0)} {symbol0} + {formatAmount(result.used1, decimals1)} {symbol1}</div>
                <div><strong>Returned to backend wallet:</strong> {formatAmount(result.returned0, decimals0)} {symbol0} + {formatAmount(result.returned1, decimals1)} {symbol1}</div>
                {result.increase_error && result.increase_error.length > 0 && (
                  <div style={{ color: '#f59e0b', marginTop: '0.5rem' }}>
                    The pool did not add liquidity: {result.increase_error[0]}
                  </div>
                )}
              </div>
              <button
                onClick={onClose}
                style={{
                  width: '100%', background: `linear-gradient(135deg, ${accent}, ${accentDark})`, color: 'white',
                  border: 'none', borderRadius: '10px', padding: '0.875rem', cursor: 'pointer', fontWeight: '600'
                }}
              >
                Done
              </button>
            </div>
          ) : (
            <div>
              {renderInput(0)}
              {renderInput(1)}

              <button
                onClick={handleMax}
                disabled={isLoading || !funds}
                style={{
                  background: 'transparent', color: accent, border: `1px solid ${accent}`, borderRadius: '10px',
                  padding: '0.5rem 1rem', cursor: (isLoading || !funds) ? 'not-allowed' : 'pointer', fontSize: '0.85rem', fontWeight: '600',
                  marginBottom: '1rem', opacity: (isLoading || !funds) ? 0.6 : 1
                }}
              >
                MAX — add as much as both wallets allow
              </button>

              {livePlan && (livePlan.a0 > 0n || livePlan.a1 > 0n) && (
                <div style={{
                  background: theme.colors.secondaryBg, borderRadius: '10px', padding: '0.75rem 1rem', marginBottom: '1rem',
                  color: theme.colors.primaryText, fontSize: '0.8rem', lineHeight: 1.6, border: `1px solid ${theme.colors.border}`
                }}>
                  <div style={{ fontWeight: '600', marginBottom: '0.25rem' }}>Fees for this configuration</div>
                  {[[livePlan.a0, livePlan.p0, symbol0, decimals0], [livePlan.a1, livePlan.p1, symbol1, decimals1]]
                    .filter(([amt]) => amt > 0n)
                    .map(([amt, plan, symbol, decimals]) => (
                      <div key={symbol}>
                        {symbol}: {plan.feeCount} transaction fee{plan.feeCount === 1 ? '' : 's'}
                        {plan.fee > 0n ? ` (${formatAmount(BigInt(plan.feeCount) * plan.fee, decimals)} ${symbol})` : ''}
                        {plan.error
                          ? ''
                          : plan.topUp > 0n
                            ? (plan.topUp >= amt + plan.fee
                                ? ' — all moved from your wallet'
                                : ` — ${formatAmount(plan.topUp, decimals)} moved from your wallet, the rest from your backend wallet`)
                            : ' — all from your backend wallet'}
                      </div>
                    ))}
                  <div style={{ color: theme.colors.mutedText }}>
                    Plus one fee per token if the pool returns an unused remainder.
                  </div>
                </div>
              )}

              {errorText && (
                <div style={{ color: '#ef4444', fontSize: '0.85rem', marginBottom: '1rem' }}>{errorText}</div>
              )}

              <button
                onClick={handleSubmit}
                disabled={isLoading || !funds}
                style={{
                  width: '100%', background: `linear-gradient(135deg, ${accent}, ${accentDark})`, color: 'white',
                  border: 'none', borderRadius: '10px', padding: '0.875rem', cursor: (isLoading || !funds) ? 'not-allowed' : 'pointer',
                  fontWeight: '600', opacity: (isLoading || !funds) ? 0.7 : 1
                }}
              >
                {isLoading ? 'Adding liquidity…' : 'Add Liquidity'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default AddLiquidityModal;
