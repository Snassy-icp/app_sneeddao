/**
 * ICPSwapDex — DEX adapter for ICPSwap v3 (concentrated liquidity AMM).
 *
 * Supports:
 * - Pool discovery via factory canister
 * - Spot price from pool metadata (sqrtPriceX96)
 * - Quoting via pool `quote` method
 * - Swapping via `depositAndSwap` (ICRC1) / `depositFromAndSwap` (ICRC2)
 * - Legacy deposit → swap → withdraw flow (for direct API consumers)
 *
 * Designed to be reusable: accepts identity/agent, manages own caching.
 */

import { Actor, HttpAgent } from '@dfinity/agent';
import { Principal } from '@dfinity/principal';
import { idlFactory as poolIdlFactory } from 'external/icp_swap/icp_swap.did.js';
import { idlFactory as factoryIdlFactory } from 'external/icp_swap_factory/icp_swap_factory.did.js';
import { BaseDex } from './BaseDex.js';
import {
  ICPSWAP_FACTORY_CANISTER,
  ICPSWAP_DEFAULT_FEE_TIER,
  SwapStep,
  pairKey,
  isZeroForOne,
  principalToSubaccount,
  makeProgressReporter,
  getHost,
} from '../types.js';
import {
  getTokenInfo,
  checkAllowance,
  approve,
  transfer,
} from '../tokenStandard.js';

// ─── Local storage keys ─────────────────────────────────────────────────────

const POOL_CACHE_STORAGE_KEY = 'icpswap_pool_cache';

// ─── Pool canister cache ────────────────────────────────────────────────────

class PoolCanisterCache {
  /**
   * @param {Map<string, string>} [externalCache] — caller-provided cache
   */
  constructor(externalCache) {
    if (externalCache) {
      this.map = externalCache;
    } else {
      this.map = new Map();
      this._loadFromStorage();
    }
  }

  get(key) { return this.map.get(key); }

  set(key, value) {
    this.map.set(key, value);
    this._saveToStorage();
  }

  has(key) { return this.map.has(key); }

  /** Get the underlying Map (for sharing with callers). */
  getMap() { return this.map; }

  /** Load all pools from factory into cache. */
  async loadAll(factoryActor) {
    const result = await factoryActor.getPools();
    if ('err' in result) throw new Error(`getPools failed: ${JSON.stringify(result.err)}`);
    const pools = result.ok;
    for (const p of pools) {
      const t0 = typeof p.token0.address === 'string' ? p.token0.address : p.token0.address;
      const t1 = typeof p.token1.address === 'string' ? p.token1.address : p.token1.address;
      const cid = typeof p.canisterId === 'string'
        ? p.canisterId
        : (p.canisterId.toText ? p.canisterId.toText() : Principal.from(p.canisterId).toText());
      this.map.set(pairKey(t0, t1), cid);
    }
    this._saveToStorage();
    return pools.length;
  }

  _loadFromStorage() {
    try {
      const raw = localStorage.getItem(POOL_CACHE_STORAGE_KEY);
      if (raw) {
        const obj = JSON.parse(raw);
        for (const [k, v] of Object.entries(obj)) this.map.set(k, v);
      }
    } catch { /* ok */ }
  }

  _saveToStorage() {
    try {
      const obj = Object.fromEntries(this.map);
      localStorage.setItem(POOL_CACHE_STORAGE_KEY, JSON.stringify(obj));
    } catch { /* ok */ }
  }
}

// ─── ICPSwapDex ─────────────────────────────────────────────────────────────

export class ICPSwapDex extends BaseDex {
  id = 'icpswap';
  name = 'ICPSwap';
  supportedStandards = ['icrc1', 'icrc2'];

