// The Sneed Lock NFT card's pure model (src/app_sneeddao_frontend/src/utils/sneedLockNftModel.js):
// a Sneed Lock NFT in a Sneedex offer and on /nft_item showed only its picture and metadata, so a
// bidder could not see how many tokens the lock holds or what they are worth. The card reads the
// lock's state and values it with these functions. No canister needed.
//   1. tokenLockValue: amount with the token's decimals, value at the price; no price -> null
//   2. positionLockValue: an LP position's two amounts (in range, below, above), its uncollected
//      fees counted as the lock page counts them, total value; a side with tokens and no price ->
//      value unknown (null), never a wrong number; a side without tokens needs no price
//   3. lockStatus: fixed expiry, expired, dissolve delay not dissolving, dissolving
//   4. lockAssets: token and position locks from a LockState; lockPageUrl is /lock/<id>
//   5. offerLockIds / lockValuesUsd: the offer value estimate (good-deal badge) left Sneed Lock NFTs out
import { describe, it, expect } from 'vitest';
import { tokenLockValue, positionLockValue, amountsForLiquidity, sqrtAtTick, lockStatus, lockAssets, lockPageUrl, knownPrice, fmtWhole, offerLockIds, lockValuesUsd } from '../../../src/app_sneeddao_frontend/src/utils/sneedLockNftModel.js';

const NEVER = 18_446_744_073_709_551_615n;
const Q96 = 2n ** 96n;
const close = (a, b, rel = 1e-9) => expect(Math.abs(a - b)).toBeLessThanOrEqual(Math.abs(b) * rel + 1e-12);
const P = (t) => ({ toText: () => t });

