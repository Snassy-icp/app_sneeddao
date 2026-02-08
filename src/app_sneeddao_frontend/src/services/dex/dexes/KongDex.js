/**
 * KongDex — DEX adapter for KongSwap.
 *
 * KongSwap uses a single swap canister. It supports both ICRC1 and ICRC2 tokens,
 * handles multi-hop routing internally, and returns output tokens directly from
 * the swap call (no separate claim step in the normal flow).
 *
 * ICRC1 flow: user transfers tokens to Kong canister first, passes the block
 *   index in `pay_tx_id`. Block index is persisted to localStorage immediately
 *   after transfer so it can be recovered if the page crashes.
 *
 * ICRC2 flow: Kong calls transferFrom. User just needs to approve first.
 *
 * Designed to be reusable: accepts identity/agent, manages own caching.
 */

import { Actor, HttpAgent } from '@dfinity/agent';
import { Principal } from '@dfinity/principal';
import { idlFactory as kongIdlFactory } from 'external/kong/kong.did.js';
import { BaseDex } from './BaseDex.js';
import {
  KONG_SWAP_CANISTER,
  SwapStep,
  makeProgressReporter,
  getHost,
} from '../types.js';
import {
  getTokenInfo,
  checkAllowance,
  approve,
  transfer,
} from '../tokenStandard.js';

// ─── localStorage keys ──────────────────────────────────────────────────────

const TX_CACHE_KEY    = 'kong_pending_txs';
const POOLS_CACHE_KEY = 'kong_pools_cache';
const UNCLAIMED_KEY   = 'kong_unclaimed_ids';

// ─── KongTxCache (crash-recovery for ICRC1 block indexes) ───────────────────

class KongTxCache {
  constructor(externalData) {
    if (externalData) {
      this.data = externalData;
    } else {
      this.data = {};
      this._load();
    }
  }

  /**
   * Save a pending transfer block index.
   * @param {string} key   - Unique key for this pending tx (e.g. `${inputToken}:${ts}`)
   * @param {object} entry - { blockIndex, inputToken, outputToken, amount, timestamp }
   */
  set(key, entry) {
    this.data[key] = entry;
    this._save();
  }

  get(key) { return this.data[key]; }
  remove(key) { delete this.data[key]; this._save(); }
  getAll() { return { ...this.data }; }
  isEmpty() { return Object.keys(this.data).length === 0; }

  _load() {
    try {
      const raw = localStorage.getItem(TX_CACHE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        // Restore bigints
        for (const v of Object.values(parsed)) {
          if (v.blockIndex) v.blockIndex = BigInt(v.blockIndex);
          if (v.amount) v.amount = BigInt(v.amount);
        }
        this.data = parsed;
      }
    } catch { /* ok */ }
  }

  _save() {
    try {
      localStorage.setItem(TX_CACHE_KEY, JSON.stringify(this.data, (_, v) =>
        typeof v === 'bigint' ? v.toString() : v
      ));
    } catch { /* ok */ }
  }
}

// ─── KongDex ────────────────────────────────────────────────────────────────

export class KongDex extends BaseDex {
  id = 'kong';
  name = 'KongSwap';
  supportedStandards = ['icrc1', 'icrc2'];

  /**
   * @param {import('../types').DexConfig} config
   */
  constructor(config) {
    super(config);

    this.agent = config.agent || new HttpAgent({
      host: config.host || getHost(),
      identity: config.identity,
    });

    this.kongActor = Actor.createActor(kongIdlFactory, {
      agent: this.agent,
      canisterId: KONG_SWAP_CANISTER,
    });

    this.txCache = new KongTxCache(config.kongTxCache);

    // In-memory pools cache (loaded lazily)
    this._pools = null;
    this._poolsTimestamp = 0;
    this._poolsCacheTTL = 5 * 60 * 1000; // 5 min
  }

  // ─── Internal helpers ───────────────────────────────────────────────────