  /**
   * @param {import('../types').DexConfig} config
   */
  constructor(config) {
    super(config);

    // Build or re-use an HttpAgent
    this.agent = config.agent || new HttpAgent({
      host: config.host || getHost(),
      identity: config.identity,
    });

    // Factory actor (queries only — no identity needed but fine to share agent)
    this.factoryActor = Actor.createActor(factoryIdlFactory, {
      agent: this.agent,
      canisterId: ICPSWAP_FACTORY_CANISTER,
    });

    // Pool canister cache
    this.poolCache = new PoolCanisterCache(config.poolCanisterCache);

    // Pool actor cache (in-memory only)
    this._poolActors = new Map();
  }

  // ─── Internal helpers ───────────────────────────────────────────────────

  /**
   * Get or create an actor for a pool canister.
   * @param {string} poolCanisterId
   * @returns {import('@dfinity/agent').ActorSubclass}
   */
  _getPoolActor(poolCanisterId) {
    let actor = this._poolActors.get(poolCanisterId);
    if (!actor) {
      actor = Actor.createActor(poolIdlFactory, {
        agent: this.agent,
        canisterId: poolCanisterId,
      });
      this._poolActors.set(poolCanisterId, actor);
    }
    return actor;
  }

  /**
   * Look up the pool canister ID for a token pair, fetching from factory if not cached.
   * @param {string} tokenA
   * @param {string} tokenB
   * @returns {Promise<string|null>} Pool canister ID or null
   */
  async _getPoolCanisterId(tokenA, tokenB) {
    const key = pairKey(tokenA, tokenB);
    if (this.poolCache.has(key)) return this.poolCache.get(key);

    // Fetch from factory
    const [t0, t1] = tokenA.toLowerCase() < tokenB.toLowerCase()
      ? [tokenA, tokenB]
      : [tokenB, tokenA];

    try {
      const result = await this.factoryActor.getPool({
        token0: { address: t0, standard: 'ICRC1' },
        token1: { address: t1, standard: 'ICRC1' },
        fee: ICPSWAP_DEFAULT_FEE_TIER,
      });

      if ('err' in result || !result.ok) return null;

      const pool = result.ok;
      const cid = typeof pool.canisterId === 'string'
        ? pool.canisterId
        : (pool.canisterId.toText ? pool.canisterId.toText() : Principal.from(pool.canisterId).toText());

      this.poolCache.set(key, cid);
      return cid;
    } catch (e) {
      console.error('ICPSwap getPool failed:', e);
      return null;
    }
  }

  // ─── BaseDex interface ────────────────────────────────────────────────────

  async hasPair(inputToken, outputToken) {
    const cid = await this._getPoolCanisterId(inputToken, outputToken);
    return cid !== null;
  }

  async getPairsForToken(token) {
    // Must have a loaded pool cache — load all if empty
    if (this.poolCache.getMap().size === 0) {
      await this.poolCache.loadAll(this.factoryActor);
    }

    const results = [];
    const tokenLower = token.toLowerCase();

    for (const [key, poolId] of this.poolCache.getMap()) {
      const [a, b] = key.split(':');
      if (a === tokenLower || b === tokenLower) {
        results.push({
          inputToken: a === tokenLower ? a : b,
          outputToken: a === tokenLower ? b : a,
          poolId,
        });
      }
    }
    return results;
  }

  async getSpotPrice(inputToken, outputToken) {
    const poolCid = await this._getPoolCanisterId(inputToken, outputToken);
    if (!poolCid) throw new Error(`ICPSwap: no pool for ${inputToken} / ${outputToken}`);

    const pool = this._getPoolActor(poolCid);
    const metaResult = await pool.metadata();
    if ('err' in metaResult || !metaResult.ok) {
      throw new Error(`ICPSwap metadata failed: ${JSON.stringify(metaResult.err || metaResult)}`);
    }
    const meta = metaResult.ok;

    // Get token info for decimal adjustment
    const [inputInfo, outputInfo] = await Promise.all([
      getTokenInfo(inputToken, this.agent),
      getTokenInfo(outputToken, this.agent),
    ]);

    // sqrtPriceX96 → price
    const Q96 = 2n ** 96n;
    const sqrtPrice = Number(meta.sqrtPriceX96) / Number(Q96);
    let price = sqrtPrice * sqrtPrice;

    // The pool price is token1/token0. Adjust direction.
    const inputIsToken0 = meta.token0.address === inputToken
      || meta.token0.address.toLowerCase() === inputToken.toLowerCase();

    if (!inputIsToken0) {
      // price is token1/token0, but we want output(token0) per input(token1) → invert
      price = 1 / price;
    }

    // Decimal adjustment: price × 10^(inputDecimals − outputDecimals)
    const decimalAdj = 10 ** (inputInfo.decimals - outputInfo.decimals);
    return price * decimalAdj;
  }

