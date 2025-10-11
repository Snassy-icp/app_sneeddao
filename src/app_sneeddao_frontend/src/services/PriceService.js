/**
 * PriceService - Multi-tier price lookup and caching system
 * 
 * Provides:
 * - ICP/USD prices from the ICP/USDC pool
 * - Token/ICP prices from individual token/ICP pools
 * - Token/USD prices by multiplying Token/ICP × ICP/USD
 * - Multi-level caching with different TTLs for optimal performance
 */

import { HttpAgent, Actor } from '@dfinity/agent';
import { Principal } from '@dfinity/principal';
import { idlFactory as poolIdlFactory } from 'external/icp_swap/icp_swap.did.js';
import { idlFactory as factoryIdlFactory } from 'external/icp_swap_factory/icp_swap_factory.did.js';

// Constants
const ICP_USDC_POOL_ID = 'mohjv-bqaaa-aaaag-qjyia-cai';
const ICP_CANISTER_ID = 'ryjl3-tyaaa-aaaaa-aaaba-cai';
const ICPSWAP_FACTORY_CANISTER = '4mmnk-kiaaa-aaaag-qbllq-cai';
const ICP_DECIMALS = 8;
const USDC_DECIMALS = 6;

// Cache TTLs
const CACHE_TTL_MS = 60 * 1000; // 1 minute for ICP/USD price
const TOKEN_PRICE_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes for token prices

// Cache keys for localStorage persistence
const POOL_CACHE_KEY = 'icpswap_pools';
const TOKEN_PRICE_CACHE_KEY = 'icpswap_token_prices';

class PriceService {
    constructor() {
        this.agent = null;
        this.poolActor = null; // ICP/USDC pool actor
        this.factoryActor = null; // ICPSwap factory actor
        this.priceCache = null; // ICP/USD price cache
        this.poolCache = new Map(); // Pool data cache
        this.tokenPriceCache = {}; // Token/ICP price cache
        this.tokenDecimalsCache = {}; // Cache for token decimals
        this.initPromise = null; // Promise for lazy initialization
    }

    /**
     * Lazy initialization - creates actors only when needed
     */
    async init() {
        if (this.initPromise) {
            return this.initPromise;
        }

        this.initPromise = (async () => {
            try {
                const isLocal = process.env.DFX_NETWORK !== 'ic';
                const host = isLocal ? 'http://localhost:4943' : 'https://ic0.app';

                this.agent = new HttpAgent({ host });

                if (isLocal) {
                    await this.agent.fetchRootKey().catch(err => {
                        console.warn('Unable to fetch root key:', err);
                    });
                }

                // Create actor for ICP/USDC pool (for USD price)
                this.poolActor = Actor.createActor(poolIdlFactory, {
                    agent: this.agent,
                    canisterId: ICP_USDC_POOL_ID,
                });

                // Create actor for ICPSwap factory (for pool discovery)
                this.factoryActor = Actor.createActor(factoryIdlFactory, {
                    agent: this.agent,
                    canisterId: ICPSWAP_FACTORY_CANISTER,
                });

                // Load cached data from localStorage
                this.loadPoolCache();
                this.loadTokenPriceCache();

                console.log('PriceService initialized successfully');
            } catch (error) {
                console.error('Failed to initialize PriceService:', error);
                this.initPromise = null; // Allow retry
                throw error;
            }
        })();

        return this.initPromise;
    }

    /**
     * Load token price cache from localStorage
     */
    loadTokenPriceCache() {
        try {
            const cachedPrices = localStorage.getItem(TOKEN_PRICE_CACHE_KEY);
            if (cachedPrices) {
                this.tokenPriceCache = JSON.parse(cachedPrices);

                // Clean expired entries
                const now = Date.now();
                Object.entries(this.tokenPriceCache).forEach(([tokenId, cache]) => {
                    if (now - cache.timestamp > TOKEN_PRICE_CACHE_TTL_MS) {
                        delete this.tokenPriceCache[tokenId];
                    }
                });

                // Save cleaned cache back
                if (Object.keys(this.tokenPriceCache).length > 0) {
                    this.saveTokenPriceCache();
                } else {
                    localStorage.removeItem(TOKEN_PRICE_CACHE_KEY);
                }
            }
        } catch (error) {
            console.warn('Failed to load token price cache from localStorage:', error);
            this.tokenPriceCache = {};
        }
    }

    /**
     * Save token price cache to localStorage
     */
    saveTokenPriceCache() {
        try {
            localStorage.setItem(TOKEN_PRICE_CACHE_KEY, JSON.stringify(this.tokenPriceCache));
        } catch (error) {
            console.warn('Failed to save token price cache to localStorage:', error);
        }
    }

