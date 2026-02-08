import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { HttpAgent } from '@dfinity/agent';
import TokenSelector from './TokenSelector';
import {
  DexAggregator,
  ICPSwapDex,
  KongDex,
  SwapStep,
  DEFAULT_SLIPPAGE,
  getHost,
  getTokenInfo,
} from '../services/dex';
import priceService from '../services/PriceService';
import { createActor as createLedgerActor } from 'external/icrc1_ledger';

// ─── Constants ──────────────────────────────────────────────────────────────

const QUOTE_REFRESH_MS = 15_000;
const SWAP_BLUE = '#3498db';
const SWAP_PURPLE = '#8b5cf6';

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatAmount(raw, decimals) {
  if (raw === undefined || raw === null) return '0';
  const n = Number(raw) / (10 ** decimals);
  if (n === 0) return '0';
  if (n < 0.000001) return n.toExponential(4);
  if (n < 1) return n.toPrecision(6);
  return n.toLocaleString(undefined, { maximumFractionDigits: Math.min(decimals, 8) });
}

function parseToBigInt(str, decimals) {
  if (!str || str.trim() === '') return 0n;
  const parts = str.split('.');
  const whole = parts[0] || '0';
  let frac = (parts[1] || '').slice(0, decimals).padEnd(decimals, '0');
  return BigInt(whole) * BigInt(10 ** decimals) + BigInt(frac);
}

function formatUSD(amount) {
  if (amount === null || amount === undefined || isNaN(amount)) return null;
  if (amount === 0) return '$0.00';
  if (Math.abs(amount) < 0.01) return '<$0.01';
  return '$' + amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function SlippageSettings({ value, onChange }) {
  const presets = [0.5, 1, 2, 5];
  const [custom, setCustom] = useState('');
  const active = value * 100;

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap',
      padding: '8px 12px', borderRadius: 10,
      background: 'var(--color-primaryBg)',
      border: '1px solid var(--color-border)',
    }}>
      <span style={{ color: 'var(--color-mutedText)', fontSize: 12, fontWeight: 500 }}>Slippage</span>
      {presets.map(p => (
        <button
          key={p}
          onClick={() => { onChange(p / 100); setCustom(''); }}
          style={{
            padding: '4px 10px', borderRadius: 8, fontSize: 12, fontWeight: 600,
            cursor: 'pointer', transition: 'all 0.15s ease',
            border: Math.abs(active - p) < 0.001 ? '1px solid var(--color-accent)' : '1px solid var(--color-border)',
            background: Math.abs(active - p) < 0.001 ? 'var(--color-accent)' : 'transparent',
            color: Math.abs(active - p) < 0.001 ? '#fff' : 'var(--color-secondaryText)',
          }}
        >{p}%</button>
      ))}
      <input
        type="text"
        placeholder="Custom"
        value={custom}
        onChange={e => {
          setCustom(e.target.value);
          const n = parseFloat(e.target.value);
          if (!isNaN(n) && n > 0 && n < 100) onChange(n / 100);
        }}
        style={{
          width: 54, padding: '4px 8px', borderRadius: 8, fontSize: 12,
          border: '1px solid var(--color-border)', background: 'transparent',
          color: 'var(--color-primaryText)', outline: 'none',
        }}
      />
    </div>
  );
}