  async getQuote({ inputToken, outputToken, amount, standard, slippage = 0.01 }) {
    const poolCid = await this._getPoolCanisterId(inputToken, outputToken);
    if (!poolCid) throw new Error(`ICPSwap: no pool for ${inputToken} / ${outputToken}`);

    // Determine fees
    const inputFeeCount = this.getInputFeeCount(standard);
    const outputFeeCount = this.getOutputFeeCount(standard);

    const [inputInfo, outputInfo] = await Promise.all([
      getTokenInfo(inputToken, this.agent),
      getTokenInfo(outputToken, this.agent),
    ]);

    const inputFees = BigInt(inputFeeCount) * inputInfo.fee;
    const outputFees = BigInt(outputFeeCount) * outputInfo.fee;
    const effectiveInput = amount - inputFees;

    if (effectiveInput <= 0n) {
      throw new Error(`Input amount ${amount} is too small to cover ${inputFeeCount} fee(s) of ${inputInfo.fee}`);
    }

    const pool = this._getPoolActor(poolCid);
    const zeroForOne = isZeroForOne(inputToken, outputToken);

    // Use ICPSwap's quote method (query, doesn't cost anything)
    const quoteResult = await pool.quote({
      amountIn: effectiveInput.toString(),
      zeroForOne,
      amountOutMinimum: '0',
    });

    if ('err' in quoteResult || quoteResult.err) {
      throw new Error(`ICPSwap quote failed: ${JSON.stringify(quoteResult.err)}`);
    }

    const expectedOutput = BigInt(quoteResult.ok);
    const netOutput = expectedOutput - outputFees;

    // Spot price
    const spotPrice = await this.getSpotPrice(inputToken, outputToken);

    // Price impact: compare actual exchange rate to spot price
    const effectiveInputFloat = Number(effectiveInput) / (10 ** inputInfo.decimals);
    const expectedOutputFloat = Number(expectedOutput) / (10 ** outputInfo.decimals);
    const actualRate = expectedOutputFloat / effectiveInputFloat;
    const priceImpact = spotPrice > 0 ? Math.abs(1 - actualRate / spotPrice) : 0;

    // Minimum output after slippage
    const minimumOutput = netOutput - BigInt(Math.ceil(Number(netOutput) * slippage));

    // DEX fee (ICPSwap standard is 0.3%)
    const dexFeePercent = Number(ICPSWAP_DEFAULT_FEE_TIER) / 1_000_000;

    return {
      dexId: this.id,
      dexName: this.name,
      inputToken,
      outputToken,
      inputAmount: amount,
      effectiveInputAmount: effectiveInput,
      expectedOutput: netOutput,
      minimumOutput: minimumOutput > 0n ? minimumOutput : 0n,
      spotPrice,
      priceImpact,
      dexFeePercent,
      feeBreakdown: {
        inputTransferFees: inputFees,
        outputWithdrawalFees: outputFees,
        dexTradingFee: dexFeePercent,
        totalInputFeesCount: inputFeeCount,
        totalOutputFeesCount: outputFeeCount,
      },
      standard,
      route: [{
        dexId: this.id,
        poolId: poolCid,
        inputToken,
        outputToken,
        amountIn: effectiveInput,
        amountOut: expectedOutput,
      }],
      timestamp: Date.now(),
    };
  }

