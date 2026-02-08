import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useAuth } from '../AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { useWalletOptional } from '../contexts/WalletContext';
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
import { Link } from 'react-router-dom';
import priceService from '../services/PriceService';
import { createActor as createLedgerActor } from 'external/icrc1_ledger';
import {
  createSneedexActor,
  getAssetDetails,
  SNEEDEX_CANISTER_ID,
} from '../utils/SneedexUtils';
import { Principal } from '@dfinity/principal';

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

function QuoteCard({ quote, selected, onSelect, inputDecimals, outputDecimals, outputUsdPrice, isBest, splitAdvantage, inputSymbol, outputSymbol }) {
  const outputStr = formatAmount(quote.expectedOutput, outputDecimals);
  const minStr = formatAmount(quote.minimumOutput, outputDecimals);
  const impactPct = (quote.priceImpact * 100).toFixed(2);
  const feePct = (quote.dexFeePercent * 100).toFixed(2);
  const isRouted = quote.route?.length > 1;
  const isSplit = !!quote.isSplitQuote;
  const isAuction = !!quote.isAuctionQuote;
  const isSplitTrade = !!quote.isSplitTrade;

  const outputNum = Number(quote.expectedOutput) / (10 ** outputDecimals);
  const usdValue = outputUsdPrice ? formatUSD(outputNum * outputUsdPrice) : null;

  return (
    <div
      className="swap-quote-card"
      onClick={onSelect}
      style={{
        padding: '12px 14px',
        borderRadius: 12,
        border: selected
          ? (isSplit ? '1.5px solid #8b5cf6'
            : (isAuction || isSplitTrade) ? '1.5px solid #f39c12'
            : '1.5px solid var(--color-accent)')
          : '1px solid var(--color-border)',
        background: selected
          ? (isSplit ? 'rgba(139, 92, 246, 0.06)'
            : (isAuction || isSplitTrade) ? 'rgba(243, 156, 18, 0.06)'
            : 'var(--color-accent)08')
          : 'var(--color-primaryBg)',
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
      {isSplit && !isBest && (
        <span style={{
          position: 'absolute', top: -8, right: 12,
          fontSize: 10, fontWeight: 700, padding: '2px 8px',
          borderRadius: 6, letterSpacing: '0.04em',
          background: 'linear-gradient(135deg, #3498db, #8b5cf6)',
          color: '#fff',
          boxShadow: '0 2px 8px rgba(139, 92, 246, 0.3)',
        }}>SPLIT</span>
      )}
      {isAuction && !isBest && (
        <span style={{
          position: 'absolute', top: -8, right: 12,
          fontSize: 10, fontWeight: 700, padding: '2px 8px',
          borderRadius: 6, letterSpacing: '0.04em',
          background: 'linear-gradient(135deg, #f39c12, #e67e22)',
          color: '#fff',
          boxShadow: '0 2px 8px rgba(243, 156, 18, 0.3)',
        }}>AUCTION</span>
      )}
      {isSplitTrade && !isBest && (
        <span style={{
          position: 'absolute', top: -8, right: 12,
          fontSize: 10, fontWeight: 700, padding: '2px 8px',
          borderRadius: 6, letterSpacing: '0.04em',
          background: 'linear-gradient(135deg, #f39c12, #8b5cf6)',
          color: '#fff',
          boxShadow: '0 2px 8px rgba(243, 156, 18, 0.3)',
        }}>SPLIT TRADE</span>
      )}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--color-primaryText)' }}>
            {isSplitTrade ? 'Split Trade' : isSplit ? 'Split Swap' : quote.dexName}
          </span>
          {isSplit && (
            <span style={{
              fontSize: 10, padding: '1px 6px', borderRadius: 4,
              background: 'linear-gradient(135deg, rgba(52,152,219,0.15), rgba(139,92,246,0.15))',
              color: '#8b5cf6', fontWeight: 600,
            }}>{100 - quote.distribution}% ICPSwap / {quote.distribution}% Kong</span>
          )}
          {isRouted && !isSplit && (
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
      {/* Split leg breakdown */}
      {isSplit && quote.legs && (
        <div style={{
          display: 'flex', gap: 8, fontSize: 11, color: 'var(--color-mutedText)',
          marginTop: 6, paddingTop: 6, borderTop: '1px solid var(--color-border)',
        }}>
          {quote.legs.map(leg => (
            <div key={leg.dexId} style={{ flex: 1 }}>
              <span style={{ fontWeight: 500, color: 'var(--color-secondaryText)' }}>{leg.dexName}:</span>{' '}
              {formatAmount(leg.quote.expectedOutput, outputDecimals)}
            </div>
          ))}
        </div>
      )}
      {/* Auction buyout info */}
      {isAuction && (
        <div style={{
          fontSize: 11, color: 'var(--color-mutedText)', marginTop: 6,
          paddingTop: 6, borderTop: '1px solid var(--color-border)',
        }}>
          <span>Buyout: {formatAmount(quote.auctionBuyoutPrice, inputDecimals)} {inputSymbol}</span>
          <span style={{ float: 'right' }}>
            Rate: 1 {inputSymbol} = {quote.auctionRate?.toPrecision(6)} {outputSymbol}
          </span>
        </div>
      )}
      {/* Split trade breakdown */}
      {isSplitTrade && quote.usedBuyouts && (
        <div style={{
          display: 'flex', flexDirection: 'column', gap: 3,
          fontSize: 11, color: 'var(--color-mutedText)',
          marginTop: 6, paddingTop: 6, borderTop: '1px solid var(--color-border)',
        }}>
          {quote.usedBuyouts.map(b => (
            <div key={Number(b.offer.id)} style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: '#f39c12', fontWeight: 500 }}>
                Sneedex #{Number(b.offer.id)}
              </span>
              <span>
                {formatAmount(b.outputAmount, outputDecimals)} {outputSymbol} for {formatAmount(b.buyoutPrice, inputDecimals)} {inputSymbol}
              </span>
            </div>
          ))}
          {quote.swapLegRemaining > 0n && (
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--color-accent)', fontWeight: 500 }}>
                {quote.swapLegQuote?.dexName || 'DEX Swap'}
              </span>
              <span>
                {formatAmount(quote.swapLegOutput, outputDecimals)} {outputSymbol} for {formatAmount(quote.swapLegRemaining, inputDecimals)} {inputSymbol}
              </span>
            </div>
          )}
        </div>
      )}
      {/* Advantage vs next best (for split, auction, split trade) */}
      {(isSplit || isSplitTrade || isAuction) && isBest && splitAdvantage && (
        <div style={{
          fontSize: 11, fontWeight: 600, marginTop: 4,
          color: 'var(--color-success)',
        }}>
          +{formatAmount(splitAdvantage.amount, outputDecimals)} ({splitAdvantage.percent.toFixed(2)}%) more than next best
          {splitAdvantage.usdValue && (
            <span style={{ fontWeight: 400, opacity: 0.8 }}> ({splitAdvantage.usdValue})</span>
          )}
        </div>
      )}
      <div style={{
        display: 'flex', justifyContent: 'space-between',
        fontSize: 11, color: 'var(--color-mutedText)', marginTop: 6,
        paddingTop: (isSplit || isAuction || isSplitTrade) ? 0 : 6,
        borderTop: (isSplit || isAuction || isSplitTrade) ? 'none' : '1px solid var(--color-border)',
      }}>
        {isAuction ? (
          <>
            <span>Exact amount (no slippage)</span>
            <span style={{ opacity: 0.7 }}>
              <Link to={`/sneedex_offer/${Number(quote.auctionOffer?.id)}`}
                style={{ color: 'inherit', textDecoration: 'underline' }}
                onClick={e => e.stopPropagation()}>
                View offer
              </Link>
            </span>
          </>
        ) : (
          <>
            <span>Min: {minStr}</span>
            <span>Impact: {impactPct}%</span>
            <span style={{ opacity: 0.7 }}>Fee: {feePct}%</span>
          </>
        )}
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

// ─── Auction helpers ─────────────────────────────────────────────────────

/**
 * Filter active auctions that match a swap pair.
 * Match: price_token_ledger === inputToken AND at least one ICRC1Token asset
 * with ledger_canister_id === outputToken.
 */
function filterMatchingAuctions(auctions, inputToken, outputToken) {
  if (!auctions || !inputToken || !outputToken) return [];
  const nowNs = BigInt(Date.now()) * 1_000_000n; // current time in nanoseconds
  return auctions.filter(offer => {
    if (!offer.price_token_ledger) return false;
    // Skip offers that have expired even if backend hasn't processed them yet
    if (offer.expiration?.[0] && BigInt(offer.expiration[0]) <= nowNs) return false;
    const priceToken = offer.price_token_ledger.toString();
    if (priceToken !== inputToken) return false;
    // Must have at least one ICRC1Token asset matching the output token
    return (offer.assets || []).some(ae => {
      const d = getAssetDetails(ae);
      return d.type === 'ICRC1Token' && d.ledger_id === outputToken;
    });
  });
}

/**
 * Build "buyout quotes" from matching auctions that qualify as better-than-swap deals.
 * Qualifying: has buyout_price, buyout_price <= inputAmount, rate > best swap rate.
 *
 * @returns {{ qualifyingBuyouts: Array, allBuyouts: Array }}
 *   qualifyingBuyouts: sorted by rate desc, each with { offer, outputAmount, buyoutPrice, rate }
 *   allBuyouts: same but without the rate filter (for ads section)
 */
function buildBuyoutQuotes(matchingAuctions, inputAmount, outputToken, bestSwapRate, inputDecimals, outputDecimals) {
  const all = [];
  for (const offer of matchingAuctions) {
    if (!offer.buyout_price?.[0]) continue;
    const buyoutPrice = BigInt(offer.buyout_price[0]);
    if (buyoutPrice <= 0n) continue;

    // Sum all ICRC1Token assets matching outputToken
    let outputAmount = 0n;
    for (const ae of offer.assets || []) {
      const d = getAssetDetails(ae);
      if (d.type === 'ICRC1Token' && d.ledger_id === outputToken) {
        outputAmount += BigInt(d.amount);
      }
    }
    if (outputAmount <= 0n) continue;

    // Rate: output per 1 unit of input (in human-readable terms)
    const rate = (Number(outputAmount) / (10 ** outputDecimals)) /
                 (Number(buyoutPrice) / (10 ** inputDecimals));

    all.push({ offer, outputAmount, buyoutPrice, rate });
  }

  // Sort by rate descending (best deal first)
  all.sort((a, b) => b.rate - a.rate);

  // Filter qualifying: buyout_price <= inputAmount AND rate > bestSwapRate
  const qualifying = all.filter(b => b.buyoutPrice <= inputAmount && b.rate > bestSwapRate);

  return { qualifyingBuyouts: qualifying, allBuyouts: all };
}

// ─── Mini Auction Card (ads) ─────────────────────────────────────────────

function MiniAuctionCard({ offer, outputAmount, buyoutPrice, rate, inputTokenInfo, outputTokenInfo, outputUsdPrice }) {
  const outputStr = formatAmount(outputAmount, outputTokenInfo?.decimals || 8);
  const priceStr = formatAmount(buyoutPrice, inputTokenInfo?.decimals || 8);
  const rateStr = rate < 0.000001 ? rate.toExponential(3) : rate.toPrecision(6);
  const outputNum = Number(outputAmount) / (10 ** (outputTokenInfo?.decimals || 8));
  const usdValue = outputUsdPrice ? formatUSD(outputNum * outputUsdPrice) : null;
  const offerId = Number(offer.id);

  return (
    <Link
      to={`/sneedex_offer/${offerId}`}
      style={{ textDecoration: 'none', display: 'block' }}
    >
      <div className="swap-quote-card" style={{
        padding: '10px 12px', borderRadius: 10,
        border: '1px solid var(--color-border)',
        background: 'var(--color-primaryBg)',
        cursor: 'pointer', position: 'relative',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontWeight: 600, fontSize: 12, color: 'var(--color-primaryText)' }}>
              Sneedex #{offerId}
            </span>
            <span style={{
              fontSize: 9, padding: '1px 5px', borderRadius: 4,
              background: 'rgba(243, 156, 18, 0.12)', color: '#f39c12', fontWeight: 600,
            }}>BUYOUT</span>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--color-success)' }}>
              {outputStr} {outputTokenInfo?.symbol}
            </div>
            {usdValue && (
              <div style={{ fontSize: 10, color: 'var(--color-mutedText)' }}>{usdValue}</div>
            )}
          </div>
        </div>
        <div style={{
          display: 'flex', justifyContent: 'space-between',
          fontSize: 10, color: 'var(--color-mutedText)', marginTop: 4,
        }}>
          <span>Cost: {priceStr} {inputTokenInfo?.symbol}</span>
          <span>Rate: 1 {inputTokenInfo?.symbol} = {rateStr} {outputTokenInfo?.symbol}</span>
        </div>
      </div>
    </Link>
  );
}

function SplitSlider({ distribution, onChange, disabled, loading, autoSearching }) {
  return (
    <div style={{
      padding: '10px 14px',
      borderRadius: 12,
      background: 'var(--color-primaryBg)',
      border: '1px solid var(--color-border)',
    }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        fontSize: 12, color: 'var(--color-mutedText)', marginBottom: 8,
      }}>
        <span style={{ fontWeight: 600, color: 'var(--color-primaryText)' }}>Split Ratio</span>
        <span style={{ fontSize: 10, opacity: 0.8 }}>
          {autoSearching ? 'Finding optimal...' : loading ? 'Updating...' : ''}
        </span>
      </div>
      <div style={{ position: 'relative', padding: '0 2px' }}>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={distribution}
          onChange={e => onChange(Number(e.target.value))}
          disabled={disabled}
          className="split-slider"
          style={{ width: '100%', height: 6, cursor: disabled ? 'not-allowed' : 'pointer' }}
        />
      </div>
      <div style={{
        display: 'flex', justifyContent: 'space-between',
        fontSize: 11, marginTop: 6, fontWeight: 600,
      }}>
        <span style={{ color: SWAP_BLUE }}>ICPSwap {100 - distribution}%</span>
        <span style={{ color: SWAP_PURPLE }}>Kong {distribution}%</span>
      </div>
    </div>
  );
}

