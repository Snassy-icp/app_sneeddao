/**
 * BaseDex — Abstract base class for DEX adapters.
 *
 * Each concrete adapter (ICPSwapDex, KongDex, …) must extend this class and
 * implement every method marked with `throw new Error('Not implemented')`.
 *
 * This file is self-contained.  It can be used outside the SneedDAO website.
 */

export class BaseDex {
  /** @type {string} Unique machine ID (lowercase, no spaces). */
  id = '';

  /** @type {string} Human-readable display name. */
  name = '';

  /** @type {string[]} e.g. ['icrc1','icrc2'] */
  supportedStandards = [];

  /**
   * @param {import('../types').DexConfig} config
   */
  constructor(config) {
    if (new.target === BaseDex) {
      throw new Error('BaseDex is abstract — subclass it.');
    }
    this.config = config;
  }

  // ─── Pair & Pool Discovery ────────────────────────────────────────────────

  /**
   * Does this DEX have a pool for the given pair?
   * @param {string} inputToken  - Ledger canister ID
   * @param {string} outputToken - Ledger canister ID
   * @returns {Promise<boolean>}
   */
  async hasPair(inputToken, outputToken) {
    throw new Error('Not implemented');
  }

  /**
   * Return all pairs that include `token` as input or output.
   * @param {string} token - Ledger canister ID
   * @returns {Promise<Array<{ inputToken: string, outputToken: string, poolId: string }>>}
   */
  async getPairsForToken(token) {
    throw new Error('Not implemented');
  }

  // ─── Pricing & Quoting ────────────────────────────────────────────────────

  /**
   * Get the spot price (output per 1.0 input, human-readable float).
   * @param {string} inputToken
   * @param {string} outputToken
   * @returns {Promise<number>}
   */
  async getSpotPrice(inputToken, outputToken) {
    throw new Error('Not implemented');
  }

  /**
   * Get a swap quote.
   *
   * @param {Object} params
   * @param {string}          params.inputToken
   * @param {string}          params.outputToken
   * @param {bigint}          params.amount      - Raw input amount (before fees)
   * @param {string}          params.standard    - 'icrc1' | 'icrc2'
   * @param {number}          params.slippage    - e.g. 0.01 for 1 %
   * @returns {Promise<import('../types').SwapQuote>}
   */
  async getQuote(params) {
    throw new Error('Not implemented');
  }

  // ─── Fee Accounting ───────────────────────────────────────────────────────

  /**
   * How many input-token fees does this DEX charge for the given standard?
   * @param {'icrc1'|'icrc2'} standard
   * @returns {number}
   */
  getInputFeeCount(standard) {
    throw new Error('Not implemented');
  }

  /**
   * How many output-token fees does this DEX charge for the given standard?
   * @param {'icrc1'|'icrc2'} standard
   * @returns {number}
   */
  getOutputFeeCount(standard) {
    throw new Error('Not implemented');
  }

  // ─── Swap Execution ──────────────────────────────────────────────────────

  /**
   * Execute a swap.
   *
   * @param {Object} params
   * @param {import('../types').SwapQuote}    params.quote
   * @param {number}                          params.slippage   - e.g. 0.01
   * @param {function(import('../types').SwapProgress): void} [params.onProgress]
   * @returns {Promise<{ success: boolean, amountOut: bigint, txId?: string }>}
   */
  async executeSwap(params) {
    throw new Error('Not implemented');
  }
}

export default BaseDex;