  getInputFeeCount(standard) {
    // ICRC1: 1 (transfer to subaccount) + 1 (deposit into pool) = 2
    // ICRC2: 1 (approve) + 1 (transferFrom) = 2
    return 2;
  }

  getOutputFeeCount(standard) {
    // 1 (withdraw from pool to user)
    return 1;
  }

  async executeSwap({ quote, slippage = 0.01, onProgress }) {
    const { inputToken, outputToken, standard } = quote;
    const poolCid = quote.route[0].poolId;
    const pool = this._getPoolActor(poolCid);
    const zeroForOne = isZeroForOne(inputToken, outputToken);

    const [inputInfo, outputInfo] = await Promise.all([
      getTokenInfo(inputToken, this.agent),
      getTokenInfo(outputToken, this.agent),
    ]);

    // Re-quote to get fresh minimumOutput with slippage
    const effectiveInput = quote.effectiveInputAmount;
    const quoteResult = await pool.quote({
      amountIn: effectiveInput.toString(),
      zeroForOne,
      amountOutMinimum: '0',
    });

    if ('err' in quoteResult) {
      throw new Error(`ICPSwap re-quote failed: ${JSON.stringify(quoteResult.err)}`);
    }

    const freshExpectedOutput = BigInt(quoteResult.ok);
    const outputFees = BigInt(this.getOutputFeeCount(standard)) * outputInfo.fee;
    const freshNet = freshExpectedOutput - outputFees;
    const minimumOutput = freshNet - BigInt(Math.ceil(Number(freshNet) * slippage));

    const args = {
      amountIn: effectiveInput.toString(),
      zeroForOne,
      amountOutMinimum: (minimumOutput > 0n ? minimumOutput : 0n).toString(),
      tokenInFee: inputInfo.fee,
      tokenOutFee: outputInfo.fee,
    };

    if (standard === 'icrc2') {
      return this._executeIcrc2Swap(pool, poolCid, args, inputToken, effectiveInput, inputInfo, onProgress);
    } else {
      return this._executeIcrc1Swap(pool, poolCid, args, inputToken, effectiveInput, inputInfo, onProgress);
    }
  }

  // ─── ICRC2 swap path ─────────────────────────────────────────────────────

  async _executeIcrc2Swap(pool, poolCid, args, inputToken, amount, inputInfo, onProgress) {
    const totalSteps = 3; // check allowance, approve (maybe), swap
    const report = makeProgressReporter(onProgress, totalSteps);
    const poolPrincipal = Principal.fromText(poolCid);
    const owner = this.config.identity.getPrincipal();

    try {
      // Step 0: Check allowance
      report(SwapStep.CHECKING_ALLOWANCE, 'Checking token approval...', 0);
      const { allowance } = await checkAllowance(inputToken, this.agent, owner, poolPrincipal);

      // We need enough for the amount the pool will transferFrom (effectiveInput + 1 fee for the transferFrom itself)
      const needed = amount + inputInfo.fee;

      if (allowance < needed) {
        // Step 1: Approve
        report(SwapStep.APPROVING, 'Approving token spend...', 1);
        await approve(inputToken, this.agent, poolPrincipal, needed);
      }

      // Step 2: depositFromAndSwap (combined: transferFrom + swap + withdraw)
      report(SwapStep.SWAPPING, 'Executing swap...', 2);
      const result = await pool.depositFromAndSwap(args);

      if ('err' in result) {
        report(SwapStep.FAILED, `Swap failed: ${JSON.stringify(result.err)}`, 2, { error: JSON.stringify(result.err) });
        return { success: false, amountOut: 0n };
      }

      const amountOut = BigInt(result.ok);
      report(SwapStep.COMPLETE, 'Swap complete!', 2, { txId: amountOut.toString() });
      return { success: true, amountOut };
    } catch (e) {
      report(SwapStep.FAILED, `Swap failed: ${e.message}`, 0, { error: e.message });
      return { success: false, amountOut: 0n };
    }
  }

