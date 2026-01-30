import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Header from '../components/Header';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { FaSearch, FaFilter, FaGavel, FaClock, FaTag, FaCubes, FaBrain, FaCoins, FaArrowRight, FaSync, FaGlobe, FaLock, FaRobot, FaChevronLeft, FaChevronRight, FaChevronDown, FaChevronUp, FaTimes, FaUnlock } from 'react-icons/fa';
import TokenSelector from '../components/TokenSelector';
import PrincipalInput from '../components/PrincipalInput';
import { HttpAgent } from '@dfinity/agent';
import { Principal } from '@dfinity/principal';
import { 
    createSneedexActor, 
    formatAmount, 
    formatTimeRemaining,
    isOfferPastExpiration,
    getOfferStateString,
    getAssetType,
    getAssetDetails,
    CANISTER_KIND_ICP_NEURON_MANAGER,
    formatUsd,
    calculateUsdValue
} from '../utils/SneedexUtils';
import { createActor as createBackendActor } from 'declarations/app_sneeddao_backend';
import { createActor as createGovernanceActor } from 'external/sns_governance';
import { createActor as createLedgerActor } from 'external/icrc1_ledger';
import { getAllSnses, fetchSnsLogo, startBackgroundSnsFetch } from '../utils/SnsUtils';
import priceService from '../services/PriceService';
import { PrincipalDisplay } from '../utils/PrincipalUtils';
import { useTokenMetadata } from '../hooks/useTokenMetadata';

const backendCanisterId = process.env.CANISTER_ID_APP_SNEEDDAO_BACKEND || process.env.REACT_APP_BACKEND_CANISTER_ID;
const getHost = () => process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging' ? 'https://icp0.io' : 'http://localhost:4943';

// Accent colors for Sneedex
const sneedexPrimary = '#8b5cf6'; // Purple
const sneedexSecondary = '#a78bfa';
const sneedexAccent = '#c4b5fd';

// CSS animation keyframes
const injectSneedexStyles = () => {
    if (document.getElementById('sneedex-styles')) return;
    const style = document.createElement('style');
    style.id = 'sneedex-styles';
    style.textContent = `
        @keyframes sneedexFadeIn {
            from { opacity: 0; transform: translateY(20px); }
            to { opacity: 1; transform: translateY(0); }
        }
        @keyframes sneedexPulse {
            0%, 100% { opacity: 0.6; }
            50% { opacity: 1; }
        }
        @keyframes sneedexFloat {
            0%, 100% { transform: translateY(0px); }
            50% { transform: translateY(-5px); }
        }
        @keyframes spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
        }
        .sneedex-hero-icon {
            transition: transform 0.3s ease, box-shadow 0.3s ease;
        }
        .sneedex-hero-icon:hover {
            transform: scale(1.1) rotate(5deg);
            box-shadow: 0 8px 32px rgba(139, 92, 246, 0.4);
        }
        .sneedex-card:hover {
            transform: translateY(-2px);
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
        }
        .sneedex-action-btn {
            transition: all 0.2s ease;
        }
        .sneedex-action-btn:hover {
            transform: translateY(-2px);
        }
    `;
    document.head.appendChild(style);
};

