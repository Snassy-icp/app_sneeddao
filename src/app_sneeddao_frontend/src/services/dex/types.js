/**
 * Swap Aggregator — Shared Types & Constants
 *
 * This file is self-contained: no imports from app contexts/utils.
 * Reusable on any ICP website.
 */

// ─── Token Standards ──────────────────────────────────────────────────────────

/** @typedef {'icrc1' | 'icrc2'} TokenStandard */

// ─── Token Info ───────────────────────────────────────────────────────────────

/**
 * @typedef {Object} TokenInfo
 * @property {string}          canisterId         - Ledger canister ID
 * @property {string}          symbol             - e.g. "ICP", "SNEED"
 * @property {number}          decimals           - e.g. 8
 * @property {bigint}          fee                - Transfer fee in smallest unit
 * @property {TokenStandard[]} supportedStandards - ['icrc1'] or ['icrc1','icrc2']
 * @property {string}          [logo]             - Optional logo URL / data-uri
 */

// ─── Swap Quote ───────────────────────────────────────────────────────────────

/**
 * @typedef {Object} SwapQuote
 * @property {string}          dexId                - 'icpswap' | 'kong'
 * @property {string}          dexName              - 'ICPSwap' | 'KongSwap'
 * @property {string}          inputToken           - Input ledger canister ID
 * @property {string}          outputToken          - Output ledger canister ID
 * @property {bigint}          inputAmount          - Raw amount the user wants to swap
 * @property {bigint}          effectiveInputAmount - Input after deducting transfer/deposit fees
 * @property {bigint}          expectedOutput       - Quoted output amount
 * @property {bigint}          minimumOutput        - Output after applying slippage tolerance
 * @property {number}          spotPrice            - Spot price ratio (output per 1 input, human-readable)
 * @property {number}          priceImpact          - Fraction difference vs spot price (0.01 = 1%)
 * @property {number}          dexFeePercent        - DEX trading fee (e.g. 0.003 = 0.3%)
 * @property {FeeBreakdown}    feeBreakdown         - Detailed fee accounting
 * @property {TokenStandard}   standard             - Which standard will be used
 * @property {RouteStep[]}     route                - Direct = 1 step, multi-hop = N steps
 * @property {number}          timestamp            - When the quote was fetched (Date.now())
 * @property {boolean}         [isRoutedQuote]      - True if multi-hop
 */

/**
 * @typedef {Object} FeeBreakdown
 * @property {bigint} inputTransferFees    - Total input fees in token's smallest unit
 * @property {bigint} outputWithdrawalFees - Total output fees in output token's smallest unit
 * @property {number} dexTradingFee        - DEX fee as percentage (0.003 = 0.3%)
 * @property {number} totalInputFeesCount  - Number of input token fees charged
 * @property {number} totalOutputFeesCount - Number of output token fees charged
 */

/**
 * @typedef {Object} RouteStep
 * @property {string} dexId       - Which DEX this hop uses
 * @property {string} poolId      - Pool canister ID (ICPSwap) or swap canister ID (Kong)
 * @property {string} inputToken  - Input token canister ID for this hop
 * @property {string} outputToken - Output token canister ID for this hop
 * @property {bigint} amountIn    - Input amount for this hop
 * @property {bigint} amountOut   - Expected output for this hop
 */

// ─── Progress Reporting ───────────────────────────────────────────────────────

/**
 * @typedef {Object} SwapProgress
 * @property {string}  step        - Current step identifier (SwapStep value)
 * @property {string}  message     - Human-readable description
 * @property {number}  stepIndex   - 0-based index of current step
 * @property {number}  totalSteps  - Total number of steps
 * @property {boolean} completed   - Whether the overall swap is done
 * @property {boolean} failed      - Whether the swap failed
 * @property {string}  [error]     - Error message if failed
 * @property {string}  [txId]      - Transaction/block ID if available
 */

/** Step identifiers for progress reporting. */
export const SwapStep = Object.freeze({
  CHECKING_ALLOWANCE: 'checking_allowance',
  APPROVING:          'approving',
  TRANSFERRING:       'transferring',
  DEPOSITING:         'depositing',
  SWAPPING:           'swapping',
  WITHDRAWING:        'withdrawing',
  CLAIMING:           'claiming',     // Kong fallback only
  COMPLETE:           'complete',
  FAILED:             'failed',
});

// ─── Configuration ────────────────────────────────────────────────────────────

/**
 * @typedef {Object} DexConfig
 * @property {import('@dfinity/agent').Identity} identity   - User identity for signing
 * @property {import('@dfinity/agent').HttpAgent} [agent]   - Optional pre-built agent
 * @property {string}  [host]                               - IC host (default: auto-detect)
 * @property {Object}  [poolCanisterCache]                  - ICPSwap: { pairKey → canisterId }
 * @property {Object}  [tokenMetadataCache]                 - { canisterId → TokenInfo }
 * @property {Object}  [kongTxCache]                        - Kong: pending tx data for recovery
 */

// ─── Constants ────────────────────────────────────────────────────────────────

export const ICPSWAP_FACTORY_CANISTER = '4mmnk-kiaaa-aaaag-qbllq-cai';
export const KONG_SWAP_CANISTER = '2ipq2-uqaaa-aaaar-qailq-cai';
export const ICP_LEDGER_CANISTER = 'ryjl3-tyaaa-aaaaa-aaaba-cai';

/** Default ICPSwap fee tier (0.3%). */
export const ICPSWAP_DEFAULT_FEE_TIER = 3000n;

/** Default slippage tolerance (1%). */
export const DEFAULT_SLIPPAGE = 0.01;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Determine the IC host based on DFX_NETWORK env var.
 * @returns {string}
 */
export function getHost() {
  const isLocal = typeof process !== 'undefined'
    && process.env?.DFX_NETWORK !== 'ic'
    && process.env?.DFX_NETWORK !== 'staging';
  return isLocal ? 'http://localhost:4943' : 'https://ic0.app';
}

/**
 * Build a canonical ICPSwap pair key (sorted lexicographically, lowercased).
 * @param {string} tokenA
 * @param {string} tokenB
 * @returns {string}
 */
export function pairKey(tokenA, tokenB) {
  const a = tokenA.toLowerCase();
  const b = tokenB.toLowerCase();
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

/**
 * Determine ICPSwap zeroForOne: true when inputToken is the lexicographically smaller ID.
 * @param {string} inputToken
 * @param {string} outputToken
 * @returns {boolean}
 */
export function isZeroForOne(inputToken, outputToken) {
  return inputToken.toLowerCase() < outputToken.toLowerCase();
}

/**
 * Compute pool subaccount for a user principal (ICPSwap ICRC1 deposit pattern).
 * @param {import('@dfinity/principal').Principal} principal
 * @returns {Uint8Array} 32-byte subaccount
 */
export function principalToSubaccount(principal) {
  const bytes = principal.toUint8Array();
  const sub = new Uint8Array(32);
  sub[0] = bytes.length;
  sub.set(bytes, 1);
  return sub;
}

/**
 * Create a progress callback helper.
 * @param {function} onProgress
 * @param {number} totalSteps
 * @returns {function(string, string, number, Object?): void}
 */
export function makeProgressReporter(onProgress, totalSteps) {
  return (step, message, stepIndex, extra = {}) => {
    if (onProgress) {
      onProgress({
        step,
        message,
        stepIndex,
        totalSteps,
        completed: step === SwapStep.COMPLETE,
        failed: step === SwapStep.FAILED,
        ...extra,
      });
    }
  };
}
