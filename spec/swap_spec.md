# Swap Aggregator Specification

## 1. Overview & Goals

A swap aggregation layer that:
- Fetches quotes from multiple DEXes for a given token pair and amount
- Lets the user compare quotes and pick the best one
- Executes the swap with progress reporting
- Supports multi-hop routing (including cross-DEX routing)
- Is **reusable and decoupled** — the DEX service layer has zero dependency on this app's contexts, components, or utils. Any ICP website can drop it in.
- Is **extensible** — adding a new DEX means adding one file implementing a standard interface

### Supported DEXes (initial)
| DEX | Swap Topology | ICRC1 | ICRC2 |
|-----|--------------|-------|-------|
| ICPSwap | One pool canister per pair | Yes | Yes |
| KongSwap | Single swap canister for all pairs | Yes | Yes |

---

## 2. Architecture & File Structure

```
src/app_sneeddao_frontend/src/
  services/
    dex/
      DexAggregator.js          # General swap API — callers use only this
      types.js                   # Shared data-type definitions & constants
      tokenStandard.js           # Token standard detection & metadata lookup
      dexes/
        BaseDex.js               # Base class / interface contract
        ICPSwapDex.js            # ICPSwap adapter
        KongDex.js               # KongSwap adapter
  pages/
    Swap.jsx                     # /swap route — full page
  components/
    SwapWidget.jsx               # Core swap UI — reusable in page or modal
    SwapModal.jsx                # Modal wrapper around SwapWidget
    SwapQuoteCard.jsx            # Individual quote display component
    SwapProgressPanel.jsx        # Step-by-step progress display
    SlippageSettings.jsx         # Slippage tolerance picker
```

### Dependency Rules (for reusability)

The entire `services/dex/` folder must be self-contained:
- **No imports** from `contexts/`, `pages/`, `components/`, or app-specific `utils/`
- Accepts `identity` (or an `HttpAgent`) as a constructor/config parameter
- Accepts optional caches from the caller — never reaches into app-global state
- Uses only `@dfinity/agent`, `@dfinity/principal`, and its own local files

The UI components (`SwapWidget`, `SwapModal`, etc.) *may* import from the app's contexts and utils.

---

## 3. Data Types (`types.js`)

```js
/**
 * @typedef {'icrc1' | 'icrc2'} TokenStandard
 */

/**
 * @typedef {Object} TokenInfo
 * @property {string}   canisterId   - Ledger canister ID
 * @property {string}   symbol       - e.g. "ICP", "SNEED"
 * @property {number}   decimals     - e.g. 8
 * @property {bigint}   fee          - Transfer fee in smallest unit
 * @property {TokenStandard[]} supportedStandards - ['icrc1'] or ['icrc1','icrc2']
 * @property {string}   [logo]       - Optional logo URL / data-uri
 */

/**
 * @typedef {Object} SwapQuote
 * @property {string}      dexId                - 'icpswap' | 'kong'
 * @property {string}      dexName              - 'ICPSwap' | 'KongSwap'
 * @property {string}      inputToken           - Input ledger canister ID
 * @property {string}      outputToken          - Output ledger canister ID
 * @property {bigint}      inputAmount          - Raw amount the user wants to swap
 * @property {bigint}      effectiveInputAmount - Input after deducting transfer/deposit fees
 * @property {bigint}      expectedOutput       - Quoted output amount
 * @property {bigint}      minimumOutput        - Output after applying slippage tolerance
 * @property {number}      spotPrice            - Spot price ratio (output per 1 input, human-readable)
 * @property {number}      priceImpact          - % difference vs spot price (0.01 = 1%)
 * @property {number}      dexFeePercent        - DEX trading fee (e.g. 0.003 = 0.3%)
 * @property {FeeBreakdown} feeBreakdown        - Detailed fee accounting
 * @property {TokenStandard} standard           - Which standard will be used for the swap
 * @property {RouteStep[]}   route              - Direct = 1 step, multi-hop = N steps
 * @property {number}      timestamp            - When the quote was fetched
 */

/**
 * @typedef {Object} FeeBreakdown
 * @property {bigint} inputTransferFees    - Fees to get input tokens to the DEX
 * @property {bigint} outputWithdrawalFees - Fees to receive output tokens back
 * @property {number} dexTradingFee        - DEX fee as percentage (0.003 = 0.3%)
 * @property {number} totalInputFeesCount  - Number of input token fees charged
 * @property {number} totalOutputFeesCount - Number of output token fees charged
 */

/**
 * @typedef {Object} RouteStep
 * @property {string} dexId       - Which DEX this hop uses
 * @property {string} poolId      - Canister ID of the pool (ICPSwap) or swap canister (Kong)
 * @property {string} inputToken  - Input token for this hop
 * @property {string} outputToken - Output token for this hop
 * @property {bigint} amountIn    - Input amount for this hop
 * @property {bigint} amountOut   - Expected output for this hop
 */

/**
 * @typedef {Object} SwapProgress
 * @property {string}  step        - Current step identifier (see SwapStep enum)
 * @property {string}  message     - Human-readable description
 * @property {number}  stepIndex   - 0-based index of current step
 * @property {number}  totalSteps  - Total number of steps
 * @property {boolean} completed   - Whether the overall swap is done
 * @property {boolean} failed      - Whether the swap failed
 * @property {string}  [error]     - Error message if failed
 * @property {string}  [txId]      - Transaction ID if available
 */

/**
 * Step identifiers for progress reporting.
 * @enum {string}
 */
const SwapStep = {
  CHECKING_ALLOWANCE: 'checking_allowance',
  APPROVING:          'approving',
  TRANSFERRING:       'transferring',
  DEPOSITING:         'depositing',
  SWAPPING:           'swapping',
  WITHDRAWING:        'withdrawing',
  COMPLETE:           'complete',
  FAILED:             'failed',
};

/**
 * @typedef {Object} DexConfig
 * @property {import('@dfinity/agent').Identity} identity - User identity
 * @property {import('@dfinity/agent').HttpAgent} [agent] - Optional pre-built agent
 * @property {string}  [host]                             - IC host (default: https://ic0.app)
 * @property {Object}  [poolCanisterCache]                - ICPSwap: pre-populated {pairKey → canisterId}
 * @property {Object}  [tokenMetadataCache]               - Pre-populated {canisterId → TokenInfo}
 * @property {Object}  [kongTxCache]                      - Kong: pending tx IDs for crash recovery
 */
```

---

## 4. General Swap API — `DexAggregator`

This is the **only** class callers interact with for aggregated functionality.
Specific DEX APIs are also accessible for direct use.