function SneedexOffers() {
    const { identity, isAuthenticated } = useAuth();
    const { theme } = useTheme();
    const navigate = useNavigate();
    
    // Use global token metadata cache for fast logo/metadata loading
    // We use 'metadata' state to trigger re-renders when cache updates
    const { fetchTokenMetadata: fetchGlobalTokenMetadata, getTokenMetadata, metadata: tokenMetadataState } = useTokenMetadata();
    
    // Get the principal from identity
    const principal = identity ? identity.getPrincipal() : null;
    
    const [offers, setOffers] = useState([]);
    const [offersWithBids, setOffersWithBids] = useState({}); // Map of offerId to bid info
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [searchOfferId, setSearchOfferId] = useState(''); // Search by offer ID
    const [searchSellerPrincipal, setSearchSellerPrincipal] = useState(''); // Search by seller principal
    const [filterType, setFilterType] = useState('all'); // all, canister, neuron, token, neuron_manager
    const [sortBy, setSortBy] = useState('newest'); // newest, ending_soon, highest_bid, lowest_price
    const [whitelistedTokens, setWhitelistedTokens] = useState([]);
    const [offerTab, setOfferTab] = useState('public'); // 'public' or 'private'
    const [snsLogos, setSnsLogos] = useState(new Map()); // governance_id -> logo URL
    const [snsList, setSnsList] = useState([]); // List of all SNSes
    const [snsSymbols, setSnsSymbols] = useState(new Map()); // governance_id -> token symbol
    const [neuronInfo, setNeuronInfo] = useState({}); // `${governance_id}_${neuron_id}` -> { stake, state }
    const [neuronManagerInfo, setNeuronManagerInfo] = useState({}); // canister_id -> { totalStake, neuronCount }
    
    // USD pricing state
    const [tokenPrices, setTokenPrices] = useState({}); // ledger_id -> USD price per token
    const [icpPrice, setIcpPrice] = useState(null); // ICP/USD price
    
    // Pagination state
    const [currentPage, setCurrentPage] = useState(1);
    const ITEMS_PER_PAGE = 12;
    
    // Advanced filter state
    const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
    const [showInactiveOffers, setShowInactiveOffers] = useState(true); // Default to showing all offers including inactive
    const [bidTokenFilter, setBidTokenFilter] = useState(''); // Filter by payment token
    const [minPriceFilter, setMinPriceFilter] = useState(''); // Min price filter (in token)
    const [maxPriceFilter, setMaxPriceFilter] = useState(''); // Max price filter (in token)
    const [assetTokenFilter, setAssetTokenFilter] = useState(''); // Filter by asset token (for tokens, SNS neurons, neuron managers)
    const [minAssetAmountFilter, setMinAssetAmountFilter] = useState(''); // Min asset amount filter
    const [maxAssetAmountFilter, setMaxAssetAmountFilter] = useState(''); // Max asset amount filter
    
    // USD-based filter state
    const [minPriceUsdFilter, setMinPriceUsdFilter] = useState(''); // Min price in USD
    const [maxPriceUsdFilter, setMaxPriceUsdFilter] = useState(''); // Max price in USD
    const [minEstValueUsdFilter, setMinEstValueUsdFilter] = useState(''); // Min estimated value in USD
    const [maxEstValueUsdFilter, setMaxEstValueUsdFilter] = useState(''); // Max estimated value in USD
    const [valueRatioFilter, setValueRatioFilter] = useState(''); // Min value/price ratio as percentage (e.g., 100 = value >= price)
    
    // ICP ledger canister ID constant
    const ICP_LEDGER_ID = 'ryjl3-tyaaa-aaaaa-aaaba-cai';
    
    // Inject CSS animations on mount
    useEffect(() => {
        injectSneedexStyles();
    }, []);
    
    // Pre-fetch ICP metadata immediately (used by almost all offers)
    useEffect(() => {
        fetchGlobalTokenMetadata(ICP_LEDGER_ID);
    }, [fetchGlobalTokenMetadata]);
    
    // Fetch SNS list on mount
    useEffect(() => {
        // First check if we already have cached data
        const cached = getAllSnses();
        if (cached && cached.length > 0) {
            setSnsList(cached);
        }
        
        // Start background fetch and update when complete
        startBackgroundSnsFetch(identity, (snses) => {
            if (snses && snses.length > 0) {
                setSnsList(snses);
            }
        });
    }, [identity]);
    
    // Fetch whitelisted tokens for metadata lookup
    useEffect(() => {
        const fetchTokens = async () => {
            try {
                const backendActor = createBackendActor(backendCanisterId, {
                    agentOptions: { identity }
                });
                const tokens = await backendActor.get_whitelisted_tokens();
                setWhitelistedTokens(tokens);
            } catch (e) {
                console.error('Failed to fetch whitelisted tokens:', e);
            }
        };
        fetchTokens();
    }, [identity]);
    
    // Helper to get token info from whitelisted tokens or global metadata cache
    // Note: tokenMetadataState in deps triggers re-render when global cache updates
    const getTokenInfo = useCallback((ledgerId) => {
        // Get metadata from global cache (fast, persists across page navigation)
        const globalMeta = getTokenMetadata(ledgerId);
        const cachedLogo = globalMeta?.logo || null;
        
        // First check whitelisted tokens for basic metadata (symbol, decimals, fee)
        const token = whitelistedTokens.find(t => t.ledger_id.toString() === ledgerId);
        if (token) {
            // Use logo from global cache since whitelist doesn't include logo URLs
            return { symbol: token.symbol, decimals: Number(token.decimals), name: token.name, logo: cachedLogo, fee: token.fee ? BigInt(token.fee) : null };
        }
        // Then check global metadata cache
        if (globalMeta) {
            return { symbol: globalMeta.symbol, decimals: globalMeta.decimals, name: globalMeta.symbol, logo: globalMeta.logo, fee: null };
        }
        // Fallback for known tokens
        if (ledgerId === 'ryjl3-tyaaa-aaaaa-aaaba-cai') return { symbol: 'ICP', decimals: 8, logo: cachedLogo || 'icp_symbol.svg', fee: BigInt(10000) };
        return { symbol: 'TOKEN', decimals: 8, logo: cachedLogo, fee: null };
    }, [whitelistedTokens, getTokenMetadata, tokenMetadataState]);
    
    // Helper to get SNS info by governance id
    const getSnsInfo = useCallback((governanceId) => {
        // Check both possible property paths for governance ID
        const sns = snsList.find(s => 
            s.canisters?.governance === governanceId || 
            s.governance_canister_id?.toString() === governanceId
        );
        const symbol = snsSymbols.get(governanceId);
        if (sns) {
            return { 
                name: sns.name || 'SNS', 
                symbol: symbol || 'Neuron',
                ledgerId: sns.canisters?.ledger
            };
        }
        return { name: 'SNS Neuron', symbol: symbol || 'Neuron', ledgerId: null };
    }, [snsList, snsSymbols]);
    
    // Fetch token symbol from SNS ledger
    const fetchSnsSymbol = useCallback(async (governanceId) => {
        if (snsSymbols.has(governanceId)) return;
        
        // Find the SNS to get its ledger ID
        const sns = snsList.find(s => 
            s.canisters?.governance === governanceId || 
            s.governance_canister_id?.toString() === governanceId
        );
        const ledgerId = sns?.canisters?.ledger;
        if (!ledgerId) return;
        
        try {
            const agent = new HttpAgent({ host: getHost(), identity });
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
            }
            const ledgerActor = createLedgerActor(ledgerId, { agent });
            const metadata = await ledgerActor.icrc1_metadata();
            
            // Find symbol in metadata
            const symbolEntry = metadata.find(([key]) => key === 'icrc1:symbol');
            if (symbolEntry && symbolEntry[1]?.Text) {
                setSnsSymbols(prev => new Map(prev).set(governanceId, symbolEntry[1].Text));
            }
        } catch (e) {
            console.warn('Failed to fetch SNS token symbol:', e);
        }
    }, [snsSymbols, snsList, identity]);
    
    // Fetch SNS logo for a governance ID
    const fetchSnsLogoForOffer = useCallback(async (governanceId) => {
        if (snsLogos.has(governanceId)) return;
        try {
            const logo = await fetchSnsLogo(governanceId);
            if (logo) {
                setSnsLogos(prev => new Map(prev).set(governanceId, logo));
            }
        } catch (e) {
            console.warn('Failed to fetch SNS logo:', e);
        }
    }, [snsLogos]);
    
    // Fetch neuron info (staked amount)
    const fetchNeuronInfo = useCallback(async (governanceId, neuronIdHex) => {
        const key = `${governanceId}_${neuronIdHex}`;
        if (neuronInfo[key]) return;
        
        try {
            const agent = new HttpAgent({ host: getHost(), identity });
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
            }
            const govActor = createGovernanceActor(governanceId, { agent });
            
            // Convert hex to blob for the neuron ID
            const neuronIdBytes = new Uint8Array(neuronIdHex.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
            
            const result = await govActor.get_neuron({
                neuron_id: [{ id: neuronIdBytes }]
            });
            
            if (result && result.result && result.result[0] && result.result[0].Neuron) {
                const neuron = result.result[0].Neuron;
                const stake = neuron.cached_neuron_stake_e8s || BigInt(0);
                setNeuronInfo(prev => ({
                    ...prev,
                    [key]: { stake: Number(stake) / 1e8 }
                }));
            }
        } catch (e) {
            console.warn('Failed to fetch neuron info:', e);
        }
    }, [neuronInfo, identity]);
    
    // Fetch token metadata using global cache (fast, persists across page navigation)
    const fetchTokenMetadata = useCallback(async (ledgerId) => {
        // Use global hook - it handles caching and deduplication automatically
        await fetchGlobalTokenMetadata(ledgerId);
    }, [fetchGlobalTokenMetadata]);
    
    // Fetch ICP Neuron Manager info (total staked + maturity across all neurons)
    const fetchNeuronManagerInfo = useCallback(async (canisterId) => {
        if (neuronManagerInfo[canisterId]) return;
        
        try {
            const actor = createSneedexActor(identity);
            const result = await actor.getNeuronManagerInfo(Principal.fromText(canisterId));
            
            if ('Ok' in result) {
                const info = result.Ok;
                // Calculate total ICP value across all neurons (stake + maturity + staked maturity)
                let totalStakeE8s = BigInt(0);
                let totalMaturityE8s = BigInt(0);
                let totalStakedMaturityE8s = BigInt(0);
                if (info.neurons && info.neurons.length > 0) {
                    for (const neuron of info.neurons) {
                        totalStakeE8s += BigInt(neuron.cached_neuron_stake_e8s);
                        totalMaturityE8s += BigInt(neuron.maturity_e8s_equivalent || 0);
                        totalStakedMaturityE8s += BigInt(neuron.staked_maturity_e8s_equivalent || 0);
                    }
                }
                
                const totalIcp = Number(totalStakeE8s + totalMaturityE8s + totalStakedMaturityE8s) / 1e8;
                
                setNeuronManagerInfo(prev => ({
                    ...prev,
                    [canisterId]: {
                        totalStake: Number(totalStakeE8s) / 1e8,
                        totalMaturity: Number(totalMaturityE8s) / 1e8,
                        totalStakedMaturity: Number(totalStakedMaturityE8s) / 1e8,
                        totalIcp: totalIcp,
                        neuronCount: Number(info.neuron_count)
                    }
                }));
            }
        } catch (e) {
            console.warn('Failed to fetch neuron manager info:', e);
        }
    }, [neuronManagerInfo, identity]);
    
    const fetchOffers = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            const actor = createSneedexActor(identity);
            let fetchedOffers = [];
            
            // Build state filter based on showInactiveOffers toggle
            const stateFilter = showInactiveOffers 
                ? [
                    { Active: null }, 
                    { Completed: { winning_bid_id: 0n, completion_time: 0n } }, 
                    { Claimed: null },
                    { Expired: null },
                    { Cancelled: null },
                    { Reclaimed: null }
                  ]
                : [{ Active: null }]; // Only active offers
            
            // Use getOfferFeed to get offers with state filtering
            // For public tab: only public offers (public_only = true)
            // For private tab: only private offers the user has access to (public_only = false, viewer = principal)
            const feedInput = {
                start_id: [], // Start from newest
                length: 1000, // Get a large number
                filter: [{
                    states: [stateFilter],
                    asset_types: [],
                    creator: [],
                    has_bids: [],
                    public_only: offerTab === 'public' ? [true] : [false],
                    viewer: offerTab === 'private' && principal ? [principal] : []
                }]
            };
            
            try {
                const feedResult = await actor.getOfferFeed(feedInput);
                fetchedOffers = feedResult.offers;
            } catch (feedError) {
                // Fallback to old methods if getOfferFeed fails
                console.warn('getOfferFeed failed, falling back to old methods:', feedError);
                if (offerTab === 'public') {
                    fetchedOffers = await actor.getPublicOffers();
                } else if (principal) {
                    fetchedOffers = await actor.getPrivateOffersFor(principal);
                }
                
                // Filter by state client-side if using fallback
                if (!showInactiveOffers) {
                    fetchedOffers = fetchedOffers.filter(o => 'Active' in o.state);
                }
            }
            
            setOffers(fetchedOffers);
            
            // Start fetching token metadata immediately (don't wait for useEffect)
            // This runs in parallel with bid info fetching for faster logo loading
            const uniqueTokenIds = new Set();
            fetchedOffers.forEach(offer => {
                uniqueTokenIds.add(offer.price_token_ledger.toString());
                offer.assets.forEach(assetEntry => {
                    const details = getAssetDetails(assetEntry);
                    if (details.type === 'ICRC1Token') {
                        uniqueTokenIds.add(details.ledger_id);
                    }
                });
            });
            // Fire off all token metadata fetches in parallel (don't await)
            uniqueTokenIds.forEach(tokenId => fetchGlobalTokenMetadata(tokenId));
            
            // Fetch bid info for each offer in parallel (faster than sequential)
            const bidInfoPromises = fetchedOffers.map(async (offer) => {
                try {
                    const offerView = await actor.getOfferView(offer.id);
                    if (offerView && offerView.length > 0) {
                        return [Number(offer.id), {
                            bids: offerView[0].bids,
                            highest_bid: offerView[0].highest_bid[0] || null,
                        }];
                    }
                } catch (e) {
                    console.warn(`Failed to fetch bid info for offer ${offer.id}:`, e);
                }
                return null;
            });
            
            const bidResults = await Promise.all(bidInfoPromises);
            const bidInfo = {};
            bidResults.forEach(result => {
                if (result) {
                    bidInfo[result[0]] = result[1];
                }
            });
            setOffersWithBids(bidInfo);
        } catch (e) {
            console.error('Failed to fetch offers:', e);
            setError('Failed to load offers. Please try again.');
        } finally {
            setLoading(false);
        }
    }, [identity, offerTab, principal, showInactiveOffers, fetchGlobalTokenMetadata]);
    
    // Clear offers immediately when tab or filter changes (for responsive UX)
    // This shows loading state right away instead of stale data
    useEffect(() => {
        setOffers([]);
        setLoading(true);
    }, [offerTab, showInactiveOffers]);
    
    useEffect(() => {
        fetchOffers();
    }, [fetchOffers]);
    
    // Helper to get SNS ledger from governance ID (defined here for use in price fetching)
    const getSnsLedgerFromGovernanceForPrices = useCallback((governanceId) => {
        const sns = snsList.find(s => {
            // Handle both data formats
            const govId = s.canisters?.governance || 
                          s.governance_canister_id?.[0]?.toString() || 
                          s.governance_canister_id?.toString();
            return govId === governanceId;
        });
        if (sns) {
            return sns.canisters?.ledger || 
                   sns.ledger_canister_id?.[0]?.toString() || 
                   sns.ledger_canister_id?.toString();
        }
        return null;
    }, [snsList]);
    
    // Fetch token prices for USD display
    useEffect(() => {
        const fetchPrices = async () => {
            try {
                // Get ICP price first
                const icp = await priceService.getICPUSDPrice();
                setIcpPrice(icp);
                
                // Collect unique ledger IDs from offers
                const ledgerIds = new Set();
                offers.forEach(offer => {
                    // Add payment token
                    const paymentLedger = offer.price_token_ledger.toString();
                    ledgerIds.add(paymentLedger);
                    
                    // Add asset tokens
                    offer.assets.forEach(assetEntry => {
                        const details = getAssetDetails(assetEntry);
                        if (details.type === 'ICRC1Token') {
                            ledgerIds.add(details.ledger_id);
                        } else if (details.type === 'SNSNeuron') {
                            // Add SNS ledger for neuron assets
                            const snsLedger = getSnsLedgerFromGovernanceForPrices(details.governance_id);
                            if (snsLedger) {
                                ledgerIds.add(snsLedger);
                            }
                        }
                    });
                });
                
                // Fetch prices for each ledger (silently ignore failures - token may not have pool)
                const prices = {};
                for (const ledgerId of ledgerIds) {
                    try {
                        const tokenInfo = getTokenInfo(ledgerId);
                        const price = await priceService.getTokenUSDPrice(ledgerId, tokenInfo.decimals);
                        prices[ledgerId] = price;
                    } catch (e) {
                        // Silently ignore - token may not have an ICPSwap pool
                    }
                }
                setTokenPrices(prices);
            } catch (e) {
                // Silently ignore ICP price fetch errors
            }
        };
        
        if (offers.length > 0 && snsList.length > 0) {
            fetchPrices();
        }
    }, [offers, snsList, getTokenInfo, getSnsLedgerFromGovernanceForPrices]);
    
    // Fetch SNS logos, symbols, neuron info, token logos, and neuron manager info when offers change
    useEffect(() => {
        if (offers.length === 0) return;
        
        offers.forEach(offer => {
            // Fetch metadata for payment (bid) token
            const paymentLedger = offer.price_token_ledger.toString();
            fetchTokenMetadata(paymentLedger);
            
            // Fetch metadata for asset tokens
            offer.assets.forEach(assetEntry => {
                const details = getAssetDetails(assetEntry);
                if (details.type === 'SNSNeuron') {
                    // Fetch SNS logo
                    fetchSnsLogoForOffer(details.governance_id);
                    // Fetch SNS token symbol
                    fetchSnsSymbol(details.governance_id);
                    // Only fetch live neuron info if no cached stake is available
                    // (for backwards compatibility with offers activated before caching was added)
                    if (details.neuron_id && details.cached_stake_e8s === null) {
                        fetchNeuronInfo(details.governance_id, details.neuron_id);
                    }
                } else if (details.type === 'ICRC1Token') {
                    // Fetch token metadata (symbol, name, decimals, logo)
                    fetchTokenMetadata(details.ledger_id);
                } else if (details.type === 'Canister' && details.canister_kind === CANISTER_KIND_ICP_NEURON_MANAGER) {
                    // Only fetch live neuron manager info if no cached value is available
                    // (for backwards compatibility with offers activated before caching was added)
                    if (assetEntry.escrowed && details.cached_total_stake_e8s === null) {
                        fetchNeuronManagerInfo(details.canister_id);
                    }
                }
            });
        });
    }, [offers, fetchSnsLogoForOffer, fetchSnsSymbol, fetchNeuronInfo, fetchTokenMetadata, fetchNeuronManagerInfo]);
    
    // Helper to get SNS ledger from governance ID
    const getSnsLedgerFromGovernance = useCallback((governanceId) => {
        const sns = snsList.find(s => {
            // Handle both data formats
            const govId = s.canisters?.governance || 
                          s.governance_canister_id?.[0]?.toString() || 
                          s.governance_canister_id?.toString();
            return govId === governanceId;
        });
        if (sns) {
            return sns.canisters?.ledger || 
                   sns.ledger_canister_id?.[0]?.toString() || 
                   sns.ledger_canister_id?.toString();
        }
        return null;
    }, [snsList]);
    
    // Calculate estimated USD value of an offer's assets
    const getOfferEstimatedValue = useCallback((offer) => {
        let totalUsd = 0;
        
        for (const assetEntry of offer.assets) {
            const details = getAssetDetails(assetEntry);
            
            if (details.type === 'ICRC1Token') {
                // Token asset - use token price
                const price = tokenPrices[details.ledger_id];
                if (price && details.amount) {
                    const tokenInfo = getTokenInfo(details.ledger_id);
                    totalUsd += calculateUsdValue(details.amount, tokenInfo.decimals, price);
                }
            } else if (details.type === 'SNSNeuron') {
                // SNS Neuron - use cached stake or live neuron info
                const stakeE8s = details.cached_stake_e8s !== null 
                    ? details.cached_stake_e8s 
                    : neuronInfo[`${details.governance_id}_${details.neuron_id}`]?.stake;
                
                if (stakeE8s) {
                    // Get the SNS ledger for this neuron to look up price
                    const snsLedger = getSnsLedgerFromGovernance(details.governance_id);
                    if (snsLedger && tokenPrices[snsLedger]) {
                        const snsInfo = getSnsInfo(details.governance_id);
                        const decimals = snsInfo?.decimals || 8;
                        totalUsd += calculateUsdValue(stakeE8s, decimals, tokenPrices[snsLedger]);
                    }
                }
            } else if (details.type === 'Canister' && details.canister_kind === CANISTER_KIND_ICP_NEURON_MANAGER) {
                // ICP Neuron Manager - use cached total stake or live info
                const totalIcpE8s = details.cached_total_stake_e8s !== null
                    ? details.cached_total_stake_e8s
                    : (neuronManagerInfo[details.canister_id]?.totalIcp 
                        ? BigInt(Math.round(neuronManagerInfo[details.canister_id].totalIcp * 1e8))
                        : null);
                
                if (totalIcpE8s && icpPrice) {
                    totalUsd += calculateUsdValue(totalIcpE8s, 8, icpPrice);
                }
            }
            // Canisters without a known kind don't have an estimated value
        }
        
        return totalUsd;
    }, [tokenPrices, icpPrice, neuronInfo, neuronManagerInfo, getTokenInfo, getSnsLedgerFromGovernance, getSnsInfo]);
    
    // Check if any filters are active (excluding sortBy and filterType as defaults)
    const hasActiveFilters = bidTokenFilter || minPriceFilter || maxPriceFilter || assetTokenFilter || minAssetAmountFilter || maxAssetAmountFilter || minPriceUsdFilter || maxPriceUsdFilter || minEstValueUsdFilter || maxEstValueUsdFilter || valueRatioFilter || searchOfferId || searchSellerPrincipal || filterType !== 'all';
    
    // Clear all filters
    const clearAllFilters = () => {
        setBidTokenFilter('');
        setMinPriceFilter('');
        setMaxPriceFilter('');
        setAssetTokenFilter('');
        setMinAssetAmountFilter('');
        setMaxAssetAmountFilter('');
        setSearchOfferId('');
        setSearchSellerPrincipal('');
        setFilterType('all');
        setMinPriceUsdFilter('');
        setMaxPriceUsdFilter('');
        setMinEstValueUsdFilter('');
        setMaxEstValueUsdFilter('');
        setValueRatioFilter('');
    };
    
    const filteredOffers = offers.filter(offer => {
        if (filterType !== 'all') {
            const hasType = offer.assets.some(a => {
                const type = getAssetType(a.asset);
                const details = getAssetDetails(a);
                if (filterType === 'canister') return type === 'Canister' && details.canister_kind !== CANISTER_KIND_ICP_NEURON_MANAGER;
                if (filterType === 'neuron_manager') return type === 'Canister' && details.canister_kind === CANISTER_KIND_ICP_NEURON_MANAGER;
                if (filterType === 'neuron') return type === 'SNSNeuron';
                if (filterType === 'token') return type === 'ICRC1Token';
                return true;
            });
            if (!hasType) return false;
        }
        
        // Search by offer ID
        if (searchOfferId) {
            const term = searchOfferId.trim();
            if (!offer.id.toString().includes(term)) return false;
        }
        
        // Search by seller principal
        if (searchSellerPrincipal) {
            const term = searchSellerPrincipal.toLowerCase().trim();
            if (!offer.creator.toString().toLowerCase().includes(term)) return false;
        }
        
        // Advanced filter: bid token
        if (bidTokenFilter) {
            const offerBidToken = offer.price_token_ledger.toString();
            if (offerBidToken !== bidTokenFilter) return false;
        }
        
        // Advanced filter: price range
        if (minPriceFilter || maxPriceFilter) {
            const tokenInfo = getTokenInfo(offer.price_token_ledger.toString());
            const decimals = tokenInfo.decimals || 8;
            
            // Get the relevant price (min bid or buyout)
            const offerPrice = offer.min_bid_price[0] || offer.buyout_price[0];
            if (!offerPrice && (minPriceFilter || maxPriceFilter)) return false;
            
            const priceValue = Number(offerPrice) / Math.pow(10, decimals);
            
            if (minPriceFilter) {
                const minPrice = parseFloat(minPriceFilter);
                if (!isNaN(minPrice) && priceValue < minPrice) return false;
            }
            
            if (maxPriceFilter) {
                const maxPrice = parseFloat(maxPriceFilter);
                if (!isNaN(maxPrice) && priceValue > maxPrice) return false;
            }
        }
        
        // Advanced filter: asset token and amount
        if (assetTokenFilter || minAssetAmountFilter || maxAssetAmountFilter) {
            const hasMatchingAsset = offer.assets.some(a => {
                const type = getAssetType(a.asset);
                const details = getAssetDetails(a);
                
                // Helper to check amount range
                const checkAmountRange = (amount, decimals = 8) => {
                    if (!minAssetAmountFilter && !maxAssetAmountFilter) return true;
                    const amountValue = Number(amount) / Math.pow(10, decimals);
                    
                    if (minAssetAmountFilter) {
                        const minAmount = parseFloat(minAssetAmountFilter);
                        if (!isNaN(minAmount) && amountValue < minAmount) return false;
                    }
                    
                    if (maxAssetAmountFilter) {
                        const maxAmount = parseFloat(maxAssetAmountFilter);
                        if (!isNaN(maxAmount) && amountValue > maxAmount) return false;
                    }
                    
                    return true;
                };
                
                // For ICRC1Token assets, match ledger directly
                if (type === 'ICRC1Token') {
                    const tokenMatches = !assetTokenFilter || details.ledger_id === assetTokenFilter;
                    if (tokenMatches) {
                        const tokenInfo = getTokenInfo(details.ledger_id);
                        return checkAmountRange(details.amount, tokenInfo.decimals || 8);
                    }
                }
                
                // For SNS neurons, match if the SNS uses this token ledger
                if (type === 'SNSNeuron') {
                    const snsLedger = getSnsLedgerFromGovernance(details.governance_id);
                    const tokenMatches = !assetTokenFilter || snsLedger === assetTokenFilter;
                    if (tokenMatches) {
                        // Use cached stake if available, otherwise fall back to fetched data
                        let stakeValue = null;
                        if (details.cached_stake_e8s !== null) {
                            stakeValue = details.cached_stake_e8s / 1e8;
                        } else {
                            const neuronInfoKey = `${details.governance_id}_${details.neuron_id}`;
                            const nInfo = neuronInfo[neuronInfoKey];
                            if (nInfo && nInfo.stake !== undefined) {
                                stakeValue = nInfo.stake;
                            }
                        }
                        
                        if (stakeValue !== null) {
                            if (minAssetAmountFilter || maxAssetAmountFilter) {
                                if (minAssetAmountFilter) {
                                    const minAmount = parseFloat(minAssetAmountFilter);
                                    if (!isNaN(minAmount) && stakeValue < minAmount) return false;
                                }
                                if (maxAssetAmountFilter) {
                                    const maxAmount = parseFloat(maxAssetAmountFilter);
                                    if (!isNaN(maxAmount) && stakeValue > maxAmount) return false;
                                }
                            }
                            return true;
                        }
                        // If we don't have stake info yet but token matches, include it (amount filter won't apply)
                        return !minAssetAmountFilter && !maxAssetAmountFilter;
                    }
                }
                
                // For ICP Neuron Managers, match if ICP is selected
                if (type === 'Canister' && details.canister_kind === CANISTER_KIND_ICP_NEURON_MANAGER) {
                    const tokenMatches = !assetTokenFilter || assetTokenFilter === ICP_LEDGER_ID;
                    if (tokenMatches) {
                        // Use cached stake if available, otherwise fall back to fetched data
                        let totalValue = null;
                        if (details.cached_total_stake_e8s !== null) {
                            totalValue = details.cached_total_stake_e8s / 1e8;
                        } else {
                            const mInfo = neuronManagerInfo[details.canister_id];
                            if (mInfo && mInfo.totalIcp !== undefined) {
                                totalValue = mInfo.totalIcp;
                            }
                        }
                        
                        if (totalValue !== null) {
                            if (minAssetAmountFilter || maxAssetAmountFilter) {
                                if (minAssetAmountFilter) {
                                    const minAmount = parseFloat(minAssetAmountFilter);
                                    if (!isNaN(minAmount) && totalValue < minAmount) return false;
                                }
                                if (maxAssetAmountFilter) {
                                    const maxAmount = parseFloat(maxAssetAmountFilter);
                                    if (!isNaN(maxAmount) && totalValue > maxAmount) return false;
                                }
                            }
                            return true;
                        }
                        // If we don't have stake info yet but token matches, include it (amount filter won't apply)
                        return !minAssetAmountFilter && !maxAssetAmountFilter;
                    }
                }
                
                return false;
            });
            if (!hasMatchingAsset) return false;
        }
        
        // USD-based filters
        if (minPriceUsdFilter || maxPriceUsdFilter || minEstValueUsdFilter || maxEstValueUsdFilter || valueRatioFilter) {
            const paymentLedger = offer.price_token_ledger.toString();
            const paymentPrice = tokenPrices[paymentLedger];
            const tokenInfo = getTokenInfo(paymentLedger);
            
            // Calculate price in USD
            const offerPrice = offer.min_bid_price[0] || offer.buyout_price[0];
            const priceUsd = offerPrice && paymentPrice 
                ? calculateUsdValue(offerPrice, tokenInfo.decimals, paymentPrice) 
                : null;
            
            // Calculate estimated value
            const estimatedValue = getOfferEstimatedValue(offer);
            
            // Filter by price USD range
            if (minPriceUsdFilter && priceUsd !== null) {
                const minUsd = parseFloat(minPriceUsdFilter);
                if (!isNaN(minUsd) && priceUsd < minUsd) return false;
            }
            if (maxPriceUsdFilter && priceUsd !== null) {
                const maxUsd = parseFloat(maxPriceUsdFilter);
                if (!isNaN(maxUsd) && priceUsd > maxUsd) return false;
            }
            
            // Filter by estimated value USD range
            if (minEstValueUsdFilter && estimatedValue > 0) {
                const minUsd = parseFloat(minEstValueUsdFilter);
                if (!isNaN(minUsd) && estimatedValue < minUsd) return false;
            }
            if (maxEstValueUsdFilter && estimatedValue > 0) {
                const maxUsd = parseFloat(maxEstValueUsdFilter);
                if (!isNaN(maxUsd) && estimatedValue > maxUsd) return false;
            }
            
            // Filter by value/price ratio
            if (valueRatioFilter && priceUsd !== null && priceUsd > 0 && estimatedValue > 0) {
                const minRatio = parseFloat(valueRatioFilter);
                if (!isNaN(minRatio)) {
                    const actualRatio = (estimatedValue / priceUsd) * 100;
                    if (actualRatio < minRatio) return false;
                }
            }
        }
        
        return true;
    }).sort((a, b) => {
        const aBids = offersWithBids[Number(a.id)] || {};
        const bBids = offersWithBids[Number(b.id)] || {};
        
        switch (sortBy) {
            case 'newest': 
                return Number(b.created_at) - Number(a.created_at);
            case 'ending_soon': 
                if (!a.expiration[0]) return 1;
                if (!b.expiration[0]) return -1;
                return Number(a.expiration[0]) - Number(b.expiration[0]);
            case 'highest_bid':
                const aHighest = aBids.highest_bid?.amount || 0n;
                const bHighest = bBids.highest_bid?.amount || 0n;
                return Number(bHighest) - Number(aHighest);
            case 'lowest_price':
                const aPrice = a.min_bid_price[0] || a.buyout_price[0] || 0n;
                const bPrice = b.min_bid_price[0] || b.buyout_price[0] || 0n;
                return Number(aPrice) - Number(bPrice);
            default: return 0;
        }
    });
    
    // Paginate the filtered offers
    const paginatedOffers = useMemo(() => {
        const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
        return filteredOffers.slice(startIndex, startIndex + ITEMS_PER_PAGE);
    }, [filteredOffers, currentPage]);
    
    const totalPages = useMemo(() => Math.ceil(filteredOffers.length / ITEMS_PER_PAGE), [filteredOffers.length]);
    
    // Reset to page 1 when filters/search/tab change
    useEffect(() => {
        setCurrentPage(1);
    }, [filterType, searchOfferId, searchSellerPrincipal, sortBy, offerTab, bidTokenFilter, minPriceFilter, maxPriceFilter, assetTokenFilter, minAssetAmountFilter, maxAssetAmountFilter]);

    const styles = {
        container: {
            padding: '2rem',
            color: theme.colors.primaryText,
        },
        centeredContent: {
            maxWidth: '1400px',
            margin: '0 auto',
        },
        fullWidthGrid: {
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 380px), 1fr))',
            gap: '1.5rem',
            padding: '0',
            justifyItems: 'center',
        },
        header: {
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '2rem',
            flexWrap: 'wrap',
            gap: '1rem',
        },
        title: {
            fontSize: '2.5rem',
            fontWeight: '700',
            color: theme.colors.accent,
            margin: 0,
        },
        headerButtons: {
            display: 'flex',
            gap: '1rem',
        },
        createButton: {
            background: `linear-gradient(135deg, ${theme.colors.success}, ${theme.colors.success}cc)`,
            color: theme.colors.primaryBg,
            padding: '12px 24px',
            borderRadius: '10px',
            border: 'none',
            fontSize: '1rem',
            fontWeight: '600',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            textDecoration: 'none',
            transition: 'all 0.3s ease',
        },
        refreshButton: {
            background: theme.colors.tertiaryBg,
            color: theme.colors.primaryText,
            padding: '12px 16px',
            borderRadius: '10px',
            border: `1px solid ${theme.colors.border}`,
            fontSize: '1rem',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            transition: 'all 0.3s ease',
        },
        tabContainer: {
            display: 'flex',
            gap: '8px',
            marginBottom: '1.5rem',
            background: theme.colors.tertiaryBg,
            padding: '6px',
            borderRadius: '12px',
            width: 'fit-content',
            maxWidth: '100%',
            flexWrap: 'wrap',
        },
        tab: {
            padding: '10px 20px',
            borderRadius: '8px',
            border: 'none',
            background: 'transparent',
            color: theme.colors.mutedText,
            cursor: 'pointer',
            fontSize: '0.95rem',
            fontWeight: '500',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            transition: 'all 0.2s ease',
            flex: '1 1 auto',
            minWidth: '120px',
        },
        tabActive: {
            background: theme.colors.secondaryBg,
            color: theme.colors.primaryText,
            boxShadow: `0 2px 8px ${theme.colors.shadow}`,
        },
        controls: {
            display: 'flex',
            gap: '1rem',
            marginBottom: '2rem',
            flexWrap: 'wrap',
            alignItems: 'center',
        },
        searchBox: {
            flex: '1',
            minWidth: '250px',
            position: 'relative',
        },
        searchInput: {
            width: '100%',
            padding: '12px 16px 12px 44px',
            borderRadius: '10px',
            border: `1px solid ${theme.colors.border}`,
            background: theme.colors.secondaryBg,
            color: theme.colors.primaryText,
            fontSize: '1rem',
            outline: 'none',
            transition: 'border-color 0.3s ease',
            boxSizing: 'border-box',
        },
        searchIcon: {
            position: 'absolute',
            left: '14px',
            top: '50%',
            transform: 'translateY(-50%)',
            color: theme.colors.mutedText,
        },
        select: {
            padding: '12px 16px',
            borderRadius: '10px',
            border: `1px solid ${theme.colors.border}`,
            background: theme.colors.secondaryBg,
            color: theme.colors.primaryText,
            fontSize: '0.95rem',
            cursor: 'pointer',
            outline: 'none',
            minWidth: '150px',
            flex: '1 1 150px',
        },
        grid: {
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 380px), 1fr))',
            gap: '1.5rem',
            justifyItems: 'center',
        },
        card: {
            background: `linear-gradient(145deg, ${theme.colors.secondaryBg} 0%, ${theme.colors.primaryBg} 100%)`,
            border: `1px solid ${theme.colors.border}`,
            borderRadius: '20px',
            overflow: 'hidden',
            transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
            cursor: 'pointer',
            width: '100%',
            maxWidth: '450px',
            boxSizing: 'border-box',
            boxShadow: `0 4px 20px rgba(0,0,0,0.15)`,
        },
        cardHeaderSection: {
            background: `linear-gradient(135deg, ${sneedexPrimary}15, ${sneedexSecondary}08)`,
            padding: '1rem 1.25rem',
            borderBottom: `1px solid ${theme.colors.border}`,
        },
        cardHeader: {
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '0.75rem',
        },
        offerIdContainer: {
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            flex: 1,
            minWidth: 0,
        },
        offerId: {
            fontSize: '0.95rem',
            fontWeight: '700',
            color: sneedexPrimary,
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        },
        offerTitle: {
            fontSize: '0.85rem',
            fontWeight: '600',
            color: theme.colors.primaryText,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            opacity: 0.9,
        },
        cardBadge: {
            background: `linear-gradient(135deg, ${theme.colors.success}, ${theme.colors.success}dd)`,
            color: '#fff',
            padding: '5px 12px',
            borderRadius: '20px',
            fontSize: '0.7rem',
            fontWeight: '700',
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
            boxShadow: `0 2px 8px ${theme.colors.success}40`,
            flexShrink: 0,
        },
        cardBody: {
            padding: '1.25rem',
        },
        assetsRow: {
            display: 'flex',
            gap: '0.5rem',
            marginBottom: '1rem',
            flexWrap: 'wrap',
        },
        assetBadge: {
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            background: `linear-gradient(135deg, ${theme.colors.tertiaryBg}, ${theme.colors.secondaryBg})`,
            border: `1px solid ${theme.colors.border}`,
            padding: '8px 12px',
            borderRadius: '10px',
            fontSize: '0.85rem',
            fontWeight: '500',
            color: theme.colors.primaryText,
            transition: 'all 0.2s ease',
        },
        priceSection: {
            display: 'grid',
            gridTemplateColumns: 'repeat(2, 1fr)',
            gap: '0.75rem',
            marginBottom: '1rem',
        },
        priceItem: {
            background: theme.colors.primaryBg,
            border: `1px solid ${theme.colors.border}`,
            borderRadius: '12px',
            padding: '0.875rem',
            textAlign: 'center',
            transition: 'all 0.2s ease',
        },
        priceLabel: {
            fontSize: '0.7rem',
            color: theme.colors.mutedText,
            textTransform: 'uppercase',
            letterSpacing: '0.8px',
            fontWeight: '600',
            marginBottom: '6px',
        },
        priceValue: {
            fontSize: '1.15rem',
            fontWeight: '700',
            color: theme.colors.primaryText,
            lineHeight: 1.2,
        },
        priceToken: {
            fontSize: '0.8rem',
            color: theme.colors.mutedText,
            fontWeight: '500',
            marginTop: '2px',
        },
        cardFooter: {
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            paddingTop: '1rem',
            borderTop: `1px solid ${theme.colors.border}`,
            gap: '1rem',
        },
        timeInfo: {
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            fontSize: '0.85rem',
            color: theme.colors.mutedText,
            fontWeight: '500',
        },
        bidInfo: {
            textAlign: 'right',
            flex: 1,
        },
        bidCount: {
            fontSize: '0.8rem',
            color: theme.colors.mutedText,
            fontWeight: '500',
        },
        highestBid: {
            fontSize: '1.05rem',
            fontWeight: '700',
            color: theme.colors.success,
            marginTop: '2px',
        },
        emptyState: {
            textAlign: 'center',
            padding: '4rem 2rem',
            background: theme.colors.cardGradient,
            borderRadius: '16px',
            border: `1px solid ${theme.colors.border}`,
        },
        emptyIcon: {
            fontSize: '4rem',
            marginBottom: '1rem',
        },
        emptyTitle: {
            fontSize: '1.5rem',
            fontWeight: '600',
            color: theme.colors.primaryText,
            marginBottom: '0.5rem',
        },
        emptyText: {
            color: theme.colors.mutedText,
            marginBottom: '1.5rem',
        },
        loadingState: {
            textAlign: 'center',
            padding: '4rem 2rem',
            color: theme.colors.mutedText,
        },
        errorState: {
            textAlign: 'center',
            padding: '2rem',
            background: `${theme.colors.error || '#ff4444'}15`,
            border: `1px solid ${theme.colors.error || '#ff4444'}`,
            borderRadius: '12px',
            color: theme.colors.error || '#ff4444',
            marginBottom: '2rem',
        },
        pagination: {
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            gap: '1rem',
            marginTop: '2rem',
            paddingTop: '1.5rem',
            borderTop: `1px solid ${theme.colors.border}`,
            gridColumn: '1 / -1',
            flexWrap: 'wrap',
        },
        paginationButton: {
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '10px 16px',
            borderRadius: '8px',
            border: `1px solid ${theme.colors.border}`,
            background: theme.colors.secondaryBg,
            color: theme.colors.primaryText,
            fontSize: '0.9rem',
            fontWeight: '500',
            cursor: 'pointer',
            transition: 'all 0.2s ease',
        },
        paginationInfo: {
            color: theme.colors.mutedText,
            fontSize: '0.9rem',
        },
        advancedFilterToggle: {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            padding: '10px 16px',
            borderRadius: '10px',
            border: `1px solid ${theme.colors.border}`,
            background: theme.colors.secondaryBg,
            color: theme.colors.primaryText,
            fontSize: '0.9rem',
            fontWeight: '500',
            cursor: 'pointer',
            transition: 'all 0.2s ease',
            flex: '0 1 auto',
        },
        advancedFilterSection: {
            background: theme.colors.cardGradient,
            border: `1px solid ${theme.colors.border}`,
            borderRadius: '12px',
            padding: '1.5rem',
            marginBottom: '1.5rem',
            animation: 'fadeIn 0.2s ease',
        },
        advancedFilterHeader: {
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '1.25rem',
        },
        advancedFilterTitle: {
            fontSize: '1rem',
            fontWeight: '600',
            color: theme.colors.primaryText,
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
        },
        clearFiltersButton: {
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '6px 12px',
            borderRadius: '6px',
            border: 'none',
            background: `${theme.colors.error || '#ff4444'}20`,
            color: theme.colors.error || '#ff4444',
            fontSize: '0.8rem',
            fontWeight: '500',
            cursor: 'pointer',
            transition: 'all 0.2s ease',
        },
        advancedFilterGrid: {
            display: 'grid',
            gridTemplateColumns: 'repeat(2, 1fr)',
            gap: '1.5rem',
        },
        filterGroup: {
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
        },
        filterGroupWide: {
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            gridColumn: '1 / -1',
        },
        filterLabel: {
            fontSize: '0.85rem',
            fontWeight: '500',
            color: theme.colors.secondaryText,
        },
        filterLabelHint: {
            fontWeight: 'normal',
            color: theme.colors.mutedText,
            fontSize: '0.8rem',
        },
        filterInput: {
            padding: '10px 14px',
            borderRadius: '8px',
            border: `1px solid ${theme.colors.border}`,
            background: theme.colors.secondaryBg,
            color: theme.colors.primaryText,
            fontSize: '0.9rem',
            outline: 'none',
            transition: 'border-color 0.2s ease',
            width: '100%',
            boxSizing: 'border-box',
        },
        rangeInputsRow: {
            display: 'flex',
            gap: '8px',
            alignItems: 'center',
        },
        rangeSeparator: {
            color: theme.colors.mutedText,
            fontSize: '1rem',
            flexShrink: 0,
        },
        activeFilterBadge: {
            display: 'inline-flex',
            alignItems: 'center',
            gap: '4px',
            padding: '2px 8px',
            borderRadius: '10px',
            background: `${theme.colors.accent}30`,
            color: theme.colors.accent,
            fontSize: '0.75rem',
            fontWeight: '600',
        },
    };

    return (
        <div className='page-container' style={{ background: theme.colors.primaryGradient, minHeight: '100vh' }}>
            <Header />
            <main style={{ color: theme.colors.primaryText }}>
                {/* Hero Section */}
                <div style={{
                    background: `linear-gradient(180deg, ${sneedexPrimary}12 0%, transparent 100%)`,
                    borderBottom: `1px solid ${theme.colors.border}`,
                    padding: '2rem 1.5rem 1.5rem',
                    position: 'relative',
                    overflow: 'hidden'
                }}>
                    {/* Decorative glows */}
                    <div style={{
                        position: 'absolute',
                        top: '-50%',
                        right: '-10%',
                        width: '400px',
                        height: '400px',
                        background: `radial-gradient(circle, ${sneedexPrimary}20 0%, transparent 70%)`,
                        borderRadius: '50%',
                        pointerEvents: 'none'
                    }} />
                    <div style={{
                        position: 'absolute',
                        bottom: '-30%',
                        left: '-5%',
                        width: '300px',
                        height: '300px',
                        background: `radial-gradient(circle, ${sneedexSecondary}15 0%, transparent 70%)`,
                        borderRadius: '50%',
                        pointerEvents: 'none'
                    }} />
                    
                    <div style={{ maxWidth: '1400px', margin: '0 auto', position: 'relative', zIndex: 1 }}>
                        {/* Hero Content */}
                        <div style={{
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            textAlign: 'center',
                            marginBottom: '1.5rem'
                        }}>
                            {/* Icon and Title */}
                            <div style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '1rem',
                                marginBottom: '0.5rem'
                            }}>
                                <div 
                                    className="sneedex-hero-icon"
                                    style={{
                                        width: '56px',
                                        height: '56px',
                                        borderRadius: '16px',
                                        background: `linear-gradient(135deg, ${sneedexPrimary}, ${sneedexSecondary})`,
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        boxShadow: `0 4px 20px ${sneedexPrimary}40`
                                    }}
                                >
                                    <FaGavel size={26} color="white" />
                                </div>
                                <h1 style={{
                                    fontSize: '2rem',
                                    fontWeight: '800',
                                    margin: 0,
                                    background: `linear-gradient(135deg, ${theme.colors.primaryText} 30%, ${sneedexPrimary})`,
                                    WebkitBackgroundClip: 'text',
                                    WebkitTextFillColor: 'transparent',
                                    backgroundClip: 'text'
                                }}>
                                    Sneedex
                                </h1>
                            </div>
                            
                            <p style={{
                                color: theme.colors.mutedText,
                                fontSize: '0.95rem',
                                margin: 0,
                                maxWidth: '500px'
                            }}>
                                Trade ICP neurons, SNS neurons, canisters, and tokens
                            </p>
                        </div>
                        
                        {/* Action Buttons */}
                        <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '12px',
                            flexWrap: 'wrap',
                            marginBottom: '1.5rem'
                        }}>
                            <button
                                type="button"
                                className="sneedex-action-btn"
                                style={{
                                    background: theme.colors.tertiaryBg,
                                    color: theme.colors.primaryText,
                                    padding: '10px 18px',
                                    borderRadius: '10px',
                                    border: `1px solid ${theme.colors.border}`,
                                    fontSize: '0.9rem',
                                    fontWeight: '500',
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '8px',
                                }}
                                onClick={fetchOffers}
                                disabled={loading}
                            >
                                <FaSync style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
                                {loading ? 'Loading...' : 'Refresh'}
                            </button>
                            {isAuthenticated && (
                                <Link
                                    to="/sneedex_create"
                                    className="sneedex-action-btn"
                                    style={{
                                        background: `linear-gradient(135deg, ${sneedexPrimary}, ${sneedexSecondary})`,
                                        color: 'white',
                                        padding: '10px 18px',
                                        borderRadius: '10px',
                                        border: 'none',
                                        fontSize: '0.9rem',
                                        fontWeight: '600',
                                        textDecoration: 'none',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '8px',
                                        boxShadow: `0 4px 16px ${sneedexPrimary}30`
                                    }}
                                >
                                    <FaGavel /> Create Offer
                                </Link>
                            )}
                            <Link
                                to="/tools/sns_jailbreak"
                                className="sneedex-action-btn"
                                style={{
                                    background: `linear-gradient(135deg, ${theme.colors.success}, ${theme.colors.success}dd)`,
                                    color: 'white',
                                    padding: '10px 18px',
                                    borderRadius: '10px',
                                    border: 'none',
                                    fontSize: '0.9rem',
                                    fontWeight: '600',
                                    textDecoration: 'none',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '8px',
                                    boxShadow: `0 4px 16px ${theme.colors.success}30`
                                }}
                            >
                                <FaUnlock /> Jailbreak Wizard
                            </Link>
                        </div>
                        
                        {/* Public/Private tabs - centered */}
                        <div style={{
                            display: 'flex',
                            justifyContent: 'center'
                        }}>
                            <div className="sneedex-tab-container" style={{
                                display: 'flex',
                                gap: '4px',
                                background: theme.colors.tertiaryBg,
                                padding: '4px',
                                borderRadius: '12px',
                            }}>
                                <button
                                    type="button"
                                    style={{
                                        padding: '10px 20px',
                                        borderRadius: '8px',
                                        border: 'none',
                                        background: offerTab === 'public' ? theme.colors.secondaryBg : 'transparent',
                                        color: offerTab === 'public' ? theme.colors.primaryText : theme.colors.mutedText,
                                        cursor: 'pointer',
                                        fontSize: '0.9rem',
                                        fontWeight: '500',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '8px',
                                        transition: 'all 0.2s ease',
                                        boxShadow: offerTab === 'public' ? `0 2px 8px ${theme.colors.shadow}` : 'none',
                                    }}
                                    onClick={() => setOfferTab('public')}
                                >
                                    <FaGlobe /> Public Offers
                                </button>
                                <button
                                    type="button"
                                    style={{
                                        padding: '10px 20px',
                                        borderRadius: '8px',
                                        border: 'none',
                                        background: offerTab === 'private' ? theme.colors.secondaryBg : 'transparent',
                                        color: offerTab === 'private' ? theme.colors.primaryText : theme.colors.mutedText,
                                        cursor: 'pointer',
                                        fontSize: '0.9rem',
                                        fontWeight: '500',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '8px',
                                        transition: 'all 0.2s ease',
                                        boxShadow: offerTab === 'private' ? `0 2px 8px ${theme.colors.shadow}` : 'none',
                                        opacity: !isAuthenticated ? 0.5 : 1,
                                    }}
                                    onClick={() => setOfferTab('private')}
                                    disabled={!isAuthenticated}
                                    title={!isAuthenticated ? 'Connect wallet to view private offers' : ''}
                                >
                                    <FaLock /> Private (OTC)
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
                
                {/* Main Content Area */}
                <div style={{ padding: '1.5rem 2rem' }}>
                <div style={styles.centeredContent}>
                
                {error && (
                    <div style={styles.errorState}>
                        {error}
                    </div>
                )}
                
                <div className="sneedex-controls" style={styles.controls}>
                    <button
                        type="button"
                        style={{
                            ...styles.advancedFilterToggle,
                            borderColor: showAdvancedFilters ? theme.colors.accent : theme.colors.border,
                            background: hasActiveFilters ? `${theme.colors.accent}15` : theme.colors.secondaryBg,
                        }}
                        onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
                    >
                        <FaFilter />
                        Filters
                        {hasActiveFilters && (
                            <span style={styles.activeFilterBadge}>
                                {[filterType !== 'all', bidTokenFilter, minPriceFilter || maxPriceFilter, assetTokenFilter, minAssetAmountFilter || maxAssetAmountFilter, searchOfferId, searchSellerPrincipal].filter(Boolean).length}
                            </span>
                        )}
                        {showAdvancedFilters ? <FaChevronUp size={12} /> : <FaChevronDown size={12} />}
                    </button>
                    <select
                        style={styles.select}
                        value={sortBy}
                        onChange={(e) => setSortBy(e.target.value)}
                        title="Sort order"
                    >
                        <option value="newest">Newest First</option>
                        <option value="ending_soon">Ending Soon</option>
                        <option value="highest_bid">Highest Bid</option>
                        <option value="lowest_price">Lowest Price</option>
                    </select>
                    
                    {/* Active Only Toggle */}
                    <label style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px',
                        cursor: 'pointer',
                        padding: '10px 16px',
                        borderRadius: '10px',
                        border: `1px solid ${theme.colors.border}`,
                        background: theme.colors.secondaryBg,
                        fontSize: '0.9rem',
                        fontWeight: '500',
                        color: theme.colors.primaryText,
                        whiteSpace: 'nowrap',
                    }}>
                        <span style={{ color: showInactiveOffers ? theme.colors.mutedText : theme.colors.primaryText }}>
                            Active Only
                        </span>
                        <div 
                            onClick={() => setShowInactiveOffers(prev => !prev)}
                            style={{
                                width: '44px',
                                height: '24px',
                                borderRadius: '12px',
                                background: showInactiveOffers ? theme.colors.tertiaryBg : sneedexPrimary,
                                position: 'relative',
                                transition: 'all 0.2s ease',
                                cursor: 'pointer',
                            }}
                        >
                            <div style={{
                                width: '18px',
                                height: '18px',
                                borderRadius: '50%',
                                background: '#fff',
                                position: 'absolute',
                                top: '3px',
                                left: showInactiveOffers ? '3px' : '23px',
                                transition: 'all 0.2s ease',
                                boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
                            }} />
                        </div>
                    </label>
                </div>
                
                {/* Filters Section */}
                {showAdvancedFilters && (
                    <div style={styles.advancedFilterSection}>
                        <div style={styles.advancedFilterHeader}>
                            <div style={styles.advancedFilterTitle}>
                                <FaFilter /> Search & Filter
                            </div>
                            {hasActiveFilters && (
                                <button
                                    style={styles.clearFiltersButton}
                                    onClick={clearAllFilters}
                                >
                                    <FaTimes size={12} /> Clear All
                                </button>
                            )}
                        </div>
                        
                        <div className="sneedex-advanced-filter-grid" style={styles.advancedFilterGrid}>
                            {/* Asset Type Filter */}
                            <div style={styles.filterGroup}>
                                <label style={styles.filterLabel}>Asset Type</label>
                                <select
                                    style={{ ...styles.filterInput, padding: '10px 12px' }}
                                    value={filterType}
                                    onChange={(e) => setFilterType(e.target.value)}
                                >
                                    <option value="all">All Assets</option>
                                    <option value="canister">Canisters</option>
                                    <option value="neuron_manager">ICP Neuron Managers</option>
                                    <option value="neuron">SNS Neurons</option>
                                    <option value="token">ICRC1 Tokens</option>
                                </select>
                            </div>
                            
                            {/* Payment Token Filter */}
                            <div style={styles.filterGroup}>
                                <label style={styles.filterLabel}>Payment Token <span style={styles.filterLabelHint}>(Bid Currency)</span></label>
                                <TokenSelector
                                    value={bidTokenFilter}
                                    onChange={(ledgerId) => setBidTokenFilter(ledgerId)}
                                    placeholder="Any token..."
                                    style={{ width: '100%' }}
                                    allowCustom={true}
                                />
                                {bidTokenFilter && (
                                    <button
                                        onClick={() => setBidTokenFilter('')}
                                        style={{
                                            ...styles.clearFiltersButton,
                                            alignSelf: 'flex-start',
                                            marginTop: '4px',
                                        }}
                                    >
                                        <FaTimes size={10} /> Clear
                                    </button>
                                )}
                            </div>
                            
                            {/* Price Range Filter */}
                            <div style={styles.filterGroup}>
                                <label style={styles.filterLabel}>Price Range <span style={styles.filterLabelHint}>(Min Bid / Buyout)</span></label>
                                <div style={styles.rangeInputsRow}>
                                    <input
                                        type="number"
                                        placeholder="Min"
                                        value={minPriceFilter}
                                        onChange={(e) => setMinPriceFilter(e.target.value)}
                                        style={styles.filterInput}
                                        min="0"
                                        step="any"
                                        onFocus={(e) => e.target.style.borderColor = theme.colors.accent}
                                        onBlur={(e) => e.target.style.borderColor = theme.colors.border}
                                    />
                                    <span style={styles.rangeSeparator}>–</span>
                                    <input
                                        type="number"
                                        placeholder="Max"
                                        value={maxPriceFilter}
                                        onChange={(e) => setMaxPriceFilter(e.target.value)}
                                        style={styles.filterInput}
                                        min="0"
                                        step="any"
                                        onFocus={(e) => e.target.style.borderColor = theme.colors.accent}
                                        onBlur={(e) => e.target.style.borderColor = theme.colors.border}
                                    />
                                </div>
                            </div>
                            
                            {/* Asset Token Filter */}
                            <div style={styles.filterGroup}>
                                <label style={styles.filterLabel}>
                                    Asset Token <span style={styles.filterLabelHint}></span>
                                </label>
                                <TokenSelector
                                    value={assetTokenFilter}
                                    onChange={(ledgerId) => setAssetTokenFilter(ledgerId)}
                                    placeholder="Any asset token..."
                                    style={{ width: '100%' }}
                                    allowCustom={true}
                                />
                                {assetTokenFilter && (
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px' }}>
                                        <button
                                            onClick={() => {
                                                setAssetTokenFilter('');
                                                setMinAssetAmountFilter('');
                                                setMaxAssetAmountFilter('');
                                            }}
                                            style={styles.clearFiltersButton}
                                        >
                                            <FaTimes size={10} /> Clear
                                        </button>
                                        {assetTokenFilter === ICP_LEDGER_ID && (
                                            <span style={{ fontSize: '0.75rem', color: theme.colors.mutedText }}>
                                                Includes ICP Neuron Managers
                                            </span>
                                        )}
                                    </div>
                                )}
                            </div>
                            
                            {/* Asset Amount Range Filter */}
                            <div style={styles.filterGroup}>
                                <label style={styles.filterLabel}>Asset Amount <span style={styles.filterLabelHint}>(Token amount / Stake)</span></label>
                                <div style={styles.rangeInputsRow}>
                                    <input
                                        type="number"
                                        placeholder="Min"
                                        value={minAssetAmountFilter}
                                        onChange={(e) => setMinAssetAmountFilter(e.target.value)}
                                        style={styles.filterInput}
                                        min="0"
                                        step="any"
                                        onFocus={(e) => e.target.style.borderColor = theme.colors.accent}
                                        onBlur={(e) => e.target.style.borderColor = theme.colors.border}
                                    />
                                    <span style={styles.rangeSeparator}>–</span>
                                    <input
                                        type="number"
                                        placeholder="Max"
                                        value={maxAssetAmountFilter}
                                        onChange={(e) => setMaxAssetAmountFilter(e.target.value)}
                                        style={styles.filterInput}
                                        min="0"
                                        step="any"
                                        onFocus={(e) => e.target.style.borderColor = theme.colors.accent}
                                        onBlur={(e) => e.target.style.borderColor = theme.colors.border}
                                    />
                                </div>
                            </div>
                            
                            {/* USD Price Range Filter */}
                            <div style={styles.filterGroup}>
                                <label style={styles.filterLabel}>Price in USD <span style={styles.filterLabelHint}>($ value)</span></label>
                                <div style={styles.rangeInputsRow}>
                                    <input
                                        type="number"
                                        placeholder="Min $"
                                        value={minPriceUsdFilter}
                                        onChange={(e) => setMinPriceUsdFilter(e.target.value)}
                                        style={styles.filterInput}
                                        min="0"
                                        step="any"
                                        onFocus={(e) => e.target.style.borderColor = theme.colors.accent}
                                        onBlur={(e) => e.target.style.borderColor = theme.colors.border}
                                    />
                                    <span style={styles.rangeSeparator}>–</span>
                                    <input
                                        type="number"
                                        placeholder="Max $"
                                        value={maxPriceUsdFilter}
                                        onChange={(e) => setMaxPriceUsdFilter(e.target.value)}
                                        style={styles.filterInput}
                                        min="0"
                                        step="any"
                                        onFocus={(e) => e.target.style.borderColor = theme.colors.accent}
                                        onBlur={(e) => e.target.style.borderColor = theme.colors.border}
                                    />
                                </div>
                            </div>
                            
                            {/* USD Estimated Value Range Filter */}
                            <div style={styles.filterGroup}>
                                <label style={styles.filterLabel}>Est. Value in USD <span style={styles.filterLabelHint}>($ value)</span></label>
                                <div style={styles.rangeInputsRow}>
                                    <input
                                        type="number"
                                        placeholder="Min $"
                                        value={minEstValueUsdFilter}
                                        onChange={(e) => setMinEstValueUsdFilter(e.target.value)}
                                        style={styles.filterInput}
                                        min="0"
                                        step="any"
                                        onFocus={(e) => e.target.style.borderColor = theme.colors.accent}
                                        onBlur={(e) => e.target.style.borderColor = theme.colors.border}
                                    />
                                    <span style={styles.rangeSeparator}>–</span>
                                    <input
                                        type="number"
                                        placeholder="Max $"
                                        value={maxEstValueUsdFilter}
                                        onChange={(e) => setMaxEstValueUsdFilter(e.target.value)}
                                        style={styles.filterInput}
                                        min="0"
                                        step="any"
                                        onFocus={(e) => e.target.style.borderColor = theme.colors.accent}
                                        onBlur={(e) => e.target.style.borderColor = theme.colors.border}
                                    />
                                </div>
                            </div>
                            
                            {/* Value/Price Ratio Filter */}
                            <div style={styles.filterGroup}>
                                <label style={styles.filterLabel}>
                                    Value/Price Ratio 
                                    <span style={styles.filterLabelHint}> (Min %)</span>
                                </label>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <input
                                        type="number"
                                        placeholder="e.g., 100"
                                        value={valueRatioFilter}
                                        onChange={(e) => setValueRatioFilter(e.target.value)}
                                        style={{ ...styles.filterInput, flex: 1 }}
                                        min="0"
                                        step="1"
                                        onFocus={(e) => e.target.style.borderColor = theme.colors.accent}
                                        onBlur={(e) => e.target.style.borderColor = theme.colors.border}
                                    />
                                    <span style={{ color: theme.colors.mutedText, fontSize: '0.85rem' }}>%</span>
                                </div>
                                <div style={{ fontSize: '0.75rem', color: theme.colors.mutedText, marginTop: '4px' }}>
                                    100% = value ≥ price, 110% = 10% better value
                                </div>
                            </div>
                            
                            {/* Search by Offer ID */}
                            <div style={styles.filterGroup}>
                                <label style={styles.filterLabel}>
                                    <FaSearch size={12} style={{ marginRight: '6px' }} />
                                    Search by Offer ID
                                </label>
                                <input
                                    type="text"
                                    placeholder="Enter offer ID..."
                                    value={searchOfferId}
                                    onChange={(e) => setSearchOfferId(e.target.value)}
                                    style={styles.filterInput}
                                    onFocus={(e) => e.target.style.borderColor = theme.colors.accent}
                                    onBlur={(e) => e.target.style.borderColor = theme.colors.border}
                                />
                            </div>
                            
                            {/* Search by Seller */}
                            <div style={styles.filterGroup}>
                                <label style={styles.filterLabel}>
                                    <FaSearch size={12} style={{ marginRight: '6px' }} />
                                    Search by Seller
                                </label>
                                <PrincipalInput
                                    value={searchSellerPrincipal}
                                    onChange={setSearchSellerPrincipal}
                                    placeholder="Enter principal ID or search by name"
                                    style={{ width: '100%' }}
                                    isAuthenticated={isAuthenticated}
                                />
                            </div>
                        </div>
                    </div>
                )}
                </div>
                {/* End centered content */}
                </div>
                {/* End main content padding wrapper */}
                
                {/* Offers section */}
                <div style={{ padding: '0 2rem 2rem' }}>
                {loading && offers.length === 0 ? (
                    <div style={{ ...styles.centeredContent, ...styles.loadingState }}>
                        <div style={{ fontSize: '2rem', marginBottom: '1rem' }}>⏳</div>
                        Loading offers...
                    </div>
                ) : filteredOffers.length === 0 ? (
                    <div style={{ ...styles.centeredContent, ...styles.emptyState }}>
                        <div style={styles.emptyIcon}>{offerTab === 'public' ? '📭' : '🔐'}</div>
                        <h3 style={styles.emptyTitle}>
                            {offerTab === 'public' ? 'No Public Offers' : 'No Private Offers'}
                        </h3>
                        <p style={styles.emptyText}>
                            {offerTab === 'public' 
                                ? 'There are no public offers matching your criteria. Be the first to create one!'
                                : isAuthenticated 
                                    ? 'You have no private offers available. Private offers are only visible to you if you created them or were added as an approved bidder.'
                                    : 'Connect your wallet to view private offers where you are an approved bidder.'
                            }
                        </p>
                        {isAuthenticated && (
                            <Link to="/sneedex_create" style={styles.createButton}>
                                <FaGavel /> Create Offer
                            </Link>
                        )}
                    </div>
                ) : (
                    <>
                        {/* Top Pagination - centered */}
                        {filteredOffers.length > ITEMS_PER_PAGE && (
                            <div style={{ ...styles.centeredContent, ...styles.pagination, marginTop: 0, paddingTop: 0, borderTop: 'none', marginBottom: '1.5rem', paddingBottom: '1rem', borderBottom: `1px solid ${theme.colors.border}` }}>
                                <button
                                    style={{
                                        ...styles.paginationButton,
                                        opacity: currentPage === 1 ? 0.5 : 1,
                                        cursor: currentPage === 1 ? 'not-allowed' : 'pointer'
                                    }}
                                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                                    disabled={currentPage === 1}
                                >
                                    <FaChevronLeft /> Previous
                                </button>
                                <span style={styles.paginationInfo}>
                                    Page {currentPage} of {totalPages} ({filteredOffers.length} offers)
                                </span>
                                <button
                                    style={{
                                        ...styles.paginationButton,
                                        opacity: currentPage === totalPages ? 0.5 : 1,
                                        cursor: currentPage === totalPages ? 'not-allowed' : 'pointer'
                                    }}
                                    onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                                    disabled={currentPage === totalPages}
                                >
                                    Next <FaChevronRight />
                                </button>
                            </div>
                        )}
                        
                        {/* Full-width grid */}
                        <div style={styles.fullWidthGrid}>
                        {paginatedOffers.map((offer) => {
                            const bidInfo = offersWithBids[Number(offer.id)] || {};
                            const tokenInfo = getTokenInfo(offer.price_token_ledger.toString());
                            const paymentTokenPrice = tokenPrices[offer.price_token_ledger.toString()];
                            
                            // Calculate estimated asset value
                            const estimatedValue = getOfferEstimatedValue(offer);
                            
                            // Calculate prices in USD
                            const minBidUsd = offer.min_bid_price[0] && paymentTokenPrice
                                ? calculateUsdValue(offer.min_bid_price[0], tokenInfo.decimals, paymentTokenPrice)
                                : null;
                            const buyoutUsd = offer.buyout_price[0] && paymentTokenPrice
                                ? calculateUsdValue(offer.buyout_price[0], tokenInfo.decimals, paymentTokenPrice)
                                : null;
                            const highestBidUsd = bidInfo.highest_bid?.amount && paymentTokenPrice
                                ? calculateUsdValue(bidInfo.highest_bid.amount, tokenInfo.decimals, paymentTokenPrice)
                                : null;
                            
                            // Determine if this is a "good deal"
                            // Compare asset value against current effective price (what you'd pay now)
                            // - If there are bids: compare vs current highest bid
                            // - If no bids: compare vs minimum bid price
                            const currentEffectivePrice = highestBidUsd || minBidUsd;
                            const isGoodDeal = estimatedValue > 0 && currentEffectivePrice && estimatedValue > currentEffectivePrice;
                            
                            // Check if there's exactly one canister asset with a title
                            const canisterAssets = offer.assets.filter(a => a.asset && a.asset.Canister);
                            const singleCanisterTitle = canisterAssets.length === 1 && 
                                canisterAssets[0].asset.Canister.title && 
                                canisterAssets[0].asset.Canister.title[0]
                                    ? canisterAssets[0].asset.Canister.title[0]
                                    : null;
                            
                            return (
                                <div
                                    key={Number(offer.id)}
                                    style={{...styles.card, position: 'relative'}}
                                    onClick={() => navigate(`/sneedex_offer/${offer.id}`)}
                                    onMouseEnter={(e) => {
                                        e.currentTarget.style.transform = 'translateY(-6px)';
                                        e.currentTarget.style.borderColor = sneedexPrimary;
                                        e.currentTarget.style.boxShadow = `0 20px 50px rgba(0,0,0,0.25), 0 0 0 1px ${sneedexPrimary}30`;
                                    }}
                                    onMouseLeave={(e) => {
                                        e.currentTarget.style.transform = 'translateY(0)';
                                        e.currentTarget.style.borderColor = theme.colors.border;
                                        e.currentTarget.style.boxShadow = '0 4px 20px rgba(0,0,0,0.15)';
                                    }}
                                >
                                    {/* Status Banner for inactive offers */}
                                    {(() => {
                                        let bannerText = null;
                                        let bannerColor = null;
                                        
                                        if ('Completed' in offer.state || 'Claimed' in offer.state) {
                                            bannerText = 'SOLD';
                                            bannerColor = 'linear-gradient(135deg, #22c55e, #16a34a)';
                                        } else if ('Expired' in offer.state) {
                                            bannerText = 'EXPIRED';
                                            bannerColor = 'linear-gradient(135deg, #6b7280, #4b5563)';
                                        } else if ('Cancelled' in offer.state) {
                                            bannerText = 'CANCELLED';
                                            bannerColor = 'linear-gradient(135deg, #f59e0b, #d97706)';
                                        } else if ('Reclaimed' in offer.state) {
                                            bannerText = 'EXPIRED';
                                            bannerColor = 'linear-gradient(135deg, #6b7280, #4b5563)';
                                        }
                                        
                                        return bannerText ? (
                                            <div style={{
                                                position: 'absolute',
                                                top: '18px',
                                                right: '-30px',
                                                background: bannerColor,
                                                color: '#fff',
                                                padding: '5px 45px',
                                                fontWeight: '700',
                                                fontSize: '0.6rem',
                                                transform: 'rotate(45deg)',
                                                boxShadow: '0 2px 10px rgba(0,0,0,0.4)',
                                                zIndex: 10,
                                                letterSpacing: '0.8px',
                                                textTransform: 'uppercase',
                                            }}>
                                                {bannerText}
                                            </div>
                                        ) : null;
                                    })()}
                                    
                                    {/* Card Header Section */}
                                    <div style={styles.cardHeaderSection}>
                                        <div style={styles.cardHeader}>
                                            <div style={styles.offerIdContainer}>
                                                <span style={styles.offerId}>#{Number(offer.id)}</span>
                                                {singleCanisterTitle && (
                                                    <span style={styles.offerTitle}>
                                                        {singleCanisterTitle}
                                                    </span>
                                                )}
                                                {offer.approved_bidders && offer.approved_bidders[0] && offer.approved_bidders[0].length > 0 && (
                                                    <span style={{
                                                        display: 'inline-flex',
                                                        alignItems: 'center',
                                                        gap: '3px',
                                                        background: `linear-gradient(135deg, ${theme.colors.warning}25, ${theme.colors.warning}15)`,
                                                        color: theme.colors.warning,
                                                        padding: '3px 8px',
                                                        borderRadius: '6px',
                                                        fontSize: '0.7rem',
                                                        fontWeight: '600',
                                                        border: `1px solid ${theme.colors.warning}30`,
                                                    }}>
                                                        <FaLock size={8} />
                                                        {offer.approved_bidders[0].length}
                                                    </span>
                                                )}
                                            </div>
                                            <span style={{
                                                ...styles.cardBadge,
                                                background: 'Active' in offer.state 
                                                    ? `linear-gradient(135deg, ${theme.colors.success}, ${theme.colors.success}dd)`
                                                    : ('Completed' in offer.state || 'Claimed' in offer.state)
                                                        ? `linear-gradient(135deg, ${sneedexPrimary}, ${sneedexSecondary})`
                                                        : `linear-gradient(135deg, ${theme.colors.mutedText}, ${theme.colors.mutedText}dd)`,
                                                boxShadow: 'Active' in offer.state 
                                                    ? `0 2px 8px ${theme.colors.success}40`
                                                    : ('Completed' in offer.state || 'Claimed' in offer.state)
                                                        ? `0 2px 8px ${sneedexPrimary}40`
                                                        : 'none',
                                            }}>
                                                {getOfferStateString(offer.state)}
                                            </span>
                                        </div>
                                    </div>
                                    
                                    {/* Card Body */}
                                    <div style={styles.cardBody}>
                                    
                                    <div style={styles.assetsRow}>
                                        {offer.assets.map((assetEntry, idx) => {
                                            const details = getAssetDetails(assetEntry);
                                            
                                            // Get token info for ICRC1Token assets
                                            const assetTokenInfo = details.type === 'ICRC1Token' 
                                                ? getTokenInfo(details.ledger_id)
                                                : null;
                                            
                                            // Get SNS info for SNSNeuron assets
                                            const snsInfo = details.type === 'SNSNeuron'
                                                ? getSnsInfo(details.governance_id)
                                                : null;
                                            const snsLogo = details.type === 'SNSNeuron'
                                                ? snsLogos.get(details.governance_id)
                                                : null;
                                            const neuronInfoKey = details.type === 'SNSNeuron' && details.neuron_id
                                                ? `${details.governance_id}_${details.neuron_id}`
                                                : null;
                                            const nInfo = neuronInfoKey ? neuronInfo[neuronInfoKey] : null;
                                            
                                            // Generate tooltip text based on asset type
                                            const getTooltip = () => {
                                                if (details.type === 'Canister' && details.canister_kind === CANISTER_KIND_ICP_NEURON_MANAGER) {
                                                    const titleLine = details.title ? `${details.title}\n` : '';
                                                    // Use cached value if available
                                                    if (details.cached_total_stake_e8s !== null) {
                                                        return `${titleLine}ICP Neuron Manager\nCanister: ${details.canister_id}\nStaked: ${(details.cached_total_stake_e8s / 1e8).toFixed(4)} ICP`;
                                                    }
                                                    const mInfo = neuronManagerInfo[details.canister_id];
                                                    if (mInfo) {
                                                        return `${titleLine}ICP Neuron Manager\nCanister: ${details.canister_id}\n\nStake: ${mInfo.totalStake.toFixed(4)} ICP\nMaturity: ${mInfo.totalMaturity.toFixed(4)} ICP\nStaked Maturity: ${mInfo.totalStakedMaturity.toFixed(4)} ICP\nTotal: ${mInfo.totalIcp.toFixed(4)} ICP\n\nNeurons: ${mInfo.neuronCount}`;
                                                    }
                                                    return `${titleLine}ICP Neuron Manager\nCanister: ${details.canister_id}`;
                                                }
                                                if (details.type === 'Canister') {
                                                    const titleLine = details.title ? `${details.title}\n` : '';
                                                    return `${titleLine}Canister: ${details.canister_id}`;
                                                }
                                                if (details.type === 'SNSNeuron') {
                                                    // Use cached stake if available, otherwise fall back to fetched data
                                                    const stakeValue = details.cached_stake_e8s !== null 
                                                        ? (details.cached_stake_e8s / 1e8)
                                                        : nInfo?.stake;
                                                    const stakeText = stakeValue !== undefined ? `\nStake: ${stakeValue.toFixed(4)} ${snsInfo?.symbol || 'tokens'}` : '';
                                                    return `${snsInfo?.name || 'SNS'} Neuron\nGovernance: ${details.governance_id}\nNeuron ID: ${details.neuron_id?.slice(0, 16)}...${stakeText}`;
                                                }
                                                if (details.type === 'ICRC1Token') {
                                                    return `${assetTokenInfo?.name || assetTokenInfo?.symbol || 'Token'}\nLedger: ${details.ledger_id}\nAmount: ${formatAmount(details.amount, assetTokenInfo?.decimals || 8)} ${assetTokenInfo?.symbol || 'tokens'}`;
                                                }
                                                return '';
                                            };
                                            
                                            return (
                                                <span key={idx} style={styles.assetBadge} title={getTooltip()}>
                                                    {details.type === 'Canister' && details.canister_kind === CANISTER_KIND_ICP_NEURON_MANAGER && (
                                                        <>
                                                            <span style={{ position: 'relative', display: 'inline-flex', marginRight: '2px' }}>
                                                                <FaRobot style={{ color: theme.colors.accent, fontSize: '16px' }} />
                                                                <img 
                                                                    src="/icp_symbol.svg" 
                                                                    alt="ICP" 
                                                                    style={{ 
                                                                        width: 12, 
                                                                        height: 12, 
                                                                        borderRadius: '50%',
                                                                        position: 'absolute',
                                                                        bottom: -2,
                                                                        right: -4,
                                                                        border: `1px solid ${theme.colors.tertiaryBg}`,
                                                                        background: theme.colors.tertiaryBg,
                                                                    }}
                                                                />
                                                            </span>
                                                            {/* Use cached value if available, otherwise fall back to fetched data */}
                                                            {details.cached_total_stake_e8s !== null
                                                                ? `${(details.cached_total_stake_e8s / 1e8).toFixed(2)} ICP`
                                                                : neuronManagerInfo[details.canister_id] 
                                                                    ? `${neuronManagerInfo[details.canister_id].totalIcp.toFixed(2)} ICP`
                                                                    : details.escrowed 
                                                                        ? 'Loading...'
                                                                        : 'Neuron Manager'
                                                            }
                                                        </>
                                                    )}
                                                    {details.type === 'Canister' && details.canister_kind !== CANISTER_KIND_ICP_NEURON_MANAGER && (
                                                        <>
                                                            <FaCubes style={{ color: theme.colors.accent }} />
                                                            {details.title 
                                                                ? (details.title.length > 12 
                                                                    ? details.title.slice(0, 12) + '…' 
                                                                    : details.title)
                                                                : 'Canister'
                                                            }
                                                        </>
                                                    )}
                                                    {details.type === 'SNSNeuron' && (
                                                        <>
                                                            <span style={{ position: 'relative', display: 'inline-flex', marginRight: '2px' }}>
                                                                <FaBrain style={{ color: theme.colors.success, fontSize: '16px' }} />
                                                                {snsLogo && (
                                                                    <img 
                                                                        src={snsLogo} 
                                                                        alt={snsInfo?.name || 'SNS'} 
                                                                        style={{ 
                                                                            width: 12, 
                                                                            height: 12, 
                                                                            borderRadius: '50%',
                                                                            position: 'absolute',
                                                                            bottom: -2,
                                                                            right: -4,
                                                                            border: `1px solid ${theme.colors.tertiaryBg}`,
                                                                        }}
                                                                    />
                                                                )}
                                                            </span>
                                                            {/* Use cached stake if available, otherwise fall back to fetched data */}
                                                            {details.cached_stake_e8s !== null
                                                                ? `${(details.cached_stake_e8s / 1e8).toFixed(2)} ${snsInfo?.symbol || 'Neuron'}`
                                                                : nInfo 
                                                                    ? `${nInfo.stake.toFixed(2)} ${snsInfo?.symbol || 'Neuron'}` 
                                                                    : snsInfo?.symbol || 'Neuron'
                                                            }
                                                        </>
                                                    )}
                                                    {details.type === 'ICRC1Token' && (
                                                        <>
                                                            {assetTokenInfo?.logo ? (
                                                                <img 
                                                                    src={assetTokenInfo.logo} 
                                                                    alt={assetTokenInfo?.symbol || 'Token'} 
                                                                    style={{ width: 18, height: 18, borderRadius: '50%' }}
                                                                    onError={(e) => { e.target.style.display = 'none'; }}
                                                                />
                                                            ) : (
                                                                <FaCoins style={{ color: theme.colors.warning }} />
                                                            )}
                                                            {formatAmount(details.amount, assetTokenInfo?.decimals || 8)} {assetTokenInfo?.symbol || 'TOKEN'}
                                                        </>
                                                    )}
                                                </span>
                                            );
                                        })}
                                    </div>
                                    
                                    <div style={styles.priceSection}>
                                        <div style={{
                                            ...styles.priceItem,
                                            background: `linear-gradient(135deg, ${theme.colors.primaryBg}, ${sneedexPrimary}05)`,
                                        }}>
                                            <div style={{
                                                ...styles.priceLabel,
                                                color: sneedexPrimary,
                                            }}>Min Bid</div>
                                            <div style={styles.priceValue}>
                                                {offer.min_bid_price[0] ? formatAmount(offer.min_bid_price[0], tokenInfo.decimals) : '—'}
                                            </div>
                                            <div style={styles.priceToken}>{tokenInfo.symbol}</div>
                                            {minBidUsd > 0 && (
                                                <div style={{ 
                                                    fontSize: '0.75rem', 
                                                    color: theme.colors.mutedText, 
                                                    marginTop: '4px',
                                                    fontWeight: '500',
                                                }}>
                                                    {formatUsd(minBidUsd)}
                                                </div>
                                            )}
                                        </div>
                                        <div style={{
                                            ...styles.priceItem,
                                            background: `linear-gradient(135deg, ${theme.colors.primaryBg}, ${theme.colors.success}08)`,
                                        }}>
                                            <div style={{
                                                ...styles.priceLabel,
                                                color: theme.colors.success,
                                            }}>Buyout</div>
                                            <div style={{
                                                ...styles.priceValue,
                                                color: offer.buyout_price[0] ? theme.colors.success : theme.colors.mutedText,
                                            }}>
                                                {offer.buyout_price[0] ? formatAmount(offer.buyout_price[0], tokenInfo.decimals) : '—'}
                                            </div>
                                            <div style={styles.priceToken}>{tokenInfo.symbol}</div>
                                            {buyoutUsd > 0 && (
                                                <div style={{ 
                                                    fontSize: '0.75rem', 
                                                    color: theme.colors.mutedText, 
                                                    marginTop: '4px',
                                                    fontWeight: '500',
                                                }}>
                                                    {formatUsd(buyoutUsd)}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                    
                                    {/* Estimated Value and Good Deal badge */}
                                    {estimatedValue > 0 && (
                                        <div style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            gap: '10px',
                                            marginBottom: '0.875rem',
                                            padding: '8px 12px',
                                            background: isGoodDeal 
                                                ? `linear-gradient(135deg, ${theme.colors.success}18, ${theme.colors.success}08)`
                                                : `linear-gradient(135deg, ${sneedexPrimary}12, ${sneedexPrimary}06)`,
                                            borderRadius: '10px',
                                            border: `1px solid ${isGoodDeal ? theme.colors.success : sneedexPrimary}20`,
                                        }}>
                                            <span style={{ 
                                                color: theme.colors.mutedText, 
                                                fontSize: '0.8rem',
                                                fontWeight: '500'
                                            }}>
                                                Est. Value: <strong style={{ 
                                                    color: isGoodDeal ? theme.colors.success : theme.colors.primaryText,
                                                    fontWeight: '700'
                                                }}>{formatUsd(estimatedValue)}</strong>
                                            </span>
                                            {isGoodDeal && (
                                                <span style={{
                                                    background: `linear-gradient(135deg, ${theme.colors.success}, ${theme.colors.success}dd)`,
                                                    color: '#fff',
                                                    padding: '4px 10px',
                                                    borderRadius: '6px',
                                                    fontWeight: '700',
                                                    fontSize: '0.65rem',
                                                    letterSpacing: '0.3px',
                                                    boxShadow: `0 2px 8px ${theme.colors.success}40`,
                                                }}>
                                                    🔥 GOOD DEAL
                                                </span>
                                            )}
                                        </div>
                                    )}
                                    {offer.min_bid_increment_fee_multiple?.[0] && tokenInfo.fee && (
                                        <div style={{ 
                                            fontSize: '0.75rem', 
                                            color: theme.colors.mutedText,
                                            marginBottom: '0.875rem',
                                            textAlign: 'center',
                                            fontWeight: '500',
                                            opacity: 0.8
                                        }}>
                                            Min increment: {formatAmount(BigInt(Number(offer.min_bid_increment_fee_multiple[0])) * tokenInfo.fee, tokenInfo.decimals)} {tokenInfo.symbol}
                                        </div>
                                    )}
                                    
                                    {/* Offer Creator */}
                                    <div style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '8px',
                                        fontSize: '0.8rem',
                                        color: theme.colors.mutedText,
                                        marginBottom: '0.75rem',
                                        padding: '8px 12px',
                                        background: theme.colors.primaryBg,
                                        borderRadius: '8px',
                                        border: `1px solid ${theme.colors.border}`,
                                    }}>
                                        <span style={{ fontWeight: '500' }}>Seller:</span>
                                        <span onClick={(e) => e.stopPropagation()}>
                                            <PrincipalDisplay 
                                                principal={offer.creator}
                                                short={true}
                                                showCopyButton={false}
                                                enableContextMenu={true}
                                                isAuthenticated={isAuthenticated}
                                                style={{ fontSize: '0.8rem' }}
                                            />
                                        </span>
                                    </div>
                                    
                                    <div style={styles.cardFooter}>
                                        {(() => {
                                            const isInactive = 'Completed' in offer.state || 
                                                'Claimed' in offer.state || 
                                                'Expired' in offer.state || 
                                                'Cancelled' in offer.state || 
                                                'Reclaimed' in offer.state;
                                            
                                            if (isInactive) {
                                                // Don't show time for inactive offers
                                                return (
                                                    <div style={{
                                                        ...styles.timeInfo,
                                                        color: theme.colors.mutedText,
                                                        background: theme.colors.primaryBg,
                                                        padding: '6px 10px',
                                                        borderRadius: '8px',
                                                    }}>
                                                        <FaClock size={12} />
                                                        <span>{getOfferStateString(offer.state)}</span>
                                                    </div>
                                                );
                                            }
                                            
                                            const isPastExpiration = isOfferPastExpiration(offer.expiration[0]);
                                            return (
                                                <div style={{
                                                    ...styles.timeInfo,
                                                    color: isPastExpiration ? theme.colors.warning : theme.colors.mutedText,
                                                    background: isPastExpiration 
                                                        ? `${theme.colors.warning}15` 
                                                        : theme.colors.primaryBg,
                                                    padding: '6px 10px',
                                                    borderRadius: '8px',
                                                    border: isPastExpiration ? `1px solid ${theme.colors.warning}30` : 'none',
                                                }}>
                                                    <FaClock size={12} />
                                                    <span>{formatTimeRemaining(offer.expiration[0])}</span>
                                                    {isPastExpiration && (
                                                        <span style={{ 
                                                            fontSize: '0.7rem',
                                                            background: theme.colors.warning,
                                                            color: '#fff',
                                                            padding: '2px 6px',
                                                            borderRadius: '4px',
                                                            fontWeight: '600',
                                                            marginLeft: '4px',
                                                        }}>
                                                            !
                                                        </span>
                                                    )}
                                                </div>
                                            );
                                        })()}
                                        <div style={styles.bidInfo}>
                                            <div style={{
                                                ...styles.bidCount,
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'flex-end',
                                                gap: '4px',
                                            }}>
                                                <FaGavel size={10} style={{ opacity: 0.6 }} />
                                                {bidInfo.bids?.length || 0} bid{(bidInfo.bids?.length || 0) !== 1 ? 's' : ''}
                                            </div>
                                            {bidInfo.highest_bid && (
                                                <>
                                                    <div style={{
                                                        ...styles.highestBid,
                                                        display: 'flex',
                                                        alignItems: 'baseline',
                                                        justifyContent: 'flex-end',
                                                        gap: '4px',
                                                    }}>
                                                        <span>{formatAmount(bidInfo.highest_bid.amount, tokenInfo.decimals)}</span>
                                                        <span style={{ 
                                                            fontSize: '0.8rem', 
                                                            color: theme.colors.mutedText,
                                                            fontWeight: '500',
                                                        }}>
                                                            {tokenInfo.symbol}
                                                        </span>
                                                        {highestBidUsd > 0 && (
                                                            <span style={{ 
                                                                fontSize: '0.75rem', 
                                                                color: theme.colors.mutedText, 
                                                                fontWeight: '400',
                                                            }}>
                                                                ({formatUsd(highestBidUsd)})
                                                            </span>
                                                        )}
                                                    </div>
                                                    <div style={{
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        justifyContent: 'flex-end',
                                                        gap: '4px',
                                                        fontSize: '0.75rem',
                                                        color: theme.colors.mutedText,
                                                        marginTop: '4px',
                                                        fontWeight: '500',
                                                    }}>
                                                        <span>by</span>
                                                        <span onClick={(e) => e.stopPropagation()}>
                                                            <PrincipalDisplay 
                                                                principal={bidInfo.highest_bid.bidder}
                                                                short={true}
                                                                showCopyButton={false}
                                                                enableContextMenu={true}
                                                                isAuthenticated={isAuthenticated}
                                                                style={{ fontSize: '0.75rem' }}
                                                            />
                                                        </span>
                                                    </div>
                                                </>
                                            )}
                                        </div>
                                    </div>
                                    </div>{/* End cardBody */}
                                </div>
                            );
                        })}
                        </div>
                        {/* End full-width grid */}
                        
                        {/* Bottom Pagination - centered */}
                        {filteredOffers.length > ITEMS_PER_PAGE && (
                            <div style={{ ...styles.centeredContent, ...styles.pagination }}>
                                <button
                                    style={{
                                        ...styles.paginationButton,
                                        opacity: currentPage === 1 ? 0.5 : 1,
                                        cursor: currentPage === 1 ? 'not-allowed' : 'pointer'
                                    }}
                                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                                    disabled={currentPage === 1}
                                >
                                    <FaChevronLeft /> Previous
                                </button>
                                <span style={styles.paginationInfo}>
                                    Page {currentPage} of {totalPages} ({filteredOffers.length} offers)
                                </span>
                                <button
                                    style={{
                                        ...styles.paginationButton,
                                        opacity: currentPage === totalPages ? 0.5 : 1,
                                        cursor: currentPage === totalPages ? 'not-allowed' : 'pointer'
                                    }}
                                    onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                                    disabled={currentPage === totalPages}
                                >
                                    Next <FaChevronRight />
                                </button>
                            </div>
                        )}
                    </>
                )}
                </div>
                {/* End offers section padding wrapper */}
            </main>
            
            <style>{`
                @keyframes spin {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(360deg); }
                }
                @keyframes fadeIn {
                    from { opacity: 0; transform: translateY(-8px); }
                    to { opacity: 1; transform: translateY(0); }
                }
                @media (max-width: 768px) {
                    .sneedex-advanced-filter-grid {
                        grid-template-columns: 1fr !important;
                    }
                    .sneedex-tab-container {
                        width: 100% !important;
                    }
                    .sneedex-controls {
                        flex-direction: column;
                    }
                    .sneedex-controls > * {
                        width: 100% !important;
                        min-width: unset !important;
                        flex: 1 1 100% !important;
                    }
                }
            `}</style>
        </div>
    );
}

export default SneedexOffers;
