// AddLiquidityModal.jsx
// Add liquidity to a locked ICPSwap position from the user's backend wallet.
import React, { useState, useEffect, useMemo } from 'react';
import { formatAmount, parseAmountToBigInt } from './utils/StringUtils';
import { useTheme } from './contexts/ThemeContext';

const accent = '#3b82f6';
const accentDark = '#2563eb';

const idText = (p) => (p && p.toText ? p.toText() : (p?.toString?.() ?? String(p)));

// Plain decimal string (no locale separators) for prefilling an input.
const toPlainAmount = (value, decimals) => {
  const d = Number(decimals);
  const str = BigInt(value).toString().padStart(d + 1, '0');
  const intPart = str.slice(0, str.length - d);
  const fracPart = d > 0 ? str.slice(str.length - d).replace(/0+$/, '') : '';
  return fracPart ? `${intPart}.${fracPart}` : intPart;
};

function AddLiquidityModal({ show, onClose, position, positionDetails, tokens, onAddLiquidity }) {
  const { theme } = useTheme();
  const [amount0, setAmount0] = useState('');
  const [amount1, setAmount1] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorText, setErrorText] = useState('');
  const [result, setResult] = useState(null);

  useEffect(() => {
    if (show) {
      setAmount0('');
      setAmount1('');
      setErrorText('');
      setResult(null);
      setIsLoading(false);
    }
  }, [show]);

  const token0Id = position ? idText(position.token0) : null;
  const token1Id = position ? idText(position.token1) : null;
  const decimals0 = position ? Number(position.token0Decimals ?? 8) : 8;
  const decimals1 = position ? Number(position.token1Decimals ?? 8) : 8;
  const symbol0 = position?.token0Symbol ?? 'token0';
  const symbol1 = position?.token1Symbol ?? 'token1';

  const walletToken0 = useMemo(() => (tokens || []).find(t => idText(t.principal ?? t.ledger_canister_id) === token0Id), [tokens, token0Id]);
  const walletToken1 = useMemo(() => (tokens || []).find(t => idText(t.principal ?? t.ledger_canister_id) === token1Id), [tokens, token1Id]);

  // Current position amounts define the ratio the pool will accept at the
  // current price. A zero on one side means the position is out of range and
  // only the other token is needed.
  const posAmount0 = positionDetails?.token0Amount !== undefined ? BigInt(positionDetails.token0Amount) : 0n;
  const posAmount1 = positionDetails?.token1Amount !== undefined ? BigInt(positionDetails.token1Amount) : 0n;
  const needs0 = posAmount0 > 0n || posAmount1 === 0n;
  const needs1 = posAmount1 > 0n || posAmount0 === 0n;
  const canMatch = posAmount0 > 0n && posAmount1 > 0n;

  const inRange = posAmount0 > 0n && posAmount1 > 0n;

  // The pool only ever adds at the position's current ratio, so the two inputs
  // stay linked both ways while the position is in range.
  const deriveOther = (value, fromSide) => {
    if (!canMatch) return;
    let base;
    try { base = parseAmountToBigInt(value, fromSide === 0 ? decimals0 : decimals1); } catch { return; }
    if (base <= 0n) return;
    if (fromSide === 0) {
      setAmount1(toPlainAmount(base * posAmount1 / posAmount0, decimals1));
    } else {
      setAmount0(toPlainAmount(base * posAmount0 / posAmount1, decimals0));
    }
  };

  // Pure plan for one token: where the funds come from and which fees apply.
  //   needs amount + fee in the backend wallet (fee = transfer into the pool);
  //   any shortfall is topped up from the frontend wallet at one more fee.
  const planToken = (amt, walletToken, symbol, decimals) => {
    if (amt === 0n) return { topUp: 0n, feeCount: 0, fee: 0n, error: null };
    if (!walletToken) return { topUp: 0n, feeCount: 0, fee: 0n, error: `${symbol}: add this token to your wallet first so its balances are known.` };
    const fee = BigInt(walletToken.fee ?? 0);
    if (amt <= 2n * fee) return { topUp: 0n, feeCount: 2, fee, error: `${symbol}: amount must exceed two transaction fees (${formatAmount(2n * fee, decimals)}).` };
    const backend = BigInt(walletToken.available_backend ?? 0);
    const frontend = BigInt(walletToken.balance ?? 0);
    const needed = amt + fee;
    if (needed <= backend) return { topUp: 0n, feeCount: 2, fee, error: null };
    const topUp = needed - backend;
    if (topUp + fee > frontend) {
      return { topUp: 0n, feeCount: 3, fee, error: `${symbol}: not enough across both wallets. Maximum you can add is ${formatAmount(maxAddable(walletToken), decimals)} after fees.` };
    }
    return { topUp, feeCount: 3, fee, error: null };
  };

  // Largest amount of one token that both wallets can fund after fees:
  // backend minus the pool-transfer fee, plus frontend minus its transfer fee.
  const maxAddable = (walletToken) => {
    if (!walletToken) return 0n;
    const fee = BigInt(walletToken.fee ?? 0);
    const backend = BigInt(walletToken.available_backend ?? 0);
    const frontend = BigInt(walletToken.balance ?? 0);
    const total = backend + (frontend > fee ? frontend - fee : 0n);
    const max = total > fee ? total - fee : 0n;
    return max > 2n * fee ? max : 0n;
  };

  // MAX: the largest entry for this side that the ratio still lets the other
  // side fund, so neither side is the one that fails validation.
  const handleMax = (side) => {
    const own = maxAddable(side === 0 ? walletToken0 : walletToken1);
    let value = own;
    if (canMatch) {
      const otherMax = maxAddable(side === 0 ? walletToken1 : walletToken0);
      const otherLimitedHere = side === 0
        ? otherMax * posAmount0 / posAmount1
        : otherMax * posAmount1 / posAmount0;
      if (otherLimitedHere < value) value = otherLimitedHere;
    }
    const text = toPlainAmount(value, side === 0 ? decimals0 : decimals1);
    if (side === 0) setAmount0(text); else setAmount1(text);
    deriveOther(text, side);
  };

  // Live plan for the fee breakdown shown under the inputs.
  const livePlan = useMemo(() => {
    const parse = (text, decimals) => { try { return text.trim() === '' ? 0n : parseAmountToBigInt(text, decimals); } catch { return null; } };
    const a0 = parse(amount0, decimals0);
    const a1 = parse(amount1, decimals1);
    if (a0 === null || a1 === null) return null;
    return { a0, a1, p0: planToken(a0, walletToken0, symbol0, decimals0), p1: planToken(a1, walletToken1, symbol1, decimals1) };
  }, [amount0, amount1, walletToken0, walletToken1]);

  const handleSubmit = async () => {
    setErrorText('');
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
    const p0 = planToken(a0, walletToken0, symbol0, decimals0);
    const p1 = planToken(a1, walletToken1, symbol1, decimals1);
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
        walletToken0,
        walletToken1
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
    flex: '1',
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
    const walletToken = side === 0 ? walletToken0 : walletToken1;
    const value = side === 0 ? amount0 : amount1;
    const setValue = side === 0 ? setAmount0 : setAmount1;
    return (
      <div style={{ marginBottom: '1rem' }}>
        <label style={{ display: 'block', color: theme.colors.primaryText, marginBottom: '0.4rem', fontWeight: '500', fontSize: '0.9rem' }}>
          {symbol}
          <span style={{ color: theme.colors.mutedText, fontSize: '0.8rem', marginLeft: '0.5rem' }}>
            {walletToken
              ? `wallet: ${formatAmount(walletToken.balance ?? 0n, decimals)} · backend wallet: ${formatAmount(walletToken.available_backend ?? 0n, decimals)}`
              : 'not in your wallet list'}
          </span>
        </label>
        {needed ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <input
              type="text"
              inputMode="decimal"
              value={value}
              disabled={isLoading}
              onChange={(e) => { setValue(e.target.value); deriveOther(e.target.value, side); }}
              placeholder="0.00"
              style={inputStyle}
            />
            <button
              onClick={() => handleMax(side)}
              disabled={isLoading || !walletToken}
              style={{
                background: `linear-gradient(135deg, ${accent}, ${accentDark})`, color: 'white', border: 'none',
                borderRadius: '10px', padding: '0.875rem 1rem', cursor: (isLoading || !walletToken) ? 'not-allowed' : 'pointer',
                fontSize: '0.85rem', fontWeight: '600', opacity: (isLoading || !walletToken) ? 0.6 : 1
              }}
            >
              MAX
            </button>
          </div>
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
                        {plan.topUp > 0n
                          ? ` — ${formatAmount(plan.topUp, decimals)} moved from your wallet, the rest from your backend wallet`
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
                disabled={isLoading}
                style={{
                  width: '100%', background: `linear-gradient(135deg, ${accent}, ${accentDark})`, color: 'white',
                  border: 'none', borderRadius: '10px', padding: '0.875rem', cursor: isLoading ? 'not-allowed' : 'pointer',
                  fontWeight: '600', opacity: isLoading ? 0.7 : 1
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