```js
class DexAggregator {

  /**
   * @param {DexConfig} config
   */
  constructor(config) { }

  // ─── DEX Registry ───────────────────────────────────────────────────

  /**
   * Returns metadata for all registered DEXes.
   * @returns {{ id: string, name: string, supportedStandards: TokenStandard[] }[]}
   */
  getSupportedDexes() { }

  /**
   * Returns the raw adapter for a specific DEX, for direct low-level access.
   * @param {string} dexId - 'icpswap' | 'kong'
   * @returns {BaseDex}
   */
  getDex(dexId) { }

  // ─── Token Metadata ─────────────────────────────────────────────────

  /**
   * Looks up token metadata (symbol, decimals, fee, supported standards).
   * Uses cache if available, otherwise fetches from the ledger.
   * @param {string} canisterId
   * @returns {Promise<TokenInfo>}
   */
  async getTokenInfo(canisterId) { }

  // ─── Quoting ────────────────────────────────────────────────────────

  /**
   * Fetches quotes from ALL compatible DEXes in parallel.
   *
   * "Compatible" means the DEX supports at least one token standard
   * that both the input and output tokens support. If a token only
   * supports ICRC1, DEXes that only support ICRC2 are excluded.
   *
   * Fee deductions are applied per-DEX so quotes are fairly comparable.
   *
   * @param {Object} params
   * @param {string} params.inputToken     - Input ledger canister ID
   * @param {string} params.outputToken    - Output ledger canister ID
   * @param {bigint} params.amount         - Amount in smallest unit
   * @param {TokenStandard} [params.preferredStandard] - Force a standard (omit = auto)
   * @param {number} [params.slippageTolerance=0.01]   - e.g. 0.01 = 1%
   * @returns {Promise<SwapQuote[]>}  Sorted best-output-first
   */
  async getQuotes({ inputToken, outputToken, amount, preferredStandard, slippageTolerance }) { }

  /**
   * Gets the spot price for a pair (output per 1 unit of input, human-readable).
   *
   * Strategy per DEX:
   * - If the DEX has a spot-price API, use it.
   * - Otherwise, quote a tiny amount (1/1000th of a whole token) to approximate.
   *
   * @param {Object} params
   * @param {string} params.inputToken
   * @param {string} params.outputToken
   * @returns {Promise<{ dexId: string, spotPrice: number }[]>}
   */
  async getSpotPrices({ inputToken, outputToken }) { }

  // ─── Routing ────────────────────────────────────────────────────────

  /**
   * Discovers multi-hop routes (A → X → B) within and across DEXes.
   *
   * Returns routes sorted by expected output, best first.
   * Each route carries a warning flag: routes are NOT atomic.
   *
   * @param {Object} params
   * @param {string} params.inputToken
   * @param {string} params.outputToken
   * @param {bigint} params.amount
   * @param {number} [params.maxHops=2]              - Max intermediate tokens
   * @param {boolean} [params.allowCrossDex=true]     - Allow mixing DEXes in one route
   * @param {number} [params.slippageTolerance=0.01]
   * @returns {Promise<SwapQuote[]>}  Each with route.length > 1 for multi-hop
   */
  async findRoutes({ inputToken, outputToken, amount, maxHops, allowCrossDex, slippageTolerance }) { }

  // ─── Swap Execution ─────────────────────────────────────────────────

  /**
   * Executes a swap using a previously fetched quote.
   *
   * @param {Object} params
   * @param {SwapQuote}     params.quote              - The chosen quote
   * @param {number}        [params.slippageTolerance=0.01] - Override slippage (re-computes minimumOutput)
   * @param {TokenStandard} [params.preferredStandard]      - Override standard from quote
   * @param {function(SwapProgress): void} params.onProgress - Progress callback
   * @returns {Promise<{ success: boolean, amountOut: bigint, txId?: string, error?: string }>}
   */
  async swap({ quote, slippageTolerance, preferredStandard, onProgress }) { }
}
```

---

## 5. DEX Adapter Interface — `BaseDex`

Every DEX file exports a class extending `BaseDex`. The general API (`DexAggregator`) calls only these methods.

```js
class BaseDex {

  /** @type {string} */      id;            // e.g. 'icpswap'
  /** @type {string} */      name;          // e.g. 'ICPSwap'
  /** @type {TokenStandard[]} */ supportedStandards; // e.g. ['icrc1', 'icrc2']

  /**
   * @param {DexConfig} config
   */
  constructor(config) { }

  // ─── Pool / Pair Discovery ──────────────────────────────────────────

  /**
   * Returns whether this DEX has a pool for the given pair.
   * @param {string} inputToken
   * @param {string} outputToken
   * @returns {Promise<boolean>}
   */
  async hasPair(inputToken, outputToken) { }

  /**
   * Returns all pairs that include `token` as one side.
   * Used for route discovery.
   * @param {string} token - Canister ID
   * @returns {Promise<{ inputToken: string, outputToken: string, poolId: string }[]>}
   */
  async getPairsForToken(token) { }

  // ─── Pricing ────────────────────────────────────────────────────────

  /**
   * Get spot price (output per 1 whole input token).
   * @param {string} inputToken
   * @param {string} outputToken
   * @returns {Promise<number>}
   */
  async getSpotPrice(inputToken, outputToken) { }

  /**
   * Get a quote for a specific amount.
   *
   * The `amount` passed here is ALREADY adjusted for transfer/deposit fees
   * by the DexAggregator. This is the effective amount that will enter the swap.
   *
   * @param {Object} params
   * @param {string} params.inputToken
   * @param {string} params.outputToken
   * @param {bigint} params.amount          - Effective input (fees already deducted)
   * @param {TokenStandard} params.standard - Which standard to use
   * @returns {Promise<{ expectedOutput: bigint, poolId: string, dexFeePercent: number }>}
   */
  async getQuote({ inputToken, outputToken, amount, standard }) { }

  // ─── Fee Model ──────────────────────────────────────────────────────

  /**
   * Returns the number of input-token fees consumed by this DEX+standard combo.
   * The aggregator multiplies this by the token's fee to compute deductions.
   *
   * @param {TokenStandard} standard
   * @returns {number}  e.g. 2 for ICPSwap/ICRC1, 1 for Kong/ICRC1
   */
  getInputFeeCount(standard) { }

  /**
   * Returns the number of output-token fees consumed (e.g. withdrawal fees).
   * @param {TokenStandard} standard
   * @returns {number}  e.g. 1 for ICPSwap old API, 0 for Kong
   */
  getOutputFeeCount(standard) { }

  // ─── Swap Execution ─────────────────────────────────────────────────

  /**
   * Executes the swap. Called by DexAggregator.swap().
   *
   * @param {Object} params
   * @param {string} params.inputToken
   * @param {string} params.outputToken
   * @param {bigint} params.amountIn            - The ORIGINAL amount (before fee deductions)
   * @param {bigint} params.expectedOutput      - From the quote
   * @param {bigint} params.minimumOutput       - expectedOutput * (1 - slippage)
   * @param {number} params.slippageTolerance   - e.g. 0.01
   * @param {TokenStandard} params.standard
   * @param {string} params.poolId              - Pool canister ID
   * @param {function(SwapProgress): void} params.onProgress
   * @returns {Promise<{ success: boolean, amountOut: bigint, txId?: string, error?: string }>}
   */
  async executeSwap(params) { }
}
```

