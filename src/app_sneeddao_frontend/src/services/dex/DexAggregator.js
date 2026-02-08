/**
 * DexAggregator — Unified entry point for the multi-DEX swap API.
 *
 * Responsibilities:
 * 1. Registry of DEX adapters
 * 2. Parallel quoting across all (or selected) DEXes
 * 3. Standard-aware filtering (ICRC1 vs ICRC2)
 * 4. Swap execution via a chosen quote
 * 5. Multi-hop route discovery (future)
 *
 * Usage:
 *   const agg = new DexAggregator({ identity, agent });
 *   agg.registerDex(new ICPSwapDex({ identity, agent }));
 *   agg.registerDex(new KongDex({ identity, agent }));
 *
 *   const quotes = await agg.getQuotes({ inputToken, outputToken, amount });
 *   const result = await agg.swap({ quote: quotes[0], slippage: 0.01, onProgress });
 */

import { DEFAULT_SLIPPAGE, SwapStep } from './types.js';
import { getTokenInfo, resolveStandard } from './tokenStandard.js';

export class DexAggregator {
  /**
   * @param {import('./types').DexConfig} config
   */
  constructor(config) {
    this.config = config;
    /** @type {Map<string, import('./dexes/BaseDex').BaseDex>} */
    this._dexes = new Map();
  }

  // ─── Registry ─────────────────────────────────────────────────────────────

  /**
   * Register a DEX adapter.
   * @param {import('./dexes/BaseDex').BaseDex} dex
   */
  registerDex(dex) {
    this._dexes.set(dex.id, dex);
  }

  /**
   * Unregister a DEX adapter.
   * @param {string} dexId
   */
  unregisterDex(dexId) {
    this._dexes.delete(dexId);
  }

  /**
   * Get a specific DEX adapter for direct API access.
   * @param {string} dexId
   * @returns {import('./dexes/BaseDex').BaseDex | undefined}
   */
  getDex(dexId) {
    return this._dexes.get(dexId);
  }

  /**
   * List all registered DEXes.
   * @returns {Array<{ id: string, name: string, supportedStandards: string[] }>}
   */
  getSupportedDexes() {
    return [...this._dexes.values()].map(d => ({
      id: d.id,
      name: d.name,
      supportedStandards: d.supportedStandards,
    }));
  }

  // ─── Quoting ──────────────────────────────────────────────────────────────

  /**
   * Get quotes from all compatible DEXes for a token pair.
   *
   * @param {Object} params
   * @param {string}  params.inputToken   - Ledger canister ID
   * @param {string}  params.outputToken  - Ledger canister ID
   * @param {bigint}  params.amount       - Raw input amount (before fees)
   * @param {number}  [params.slippage]   - Slippage tolerance (default 1%)
   * @param {string}  [params.preferredStandard] - 'icrc1' | 'icrc2' | undefined
   * @param {string[]} [params.dexIds]    - Limit to specific DEXes (default: all)
   * @returns {Promise<import('./types').SwapQuote[]>} Sorted by expectedOutput (best first)
   */
  async getQuotes({
    inputToken,
    outputToken,
    amount,
    slippage = DEFAULT_SLIPPAGE,
    preferredStandard,
    dexIds,
  }) {
    // Resolve token info (cached)
    const agent = this.config.agent;
    const inputInfo = await getTokenInfo(inputToken, agent);

    // Build list of DEXes to query
    let dexes = [...this._dexes.values()];
    if (dexIds) dexes = dexes.filter(d => dexIds.includes(d.id));

    // Filter DEXes by standard compatibility
    dexes = dexes.filter(d => {
      // At least one standard must overlap with the token
      return d.supportedStandards.some(s => inputInfo.supportedStandards.includes(s));
    });

    // Query all compatible DEXes in parallel
    const results = await Promise.allSettled(
      dexes.map(async (dex) => {
        // Resolve which standard this DEX will use
        const standard = resolveStandard(inputInfo, dex.supportedStandards, preferredStandard);

        const quote = await dex.getQuote({
          inputToken,
          outputToken,
          amount,
          standard,
          slippage,
        });

        return quote;
      })
    );

    // Collect successful quotes
    const quotes = [];
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (r.status === 'fulfilled') {
        quotes.push(r.value);
      } else {
        console.warn(`Quote from ${dexes[i].name} failed:`, r.reason?.message || r.reason);
      }
    }

    // Sort by expectedOutput descending (best quote first)
    quotes.sort((a, b) => {
      if (b.expectedOutput > a.expectedOutput) return 1;
      if (b.expectedOutput < a.expectedOutput) return -1;
      return 0;
    });

