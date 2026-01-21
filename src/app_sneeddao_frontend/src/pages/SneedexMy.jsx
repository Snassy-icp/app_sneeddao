import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Header from '../components/Header';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { FaGavel, FaHandHoldingUsd, FaClock, FaCheck, FaTimes, FaExternalLinkAlt, FaPlus, FaCubes, FaBrain, FaCoins, FaSync, FaWallet, FaChevronLeft, FaChevronRight } from 'react-icons/fa';
import { 
    createSneedexActor, 
    formatAmount, 
    formatDate,
    formatTimeRemaining,
    isOfferPastExpiration,
    getOfferStateString,
    getBidStateString,
    getAssetType,
    getErrorMessage,
    parseAmount,
    formatUsd,
    calculateUsdValue,
    SNEEDEX_CANISTER_ID
} from '../utils/SneedexUtils';
import { createActor as createBackendActor } from 'declarations/app_sneeddao_backend';
import { createActor as createLedgerActor } from 'external/icrc1_ledger';
import priceService from '../services/PriceService';
import { Principal } from '@dfinity/principal';
import { fetchAndCacheSnsData, getAllSnses } from '../utils/SnsUtils';

// Generate bid escrow subaccount (matches backend Utils.bidEscrowSubaccount)
// Structure: byte 0 = principal length, bytes 1-N = principal, byte 23 = 0x42 ('B'), bytes 24-31 = bidId big-endian
const getBidEscrowSubaccount = (bidderPrincipal, bidId) => {
    const subaccount = new Uint8Array(32);
    const principalBytes = bidderPrincipal.toUint8Array();
    
    // Byte 0: principal length
    subaccount[0] = principalBytes.length;
    
    // Bytes 1-N: principal bytes
    for (let i = 0; i < principalBytes.length && i < 22; i++) {
        subaccount[1 + i] = principalBytes[i];
    }
    
    // Byte 23: type marker for bid
    subaccount[23] = 0x42; // 'B'
    
    // Bytes 24-31: bid ID as big-endian 64-bit
    const bidIdBigInt = BigInt(bidId);
    subaccount[24] = Number((bidIdBigInt >> 56n) & 0xFFn);
    subaccount[25] = Number((bidIdBigInt >> 48n) & 0xFFn);
    subaccount[26] = Number((bidIdBigInt >> 40n) & 0xFFn);
    subaccount[27] = Number((bidIdBigInt >> 32n) & 0xFFn);
    subaccount[28] = Number((bidIdBigInt >> 24n) & 0xFFn);
    subaccount[29] = Number((bidIdBigInt >> 16n) & 0xFFn);
    subaccount[30] = Number((bidIdBigInt >> 8n) & 0xFFn);
    subaccount[31] = Number(bidIdBigInt & 0xFFn);
    
    return Array.from(subaccount);
};
import InfoModal from '../components/InfoModal';
import ConfirmationModal from '../ConfirmationModal';

const backendCanisterId = process.env.CANISTER_ID_APP_SNEEDDAO_BACKEND || process.env.REACT_APP_BACKEND_CANISTER_ID;