function QuoteCard({ quote, selected, onSelect, inputDecimals, outputDecimals, outputUsdPrice, isBest }) {
  const outputStr = formatAmount(quote.expectedOutput, outputDecimals);
  const minStr = formatAmount(quote.minimumOutput, outputDecimals);
  const impactPct = (quote.priceImpact * 100).toFixed(2);
  const feePct = (quote.dexFeePercent * 100).toFixed(2);
  const isRouted = quote.route?.length > 1;

  const outputNum = Number(quote.expectedOutput) / (10 ** outputDecimals);
  const usdValue = outputUsdPrice ? formatUSD(outputNum * outputUsdPrice) : null;

  return (
    <div
      className="swap-quote-card"
      onClick={onSelect}
      style={{
        padding: '12px 14px',
        borderRadius: 12,
        border: selected ? '1.5px solid var(--color-accent)' : '1px solid var(--color-border)',
        background: selected ? 'var(--color-accent)08' : 'var(--color-primaryBg)',
        cursor: 'pointer',
        position: 'relative',
      }}
    >
      {isBest && (
        <span style={{
          position: 'absolute', top: -8, right: 12,
          fontSize: 10, fontWeight: 700, padding: '2px 8px',
          borderRadius: 6, letterSpacing: '0.04em',
          background: 'linear-gradient(135deg, var(--color-success), #27ae60)',
          color: '#fff',
          boxShadow: '0 2px 8px rgba(46, 204, 113, 0.3)',
        }}>BEST</span>
      )}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--color-primaryText)' }}>{quote.dexName}</span>
          {isRouted && (
            <span style={{
              fontSize: 10, padding: '1px 6px', borderRadius: 4,
              background: 'var(--color-warning)', color: '#000', fontWeight: 600,
            }}>Multi-hop</span>
          )}
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--color-success)' }}>{outputStr}</div>
          {usdValue && (
            <div style={{ fontSize: 11, color: 'var(--color-mutedText)', fontWeight: 400 }}>{usdValue}</div>
          )}
        </div>
      </div>
      <div style={{
        display: 'flex', justifyContent: 'space-between',
        fontSize: 11, color: 'var(--color-mutedText)', marginTop: 6,
        paddingTop: 6, borderTop: '1px solid var(--color-border)',
      }}>
        <span>Min: {minStr}</span>
        <span>Impact: {impactPct}%</span>
        <span style={{ opacity: 0.7 }}>Fee: {feePct}%</span>
      </div>
    </div>
  );
}

function ProgressPanel({ progress }) {
  if (!progress) return null;
  const { step, message, stepIndex, totalSteps, completed, failed, error } = progress;

  const pct = totalSteps > 0 ? ((stepIndex + (completed ? 1 : 0.5)) / totalSteps) * 100 : 0;

  return (
    <div style={{
      padding: '14px 16px', borderRadius: 12,
      background: failed ? 'rgba(231, 76, 60, 0.06)' : completed ? 'rgba(46, 204, 113, 0.06)' : 'var(--color-primaryBg)',
      border: `1px solid ${failed ? 'var(--color-error)' : completed ? 'var(--color-success)' : 'var(--color-border)'}`,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 8 }}>
        <span style={{ color: 'var(--color-primaryText)', fontWeight: 500 }}>{message}</span>
        <span style={{ color: 'var(--color-mutedText)' }}>
          {completed ? 'Done' : failed ? 'Failed' : `${stepIndex + 1} / ${totalSteps}`}
        </span>
      </div>
      <div style={{
        height: 4, borderRadius: 2, background: 'var(--color-border)', overflow: 'hidden',
      }}>
        <div style={{
          height: '100%', borderRadius: 2,
          width: `${Math.min(pct, 100)}%`,
          background: failed
            ? 'var(--color-error)'
            : completed
              ? 'var(--color-success)'
              : `linear-gradient(90deg, ${SWAP_BLUE}, ${SWAP_PURPLE})`,
          transition: 'width 0.4s ease',
        }} />
      </div>
      {error && <div style={{ color: 'var(--color-error)', fontSize: 12, marginTop: 6 }}>{error}</div>}
    </div>
  );
}

// ─── Main Widget ────────────────────────────────────────────────────────────

