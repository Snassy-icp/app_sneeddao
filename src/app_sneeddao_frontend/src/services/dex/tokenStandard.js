/**
 * Token Standard Detection & Metadata Lookup
 *
 * Queries a token's ledger canister to determine its supported standards,
 * fee, symbol, decimals, etc.  Caches results so repeated calls are cheap.
 *
 * Designed to be reusable: accepts agent, no app-specific imports.
 */

import { Actor } from '@dfinity/agent';
import { idlFactory as ledgerIdlFactory } from 'external/icrc1_ledger/icrc1_ledger.did.js';

// ─── Cache ────────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'dex_token_metadata';

/**
 * In-memory + localStorage cache of TokenInfo objects keyed by canister ID.
 * Caller can inject their own cache via setCache().
 */
let cache = new Map();

/** Whether we've loaded from localStorage yet. */
let loaded = false;

function loadFromStorage() {
  if (loaded) return;
  loaded = true;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      for (const [k, v] of Object.entries(parsed)) {
        // Restore bigint
        v.fee = BigInt(v.fee);
        cache.set(k, v);
      }
    }
  } catch { /* ignore corrupt cache */ }
}

function saveToStorage() {
  try {
    const obj = {};
    for (const [k, v] of cache) {
      obj[k] = { ...v, fee: v.fee.toString() };
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
  } catch { /* storage may be full / unavailable */ }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Replace the entire cache (e.g. inject one shared with the rest of your app).
 * @param {Map<string, import('./types').TokenInfo>} externalCache
 */
export function setCache(externalCache) {
  cache = externalCache;
  loaded = true; // don't overwrite with localStorage
}

/**
 * Get the current cache. Useful for callers that want to share it.
 * @returns {Map<string, import('./types').TokenInfo>}
 */
export function getCache() {
  loadFromStorage();
  return cache;
}

/**
 * Clear the in-memory + localStorage cache.
 */
export function clearCache() {
  cache.clear();
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* ok */ }
}

/**
 * Fetch (or return from cache) the TokenInfo for a given ledger canister.
 *
 * @param {string} canisterId  - The token's ledger canister ID
 * @param {import('@dfinity/agent').HttpAgent} agent - An agent to use for queries
 * @returns {Promise<import('./types').TokenInfo>}
 */
export async function getTokenInfo(canisterId, agent) {
  loadFromStorage();

  const cached = cache.get(canisterId);
  if (cached) return cached;

  // Create an actor talking to the token ledger
  const ledger = Actor.createActor(ledgerIdlFactory, { agent, canisterId });

  // Fire all queries in parallel
  const [metadataRaw, standardsRaw, fee] = await Promise.all([
    ledger.icrc1_metadata(),
    ledger.icrc1_supported_standards(),
    ledger.icrc1_fee(),
  ]);

  // Parse metadata: array of [string, Value] pairs
  const meta = {};
  for (const [key, val] of metadataRaw) {
    if ('Text' in val) meta[key] = val.Text;
    else if ('Nat' in val) meta[key] = val.Nat;
    else if ('Int' in val) meta[key] = val.Int;
    else if ('Blob' in val) meta[key] = val.Blob;
  }

  // Determine supported standards
  const stdNames = standardsRaw.map(s => s.name.toLowerCase());
  const supportedStandards = [];
  if (stdNames.some(n => n.includes('icrc-1') || n === 'icrc1')) {
    supportedStandards.push('icrc1');
  }
  if (stdNames.some(n => n.includes('icrc-2') || n === 'icrc2')) {
    supportedStandards.push('icrc2');
  }
  // If the ledger didn't explicitly list ICRC-1 but we could call it, it's ICRC-1
  if (supportedStandards.length === 0) supportedStandards.push('icrc1');

  // Build TokenInfo
  const info = {
    canisterId,
    symbol: meta['icrc1:symbol'] || 'UNKNOWN',
    decimals: Number(meta['icrc1:decimals'] ?? 8),
    fee: BigInt(fee),
    supportedStandards,
    logo: meta['icrc1:logo'] || undefined,
  };

  cache.set(canisterId, info);
  saveToStorage();

  return info;
}

/**
 * Resolve which standard to use for a swap, considering what the token supports
 * and what the DEX supports.
 *
 * @param {import('./types').TokenInfo} tokenInfo
 * @param {string[]} dexSupportedStandards - e.g. ['icrc1','icrc2']
 * @param {string} [preference] - Caller's preference: 'icrc1' | 'icrc2' | undefined
 * @returns {'icrc1' | 'icrc2'}
 */
export function resolveStandard(tokenInfo, dexSupportedStandards, preference) {
  const tokenStds = new Set(tokenInfo.supportedStandards);
  const dexStds   = new Set(dexSupportedStandards);

  // Intersection
  const available = [...tokenStds].filter(s => dexStds.has(s));

  if (available.length === 0) {
    throw new Error(
      `Token ${tokenInfo.symbol} (${tokenInfo.canisterId}) supports [${tokenInfo.supportedStandards}] ` +
      `but DEX only supports [${dexSupportedStandards}]. No compatible standard.`
    );
  }

  // Honour explicit preference if it's in the intersection
  if (preference && available.includes(preference)) return preference;

  // Default: prefer icrc2 when available
  return available.includes('icrc2') ? 'icrc2' : available[0];
}

/**
 * Check ICRC2 allowance for a given spender.
 *
 * @param {string} tokenCanisterId
 * @param {import('@dfinity/agent').HttpAgent} agent
 * @param {import('@dfinity/principal').Principal} owner
 * @param {import('@dfinity/principal').Principal} spender
 * @returns {Promise<{ allowance: bigint, expires_at: bigint | null }>}
 */
export async function checkAllowance(tokenCanisterId, agent, owner, spender) {
  const ledger = Actor.createActor(ledgerIdlFactory, { agent, canisterId: tokenCanisterId });
  const result = await ledger.icrc2_allowance({
    account: { owner, subaccount: [] },
    spender: { owner: spender, subaccount: [] },
  });
  return {
    allowance: result.allowance,
    expires_at: result.expires_at.length > 0 ? result.expires_at[0] : null,
  };
}

/**
 * Approve a spender for ICRC2 transfer_from.
 *
 * @param {string} tokenCanisterId
 * @param {import('@dfinity/agent').HttpAgent} agent
 * @param {import('@dfinity/principal').Principal} spender
 * @param {bigint} amount
 * @returns {Promise<bigint>} Block index of the approval
 */
export async function approve(tokenCanisterId, agent, spender, amount) {
  const ledger = Actor.createActor(ledgerIdlFactory, { agent, canisterId: tokenCanisterId });
  const result = await ledger.icrc2_approve({
    spender: { owner: spender, subaccount: [] },
    amount,
    fee: [],
    memo: [],
    from_subaccount: [],
    created_at_time: [],
    expected_allowance: [],
    expires_at: [],
  });
  if ('Err' in result) {
    throw new Error(`ICRC2 approve failed: ${JSON.stringify(result.Err)}`);
  }
  return result.Ok;
}

/**
 * Perform an ICRC1 transfer.
 *
 * @param {string} tokenCanisterId
 * @param {import('@dfinity/agent').HttpAgent} agent
 * @param {import('@dfinity/principal').Principal} to
 * @param {bigint} amount
 * @param {Uint8Array} [subaccount] - Optional destination subaccount
 * @returns {Promise<bigint>} Block index
 */
export async function transfer(tokenCanisterId, agent, to, amount, subaccount) {
  const ledger = Actor.createActor(ledgerIdlFactory, { agent, canisterId: tokenCanisterId });
  const result = await ledger.icrc1_transfer({
    to: { owner: to, subaccount: subaccount ? [subaccount] : [] },
    amount,
    fee: [],
    memo: [],
    from_subaccount: [],
    created_at_time: [],
  });
  if ('Err' in result) {
    throw new Error(`ICRC1 transfer failed: ${JSON.stringify(result.Err)}`);
  }
  return result.Ok;
}