---

## 6. ICPSwap Implementation — `ICPSwapDex`

### 6.1 Constants

```js
const ICPSWAP_FACTORY_CANISTER = '4mmnk-kiaaa-aaaag-qbllq-cai';
const DEFAULT_FEE_TIER = 3000n;  // 0.3% — most common
```

### 6.2 Pool Canister Cache

ICPSwap uses one canister per pair. The cache supports:
1. **Random access** — look up a single pair via the factory's `getPool`
2. **Bulk load** — fetch all pools via the factory's `getPools` (paginated)
3. **Caller-injected cache** — accept a pre-populated Map from the caller
4. **Persistence** — backed by localStorage or IndexedDB

```js
class ICPSwapPoolCache {
  /**
   * @param {Object} [initialCache] - { "tokenA:tokenB" → poolCanisterId }
   */
  constructor(initialCache) { }

  /** Build canonical key: sorted lexicographically, lowercased */
  static pairKey(tokenA, tokenB) { }

  /** Look up one pair. Returns canisterId or null. */
  get(tokenA, tokenB) { }

  /** Store one pair. */
  set(tokenA, tokenB, poolCanisterId) { }

  /**
   * Fetch a single pool from the factory and cache it.
   * @param {Actor} factoryActor
   * @param {string} tokenA
   * @param {string} tokenB
   * @param {bigint} [feeTier=3000n]
   * @returns {Promise<string|null>} poolCanisterId or null
   */
  async fetchAndCache(factoryActor, tokenA, tokenB, feeTier) { }

  /**
   * Bulk-load all pools from the factory (paginated).
   * Populates the cache and returns a Map of all pairs.
   * @param {Actor} factoryActor
   * @returns {Promise<Map<string, string>>}  pairKey → canisterId
   */
  async fetchAll(factoryActor) { }

  /** Persist to localStorage */
  save() { }

  /** Load from localStorage */
  load() { }

  /** Export as plain object for caller to store/pass around */
  toJSON() { }
}
```

### 6.3 ICPSwapDex Class

```js
class ICPSwapDex extends BaseDex {
  id = 'icpswap';
  name = 'ICPSwap';
  supportedStandards = ['icrc1', 'icrc2'];

  constructor(config) { }

  // ─── BaseDex interface ──────────────────────────────────────────────

  async hasPair(inputToken, outputToken) { }
  async getPairsForToken(token) { }
  async getSpotPrice(inputToken, outputToken) { }
  async getQuote({ inputToken, outputToken, amount, standard }) { }
  getInputFeeCount(standard) { }
  getOutputFeeCount(standard) { }
  async executeSwap(params) { }

  // ─── ICPSwap-specific public methods (for direct use) ───────────────

  /**
   * Get the pool canister ID for a pair.
   * @param {string} tokenA
   * @param {string} tokenB
   * @param {bigint} [feeTier=3000n]
   * @returns {Promise<string>}
   */
  async getPoolCanisterId(tokenA, tokenB, feeTier) { }

  /**
   * Bulk-load all pool canisters.
   * @returns {Promise<Map<string, string>>}
   */
  async loadAllPools() { }

  /**
   * Access the pool canister cache directly.
   * @returns {ICPSwapPoolCache}
   */
  getPoolCache() { }

  // ─── Old Swap API (individual steps) ────────────────────────────────
  // Exposed for direct use by other sites that want granular control.

  /**
   * ICRC1 flow step 1: Transfer input tokens to the pool's subaccount.
   * @param {string} poolCanisterId
   * @param {string} tokenCanisterId
   * @param {bigint} amount
   * @returns {Promise<bigint>} block index
   */
  async transferToPoolSubaccount(poolCanisterId, tokenCanisterId, amount) { }

  /**
   * Old API step 2: Deposit from subaccount into the pool.
   * @param {string} poolCanisterId
   * @param {string} tokenCanisterId
   * @param {bigint} amount    - amount to deposit (= transferred amount minus 1 fee)
   * @param {bigint} tokenFee  - the token's transfer fee
   * @returns {Promise<bigint>} deposited amount
   */
  async deposit(poolCanisterId, tokenCanisterId, amount, tokenFee) { }

  /**
   * Old API: ICRC2 deposit (pool calls transferFrom).
   * Caller must have approved the pool first.
   * @param {string} poolCanisterId
   * @param {string} tokenCanisterId
   * @param {bigint} amount
   * @param {bigint} tokenFee
   * @returns {Promise<bigint>} deposited amount
   */
  async depositFrom(poolCanisterId, tokenCanisterId, amount, tokenFee) { }

  /**
   * Old API step 3: Execute the swap within the pool.
   * @param {string} poolCanisterId
   * @param {Object} params
   * @param {bigint} params.amountIn
   * @param {boolean} params.zeroForOne
   * @param {bigint} params.amountOutMinimum
   * @returns {Promise<bigint>} output amount
   */
  async swapInPool(poolCanisterId, { amountIn, zeroForOne, amountOutMinimum }) { }

  /**
   * Old API step 4: Withdraw output tokens from the pool.
   * @param {string} poolCanisterId
   * @param {string} tokenCanisterId
   * @param {bigint} amount
   * @param {bigint} tokenFee
   * @returns {Promise<bigint>} withdrawn amount
   */
  async withdraw(poolCanisterId, tokenCanisterId, amount, tokenFee) { }

  // ─── New Swap API (combined) ────────────────────────────────────────

  /**
   * New API — ICRC1: Transfer to subaccount, then depositAndSwap.
   * Combines deposit + swap + withdraw in one canister call (after transfer).
   * @param {string} poolCanisterId
   * @param {Object} params
   * @param {string} params.inputToken
   * @param {string} params.outputToken
   * @param {bigint} params.amountIn       - Amount transferred to subaccount
   * @param {bigint} params.amountOutMin   - Minimum accepted output
   * @param {bigint} params.inputFee       - Input token fee
   * @param {bigint} params.outputFee      - Output token fee
   * @returns {Promise<bigint>} final output amount received
   */
  async depositAndSwap(poolCanisterId, params) { }

  /**
   * New API — ICRC2: Approve, then depositFromAndSwap.
   * Combines transferFrom + swap + withdraw in one canister call (after approve).
   * @param {string} poolCanisterId
   * @param {Object} params  - Same as depositAndSwap
   * @returns {Promise<bigint>} final output amount received
   */
  async depositFromAndSwap(poolCanisterId, params) { }
}
```

