import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Header from '../components/Header';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { FaSearch, FaFilter, FaGavel, FaClock, FaTag, FaCubes, FaBrain, FaCoins, FaArrowRight, FaSync, FaGlobe, FaLock, FaRobot, FaChevronLeft, FaChevronRight, FaChevronDown, FaChevronUp, FaTimes } from 'react-icons/fa';
import TokenSelector from '../components/TokenSelector';
import { HttpAgent } from '@dfinity/agent';
import { Principal } from '@dfinity/principal';
import { 
    createSneedexActor, 
    formatAmount, 
    formatTimeRemaining, 
    getOfferStateString,
    getAssetType,
    getAssetDetails,
    CANISTER_KIND_ICP_NEURON_MANAGER
} from '../utils/SneedexUtils';
import { createActor as createBackendActor } from 'declarations/app_sneeddao_backend';
import { createActor as createGovernanceActor } from 'external/sns_governance';
import { createActor as createLedgerActor } from 'external/icrc1_ledger';
import { getAllSnses, fetchSnsLogo, startBackgroundSnsFetch } from '../utils/SnsUtils';

const backendCanisterId = process.env.CANISTER_ID_APP_SNEEDDAO_BACKEND || process.env.REACT_APP_BACKEND_CANISTER_ID;
const getHost = () => process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging' ? 'https://icp0.io' : 'http://localhost:4943';