  // ─── ICRC1 swap path ─────────────────────────────────────────────────────

  async _executeIcrc1Swap(pool, poolCid, args, inputToken, amount, inputInfo, onProgress) {
    const totalSteps = 2; // transfer, swap
    const report = makeProgressReporter(onProgress, totalSteps);
    const poolPrincipal = Principal.fromText(poolCid);
    const owner = this.config.identity.getPrincipal();

    try {
      // Step 0: Transfer input tokens to pool's subaccount for our principal
      report(SwapStep.TRANSFERRING, 'Transferring tokens to ICPSwap pool...', 0);
      const subaccount = principalToSubaccount(owner);
      await transfer(inputToken, this.agent, poolPrincipal, amount, subaccount);

      // Step 1: depositAndSwap (combined: deposit from subaccount + swap + withdraw)
      report(SwapStep.SWAPPING, 'Executing swap...', 1);
      const result = await pool.depositAndSwap(args);

      if ('err' in result) {
        report(SwapStep.FAILED, `Swap failed: ${JSON.stringify(result.err)}`, 1, { error: JSON.stringify(result.err) });
        return { success: false, amountOut: 0n };
      }

      const amountOut = BigInt(result.ok);
      report(SwapStep.COMPLETE, 'Swap complete!', 1, { txId: amountOut.toString() });
      return { success: true, amountOut };
    } catch (e) {
      report(SwapStep.FAILED, `Swap failed: ${e.message}`, 0, { error: e.message });
      return { success: false, amountOut: 0n };
    }
  }

  // ─── ICPSwap-specific public methods ──────────────────────────────────────

  /**
   * Preload all pool canister IDs from factory into cache.
   * @returns {Promise<number>} Number of pools loaded
   */
  async loadAllPools() {
    return this.poolCache.loadAll(this.factoryActor);
  }

  /**
   * Get the pool canister cache (so callers can share it).
   * @returns {Map<string, string>}
   */
  getPoolCacheMap() {
    return this.poolCache.getMap();
  }

  // ─── Legacy API (deposit, swap, withdraw as separate calls) ───────────────

  /**
   * Deposit tokens into a pool (ICRC1 path).
   * Caller must have already transferred tokens to the pool's subaccount.
   * @param {string} poolCid
   * @param {string} tokenCanisterId
   * @param {bigint} amount
   * @param {bigint} fee
   * @returns {Promise<bigint>}
   */
  async legacyDeposit(poolCid, tokenCanisterId, amount, fee) {
    const pool = this._getPoolActor(poolCid);
    const result = await pool.deposit({ token: tokenCanisterId, amount, fee });
    if ('err' in result) throw new Error(`Deposit failed: ${JSON.stringify(result.err)}`);
    return BigInt(result.ok);
  }

  /**
   * Execute a raw swap on a pool (after deposit).
   * @param {string} poolCid
   * @param {string} amountIn
   * @param {boolean} zeroForOne
   * @param {string} amountOutMinimum
   * @returns {Promise<bigint>}
   */
  async legacySwap(poolCid, amountIn, zeroForOne, amountOutMinimum) {
    const pool = this._getPoolActor(poolCid);
    const result = await pool.swap({ amountIn, zeroForOne, amountOutMinimum });
    if ('err' in result) throw new Error(`Swap failed: ${JSON.stringify(result.err)}`);
    return BigInt(result.ok);
  }

  /**
   * Withdraw tokens from a pool.
   * @param {string} poolCid
   * @param {string} tokenCanisterId
   * @param {bigint} amount
   * @param {bigint} fee
   * @returns {Promise<bigint>}
   */
  async legacyWithdraw(poolCid, tokenCanisterId, amount, fee) {
    const pool = this._getPoolActor(poolCid);
    const result = await pool.withdraw({ token: tokenCanisterId, amount, fee });
    if ('err' in result) throw new Error(`Withdraw failed: ${JSON.stringify(result.err)}`);
    return BigInt(result.ok);
  }
}

export default ICPSwapDex;