### 6.4 ICPSwap Fee Model

| Standard | Step | Who pays | Cost |
|----------|------|----------|------|
| ICRC1 | `icrc1_transfer` to pool subaccount | User | 1 × input fee |
| ICRC1 | `deposit` (internal transfer from subaccount) | Deducted from deposited amount | 1 × input fee |
| ICRC1 | `withdraw` (pool sends output to user) | Deducted from output | 1 × output fee |
| ICRC2 | `icrc2_approve` (if allowance insufficient) | User | 1 × input fee |
| ICRC2 | `depositFrom` / `depositFromAndSwap` (transferFrom) | Deducted from user balance | 1 × input fee |
| ICRC2 | `withdraw` (pool sends output to user) | Deducted from output | 1 × output fee |

**Summary:**

```js
getInputFeeCount('icrc1')  → 2   // transfer + deposit
getInputFeeCount('icrc2')  → 2   // approve + transferFrom
getOutputFeeCount('icrc1') → 1   // withdraw
getOutputFeeCount('icrc2') → 1   // withdraw
```

**Key difference:** With ICRC1, the deposit fee *reduces the effective swap input* (the pool receives `amount - fee`). With ICRC2, the `transferFrom` fee is charged *on top* — the pool receives the full `amount`. So even though both cost 2 input fees from the user's balance, the effective input to the swap differs:

| Standard | Effective swap input | User balance cost |
|----------|---------------------|-------------------|
| ICRC1 | `amount - 1 fee` | `amount + 1 fee` |
| ICRC2 | `amount` | `amount + 2 fees` |

> **Note:** For ICRC2, we should check existing allowance first (`icrc2_allowance` is a free query call). If allowance is already sufficient, the approve step is skipped, saving 1 fee.

### 6.5 ICPSwap — API Call Mapping

| Aggregator method | ICPSwap call (ICRC1 old) | ICPSwap call (ICRC2 old) | ICPSwap call (ICRC1 new) | ICPSwap call (ICRC2 new) |
|---|---|---|---|---|
| `hasPair` | `factory.getPool(...)` | same | same | same |
| `getPairsForToken` | `factory.getPools(...)` + filter | same | same | same |
| `getSpotPrice` | `pool.metadata()` → compute from `sqrtPriceX96` | same | same | same |
| `getQuote` | `pool.quote({ amountIn, zeroForOne, amountOutMinimum: "0" })` | same | same | same |
| `executeSwap` | 1. `ledger.icrc1_transfer(to: pool subaccount)` | 1. `ledger.icrc2_allowance(...)` | 1. `ledger.icrc1_transfer(to: pool subaccount)` | 1. `ledger.icrc2_allowance(...)` |
| | 2. `pool.deposit(...)` | 2. `ledger.icrc2_approve(...)` (if needed) | 2. `pool.depositAndSwap(...)` | 2. `ledger.icrc2_approve(...)` (if needed) |
| | 3. `pool.swap(...)` | 3. `pool.depositFrom(...)` | | 3. `pool.depositFromAndSwap(...)` |
| | 4. `pool.withdraw(...)` | 4. `pool.swap(...)` | | |
| | | 5. `pool.withdraw(...)` | | |

#### ICPSwap Canister Methods Used

**Factory canister** (`4mmnk-kiaaa-aaaag-qbllq-cai`):
```
getPool : ({ token0: Token, token1: Token, fee: Nat }) → Result<PoolData>
getPools : () → Result<[PoolData]>    // or paginated variant
```

**Pool canister** (per pair):
```
metadata  : () → Result<PoolMetadata>       // contains sqrtPriceX96, token0, token1, fee, liquidity
quote     : (SwapArgs) → Result<Nat>        // query — returns expected output
swap      : (SwapArgs) → Result<Nat>        // execute swap
deposit   : (DepositArgs) → Result<Nat>     // ICRC1 deposit from subaccount
depositFrom : (DepositArgs) → Result<Nat>   // ICRC2 deposit via transferFrom
withdraw  : (WithdrawArgs) → Result<Nat>    // withdraw output tokens

// New combined methods (newer pool canisters):
depositAndSwap     : (...) → Result<Nat>    // ICRC1: deposit + swap + withdraw
depositFromAndSwap : (...) → Result<Nat>    // ICRC2: transferFrom + swap + withdraw
```

Where:
```
SwapArgs    = { amountIn: Text, zeroForOne: Bool, amountOutMinimum: Text }
DepositArgs = { token: Text, amount: Nat, fee: Nat }
WithdrawArgs= { token: Text, amount: Nat, fee: Nat }
```

> **Note on `zeroForOne`:** ICPSwap sorts tokens lexicographically. `token0` has the smaller canister ID string. `zeroForOne = true` means swapping token0 → token1. Our implementation must sort and set this correctly.

> **Note on `depositAndSwap` / `depositFromAndSwap`:** These methods are on newer pool canisters and may not exist on older pools. The implementation should detect support (try-catch or version check) and fall back to the old multi-step API if they are unavailable. We will need to add these methods to our ICPSwap DID file (`src/external/icp_swap/icp_swap.did.js`).

---

## 7. KongSwap Implementation — `KongDex`

### 7.1 Constants

```js
const KONG_SWAP_CANISTER = '2ipq2-uqaaa-aaaar-qailq-cai';  // Verify current canister ID
```

### 7.2 Transaction Recovery Cache

For ICRC1 swaps, Kong requires transferring tokens first and then passing the block index to `swap`. If the page crashes between transfer and swap, the tokens are stranded. We must persist the block index immediately.

```js
class KongTxCache {
  /**
   * @param {Object} [initialCache] - { uniqueKey → { blockIndex, inputToken, amount, timestamp } }
   */
  constructor(initialCache) { }

  /** Store a pending transfer immediately after icrc1_transfer succeeds. */
  set(key, { blockIndex, inputToken, outputToken, amount }) { }

  /** Retrieve a pending transfer. */
  get(key) { }

  /** Remove after swap completes. */
  remove(key) { }

  /** Get all pending (for recovery UI). */
  getAllPending() { }

  /** Persist to localStorage. */
  save() { }

  /** Load from localStorage. */
  load() { }
}
```

### 7.3 KongDex Class