function SplitProgressPanel({ progress }) {
  if (!progress || !progress.isSplit) return null;
  const { legs = [], completed, failed } = progress;

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 10,
      padding: '14px 16px', borderRadius: 12,
      background: failed ? 'rgba(231, 76, 60, 0.06)' : completed ? 'rgba(46, 204, 113, 0.06)' : 'var(--color-primaryBg)',
      border: `1px solid ${failed ? 'var(--color-error)' : completed ? 'var(--color-success)' : 'var(--color-border)'}`,
    }}>
      <div style={{
        fontSize: 13, fontWeight: 600, color: 'var(--color-primaryText)',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <span>Split Swap Progress</span>
        <span style={{ fontSize: 11, color: 'var(--color-mutedText)', fontWeight: 400 }}>
          {completed ? 'Done' : failed ? 'Failed' : 'In progress...'}
        </span>
      </div>
      {legs.map(leg => {
        const pct = leg.totalSteps > 0
          ? ((leg.stepIndex + (leg.completed ? 1 : 0.5)) / leg.totalSteps) * 100
          : 0;
        return (
          <div key={leg.dexId} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{
              display: 'flex', justifyContent: 'space-between', fontSize: 12,
            }}>
              <span style={{ fontWeight: 500, color: 'var(--color-primaryText)' }}>{leg.dexName}</span>
              <span style={{ color: 'var(--color-mutedText)' }}>
                {leg.completed ? 'Done' : leg.failed ? 'Failed' : `${leg.stepIndex + 1} / ${leg.totalSteps}`}
              </span>
            </div>
            <div style={{
              height: 3, borderRadius: 2, background: 'var(--color-border)', overflow: 'hidden',
            }}>
              <div style={{
                height: '100%', borderRadius: 2,
                width: `${Math.min(pct, 100)}%`,
                background: leg.failed
                  ? 'var(--color-error)'
                  : leg.completed
                    ? 'var(--color-success)'
                    : `linear-gradient(90deg, ${SWAP_BLUE}, ${SWAP_PURPLE})`,
                transition: 'width 0.4s ease',
              }} />
            </div>
            {leg.message && !leg.completed && (
              <div style={{ fontSize: 11, color: 'var(--color-mutedText)' }}>{leg.message}</div>
            )}
            {leg.error && (
              <div style={{ fontSize: 11, color: 'var(--color-error)' }}>{leg.error}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function SplitTradeProgressPanel({ progress }) {
  if (!progress || !progress.isSplitTrade || !progress.legs) return null;
  const legs = progress.legs; // object keyed by leg ID

  const allDone = Object.values(legs).every(l => l.status === 'done');
  const anyFailed = Object.values(legs).some(l => l.status === 'failed');

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 10,
      padding: '14px 16px', borderRadius: 12,
      background: anyFailed ? 'rgba(231, 76, 60, 0.06)' : allDone ? 'rgba(46, 204, 113, 0.06)' : 'var(--color-primaryBg)',
      border: `1px solid ${anyFailed ? 'var(--color-error)' : allDone ? 'var(--color-success)' : 'var(--color-border)'}`,
    }}>
      <div style={{
        fontSize: 13, fontWeight: 600, color: 'var(--color-primaryText)',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <span>Split Trade Progress</span>
        <span style={{ fontSize: 11, color: 'var(--color-mutedText)', fontWeight: 400 }}>
          {allDone ? 'Done' : anyFailed ? 'Partial failure' : 'In progress...'}
        </span>
      </div>
      {Object.entries(legs).map(([key, leg]) => {
        const isDone = leg.status === 'done';
        const isFailed = leg.status === 'failed';
        const isActive = leg.status === 'active';
        const isPending = leg.status === 'pending';

        const color = isFailed ? 'var(--color-error)'
          : isDone ? 'var(--color-success)'
          : leg.type === 'buyout' ? '#f39c12'
          : `linear-gradient(90deg, ${SWAP_BLUE}, ${SWAP_PURPLE})`;

        return (
          <div key={key} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
              <span style={{
                fontWeight: 500,
                color: isPending ? 'var(--color-mutedText)' : 'var(--color-primaryText)',
              }}>
                {leg.label}
              </span>
              <span style={{
                color: isDone ? 'var(--color-success)' : isFailed ? 'var(--color-error)' : 'var(--color-mutedText)',
                fontSize: 11,
              }}>
                {isDone ? '✓ Done' : isFailed ? '✕ Failed' : isActive ? 'Running...' : 'Pending'}
              </span>
            </div>
            <div style={{
              height: 3, borderRadius: 2, background: 'var(--color-border)', overflow: 'hidden',
            }}>
              <div style={{
                height: '100%', borderRadius: 2,
                width: isDone ? '100%' : isFailed ? '100%' : isActive ? '60%' : '0%',
                background: typeof color === 'string' && !color.startsWith('linear') ? color : color,
                transition: 'width 0.4s ease',
              }} />
            </div>
            {isActive && leg.message && (
              <div style={{ fontSize: 11, color: 'var(--color-mutedText)' }}>{leg.message}</div>
            )}
            {isFailed && leg.message && (
              <div style={{ fontSize: 11, color: 'var(--color-error)' }}>{leg.message}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Main Widget ────────────────────────────────────────────────────────────

export default function SwapWidget({ initialInput, initialOutput, initialOutputAmount, onClose, onInputTokenChange, onOutputTokenChange, onSwapComplete }) {
  const { identity, isAuthenticated } = useAuth();
  const { theme } = useTheme();
  const walletContext = useWalletOptional();

  // ── State ──
  const [inputToken, setInputToken] = useState(initialInput || '');
  const [outputToken, setOutputToken] = useState(initialOutput || '');
  const [inputAmountStr, setInputAmountStr] = useState('');
  const [slippage, setSlippage] = useState(DEFAULT_SLIPPAGE);
  const [showSettings, setShowSettings] = useState(false);

  const [inputTokenInfo, setInputTokenInfo] = useState(null);
  const [outputTokenInfo, setOutputTokenInfo] = useState(null);

  const [quotes, setQuotes] = useState([]);
  const [selectedDexId, setSelectedDexId] = useState(null);
  const [loadingQuotes, setLoadingQuotes] = useState(false);
  const [quoteError, setQuoteError] = useState('');

  // Split swap state
  const [splitDistribution, setSplitDistribution] = useState(50);   // 0-100 (Kong %)
  const [splitQuoteResult, setSplitQuoteResult] = useState(null);    // SwapQuote for current slider pos
  const [loadingSplitQuote, setLoadingSplitQuote] = useState(false);
  const [autoSearching, setAutoSearching] = useState(false);
  const autoSearchKeyRef = useRef('');
  const autoSearchCancelRef = useRef(0);
  const userOverrideRef = useRef(false);
  const sliderDebounceRef = useRef(null);
  const splitFetchRef = useRef(0);

  // Sneedex auction state
  const [matchingAuctions, setMatchingAuctions] = useState([]);
  const [auctionBuyouts, setAuctionBuyouts] = useState({ qualifyingBuyouts: [], allBuyouts: [] });
  const [loadingAuctions, setLoadingAuctions] = useState(false);

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
  const swappingRef = useRef(false);

  // ── Individual DEX quotes (extracted for convenience) ──
  const icpswapQuote = useMemo(() => quotes.find(q => q.dexId === 'icpswap') || null, [quotes]);
  const kongQuote = useMemo(() => quotes.find(q => q.dexId === 'kong') || null, [quotes]);

  // ── Build buyout quote objects (compatible with QuoteCard) ──
  const buyoutQuoteCards = useMemo(() => {
    if (!inputTokenInfo || !outputTokenInfo) return [];
    return auctionBuyouts.qualifyingBuyouts.map(b => ({
      dexId:    `auction-${Number(b.offer.id)}`,
      dexName:  `Sneedex #${Number(b.offer.id)}`,
      isAuctionQuote: true,
      auctionOffer: b.offer,
      auctionBuyoutPrice: b.buyoutPrice,
      auctionOutputAmount: b.outputAmount,
      auctionRate: b.rate,
      inputToken:          inputToken,
      outputToken:         outputToken,
      inputAmount:         b.buyoutPrice,
      effectiveInputAmount: b.buyoutPrice,
      expectedOutput:      b.outputAmount,
      minimumOutput:       b.outputAmount, // buyout is exact
      spotPrice:           b.rate,
      priceImpact:         0,              // no slippage on buyout
      dexFeePercent:       0,
      feeBreakdown: {
        inputTransferFees: inputTokenInfo.fee,
        outputWithdrawalFees: 0n,
        dexTradingFee: 0,
        totalInputFeesCount: 1,
        totalOutputFeesCount: 0,
      },
      standard: 'icrc1',
      route: [],
      timestamp: Date.now(),
    }));
  }, [auctionBuyouts.qualifyingBuyouts, inputTokenInfo, outputTokenInfo, inputToken, outputToken]);

  // ── Build "Split Trade" card (stacked buyouts + swap remainder) ──
  const splitTradeQuote = useMemo(() => {
    if (buyoutQuoteCards.length === 0 || !inputTokenInfo || !outputTokenInfo) return null;
    const inputAmount = inputAmountStr ? parseToBigInt(inputAmountStr, inputTokenInfo.decimals) : 0n;
    if (inputAmount <= 0n) return null;

    // Stack buyouts (sorted best rate first) until we hit the input amount
    let remaining = inputAmount;
    const usedBuyouts = [];
    let totalBuyoutOutput = 0n;
    let totalBuyoutCost = 0n;

    for (const b of auctionBuyouts.qualifyingBuyouts) {
      if (remaining <= 0n) break;
      if (b.buyoutPrice > remaining) continue; // Can't afford this one
      usedBuyouts.push(b);
      totalBuyoutCost += b.buyoutPrice;
      totalBuyoutOutput += b.outputAmount;
      remaining -= b.buyoutPrice;
    }

    if (usedBuyouts.length === 0) return null;

    // If there's remaining input, find the best swap for it
    let swapLegOutput = 0n;
    let swapLegQuote = null;
    if (remaining > 0n) {
      // The best swap for the remainder — check if the split swap is better, or a single DEX
      // Use the best from allQuotes scaled proportionally, or just the best individual rate
      const bestSwap = quotes[0]; // best single-DEX quote
      if (bestSwap && bestSwap.inputAmount > 0n) {
        // Scale: what would we get for `remaining` at this rate?
        const swapRate = Number(bestSwap.expectedOutput) / Number(bestSwap.inputAmount);
        swapLegOutput = BigInt(Math.floor(Number(remaining) * swapRate));
        swapLegQuote = bestSwap;
      }
    }

    const totalOutput = totalBuyoutOutput + swapLegOutput;

    // Only show split trade if it's better than the best single option
    const bestSingleSwap = quotes[0]?.expectedOutput || 0n;
    const bestSingleBuyout = buyoutQuoteCards[0]?.expectedOutput || 0n;
    const bestExisting = bestSingleSwap > bestSingleBuyout ? bestSingleSwap : bestSingleBuyout;
    if (totalOutput <= bestExisting) return null;

    return {
      dexId: 'split-trade',
      dexName: 'Split Trade',
      isSplitTrade: true,
      usedBuyouts,
      swapLegQuote,
      swapLegRemaining: remaining,
      swapLegOutput,
      totalBuyoutCost,
      totalBuyoutOutput,

      inputToken,
      outputToken,
      inputAmount,
      effectiveInputAmount: inputAmount,
      expectedOutput: totalOutput,
      minimumOutput: totalBuyoutOutput + (swapLegOutput > 0n
        ? swapLegOutput - BigInt(Math.ceil(Number(swapLegOutput) * slippage))
        : 0n),
      spotPrice: (Number(totalOutput) / (10 ** outputTokenInfo.decimals)) /
                 (Number(inputAmount) / (10 ** inputTokenInfo.decimals)),
      priceImpact: 0,
      dexFeePercent: 0,
      feeBreakdown: {
        inputTransferFees: inputTokenInfo.fee * BigInt(usedBuyouts.length + (remaining > 0n ? 1 : 0)),
        outputWithdrawalFees: 0n,
        dexTradingFee: 0,
        totalInputFeesCount: usedBuyouts.length + (remaining > 0n ? 1 : 0),
        totalOutputFeesCount: 0,
      },
      standard: 'mixed',
      route: [],
      timestamp: Date.now(),
    };
  }, [buyoutQuoteCards, auctionBuyouts.qualifyingBuyouts, quotes, inputAmountStr, inputTokenInfo, outputTokenInfo, inputToken, outputToken, slippage]);

  // ── Combined quotes list (individual + split + auctions), sorted best-first ──
  const allQuotes = useMemo(() => {
    const list = [...quotes];
    if (splitQuoteResult && splitDistribution > 0 && splitDistribution < 100) {
      list.push(splitQuoteResult);
    }
    // Add qualifying buyout quotes
    for (const bq of buyoutQuoteCards) list.push(bq);
    // Add split trade if beneficial
    if (splitTradeQuote) list.push(splitTradeQuote);

    list.sort((a, b) => {
      if (b.expectedOutput > a.expectedOutput) return 1;
      if (b.expectedOutput < a.expectedOutput) return -1;
      return 0;
    });
    return list;
  }, [quotes, splitQuoteResult, splitDistribution, buyoutQuoteCards, splitTradeQuote]);

  // Resolve selected quote by dexId (fallback to first)
  const selectedQuote = useMemo(() => {
    if (!selectedDexId) return allQuotes[0] || null;
    return allQuotes.find(q => q.dexId === selectedDexId) || allQuotes[0] || null;
  }, [allQuotes, selectedDexId]);

  // ── Target output amount refinement (for pre-filling from external context) ──
  const targetOutputRef = useRef({
    amount: initialOutputAmount ? parseFloat(initialOutputAmount) : 0,
    active: !!(initialOutputAmount && parseFloat(initialOutputAmount) > 0),
    attempts: 0,
    lastInputSet: '',
  });

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
    // Use the aggregator's agent if available (properly configured with host)
    const agent = aggregatorRef.current?.config?.agent;

    // Fetch both balances in parallel for speed
    const fetchOne = async (token) => {
      if (!token) return null;
      try {
        const actor = agent
          ? createLedgerActor(token, { agent })
          : createLedgerActor(token, { agentOptions: { identity } });
        return await actor.icrc1_balance_of(account);
      } catch (err) {
        console.warn(`SwapWidget.fetchBalances: error for ${token}:`, err);
        return null;
      }
    };

    const [inBal, outBal] = await Promise.all([
      fetchOne(inputToken),
      fetchOne(outputToken),
    ]);
    setInputBalance(inBal);
    setOutputBalance(outBal);
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

  // ── Fetch matching Sneedex auctions when pair changes ──
  useEffect(() => {
    if (!inputToken || !outputToken) {
      setMatchingAuctions([]);
      setAuctionBuyouts({ qualifyingBuyouts: [], allBuyouts: [] });
      return;
    }
    let cancelled = false;
    setLoadingAuctions(true);

    (async () => {
      try {
        const actor = createSneedexActor(identity || null);
        const resp = await actor.getOfferFeed({
          start_id: [],
          length: 50,
          filter: [{
            states: [[ { Active: null } ]],
            asset_types: [], // Filter client-side for matching token pair
            creator: [],
            has_bids: [],
            public_only: [true],
            viewer: [],
          }],
        });
        if (cancelled) return;
        const matching = filterMatchingAuctions(resp.offers || [], inputToken, outputToken);
        setMatchingAuctions(matching);
      } catch (e) {
        console.warn('Failed to fetch Sneedex auctions:', e);
        if (!cancelled) setMatchingAuctions([]);
      } finally {
        if (!cancelled) setLoadingAuctions(false);
      }
    })();

    return () => { cancelled = true; };
  }, [inputToken, outputToken, identity]);

  // ── Compute qualifying buyout quotes when auctions or quotes change ──
  useEffect(() => {
    if (matchingAuctions.length === 0 || !inputTokenInfo || !outputTokenInfo) {
      setAuctionBuyouts({ qualifyingBuyouts: [], allBuyouts: [] });
      return;
    }

    const inputAmount = inputAmountStr ? parseToBigInt(inputAmountStr, inputTokenInfo.decimals) : 0n;

    // Best swap rate: highest output per input among swap quotes
    let bestSwapRate = 0;
    for (const q of quotes) {
      if (q.expectedOutput > 0n && q.inputAmount > 0n) {
        const r = (Number(q.expectedOutput) / (10 ** outputTokenInfo.decimals)) /
                  (Number(q.inputAmount) / (10 ** inputTokenInfo.decimals));
        if (r > bestSwapRate) bestSwapRate = r;
      }
    }

    const result = buildBuyoutQuotes(
      matchingAuctions, inputAmount, outputToken,
      bestSwapRate, inputTokenInfo.decimals, outputTokenInfo.decimals,
    );
    setAuctionBuyouts(result);
  }, [matchingAuctions, quotes, inputAmountStr, inputTokenInfo, outputTokenInfo, outputToken]);

  // ── Initial input estimate from target output amount (using USD or spot prices) ──
  useEffect(() => {
    const ref = targetOutputRef.current;
    if (!ref.active || ref.attempts > 0) return;
    if (!inputTokenInfo || !outputTokenInfo) return;

    const targetOutput = ref.amount;
    if (targetOutput <= 0) return;

    let estimatedInput = null;

    // Prefer USD-based estimation (more reliable)
    if (inputUsdPrice && outputUsdPrice && inputUsdPrice > 0) {
      estimatedInput = (targetOutput * outputUsdPrice) / inputUsdPrice;
    }
    // Fallback: use best spot price
    else if (spotPrices) {
      let bestPrice = 0;
      Object.values(spotPrices).forEach(({ price }) => {
        if (price > bestPrice) bestPrice = price;
      });
      if (bestPrice > 0) {
        estimatedInput = targetOutput / bestPrice;
      }
    }

    if (estimatedInput === null || estimatedInput <= 0) return;

    // Add 5% buffer for price impact + fees
    estimatedInput *= 1.05;

    const formatted = estimatedInput.toFixed(Math.min(inputTokenInfo.decimals, 8));
    setInputAmountStr(formatted);
    ref.lastInputSet = formatted;
    ref.attempts = 1;
  }, [inputTokenInfo, outputTokenInfo, inputUsdPrice, outputUsdPrice, spotPrices]);

  // ── Refine input amount after quotes arrive to converge on target output ──
  useEffect(() => {
    const ref = targetOutputRef.current;
    if (!ref.active) return;
    if (loadingQuotes) return;
    if (quotes.length === 0) return;
    if (ref.attempts < 1) return; // Haven't set initial estimate yet
    if (ref.attempts >= 4) { ref.active = false; return; } // Max refinement attempts
    if (!outputTokenInfo || !inputTokenInfo) return;

    // Stop refining if user manually edited the input
    if (inputAmountStr !== ref.lastInputSet) {
      ref.active = false;
      return;
    }

    const targetOutput = ref.amount;
    const bestQuote = quotes[0]; // Sorted best-first by aggregator
    const bestOutputNum = Number(bestQuote.expectedOutput) / (10 ** outputTokenInfo.decimals);

    if (bestOutputNum >= targetOutput * 0.98) {
      // Within 2% of target or above — good enough
      ref.active = false;
      return;
    }

    // Output too low — scale up input proportionally with a small buffer
    const currentInput = parseFloat(inputAmountStr);
    if (currentInput <= 0 || bestOutputNum <= 0) { ref.active = false; return; }

    const scaleFactor = (targetOutput / bestOutputNum) * 1.03; // 3% overshoot
    const newInput = currentInput * scaleFactor;

    const formatted = newInput.toFixed(Math.min(inputTokenInfo.decimals, 8));
    setInputAmountStr(formatted);
    ref.lastInputSet = formatted;
    ref.attempts += 1;
  }, [quotes, loadingQuotes, inputAmountStr, outputTokenInfo, inputTokenInfo]);

  // ── Fetch quotes ──
  const fetchQuotes = useCallback(async () => {
    if (swappingRef.current) return; // Don't refresh while a swap is in progress
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
      if (q.length === 0) setQuoteError('No quotes available for this pair');

      // ── Auto-search for best split (once per unique parameter combo) ──
      const icpQ = q.find(x => x.dexId === 'icpswap');
      const kngQ = q.find(x => x.dexId === 'kong');
      const searchKey = `${inputToken}:${outputToken}:${inputAmountStr}:${slippage}`;

      if (icpQ && kngQ && searchKey !== autoSearchKeyRef.current) {
        autoSearchKeyRef.current = searchKey;
        userOverrideRef.current = false;
        setSplitDistribution(50);
        setAutoSearching(true);

        const searchId = ++autoSearchCancelRef.current;
        const agg = aggregatorRef.current;

        // Immediately fetch a 50/50 split quote so the card appears right away
        agg.getQuoteForDistribution({
          totalAmount: amount, distribution: 50, inputToken, outputToken, slippage,
        }).then(result => {
          if (searchId !== autoSearchCancelRef.current || userOverrideRef.current) return;
          if (result) {
            setSplitQuoteResult(agg.buildSplitQuote({
              distribution: 50, icpswapQuote: result.icpswapQuote, kongQuote: result.kongQuote,
              totalAmount: amount, inputToken, outputToken,
            }));
          }
        }).catch(() => {});

        // Start ternary search — onUpdate animates the slider in real time
        agg.findBestSplit({
          totalAmount: amount, inputToken, outputToken, slippage,
          icpswapFullQuote: icpQ, kongFullQuote: kngQ,
          onUpdate: ({ distribution, icpswapQuote, kongQuote }) => {
            if (searchId !== autoSearchCancelRef.current || userOverrideRef.current) return;
            setSplitDistribution(distribution);
            setSplitQuoteResult(agg.buildSplitQuote({
              distribution, icpswapQuote, kongQuote,
              totalAmount: amount, inputToken, outputToken,
            }));
          },
        }).then(({ bestDistribution, bestResult }) => {
          if (searchId !== autoSearchCancelRef.current) return;
          setAutoSearching(false);
          if (!userOverrideRef.current && bestResult) {
            setSplitDistribution(bestDistribution);
            if (bestDistribution > 0 && bestDistribution < 100) {
              setSplitQuoteResult(agg.buildSplitQuote({
                distribution: bestDistribution,
                icpswapQuote: bestResult.icpswapQuote, kongQuote: bestResult.kongQuote,
                totalAmount: amount, inputToken, outputToken,
              }));
            } else {
              setSplitQuoteResult(null);
            }
          }
        }).catch(e => {
          console.warn('Auto-search failed:', e);
          if (searchId !== autoSearchCancelRef.current) return;
          setAutoSearching(false);
        });
      } else if ((!icpQ || !kngQ) && searchKey !== autoSearchKeyRef.current) {
        autoSearchKeyRef.current = searchKey;
        setSplitQuoteResult(null);
        setAutoSearching(false);
      }
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
    setSelectedDexId(null);
    setSplitQuoteResult(null);
    setSplitDistribution(50);
    setLoadingSplitQuote(false);
    setAutoSearching(false);
    autoSearchKeyRef.current = '';
    userOverrideRef.current = false;

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

  // ── Handle split slider change (user-driven) ──
  const handleSliderChange = useCallback((newDist) => {
    userOverrideRef.current = true;
    setSplitDistribution(newDist);

    if (sliderDebounceRef.current) clearTimeout(sliderDebounceRef.current);

    if (newDist <= 0 || newDist >= 100) {
      setSplitQuoteResult(null);
      setLoadingSplitQuote(false);
      return;
    }
    if (!aggregatorRef.current || !inputToken || !outputToken || !inputAmountStr || !inputTokenInfo) return;

    setLoadingSplitQuote(true);
    const cancelId = ++splitFetchRef.current;
    const amount = parseToBigInt(inputAmountStr, inputTokenInfo.decimals);

    sliderDebounceRef.current = setTimeout(async () => {
      try {
        const result = await aggregatorRef.current.getQuoteForDistribution({
          totalAmount: amount, distribution: newDist, inputToken, outputToken, slippage,
        });
        if (cancelId !== splitFetchRef.current) return;
        if (result) {
          setSplitQuoteResult(aggregatorRef.current.buildSplitQuote({
            distribution: newDist,
            icpswapQuote: result.icpswapQuote, kongQuote: result.kongQuote,
            totalAmount: amount, inputToken, outputToken,
          }));
        } else {
          setSplitQuoteResult(null);
        }
      } catch (e) {
        if (cancelId !== splitFetchRef.current) return;
        setSplitQuoteResult(null);
      } finally {
        if (cancelId === splitFetchRef.current) setLoadingSplitQuote(false);
      }
    }, 250);
  }, [inputToken, outputToken, inputAmountStr, inputTokenInfo, slippage]);

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
    setSplitQuoteResult(null);
    setSplitDistribution(50);
    setSelectedDexId(null);
    setResult(null);
  };

  // ── Fetch a single token balance using the aggregator's agent (properly configured with host) ──
  const fetchBalanceWithAgent = useCallback(async (tokenCanisterId) => {
    if (!identity || !tokenCanisterId) return null;
    try {
      // Use the aggregator's agent if available (properly configured with host),
      // otherwise fall back to creating a new one
      const agent = aggregatorRef.current?.config?.agent;
      const actor = agent
        ? createLedgerActor(tokenCanisterId, { agent })
        : createLedgerActor(tokenCanisterId, { agentOptions: { identity } });
      const bal = await actor.icrc1_balance_of({ owner: identity.getPrincipal(), subaccount: [] });
      console.log(`[SwapWidget] fetchBalanceWithAgent OK for ${tokenCanisterId}:`, bal?.toString());
      return bal;
    } catch (err) {
      console.warn(`[SwapWidget] fetchBalanceWithAgent FAILED for ${tokenCanisterId}:`, err);
      return null;
    }
  }, [identity]);

  // ── Execute swap ──
  // ── Execute a single auction buyout ──
  const executeBuyout = async (offer, buyoutPrice, onProgress) => {
    if (!identity) throw new Error('Not authenticated');
    const actor = createSneedexActor(identity);
    const offerId = BigInt(offer.id);

    // Step 1: Reserve a bid
    onProgress?.({ step: 'RESERVING', message: `Sneedex #${Number(offerId)}: Reserving buyout...` });
    const reserveResult = await actor.reserveBid(offerId);
    if ('err' in reserveResult) {
      const errMsg = typeof reserveResult.err === 'object' ? JSON.stringify(reserveResult.err) : String(reserveResult.err);
      throw new Error(`Reserve failed: ${errMsg}`);
    }
    const bidId = reserveResult.ok;

    // Get escrow subaccount
    const subaccount = await actor.getBidEscrowSubaccount(identity.getPrincipal(), bidId);

    // Step 2: Transfer payment to escrow
    onProgress?.({ step: 'TRANSFERRING', message: `Sneedex #${Number(offerId)}: Transferring ${formatAmount(buyoutPrice, inputTokenInfo?.decimals || 8)} ${inputTokenInfo?.symbol}...` });
    const ledgerActor = createLedgerActor(offer.price_token_ledger.toString(), { agentOptions: { identity, host: getHost() } });

    const fee = await ledgerActor.icrc1_fee();
    const transferResult = await ledgerActor.icrc1_transfer({
      to: {
        owner: Principal.fromText(SNEEDEX_CANISTER_ID),
        subaccount: [Array.from(subaccount)],
      },
      fee: [fee],
      memo: [],
      from_subaccount: [],
      created_at_time: [],
      amount: buyoutPrice,
    });

    if ('Err' in transferResult) {
      const err = transferResult.Err;
      if ('InsufficientFunds' in err) {
        throw new Error(`Insufficient funds. Balance: ${formatAmount(err.InsufficientFunds.balance, inputTokenInfo?.decimals || 8)} ${inputTokenInfo?.symbol}`);
      }
      throw new Error(`Transfer failed: ${JSON.stringify(err)}`);
    }

    // Step 3: Confirm bid (completes the buyout)
    onProgress?.({ step: 'CONFIRMING', message: `Sneedex #${Number(offerId)}: Confirming buyout...` });
    const confirmResult = await actor.confirmBid(bidId, buyoutPrice);
    if ('err' in confirmResult) {
      const errMsg = typeof confirmResult.err === 'object' ? JSON.stringify(confirmResult.err) : String(confirmResult.err);
      throw new Error(`Confirm failed: ${errMsg}`);
    }

    return { success: true, offerId: Number(offerId), bidId };
  };

  const handleSwap = async () => {
    if (!aggregatorRef.current || allQuotes.length === 0) return;
    const quote = selectedQuote;
    if (!quote) return;

    setSwapping(true);
    swappingRef.current = true;
    setResult(null);
    setProgress(null);

    try {
      let res;

      if (quote.isAuctionQuote) {
        // ── Single auction buyout ──
        setProgress({ step: 'RESERVING', message: 'Starting buyout...', isBuyout: true, stepIndex: 0, totalSteps: 3 });
        const buyoutResult = await executeBuyout(
          quote.auctionOffer,
          quote.auctionBuyoutPrice,
          (p) => setProgress(prev => ({
            ...prev, ...p, isBuyout: true,
            stepIndex: p.step === 'RESERVING' ? 0 : p.step === 'TRANSFERRING' ? 1 : 2,
            totalSteps: 3,
          })),
        );
        res = {
          success: true,
          amountOut: quote.auctionOutputAmount,
          isBuyout: true,
          offerId: buyoutResult.offerId,
        };

      } else if (quote.isSplitTrade) {
        // ── Split Trade: execute buyouts AND swap in PARALLEL ──
        const splitTradeLegs = {};

        // Initialize progress for all legs
        const initLegs = () => {
          const l = {};
          quote.usedBuyouts.forEach((b, i) => {
            l[`buyout-${Number(b.offer.id)}`] = {
              label: `Sneedex #${Number(b.offer.id)}`,
              status: 'pending', message: 'Waiting...', type: 'buyout',
            };
          });
          if (quote.swapLegRemaining > 0n) {
            l['swap'] = {
              label: quote.swapLegQuote?.dexName || 'DEX Swap',
              status: 'pending', message: 'Waiting...', type: 'swap',
            };
          }
          return l;
        };
        const legStatus = initLegs();

        const updateLegProgress = (legKey, update) => {
          legStatus[legKey] = { ...legStatus[legKey], ...update };
          setProgress({
            isSplitTrade: true,
            legs: { ...legStatus },
          });
        };

        setProgress({ isSplitTrade: true, legs: { ...legStatus } });

        // Build all tasks to run in parallel
        const tasks = [];

        // Buyout tasks
        for (const b of quote.usedBuyouts) {
          const legKey = `buyout-${Number(b.offer.id)}`;
          tasks.push((async () => {
            try {
              updateLegProgress(legKey, { status: 'active', message: 'Reserving...' });
              await executeBuyout(b.offer, b.buyoutPrice, (p) => {
                updateLegProgress(legKey, { status: 'active', message: p.message });
              });
              updateLegProgress(legKey, { status: 'done', message: 'Buyout complete' });
              return { type: 'buyout', offerId: Number(b.offer.id), success: true, amountOut: b.outputAmount };
            } catch (e) {
              updateLegProgress(legKey, { status: 'failed', message: e.message });
              return { type: 'buyout', offerId: Number(b.offer.id), success: false, error: e.message, amountOut: 0n };
            }
          })());
        }

        // Swap task (runs in parallel with buyouts)
        if (quote.swapLegRemaining > 0n && quote.swapLegQuote) {
          tasks.push((async () => {
            const legKey = 'swap';
            try {
              updateLegProgress(legKey, { status: 'active', message: 'Getting fresh quote...' });
              const freshQuotes = await aggregatorRef.current.getQuotes({
                inputToken: quote.inputToken,
                outputToken: quote.outputToken,
                amountIn: quote.swapLegRemaining,
              });
              const preferredDexId = quote.swapLegQuote.dexId;
              const remainderQuote = freshQuotes.find(q => q.dexId === preferredDexId)
                || freshQuotes[0];

              if (!remainderQuote) throw new Error('No swap quote available for remainder');

              updateLegProgress(legKey, { status: 'active', message: `Swapping via ${remainderQuote.dexName}...` });
              const swapRes = await aggregatorRef.current.swap({
                quote: remainderQuote,
                slippage,
                onProgress: (p) => {
                  updateLegProgress(legKey, { status: 'active', message: p.message || `${p.step}...` });
                },
              });
              updateLegProgress(legKey, { status: 'done', message: 'Swap complete' });
              return { type: 'swap', dexId: remainderQuote.dexId, success: swapRes.success !== false, amountOut: swapRes.amountOut || 0n };
            } catch (e) {
              updateLegProgress(legKey, { status: 'failed', message: e.message });
              return { type: 'swap', dexId: quote.swapLegQuote.dexId, success: false, error: e.message, amountOut: 0n };
            }
          })());
        }

        // Run ALL legs in parallel
        const results = await Promise.allSettled(tasks);
        const legs = results.map(r => r.status === 'fulfilled' ? r.value : { success: false, error: r.reason?.message, amountOut: 0n });
        const totalOut = legs.reduce((sum, l) => sum + (l.amountOut || 0n), 0n);
        const allSuccess = legs.every(l => l.success);

        res = {
          success: allSuccess,
          amountOut: totalOut,
          isSplitTrade: true,
          legs,
        };

      } else {
        // ── Normal DEX swap or split swap ──
        res = await aggregatorRef.current.swap({
          quote,
          slippage,
          onProgress: setProgress,
        });
      }

      setResult(res);
      
      // Capture tokens for post-swap refresh (before any state changes)
      const swappedInput = inputToken;
      const swappedOutput = outputToken;
      
      if (res.success !== false) {
        console.log(`[SwapWidget] Swap succeeded, refreshing: input=${swappedInput}, output=${swappedOutput}`);
        
        // 1. Immediately refresh BOTH balances in the swap dialog
        //    Fetch them independently using the aggregator's properly-configured agent
        const refreshBothBalances = async () => {
          const [inBal, outBal] = await Promise.all([
            fetchBalanceWithAgent(swappedInput),
            fetchBalanceWithAgent(swappedOutput),
          ]);
          console.log(`[SwapWidget] Post-swap balances: input=${inBal?.toString()}, output=${outBal?.toString()}`);
          if (inBal !== null) setInputBalance(inBal);
          if (outBal !== null) setOutputBalance(outBal);
        };
        refreshBothBalances();
        
        // 2. Signal wallet to refresh BOTH tokens via onSwapComplete callback
        if (onSwapComplete) {
          onSwapComplete(swappedInput, swappedOutput);
        }
        
        // 3. Ensure the output token is registered in the wallet (auto-add if new)
        const ensureFn = walletContext?.ensureTokenRegistered;
        if (ensureFn) {
          ensureFn(swappedOutput);
        }
        
        // 4. Directly call refreshTokenBalance from wallet context for BOTH tokens
        //    (belt-and-suspenders: ensures wallet/quick wallet updates even if callback doesn't propagate)
        const refreshFn = walletContext?.refreshTokenBalance;
        if (refreshFn) {
          console.log(`[SwapWidget] Calling refreshTokenBalance for input=${swappedInput} and output=${swappedOutput}`);
          refreshFn(swappedInput);
          refreshFn(swappedOutput);
        } else {
          console.warn('[SwapWidget] No refreshTokenBalance available from wallet context');
        }
        
        // 4. Delayed re-fetch to catch any ledger propagation delay
        setTimeout(async () => {
          const [inBal, outBal] = await Promise.all([
            fetchBalanceWithAgent(swappedInput),
            fetchBalanceWithAgent(swappedOutput),
          ]);
          if (inBal !== null) setInputBalance(inBal);
          if (outBal !== null) setOutputBalance(outBal);
          // Also re-trigger wallet context refresh for output token
          if (refreshFn) {
            refreshFn(swappedOutput);
          }
        }, 2000);
      } else {
        // Swap reported failure - still refresh balances to show current state
        fetchBalances();
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
      swappingRef.current = false;
    }
  };

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
        .split-slider {
          -webkit-appearance: none;
          appearance: none;
          border-radius: 3px;
          outline: none;
          background: linear-gradient(to right, ${SWAP_BLUE}, ${SWAP_PURPLE});
          opacity: 0.85;
          transition: opacity 0.15s ease;
        }
        .split-slider:hover {
          opacity: 1;
        }
        .split-slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 18px;
          height: 18px;
          border-radius: 50%;
          background: #fff;
          border: 2.5px solid ${SWAP_PURPLE};
          cursor: pointer;
          box-shadow: 0 2px 8px rgba(0,0,0,0.2);
          transition: transform 0.15s ease, box-shadow 0.15s ease;
        }
        .split-slider::-webkit-slider-thumb:hover {
          transform: scale(1.15);
          box-shadow: 0 2px 12px rgba(139, 92, 246, 0.4);
        }
        .split-slider::-moz-range-thumb {
          width: 18px;
          height: 18px;
          border-radius: 50%;
          background: #fff;
          border: 2.5px solid ${SWAP_PURPLE};
          cursor: pointer;
          box-shadow: 0 2px 8px rgba(0,0,0,0.2);
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

        {/* ─── Split slider (shown when both DEXes have quotes) ─── */}
        {icpswapQuote && kongQuote && (
          <SplitSlider
            distribution={splitDistribution}
            onChange={handleSliderChange}
            disabled={swapping}
            loading={loadingSplitQuote}
            autoSearching={autoSearching}
          />
        )}

        {/* ─── Quotes list ─── */}
        {allQuotes.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{
              fontSize: 13, color: theme.colors.mutedText, fontWeight: 500,
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <span>Quotes ({allQuotes.length})</span>
              <span style={{ fontSize: 11, opacity: 0.7 }}>
                {loadingQuotes ? 'Refreshing...' : ''}
              </span>
            </div>
            {allQuotes.map((q, i) => {
              // Compute advantage when a special card (split, auction, split trade) is best
              let splitAdv = null;
              const isSpecial = q.isSplitQuote || q.isAuctionQuote || q.isSplitTrade;
              if (isSpecial && i === 0 && allQuotes.length > 1) {
                const nextBest = allQuotes[1];
                const diff = q.expectedOutput - nextBest.expectedOutput;
                if (diff > 0n) {
                  const pct = nextBest.expectedOutput > 0n
                    ? (Number(diff) / Number(nextBest.expectedOutput)) * 100
                    : 0;
                  const outDec = outputTokenInfo?.decimals || 8;
                  const usdVal = outputUsdPrice
                    ? formatUSD((Number(diff) / (10 ** outDec)) * outputUsdPrice)
                    : null;
                  splitAdv = { amount: diff, percent: pct, usdValue: usdVal };
                }
              }
              return (
                <QuoteCard
                  key={q.dexId}
                  quote={q}
                  selected={selectedQuote?.dexId === q.dexId}
                  onSelect={() => setSelectedDexId(q.dexId)}
                  inputDecimals={inputTokenInfo?.decimals || 8}
                  outputDecimals={outputTokenInfo?.decimals || 8}
                  outputUsdPrice={outputUsdPrice}
                  isBest={i === 0 && allQuotes.length > 1}
                  splitAdvantage={splitAdv}
                  inputSymbol={inputTokenInfo?.symbol || ''}
                  outputSymbol={outputTokenInfo?.symbol || ''}
                />
              );
            })}
          </div>
        )}

        {/* ─── Matching Sneedex Auctions (ads) ─── */}
        {matchingAuctions.length > 0 && inputTokenInfo && outputTokenInfo && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{
              fontSize: 12, color: 'var(--color-mutedText)', fontWeight: 500,
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ color: '#f39c12' }}>★</span>
                Sneedex Auctions ({matchingAuctions.length})
              </span>
              {loadingAuctions && <span style={{ fontSize: 10, opacity: 0.6 }}>Loading...</span>}
            </div>
            {matchingAuctions.map(offer => {
              // Find the ICRC1Token output for this pair
              let outputAmount = 0n;
              for (const ae of offer.assets || []) {
                const d = getAssetDetails(ae);
                if (d.type === 'ICRC1Token' && d.ledger_id === outputToken) {
                  outputAmount += BigInt(d.amount);
                }
              }
              const buyoutPrice = offer.buyout_price?.[0] ? BigInt(offer.buyout_price[0]) : null;
              const rate = buyoutPrice && buyoutPrice > 0n
                ? (Number(outputAmount) / (10 ** outputTokenInfo.decimals)) /
                  (Number(buyoutPrice) / (10 ** inputTokenInfo.decimals))
                : 0;

              return (
                <MiniAuctionCard
                  key={Number(offer.id)}
                  offer={offer}
                  outputAmount={outputAmount}
                  buyoutPrice={buyoutPrice || 0n}
                  rate={rate}
                  inputTokenInfo={inputTokenInfo}
                  outputTokenInfo={outputTokenInfo}
                  outputUsdPrice={outputUsdPrice}
                />
              );
            })}
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
        {progress && progress.isSplitTrade && <SplitTradeProgressPanel progress={progress} />}
        {progress && progress.isSplit && !progress.isSplitTrade && <SplitProgressPanel progress={progress} />}
        {progress && !progress.isSplit && !progress.isSplitTrade && <ProgressPanel progress={progress} />}

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
              {result.isSplitTrade ? 'Split trade successful!' : result.isBuyout ? 'Buyout successful!' : result.isSplit ? 'Split swap successful!' : 'Swap successful!'}
            </div>
            <div style={{ fontSize: 13, color: theme.colors.secondaryText }}>
              Received: <strong>{formatAmount(result.amountOut, outputTokenInfo.decimals)} {outputTokenInfo.symbol}</strong>
              {outputUsdPrice !== null && (
                <span style={{ color: theme.colors.mutedText }}>
                  {' '}({formatUSD((Number(result.amountOut) / (10 ** outputTokenInfo.decimals)) * outputUsdPrice)})
                </span>
              )}
            </div>
            {result.isSplit && result.legs && (
              <div style={{ display: 'flex', justifyContent: 'center', gap: 16, marginTop: 6, fontSize: 11, color: theme.colors.mutedText }}>
                {result.legs.map(leg => (
                  <span key={leg.dexId}>
                    {leg.dexId === 'icpswap' ? 'ICPSwap' : 'Kong'}:{' '}
                    <strong style={{ color: theme.colors.secondaryText }}>
                      {formatAmount(leg.amountOut, outputTokenInfo.decimals)}
                    </strong>
                    {!leg.success && <span style={{ color: theme.colors.error }}> (failed)</span>}
                  </span>
                ))}
              </div>
            )}
            {result.isSplitTrade && result.legs && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, marginTop: 6, fontSize: 11, color: theme.colors.mutedText }}>
                {result.legs.map((leg, idx) => (
                  <span key={idx}>
                    {leg.type === 'buyout' ? `Sneedex #${leg.offerId}` : leg.dexId === 'icpswap' ? 'ICPSwap' : leg.dexId === 'kong' ? 'Kong' : leg.dexId}:{' '}
                    {leg.success ? (
                      <strong style={{ color: theme.colors.secondaryText }}>
                        {formatAmount(leg.amountOut, outputTokenInfo.decimals)} {outputTokenInfo.symbol}
                      </strong>
                    ) : (
                      <span style={{ color: theme.colors.error }}>failed{leg.error ? ` — ${leg.error}` : ''}</span>
                    )}
                  </span>
                ))}
              </div>
            )}
            {result.isBuyout && result.offerId && (
              <div style={{ fontSize: 11, color: theme.colors.mutedText, marginTop: 4 }}>
                <Link to={`/sneedex_offer/${result.offerId}`} style={{ color: 'var(--color-accent)' }}>
                  View auction #{result.offerId}
                </Link>
              </div>
            )}
          </div>
        )}
        {/* Partial split failure */}
        {result && !result.success && result.isSplit && outputTokenInfo && (
          <div style={{
            textAlign: 'center', padding: '14px 16px', borderRadius: 12,
            background: 'rgba(231, 76, 60, 0.06)',
            border: `1px solid ${theme.colors.error}40`,
          }}>
            <div style={{
              fontSize: 15, fontWeight: 700, color: theme.colors.error,
              marginBottom: 4,
            }}>
              Split swap partially failed
            </div>
            <div style={{ fontSize: 13, color: theme.colors.secondaryText }}>
              {result.amountOut > 0n
                ? <>Received: <strong>{formatAmount(result.amountOut, outputTokenInfo.decimals)} {outputTokenInfo.symbol}</strong> (partial)</>
                : 'No output received'}
            </div>
            {result.legs && (
              <div style={{ display: 'flex', justifyContent: 'center', gap: 16, marginTop: 6, fontSize: 11, color: theme.colors.mutedText }}>
                {result.legs.map(leg => (
                  <span key={leg.dexId}>
                    {leg.dexId === 'icpswap' ? 'ICPSwap' : 'Kong'}:{' '}
                    {leg.success
                      ? <strong style={{ color: theme.colors.success }}>{formatAmount(leg.amountOut, outputTokenInfo.decimals)}</strong>
                      : <span style={{ color: theme.colors.error }}>failed{leg.error ? ` — ${leg.error}` : ''}</span>}
                  </span>
                ))}
              </div>
            )}
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
           allQuotes.length === 0 ? (loadingQuotes ? 'Loading...' : 'No Quotes') :
           selectedQuote?.isSplitQuote ? 'Split Swap' :
           selectedQuote?.isAuctionQuote ? 'Buy from Auction' :
           selectedQuote?.isSplitTrade ? 'Split Trade' :
           'Swap'}
        </button>

        {/* ─── Selected quote details ─── */}
        {selectedQuote && inputTokenInfo && outputTokenInfo && !swapping && !result?.success && (
          <div style={{
            fontSize: 12, color: theme.colors.mutedText, lineHeight: 1.7,
            padding: '10px 14px', borderRadius: 12,
            background: theme.colors.primaryBg,
            border: `1px solid ${
              selectedQuote.isSplitTrade ? '#f39c1220' :
              selectedQuote.isAuctionQuote ? '#f39c1220' :
              selectedQuote.isSplitQuote ? '#8b5cf620' :
              theme.colors.border}`,
          }}>
            {/* Header for special quote types */}
            {selectedQuote.isSplitQuote && (
              <div style={{
                display: 'flex', justifyContent: 'space-between',
                paddingBottom: 6, marginBottom: 4,
                borderBottom: `1px solid ${theme.colors.border}`,
              }}>
                <span style={{ fontWeight: 600, color: theme.colors.primaryText }}>Split Swap</span>
                <span style={{ color: '#8b5cf6', fontWeight: 500 }}>
                  {100 - selectedQuote.distribution}% ICPSwap / {selectedQuote.distribution}% Kong
                </span>
              </div>
            )}
            {selectedQuote.isAuctionQuote && (
              <div style={{
                display: 'flex', justifyContent: 'space-between',
                paddingBottom: 6, marginBottom: 4,
                borderBottom: `1px solid ${theme.colors.border}`,
              }}>
                <span style={{ fontWeight: 600, color: theme.colors.primaryText }}>Auction Buyout</span>
                <span style={{ color: '#f39c12', fontWeight: 500 }}>
                  Sneedex #{Number(selectedQuote.auctionOffer?.id)}
                </span>
              </div>
            )}
            {selectedQuote.isSplitTrade && (
              <div style={{
                display: 'flex', justifyContent: 'space-between',
                paddingBottom: 6, marginBottom: 4,
                borderBottom: `1px solid ${theme.colors.border}`,
              }}>
                <span style={{ fontWeight: 600, color: theme.colors.primaryText }}>Split Trade</span>
                <span style={{ color: '#f39c12', fontWeight: 500 }}>
                  {selectedQuote.usedBuyouts?.length} buyout{selectedQuote.usedBuyouts?.length > 1 ? 's' : ''}
                  {selectedQuote.swapLegRemaining > 0n ? ' + swap' : ''}
                </span>
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Rate</span>
              <span style={{ color: theme.colors.secondaryText }}>
                1 {inputTokenInfo.symbol} = {selectedQuote.spotPrice?.toFixed(6)} {outputTokenInfo.symbol}
                {inputUsdPrice !== null && (
                  <span style={{ color: theme.colors.mutedText }}> ({formatUSD(inputUsdPrice)})</span>
                )}
              </span>
            </div>

            {/* Price impact — not applicable for pure auction buyouts */}
            {!selectedQuote.isAuctionQuote && (
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Price impact{selectedQuote.isSplitQuote ? ' (worst leg)' : ''}</span>
                <span style={{ color: selectedQuote.priceImpact > 0.05 ? theme.colors.error : theme.colors.secondaryText }}>
                  {(selectedQuote.priceImpact * 100).toFixed(2)}%
                </span>
              </div>
            )}

            {/* Slippage — not applicable for pure auction buyouts */}
            {!selectedQuote.isAuctionQuote && (
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Slippage tolerance</span>
                <span style={{ color: theme.colors.secondaryText }}>{(slippage * 100).toFixed(1)}%</span>
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>{selectedQuote.isAuctionQuote ? 'You receive' : 'Min received'}</span>
              <span style={{ color: theme.colors.secondaryText }}>
                {formatAmount(selectedQuote.isAuctionQuote ? selectedQuote.expectedOutput : selectedQuote.minimumOutput, outputTokenInfo.decimals)} {outputTokenInfo.symbol}
                {outputUsdPrice !== null && (
                  <span style={{ color: theme.colors.mutedText }}>
                    {' '}({formatUSD((Number(selectedQuote.isAuctionQuote ? selectedQuote.expectedOutput : selectedQuote.minimumOutput) / (10 ** outputTokenInfo.decimals)) * outputUsdPrice)})
                  </span>
                )}
              </span>
            </div>

            {!selectedQuote.isAuctionQuote && (
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Network fees</span>
                <span style={{ color: theme.colors.secondaryText }}>
                  {selectedQuote.feeBreakdown.totalInputFeesCount}&times; in +{' '}
                  {selectedQuote.feeBreakdown.totalOutputFeesCount}&times; out
                </span>
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Standard</span>
              <span style={{ color: theme.colors.secondaryText }}>
                {selectedQuote.isSplitQuote || selectedQuote.isSplitTrade ? 'MIXED' :
                 selectedQuote.isAuctionQuote ? 'ICRC1 (transfer)' :
                 selectedQuote.standard?.toUpperCase()}
              </span>
            </div>

            {selectedQuote.isAuctionQuote && (
              <div style={{
                marginTop: 6, paddingTop: 6, borderTop: `1px solid ${theme.colors.border}`,
                fontSize: 11, color: theme.colors.mutedText, opacity: 0.8,
              }}>
                Exact amount — no slippage or price impact. You are buying out a Sneedex auction.
              </div>
            )}

            {selectedQuote.isSplitQuote && (
              <div style={{
                marginTop: 6, paddingTop: 6, borderTop: `1px solid ${theme.colors.border}`,
                fontSize: 11, color: theme.colors.mutedText, opacity: 0.8,
              }}>
                Both legs execute in parallel. If one leg fails, the other may still succeed (partial fill).
              </div>
            )}

            {selectedQuote.isSplitTrade && (
              <div style={{
                marginTop: 6, paddingTop: 6, borderTop: `1px solid ${theme.colors.border}`,
                fontSize: 11, color: theme.colors.mutedText, opacity: 0.8,
              }}>
                Buyouts execute first, then the remaining amount is swapped.
                {selectedQuote.usedBuyouts?.length > 1 ? ' Multiple buyouts execute in sequence.' : ''}
                {' '}If a buyout fails, the remaining buyouts and swap may still proceed.
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