export default function SwapWidget({ initialInput, initialOutput, onClose, onInputTokenChange, onOutputTokenChange, onSwapComplete }) {
  const { identity, isAuthenticated } = useAuth();
  const { theme } = useTheme();

  // ── State ──
  const [inputToken, setInputToken] = useState(initialInput || '');
  const [outputToken, setOutputToken] = useState(initialOutput || '');
  const [inputAmountStr, setInputAmountStr] = useState('');
  const [slippage, setSlippage] = useState(DEFAULT_SLIPPAGE);
  const [showSettings, setShowSettings] = useState(false);

  const [inputTokenInfo, setInputTokenInfo] = useState(null);
  const [outputTokenInfo, setOutputTokenInfo] = useState(null);

  const [quotes, setQuotes] = useState([]);
  const [selectedQuoteIdx, setSelectedQuoteIdx] = useState(0);
  const [loadingQuotes, setLoadingQuotes] = useState(false);
  const [quoteError, setQuoteError] = useState('');

  const [swapping, setSwapping] = useState(false);
  const [progress, setProgress] = useState(null);
  const [result, setResult] = useState(null);

  // Spot prices per DEX (fetched as soon as pair is selected)
  const [spotPrices, setSpotPrices] = useState(null);
  const [loadingSpot, setLoadingSpot] = useState(false);

  // USD prices
  const [inputUsdPrice, setInputUsdPrice] = useState(null);
  const [outputUsdPrice, setOutputUsdPrice] = useState(null);

  // Token balances
  const [inputBalance, setInputBalance] = useState(null);
  const [outputBalance, setOutputBalance] = useState(null);

  // Tracks when the aggregator is ready so dependent effects can re-fire
  const [aggregatorReady, setAggregatorReady] = useState(false);

  const aggregatorRef = useRef(null);
  const quoteTimerRef = useRef(null);

  // ── Token change handlers (also notify parent for URL updates) ──
  const handleSetInputToken = useCallback((tokenId) => {
    setInputToken(tokenId);
    onInputTokenChange?.(tokenId);
  }, [onInputTokenChange]);

  const handleSetOutputToken = useCallback((tokenId) => {
    setOutputToken(tokenId);
    onOutputTokenChange?.(tokenId);
  }, [onOutputTokenChange]);

  // ── Initialize aggregator ──
  useEffect(() => {
    if (!identity) return;

    const host = getHost();
    const agent = new HttpAgent({ host, identity });

    if (host.includes('localhost')) {
      agent.fetchRootKey().catch(console.warn);
    }

    const config = { identity, agent, host };
    const agg = new DexAggregator(config);
    agg.registerDex(new ICPSwapDex(config));
    agg.registerDex(new KongDex(config));
    aggregatorRef.current = agg;
    setAggregatorReady(true);

    return () => {
      if (quoteTimerRef.current) clearInterval(quoteTimerRef.current);
      setAggregatorReady(false);
    };
  }, [identity]);

  // ── Fetch token info when tokens change (or aggregator becomes ready) ──
  useEffect(() => {
    if (!inputToken || !aggregatorRef.current) { setInputTokenInfo(null); return; }
    const agent = aggregatorRef.current.config.agent;
    getTokenInfo(inputToken, agent).then(setInputTokenInfo).catch(() => setInputTokenInfo(null));
  }, [inputToken, aggregatorReady]);

  useEffect(() => {
    if (!outputToken || !aggregatorRef.current) { setOutputTokenInfo(null); return; }
    const agent = aggregatorRef.current.config.agent;
    getTokenInfo(outputToken, agent).then(setOutputTokenInfo).catch(() => setOutputTokenInfo(null));
  }, [outputToken, aggregatorReady]);

  // ── Fetch USD prices when token info is available ──
  useEffect(() => {
    if (!inputToken || !inputTokenInfo) { setInputUsdPrice(null); return; }
    let cancelled = false;
    priceService.getTokenUSDPrice(inputToken, inputTokenInfo.decimals)
      .then(price => { if (!cancelled) setInputUsdPrice(price); })
      .catch(() => { if (!cancelled) setInputUsdPrice(null); });
    return () => { cancelled = true; };
  }, [inputToken, inputTokenInfo]);

  useEffect(() => {
    if (!outputToken || !outputTokenInfo) { setOutputUsdPrice(null); return; }
    let cancelled = false;
    priceService.getTokenUSDPrice(outputToken, outputTokenInfo.decimals)
      .then(price => { if (!cancelled) setOutputUsdPrice(price); })
      .catch(() => { if (!cancelled) setOutputUsdPrice(null); });
    return () => { cancelled = true; };
  }, [outputToken, outputTokenInfo]);

  // ── Fetch token balances when authenticated ──
  const fetchBalances = useCallback(async () => {
    if (!identity || !isAuthenticated) {
      setInputBalance(null);
      setOutputBalance(null);
      return;
    }
    const principal = identity.getPrincipal();
    const account = { owner: principal, subaccount: [] };

    // Fetch input balance
    if (inputToken) {
      try {
        const actor = createLedgerActor(inputToken, { agentOptions: { identity } });
        const bal = await actor.icrc1_balance_of(account);
        setInputBalance(bal);
      } catch { setInputBalance(null); }
    } else {
      setInputBalance(null);
    }

    // Fetch output balance
    if (outputToken) {
      try {
        const actor = createLedgerActor(outputToken, { agentOptions: { identity } });
        const bal = await actor.icrc1_balance_of(account);
        setOutputBalance(bal);
      } catch { setOutputBalance(null); }
    } else {
      setOutputBalance(null);
    }
  }, [identity, isAuthenticated, inputToken, outputToken]);

  useEffect(() => {
    fetchBalances();
  }, [fetchBalances]);

  // ── Fetch spot prices when pair changes (no amount needed) ──
  useEffect(() => {
    if (!aggregatorRef.current || !inputToken || !outputToken) {
      setSpotPrices(null);
      return;
    }
    let cancelled = false;
    setLoadingSpot(true);

    (async () => {
      const agg = aggregatorRef.current;
      const dexes = [...agg._dexes.values()];
      const results = await Promise.allSettled(
        dexes.map(async (dex) => {
          const price = await dex.getSpotPrice(inputToken, outputToken);
          return { id: dex.id, name: dex.name, price };
        })
      );
      if (cancelled) return;
      const prices = {};
      for (const r of results) {
        if (r.status === 'fulfilled' && r.value.price > 0) {
          prices[r.value.id] = { name: r.value.name, price: r.value.price };
        }
      }
      setSpotPrices(Object.keys(prices).length > 0 ? prices : null);
      setLoadingSpot(false);
    })();

    return () => { cancelled = true; };
  }, [inputToken, outputToken, aggregatorReady]);

  // ── Fetch quotes ──
  const fetchQuotes = useCallback(async () => {
    if (!aggregatorRef.current || !inputToken || !outputToken || !inputAmountStr || !inputTokenInfo) return;

    const amount = parseToBigInt(inputAmountStr, inputTokenInfo.decimals);
    if (amount <= 0n) return;

    setLoadingQuotes(true);
    setQuoteError('');

    try {
      const q = await aggregatorRef.current.getQuotes({
        inputToken,
        outputToken,
        amount,
        slippage,
      });
      // Preserve user's DEX selection across quote refreshes
      const prevQuote = quotes[selectedQuoteIdx];
      setQuotes(q);
      if (prevQuote && q.length > 0) {
        const matchIdx = q.findIndex(newQ => newQ.dexId === prevQuote.dexId);
        setSelectedQuoteIdx(matchIdx >= 0 ? matchIdx : 0);
      } else {
        setSelectedQuoteIdx(0);
      }
      if (q.length === 0) setQuoteError('No quotes available for this pair');
    } catch (e) {
      setQuoteError(e.message || 'Failed to fetch quotes');
      setQuotes([]);
    } finally {
      setLoadingQuotes(false);
    }
  }, [inputToken, outputToken, inputAmountStr, inputTokenInfo, slippage]);

  // Auto-fetch quotes when inputs change (debounced)
  useEffect(() => {
    if (quoteTimerRef.current) clearInterval(quoteTimerRef.current);
    setQuotes([]);
    setResult(null);
    setProgress(null);

    const timeout = setTimeout(() => {
      fetchQuotes();
      quoteTimerRef.current = setInterval(fetchQuotes, QUOTE_REFRESH_MS);
    }, 500);

    return () => {
      clearTimeout(timeout);
      if (quoteTimerRef.current) clearInterval(quoteTimerRef.current);
    };
  }, [fetchQuotes]);

  // ── Handle MAX button ──
  const handleMax = () => {
    if (inputBalance === null || inputBalance === undefined || !inputTokenInfo) return;
    const bal = BigInt(inputBalance);
    const dec = inputTokenInfo.decimals;
    if (bal <= 0n) { setInputAmountStr('0'); return; }
    const divisor = BigInt(10 ** dec);
    const whole = (bal / divisor).toString();
    const fracRaw = (bal % divisor).toString().padStart(dec, '0');
    const frac = fracRaw.replace(/0+$/, '');
    setInputAmountStr(frac ? `${whole}.${frac}` : whole);
  };

  // ── Swap tokens (flip input/output) ──
  const flipTokens = () => {
    const newInput = outputToken;
    const newOutput = inputToken;
    setInputToken(newInput);
    setOutputToken(newOutput);
    onInputTokenChange?.(newInput);
    onOutputTokenChange?.(newOutput);
    setInputAmountStr('');
    setQuotes([]);
    setResult(null);
  };

  // ── Execute swap ──
  const handleSwap = async () => {
    if (!aggregatorRef.current || quotes.length === 0) return;
    const quote = quotes[selectedQuoteIdx];
    if (!quote) return;

    setSwapping(true);
    setResult(null);
    setProgress(null);

    try {
      const res = await aggregatorRef.current.swap({
        quote,
        slippage,
        onProgress: setProgress,
      });
      setResult(res);
      // Refresh balances after swap
      fetchBalances();
      // Signal wallet to refresh the two tokens involved
      if (onSwapComplete && res.success !== false) {
        onSwapComplete(inputToken, outputToken);
      }
    } catch (e) {
      setResult({ success: false, amountOut: 0n });
      setProgress(prev => ({
        ...prev,
        step: SwapStep.FAILED,
        failed: true,
        error: e.message,
      }));
    } finally {
      setSwapping(false);
    }
  };

  // ── Selected quote ──
  const selectedQuote = quotes[selectedQuoteIdx];

  // ── USD value computations ──
  const inputUsdValue = (inputAmountStr && inputUsdPrice !== null)
    ? formatUSD(parseFloat(inputAmountStr) * inputUsdPrice)
    : null;

  const outputUsdValue = (selectedQuote && outputTokenInfo && outputUsdPrice !== null)
    ? formatUSD((Number(selectedQuote.expectedOutput) / (10 ** outputTokenInfo.decimals)) * outputUsdPrice)
    : null;

  const isSwapEnabled = isAuthenticated && selectedQuote && !swapping && inputAmountStr;

  // ── Render ──
  return (
    <>
      <style>{`
        .swap-flip-btn {
          transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1) !important;
        }
        .swap-flip-btn:not(:disabled):hover {
          background: var(--color-accent) !important;
          color: #fff !important;
          transform: rotate(180deg);
          box-shadow: 0 4px 12px rgba(52, 152, 219, 0.35);
        }
        .swap-btn-primary {
          transition: all 0.25s ease !important;
        }
        .swap-btn-primary:not(:disabled):hover {
          transform: translateY(-1px);
          filter: brightness(1.1);
        }
        .swap-btn-primary:not(:disabled):active {
          transform: translateY(0);
        }
        .swap-quote-card {
          transition: all 0.2s ease;
        }
        .swap-quote-card:hover {
          border-color: var(--color-accent) !important;
          transform: translateY(-1px);
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
        }
        .swap-settings-btn {
          transition: all 0.2s ease !important;
        }
        .swap-settings-btn:hover {
          background: var(--color-tertiaryBg) !important;
          border-color: var(--color-accent) !important;
          color: var(--color-accent) !important;
        }
        .swap-max-btn:not(:disabled):hover {
          background: var(--color-accent) !important;
          color: #fff !important;
          border-color: var(--color-accent) !important;
        }
        .swap-amount-input::placeholder {
          color: var(--color-mutedText);
          opacity: 0.5;
        }
        @media (max-width: 480px) {
          .swap-card {
            padding: 14px !important;
          }
          .swap-input-section {
            padding: 12px !important;
          }
          .swap-amount-input {
            font-size: 20px !important;
          }
          .swap-token-selector-wrap {
            min-width: 110px !important;
          }
        }
      `}</style>

      <div className="swap-card" style={{
        width: '100%',
        maxWidth: 480,
        margin: '0 auto',
        borderRadius: 20,
        background: theme.colors.cardGradient,
        border: `1px solid ${theme.colors.border}`,
        boxShadow: theme.colors.cardShadow,
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        padding: 20,
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
        boxSizing: 'border-box',
      }}>

        {/* ─── Header ─── */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{
            margin: 0, fontSize: 18, fontWeight: 700,
            color: theme.colors.primaryText,
            letterSpacing: '-0.01em',
          }}>Swap</h2>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              className="swap-settings-btn"
              onClick={() => setShowSettings(s => !s)}
              title="Slippage settings"
              style={{
                background: 'transparent',
                border: `1px solid ${theme.colors.border}`,
                borderRadius: 10,
                padding: '5px 10px',
                cursor: 'pointer',
                color: showSettings ? theme.colors.accent : theme.colors.secondaryText,
                fontSize: 15,
                display: 'flex', alignItems: 'center',
              }}
            >&#9881;</button>
            {onClose && (
              <button
                className="swap-settings-btn"
                onClick={onClose}
                style={{
                  background: 'transparent',
                  border: `1px solid ${theme.colors.border}`,
                  borderRadius: 10,
                  padding: '5px 10px',
                  cursor: 'pointer',
                  color: theme.colors.secondaryText,
                  fontSize: 15,
                }}
              >&times;</button>
            )}
          </div>
        </div>

        {/* ─── Slippage settings (collapsible) ─── */}
        {showSettings && <SlippageSettings value={slippage} onChange={setSlippage} />}

        {/* ─── Token pair stack ─── */}
        <div style={{ position: 'relative' }}>
          {/* Input box (top) */}
          <div
            className="swap-input-section"
            style={{
              padding: '14px 16px 20px',
              borderRadius: '16px 16px 4px 4px',
              background: theme.colors.primaryBg,
              border: `1px solid ${theme.colors.border}`,
              borderBottom: 'none',
            }}
          >
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              marginBottom: 8,
            }}>
              <span style={{ fontSize: 13, color: theme.colors.mutedText, fontWeight: 500 }}>You pay</span>
              {inputUsdValue && (
                <span style={{ fontSize: 12, color: theme.colors.mutedText }}>{inputUsdValue}</span>
              )}
            </div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <input
                className="swap-amount-input"
                type="text"
                placeholder="0.0"
                value={inputAmountStr}
                onChange={e => {
                  const v = e.target.value.replace(/[^0-9.]/g, '');
                  if (v.split('.').length <= 2) setInputAmountStr(v);
                }}
                disabled={swapping}
                style={{
                  flex: 1, background: 'transparent', border: 'none', outline: 'none',
                  fontSize: 24, fontWeight: 600, color: theme.colors.primaryText,
                  fontFamily: 'inherit', minWidth: 0,
                }}
              />
              <div className="swap-token-selector-wrap" style={{ minWidth: 130, flexShrink: 0 }}>
                <TokenSelector
                  value={inputToken}
                  onChange={handleSetInputToken}
                  placeholder="Select"
                  disabled={swapping}
                  allowCustom
                />
              </div>
            </div>
            {/* Balance row */}
            {isAuthenticated && inputTokenInfo && (
              <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                marginTop: 8, fontSize: 12, color: theme.colors.mutedText,
              }}>
                <span>
                  Bal:{' '}
                  <span style={{ color: theme.colors.secondaryText, fontWeight: 500 }}>
                    {inputBalance !== null ? formatAmount(inputBalance, inputTokenInfo.decimals) : '...'} {inputTokenInfo.symbol}
                  </span>
                  {inputBalance !== null && inputUsdPrice !== null && (
                    <span style={{ opacity: 0.7 }}>
                      {' '}({formatUSD((Number(inputBalance) / (10 ** inputTokenInfo.decimals)) * inputUsdPrice)})
                    </span>
                  )}
                </span>
                <button
                  onClick={handleMax}
                  disabled={swapping || inputBalance === null || inputBalance === 0n}
                  className="swap-max-btn"
                  style={{
                    padding: '2px 8px',
                    borderRadius: 6,
                    fontSize: 11,
                    fontWeight: 700,
                    letterSpacing: '0.04em',
                    border: `1px solid ${theme.colors.accent}40`,
                    background: `${theme.colors.accent}15`,
                    color: theme.colors.accent,
                    cursor: swapping ? 'not-allowed' : 'pointer',
                    transition: 'all 0.15s ease',
                  }}
                >MAX</button>
              </div>
            )}
          </div>

          {/* Thin gap between boxes (card bg shows through) */}
          <div style={{ height: 4 }} />

          {/* Output box (bottom) */}
          <div
            className="swap-input-section"
            style={{
              padding: '20px 16px 14px',
              borderRadius: '4px 4px 16px 16px',
              background: theme.colors.primaryBg,
              border: `1px solid ${theme.colors.border}`,
              borderTop: 'none',
            }}
          >
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              marginBottom: 8,
            }}>
              <span style={{ fontSize: 13, color: theme.colors.mutedText, fontWeight: 500 }}>You receive</span>
              {outputUsdValue && (
                <span style={{ fontSize: 12, color: theme.colors.mutedText }}>{outputUsdValue}</span>
              )}
            </div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <div style={{
                flex: 1, fontSize: 24, fontWeight: 600, minWidth: 0,
                color: selectedQuote ? theme.colors.primaryText : theme.colors.mutedText,
                minHeight: 34, display: 'flex', alignItems: 'center',
              }}>
                {loadingQuotes ? (
                  <span style={{ fontSize: 14, color: theme.colors.mutedText, fontWeight: 400 }}>
                    Fetching quotes...
                  </span>
                ) : selectedQuote && outputTokenInfo ? (
                  formatAmount(selectedQuote.expectedOutput, outputTokenInfo.decimals)
                ) : '0.0'}
              </div>
              <div className="swap-token-selector-wrap" style={{ minWidth: 130, flexShrink: 0 }}>
                <TokenSelector
                  value={outputToken}
                  onChange={handleSetOutputToken}
                  placeholder="Select"
                  disabled={swapping}
                  allowCustom
                />
              </div>
            </div>
            {/* Balance row */}
            {isAuthenticated && outputTokenInfo && (
              <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                marginTop: 8, fontSize: 12, color: theme.colors.mutedText,
              }}>
                <span>
                  Bal:{' '}
                  <span style={{ color: theme.colors.secondaryText, fontWeight: 500 }}>
                    {outputBalance !== null ? formatAmount(outputBalance, outputTokenInfo.decimals) : '...'} {outputTokenInfo.symbol}
                  </span>
                  {outputBalance !== null && outputUsdPrice !== null && (
                    <span style={{ opacity: 0.7 }}>
                      {' '}({formatUSD((Number(outputBalance) / (10 ** outputTokenInfo.decimals)) * outputUsdPrice)})
                    </span>
                  )}
                </span>
              </div>
            )}
          </div>

          {/* ─── Flip button (overlapping both boxes) ─── */}
          <div style={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            transform: 'translate(-50%, -50%)',
            zIndex: 3,
          }}>
            <button
              className="swap-flip-btn"
              onClick={flipTokens}
              disabled={swapping}
              title="Flip tokens"
              style={{
                width: 38, height: 38,
                borderRadius: 10,
                border: `4px solid ${theme.colors.secondaryBg}`,
                background: theme.colors.tertiaryBg,
                cursor: swapping ? 'not-allowed' : 'pointer',
                color: theme.colors.accent,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 16, fontWeight: 700,
              }}
            >&#8595;</button>
          </div>
        </div>

        {/* ─── Spot prices ─── */}
        {spotPrices && inputTokenInfo && outputTokenInfo && (
          <div style={{
            display: 'flex', flexDirection: 'column', gap: 3,
            padding: '8px 12px',
            borderRadius: 10,
            background: `${theme.colors.accent}08`,
            border: `1px solid ${theme.colors.accent}15`,
          }}>
            {Object.entries(spotPrices).map(([dexId, { name, price }]) => (
              <div key={dexId} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                fontSize: 12, color: theme.colors.mutedText,
              }}>
                <span style={{ fontWeight: 500 }}>{name}</span>
                <span style={{ color: theme.colors.secondaryText, fontWeight: 500 }}>
                  1 {inputTokenInfo.symbol} = {price < 0.000001 ? price.toExponential(3) : price.toPrecision(6)} {outputTokenInfo.symbol}
                </span>
              </div>
            ))}
          </div>
        )}
        {loadingSpot && inputToken && outputToken && !spotPrices && (
          <div style={{
            textAlign: 'center', fontSize: 12, color: theme.colors.mutedText,
            padding: '6px 0',
          }}>Loading spot prices...</div>
        )}

        {/* ─── Quotes list ─── */}
        {quotes.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{
              fontSize: 13, color: theme.colors.mutedText, fontWeight: 500,
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <span>Quotes ({quotes.length})</span>
              {loadingQuotes && (
                <span style={{ fontSize: 11, opacity: 0.7 }}>Refreshing...</span>
              )}
            </div>
            {quotes.map((q, i) => (
              <QuoteCard
                key={`${q.dexId}-${i}`}
                quote={q}
                selected={i === selectedQuoteIdx}
                onSelect={() => setSelectedQuoteIdx(i)}
                inputDecimals={inputTokenInfo?.decimals || 8}
                outputDecimals={outputTokenInfo?.decimals || 8}
                outputUsdPrice={outputUsdPrice}
                isBest={i === 0 && quotes.length > 1}
              />
            ))}
          </div>
        )}

        {/* ─── Quote error ─── */}
        {quoteError && !loadingQuotes && (
          <div style={{
            color: theme.colors.error, fontSize: 13, textAlign: 'center',
            padding: '8px 12px', borderRadius: 10,
            background: `${theme.colors.error}08`,
          }}>{quoteError}</div>
        )}

        {/* ─── Progress panel ─── */}
        {progress && <ProgressPanel progress={progress} />}

        {/* ─── Result ─── */}
        {result && result.success && outputTokenInfo && (
          <div style={{
            textAlign: 'center', padding: '14px 16px', borderRadius: 12,
            background: 'rgba(46, 204, 113, 0.06)',
            border: `1px solid ${theme.colors.success}40`,
          }}>
            <div style={{
              fontSize: 15, fontWeight: 700, color: theme.colors.success,
              marginBottom: 4,
            }}>
              Swap successful!
            </div>
            <div style={{ fontSize: 13, color: theme.colors.secondaryText }}>
              Received: <strong>{formatAmount(result.amountOut, outputTokenInfo.decimals)} {outputTokenInfo.symbol}</strong>
              {outputUsdPrice !== null && (
                <span style={{ color: theme.colors.mutedText }}>
                  {' '}({formatUSD((Number(result.amountOut) / (10 ** outputTokenInfo.decimals)) * outputUsdPrice)})
                </span>
              )}
            </div>
          </div>
        )}

        {/* ─── Swap button ─── */}
        <button
          className="swap-btn-primary"
          onClick={handleSwap}
          disabled={!isSwapEnabled}
          style={{
            width: '100%',
            padding: '14px 0',
            borderRadius: 14,
            fontSize: 16,
            fontWeight: 700,
            border: 'none',
            letterSpacing: '0.01em',
            cursor: isSwapEnabled ? 'pointer' : 'not-allowed',
            background: isSwapEnabled
              ? `linear-gradient(135deg, ${SWAP_BLUE}, ${SWAP_PURPLE})`
              : theme.colors.tertiaryBg,
            color: isSwapEnabled ? '#fff' : theme.colors.mutedText,
            boxShadow: isSwapEnabled ? `0 4px 20px ${SWAP_BLUE}35` : 'none',
          }}
        >
          {!isAuthenticated ? 'Connect Wallet' :
           swapping ? 'Swapping...' :
           !inputToken || !outputToken ? 'Select Tokens' :
           !inputAmountStr ? 'Enter Amount' :
           quotes.length === 0 ? (loadingQuotes ? 'Loading...' : 'No Quotes') :
           'Swap'}
        </button>

        {/* ─── Selected quote details ─── */}
        {selectedQuote && inputTokenInfo && outputTokenInfo && !swapping && !result?.success && (
          <div style={{
            fontSize: 12, color: theme.colors.mutedText, lineHeight: 1.7,
            padding: '10px 14px', borderRadius: 12,
            background: theme.colors.primaryBg,
            border: `1px solid ${theme.colors.border}`,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Rate</span>
              <span style={{ color: theme.colors.secondaryText }}>
                1 {inputTokenInfo.symbol} = {selectedQuote.spotPrice?.toFixed(6)} {outputTokenInfo.symbol}
                {inputUsdPrice !== null && (
                  <span style={{ color: theme.colors.mutedText }}> ({formatUSD(inputUsdPrice)})</span>
                )}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Price impact</span>
              <span style={{ color: selectedQuote.priceImpact > 0.05 ? theme.colors.error : theme.colors.secondaryText }}>
                {(selectedQuote.priceImpact * 100).toFixed(2)}%
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Slippage tolerance</span>
              <span style={{ color: theme.colors.secondaryText }}>{(slippage * 100).toFixed(1)}%</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Min received</span>
              <span style={{ color: theme.colors.secondaryText }}>
                {formatAmount(selectedQuote.minimumOutput, outputTokenInfo.decimals)} {outputTokenInfo.symbol}
                {outputUsdPrice !== null && (
                  <span style={{ color: theme.colors.mutedText }}>
                    {' '}({formatUSD((Number(selectedQuote.minimumOutput) / (10 ** outputTokenInfo.decimals)) * outputUsdPrice)})
                  </span>
                )}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Network fees</span>
              <span style={{ color: theme.colors.secondaryText }}>
                {selectedQuote.feeBreakdown.totalInputFeesCount}&times; in +{' '}
                {selectedQuote.feeBreakdown.totalOutputFeesCount}&times; out
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Standard</span>
              <span style={{ color: theme.colors.secondaryText }}>{selectedQuote.standard?.toUpperCase()}</span>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