  /**
   * Fetch pools (cached in memory + localStorage).
   * @returns {Promise<Array>}
   */
  async _getPools() {
    const now = Date.now();
    if (this._pools && (now - this._poolsTimestamp) < this._poolsCacheTTL) {
      return this._pools;
    }

    // Try localStorage first
    try {
      const raw = localStorage.getItem(POOLS_CACHE_KEY);
      if (raw) {
        const { pools, ts } = JSON.parse(raw);
        if (now - ts < this._poolsCacheTTL) {
          this._pools = pools;
          this._poolsTimestamp = ts;
          return pools;
        }
      }
    } catch { /* ok */ }

    // Fetch from canister
    const result = await this.kongActor.pools([]);
    if ('Err' in result) throw new Error(`Kong pools failed: ${result.Err}`);

    this._pools = result.Ok;
    this._poolsTimestamp = now;

    try {
      localStorage.setItem(POOLS_CACHE_KEY, JSON.stringify({
        pools: this._pools,
        ts: now,
      }, (_, v) => typeof v === 'bigint' ? v.toString() : v));
    } catch { /* ok */ }

    return this._pools;
  }

  /**
   * Find a pool for a token pair.  Kong uses `address_0` and `address_1`.
   * @param {string} tokenA - canister ID
   * @param {string} tokenB - canister ID
   * @returns {Promise<Object|null>}
   */
  async _findPool(tokenA, tokenB) {
    const pools = await this._getPools();
    const a = tokenA.toLowerCase();
    const b = tokenB.toLowerCase();
    return pools.find(p => {
      const pa = (p.address_0 || '').toLowerCase();
      const pb = (p.address_1 || '').toLowerCase();
      return (pa === a && pb === b) || (pa === b && pb === a);
    }) || null;
  }

  // ─── BaseDex interface ────────────────────────────────────────────────────

  async hasPair(inputToken, outputToken) {
    // Kong routes internally, so we can also check if swap_amounts works.
    // But for a quick check, see if a direct pool exists.
    const pool = await this._findPool(inputToken, outputToken);
    if (pool) return true;

    // Kong may still support a multi-hop route. Try swap_amounts with a tiny amount.
    try {
      const result = await this.kongActor.swap_amounts(inputToken, 1n, outputToken);
      return 'Ok' in result;
    } catch {
      return false;
    }
  }

  async getPairsForToken(token) {
    const pools = await this._getPools();
    const tokenLower = token.toLowerCase();
    const results = [];

    for (const p of pools) {
      const a = (p.address_0 || '').toLowerCase();
      const b = (p.address_1 || '').toLowerCase();
      if (a === tokenLower) {
        results.push({ inputToken: p.address_0, outputToken: p.address_1, poolId: KONG_SWAP_CANISTER });
      } else if (b === tokenLower) {
        results.push({ inputToken: p.address_1, outputToken: p.address_0, poolId: KONG_SWAP_CANISTER });
      }
    }
    return results;
  }

  async getSpotPrice(inputToken, outputToken) {
    // Kong pools have a `price` field (float64).
    const pool = await this._findPool(inputToken, outputToken);
    if (pool) {
      const inputIsAddr0 = (pool.address_0 || '').toLowerCase() === inputToken.toLowerCase();
      // pool.price is token_1 per token_0 (price of token_0 in token_1)
      return inputIsAddr0 ? pool.price : (1 / pool.price);
    }

    // Fallback: use swap_amounts with a tiny amount
    const [inputInfo, outputInfo] = await Promise.all([
      getTokenInfo(inputToken, this.agent),
      getTokenInfo(outputToken, this.agent),
    ]);
    const tinyAmount = BigInt(10 ** Math.max(0, inputInfo.decimals - 4));
    const result = await this.kongActor.swap_amounts(inputToken, tinyAmount, outputToken);
    if ('Err' in result) throw new Error(`Kong swap_amounts failed: ${result.Err}`);

    // If mid_price is available, use it
    if (result.Ok.mid_price) return result.Ok.mid_price;

    const inFloat = Number(tinyAmount) / (10 ** inputInfo.decimals);
    const outFloat = Number(result.Ok.receive_amount) / (10 ** outputInfo.decimals);
    return outFloat / inFloat;
  }

  async getQuote({ inputToken, outputToken, amount, standard, slippage = 0.01 }) {
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
      throw new Error(`Input amount ${amount} too small to cover ${inputFeeCount} fee(s) of ${inputInfo.fee}`);
    }

    // Use swap_amounts for the quote
    const result = await this.kongActor.swap_amounts(inputToken, effectiveInput, outputToken);
    if ('Err' in result) throw new Error(`Kong quote failed: ${result.Err}`);