```js
class KongDex extends BaseDex {
  id = 'kong';
  name = 'KongSwap';
  supportedStandards = ['icrc1', 'icrc2'];

  constructor(config) { }

  // ─── BaseDex interface ──────────────────────────────────────────────

  async hasPair(inputToken, outputToken) { }
  async getPairsForToken(token) { }
  async getSpotPrice(inputToken, outputToken) { }
  async getQuote({ inputToken, outputToken, amount, standard }) { }
  getInputFeeCount(standard) { }
  getOutputFeeCount(standard) { }
  async executeSwap(params) { }

  // ─── Kong-specific public methods ───────────────────────────────────

  /**
   * Get the transaction recovery cache (for crash recovery UI).
   * @returns {KongTxCache}
   */
  getTxCache() { }

  /**
   * Resume a failed ICRC1 swap using a cached block index.
   * @param {string} pendingKey
   * @param {function(SwapProgress): void} onProgress
   * @returns {Promise<{ success: boolean, amountOut: bigint }>}
   */
  async resumePendingSwap(pendingKey, onProgress) { }
}
```

### 7.4 Kong Fee Model

| Standard | Step | Who pays | Cost |
|----------|------|----------|------|
| ICRC1 | `icrc1_transfer` to Kong canister (main account) | User | 1 × input fee |
| ICRC1 | (no deposit step) | — | 0 |
| ICRC1 | Output credited directly | — | 0 × output fee |
| ICRC2 | `icrc2_approve` (if allowance insufficient) | User | 1 × input fee |
| ICRC2 | Kong calls `icrc2_transfer_from` | Deducted from user balance | 1 × input fee |
| ICRC2 | Output credited directly | — | 0 × output fee |

**Summary:**

```js
getInputFeeCount('icrc1')  → 1   // transfer only
getInputFeeCount('icrc2')  → 2   // approve + transferFrom
getOutputFeeCount('icrc1') → 0
getOutputFeeCount('icrc2') → 0
```

| Standard | Effective swap input | User balance cost |
|----------|---------------------|-------------------|
| ICRC1 | `amount` (Kong receives full amount) | `amount + 1 fee` |
| ICRC2 | `amount` (Kong receives full amount) | `amount + 2 fees` |

> **Note:** Kong ICRC1 is the most fee-efficient path — only 1 input fee, 0 output fees, and the full amount enters the swap.

### 7.5 Kong — API Call Mapping

| Aggregator method | Kong call (ICRC1) | Kong call (ICRC2) |
|---|---|---|
| `hasPair` | `kong.tokens()` + pair check, or `kong.quote(...)` | same |
| `getPairsForToken` | `kong.tokens()` + filter | same |
| `getSpotPrice` | `kong.quote(...)` with tiny amount (no dedicated spot price API) | same |
| `getQuote` | `kong.swap_amounts(...)` or similar quote endpoint | same |
| `executeSwap` | 1. `ledger.icrc1_transfer(to: kong canister)` | 1. `ledger.icrc2_allowance(...)` |
| | 2. **Immediately save block index to KongTxCache** | 2. `ledger.icrc2_approve(...)` (if needed) |
| | 3. `kong.swap({ pay_tx_id: blockIndex, ... })` | 3. `kong.swap({ ... })` (Kong calls transferFrom) |

#### Kong Canister Methods Used

**Swap canister** (`2ipq2-uqaaa-aaaar-qailq-cai`):
```
swap          : ({ pay_token: Text, pay_amount: Nat, receive_token: Text,
                   receive_amount: Nat?, receive_address: Text?,
                   pay_tx_id: Nat? }) → Result<SwapResult>

swap_amounts  : ({ pay_token: Text, pay_amount: Nat,
                   receive_token: Text }) → Result<QuoteResult>

tokens        : () → Result<[TokenInfo]>
```

> **Note:** The exact Kong canister ID and method signatures need to be verified against their current deployed canister. We will need to create a DID file at `src/external/kong_swap/kong_swap.did.js`.

---

## 8. Fair Quote Comparison — Fee Adjustment Algorithm

When `DexAggregator.getQuotes()` is called, it must adjust the input amount per-DEX before requesting quotes, so the comparison is fair.

```
For each (dex, standard) combination:
  1. inputFees = dex.getInputFeeCount(standard) × inputToken.fee
  2. effectiveInput = computeEffectiveSwapInput(amount, standard, inputToken.fee, dex)
     - For ICRC1 where deposit reduces amount: effectiveInput = amount - depositFees
     - For ICRC2 where transferFrom preserves amount: effectiveInput = amount
     - (The extra fees still come from the user's balance but don't reduce swap input)
  3. quote = dex.getQuote({ ..., amount: effectiveInput, standard })
  4. outputFees = dex.getOutputFeeCount(standard) × outputToken.fee
  5. netOutput = quote.expectedOutput - outputFees
  6. spotPrice = dex.getSpotPrice(inputToken, outputToken)
  7. expectedAtSpot = effectiveInput × spotPrice (converted to output decimals)
  8. priceImpact = (expectedAtSpot - quote.expectedOutput) / expectedAtSpot
  9. minimumOutput = netOutput × (1 - slippageTolerance)
```

The quotes are then sorted by `netOutput` descending (best first).

### Effective Swap Input by DEX+Standard

| DEX | Standard | Transfer/Approve fees (from balance) | Effective amount entering swap |
|-----|----------|--------------------------------------|-------------------------------|
| ICPSwap | ICRC1 | `amount + 1×fee` from balance | `amount - 1×fee` (deposit deducts) |
| ICPSwap | ICRC2 | `amount + 2×fee` from balance | `amount` (transferFrom preserves) |
| Kong | ICRC1 | `amount + 1×fee` from balance | `amount` (direct transfer to canister) |
| Kong | ICRC2 | `amount + 2×fee` from balance | `amount` (transferFrom preserves) |

> **Important:** For the ICRC1/ICPSwap path, the amount that actually enters the swap is `amount - 1 fee` because the deposit step transfers from the subaccount and the token ledger deducts a fee. For all other paths, the full `amount` enters the swap.

---

## 9. Multi-Hop Routing

### 9.1 Discovery Algorithm

```
findRoutes(inputToken, outputToken, amount):
  routes = []

  // Direct routes
  for each dex:
    if dex.hasPair(inputToken, outputToken):
      routes.push(directQuote)

  // 1-hop routes: input → intermediate → output
  for each dex1:
    pairs1 = dex1.getPairsForToken(inputToken)
    for each pair in pairs1:
      intermediate = pair.otherToken
      if intermediate == outputToken: continue  // that's a direct route

      for each dex2 (including dex1):
        if dex2.hasPair(intermediate, outputToken):
          quote1 = dex1.getQuote(inputToken → intermediate, amount)
          // Deduct intermediate token fee for hop 2
          hop2Input = quote1.expectedOutput - intermediate.fee × dex2.getInputFeeCount(standard)
          quote2 = dex2.getQuote(intermediate → outputToken, hop2Input)
          routes.push(combinedRoute)

  sort by finalOutput descending
  return routes
```

### 9.2 ICPSwap-Specific Pool Discovery for Routing