    /**
     * Load pool cache from localStorage
     */
    loadPoolCache() {
        try {
            const cachedPools = localStorage.getItem(POOL_CACHE_KEY);
            if (cachedPools) {
                const poolData = JSON.parse(cachedPools);
                this.poolCache = new Map(Object.entries(poolData));
            }
        } catch (error) {
            console.warn('Failed to load pool cache from localStorage:', error);
            this.poolCache = new Map();
        }
    }

    /**
     * Save pool cache to localStorage
     */
    savePoolCache() {
        try {
            const poolData = Object.fromEntries(this.poolCache);
            localStorage.setItem(POOL_CACHE_KEY, JSON.stringify(poolData));
        } catch (error) {
            console.warn('Failed to save pool cache to localStorage:', error);
        }
    }

    /**
     * Get ICP/USD price from ICP/USDC pool
     * @returns {Promise<number>} ICP price in USD
     */
    async getICPUSDPrice() {
        await this.init();

        // Check memory cache first
        if (this.priceCache) {
            const age = Date.now() - this.priceCache.timestamp;
            if (age < CACHE_TTL_MS) {
                return this.priceCache.price;
            }
        }

        try {
            // Get pool metadata from ICP/USDC pool
            const response = await this.poolActor.metadata();
            if (!response.ok || response.err) {
                throw new Error(response.err?.message || 'Failed to fetch ICP/USD pool metadata');
            }

            const metadata = response.ok;

            // Check if ICP is token0 or token1
            const isICPToken0 = metadata.token0.address === ICP_CANISTER_ID;

            // Calculate price from sqrtPriceX96
            const Q96 = BigInt(2) ** BigInt(96);
            const sqrtPrice = Number(metadata.sqrtPriceX96) / Number(Q96);
            let price = sqrtPrice * sqrtPrice;

            // If ICP is token1, we need to invert the price
            if (!isICPToken0) {
                price = 1 / price;
            }

            // Adjust for decimal differences (ICP=8, USDC=6)
            const decimalAdjustment = 10 ** (ICP_DECIMALS - USDC_DECIMALS);
            price = price * decimalAdjustment;

            // Cache the result
            this.priceCache = {
                price,
                timestamp: Date.now()
            };

            return price;
        } catch (error) {
            console.error('Error fetching ICP/USD price:', error);
            // Return cached price if available, even if expired
            if (this.priceCache) {
                console.warn('Using expired ICP/USD price cache due to error');
                return this.priceCache.price;
            }
            throw error;
        }
    }

    /**
     * Get pool for a token/ICP pair
     * @param {string} tokenCanisterId - Token canister ID
     * @returns {Promise<Object>} Pool data
     */
    async getICPPool(tokenCanisterId) {
        await this.init();

        // Generate cache key
        const cacheKey = `icp-${tokenCanisterId}`;

        // Check cache first
        const cached = this.poolCache.get(cacheKey);
        if (cached) {
            return cached.pool;
        }

        try {
            // Create token objects
            const icpToken = { address: ICP_CANISTER_ID, standard: 'ICRC1' };
            const otherToken = { address: tokenCanisterId, standard: 'ICRC1' };

            // Sort tokens to match ICPSwap's ordering (lexicographical)
            const [token0, token1] = icpToken.address.toLowerCase() < otherToken.address.toLowerCase()
                ? [icpToken, otherToken]
                : [otherToken, icpToken];

            // Get pool from factory
            const response = await this.factoryActor.getPool({
                token0,
                token1,
                fee: BigInt(3000), // Default 0.3% fee
            });

            if ('err' in response || !response.ok) {
                throw new Error(response.err?.message || 'Failed to fetch pool data');
            }

            const poolData = response.ok;

            // Normalize the canisterId
            let normalizedCanisterId;
            if (typeof poolData.canisterId === 'string') {
                normalizedCanisterId = poolData.canisterId;
            } else if (poolData.canisterId && typeof poolData.canisterId.toText === 'function') {
                normalizedCanisterId = poolData.canisterId.toText();
            } else if (poolData.canisterId && poolData.canisterId._isPrincipal) {
                normalizedCanisterId = Principal.from(poolData.canisterId).toText();
            } else {
                normalizedCanisterId = String(poolData.canisterId);
            }

            // Create the normalized pool data
            const pool = {
                ...poolData,
                canisterId: normalizedCanisterId
            };

            // Cache the result
            this.poolCache.set(cacheKey, {
                pool,
                timestamp: Date.now()
            });

            // Persist to localStorage
            this.savePoolCache();

            return pool;
        } catch (error) {
            console.error('Error fetching ICPSwap pool:', error);
            throw error;
        }
    }