    return quotes;
  }

  // ─── Swap Execution ──────────────────────────────────────────────────────

  /**
   * Execute a swap using a previously obtained quote.
   * Handles both single-DEX and split quotes transparently.
   *
   * @param {Object} params
   * @param {import('./types').SwapQuote} params.quote
   * @param {number}  [params.slippage]       - Override slippage (default: from quote)
   * @param {string}  [params.standard]       - Override standard
   * @param {function(import('./types').SwapProgress): void} [params.onProgress]
   * @returns {Promise<{ success: boolean, amountOut: bigint, txId?: string, isSplit?: boolean, legs?: Array }>}
   */
  async swap({ quote, slippage = DEFAULT_SLIPPAGE, standard, onProgress }) {
    // ── Split quote → execute both legs in parallel ──
    if (quote.isSplitQuote) {
      return this._executeSplitSwap({ splitQuote: quote, slippage, onProgress });
    }

    const dex = this._dexes.get(quote.dexId);
    if (!dex) throw new Error(`DEX "${quote.dexId}" is not registered`);

    // Allow caller to override standard
    if (standard && standard !== quote.standard) {
      quote = { ...quote, standard };
    }

    return dex.executeSwap({ quote, slippage, onProgress });
  }

  // ─── Split Swap Support ────────────────────────────────────────────────────

  /**
   * Get a combined quote for a given split distribution between DEXes.
   *
   * @param {Object} params
   * @param {bigint}  params.totalAmount        - Total input in base units
   * @param {number}  params.distribution       - 0-100, percentage that goes to Kong
   * @param {string}  params.inputToken
   * @param {string}  params.outputToken
   * @param {number}  params.slippage
   * @param {string}  [params.preferredStandard]
   * @returns {Promise<{ distribution: number, totalOut: bigint, icpswapQuote: SwapQuote|null, kongQuote: SwapQuote|null }|null>}
   */
  async getQuoteForDistribution({
    totalAmount, distribution, inputToken, outputToken, slippage, preferredStandard,
  }) {
    const kongAmount = (totalAmount * BigInt(distribution)) / 100n;
    const icpswapAmount = totalAmount - kongAmount; // subtraction avoids dust loss

    const agent = this.config.agent;
    const inputInfo = await getTokenInfo(inputToken, agent);

    const icpswapDex = this._dexes.get('icpswap');
    const kongDex = this._dexes.get('kong');
    if (!icpswapDex || !kongDex) return null;

    const getQuoteForDex = async (dex, amount) => {
      if (amount <= 0n) return null;
      const standard = resolveStandard(inputInfo, dex.supportedStandards, preferredStandard);
      return dex.getQuote({ inputToken, outputToken, amount, standard, slippage });
    };

    const [icpswapQuote, kongQuote] = await Promise.all([
      getQuoteForDex(icpswapDex, icpswapAmount).catch(() => null),
      getQuoteForDex(kongDex, kongAmount).catch(() => null),
    ]);

    const totalOut = (icpswapQuote?.expectedOutput || 0n) + (kongQuote?.expectedOutput || 0n);

    return { distribution, totalOut, icpswapQuote, kongQuote };
  }

  /**
   * Build a SwapQuote-compatible split object from a distribution result.
   *
   * @param {Object} params
   * @param {number}  params.distribution       - 0-100 (Kong %)
   * @param {import('./types').SwapQuote|null} params.icpswapQuote
   * @param {import('./types').SwapQuote|null} params.kongQuote
   * @param {bigint}  params.totalAmount
   * @param {string}  params.inputToken
   * @param {string}  params.outputToken
   * @returns {import('./types').SwapQuote|null}
   */
  buildSplitQuote({ distribution, icpswapQuote, kongQuote, totalAmount, inputToken, outputToken }) {
    const legs = [];
    if (icpswapQuote) legs.push({ dexId: 'icpswap', dexName: 'ICPSwap',  quote: icpswapQuote });
    if (kongQuote)    legs.push({ dexId: 'kong',     dexName: 'KongSwap', quote: kongQuote });
    if (legs.length === 0) return null;

    const totalExpected  = legs.reduce((s, l) => s + l.quote.expectedOutput, 0n);
    const totalMinimum   = legs.reduce((s, l) => s + l.quote.minimumOutput, 0n);
    const totalEffInput  = legs.reduce((s, l) => s + l.quote.effectiveInputAmount, 0n);
    const worstImpact    = Math.max(...legs.map(l => l.quote.priceImpact));

    const totalInputNum = Number(totalAmount);
    const weightedFee   = totalInputNum > 0
      ? legs.reduce((s, l) => s + l.quote.dexFeePercent * (Number(l.quote.inputAmount) / totalInputNum), 0)
      : 0;

    const totalInputFees       = legs.reduce((s, l) => s + l.quote.feeBreakdown.inputTransferFees, 0n);
    const totalOutputFees      = legs.reduce((s, l) => s + l.quote.feeBreakdown.outputWithdrawalFees, 0n);
    const totalInputFeesCount  = legs.reduce((s, l) => s + l.quote.feeBreakdown.totalInputFeesCount, 0);
    const totalOutputFeesCount = legs.reduce((s, l) => s + l.quote.feeBreakdown.totalOutputFeesCount, 0);
    const bestSpotPrice        = Math.max(...legs.map(l => l.quote.spotPrice || 0));

    return {
      dexId:    'split',
      dexName:  `Split (${100 - distribution}% ICPSwap / ${distribution}% Kong)`,
      isSplitQuote: true,
      distribution,
      legs,

      inputToken,
      outputToken,
      inputAmount:          totalAmount,
      effectiveInputAmount: totalEffInput,
      expectedOutput:       totalExpected,
      minimumOutput:        totalMinimum,
      spotPrice:            bestSpotPrice,
      priceImpact:          worstImpact,
      dexFeePercent:        weightedFee,
      feeBreakdown: {
        inputTransferFees:    totalInputFees,
        outputWithdrawalFees: totalOutputFees,
        dexTradingFee:        weightedFee,
        totalInputFeesCount,
        totalOutputFeesCount,
      },
      standard:  'mixed',
      route:     legs.flatMap(l => l.quote.route || []),
      timestamp: Date.now(),
    };
  }

  /**
   * Ternary search for the optimal split ratio.
   *
   * Treats f(distribution) = totalOutput as a unimodal function over [0, 100]
   * and finds its maximum. Edge-case guards handle fee-driven distortions near
   * the endpoints.
   *
   * @param {Object} params
   * @param {bigint}  params.totalAmount
   * @param {string}  params.inputToken
   * @param {string}  params.outputToken
   * @param {number}  params.slippage
   * @param {string}  [params.preferredStandard]
   * @param {import('./types').SwapQuote} [params.icpswapFullQuote] - Existing 100% ICPSwap quote
   * @param {import('./types').SwapQuote} [params.kongFullQuote]    - Existing 100% Kong quote
   * @param {function} [params.onUpdate]  - Called with { distribution, totalOut, icpswapQuote, kongQuote }
   *                                        whenever a better interior split is found during search
   * @returns {Promise<{ bestDistribution: number, bestAmount: bigint, bestResult: Object }>}
   */
  async findBestSplit({
    totalAmount, inputToken, outputToken, slippage, preferredStandard,
    icpswapFullQuote, kongFullQuote, onUpdate,
  }) {
    const PRECISION = 1;   // stop when range is 1% wide
    const MAX_ITER  = 10;  // safety cap

    /** @type {Map<number, bigint>} distribution → totalOut */
    const points  = new Map();
    /** @type {Map<number, Object>} distribution → full result */
    const results = new Map();

    // Seed endpoints from existing quotes (avoids re-fetching)
    const zeroVal    = icpswapFullQuote?.expectedOutput || 0n;
    const hundredVal = kongFullQuote?.expectedOutput || 0n;
    points.set(0,   zeroVal);
    points.set(100, hundredVal);
    results.set(0,   { distribution: 0,   totalOut: zeroVal,    icpswapQuote: icpswapFullQuote, kongQuote: null });
    results.set(100, { distribution: 100, totalOut: hundredVal, icpswapQuote: null,             kongQuote: kongFullQuote });

    let left  = 0;
    let right = 100;
    let iteration = 0;
    let lastReportedDist = -1;

    // Report the best interior point (1-99) whenever it changes
    const reportBestInterior = () => {
      if (!onUpdate) return;
      let bestDist = -1;
      let bestAmt  = 0n;
      for (const [dist, amt] of points) {
        if (dist > 0 && dist < 100 && amt > bestAmt) {
          bestAmt  = amt;
          bestDist = dist;
        }
      }
      if (bestDist >= 0 && bestDist !== lastReportedDist) {
        lastReportedDist = bestDist;
        const r = results.get(bestDist);
        onUpdate({
          distribution: bestDist,
          totalOut:     bestAmt,
          icpswapQuote: r?.icpswapQuote || null,
          kongQuote:    r?.kongQuote || null,
        });
      }
    };

    const testPoint = async (p) => {
      if (points.has(p)) return;
      const result = await this.getQuoteForDistribution({
        totalAmount, distribution: p, inputToken, outputToken, slippage, preferredStandard,
      });
      if (result) {
        points.set(p, result.totalOut);
        results.set(p, result);
      }
    };

    // ── Ternary search loop ──
    while (right - left > PRECISION && iteration < MAX_ITER) {
      const m1 = left  + Math.floor((right - left) / 3);
      const m2 = right - Math.floor((right - left) / 3);

      // Fetch any untested points in parallel
      const toTest = [m1, m2].filter(p => !points.has(p));
      if (toTest.length > 0) {
        await Promise.all(toTest.map(testPoint));
      }

      // Report intermediate best to animate the UI
      reportBestInterior();

      const leftVal  = points.get(m1) || 0n;
      const rightVal = points.get(m2) || 0n;

      // Narrow the range (with edge-case guards per spec)
      if (leftVal < rightVal) {
        if (zeroVal > rightVal && zeroVal > hundredVal) {
          right = m2;   // fee distortion: endpoint 0% dominates
        } else {
          left = m1;    // normal: peak is right of m1
        }
      } else if (leftVal > rightVal) {
        if (hundredVal > leftVal && hundredVal > zeroVal) {
          left = m1;    // fee distortion: endpoint 100% dominates
        } else {
          right = m2;   // normal: peak is left of m2
        }
      } else {
        right = m2;     // equal → shrink from right
      }

      iteration++;
    }

    // ── Pick the best from ALL tested points ──
    let bestDistribution = 0;
    let bestAmount       = 0n;
    for (const [dist, amount] of points) {
      if (amount > bestAmount) {
        bestAmount       = amount;
        bestDistribution = dist;
      }
    }

    return {
      bestDistribution,
      bestAmount,
      bestResult: results.get(bestDistribution),
    };
  }

  /**
   * Find the best split swap quote across ICPSwap and Kong.
   * Convenience method: runs findBestSplit + buildSplitQuote.
   *
   * Returns `null` if splitting doesn't beat the best single-DEX quote.
   *
   * @param {Object} params
   * @param {string}  params.inputToken
   * @param {string}  params.outputToken
   * @param {bigint}  params.amount
   * @param {number}  [params.slippage]
   * @param {string}  [params.preferredStandard]
   * @param {import('./types').SwapQuote[]} [params.existingQuotes]
   * @param {function} [params.onUpdate] - Forwarded to findBestSplit
   * @returns {Promise<import('./types').SwapQuote|null>}
   */
  async getSplitQuote({
    inputToken, outputToken, amount,
    slippage = DEFAULT_SLIPPAGE,
    preferredStandard,
    existingQuotes = [],
    onUpdate,
  }) {
    const icpswapDex = this._dexes.get('icpswap');
    const kongDex    = this._dexes.get('kong');
    if (!icpswapDex || !kongDex) return null;

    const icpswapFullQuote = existingQuotes.find(q => q.dexId === 'icpswap') || null;
    const kongFullQuote    = existingQuotes.find(q => q.dexId === 'kong')    || null;
    if (!icpswapFullQuote || !kongFullQuote) return null;

    const { bestDistribution, bestAmount, bestResult } = await this.findBestSplit({
      totalAmount: amount, inputToken, outputToken, slippage, preferredStandard,
      icpswapFullQuote, kongFullQuote, onUpdate,
    });

    if (bestDistribution <= 0 || bestDistribution >= 100) return null;

    const bestSingleOutput = icpswapFullQuote.expectedOutput > kongFullQuote.expectedOutput
      ? icpswapFullQuote.expectedOutput
      : kongFullQuote.expectedOutput;
    if (bestAmount <= bestSingleOutput) return null;

    return this.buildSplitQuote({
      distribution: bestDistribution,
      icpswapQuote: bestResult?.icpswapQuote,
      kongQuote:    bestResult?.kongQuote,
      totalAmount:  amount,
      inputToken,
      outputToken,
    });
  }

  /**
   * Execute a split swap — both legs in parallel.
   *
   * Progress reporting provides `isSplit: true` with per-leg status in `legs[]`.
   *
   * @param {Object} params
   * @param {import('./types').SwapQuote} params.splitQuote  - A split quote from getSplitQuote()
   * @param {number}  params.slippage
   * @param {function} [params.onProgress]
   * @returns {Promise<{ success: boolean, amountOut: bigint, isSplit: true, legs: Array }>}
   * @private
   */
  async _executeSplitSwap({ splitQuote, slippage, onProgress }) {
    const activeLegQuotes = splitQuote.legs.filter(l => l.quote && l.quote.inputAmount > 0n);
    if (activeLegQuotes.length === 0) throw new Error('No active legs in split quote');

    // Per-leg progress tracking
    const legStates = {};
    for (const leg of activeLegQuotes) {
      legStates[leg.dexId] = {
        step: 'pending', message: 'Waiting...', stepIndex: 0, totalSteps: 1,
        completed: false, failed: false,
      };
    }

    const reportCombined = () => {
      if (!onProgress) return;
      const legs = Object.entries(legStates).map(([dexId, state]) => ({
        dexId,
        dexName: activeLegQuotes.find(l => l.dexId === dexId)?.dexName || dexId,
        ...state,
      }));
      const allDone       = legs.every(l => l.completed || l.failed);
      const anyFailed     = legs.some(l => l.failed);
      const completedCnt  = legs.filter(l => l.completed).length;

      onProgress({
        isSplit: true,
        legs,
        step:    allDone ? (anyFailed ? SwapStep.FAILED : SwapStep.COMPLETE) : SwapStep.SWAPPING,
        message: allDone
          ? (anyFailed
            ? `Split swap: ${completedCnt}/${legs.length} legs succeeded`
            : 'Split swap completed!')
          : legs.map(l => `${l.dexName}: ${l.message}`).join(' | '),
        stepIndex:  completedCnt,
        totalSteps: legs.length,
        completed:  allDone && !anyFailed,
        failed:     allDone && anyFailed,
        error:      anyFailed
          ? legs.filter(l => l.failed).map(l => `${l.dexName}: ${l.error || 'failed'}`).join('; ')
          : undefined,
      });
    };

    reportCombined(); // initial state

    // Execute all legs in parallel
    const settled = await Promise.allSettled(
      activeLegQuotes.map(leg => {
        const dex = this._dexes.get(leg.dexId);
        if (!dex) return Promise.reject(new Error(`DEX "${leg.dexId}" not registered`));
        return dex.executeSwap({
          quote: leg.quote,
          slippage,
          onProgress: (p) => {
            legStates[leg.dexId] = p;
            reportCombined();
          },
        });
      })
    );

    // Combine results
    let totalOut   = 0n;
    let allSuccess = true;
    const legResults = [];

    for (let i = 0; i < settled.length; i++) {
      const r       = settled[i];
      const legDexId = activeLegQuotes[i].dexId;
      if (r.status === 'fulfilled') {
        totalOut += r.value.amountOut || 0n;
        if (r.value.success === false) allSuccess = false;
        legResults.push({ dexId: legDexId, ...r.value });
      } else {
        allSuccess = false;
        legResults.push({ dexId: legDexId, success: false, amountOut: 0n, error: r.reason?.message || 'Unknown error' });
      }
    }

    reportCombined(); // final state

    return {
      success:  allSuccess,
      amountOut: totalOut,
      isSplit:  true,
      legs:     legResults,
    };
  }

  // ─── Pair Discovery ──────────────────────────────────────────────────────

  /**
   * Check which DEXes support a given pair.
   * @param {string} inputToken
   * @param {string} outputToken
   * @returns {Promise<string[]>} DEX IDs that support the pair
   */
  async getAvailableDexes(inputToken, outputToken) {
    const results = await Promise.allSettled(
      [...this._dexes.values()].map(async (dex) => {
        const has = await dex.hasPair(inputToken, outputToken);
        return has ? dex.id : null;
      })
    );

    return results
      .filter(r => r.status === 'fulfilled' && r.value !== null)
      .map(r => r.value);
  }

  /**
   * Get all pairs for a token across all DEXes.
   * @param {string} token
   * @returns {Promise<Array<{ dexId: string, inputToken: string, outputToken: string, poolId: string }>>}
   */
  async getAllPairsForToken(token) {
    const results = await Promise.allSettled(
      [...this._dexes.values()].map(async (dex) => {
        const pairs = await dex.getPairsForToken(token);
        return pairs.map(p => ({ ...p, dexId: dex.id }));
      })
    );

    return results
      .filter(r => r.status === 'fulfilled')
      .flatMap(r => r.value);
  }
}

export default DexAggregator;
