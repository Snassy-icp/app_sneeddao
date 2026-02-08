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

// ─── Constants ──────────────────────────────────────────────────────────────

const QUOTE_REFRESH_MS = 15_000;

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
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      <span style={{ color: 'var(--color-mutedText)', fontSize: 13 }}>Slippage:</span>
      {presets.map(p => (
        <button
          key={p}
          onClick={() => { onChange(p / 100); setCustom(''); }}
          style={{
            padding: '3px 8px', borderRadius: 6, fontSize: 12, cursor: 'pointer',
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
          width: 58, padding: '3px 6px', borderRadius: 6, fontSize: 12,
          border: '1px solid var(--color-border)', background: 'transparent',
          color: 'var(--color-primaryText)',
        }}
      />
    </div>
  );
}

function QuoteCard({ quote, selected, onSelect, inputDecimals, outputDecimals, outputUsdPrice }) {
  const outputStr = formatAmount(quote.expectedOutput, outputDecimals);
  const minStr = formatAmount(quote.minimumOutput, outputDecimals);
  const impactPct = (quote.priceImpact * 100).toFixed(2);
  const feePct = (quote.dexFeePercent * 100).toFixed(2);
  const isRouted = quote.route?.length > 1;

  // Calculate USD value of expected output
  const outputNum = Number(quote.expectedOutput) / (10 ** outputDecimals);
  const usdValue = outputUsdPrice ? formatUSD(outputNum * outputUsdPrice) : null;

  return (
    <div
      onClick={onSelect}
      style={{
        padding: '12px 14px',
        borderRadius: 10,
        border: selected ? '1.5px solid var(--color-accent)' : '1px solid var(--color-border)',
        background: selected ? 'rgba(52, 152, 219, 0.08)' : 'var(--color-cardBg)',
        cursor: 'pointer',
        transition: 'all 0.15s',
        boxShadow: selected ? 'var(--color-accentShadow)' : 'none',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <span style={{ fontWeight: 600, fontSize: 15, color: 'var(--color-primaryText)' }}>{quote.dexName}</span>
          {isRouted && (
            <span style={{
              marginLeft: 8, fontSize: 11, padding: '1px 6px', borderRadius: 4,
              background: 'var(--color-warning)', color: '#000', fontWeight: 600,
            }}>Multi-hop</span>
          )}
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--color-success)' }}>{outputStr}</div>
          {usdValue && (
            <div style={{ fontSize: 11, color: 'var(--color-mutedText)', fontWeight: 400 }}>{usdValue}</div>
          )}
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--color-mutedText)', marginTop: 6 }}>
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
      padding: '14px 16px', borderRadius: 10,
      background: failed ? 'rgba(231, 76, 60, 0.08)' : completed ? 'rgba(46, 204, 113, 0.08)' : 'var(--color-cardBg)',
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
          background: failed ? 'var(--color-error)' : completed ? 'var(--color-success)' : 'var(--color-accent)',
          transition: 'width 0.4s ease',
        }} />
      </div>
      {error && <div style={{ color: 'var(--color-error)', fontSize: 12, marginTop: 6 }}>{error}</div>}
    </div>
  );
}

// ─── Main Widget ────────────────────────────────────────────────────────────