    /**
     * Get token/ICP price
     * @param {string} tokenCanisterId - Token canister ID
     * @param {number} tokenDecimals - Token decimals (optional, will be looked up if not provided)
     * @returns {Promise<number>} Token price in ICP
     */
    async getTokenICPPrice(tokenCanisterId, tokenDecimals = null) {
        await this.init();

        // If the token is ICP itself, return 1
        if (tokenCanisterId === ICP_CANISTER_ID) {
            return 1;
        }

        // Check memory cache first
        const cached = this.tokenPriceCache[tokenCanisterId];
        if (cached && (Date.now() - cached.timestamp) < TOKEN_PRICE_CACHE_TTL_MS) {
            return cached.price;
        }

        try {
            // Get the pool for this token/ICP pair
            const pool = await this.getICPPool(tokenCanisterId);

            // Create actor for this pool
            const poolActor = Actor.createActor(poolIdlFactory, {
                agent: this.agent,
                canisterId: pool.canisterId,
            });

            // Get pool metadata
            const response = await poolActor.metadata();
            if (!response.ok || response.err) {
                throw new Error(response.err?.message || 'Failed to fetch pool metadata');
            }

            const metadata = response.ok;

            // Check if our token is token0 or token1
            const isTokenToken0 = metadata.token0.address === tokenCanisterId;

            // Calculate price from sqrtPriceX96
            const Q96 = BigInt(2) ** BigInt(96);
            const sqrtPrice = Number(metadata.sqrtPriceX96) / Number(Q96);
            let price = sqrtPrice * sqrtPrice;

            // If our token is token1, we need to invert the price
            if (!isTokenToken0) {
                price = 1 / price;
            }

            // Adjust for decimal differences between token and ICP
            const decimals = tokenDecimals ?? this.tokenDecimalsCache[tokenCanisterId] ?? 8;
            const decimalAdjustment = 10 ** (decimals - ICP_DECIMALS);
            price = price * decimalAdjustment;

            // Cache the result
            this.tokenPriceCache[tokenCanisterId] = {
                price,
                timestamp: Date.now()
            };
            this.saveTokenPriceCache();

            return price;
        } catch (error) {
            console.error(`Error fetching token ICP price for ${tokenCanisterId}:`, error);
            // Return cached price if available, even if expired
            if (cached) {
                console.warn(`Using expired token price cache for ${tokenCanisterId} due to error`);
                return cached.price;
            }
            throw error;
        }
    }

    /**
     * Get token/USD price
     * @param {string} tokenCanisterId - Token canister ID
     * @param {number} tokenDecimals - Token decimals (optional)
     * @returns {Promise<number>} Token price in USD
     */
    async getTokenUSDPrice(tokenCanisterId, tokenDecimals = null) {
        try {
            // Get both prices in parallel since they use independent caches
            const [tokenICPPrice, icpUSDPrice] = await Promise.all([
                this.getTokenICPPrice(tokenCanisterId, tokenDecimals),
                this.getICPUSDPrice()
            ]);

            return tokenICPPrice * icpUSDPrice;
        } catch (error) {
            console.error(`Error calculating token USD price for ${tokenCanisterId}:`, error);
            throw error;
        }
    }

    /**
     * Set token decimals for better price calculations
     * @param {string} tokenCanisterId - Token canister ID
     * @param {number} decimals - Token decimals
     */
    setTokenDecimals(tokenCanisterId, decimals) {
        this.tokenDecimalsCache[tokenCanisterId] = decimals;
    }

    /**
     * Clear all caches
     */
    clearAllCaches() {
        this.priceCache = null;
        this.poolCache.clear();
        this.tokenPriceCache = {};
        this.tokenDecimalsCache = {};
        localStorage.removeItem(POOL_CACHE_KEY);
        localStorage.removeItem(TOKEN_PRICE_CACHE_KEY);
        console.log('All price caches cleared');
    }

    /**
     * Clear token-specific cache
     * @param {string} tokenCanisterId - Token canister ID
     */
    clearTokenCache(tokenCanisterId) {
        delete this.tokenPriceCache[tokenCanisterId];
        const cacheKey = `icp-${tokenCanisterId}`;
        this.poolCache.delete(cacheKey);
        this.saveTokenPriceCache();
        this.savePoolCache();
    }
}

// Export singleton instance
export const priceService = new PriceService();
export default priceService;