```js
// In ICPSwapDex:
async getPairsForToken(token) {
  // 1. Ensure all pools are loaded (bulk fetch from factory)
  await this.loadAllPools();  // uses cache after first call

  // 2. Filter pools where token is either token0 or token1
  return this.poolCache.getPairsContaining(token);
}
```

### 9.3 Cross-DEX Routing

When `allowCrossDex = true`, routes may use different DEXes for different hops:
- Hop 1: ICPSwap (A → X)
- Hop 2: Kong (X → B)

Or vice versa. The implementation tries all combinations.

### 9.4 Atomicity Warning

**Routes are NOT atomic.** If hop 1 succeeds but hop 2 fails, the user is left holding the intermediate token. The UI must:
1. Display a prominent warning for multi-hop routes
2. Show which tokens the user would hold if a hop fails
3. Consider offering a "reverse swap" option for the intermediate token

---

## 10. Token Standard Detection (`tokenStandard.js`)

```js
/**
 * Determines which standards a token supports and caches the result.
 *
 * Strategy:
 * 1. Call `icrc1_supported_standards()` on the ledger (free query)
 * 2. Look for 'ICRC-2' in the response
 * 3. If the call fails (very old ledger), assume ICRC1 only
 *
 * @param {string} canisterId
 * @param {HttpAgent|Identity} agentOrIdentity
 * @param {Object} [cache] - Optional caller-provided cache { canisterId → TokenInfo }
 * @returns {Promise<TokenStandard[]>}
 */
async function detectTokenStandards(canisterId, agentOrIdentity, cache) { }

/**
 * Fetches full token metadata: symbol, decimals, fee, standards, logo.
 * Uses cache-first strategy.
 *
 * @param {string} canisterId
 * @param {HttpAgent|Identity} agentOrIdentity
 * @param {Object} [cache]
 * @returns {Promise<TokenInfo>}
 */
async function getTokenMetadata(canisterId, agentOrIdentity, cache) { }
```

### Standard Compatibility Matrix

When fetching quotes, the aggregator filters DEXes by compatibility:

```
For a swap of TokenA → TokenB:
  tokenA_standards = detectTokenStandards(tokenA)
  tokenB_standards = detectTokenStandards(tokenB)
  // Both tokens must support the standard, AND the DEX must support it
  viable_standards = intersection(tokenA_standards, tokenB_standards)

  For each dex:
    dex_viable = intersection(viable_standards, dex.supportedStandards)
    if dex_viable is empty: skip this DEX

    // Prefer ICRC2 by default
    chosen_standard = preferredStandard ?? ('icrc2' in dex_viable ? 'icrc2' : 'icrc1')
```

---

## 11. Caching Strategy

| Cache | Storage | Key | Injected by caller? | Used by |
|-------|---------|-----|---------------------|---------|
| Pool canister IDs | localStorage | `icpswap_pool_cache` | Yes (optional) | ICPSwapDex |
| Token metadata | Caller's cache or internal Map | canisterId | Yes (optional) | DexAggregator, tokenStandard.js |
| Kong pending TXs | localStorage | `kong_pending_tx` | Yes (optional) | KongDex |
| Spot prices | Internal Map + TTL | `dexId:tokenA:tokenB` | No | DexAggregator |

All caches follow the pattern:
1. Check in-memory first (Map)
2. Check injected caller cache
3. Check localStorage/IndexedDB
4. Fetch from canister
5. Store in all layers

---

## 12. Progress Reporting

Each DEX implementation calls `onProgress` at each step. The progress object always contains a step index and total, so the UI can render a progress bar.

### ICPSwap ICRC1 (old API) — 4 steps
```
{ step: TRANSFERRING,  stepIndex: 0, totalSteps: 4, message: "Transferring tokens to pool..." }
{ step: DEPOSITING,    stepIndex: 1, totalSteps: 4, message: "Depositing into swap pool..." }
{ step: SWAPPING,      stepIndex: 2, totalSteps: 4, message: "Executing swap..." }
{ step: WITHDRAWING,   stepIndex: 3, totalSteps: 4, message: "Withdrawing output tokens..." }
{ step: COMPLETE,      stepIndex: 3, totalSteps: 4, message: "Swap complete!", completed: true }
```

### ICPSwap ICRC2 (new API) — 3 steps
```
{ step: CHECKING_ALLOWANCE, stepIndex: 0, totalSteps: 3, message: "Checking approval..." }
{ step: APPROVING,          stepIndex: 1, totalSteps: 3, message: "Approving token spend..." }  // skipped if sufficient
{ step: SWAPPING,           stepIndex: 2, totalSteps: 3, message: "Executing swap..." }
{ step: COMPLETE, ... }
```

### Kong ICRC1 — 2 steps
```
{ step: TRANSFERRING, stepIndex: 0, totalSteps: 2, message: "Transferring tokens to KongSwap..." }
{ step: SWAPPING,     stepIndex: 1, totalSteps: 2, message: "Executing swap..." }
{ step: COMPLETE, ... }
```

### Kong ICRC2 — 3 steps
```
{ step: CHECKING_ALLOWANCE, stepIndex: 0, totalSteps: 3, message: "Checking approval..." }
{ step: APPROVING,          stepIndex: 1, totalSteps: 3, message: "Approving token spend..." }
{ step: SWAPPING,           stepIndex: 2, totalSteps: 3, message: "Executing swap..." }
{ step: COMPLETE, ... }
```

### Multi-hop Routes

For multi-hop, progress is reported per hop:
```
{ step: TRANSFERRING, stepIndex: 0, totalSteps: 5,
  message: "Hop 1/2: Transferring SNEED to ICPSwap pool..." }
{ step: SWAPPING, stepIndex: 1, totalSteps: 5,
  message: "Hop 1/2: Swapping SNEED → ICP..." }
{ step: TRANSFERRING, stepIndex: 2, totalSteps: 5,
  message: "Hop 2/2: Transferring ICP to KongSwap..." }
...
```

---

## 13. Slippage, Spot Price & Price Impact

### Spot Price
- **ICPSwap:** Use `pool.metadata()` → extract `sqrtPriceX96` → `price = (sqrtPriceX96 / 2^96)^2`, adjusted for decimal differences. This is already implemented in `PriceService.js`.
- **Kong:** No dedicated spot price API. Quote a small amount: `quote(inputToken, 10^(decimals-3), outputToken)` and derive the ratio.

### Price Impact
```
spotPrice         = getSpotPrice(inputToken, outputToken)          // output per 1 whole input token
expectedAtSpot    = amount × spotPrice / 10^(inputDecimals - outputDecimals)
actualQuoted      = quote.expectedOutput
priceImpact       = (expectedAtSpot - actualQuoted) / expectedAtSpot  // 0.01 = 1%
```

### Slippage Tolerance
The user sets a slippage tolerance (default 1%, adjustable in the UI from 0.1% to 50%).