export default function SwapWidget({ initialInput, initialOutput, onClose, onInputTokenChange, onOutputTokenChange }) {
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
  const [spotPrices, setSpotPrices] = useState(null); // { icpswap: 0.001, kong: 0.00102 }
  const [loadingSpot, setLoadingSpot] = useState(false);

  // USD prices
  const [inputUsdPrice, setInputUsdPrice] = useState(null);
  const [outputUsdPrice, setOutputUsdPrice] = useState(null);

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

    // Fetch root key in local dev
    if (host.includes('localhost')) {
      agent.fetchRootKey().catch(console.warn);
    }

    const config = { identity, agent, host };
    const agg = new DexAggregator(config);
    agg.registerDex(new ICPSwapDex(config));
    agg.registerDex(new KongDex(config));
    aggregatorRef.current = agg;

    return () => {
      if (quoteTimerRef.current) clearInterval(quoteTimerRef.current);
    };
  }, [identity]);

  // ── Fetch token info when tokens change ──
  useEffect(() => {
    if (!inputToken || !aggregatorRef.current) { setInputTokenInfo(null); return; }
    const agent = aggregatorRef.current.config.agent;
    getTokenInfo(inputToken, agent).then(setInputTokenInfo).catch(() => setInputTokenInfo(null));
  }, [inputToken]);

  useEffect(() => {
    if (!outputToken || !aggregatorRef.current) { setOutputTokenInfo(null); return; }
    const agent = aggregatorRef.current.config.agent;
    getTokenInfo(outputToken, agent).then(setOutputTokenInfo).catch(() => setOutputTokenInfo(null));
  }, [outputToken]);

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
  }, [inputToken, outputToken]);

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
      setQuotes(q);
      setSelectedQuoteIdx(0);
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
      // Auto-refresh
      quoteTimerRef.current = setInterval(fetchQuotes, QUOTE_REFRESH_MS);
    }, 500);

    return () => {
      clearTimeout(timeout);
      if (quoteTimerRef.current) clearInterval(quoteTimerRef.current);
    };
  }, [fetchQuotes]);

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

  // ── Render ──
  const cardStyle = {
    width: '100%',
    maxWidth: 480,
    margin: '0 auto',
    borderRadius: 16,
    background: 'var(--color-secondaryBg)',
    border: '1px solid var(--color-border)',
    boxShadow: 'var(--color-cardShadow)',
    padding: 24,
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
    boxSizing: 'border-box',
  };

  const inputBoxStyle = {
    padding: '14px 16px',
    borderRadius: 12,
    background: 'var(--color-primaryBg)',
    border: '1px solid var(--color-border)',
  };

  return (
    <>
      <style>{`
        @media (max-width: 480px) {
          .swap-card {
            padding: 16px !important;
            gap: 12px !important;
          }
          .swap-input-box {
            padding: 10px 12px !important;
          }
          .swap-amount-input {
            font-size: 18px !important;
          }
          .swap-token-selector-wrap {
            min-width: 110px !important;
          }
        }
      `}</style>
      <div className="swap-card" style={cardStyle}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: 'var(--color-primaryText)' }}>Swap</h2>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => setShowSettings(s => !s)}
              title="Slippage settings"
              style={{
                background: 'transparent', border: '1px solid var(--color-border)',
                borderRadius: 8, padding: '4px 10px', cursor: 'pointer', color: 'var(--color-secondaryText)', fontSize: 16,
              }}
            >&#9881;</button>
            {onClose && (
              <button
                onClick={onClose}
                style={{
                  background: 'transparent', border: '1px solid var(--color-border)',
                  borderRadius: 8, padding: '4px 10px', cursor: 'pointer', color: 'var(--color-secondaryText)', fontSize: 16,
                }}
              >&times;</button>
            )}
          </div>
        </div>

        {/* Slippage settings (collapsible) */}
        {showSettings && (
          <div style={{ padding: '8px 0' }}>
            <SlippageSettings value={slippage} onChange={setSlippage} />
          </div>
        )}

        {/* Input token */}
        <div className="swap-input-box" style={inputBoxStyle}>
          <div style={{ fontSize: 12, color: 'var(--color-mutedText)', marginBottom: 6 }}>You pay</div>
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
                fontSize: 22, fontWeight: 600, color: 'var(--color-primaryText)',
                fontFamily: 'inherit', minWidth: 0,
              }}
            />
            <div className="swap-token-selector-wrap" style={{ minWidth: 130 }}>
              <TokenSelector
                value={inputToken}
                onChange={handleSetInputToken}
                placeholder="Select token"
                disabled={swapping}
                allowCustom
              />
            </div>
          </div>
          {/* USD value (replaces old fee display) */}
          {inputTokenInfo && (
            <div style={{ fontSize: 12, color: 'var(--color-mutedText)', marginTop: 4 }}>
              {inputUsdValue ? (
                <span>{inputUsdValue}</span>
              ) : (
                <span>{inputTokenInfo.symbol}</span>
              )}
            </div>
          )}
        </div>

        {/* Flip button + Spot prices */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', margin: '-8px 0', gap: 4 }}>
          <button
            onClick={flipTokens}
            disabled={swapping}
            style={{
              width: 36, height: 36, borderRadius: '50%',
              border: '2px solid var(--color-border)', background: 'var(--color-secondaryBg)',
              cursor: 'pointer', fontSize: 18, color: 'var(--color-accent)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'transform 0.2s',
              zIndex: 1,
            }}
            title="Flip tokens"
          >&#8595;</button>

          {/* Spot prices per DEX */}
          {spotPrices && inputTokenInfo && outputTokenInfo && (
            <div style={{
              display: 'flex', gap: 12, fontSize: 11, color: 'var(--color-mutedText)',
              flexWrap: 'wrap', justifyContent: 'center',
            }}>
              {Object.entries(spotPrices).map(([dexId, { name, price }]) => (
                <span key={dexId}>
                  {name}: <span style={{ color: 'var(--color-secondaryText)', fontWeight: 500 }}>
                    1 {inputTokenInfo.symbol} = {price < 0.000001 ? price.toExponential(3) : price.toPrecision(6)} {outputTokenInfo.symbol}
                  </span>
                </span>
              ))}
            </div>
          )}
          {loadingSpot && inputToken && outputToken && !spotPrices && (
            <span style={{ fontSize: 11, color: 'var(--color-mutedText)' }}>Loading spot prices...</span>
          )}
        </div>

        {/* Output token */}
        <div className="swap-input-box" style={inputBoxStyle}>
          <div style={{ fontSize: 12, color: 'var(--color-mutedText)', marginBottom: 6 }}>You receive</div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <div style={{
              flex: 1, fontSize: 22, fontWeight: 600,
              color: selectedQuote ? 'var(--color-primaryText)' : 'var(--color-mutedText)',
              minHeight: 32, display: 'flex', alignItems: 'center',
              minWidth: 0,
            }}>
              {loadingQuotes ? (
                <span style={{ fontSize: 14, color: 'var(--color-mutedText)' }}>Fetching quotes...</span>
              ) : selectedQuote && outputTokenInfo ? (
                formatAmount(selectedQuote.expectedOutput, outputTokenInfo.decimals)
              ) : '0.0'}
            </div>
            <div className="swap-token-selector-wrap" style={{ minWidth: 130 }}>
              <TokenSelector
                value={outputToken}
                onChange={handleSetOutputToken}
                placeholder="Select token"
                disabled={swapping}
                allowCustom
              />
            </div>
          </div>
          {/* USD value (replaces old fee display) */}
          {outputTokenInfo && (
            <div style={{ fontSize: 12, color: 'var(--color-mutedText)', marginTop: 4 }}>
              {outputUsdValue ? (
                <span>{outputUsdValue}</span>
              ) : (
                <span>{outputTokenInfo.symbol}</span>
              )}
            </div>
          )}
        </div>

        {/* Quotes list */}
        {quotes.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontSize: 13, color: 'var(--color-mutedText)', fontWeight: 500 }}>
              Quotes ({quotes.length})
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
              />
            ))}
          </div>
        )}

        {/* Quote error */}
        {quoteError && !loadingQuotes && (
          <div style={{ color: 'var(--color-error)', fontSize: 13, textAlign: 'center' }}>{quoteError}</div>
        )}

        {/* Progress panel */}
        {progress && <ProgressPanel progress={progress} />}

        {/* Result */}
        {result && result.success && outputTokenInfo && (
          <div style={{
            textAlign: 'center', padding: 12, borderRadius: 10,
            background: 'rgba(46, 204, 113, 0.08)', border: '1px solid var(--color-success)',
          }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-success)' }}>
              Swap successful!
            </div>
            <div style={{ fontSize: 13, color: 'var(--color-secondaryText)', marginTop: 4 }}>
              Received: {formatAmount(result.amountOut, outputTokenInfo.decimals)} {outputTokenInfo.symbol}
              {outputUsdPrice !== null && (
                <span style={{ color: 'var(--color-mutedText)' }}>
                  {' '}({formatUSD((Number(result.amountOut) / (10 ** outputTokenInfo.decimals)) * outputUsdPrice)})
                </span>
              )}
            </div>
          </div>
        )}

        {/* Swap button */}
        <button
          onClick={handleSwap}
          disabled={!isAuthenticated || !selectedQuote || swapping || !inputAmountStr}
          style={{
            width: '100%', padding: '14px 0', borderRadius: 12, fontSize: 16, fontWeight: 700,
            border: 'none', cursor: (!isAuthenticated || !selectedQuote || swapping) ? 'not-allowed' : 'pointer',
            background: (!isAuthenticated || !selectedQuote || swapping)
              ? 'var(--color-tertiaryBg)'
              : 'var(--color-accent)',
            color: (!isAuthenticated || !selectedQuote || swapping)
              ? 'var(--color-mutedText)'
              : '#fff',
            transition: 'all 0.2s',
          }}
        >
          {!isAuthenticated ? 'Connect Wallet' :
           swapping ? 'Swapping...' :
           !inputToken || !outputToken ? 'Select Tokens' :
           !inputAmountStr ? 'Enter Amount' :
           quotes.length === 0 ? (loadingQuotes ? 'Loading...' : 'No Quotes') :
           'Swap'}
        </button>

        {/* Selected quote details */}
        {selectedQuote && inputTokenInfo && outputTokenInfo && !swapping && !result?.success && (
          <div style={{ fontSize: 12, color: 'var(--color-mutedText)', lineHeight: 1.6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Rate</span>
              <span>
                1 {inputTokenInfo.symbol} = {selectedQuote.spotPrice?.toFixed(6)} {outputTokenInfo.symbol}
                {inputUsdPrice !== null && (
                  <span style={{ opacity: 0.7 }}> ({formatUSD(inputUsdPrice)})</span>
                )}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Price impact</span>
              <span style={{ color: selectedQuote.priceImpact > 0.05 ? 'var(--color-error)' : 'inherit' }}>
                {(selectedQuote.priceImpact * 100).toFixed(2)}%
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Slippage tolerance</span>
              <span>{(slippage * 100).toFixed(1)}%</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Min received</span>
              <span>
                {formatAmount(selectedQuote.minimumOutput, outputTokenInfo.decimals)} {outputTokenInfo.symbol}
                {outputUsdPrice !== null && (
                  <span style={{ opacity: 0.7 }}>
                    {' '}({formatUSD((Number(selectedQuote.minimumOutput) / (10 ** outputTokenInfo.decimals)) * outputUsdPrice)})
                  </span>
                )}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Network fees</span>
              <span>
                {selectedQuote.feeBreakdown.totalInputFeesCount}&times; in +{' '}
                {selectedQuote.feeBreakdown.totalOutputFeesCount}&times; out
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Standard</span>
              <span>{selectedQuote.standard?.toUpperCase()}</span>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