describe('Sneed Lock NFT card model', () => {
  it('1. a token lock: amount in whole tokens and its value; unknown price -> null', () => {
    const v = tokenLockValue(1_234_50000000n, 8, 0.5);
    expect(v.units).toBe(1_234_50000000n);
    close(v.whole, 1234.5);
    close(v.usd, 617.25);
    const six = tokenLockValue(2_500_000n, 6, 2); // a 6-decimal token
    close(six.whole, 2.5); close(six.usd, 5);
    expect(tokenLockValue(1_00000000n, 8, 0).usd).toBeNull(); // the price service answers 0 for "no price"
    expect(tokenLockValue(1_00000000n, 8, null).usd).toBeNull();
    expect(tokenLockValue(1_00000000n, 8, NaN).usd).toBeNull();
    expect(knownPrice(3)).toBe(3);
    expect(knownPrice(-1)).toBeNull();
  });

  it('2. an LP position: both amounts plus fees, total value, value unknown without a price', () => {
    const L = 10_000_000_000n;
    const pos = { liquidity: L, tickLower: -600n, tickUpper: 600n, tokensOwed0: 1_000_000n, tokensOwed1: 2_000_000n };
    // price 1 (sqrtPriceX96 = 2^96): in range, both sides
    const v = positionLockValue(pos, Q96, 8, 8, 2, 4);
    const su = sqrtAtTick(600); const sl = sqrtAtTick(-600);
    const a0 = Number(L) * (su - 1) / su; const a1 = Number(L) * (1 - sl);
    expect(v.inRange).toBe(true);
    close(v.amount0, a0 / 1e8); close(v.amount1, a1 / 1e8);
    close(v.fees0, 0.01); close(v.fees1, 0.02);
    close(v.total0, (a0 + 1_000_000) / 1e8); close(v.total1, (a1 + 2_000_000) / 1e8);
    close(v.usd, v.total0 * 2 + v.total1 * 4);
    // the same math the position page uses
    expect(amountsForLiquidity(Number(L), -600, 600, 1)).toEqual({ amount0: a0, amount1: a1, inRange: true });
    // one price unknown -> the total is unknown, the known side keeps its value
    const half = positionLockValue(pos, Q96, 8, 8, 2, 0);
    expect(half.usd).toBeNull();
    close(half.usd0, v.total0 * 2);
    expect(half.usd1).toBeNull();
    // price far above the range: all token1; token0 has no tokens, so its missing price does not matter
    const above = positionLockValue({ ...pos, tokensOwed0: 0n, tokensOwed1: 0n }, Q96 * 10n, 8, 8, 0, 4);
    expect(above.inRange).toBe(false);
    expect(above.amount0).toBe(0);
    close(above.amount1, Number(L) * (su - sl) / 1e8);
    close(above.usd, above.amount1 * 4);
    // price far below: all token0
    const below = positionLockValue({ ...pos, tokensOwed0: 0n, tokensOwed1: 0n }, Q96 / 10n, 8, 8, 2, 0);
    expect(below.amount1).toBe(0);
    close(below.amount0, Number(L) * (su - sl) / (sl * su) / 1e8);
    close(below.usd, below.amount0 * 2);
    // different decimals per side
    const mixed = positionLockValue(pos, Q96, 6, 8, 1, 1);
    close(mixed.total0, (a0 + 1_000_000) / 1e6);
  });

  it('3. lock state: fixed expiry, expired, held until dissolved, dissolving', () => {
    const now = 1_000_000n;
    const base = { dissolve_delay: 0n, dissolving_until: [], earliest_unlock: 5_000_000n };
    expect(lockStatus({ ...base, expiry: 5_000_000n }, now)).toEqual({ status: 'until', at: 5_000_000n });
    expect(lockStatus({ ...base, expiry: 500n }, now)).toEqual({ status: 'expired', at: 500n });
    expect(lockStatus({ ...base, dissolve_delay: 86_400_000_000_000n, expiry: NEVER, earliest_unlock: 9_000_000n }, now))
      .toEqual({ status: 'held', delayNs: 86_400_000_000_000n, earliest: 9_000_000n });
    expect(lockStatus({ ...base, dissolve_delay: 7n, dissolving_until: [3_000_000n], expiry: 3_000_000n }, now))
      .toEqual({ status: 'dissolving', at: 3_000_000n, delayNs: 7n });
    expect(lockStatus({ ...base, dissolve_delay: 7n, dissolving_until: [900n], expiry: 900n }, now))
      .toEqual({ status: 'expired', at: 900n });
  });

  it('4. what a lock holds, from its LockState, and its /lock page', () => {
    // as get_lock_state answers on prod for NFT #340 (Sneedex offer #67)
    const position = {
      kind: { PositionLock: null }, amount: [], ledger: [], position_id: [6n],
      swap_canister_id: [P('zyi2r-jqaaa-aaaar-qbsda-cai')], token0: [P('r4db7-eaaaa-aaaah-arh4q-cai')], token1: [P('ryjl3-tyaaa-aaaaa-aaaba-cai')],
    };
    expect(lockAssets(position)).toEqual({ kind: 'position', swap: 'zyi2r-jqaaa-aaaar-qbsda-cai', positionId: 6n, token0: 'r4db7-eaaaa-aaaah-arh4q-cai', token1: 'ryjl3-tyaaa-aaaaa-aaaba-cai' });
    const token = { kind: { TokenLock: null }, amount: [42n], ledger: [P('hvgxa-wqaaa-aaaaq-aacia-cai')], position_id: [], swap_canister_id: [], token0: [], token1: [] };
    expect(lockAssets(token)).toEqual({ kind: 'token', ledger: 'hvgxa-wqaaa-aaaaq-aacia-cai', amount: 42n });
    expect(lockPageUrl(340n)).toBe('/lock/340');
    expect(lockPageUrl('7')).toBe('/lock/7');
    expect(fmtWhole(1234.56789, 8)).toBe('1,234.5679');
    expect(fmtWhole(0.000123456, 8)).toBe('0.000123');
    expect(fmtWhole(5, 0)).toBe('5');
  });

  it('5. the offer value estimate counts Sneed Lock NFTs and SneedLock assets (good-deal badge)', () => {
    const SL = 'pqsms-lqaaa-aaaal-ajjza-cai';
    // offer #67 as Sneedex answers it: one ICRC7NFT asset of the Sneed Lock collection, tokens 340 and 339
    const offer67 = [{ asset: { ICRC7NFT: { collection_canister_id: P(SL), token_ids: [340n, 339n] } }, escrowed: true }];
    expect(offerLockIds(offer67, SL)).toEqual(['340', '339']);
    // other NFT collections, tokens and neurons hold no locks; a SneedLock asset holds its lock
    const mixed = [
      { asset: { ICRC7NFT: { collection_canister_id: P('tsdbx-ayaaa-aaaal-qxogq-cai'), token_ids: [1n] } } },
      { asset: { ICRC1Token: { ledger_canister_id: P('ryjl3-tyaaa-aaaaa-aaaba-cai'), amount: 5n } } },
      { asset: { SneedLock: { lock_id: 77n, lock: { Token: {} } } } },
    ];
    expect(offerLockIds(mixed, SL)).toEqual(['77']);
    expect(offerLockIds([], SL)).toEqual([]);
    // the values the card computes (fees included), summed; prod 2026-10-25: #340 $493.38, #339 $119.05
    const pos6 = positionLockValue({ liquidity: 0n, tickLower: 0, tickUpper: 1, tokensOwed0: 347_088_946_373n, tokensOwed1: 0n }, Q96, 8, 8, 2e-6, 2.5);
    close(pos6.usd, 3470.88946373 * 2e-6); // fees alone are counted
    const r = lockValuesUsd(['340', '339'], { 340: 493.38, 339: 119.05 });
    close(r.usd, 612.43); expect(r.unknown).toBe(0);
    // no price (null) or not read yet (undefined): adds nothing, as an ICRC-1 token without a price
    expect(lockValuesUsd(['340', '339'], { 340: 493.38, 339: null })).toEqual({ usd: 493.38, unknown: 1 });
    expect(lockValuesUsd(['340'], {})).toEqual({ usd: 0, unknown: 1 });
  });
});