When executing a swap:
```
minimumOutput = expectedOutput × (1 - slippageTolerance)
```

This is passed to the DEX:

| DEX | How slippage is applied |
|-----|------------------------|
| ICPSwap | `SwapArgs.amountOutMinimum = minimumOutput.toString()` |
| Kong | `swap({ receive_amount: minimumOutput, ... })` — passed as minimum accepted |

> **Clarification:** Based on the ICPSwap DID, `SwapArgs` only has `amountIn`, `zeroForOne`, and `amountOutMinimum`. There is **no separate slippage parameter** — the slippage is baked into `amountOutMinimum`. The newer combined methods (`depositAndSwap`, `depositFromAndSwap`) may have additional parameters, but the core slippage mechanism is the same: you pass the minimum you'll accept. See [Inconsistencies](#16-questions--inconsistencies) note #1.

---

## 14. Swap Page & Widget UX

### 14.1 SwapWidget (reusable core)

The `SwapWidget` component contains all swap UI logic and is designed to be embedded in:
- The `/swap` page (full width)
- A modal dialog (e.g. from wallet token cards, header quick-wallet)

**Props:**
```jsx
<SwapWidget
  initialInputToken="hvgxa-wqaaa-aaaaq-aacia-cai"  // optional pre-selected input
  initialOutputToken="ryjl3-tyaaa-aaaaa-aaaba-cai"  // optional pre-selected output
  initialAmount=""                                    // optional pre-filled amount
  compact={false}                                     // true when in modal
  onSwapComplete={(result) => {}}                     // callback after swap
  onClose={() => {}}                                  // for modal dismiss
/>
```

**Layout:**

```
┌────────────────────────────────────────────┐
│  Swap                          ⚙️ Settings │
├────────────────────────────────────────────┤
│  ┌──────────────────────────────────────┐  │
│  │  From:  [TokenSelector ▾]           │  │
│  │  Amount: [_______________] [MAX]    │  │
│  │  Balance: 1,234.56 SNEED            │  │
│  └──────────────────────────────────────┘  │
│                    ⇅ (swap direction)       │
│  ┌──────────────────────────────────────┐  │
│  │  To:    [TokenSelector ▾]           │  │
│  │  Est:   ~456.78 ICP                 │  │
│  └──────────────────────────────────────┘  │
├────────────────────────────────────────────┤
│  Slippage: [0.5%] [1%] [2%] [Custom]      │
├────────────────────────────────────────────┤
│  ┌─ Quotes ──────────────────────────────┐ │
│  │                                        │ │
│  │  ● ICPSwap         456.78 ICP  BEST   │ │
│  │    Impact: -0.12%  Fee: 0.3%          │ │
│  │    Route: SNEED → ICP (direct)        │ │
│  │                                        │ │
│  │  ○ KongSwap        455.23 ICP         │ │
│  │    Impact: -0.15%  Fee: 0.3%          │ │
│  │    Route: SNEED → ICP (direct)        │ │
│  │                                        │ │
│  │  ○ ICPSwap (route)  457.01 ICP  ⚠️    │ │
│  │    Impact: -0.08%  Fee: 0.3%+0.3%    │ │
│  │    Route: SNEED → ckBTC → ICP         │ │
│  │    ⚠️ Route is not atomic              │ │
│  │                                        │ │
│  └────────────────────────────────────────┘ │
├────────────────────────────────────────────┤
│  Price impact: -0.12%                      │
│  Min received: 452.21 ICP                  │
│  Network fees: 0.0002 SNEED + 0.0001 ICP   │
│                                             │
│  [        🔄  Swap        ]                │
└────────────────────────────────────────────┘
```

### 14.2 SwapProgressPanel

Shown after "Swap" is clicked (replaces the quote area):

```
┌─ Swap in Progress ───────────────────────┐
│                                           │
│  ✅ Step 1/3: Approved token spend        │
│  🔄 Step 2/3: Executing swap...          │
│  ⬜ Step 3/3: Receiving tokens            │
│                                           │
│  [━━━━━━━━━━━━━━━━━━░░░░░░] 66%          │
│                                           │
│  ⚠️ Do not close this window              │
└───────────────────────────────────────────┘
```

### 14.3 SlippageSettings

Small popover/dropdown accessible from the ⚙️ icon:

```
┌─ Slippage Tolerance ─────────────┐
│  [0.1%] [0.5%] [1%] [Custom: __]│
│                                   │
│  ⚠️ High slippage increases risk  │
│  of unfavorable execution price.  │
└───────────────────────────────────┘
```

Default: **1%**. If > 5%, show warning. If > 20%, show strong warning.

### 14.4 SwapModal

```jsx
<SwapModal
  show={true}
  onClose={() => setShowSwap(false)}
  initialInputToken="hvgxa-wqaaa-aaaaq-aacia-cai"
  initialOutputToken="ryjl3-tyaaa-aaaaa-aaaba-cai"
/>
```

Uses `createPortal` (consistent with existing modal pattern in the codebase). Contains `<SwapWidget compact={true} />`.

### 14.5 Routing in the `/swap` Page

```jsx
// In App.jsx, add to routes:
<Route path="/swap" element={<Swap />} />
```

---

## 15. Implementation Notes

### 15.1 Agent/Actor Pattern

Following the existing codebase pattern:

```js
// In each DEX adapter:
_getAgent() {
  if (this.agent) return this.agent;
  const isLocal = process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging';
  const host = this.config.host || (isLocal ? 'http://localhost:4943' : 'https://ic0.app');
  this.agent = new HttpAgent({ host, identity: this.config.identity });
  if (isLocal) this.agent.fetchRootKey();
  return this.agent;
}

_createPoolActor(canisterId) {
  return Actor.createActor(icpSwapIdlFactory, {
    agent: this._getAgent(),
    canisterId,
  });
}
```

### 15.2 ICPSwap `zeroForOne` Determination

```js
_isZeroForOne(inputToken, outputToken) {
  // ICPSwap sorts tokens lexicographically (lowercase)
  // token0 = smaller string, token1 = larger string
  // zeroForOne = true when selling token0 (the smaller ID)
  return inputToken.toLowerCase() < outputToken.toLowerCase();
}
```

### 15.3 ICPSwap Subaccount Calculation

When using ICRC1 with ICPSwap, tokens are transferred to a subaccount of the pool canister derived from the user's principal:

```js
_getPoolSubaccount(userPrincipal) {
  // ICPSwap uses the user's principal as the subaccount
  // Pad to 32 bytes
  const principalBytes = userPrincipal.toUint8Array();
  const subaccount = new Uint8Array(32);
  subaccount[0] = principalBytes.length;
  subaccount.set(principalBytes, 1);
  return subaccount;
}
```

### 15.4 Kong ICRC1 — Block Index Persistence