function SneedexOffers() {
    const { identity, isAuthenticated } = useAuth();
    const { theme } = useTheme();
    const navigate = useNavigate();
    
    // Get the principal from identity
    const principal = identity ? identity.getPrincipal() : null;
    
    const [offers, setOffers] = useState([]);
    const [offersWithBids, setOffersWithBids] = useState({}); // Map of offerId to bid info
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [searchTerm, setSearchTerm] = useState('');
    const [filterType, setFilterType] = useState('all'); // all, canister, neuron, token, neuron_manager
    const [sortBy, setSortBy] = useState('newest'); // newest, ending_soon, highest_bid, lowest_price
    const [whitelistedTokens, setWhitelistedTokens] = useState([]);
    const [offerTab, setOfferTab] = useState('public'); // 'public' or 'private'
    const [snsLogos, setSnsLogos] = useState(new Map()); // governance_id -> logo URL
    const [snsList, setSnsList] = useState([]); // List of all SNSes
    const [snsSymbols, setSnsSymbols] = useState(new Map()); // governance_id -> token symbol
    const [neuronInfo, setNeuronInfo] = useState({}); // `${governance_id}_${neuron_id}` -> { stake, state }
    const [tokenLogos, setTokenLogos] = useState(new Map()); // ledger_id -> logo URL
    const [neuronManagerInfo, setNeuronManagerInfo] = useState({}); // canister_id -> { totalStake, neuronCount }
    
    // Pagination state
    const [currentPage, setCurrentPage] = useState(1);
    const ITEMS_PER_PAGE = 12;
    
    // Advanced filter state
    const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
    const [bidTokenFilter, setBidTokenFilter] = useState(''); // Filter by payment token
    const [minPriceFilter, setMinPriceFilter] = useState(''); // Min price filter
    const [maxPriceFilter, setMaxPriceFilter] = useState(''); // Max price filter
    const [assetTokenFilter, setAssetTokenFilter] = useState(''); // Filter by asset token (for tokens, SNS neurons, neuron managers)
    const [minAssetAmountFilter, setMinAssetAmountFilter] = useState(''); // Min asset amount filter
    const [maxAssetAmountFilter, setMaxAssetAmountFilter] = useState(''); // Max asset amount filter
    
    // ICP ledger canister ID constant
    const ICP_LEDGER_ID = 'ryjl3-tyaaa-aaaaa-aaaba-cai';
    
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
    
    // Helper to get token info from whitelisted tokens
    const getTokenInfo = useCallback((ledgerId) => {
        const token = whitelistedTokens.find(t => t.ledger_id.toString() === ledgerId);
        if (token) {
            return { symbol: token.symbol, decimals: Number(token.decimals), name: token.name, logo: token.logo?.[0] || null };
        }
        // Fallback for known tokens
        if (ledgerId === 'ryjl3-tyaaa-aaaaa-aaaba-cai') return { symbol: 'ICP', decimals: 8, logo: null };
        return { symbol: 'TOKEN', decimals: 8, logo: null };
    }, [whitelistedTokens]);
    
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
    
    // Fetch token logo from ledger metadata
    const fetchTokenLogo = useCallback(async (ledgerId) => {
        if (tokenLogos.has(ledgerId)) return;
        
        try {
            const agent = new HttpAgent({ host: getHost(), identity });
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
            }
            
            const ledgerActor = createLedgerActor(ledgerId, { agent });
            const metadata = await ledgerActor.icrc1_metadata();
            
            // Find logo in metadata
            const logoEntry = metadata.find(([key]) => key === 'icrc1:logo');
            if (logoEntry && logoEntry[1] && 'Text' in logoEntry[1]) {
                setTokenLogos(prev => new Map(prev).set(ledgerId, logoEntry[1].Text));
            }
        } catch (e) {
            console.warn('Failed to fetch token logo:', e);
        }
    }, [tokenLogos, identity]);
    
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
            let activeOffers;
            
            if (offerTab === 'public') {
                // Fetch public offers (no approved bidders list)
                activeOffers = await actor.getPublicOffers();
            } else {
                // Fetch private offers where user is creator or in approved bidders list
                if (principal) {
                    activeOffers = await actor.getPrivateOffersFor(principal);
                } else {
                    activeOffers = [];
                }
            }
            
            setOffers(activeOffers);
            
            // Fetch bid info for each offer
            const bidInfo = {};
            for (const offer of activeOffers) {
                try {
                    const offerView = await actor.getOfferView(offer.id);
                    if (offerView && offerView.length > 0) {
                        bidInfo[Number(offer.id)] = {
                            bids: offerView[0].bids,
                            highest_bid: offerView[0].highest_bid[0] || null,
                        };
                    }
                } catch (e) {
                    console.warn(`Failed to fetch bid info for offer ${offer.id}:`, e);
                }
            }
            setOffersWithBids(bidInfo);
        } catch (e) {
            console.error('Failed to fetch offers:', e);
            setError('Failed to load offers. Please try again.');
        } finally {
            setLoading(false);
        }
    }, [identity, offerTab, principal]);
    
    useEffect(() => {
        fetchOffers();
    }, [fetchOffers]);
    
    // Fetch SNS logos, symbols, neuron info, token logos, and neuron manager info when offers change
    useEffect(() => {
        if (offers.length === 0) return;
        
        offers.forEach(offer => {
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
                    // Fetch token logo
                    fetchTokenLogo(details.ledger_id);
                } else if (details.type === 'Canister' && details.canister_kind === CANISTER_KIND_ICP_NEURON_MANAGER) {
                    // Only fetch live neuron manager info if no cached value is available
                    // (for backwards compatibility with offers activated before caching was added)
                    if (assetEntry.escrowed && details.cached_total_stake_e8s === null) {
                        fetchNeuronManagerInfo(details.canister_id);
                    }
                }
            });
        });
    }, [offers, fetchSnsLogoForOffer, fetchSnsSymbol, fetchNeuronInfo, fetchTokenLogo, fetchNeuronManagerInfo]);
    
    // Helper to get SNS ledger from governance ID
    const getSnsLedgerFromGovernance = useCallback((governanceId) => {
        const sns = snsList.find(s => {
            const govId = s.governance_canister_id?.[0]?.toString() || s.governance_canister_id?.toString();
            return govId === governanceId;
        });
        if (sns) {
            return sns.ledger_canister_id?.[0]?.toString() || sns.ledger_canister_id?.toString();
        }
        return null;
    }, [snsList]);
    
    // Check if any advanced filters are active
    const hasActiveAdvancedFilters = bidTokenFilter || minPriceFilter || maxPriceFilter || assetTokenFilter || minAssetAmountFilter || maxAssetAmountFilter;
    
    // Clear all advanced filters
    const clearAdvancedFilters = () => {
        setBidTokenFilter('');
        setMinPriceFilter('');
        setMaxPriceFilter('');
        setAssetTokenFilter('');
        setMinAssetAmountFilter('');
        setMaxAssetAmountFilter('');
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
        
        // Search by offer ID or creator
        if (searchTerm) {
            const term = searchTerm.toLowerCase();
            const matchId = offer.id.toString().includes(term);
            const matchCreator = offer.creator.toString().toLowerCase().includes(term);
            if (!matchId && !matchCreator) return false;
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
    }, [filterType, searchTerm, sortBy, offerTab, bidTokenFilter, minPriceFilter, maxPriceFilter, assetTokenFilter, minAssetAmountFilter, maxAssetAmountFilter]);

    const styles = {
        container: {
            maxWidth: '1400px',
            margin: '0 auto',
            padding: '2rem',
            color: theme.colors.primaryText,
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
            gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))',
            gap: '1.5rem',
        },
        card: {
            background: theme.colors.cardGradient,
            border: `1px solid ${theme.colors.border}`,
            borderRadius: '16px',
            padding: '1.5rem',
            transition: 'all 0.3s ease',
            cursor: 'pointer',
        },
        cardHeader: {
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            marginBottom: '1rem',
        },
        offerId: {
            fontSize: '0.85rem',
            color: theme.colors.mutedText,
            fontFamily: 'monospace',
        },
        cardBadge: {
            background: `${theme.colors.success}20`,
            color: theme.colors.success,
            padding: '4px 10px',
            borderRadius: '6px',
            fontSize: '0.8rem',
            fontWeight: '600',
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
            background: theme.colors.tertiaryBg,
            padding: '6px 12px',
            borderRadius: '8px',
            fontSize: '0.85rem',
            color: theme.colors.secondaryText,
        },
        priceSection: {
            display: 'grid',
            gridTemplateColumns: 'repeat(2, 1fr)',
            gap: '1rem',
            marginBottom: '1rem',
            padding: '1rem',
            background: theme.colors.tertiaryBg,
            borderRadius: '10px',
        },
        priceItem: {
            textAlign: 'center',
        },
        priceLabel: {
            fontSize: '0.75rem',
            color: theme.colors.mutedText,
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
            marginBottom: '4px',
        },
        priceValue: {
            fontSize: '1.2rem',
            fontWeight: '700',
            color: theme.colors.primaryText,
        },
        priceToken: {
            fontSize: '0.85rem',
            color: theme.colors.mutedText,
        },
        cardFooter: {
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            paddingTop: '1rem',
            borderTop: `1px solid ${theme.colors.border}`,
        },
        timeInfo: {
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            fontSize: '0.9rem',
            color: theme.colors.mutedText,
        },
        bidInfo: {
            textAlign: 'right',
        },
        bidCount: {
            fontSize: '0.85rem',
            color: theme.colors.mutedText,
        },
        highestBid: {
            fontSize: '1rem',
            fontWeight: '600',
            color: theme.colors.success,
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
            <main style={styles.container}>
                <div style={styles.header}>
                    <h1 style={styles.title}>Marketplace</h1>
                    <div style={styles.headerButtons}>
                        <button
                            style={styles.refreshButton}
                            onClick={fetchOffers}
                            disabled={loading}
                        >
                            <FaSync style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
                            {loading ? 'Loading...' : 'Refresh'}
                        </button>
                        {isAuthenticated && (
                            <Link
                                to="/sneedex_create"
                                style={styles.createButton}
                                onMouseEnter={(e) => {
                                    e.target.style.transform = 'translateY(-2px)';
                                    e.target.style.boxShadow = `0 6px 20px ${theme.colors.success}40`;
                                }}
                                onMouseLeave={(e) => {
                                    e.target.style.transform = 'translateY(0)';
                                    e.target.style.boxShadow = 'none';
                                }}
                            >
                                <FaGavel /> Create Offer
                            </Link>
                        )}
                    </div>
                </div>
                
                {error && (
                    <div style={styles.errorState}>
                        {error}
                    </div>
                )}
                
                {/* Public/Private tabs */}
                <div className="sneedex-tab-container" style={styles.tabContainer}>
                    <button
                        style={{
                            ...styles.tab,
                            ...(offerTab === 'public' ? styles.tabActive : {})
                        }}
                        onClick={() => setOfferTab('public')}
                    >
                        <FaGlobe /> Public Offers
                    </button>
                    <button
                        style={{
                            ...styles.tab,
                            ...(offerTab === 'private' ? styles.tabActive : {})
                        }}
                        onClick={() => setOfferTab('private')}
                        disabled={!isAuthenticated}
                        title={!isAuthenticated ? 'Connect wallet to view private offers' : ''}
                    >
                        <FaLock /> Private (OTC)
                    </button>
                </div>
                
                <div className="sneedex-controls" style={styles.controls}>
                    <div style={styles.searchBox}>
                        <FaSearch style={styles.searchIcon} />
                        <input
                            type="text"
                            placeholder="Search by offer ID or creator..."
                            style={styles.searchInput}
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            onFocus={(e) => e.target.style.borderColor = theme.colors.accent}
                            onBlur={(e) => e.target.style.borderColor = theme.colors.border}
                        />
                    </div>
                    <select
                        style={styles.select}
                        value={filterType}
                        onChange={(e) => setFilterType(e.target.value)}
                    >
                        <option value="all">All Assets</option>
                        <option value="canister">Canisters</option>
                        <option value="neuron_manager">ICP Neuron Managers</option>
                        <option value="neuron">SNS Neurons</option>
                        <option value="token">ICRC1 Tokens</option>
                    </select>
                    <select
                        style={styles.select}
                        value={sortBy}
                        onChange={(e) => setSortBy(e.target.value)}
                    >
                        <option value="newest">Newest First</option>
                        <option value="ending_soon">Ending Soon</option>
                        <option value="highest_bid">Highest Bid</option>
                        <option value="lowest_price">Lowest Price</option>
                    </select>
                    <button
                        style={{
                            ...styles.advancedFilterToggle,
                            borderColor: showAdvancedFilters ? theme.colors.accent : theme.colors.border,
                            background: hasActiveAdvancedFilters ? `${theme.colors.accent}15` : theme.colors.secondaryBg,
                        }}
                        onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
                    >
                        <FaFilter />
                        Advanced
                        {hasActiveAdvancedFilters && (
                            <span style={styles.activeFilterBadge}>
                                {[bidTokenFilter, minPriceFilter || maxPriceFilter, assetTokenFilter, minAssetAmountFilter || maxAssetAmountFilter].filter(Boolean).length}
                            </span>
                        )}
                        {showAdvancedFilters ? <FaChevronUp size={12} /> : <FaChevronDown size={12} />}
                    </button>
                </div>
                
                {/* Advanced Filters Section */}
                {showAdvancedFilters && (
                    <div style={styles.advancedFilterSection}>
                        <div style={styles.advancedFilterHeader}>
                            <div style={styles.advancedFilterTitle}>
                                <FaFilter /> Advanced Filters
                            </div>
                            {hasActiveAdvancedFilters && (
                                <button
                                    style={styles.clearFiltersButton}
                                    onClick={clearAdvancedFilters}
                                >
                                    <FaTimes size={12} /> Clear All
                                </button>
                            )}
                        </div>
                        
                        <div className="sneedex-advanced-filter-grid" style={styles.advancedFilterGrid}>
                            {/* Payment Token Filter */}
                            <div style={styles.filterGroup}>
                                <label style={styles.filterLabel}>Payment Token <span style={styles.filterLabelHint}>(Bid Currency)</span></label>
                                <TokenSelector
                                    value={bidTokenFilter}
                                    onChange={(ledgerId) => setBidTokenFilter(ledgerId)}
                                    placeholder="Any token..."
                                    style={{ width: '100%' }}
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
                        </div>
                    </div>
                )}
                
                {loading && offers.length === 0 ? (
                    <div style={styles.loadingState}>
                        <div style={{ fontSize: '2rem', marginBottom: '1rem' }}>⏳</div>
                        Loading offers...
                    </div>
                ) : filteredOffers.length === 0 ? (
                    <div style={styles.emptyState}>
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
                        {/* Top Pagination */}
                        {filteredOffers.length > ITEMS_PER_PAGE && (
                            <div style={{ ...styles.pagination, marginTop: 0, paddingTop: 0, borderTop: 'none', marginBottom: '1.5rem', paddingBottom: '1rem', borderBottom: `1px solid ${theme.colors.border}` }}>
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
                        
                        <div style={styles.grid}>
                        {paginatedOffers.map((offer) => {
                            const bidInfo = offersWithBids[Number(offer.id)] || {};
                            const tokenInfo = getTokenInfo(offer.price_token_ledger.toString());
                            
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
                                    style={styles.card}
                                    onClick={() => navigate(`/sneedex_offer/${offer.id}`)}
                                    onMouseEnter={(e) => {
                                        e.currentTarget.style.transform = 'translateY(-4px)';
                                        e.currentTarget.style.borderColor = theme.colors.accent;
                                        e.currentTarget.style.boxShadow = `0 12px 40px ${theme.colors.accent}15`;
                                    }}
                                    onMouseLeave={(e) => {
                                        e.currentTarget.style.transform = 'translateY(0)';
                                        e.currentTarget.style.borderColor = theme.colors.border;
                                        e.currentTarget.style.boxShadow = 'none';
                                    }}
                                >
                                    <div style={styles.cardHeader}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                            <span style={styles.offerId}>Offer #{Number(offer.id)}</span>
                                            {singleCanisterTitle && (
                                                <span style={{
                                                    fontSize: '0.85rem',
                                                    fontWeight: '600',
                                                    color: theme.colors.primaryText,
                                                    maxWidth: '200px',
                                                    overflow: 'hidden',
                                                    textOverflow: 'ellipsis',
                                                    whiteSpace: 'nowrap',
                                                }}>
                                                    – {singleCanisterTitle}
                                                </span>
                                            )}
                                            {offer.approved_bidders && offer.approved_bidders[0] && offer.approved_bidders[0].length > 0 && (
                                                <span style={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '4px',
                                                    background: `${theme.colors.warning}20`,
                                                    color: theme.colors.warning,
                                                    padding: '2px 8px',
                                                    borderRadius: '4px',
                                                    fontSize: '0.75rem',
                                                    fontWeight: '500',
                                                }}>
                                                    <FaLock size={10} />
                                                    {offer.approved_bidders[0].length} bidder{offer.approved_bidders[0].length !== 1 ? 's' : ''}
                                                </span>
                                            )}
                                        </div>
                                        <span style={styles.cardBadge}>{getOfferStateString(offer.state)}</span>
                                    </div>
                                    
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
                                                    // Use cached value if available
                                                    if (details.cached_total_stake_e8s !== null) {
                                                        return `ICP Neuron Manager\nCanister: ${details.canister_id}\nStaked: ${(details.cached_total_stake_e8s / 1e8).toFixed(4)} ICP`;
                                                    }
                                                    const mInfo = neuronManagerInfo[details.canister_id];
                                                    if (mInfo) {
                                                        return `ICP Neuron Manager\nCanister: ${details.canister_id}\n\nStake: ${mInfo.totalStake.toFixed(4)} ICP\nMaturity: ${mInfo.totalMaturity.toFixed(4)} ICP\nStaked Maturity: ${mInfo.totalStakedMaturity.toFixed(4)} ICP\nTotal: ${mInfo.totalIcp.toFixed(4)} ICP\n\nNeurons: ${mInfo.neuronCount}`;
                                                    }
                                                    return `ICP Neuron Manager\nCanister: ${details.canister_id}`;
                                                }
                                                if (details.type === 'Canister') {
                                                    return `Canister: ${details.canister_id}`;
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
                                                            Canister
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
                                                            {tokenLogos.get(details.ledger_id) ? (
                                                                <img 
                                                                    src={tokenLogos.get(details.ledger_id)} 
                                                                    alt={assetTokenInfo?.symbol || 'Token'} 
                                                                    style={{ width: 18, height: 18, borderRadius: '50%' }}
                                                                    onError={(e) => { e.target.style.display = 'none'; }}
                                                                />
                                                            ) : assetTokenInfo?.logo ? (
                                                                <img 
                                                                    src={assetTokenInfo.logo} 
                                                                    alt={assetTokenInfo.symbol} 
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
                                        <div style={styles.priceItem}>
                                            <div style={styles.priceLabel}>Min Bid</div>
                                            <div style={styles.priceValue}>
                                                {offer.min_bid_price[0] ? formatAmount(offer.min_bid_price[0], tokenInfo.decimals) : '—'}
                                            </div>
                                            <div style={styles.priceToken}>{tokenInfo.symbol}</div>
                                        </div>
                                        <div style={styles.priceItem}>
                                            <div style={styles.priceLabel}>Buyout</div>
                                            <div style={styles.priceValue}>
                                                {offer.buyout_price[0] ? formatAmount(offer.buyout_price[0], tokenInfo.decimals) : '—'}
                                            </div>
                                            <div style={styles.priceToken}>{tokenInfo.symbol}</div>
                                        </div>
                                    </div>
                                    {offer.min_bid_increment_fee_multiple?.[0] && (
                                        <div style={{ 
                                            fontSize: '0.75rem', 
                                            color: theme.colors.mutedText,
                                            marginBottom: '0.75rem',
                                            textAlign: 'center'
                                        }}>
                                            Min increment: {Number(offer.min_bid_increment_fee_multiple[0])}× fee
                                        </div>
                                    )}
                                    
                                    <div style={styles.cardFooter}>
                                        <div style={styles.timeInfo}>
                                            <FaClock />
                                            {formatTimeRemaining(offer.expiration[0])}
                                        </div>
                                        <div style={styles.bidInfo}>
                                            <div style={styles.bidCount}>
                                                {bidInfo.bids?.length || 0} bid{(bidInfo.bids?.length || 0) !== 1 ? 's' : ''}
                                            </div>
                                            {bidInfo.highest_bid && (
                                                <div style={styles.highestBid}>
                                                    {formatAmount(bidInfo.highest_bid.amount, tokenInfo.decimals)} {tokenInfo.symbol}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                        
                        {/* Bottom Pagination */}
                        {filteredOffers.length > ITEMS_PER_PAGE && (
                            <div style={styles.pagination}>
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
                    </div>
                    </>
                )}
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
