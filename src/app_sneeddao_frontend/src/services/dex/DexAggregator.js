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

import { DEFAULT_SLIPPAGE } from './types.js';
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
   *
   * @param {Object} params
   * @param {import('./types').SwapQuote} params.quote
   * @param {number}  [params.slippage]       - Override slippage (default: from quote)
   * @param {string}  [params.standard]       - Override standard
   * @param {function(import('./types').SwapProgress): void} [params.onProgress]
   * @returns {Promise<{ success: boolean, amountOut: bigint, txId?: string }>}
   */
  async swap({ quote, slippage = DEFAULT_SLIPPAGE, standard, onProgress }) {
    const dex = this._dexes.get(quote.dexId);
    if (!dex) throw new Error(`DEX "${quote.dexId}" is not registered`);

    // Allow caller to override standard
    if (standard && standard !== quote.standard) {
      quote = { ...quote, standard };
    }

    return dex.executeSwap({ quote, slippage, onProgress });
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