Critical path for crash safety:

```js
// In KongDex.executeSwap (ICRC1 flow):
// Step 1: Transfer
const blockIndex = await ledgerActor.icrc1_transfer({
  to: { owner: Principal.fromText(KONG_SWAP_CANISTER), subaccount: [] },
  amount: amountIn,
  fee: [],
  memo: [],
  from_subaccount: [],
  created_at_time: [],
});

// Step 2: IMMEDIATELY persist before doing anything else
const txKey = `${inputToken}:${outputToken}:${Date.now()}`;
this.txCache.set(txKey, {
  blockIndex: blockIndex.Ok,
  inputToken,
  outputToken,
  amount: amountIn,
});
this.txCache.save();  // Synchronous localStorage write

// Step 3: Now safe to call swap
const swapResult = await kongActor.swap({
  pay_token: inputToken,
  pay_amount: amountIn,
  receive_token: outputToken,
  receive_amount: minimumOutput,  // slippage baked in
  pay_tx_id: [blockIndex.Ok],     // wrapped in opt
  // ...
});

// Step 4: Clean up on success
this.txCache.remove(txKey);
this.txCache.save();
```

### 15.5 ICRC2 Allowance Check Pattern

```js
async _ensureAllowance(ledgerActor, spender, amount, tokenFee, onProgress) {
  onProgress({ step: SwapStep.CHECKING_ALLOWANCE, ... });

  const allowance = await ledgerActor.icrc2_allowance({
    account: { owner: this.config.identity.getPrincipal(), subaccount: [] },
    spender: { owner: Principal.fromText(spender), subaccount: [] },
  });

  if (allowance.allowance >= amount + tokenFee) {
    // Already approved — skip
    return;
  }

  onProgress({ step: SwapStep.APPROVING, ... });

  const result = await ledgerActor.icrc2_approve({
    spender: { owner: Principal.fromText(spender), subaccount: [] },
    amount: amount + tokenFee,  // approve enough for the transfer + its fee
    fee: [],
    memo: [],
    from_subaccount: [],
    created_at_time: [],
    expected_allowance: [],
    expires_at: [],
  });

  if (result.Err) throw new Error(`Approve failed: ${JSON.stringify(result.Err)}`);
}
```

---

## 16. Questions & Inconsistencies

### 1. ICPSwap slippage parameter

> You mentioned: "IIRC icpswap takes the expected amount from the quote in one input parameter, and the slippage tolerance in another."

From the ICPSwap DID, `SwapArgs` has only three fields: `{ amountIn, zeroForOne, amountOutMinimum }`. There is **no separate slippage tolerance field**. Slippage is baked into `amountOutMinimum = expectedOutput * (1 - slippage)`. This is actually the same approach as Kong (pass the minimum acceptable output). The difference is just naming.

The newer `depositAndSwap`/`depositFromAndSwap` methods *might* have an explicit slippage field — we need to verify against the actual candid interface for newer pool canisters. **Action: Verify the DID for depositAndSwap.**

### 2. `depositAndSwap` / `depositFromAndSwap` availability

These methods are **not present** in our current ICPSwap pool DID file (`src/external/icp_swap/icp_swap.did.js`). They exist only on newer pool canisters. We need to:
- Get the updated DID from ICPSwap
- Handle pools that don't support them (fallback to old multi-step API)
- Consider maintaining two DID files or a superset DID

### 3. ICRC2 fee accounting nuance

For ICRC2, the approve fee and the transferFrom fee are both charged to the user's balance, but `transferFrom` charges `amount + fee` (the full amount reaches the spender). This means:
- User needs `amount + 2×fee` in their balance (1 for approve, 1 for transferFrom)
- But the DEX receives the full `amount` — no loss to fees inside the swap
- This is actually slightly *better* effective input than ICRC1/ICPSwap where the pool only gets `amount - fee`

However, the user's total cost is higher with ICRC2 (2 fees vs 1 for Kong ICRC1). The comparison should be: **what does the user get out, given what they put in?** We compare `netOutput` relative to the user's total cost (`amount + N×fee`).

### 4. Kong canister ID verification

The Kong swap canister ID `2ipq2-uqaaa-aaaar-qailq-cai` needs to be verified. Kong may have migrated to a newer canister. **Action: Verify before implementation.**

### 5. Kong DID file

We don't have a Kong DID file yet. We need to create `src/external/kong_swap/kong_swap.did.js` with the correct candid interface. **Action: Get Kong's candid interface.**

### 6. Standard preference: ICRC2 default may not always be optimal

You specified: "When a token supports both, we should prefer using the ICRC2 API to swap per default."

However, for Kong specifically, ICRC1 is cheaper (1 fee vs 2 fees) and has the same effective swap input. The "prefer ICRC2" default may not be optimal in all cases. Consider:
- **Option A:** Always prefer ICRC2 (as specified) — simpler UX, consistent behavior
- **Option B:** Auto-pick cheapest standard per DEX — better for users, slightly more complex

The spec follows **Option A** (prefer ICRC2) as you specified, but the `preferredStandard` parameter allows the caller to override. We could add a `'cheapest'` option that auto-selects.

### 7. Routing discovery performance

`loadAllPools()` for ICPSwap could return hundreds of pools. This should be:
- Done lazily (only when routing is requested)
- Cached aggressively (pools don't change often)
- Potentially paginated in the UI ("Finding routes..." spinner)

### 8. Output token fee for ICPSwap withdrawal

In the old API, `withdraw` sends tokens to the user, costing 1 output token fee. In the new combined API (`depositAndSwap`), the withdrawal is handled internally. Does the new API still charge an output fee? **Action: Verify — the fee might be deducted internally from the output amount.**

### 9. Price impact sign convention

The spec defines `priceImpact = (expectedAtSpot - actualQuoted) / expectedAtSpot`. This will be **positive** when the actual output is less than spot (which is normal — the user gets less due to their trade moving the price). Some UIs show this as negative (e.g. "-0.12%"). We should decide on a convention and document it clearly. **Recommendation:** Store as positive number, display with "-" prefix in the UI.

### 10. Quote staleness

Quotes go stale quickly on AMMs. We should:
- Auto-refresh quotes every ~10 seconds
- Show a "quote expired" warning if the user waits too long
- Re-quote immediately before executing a swap (and abort if the new quote is significantly worse)

---

## 17. Future Considerations

- **More DEXes:** Sonic, Helix, etc. — just add a new file in `dexes/`
- **Limit orders:** Some DEXes support these; could extend the interface
- **Analytics:** Track which DEX wins most often, average slippage, etc.
- **Kong pending TX recovery UI:** A small panel showing "You have X pending swaps" with resume buttons
- **Price chart:** Show a small price chart for the selected pair
- **Token allowance management:** A utility page to review/revoke ICRC2 approvals