    const quoteData = result.Ok;
    const expectedOutput = quoteData.receive_amount;
    const netOutput = expectedOutput - outputFees; // outputFees is 0 for Kong, but keep for consistency

    // DEX fee — use pool's lp_fee_bps (basis points) for accuracy
    let dexFeePercent = 0.003; // default 0.3%
    const pool = await this._findPool(inputToken, outputToken);
    if (pool && pool.lp_fee_bps !== undefined) {
      // lp_fee_bps is in basis points: 30 bps = 0.3%
      dexFeePercent = Number(pool.lp_fee_bps) / 10_000;
    } else if (quoteData.txs && quoteData.txs.length > 0) {
      // Fallback: compute from tx-level lp_fee (actual amount) vs pay_amount
      const totalLpFee = quoteData.txs.reduce((sum, tx) => sum + Number(tx.lp_fee || 0), 0);
      const totalPay = quoteData.txs.reduce((sum, tx) => sum + Number(tx.pay_amount || 0), 0);
      if (totalPay > 0) dexFeePercent = totalLpFee / totalPay;
    }

    // Spot price from mid_price (swap_amounts gives us the pool mid-price) or from pool
    let spotPrice;
    try {
      spotPrice = quoteData.mid_price || (await this.getSpotPrice(inputToken, outputToken));
    } catch {
      spotPrice = 0;
    }

    // Price impact — EXCLUDING the DEX fee.
    // Kong's swap_amounts returns a `slippage` field (percentage, e.g. 1.9 = 1.9%)
    // which is Kong's own calculation of price impact. Use it if available.
    // Otherwise compute: the quote output has LP fee + market impact baked in,
    // so compare actualRate to fee-adjusted spot to isolate market impact.
    let priceImpact = 0;
    if (quoteData.slippage !== undefined && quoteData.slippage !== null) {
      // Kong's slippage field is a percentage (e.g. 1.9 means 1.9%)
      priceImpact = Math.abs(quoteData.slippage) / 100;
    } else if (spotPrice > 0) {
      const effectiveInputFloat = Number(effectiveInput) / (10 ** inputInfo.decimals);
      const expectedOutputFloat = Number(expectedOutput) / (10 ** outputInfo.decimals);
      const actualRate = effectiveInputFloat > 0 ? expectedOutputFloat / effectiveInputFloat : 0;
      const feeAdjustedSpot = spotPrice * (1 - dexFeePercent);
      priceImpact = feeAdjustedSpot > 0 ? Math.max(0, 1 - actualRate / feeAdjustedSpot) : 0;
    }

    // Minimum output with slippage tolerance
    const minimumOutput = netOutput - BigInt(Math.ceil(Number(netOutput) * slippage));

    // Build route (Kong may do multi-hop internally)
    const route = (quoteData.txs || []).map((tx, i) => ({
      dexId: this.id,
      poolId: KONG_SWAP_CANISTER,
      inputToken: tx.pay_address || inputToken,
      outputToken: tx.receive_address || outputToken,
      amountIn: tx.pay_amount,
      amountOut: tx.receive_amount,
    }));