function SneedexMy() {
    const { identity, isAuthenticated } = useAuth();
    const { theme } = useTheme();
    const navigate = useNavigate();
    
    const [activeTab, setActiveTab] = useState('offers'); // 'offers' or 'bids'
    const [myOffers, setMyOffers] = useState([]);
    const [myBids, setMyBids] = useState([]);
    const [offersWithBids, setOffersWithBids] = useState({}); // Map of offerId to bid info
    const [bidEscrowBalances, setBidEscrowBalances] = useState({}); // Map of bidId to escrow balance
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [actionLoading, setActionLoading] = useState(null); // Track which item is loading
    const [whitelistedTokens, setWhitelistedTokens] = useState([]);
    const [bidOfferInfo, setBidOfferInfo] = useState({}); // offer_id -> { price_token_ledger, tokenInfo }
    
    // USD pricing state
    const [tokenPrices, setTokenPrices] = useState({}); // ledger_id -> USD price per token
    const [snsData, setSnsData] = useState([]); // SNS data for looking up ledger IDs
    
    // Filter state
    const [offerFilter, setOfferFilter] = useState('all'); // all, active, completed, draft, cancelled, expired, reclaimed, claimed
    const [bidFilter, setBidFilter] = useState('all'); // all, pending, won, lost, refunded
    
    // Pagination state
    const [offersPage, setOffersPage] = useState(1);
    const [bidsPage, setBidsPage] = useState(1);
    const ITEMS_PER_PAGE = 10;
    
    // InfoModal state
    const [infoModal, setInfoModal] = useState({ show: false, title: '', message: '', type: 'info' });
    
    const showInfo = (message, type = 'info', title = '') => {
        setInfoModal({ show: true, title, message, type });
    };
    const closeInfoModal = () => setInfoModal({ ...infoModal, show: false });
    
    // ConfirmationModal state
    const [confirmModal, setConfirmModal] = useState({ show: false, message: '', action: null });
    
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
            return { symbol: token.symbol, decimals: Number(token.decimals), name: token.name };
        }
        // Fallback for known tokens
        if (ledgerId === 'ryjl3-tyaaa-aaaaa-aaaba-cai') return { symbol: 'ICP', decimals: 8 };
        return { symbol: 'TOKEN', decimals: 8 };
    }, [whitelistedTokens]);
    
    // Filter and sort offers by created_at (newest first) and paginate
    const filteredOffers = useMemo(() => {
        if (offerFilter === 'all') return myOffers;
        return myOffers.filter(offer => {
            if (offerFilter === 'active') return 'Active' in offer.state;
            if (offerFilter === 'completed') return 'Completed' in offer.state;
            if (offerFilter === 'draft') return 'Draft' in offer.state || 'PendingEscrow' in offer.state;
            if (offerFilter === 'cancelled') return 'Cancelled' in offer.state;
            if (offerFilter === 'expired') return 'Expired' in offer.state;
            if (offerFilter === 'reclaimed') return 'Reclaimed' in offer.state;
            if (offerFilter === 'claimed') return 'Claimed' in offer.state;
            return true;
        });
    }, [myOffers, offerFilter]);
    
    const sortedOffers = useMemo(() => {
        return [...filteredOffers].sort((a, b) => {
            const timeA = BigInt(a.created_at);
            const timeB = BigInt(b.created_at);
            return timeB > timeA ? 1 : timeB < timeA ? -1 : 0;
        });
    }, [filteredOffers]);
    
    const paginatedOffers = useMemo(() => {
        const startIndex = (offersPage - 1) * ITEMS_PER_PAGE;
        return sortedOffers.slice(startIndex, startIndex + ITEMS_PER_PAGE);
    }, [sortedOffers, offersPage]);
    
    const totalOffersPages = useMemo(() => Math.ceil(sortedOffers.length / ITEMS_PER_PAGE), [sortedOffers.length]);
    
    // Filter and sort bids by created_at (newest first) and paginate
    const filteredBids = useMemo(() => {
        if (bidFilter === 'all') return myBids;
        return myBids.filter(bid => {
            if (bidFilter === 'pending') return 'Pending' in bid.state;
            if (bidFilter === 'won') return 'Won' in bid.state;
            if (bidFilter === 'lost') return 'Lost' in bid.state;
            if (bidFilter === 'refunded') return 'Refunded' in bid.state;
            return true;
        });
    }, [myBids, bidFilter]);
    
    const sortedBids = useMemo(() => {
        return [...filteredBids].sort((a, b) => {
            const timeA = BigInt(a.created_at);
            const timeB = BigInt(b.created_at);
            return timeB > timeA ? 1 : timeB < timeA ? -1 : 0;
        });
    }, [filteredBids]);
    
    const paginatedBids = useMemo(() => {
        const startIndex = (bidsPage - 1) * ITEMS_PER_PAGE;
        return sortedBids.slice(startIndex, startIndex + ITEMS_PER_PAGE);
    }, [sortedBids, bidsPage]);
    
    const totalBidsPages = useMemo(() => Math.ceil(sortedBids.length / ITEMS_PER_PAGE), [sortedBids.length]);
    
    // Reset pagination when tab or filter changes
    useEffect(() => {
        setOffersPage(1);
    }, [activeTab, offerFilter]);
    
    useEffect(() => {
        setBidsPage(1);
    }, [activeTab, bidFilter]);
    
    // Fetch escrow balances for all bids that have tokens escrowed
    // Calls the ledger directly for better performance
    const fetchBidEscrowBalances = useCallback(async (bids) => {
        if (!identity || !bids.length) return;
        
        // Filter to bids with tokens escrowed
        const escrowedBids = bids.filter(bid => bid.tokens_escrowed);
        if (escrowedBids.length === 0) return;
        
        // Get unique offer IDs to fetch their price_token_ledger
        const uniqueOfferIds = [...new Set(escrowedBids.map(b => Number(b.offer_id)))];
        
        // Fetch offer info to get price_token_ledger for each offer
        const actor = createSneedexActor(identity);
        const offerLedgers = {};
        
        await Promise.all(uniqueOfferIds.map(async (offerId) => {
            try {
                const offerView = await actor.getOfferView(BigInt(offerId));
                if (offerView && offerView.length > 0) {
                    offerLedgers[offerId] = offerView[0].offer.price_token_ledger.toString();
                }
            } catch (e) {
                console.warn(`Failed to fetch offer ${offerId}:`, e);
            }
        }));
        
        // Now fetch balances directly from ledgers in parallel
        const sneedexPrincipal = Principal.fromText(SNEEDEX_CANISTER_ID);
        const balances = {};
        
        await Promise.all(escrowedBids.map(async (bid) => {
            const ledgerId = offerLedgers[Number(bid.offer_id)];
            if (!ledgerId) return;
            
            try {
                const ledgerActor = createLedgerActor(ledgerId, {
                    agentOptions: { identity }
                });
                
                const subaccount = getBidEscrowSubaccount(bid.bidder, bid.id);
                
                const balance = await ledgerActor.icrc1_balance_of({
                    owner: sneedexPrincipal,
                    subaccount: [subaccount]
                });
                
                balances[Number(bid.id)] = balance;
            } catch (e) {
                console.warn(`Failed to fetch escrow balance for bid ${bid.id}:`, e);
            }
        }));
        
        setBidEscrowBalances(balances);
    }, [identity]);
    
    const fetchData = useCallback(async () => {
        if (!identity) return;
        
        setLoading(true);
        setError('');
        try {
            const actor = createSneedexActor(identity);
            const principal = identity.getPrincipal();
            
            // Fetch offers created by the user
            const offers = await actor.getOffersByCreator(principal);
            setMyOffers(offers);
            
            // Fetch bids made by the user
            const bids = await actor.getBidsByBidder(principal);
            setMyBids(bids);
            
            // Fetch escrow balances for bids
            fetchBidEscrowBalances(bids);
            
            // Fetch offer info for each unique offer_id in bids (to get token info)
            const uniqueOfferIds = [...new Set(bids.map(b => Number(b.offer_id)))];
            const offerInfo = {};
            for (const offerId of uniqueOfferIds) {
                try {
                    const offerView = await actor.getOfferView(BigInt(offerId));
                    if (offerView && offerView.length > 0) {
                        const offer = offerView[0].offer;
                        offerInfo[offerId] = {
                            price_token_ledger: offer.price_token_ledger.toString()
                        };
                    }
                } catch (e) {
                    console.warn(`Failed to fetch offer info for ${offerId}:`, e);
                }
            }
            setBidOfferInfo(offerInfo);
            
            // Fetch bid info for each offer
            const bidInfo = {};
            for (const offer of offers) {
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
            console.error('Failed to fetch data:', e);
            setError('Failed to load data. Please try again.');
        } finally {
            setLoading(false);
        }
    }, [identity]);
    
    useEffect(() => {
        if (isAuthenticated && identity) {
            fetchData();
        }
    }, [isAuthenticated, identity, fetchData]);
    
    // Fetch SNS data for looking up ledger IDs from governance IDs
    useEffect(() => {
        const fetchSnsDataForPrices = async () => {
            try {
                let data = getAllSnses();
                if (!data || data.length === 0) {
                    data = await fetchAndCacheSnsData(identity);
                }
                setSnsData(data || []);
            } catch (e) {
                console.error('Failed to fetch SNS data:', e);
            }
        };
        fetchSnsDataForPrices();
    }, [identity]);
    
    // Helper to get SNS ledger from governance ID
    const getSnsLedgerFromGovernance = useCallback((governanceId) => {
        const sns = snsData.find(s => {
            const govId = s.governance_canister_id?.[0]?.toString() || 
                          s.governance_canister_id?.toString() ||
                          s.canisters?.governance;
            return govId === governanceId;
        });
        if (sns) {
            return sns.ledger_canister_id?.[0]?.toString() || 
                   sns.ledger_canister_id?.toString() ||
                   sns.canisters?.ledger;
        }
        return null;
    }, [snsData]);
    
    // Fetch token prices for USD display
    useEffect(() => {
        const fetchPrices = async () => {
            // Collect ledger IDs from offers and bid offers
            const ledgerIds = new Set();
            
            myOffers.forEach(offer => {
                ledgerIds.add(offer.price_token_ledger.toString());
                
                // Also add SNS ledgers for SNS neuron assets
                if (offer.assets) {
                    offer.assets.forEach(assetEntry => {
                        if (assetEntry.asset?.SNSNeuron) {
                            const govId = assetEntry.asset.SNSNeuron.governance_canister_id?.toString();
                            if (govId) {
                                const snsLedger = getSnsLedgerFromGovernance(govId);
                                if (snsLedger) {
                                    ledgerIds.add(snsLedger);
                                }
                            }
                        }
                    });
                }
            });
            
            // Add ledgers from bid offers
            Object.values(bidOfferInfo).forEach(info => {
                if (info.price_token_ledger) {
                    ledgerIds.add(info.price_token_ledger);
                }
            });
            
            // If no ledgers to fetch, skip
            if (ledgerIds.size === 0) return;
            
            // Fetch prices for each ledger (silently ignore failures)
            const prices = {};
            for (const ledgerId of ledgerIds) {
                try {
                    const token = whitelistedTokens.find(t => t.ledger_id.toString() === ledgerId);
                    const decimals = token ? Number(token.decimals) : 8;
                    const price = await priceService.getTokenUSDPrice(ledgerId, decimals);
                    prices[ledgerId] = price;
                } catch (e) {
                    // Silently ignore - token may not have an ICPSwap pool
                }
            }
            setTokenPrices(prices);
        };
        
        if ((myOffers.length > 0 || Object.keys(bidOfferInfo).length > 0) && snsData.length > 0) {
            fetchPrices();
        }
    }, [myOffers, bidOfferInfo, whitelistedTokens, snsData, getSnsLedgerFromGovernance]);
    
    const handleAcceptBid = async (offerId) => {
        if (!identity) return;
        
        setActionLoading(`accept-${offerId}`);
        try {
            const actor = createSneedexActor(identity);
            const result = await actor.acceptBid(BigInt(offerId));
            
            if ('err' in result) {
                throw new Error(getErrorMessage(result.err));
            }
            
            showInfo('Bid accepted successfully!', 'success');
            await fetchData();
        } catch (e) {
            console.error('Failed to accept bid:', e);
            showInfo(`Error: ${e.message}`, 'error');
        } finally {
            setActionLoading(null);
        }
    };
    
    const handleCancelOffer = (offerId) => {
        if (!identity) return;
        
        const bidInfo = offersWithBids[Number(offerId)] || {};
        const bidCount = bidInfo.bids?.length || 0;
        const hasBids = bidCount > 0;
        const message = hasBids 
            ? `Are you sure you want to cancel this offer? There ${bidCount === 1 ? 'is 1 bid' : `are ${bidCount} bids`} that will be refunded.`
            : 'Are you sure you want to cancel this offer?';
        
        setConfirmModal({
            show: true,
            message,
            action: async () => {
                setActionLoading(`cancel-${offerId}`);
                try {
                    const actor = createSneedexActor(identity);
                    const result = await actor.cancelOffer(BigInt(offerId));
                    
                    if ('err' in result) {
                        throw new Error(getErrorMessage(result.err));
                    }
                    
                    const successMsg = hasBids 
                        ? 'Offer cancelled. Bidders will be refunded automatically.'
                        : 'Offer cancelled successfully!';
                    showInfo(successMsg, 'success');
                    await fetchData();
                } catch (e) {
                    console.error('Failed to cancel offer:', e);
                    showInfo(`Error: ${e.message}`, 'error');
                } finally {
                    setActionLoading(null);
                }
            }
        });
    };
    
    const handleClaimPayment = async (offerId) => {
        if (!identity) return;
        
        setActionLoading(`claim-payment-${offerId}`);
        try {
            const actor = createSneedexActor(identity);
            const result = await actor.claimWinningBid(BigInt(offerId));
            
            if ('err' in result) {
                throw new Error(getErrorMessage(result.err));
            }
            
            showInfo('Payment claimed successfully!', 'success');
            await fetchData();
        } catch (e) {
            console.error('Failed to claim payment:', e);
            showInfo(`Error: ${e.message}`, 'error');
        } finally {
            setActionLoading(null);
        }
    };
    
    const handleClaimAssets = async (offerId) => {
        if (!identity) return;
        
        setActionLoading(`claim-assets-${offerId}`);
        try {
            const actor = createSneedexActor(identity);
            const result = await actor.claimAssets(BigInt(offerId));
            
            if ('err' in result) {
                throw new Error(getErrorMessage(result.err));
            }
            
            showInfo('Assets claimed successfully!', 'success');
            await fetchData();
        } catch (e) {
            console.error('Failed to claim assets:', e);
            showInfo(`Error: ${e.message}`, 'error');
        } finally {
            setActionLoading(null);
        }
    };
    
    const handleProcessExpiration = async (offerId, hasBids) => {
        if (!identity) return;
        
        setActionLoading(`process-expiration-${offerId}`);
        try {
            const actor = createSneedexActor(identity);
            const result = await actor.processExpiration(BigInt(offerId));
            
            if ('err' in result) {
                throw new Error(getErrorMessage(result.err));
            }
            
            if (hasBids) {
                showInfo('Auction completed! The highest bidder has won.', 'success');
            } else {
                showInfo('Offer expired. Assets are being returned.', 'success');
            }
            await fetchData();
        } catch (e) {
            console.error('Failed to process expiration:', e);
            showInfo(`Error: ${e.message}`, 'error');
        } finally {
            setActionLoading(null);
        }
    };
    
    const handleRefundBid = async (bidId) => {
        if (!identity) return;
        
        setActionLoading(`refund-${bidId}`);
        try {
            const actor = createSneedexActor(identity);
            const result = await actor.refundBid(BigInt(bidId));
            
            if ('err' in result) {
                throw new Error(getErrorMessage(result.err));
            }
            
            showInfo('Bid refunded successfully!', 'success');
            await fetchData();
        } catch (e) {
            console.error('Failed to refund bid:', e);
            showInfo(`Error: ${e.message}`, 'error');
        } finally {
            setActionLoading(null);
        }
    };
    
    const handleWithdrawExcess = async (bid, escrowBalance) => {
        if (!identity) return;
        
        const excess = escrowBalance - bid.amount;
        if (excess <= 0n) {
            showInfo('No excess funds to withdraw', 'warning');
            return;
        }
        
        // Ask user how much to withdraw
        const maxWithdrawable = Number(excess) / 1e8;
        const amountStr = window.prompt(
            `How much to withdraw?\nExcess available: ${maxWithdrawable.toFixed(8)} tokens\n(Leave some for potential fees if needed)`,
            maxWithdrawable.toFixed(8)
        );
        
        if (!amountStr) return;
        
        const withdrawAmount = parseAmount(parseFloat(amountStr), 8);
        if (withdrawAmount <= 0n || withdrawAmount > excess) {
            showInfo(`Invalid amount. Max: ${maxWithdrawable.toFixed(8)}`, 'error');
            return;
        }
        
        setActionLoading(`withdraw-${bid.id}`);
        try {
            const actor = createSneedexActor(identity);
            const result = await actor.withdrawBidEscrow(bid.id, withdrawAmount);
            
            if ('err' in result) {
                throw new Error(getErrorMessage(result.err));
            }
            
            showInfo('Withdrawal successful!', 'success');
            await fetchData();
        } catch (e) {
            console.error('Failed to withdraw:', e);
            showInfo(`Error: ${e.message}`, 'error');
        } finally {
            setActionLoading(null);
        }
    };
    
    const getStateBadgeStyle = (state) => {
        const baseStyle = {
            padding: '4px 12px',
            borderRadius: '6px',
            fontSize: '0.8rem',
            fontWeight: '600',
        };
        
        const stateStr = typeof state === 'string' ? state : getOfferStateString(state);
        
        switch (stateStr) {
            case 'Active':
            case 'Pending':
                return { ...baseStyle, background: `${theme.colors.success}20`, color: theme.colors.success };
            case 'Completed':
            case 'Won':
                return { ...baseStyle, background: `${theme.colors.accent}20`, color: theme.colors.accent };
            case 'Expired':
            case 'Lost':
                return { ...baseStyle, background: `${theme.colors.mutedText}20`, color: theme.colors.mutedText };
            case 'Cancelled':
            case 'Refunded':
                return { ...baseStyle, background: `${theme.colors.warning}20`, color: theme.colors.warning };
            case 'Draft':
            case 'Pending Escrow':
                return { ...baseStyle, background: `${theme.colors.warning}20`, color: theme.colors.warning };
            default:
                return { ...baseStyle, background: `${theme.colors.mutedText}20`, color: theme.colors.mutedText };
        }
    };
    
    const getAssetIcons = (assets) => {
        return assets.map((a, i) => {
            const type = getAssetType(a.asset);
            if (type === 'Canister') return <FaCubes key={i} style={{ color: theme.colors.accent }} />;
            if (type === 'SNSNeuron') return <FaBrain key={i} style={{ color: theme.colors.success }} />;
            if (type === 'ICRC1Token') return <FaCoins key={i} style={{ color: theme.colors.warning }} />;
            return null;
        });
    };

    const styles = {
        container: {
            maxWidth: '1200px',
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
        tabs: {
            display: 'flex',
            gap: '0.5rem',
            marginBottom: '2rem',
            background: theme.colors.secondaryBg,
            padding: '6px',
            borderRadius: '12px',
            width: 'fit-content',
        },
        tab: {
            padding: '12px 24px',
            borderRadius: '8px',
            border: 'none',
            fontSize: '1rem',
            fontWeight: '600',
            cursor: 'pointer',
            transition: 'all 0.3s ease',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
        },
        activeTab: {
            background: theme.colors.accent,
            color: theme.colors.primaryBg,
        },
        inactiveTab: {
            background: 'transparent',
            color: theme.colors.mutedText,
        },
        grid: {
            display: 'flex',
            flexDirection: 'column',
            gap: '1rem',
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
            alignItems: 'center',
            marginBottom: '1rem',
        },
        cardTitle: {
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
        },
        offerId: {
            fontSize: '1.1rem',
            fontWeight: '600',
            color: theme.colors.primaryText,
        },
        assetIcons: {
            display: 'flex',
            gap: '6px',
            fontSize: '1rem',
        },
        cardContent: {
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
            gap: '1rem',
        },
        infoItem: {
            padding: '0.75rem',
            background: theme.colors.tertiaryBg,
            borderRadius: '8px',
        },
        infoLabel: {
            fontSize: '0.75rem',
            color: theme.colors.mutedText,
            textTransform: 'uppercase',
            marginBottom: '4px',
        },
        infoValue: {
            fontSize: '1rem',
            fontWeight: '600',
            color: theme.colors.primaryText,
        },
        actionButtons: {
            display: 'flex',
            gap: '0.75rem',
            marginTop: '1rem',
            paddingTop: '1rem',
            borderTop: `1px solid ${theme.colors.border}`,
        },
        actionButton: {
            padding: '8px 16px',
            borderRadius: '8px',
            border: 'none',
            fontSize: '0.9rem',
            fontWeight: '600',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            transition: 'all 0.3s ease',
        },
        primaryAction: {
            background: `linear-gradient(135deg, ${theme.colors.accent}, ${theme.colors.accent}cc)`,
            color: theme.colors.primaryBg,
        },
        secondaryAction: {
            background: theme.colors.tertiaryBg,
            color: theme.colors.primaryText,
            border: `1px solid ${theme.colors.border}`,
        },
        successAction: {
            background: `linear-gradient(135deg, ${theme.colors.success}, ${theme.colors.success}cc)`,
            color: theme.colors.primaryBg,
        },
        warningAction: {
            background: `${theme.colors.warning}20`,
            color: theme.colors.warning,
            border: `1px solid ${theme.colors.warning}`,
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
    };

    if (!isAuthenticated) {
        return (
            <div className='page-container' style={{ background: theme.colors.primaryGradient, minHeight: '100vh' }}>
                <Header />
                <main style={styles.container}>
                    <div style={styles.emptyState}>
                        <div style={styles.emptyIcon}>🔐</div>
                        <h3 style={styles.emptyTitle}>Connect Your Wallet</h3>
                        <p style={styles.emptyText}>Please connect your wallet to view your offers and bids.</p>
                    </div>
                </main>
            </div>
        );
    }

    return (
        <div className='page-container' style={{ background: theme.colors.primaryGradient, minHeight: '100vh' }}>
            <Header />
            <main style={styles.container}>
                <div style={styles.header}>
                    <h1 style={styles.title}>My Sneedex</h1>
                    <div style={styles.headerButtons}>
                        <button
                            style={styles.refreshButton}
                            onClick={fetchData}
                            disabled={loading}
                        >
                            <FaSync style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
                            {loading ? 'Loading...' : 'Refresh'}
                        </button>
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
                            <FaPlus /> Create Offer
                        </Link>
                    </div>
                </div>
                
                {error && (
                    <div style={styles.errorState}>
                        {error}
                    </div>
                )}
                
                <div style={styles.tabs}>
                    <button
                        style={{ ...styles.tab, ...(activeTab === 'offers' ? styles.activeTab : styles.inactiveTab) }}
                        onClick={() => setActiveTab('offers')}
                    >
                        <FaGavel /> My Offers ({myOffers.length})
                    </button>
                    <button
                        style={{ ...styles.tab, ...(activeTab === 'bids' ? styles.activeTab : styles.inactiveTab) }}
                        onClick={() => setActiveTab('bids')}
                    >
                        <FaHandHoldingUsd /> My Bids ({myBids.length})
                    </button>
                </div>
                
                {loading && myOffers.length === 0 && myBids.length === 0 ? (
                    <div style={styles.loadingState}>
                        <div style={{ fontSize: '2rem', marginBottom: '1rem' }}>⏳</div>
                        Loading your data...
                    </div>
                ) : activeTab === 'offers' ? (
                    <>
                        {/* Filter Controls for Offers */}
                        <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '12px',
                            marginBottom: '1rem',
                            flexWrap: 'wrap'
                        }}>
                            <span style={{ color: theme.colors.mutedText, fontSize: '0.9rem' }}>Filter:</span>
                            <select
                                value={offerFilter}
                                onChange={(e) => setOfferFilter(e.target.value)}
                                style={{
                                    padding: '8px 12px',
                                    borderRadius: '8px',
                                    border: `1px solid ${theme.colors.border}`,
                                    background: theme.colors.secondaryBg,
                                    color: theme.colors.primaryText,
                                    fontSize: '0.9rem',
                                    cursor: 'pointer'
                                }}
                            >
                                <option value="all">All ({myOffers.length})</option>
                                <option value="active">Active ({myOffers.filter(o => 'Active' in o.state).length})</option>
                                <option value="completed">Completed ({myOffers.filter(o => 'Completed' in o.state).length})</option>
                                <option value="draft">Draft ({myOffers.filter(o => 'Draft' in o.state || 'PendingEscrow' in o.state).length})</option>
                                <option value="cancelled">Cancelled ({myOffers.filter(o => 'Cancelled' in o.state).length})</option>
                                <option value="expired">Expired ({myOffers.filter(o => 'Expired' in o.state).length})</option>
                                <option value="reclaimed">Reclaimed ({myOffers.filter(o => 'Reclaimed' in o.state).length})</option>
                                <option value="claimed">Claimed ({myOffers.filter(o => 'Claimed' in o.state).length})</option>
                            </select>
                            {offerFilter !== 'all' && (
                                <button
                                    onClick={() => setOfferFilter('all')}
                                    style={{
                                        padding: '6px 10px',
                                        borderRadius: '6px',
                                        border: 'none',
                                        background: `${theme.colors.accent}20`,
                                        color: theme.colors.accent,
                                        fontSize: '0.8rem',
                                        cursor: 'pointer',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '4px'
                                    }}
                                >
                                    <FaTimes /> Clear filter
                                </button>
                            )}
                        </div>
                        
                        {/* Top Pagination for Offers */}
                        {sortedOffers.length > ITEMS_PER_PAGE && (
                            <div style={{ ...styles.pagination, marginTop: 0, paddingTop: 0, borderTop: 'none', marginBottom: '1.5rem', paddingBottom: '1rem', borderBottom: `1px solid ${theme.colors.border}` }}>
                                <button
                                    style={{
                                        ...styles.paginationButton,
                                        opacity: offersPage === 1 ? 0.5 : 1,
                                        cursor: offersPage === 1 ? 'not-allowed' : 'pointer'
                                    }}
                                    onClick={() => setOffersPage(p => Math.max(1, p - 1))}
                                    disabled={offersPage === 1}
                                >
                                    <FaChevronLeft /> Previous
                                </button>
                                <span style={styles.paginationInfo}>
                                    Page {offersPage} of {totalOffersPages} ({sortedOffers.length} offers)
                                </span>
                                <button
                                    style={{
                                        ...styles.paginationButton,
                                        opacity: offersPage === totalOffersPages ? 0.5 : 1,
                                        cursor: offersPage === totalOffersPages ? 'not-allowed' : 'pointer'
                                    }}
                                    onClick={() => setOffersPage(p => Math.min(totalOffersPages, p + 1))}
                                    disabled={offersPage === totalOffersPages}
                                >
                                    Next <FaChevronRight />
                                </button>
                            </div>
                        )}
                        <div style={styles.grid}>
                            {sortedOffers.length === 0 ? (
                                <div style={styles.emptyState}>
                                    <div style={styles.emptyIcon}>{offerFilter !== 'all' ? '🔍' : '📭'}</div>
                                    <h3 style={styles.emptyTitle}>
                                        {offerFilter !== 'all' ? 'No Matching Offers' : 'No Offers Yet'}
                                    </h3>
                                    <p style={styles.emptyText}>
                                        {offerFilter !== 'all' 
                                            ? `No offers match the filter "${offerFilter}". Try a different filter.`
                                            : "You haven't created any offers. Start selling your assets!"}
                                    </p>
                                    {offerFilter !== 'all' ? (
                                        <button 
                                            onClick={() => setOfferFilter('all')}
                                            style={styles.createButton}
                                        >
                                            Clear Filter
                                        </button>
                                    ) : (
                                        <Link to="/sneedex_create" style={styles.createButton}>
                                            <FaPlus /> Create Your First Offer
                                        </Link>
                                    )}
                                </div>
                            ) : (
                                paginatedOffers.map((offer) => {
                                const bidInfo = offersWithBids[Number(offer.id)] || {};
                                const tokenInfo = getTokenInfo(offer.price_token_ledger.toString());
                                const stateStr = getOfferStateString(offer.state);
                                const isActive = 'Active' in offer.state;
                                const isCompleted = 'Completed' in offer.state;
                                const isDraft = 'Draft' in offer.state || 'PendingEscrow' in offer.state;
                                
                                return (
                                    <div
                                        key={Number(offer.id)}
                                        style={styles.card}
                                        onClick={() => navigate(`/sneedex_offer/${offer.id}`)}
                                        onMouseEnter={(e) => {
                                            e.currentTarget.style.transform = 'translateY(-2px)';
                                            e.currentTarget.style.borderColor = theme.colors.accent;
                                        }}
                                        onMouseLeave={(e) => {
                                            e.currentTarget.style.transform = 'translateY(0)';
                                            e.currentTarget.style.borderColor = theme.colors.border;
                                        }}
                                    >
                                        <div style={styles.cardHeader}>
                                            <div style={styles.cardTitle}>
                                                <span style={styles.offerId}>Offer #{Number(offer.id)}</span>
                                                <div style={styles.assetIcons}>
                                                    {getAssetIcons(offer.assets)}
                                                </div>
                                            </div>
                                            <span style={getStateBadgeStyle(offer.state)}>{stateStr}</span>
                                        </div>
                                        
                                        <div style={styles.cardContent}>
                                            <div style={styles.infoItem}>
                                                <div style={styles.infoLabel}>Highest Bid</div>
                                                <div style={styles.infoValue}>
                                                    {bidInfo.highest_bid ? (
                                                        <>
                                                            {formatAmount(bidInfo.highest_bid.amount, tokenInfo.decimals)} {tokenInfo.symbol}
                                                            {(() => {
                                                                const paymentLedger = offer.price_token_ledger.toString();
                                                                const paymentPrice = tokenPrices[paymentLedger];
                                                                const bidUsd = paymentPrice ? calculateUsdValue(bidInfo.highest_bid.amount, tokenInfo.decimals, paymentPrice) : null;
                                                                return bidUsd > 0 ? (
                                                                    <div style={{ color: theme.colors.mutedText, fontSize: '0.8rem', marginTop: '2px' }}>
                                                                        {formatUsd(bidUsd)}
                                                                    </div>
                                                                ) : null;
                                                            })()}
                                                        </>
                                                    ) : 'No bids'}
                                                </div>
                                            </div>
                                            <div style={styles.infoItem}>
                                                <div style={styles.infoLabel}>Total Bids</div>
                                                <div style={styles.infoValue}>{bidInfo.bids?.length || 0}</div>
                                            </div>
                                            <div style={styles.infoItem}>
                                                <div style={styles.infoLabel}>Time Left</div>
                                                <div style={{
                                                    ...styles.infoValue,
                                                    color: isActive && isOfferPastExpiration(offer.expiration[0]) 
                                                        ? theme.colors.warning 
                                                        : styles.infoValue?.color
                                                }}>
                                                    {isActive && isOfferPastExpiration(offer.expiration[0]) && (
                                                        <FaClock style={{ marginRight: '4px', verticalAlign: 'middle' }} />
                                                    )}
                                                    {formatTimeRemaining(offer.expiration[0])}
                                                </div>
                                            </div>
                                            <div style={styles.infoItem}>
                                                <div style={styles.infoLabel}>Created</div>
                                                <div style={styles.infoValue}>{formatDate(offer.created_at)}</div>
                                            </div>
                                        </div>
                                        
                                        {isCompleted && (
                                            <div style={styles.actionButtons} onClick={(e) => e.stopPropagation()}>
                                                <button 
                                                    style={{ ...styles.actionButton, ...styles.successAction }}
                                                    onClick={() => handleClaimPayment(offer.id)}
                                                    disabled={actionLoading === `claim-payment-${offer.id}`}
                                                >
                                                    <FaCheck /> {actionLoading === `claim-payment-${offer.id}` ? 'Processing...' : 'Claim Payment'}
                                                </button>
                                            </div>
                                        )}
                                        
                                        {isActive && (bidInfo.bids?.length || 0) > 0 && (
                                            <div style={styles.actionButtons} onClick={(e) => e.stopPropagation()}>
                                                <button 
                                                    style={{ ...styles.actionButton, ...styles.primaryAction }}
                                                    onClick={() => handleAcceptBid(offer.id)}
                                                    disabled={actionLoading === `accept-${offer.id}`}
                                                >
                                                    {actionLoading === `accept-${offer.id}` ? 'Processing...' : 'Accept Highest Bid'}
                                                </button>
                                            </div>
                                        )}
                                        
                                        {(isActive || isDraft) && !isOfferPastExpiration(offer.expiration[0]) && (
                                            <div style={styles.actionButtons} onClick={(e) => e.stopPropagation()}>
                                                <button 
                                                    style={{ ...styles.actionButton, ...styles.warningAction }}
                                                    onClick={() => handleCancelOffer(offer.id)}
                                                    disabled={actionLoading === `cancel-${offer.id}`}
                                                >
                                                    <FaTimes /> {actionLoading === `cancel-${offer.id}` ? 'Processing...' : 'Cancel Offer'}
                                                </button>
                                            </div>
                                        )}
                                        
                                        {/* Process Expiration button for expired active offers */}
                                        {isActive && offer.expiration[0] && isOfferPastExpiration(offer.expiration[0]) && (
                                            <div style={styles.actionButtons} onClick={(e) => e.stopPropagation()}>
                                                <button 
                                                    style={{ 
                                                        ...styles.actionButton, 
                                                        background: `${theme.colors.warning}20`,
                                                        color: theme.colors.warning,
                                                        border: `1px solid ${theme.colors.warning}50`
                                                    }}
                                                    onClick={() => handleProcessExpiration(offer.id, (bidInfo.bids?.length || 0) > 0)}
                                                    disabled={actionLoading === `process-expiration-${offer.id}`}
                                                >
                                                    <FaClock /> {actionLoading === `process-expiration-${offer.id}` 
                                                        ? 'Processing...' 
                                                        : ((bidInfo.bids?.length || 0) > 0 ? 'Finalize Auction' : 'Process Expiration')
                                                    }
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                );
                            })
                        )}
                        
                        {/* Bottom Offers Pagination */}
                        {sortedOffers.length > ITEMS_PER_PAGE && (
                            <div style={styles.pagination}>
                                <button
                                    style={{
                                        ...styles.paginationButton,
                                        opacity: offersPage === 1 ? 0.5 : 1,
                                        cursor: offersPage === 1 ? 'not-allowed' : 'pointer'
                                    }}
                                    onClick={() => setOffersPage(p => Math.max(1, p - 1))}
                                    disabled={offersPage === 1}
                                >
                                    <FaChevronLeft /> Previous
                                </button>
                                <span style={styles.paginationInfo}>
                                    Page {offersPage} of {totalOffersPages} ({sortedOffers.length} offers)
                                </span>
                                <button
                                    style={{
                                        ...styles.paginationButton,
                                        opacity: offersPage === totalOffersPages ? 0.5 : 1,
                                        cursor: offersPage === totalOffersPages ? 'not-allowed' : 'pointer'
                                    }}
                                    onClick={() => setOffersPage(p => Math.min(totalOffersPages, p + 1))}
                                    disabled={offersPage === totalOffersPages}
                                >
                                    Next <FaChevronRight />
                                </button>
                            </div>
                        )}
                        </div>
                    </>
                ) : (
                    <>
                        {/* Filter Controls for Bids */}
                        <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '12px',
                            marginBottom: '1rem',
                            flexWrap: 'wrap'
                        }}>
                            <span style={{ color: theme.colors.mutedText, fontSize: '0.9rem' }}>Filter:</span>
                            <select
                                value={bidFilter}
                                onChange={(e) => setBidFilter(e.target.value)}
                                style={{
                                    padding: '8px 12px',
                                    borderRadius: '8px',
                                    border: `1px solid ${theme.colors.border}`,
                                    background: theme.colors.secondaryBg,
                                    color: theme.colors.primaryText,
                                    fontSize: '0.9rem',
                                    cursor: 'pointer'
                                }}
                            >
                                <option value="all">All ({myBids.length})</option>
                                <option value="pending">Pending ({myBids.filter(b => 'Pending' in b.state).length})</option>
                                <option value="won">Won ({myBids.filter(b => 'Won' in b.state).length})</option>
                                <option value="lost">Lost ({myBids.filter(b => 'Lost' in b.state).length})</option>
                                <option value="refunded">Refunded ({myBids.filter(b => 'Refunded' in b.state).length})</option>
                            </select>
                            {bidFilter !== 'all' && (
                                <button
                                    onClick={() => setBidFilter('all')}
                                    style={{
                                        padding: '6px 10px',
                                        borderRadius: '6px',
                                        border: 'none',
                                        background: `${theme.colors.accent}20`,
                                        color: theme.colors.accent,
                                        fontSize: '0.8rem',
                                        cursor: 'pointer',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '4px'
                                    }}
                                >
                                    <FaTimes /> Clear filter
                                </button>
                            )}
                        </div>
                        
                        {/* Top Pagination for Bids */}
                        {sortedBids.length > ITEMS_PER_PAGE && (
                            <div style={{ ...styles.pagination, marginTop: 0, paddingTop: 0, borderTop: 'none', marginBottom: '1.5rem', paddingBottom: '1rem', borderBottom: `1px solid ${theme.colors.border}` }}>
                                <button
                                    style={{
                                        ...styles.paginationButton,
                                        opacity: bidsPage === 1 ? 0.5 : 1,
                                        cursor: bidsPage === 1 ? 'not-allowed' : 'pointer'
                                    }}
                                    onClick={() => setBidsPage(p => Math.max(1, p - 1))}
                                    disabled={bidsPage === 1}
                                >
                                    <FaChevronLeft /> Previous
                                </button>
                                <span style={styles.paginationInfo}>
                                    Page {bidsPage} of {totalBidsPages} ({sortedBids.length} bids)
                                </span>
                                <button
                                    style={{
                                        ...styles.paginationButton,
                                        opacity: bidsPage === totalBidsPages ? 0.5 : 1,
                                        cursor: bidsPage === totalBidsPages ? 'not-allowed' : 'pointer'
                                    }}
                                    onClick={() => setBidsPage(p => Math.min(totalBidsPages, p + 1))}
                                    disabled={bidsPage === totalBidsPages}
                                >
                                    Next <FaChevronRight />
                                </button>
                            </div>
                        )}
                        <div style={styles.grid}>
                            {sortedBids.length === 0 ? (
                                <div style={styles.emptyState}>
                                    <div style={styles.emptyIcon}>{bidFilter !== 'all' ? '🔍' : '🎯'}</div>
                                    <h3 style={styles.emptyTitle}>
                                        {bidFilter !== 'all' ? 'No Matching Bids' : 'No Bids Yet'}
                                    </h3>
                                    <p style={styles.emptyText}>
                                        {bidFilter !== 'all'
                                            ? `No bids match the filter "${bidFilter}". Try a different filter.`
                                            : "You haven't placed any bids. Browse the marketplace to find offers!"}
                                    </p>
                                    {bidFilter !== 'all' ? (
                                        <button 
                                            onClick={() => setBidFilter('all')}
                                            style={{ ...styles.createButton, background: `linear-gradient(135deg, ${theme.colors.accent}, ${theme.colors.accent}cc)` }}
                                        >
                                            Clear Filter
                                        </button>
                                    ) : (
                                        <Link to="/sneedex_offers" style={{ ...styles.createButton, background: `linear-gradient(135deg, ${theme.colors.accent}, ${theme.colors.accent}cc)` }}>
                                            <FaGavel /> Browse Marketplace
                                        </Link>
                                    )}
                                </div>
                            ) : (
                                paginatedBids.map((bid) => {
                                const stateStr = getBidStateString(bid.state);
                                const isWon = 'Won' in bid.state;
                                const isLost = 'Lost' in bid.state;
                                const isPending = 'Pending' in bid.state;
                                const escrowBalance = bidEscrowBalances[Number(bid.id)];
                                const hasExcess = escrowBalance !== undefined && escrowBalance > bid.amount;
                                const excessAmount = hasExcess ? escrowBalance - bid.amount : 0n;
                                
                                // Get token info for this bid's offer
                                const offerInfo = bidOfferInfo[Number(bid.offer_id)];
                                const bidTokenInfo = offerInfo ? getTokenInfo(offerInfo.price_token_ledger) : { symbol: 'tokens', decimals: 8 };
                                const bidTokenPrice = offerInfo ? tokenPrices[offerInfo.price_token_ledger] : null;
                                
                                return (
                                    <div
                                        key={Number(bid.id)}
                                        style={styles.card}
                                        onClick={() => navigate(`/sneedex_offer/${bid.offer_id}`)}
                                        onMouseEnter={(e) => {
                                            e.currentTarget.style.transform = 'translateY(-2px)';
                                            e.currentTarget.style.borderColor = theme.colors.accent;
                                        }}
                                        onMouseLeave={(e) => {
                                            e.currentTarget.style.transform = 'translateY(0)';
                                            e.currentTarget.style.borderColor = theme.colors.border;
                                        }}
                                    >
                                        <div style={styles.cardHeader}>
                                            <div style={styles.cardTitle}>
                                                <span style={styles.offerId}>Bid on Offer #{Number(bid.offer_id)}</span>
                                            </div>
                                            <span style={getStateBadgeStyle(stateStr)}>{stateStr}</span>
                                        </div>
                                        
                                        <div style={styles.cardContent}>
                                            <div style={styles.infoItem}>
                                                <div style={styles.infoLabel}>Your Bid</div>
                                                <div style={styles.infoValue}>
                                                    {formatAmount(bid.amount, bidTokenInfo.decimals)} {bidTokenInfo.symbol}
                                                    {bidTokenPrice && (
                                                        <div style={{ color: theme.colors.mutedText, fontSize: '0.8rem', marginTop: '2px' }}>
                                                            {formatUsd(calculateUsdValue(bid.amount, bidTokenInfo.decimals, bidTokenPrice))}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                            <div style={styles.infoItem}>
                                                <div style={styles.infoLabel}>Escrow Balance</div>
                                                <div style={styles.infoValue}>
                                                    {escrowBalance !== undefined ? (
                                                        <span style={{ color: hasExcess ? theme.colors.success : theme.colors.primaryText }}>
                                                            {formatAmount(escrowBalance, bidTokenInfo.decimals)} {bidTokenInfo.symbol}
                                                            {hasExcess && <span style={{ fontSize: '0.8rem' }}> (+{formatAmount(excessAmount, bidTokenInfo.decimals)} excess)</span>}
                                                        </span>
                                                    ) : (
                                                        bid.tokens_escrowed ? 'Loading...' : '—'
                                                    )}
                                                </div>
                                            </div>
                                            <div style={styles.infoItem}>
                                                <div style={styles.infoLabel}>Placed</div>
                                                <div style={styles.infoValue}>{formatDate(bid.created_at)}</div>
                                            </div>
                                        </div>
                                        
                                        {/* Excess funds warning */}
                                        {hasExcess && (
                                            <div style={{
                                                marginTop: '1rem',
                                                padding: '0.75rem',
                                                background: `${theme.colors.success}15`,
                                                border: `1px solid ${theme.colors.success}`,
                                                borderRadius: '8px',
                                                fontSize: '0.85rem',
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '8px',
                                                color: theme.colors.success
                                            }} onClick={(e) => e.stopPropagation()}>
                                                <FaWallet />
                                                <span>You have {formatAmount(excessAmount, bidTokenInfo.decimals)} excess {bidTokenInfo.symbol} in escrow</span>
                                                <button
                                                    style={{
                                                        ...styles.actionButton,
                                                        marginLeft: 'auto',
                                                        padding: '6px 12px',
                                                        fontSize: '0.8rem',
                                                        background: theme.colors.success,
                                                        color: theme.colors.primaryBg
                                                    }}
                                                    onClick={() => handleWithdrawExcess(bid, escrowBalance)}
                                                    disabled={actionLoading === `withdraw-${bid.id}`}
                                                >
                                                    {actionLoading === `withdraw-${bid.id}` ? 'Processing...' : 'Withdraw'}
                                                </button>
                                            </div>
                                        )}
                                        
                                        {isWon && (
                                            <div style={styles.actionButtons} onClick={(e) => e.stopPropagation()}>
                                                <button 
                                                    style={{ ...styles.actionButton, ...styles.successAction }}
                                                    onClick={() => handleClaimAssets(bid.offer_id)}
                                                    disabled={actionLoading === `claim-assets-${bid.offer_id}`}
                                                >
                                                    <FaCheck /> {actionLoading === `claim-assets-${bid.offer_id}` ? 'Processing...' : 'Claim Assets'}
                                                </button>
                                            </div>
                                        )}
                                        
                                        {isLost && bid.tokens_escrowed && (
                                            <div style={styles.actionButtons} onClick={(e) => e.stopPropagation()}>
                                                <button 
                                                    style={{ ...styles.actionButton, ...styles.primaryAction }}
                                                    onClick={() => handleRefundBid(bid.id)}
                                                    disabled={actionLoading === `refund-${bid.id}`}
                                                >
                                                    💸 {actionLoading === `refund-${bid.id}` ? 'Processing...' : 'Refund Bid'}
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                );
                            })
                        )}
                        
                            {/* Bottom Bids Pagination */}
                            {sortedBids.length > ITEMS_PER_PAGE && (
                                <div style={styles.pagination}>
                                    <button
                                        style={{
                                            ...styles.paginationButton,
                                            opacity: bidsPage === 1 ? 0.5 : 1,
                                            cursor: bidsPage === 1 ? 'not-allowed' : 'pointer'
                                        }}
                                        onClick={() => setBidsPage(p => Math.max(1, p - 1))}
                                        disabled={bidsPage === 1}
                                    >
                                        <FaChevronLeft /> Previous
                                    </button>
                                    <span style={styles.paginationInfo}>
                                        Page {bidsPage} of {totalBidsPages} ({sortedBids.length} bids)
                                    </span>
                                    <button
                                        style={{
                                            ...styles.paginationButton,
                                            opacity: bidsPage === totalBidsPages ? 0.5 : 1,
                                            cursor: bidsPage === totalBidsPages ? 'not-allowed' : 'pointer'
                                        }}
                                        onClick={() => setBidsPage(p => Math.min(totalBidsPages, p + 1))}
                                        disabled={bidsPage === totalBidsPages}
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
            `}</style>
            
            {/* Info Modal */}
            <InfoModal
                show={infoModal.show}
                onClose={closeInfoModal}
                title={infoModal.title}
                message={infoModal.message}
                type={infoModal.type}
            />
            
            {/* Confirmation Modal */}
            <ConfirmationModal
                show={confirmModal.show}
                onClose={() => setConfirmModal({ ...confirmModal, show: false })}
                onSubmit={confirmModal.action}
                message={confirmModal.message}
                doAwait={true}
            />
        </div>
    );
}

export default SneedexMy;