    // If no txs detail, single-hop
    if (route.length === 0) {
      route.push({
        dexId: this.id,
        poolId: KONG_SWAP_CANISTER,
        inputToken,
        outputToken,
        amountIn: effectiveInput,
        amountOut: expectedOutput,
      });
    }

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
      route,
      timestamp: Date.now(),
      isRoutedQuote: route.length > 1,
    };
  }

  getInputFeeCount(standard) {
    // ICRC1: 1 (transfer to Kong canister)
    // ICRC2: 2 (approve + transferFrom)
    return standard === 'icrc2' ? 2 : 1;
  }

  getOutputFeeCount(_standard) {
    // Kong sends output tokens directly — no output fee in normal flow
    return 0;
  }

  async executeSwap({ quote, slippage = 0.01, onProgress }) {
    if (quote.standard === 'icrc2') {
      return this._executeIcrc2Swap(quote, slippage, onProgress);
    } else {
      return this._executeIcrc1Swap(quote, slippage, onProgress);
    }
  }

  // ─── ICRC2 swap path ─────────────────────────────────────────────────────

  async _executeIcrc2Swap(quote, slippage, onProgress) {
    const totalSteps = 3;
    const report = makeProgressReporter(onProgress, totalSteps);
    const kongPrincipal = Principal.fromText(KONG_SWAP_CANISTER);
    const owner = this.config.identity.getPrincipal();

    const { inputToken, outputToken, effectiveInputAmount } = quote;
    const inputInfo = await getTokenInfo(inputToken, this.agent);

    try {
      // Step 0: Check allowance
      report(SwapStep.CHECKING_ALLOWANCE, 'Checking token approval...', 0);
      const { allowance } = await checkAllowance(inputToken, this.agent, owner, kongPrincipal);

      // Need enough for effective input + transferFrom fee
      const needed = effectiveInputAmount + inputInfo.fee;

      if (allowance < needed) {
        // Step 1: Approve
        report(SwapStep.APPROVING, 'Approving token spend...', 1);
        await approve(inputToken, this.agent, kongPrincipal, needed);
      }

      // Step 2: Call swap — Kong calls transferFrom + routes + sends output
      report(SwapStep.SWAPPING, 'Executing swap on KongSwap...', 2);

      // receive_amount: hard floor — the minimum tokens the user will accept.
      // max_slippage: percentage ceiling — Kong rejects if total deviation from
      //   mid-price exceeds this. Must cover known impact + fee + user tolerance.
      //   Kong's slippage = total % deviation from mid_price (fee + market impact).
      const minOutput = quote.minimumOutput;

      // Total known deviation = price impact + DEX fee (both as fractions),
      // plus the user's additional slippage tolerance, converted to percentage.
      const totalSlippagePct = (quote.priceImpact + quote.dexFeePercent + slippage) * 100;

      const swapResult = await this.kongActor.swap({
        pay_token: inputToken,
        pay_amount: effectiveInputAmount,
        receive_token: outputToken,
        receive_amount: [minOutput],
        receive_address: [],
        pay_tx_id: [],               // ICRC2: Kong does transferFrom, no block index
        max_slippage: [totalSlippagePct],
        referred_by: [],
      });

      if ('Err' in swapResult) {
        report(SwapStep.FAILED, `Swap failed: ${swapResult.Err}`, 2, { error: swapResult.Err });
        return { success: false, amountOut: 0n };
      }

      const reply = swapResult.Ok;

      // Fallback: handle claim_ids if auto-send failed
      await this._handleClaimIds(reply.claim_ids);

      const amountOut = reply.receive_amount;
      report(SwapStep.COMPLETE, 'Swap complete!', 2, { txId: reply.tx_id.toString() });
      return { success: true, amountOut, txId: reply.tx_id.toString() };
    } catch (e) {
      report(SwapStep.FAILED, `Swap failed: ${e.message}`, 0, { error: e.message });
      return { success: false, amountOut: 0n };
    }
  }

  // ─── ICRC1 swap path ─────────────────────────────────────────────────────

  async _executeIcrc1Swap(quote, slippage, onProgress) {
    const totalSteps = 2;
    const report = makeProgressReporter(onProgress, totalSteps);
    const kongPrincipal = Principal.fromText(KONG_SWAP_CANISTER);

    const { inputToken, outputToken, effectiveInputAmount } = quote;

    try {
      // Step 0: Transfer tokens to Kong canister
      report(SwapStep.TRANSFERRING, 'Transferring tokens to KongSwap...', 0);
      const blockIndex = await transfer(inputToken, this.agent, kongPrincipal, effectiveInputAmount);

      // Immediately persist block index for crash recovery
      const txKey = `${inputToken}:${Date.now()}`;
      this.txCache.set(txKey, {
        blockIndex,
        inputToken,
        outputToken,
        amount: effectiveInputAmount,
        timestamp: Date.now(),
      });

      // Step 1: Call swap with block index
      report(SwapStep.SWAPPING, 'Executing swap on KongSwap...', 1);

      const minOutput = quote.minimumOutput;
      const totalSlippagePct = (quote.priceImpact + quote.dexFeePercent + slippage) * 100;

      const swapResult = await this.kongActor.swap({
        pay_token: inputToken,
        pay_amount: effectiveInputAmount,
        receive_token: outputToken,
        receive_amount: [minOutput],
        receive_address: [],
        pay_tx_id: [{ BlockIndex: blockIndex }],
        max_slippage: [totalSlippagePct],
        referred_by: [],
      });

      if ('Err' in swapResult) {
        // Don't remove from cache — keep for recovery
        report(SwapStep.FAILED, `Swap failed: ${swapResult.Err}`, 1, { error: swapResult.Err });
        return { success: false, amountOut: 0n };
      }

      const reply = swapResult.Ok;

      // Fallback: handle claim_ids if auto-send failed
      await this._handleClaimIds(reply.claim_ids);

      // Clean up cache on success
      this.txCache.remove(txKey);

      const amountOut = reply.receive_amount;
      report(SwapStep.COMPLETE, 'Swap complete!', 1, { txId: reply.tx_id.toString() });
      return { success: true, amountOut, txId: reply.tx_id.toString() };
    } catch (e) {
      report(SwapStep.FAILED, `Swap failed: ${e.message}`, 0, { error: e.message });
      return { success: false, amountOut: 0n };
    }
  }

  // ─── Fallback claim handling ──────────────────────────────────────────────

  /**
   * If claim_ids is non-empty, try to claim. Cache failures for later retry.
   * @param {Array<bigint>} claimIds
   */
  async _handleClaimIds(claimIds) {
    if (!claimIds || claimIds.length === 0) return;

    for (const cid of claimIds) {
      try {
        await this.kongActor.claim(cid);
      } catch (e) {
        console.warn(`Kong claim(${cid}) failed, caching for retry:`, e);
        this._cacheUnclaimedId(cid);
      }
    }
  }

  _cacheUnclaimedId(claimId) {
    try {
      const raw = localStorage.getItem(UNCLAIMED_KEY);
      const list = raw ? JSON.parse(raw) : [];
      if (!list.includes(claimId.toString())) {
        list.push(claimId.toString());
        localStorage.setItem(UNCLAIMED_KEY, JSON.stringify(list));
      }
    } catch { /* ok */ }
  }

  // ─── Kong-specific public methods ─────────────────────────────────────────

  /**
   * Get the crash-recovery TX cache (for UI).
   * @returns {KongTxCache}
   */
  getTxCache() {
    return this.txCache;
  }

  /**
   * Resume a failed ICRC1 swap using a cached block index.
   * @param {string} pendingKey
   * @param {function} [onProgress]
   * @returns {Promise<{ success: boolean, amountOut: bigint }>}
   */
  async resumePendingSwap(pendingKey, onProgress) {
    const entry = this.txCache.get(pendingKey);
    if (!entry) throw new Error(`No pending TX found for key: ${pendingKey}`);

    const report = makeProgressReporter(onProgress, 1);
    report(SwapStep.SWAPPING, 'Resuming swap on KongSwap...', 0);

    try {
      const swapResult = await this.kongActor.swap({
        pay_token: entry.inputToken,
        pay_amount: entry.amount,
        receive_token: entry.outputToken,
        receive_amount: [],
        receive_address: [],
        pay_tx_id: [{ BlockIndex: entry.blockIndex }],
        max_slippage: [],     // Don't constrain — user just wants their tokens back
        referred_by: [],
      });

      if ('Err' in swapResult) {
        report(SwapStep.FAILED, `Resume failed: ${swapResult.Err}`, 0, { error: swapResult.Err });
        return { success: false, amountOut: 0n };
      }

      const reply = swapResult.Ok;
      await this._handleClaimIds(reply.claim_ids);
      this.txCache.remove(pendingKey);

      report(SwapStep.COMPLETE, 'Swap recovered!', 0);
      return { success: true, amountOut: reply.receive_amount };
    } catch (e) {
      report(SwapStep.FAILED, `Resume failed: ${e.message}`, 0, { error: e.message });
      return { success: false, amountOut: 0n };
    }
  }

  /**
   * Get list of unclaimed IDs for recovery UI.
   * @returns {string[]}
   */
  getUnclaimedIds() {
    try {
      const raw = localStorage.getItem(UNCLAIMED_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  }

  /**
   * Retry claiming a specific ID.
   * @param {bigint|string} claimId
   * @returns {Promise<boolean>}
   */
  async retryClaim(claimId) {
    const id = typeof claimId === 'string' ? BigInt(claimId) : claimId;
    try {
      const result = await this.kongActor.claim(id);
      if ('Ok' in result) {
        // Remove from unclaimed cache
        const list = this.getUnclaimedIds().filter(x => x !== id.toString());
        localStorage.setItem(UNCLAIMED_KEY, JSON.stringify(list));
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }
}

export default KongDex;
