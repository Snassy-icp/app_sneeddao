import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Principal } from '@dfinity/principal';
import { useAuth } from '../AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { createActor as createRllActor, canisterId as rllCanisterId } from 'declarations/rll';
import { createActor as createIcrc1Actor } from 'external/icrc1_ledger';
import Header from '../components/Header';
import { fetchUserNeuronsForSns } from '../utils/NeuronUtils';
import Notification from '../Notification';
import priceService from '../services/PriceService';
import { useTokenMetadata } from '../hooks/useTokenMetadata';
import { getRelativeTime, getFullDate } from '../utils/DateUtils';
import { FaExternalLinkAlt, FaGift, FaCoins, FaHistory, FaCheckCircle, FaWallet, FaChevronDown } from 'react-icons/fa';

const SNEED_SNS_ROOT = 'fp274-iaaaa-aaaaq-aacha-cai';

// Custom CSS for animations
const customStyles = `
@keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
}

@keyframes fadeInUp {
    from {
        opacity: 0;
        transform: translateY(20px);
    }
    to {
        opacity: 1;
        transform: translateY(0);
    }
}

@keyframes shimmer {
    0% { background-position: -200% 0; }
    100% { background-position: 200% 0; }
}

@keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.7; }
}

@keyframes float {
    0%, 100% { transform: translateY(0px); }
    50% { transform: translateY(-5px); }
}

.rewards-card-animate {
    animation: fadeInUp 0.5s ease-out forwards;
}

.rewards-card {
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.rewards-card:hover {
    transform: translateY(-3px);
    box-shadow: 0 12px 40px rgba(212, 175, 55, 0.15);
}

.stat-card:hover {
    transform: translateY(-2px);
}

.claim-btn {
    transition: all 0.3s ease;
    position: relative;
    overflow: hidden;
}

.claim-btn::before {
    content: '';
    position: absolute;
    top: 0;
    left: -100%;
    width: 100%;
    height: 100%;
    background: linear-gradient(90deg, transparent, rgba(255,255,255,0.2), transparent);
    transition: left 0.5s;
}

.claim-btn:hover::before {
    left: 100%;
}

.rewards-pulse {
    animation: pulse 2s ease-in-out infinite;
}

.rewards-float {
    animation: float 3s ease-in-out infinite;
}
`;

// Helper functions
const getDissolveState = (neuron) => {
    if (!neuron.dissolve_state?.[0]) return 'Unknown';
    
    if ('DissolveDelaySeconds' in neuron.dissolve_state[0]) {
        const seconds = Number(neuron.dissolve_state[0].DissolveDelaySeconds);
        const days = Math.floor(seconds / (24 * 60 * 60));
        return `Locked for ${days} days`;
    }
    
    if ('WhenDissolvedTimestampSeconds' in neuron.dissolve_state[0]) {
        const dissolveTime = Number(neuron.dissolve_state[0].WhenDissolvedTimestampSeconds);
        const now = Math.floor(Date.now() / 1000);
        if (dissolveTime <= now) {
            return 'Dissolved';
        }
        const daysLeft = Math.floor((dissolveTime - now) / (24 * 60 * 60));
        return `Dissolving (${daysLeft} days left)`;
    }
    
    return 'Unknown';
};

const formatE8s = (e8s) => {
    if (!e8s) return '0';
    return (Number(e8s) / 100000000).toFixed(8);
};

function Rewards() {
    const navigate = useNavigate();
    const { identity, isAuthenticated, login } = useAuth();
    const { theme } = useTheme();
    const { fetchTokenMetadata, getTokenMetadata, isLoadingMetadata } = useTokenMetadata();
    
    const [userBalances, setUserBalances] = useState([]);
    const [loadingUserBalances, setLoadingUserBalances] = useState(true);
    const [isClaimHistoryExpanded, setIsClaimHistoryExpanded] = useState(false);
    const [userClaimEvents, setUserClaimEvents] = useState([]);
    const [loadingUserEvents, setLoadingUserEvents] = useState(true);
    const [claimingTokens, setClaimingTokens] = useState({});
    const [notification, setNotification] = useState(null);
    const [tokenSymbols, setTokenSymbols] = useState({});
    const [tokenPrices, setTokenPrices] = useState({});
    const [tokenDecimals, setTokenDecimals] = useState({});
    const [tokenLogos, setTokenLogos] = useState({});

    // Luxurious color palette
    const goldPrimary = '#d4af37';
    const goldLight = '#f4d03f';
    const goldDark = '#aa8c2c';

    // Function to fetch neurons directly from SNS
    const fetchNeuronsFromSns = async () => {
        const sneedGovernanceCanisterId = 'fi3zi-fyaaa-aaaaq-aachq-cai';
        return await fetchUserNeuronsForSns(identity, sneedGovernanceCanisterId);
    };

    // Fetch token symbol
    const fetchTokenSymbol = async (tokenId) => {
        try {
            const icrc1Actor = createIcrc1Actor(tokenId.toString(), {
                agentOptions: { identity }
            });
            const metadata = await icrc1Actor.icrc1_metadata();
            const symbolEntry = metadata.find(entry => entry[0] === 'icrc1:symbol');
            if (symbolEntry && symbolEntry[1]) {
                return symbolEntry[1].Text;
            }
        } catch (error) {
            console.error('Error fetching token symbol:', error);
        }
        return tokenId.toString();
    };

    // Fetch token fee
    const fetchTokenFee = async (tokenId) => {
        try {
            const icrc1Actor = createIcrc1Actor(tokenId.toString(), {
                agentOptions: { identity }
            });
            const metadata = await icrc1Actor.icrc1_metadata();
            const feeEntry = metadata.find(entry => entry[0] === 'icrc1:fee');
            if (feeEntry && feeEntry[1]) {
                return BigInt(feeEntry[1].Nat);
            }
        } catch (error) {
            console.error('Error fetching token fee:', error);
        }
        return BigInt(10000);
    };

    // Fetch token metadata and prices
    useEffect(() => {
        const fetchUserBalances = async () => {
            if (!isAuthenticated || !identity) {
                setLoadingUserBalances(false);
                return;
            }
            
            setLoadingUserBalances(true);
            try {
                const neurons = await fetchNeuronsFromSns();
                const rllActor = createRllActor(rllCanisterId, {
                    agentOptions: { identity }
                });
                const balances = await rllActor.balances_of_hotkey_neurons(neurons);
                setUserBalances(balances);

                const symbols = {};
                const decimals = {};
                const prices = {};
                const logos = {};
                
                for (const [tokenId] of balances) {
                    const tokenIdStr = tokenId.toString();
                    
                    // Fetch using useTokenMetadata hook for logo support
                    const metadata = await fetchTokenMetadata(tokenIdStr);
                    if (metadata) {
                        symbols[tokenIdStr] = metadata.symbol;
                        decimals[tokenIdStr] = metadata.decimals;
                        logos[tokenIdStr] = metadata.logo;
                        } else {
                        symbols[tokenIdStr] = await fetchTokenSymbol(tokenId);
                        decimals[tokenIdStr] = 8;
                    }
                    
                    // Fetch price
                    try {
                        const price = await priceService.getTokenUSDPrice(tokenIdStr, decimals[tokenIdStr] || 8);
                        prices[tokenIdStr] = price;
                    } catch (error) {
                        console.warn(`Failed to fetch price for ${symbols[tokenIdStr]} (${tokenIdStr}):`, error);
                        prices[tokenIdStr] = 0;
                    }
                }
                
                setTokenSymbols(symbols);
                setTokenDecimals(decimals);
                setTokenPrices(prices);
                setTokenLogos(logos);
            } catch (error) {
                console.error('Error fetching user balances:', error);
            } finally {
                setLoadingUserBalances(false);
            }
        };

        fetchUserBalances();
    }, [isAuthenticated, identity]);

    // Fetch user claim events
    useEffect(() => {
        const fetchUserEvents = async () => {
            if (!isAuthenticated || !identity) {
                setLoadingUserEvents(false);
                return;
            }
            
            setLoadingUserEvents(true);
            try {
                const rllActor = createRllActor(rllCanisterId, {
                    agentOptions: { identity }
                });
                const events = await rllActor.get_claim_events_for_hotkey(identity.getPrincipal());
                setUserClaimEvents(events);
                
                // Fetch logos for claim history tokens
                const uniqueTokenIds = [...new Set(events.map(e => e.token_id.toString()))];
                for (const tokenId of uniqueTokenIds) {
                    if (!tokenLogos[tokenId]) {
                        fetchTokenMetadata(tokenId);
                    }
                }
            } catch (error) {
                console.error('Error fetching user events:', error);
            } finally {
                setLoadingUserEvents(false);
            }
        };

        fetchUserEvents();
    }, [isAuthenticated, identity]);

    const handleClaimRewards = async (tokenId, balance) => {
        if (!balance || Number(balance) === 0) {
            setNotification({
                type: 'error',
                message: 'No rewards available to claim'
            });
            return;
        }

        const fee = await fetchTokenFee(tokenId);
        const token = {
            id: tokenId,
            symbol: tokenSymbols[tokenId.toString()] || tokenId.toString(),
            fee: fee
        };

        if (balance <= token.fee) {
            const msg = `Your ${token.symbol} rewards (${formatBalance(balance, 8)} ${token.symbol}) are less than the transaction fee (${formatBalance(token.fee, 8)} ${token.symbol}). Please wait until you have accumulated more rewards before claiming.`;
            setNotification({ type: 'error', message: msg });
            return;
        }

        setClaimingTokens(prev => ({ ...prev, [tokenId.toString()]: true }));
        try {
            const rllActor = createRllActor(rllCanisterId, {
                agentOptions: { identity }
            });
            const claim_results = await rllActor.claim_full_balance_of_hotkey(tokenId, token.fee);
            
            if ('Ok' in claim_results) {
                setNotification({
                    type: 'success',
                    message: `Successfully claimed ${formatBalance(balance, 8)} ${token.symbol}`
                });
                const neurons = await fetchNeuronsFromSns();
                const newBalances = await rllActor.balances_of_hotkey_neurons(neurons);
                setUserBalances(newBalances);
            } else {
                const error = claim_results.Err;
                let errorMessage = '';
                
                if (error.InsufficientFunds) {
                    errorMessage = `Insufficient funds. Available balance: ${formatBalance(error.InsufficientFunds.balance, 8)} ${token.symbol}`;
                } else if (error.BadFee) {
                    errorMessage = `Your ${token.symbol} rewards are less than the transaction fee. Please wait until you have accumulated more rewards.`;
                } else if (error.GenericError) {
                    errorMessage = error.GenericError.message;
                } else {
                    errorMessage = `Transfer failed: ${Object.keys(error)[0]}`;
                }
                
                setNotification({ type: 'error', message: errorMessage });
            }
        } catch (error) {
            console.error('Error claiming rewards:', error);
            setNotification({
                type: 'error',
                message: `Failed to claim ${token.symbol}: ${error.message}`
            });
        } finally {
            setClaimingTokens(prev => ({ ...prev, [tokenId.toString()]: false }));
        }
    };

    const formatBalance = (balance, decimals) => {
        if (!balance) return '0';
        const value = Number(balance) / Math.pow(10, decimals);
        return value.toLocaleString(undefined, { 
            minimumFractionDigits: 0,
            maximumFractionDigits: decimals 
        });
    };

    const getTokenUSDValue = (balance, tokenId) => {
        if (!balance || balance === 0n) return 0;
        const tokenIdStr = tokenId.toString();
        const decimals = tokenDecimals[tokenIdStr] || 8;
        const price = tokenPrices[tokenIdStr] || 0;
        const tokenAmount = Number(balance) / Math.pow(10, decimals);
        return tokenAmount * price;
    };

    const formatUSD = (usdValue) => {
        if (!usdValue || usdValue === 0) return '$0.00';
        return '$' + usdValue.toLocaleString(undefined, { 
            minimumFractionDigits: 2,
            maximumFractionDigits: 2 
        });
    };

    const getTotalRewardsUSD = () => {
        return userBalances.reduce((total, [tokenId, balance]) => {
            return total + getTokenUSDValue(balance, tokenId);
        }, 0);
    };

    const getTotalClaimedRewardsUSD = () => {
        const successfulClaims = userClaimEvents.filter(event => 
            'Success' in event.status
        );
        return successfulClaims.reduce((total, event) => {
            return total + getTokenUSDValue(event.amount, event.token_id);
        }, 0);
    };

    const groupEventsBySequence = (events) => {
        const grouped = {};
        events.forEach(event => {
            const seqNum = event.sequence_number.toString();
            if (!grouped[seqNum]) {
                grouped[seqNum] = [];
            }
            grouped[seqNum].push(event);
        });
        return grouped;
    };

    const getGroupStatus = (events) => {
        if (events.some(e => 'Success' in e.status)) return 'Success';
        if (events.some(e => 'Failed' in e.status)) return 'Failed';
        if (events.some(e => 'Pending' in e.status)) return 'Pending';
        return 'Unknown';
    };

    // Get token logo from state or metadata hook
    const getTokenLogo = (tokenIdStr) => {
        if (tokenLogos[tokenIdStr]) return tokenLogos[tokenIdStr];
        const metadata = getTokenMetadata(tokenIdStr);
        return metadata?.logo || null;
    };

    // Render token logo with fallback
    const renderTokenLogo = (tokenIdStr, size = 48) => {
        const logo = getTokenLogo(tokenIdStr);
        const symbol = tokenSymbols[tokenIdStr] || '?';
        
        if (logo) {
            return (
                <div className="token-logo-container" style={{
                    width: size,
                    height: size,
                    borderRadius: '50%',
                    overflow: 'hidden',
                    flexShrink: 0
                }}>
                    <img 
                        src={logo} 
                        alt={symbol}
                        style={{
                            width: '100%',
                            height: '100%',
                            objectFit: 'cover'
                        }}
                        onError={(e) => {
                            e.target.style.display = 'none';
                            e.target.nextSibling.style.display = 'flex';
                        }}
                    />
                    <div style={{
                        display: 'none',
                        width: '100%',
                        height: '100%',
                        background: `linear-gradient(135deg, ${goldPrimary}, ${goldLight})`,
            alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: size * 0.4,
                        fontWeight: 'bold',
                        color: '#1a1a1a'
                    }}>
                        {symbol.charAt(0)}
                    </div>
                </div>
            );
        }
        
        return (
            <div style={{
                width: size,
                height: size,
                borderRadius: '50%',
                background: `linear-gradient(135deg, ${goldPrimary}, ${goldLight})`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: size * 0.4,
                fontWeight: 'bold',
                color: '#1a1a1a',
                flexShrink: 0,
                boxShadow: `0 4px 15px ${goldPrimary}40`
            }}>
                {symbol.charAt(0)}
            </div>
        );
    };

    // Spinner component
    const Spinner = ({ size = 24 }) => (
        <div style={{
            width: size,
            height: size,
            border: `3px solid ${theme.colors.border}`,
            borderTop: `3px solid ${goldPrimary}`,
            borderRadius: '50%',
            animation: 'spin 1s linear infinite'
        }} />
    );

    return (
        <div className='page-container'>
            <style>{customStyles}</style>
            <Header />
            
            <main style={{
                background: theme.colors.primaryGradient,
                minHeight: '100vh'
            }}>
                {/* Hero Section */}
                <div style={{
                    background: `linear-gradient(135deg, ${theme.colors.primaryBg} 0%, ${goldPrimary}15 50%, ${goldLight}10 100%)`,
                    borderBottom: `1px solid ${theme.colors.border}`,
                    padding: '2rem 1.5rem',
                    position: 'relative',
                    overflow: 'hidden'
                }}>
                    {/* Background decorations */}
                    <div style={{
                        position: 'absolute',
                        top: '-50%',
                        right: '-10%',
                        width: '400px',
                        height: '400px',
                        background: `radial-gradient(circle, ${goldPrimary}20 0%, transparent 70%)`,
                        borderRadius: '50%',
                        pointerEvents: 'none'
                    }} />
                    <div style={{
                        position: 'absolute',
                        bottom: '-30%',
                        left: '-5%',
                        width: '300px',
                        height: '300px',
                        background: `radial-gradient(circle, ${goldLight}15 0%, transparent 70%)`,
                        borderRadius: '50%',
                        pointerEvents: 'none'
                    }} />
                    
                    <div style={{
                        maxWidth: '900px',
                        margin: '0 auto',
                        position: 'relative',
                        zIndex: 1
                    }}>
                        <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '1.25rem',
                            marginBottom: '1rem'
                        }}>
                            {/* Icon */}
                            <div className="rewards-float" style={{
                                width: '64px',
                                height: '64px',
                                minWidth: '64px',
                                maxWidth: '64px',
                                flexShrink: 0,
                                borderRadius: '16px',
                                background: `linear-gradient(135deg, ${goldPrimary}, ${goldLight})`,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                boxShadow: `0 8px 30px ${goldPrimary}40`
                            }}>
                                <FaGift size={28} color="#1a1a1a" />
                            </div>
                            
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <h1 style={{
                                    color: theme.colors.primaryText,
                                    fontSize: '2rem',
                                    fontWeight: '700',
                                    margin: 0,
                                    lineHeight: '1.2'
                                }}>
                                    Sneed Rewards
                                </h1>
                                <p style={{
                                    color: theme.colors.secondaryText,
                                    fontSize: '1rem',
                                    margin: '0.35rem 0 0 0'
                                }}>
                                    Claim your voting rewards earned through DAO participation
                                </p>
                            </div>
                        </div>
                        
                        {/* Quick Info Row */}
                        <div style={{
                            display: 'flex',
                            gap: '1.5rem',
                            flexWrap: 'wrap',
                            marginTop: '0.75rem'
                        }}>
                            {isAuthenticated && !loadingUserBalances && userBalances.length > 0 && (
                                <div style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '0.5rem',
                                    color: theme.colors.secondaryText,
                                    fontSize: '0.9rem'
                                }}>
                                    <FaCoins size={14} style={{ color: goldPrimary }} />
                                    <span><strong style={{ color: goldPrimary }}>{userBalances.filter(([_, b]) => b && Number(b) > 0).length}</strong> tokens to claim</span>
                                </div>
                            )}
                            {!isAuthenticated && (
                                <div style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '0.5rem',
                                    color: '#f39c12',
                                    background: 'rgba(243, 156, 18, 0.1)',
                                    padding: '0.5rem 1rem',
                                    borderRadius: '20px',
                                    fontSize: '0.9rem'
                                }}>
                                    <FaWallet size={14} />
                                    <span>Connect wallet to view rewards</span>
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* Main Content */}
                <div style={{
                    maxWidth: '900px',
                    margin: '0 auto',
                    padding: '2rem 1.5rem'
                }}>

                {!isAuthenticated ? (
                    /* Login Card */
                    <div className="rewards-card rewards-card-animate" style={{
                        background: theme.colors.secondaryBg,
                        borderRadius: '20px',
                        padding: '3rem 2rem',
                        textAlign: 'center',
                        border: `1px solid ${theme.colors.border}`,
                        opacity: 0,
                        animationDelay: '0.1s'
                    }}>
                        <div className="rewards-float" style={{
                            width: '80px',
                            height: '80px',
                            margin: '0 auto 1.5rem',
                            borderRadius: '50%',
                            background: `linear-gradient(135deg, ${goldPrimary}, ${goldLight})`,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            boxShadow: `0 8px 30px ${goldPrimary}40`
                        }}>
                            <FaGift size={32} color="#1a1a1a" />
                        </div>
                        <h2 style={{
                            color: theme.colors.primaryText, 
                            fontSize: '1.75rem',
                            marginBottom: '1rem',
                            fontWeight: '700'
                        }}>
                            Unlock Your Rewards
                        </h2>
                        <p style={{
                            color: theme.colors.secondaryText,
                            marginBottom: '0.75rem',
                            maxWidth: '400px',
                            margin: '0 auto 0.75rem',
                            lineHeight: '1.6',
                            fontSize: '1.05rem'
                        }}>
                            Connect your wallet to view and claim rewards earned through Sneed DAO governance participation.
                        </p>
                        <p style={{
                            color: theme.colors.mutedText,
                            marginBottom: '2rem',
                            maxWidth: '400px',
                            margin: '0 auto 2rem',
                            lineHeight: '1.5',
                            fontSize: '0.95rem'
                        }}>
                            Hotkey your neurons to the app to automatically accumulate rewards from voting.
                        </p>
                        <button 
                            onClick={login}
                            className="claim-btn"
                            style={{
                                background: `linear-gradient(135deg, ${goldPrimary}, ${goldDark})`,
                                color: '#1a1a1a',
                                border: 'none',
                                padding: '1rem 2.5rem',
                                borderRadius: '12px',
                                fontSize: '1.1rem',
                                fontWeight: '600',
                                cursor: 'pointer',
                                boxShadow: `0 4px 20px ${goldPrimary}40`
                            }}
                        >
                            Connect Wallet
                        </button>
                    </div>
                ) : loadingUserBalances ? (
                    /* Loading State */
                    <div style={{
                        background: theme.colors.secondaryBg,
                        borderRadius: '20px',
                        padding: '4rem 2rem',
                        textAlign: 'center',
                        border: `1px solid ${theme.colors.border}`
                    }}>
                        <div className="rewards-pulse" style={{
                            width: '60px',
                            height: '60px',
                            borderRadius: '50%',
                            background: `linear-gradient(135deg, ${goldPrimary}, ${goldLight})`,
                            margin: '0 auto 1.5rem',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center'
                        }}>
                            <FaCoins size={24} color="#1a1a1a" />
                        </div>
                        <p style={{ color: theme.colors.secondaryText, fontSize: '1.1rem' }}>
                            Loading your rewards...
                        </p>
                    </div>
                ) : (
                    <>
                        {/* Statistics Cards */}
                        {(userBalances.length > 0 || getTotalClaimedRewardsUSD() > 0) && (
                            <div style={{ 
                                display: 'grid',
                                gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
                                gap: '1rem',
                                marginBottom: '2rem'
                            }}>
                                {/* Unclaimed Rewards Card */}
                                {userBalances.filter(([_, b]) => b && Number(b) > 0).length > 0 && (
                                    <div className="stat-card rewards-card-animate" style={{
                                        background: theme.colors.secondaryBg,
                                        borderRadius: '16px',
                                        padding: '1.25rem',
                                        border: `1px solid ${theme.colors.border}`,
                                        transition: 'all 0.3s ease',
                                        opacity: 0,
                                        animationDelay: '0.1s'
                                    }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem' }}>
                                            <div style={{
                                                width: '44px', 
                                                height: '44px',
                                                minWidth: '44px',
                                                maxWidth: '44px',
                                                flexShrink: 0,
                                                borderRadius: '12px',
                                                background: `linear-gradient(135deg, ${goldPrimary}30, ${goldLight}20)`,
                                                display: 'flex', 
                                                alignItems: 'center', 
                                                justifyContent: 'center',
                                                color: goldPrimary
                                            }}>
                                                <FaCoins size={20} />
                                            </div>
                                            <span style={{ color: theme.colors.mutedText, fontSize: '0.85rem', fontWeight: '500' }}>
                                                Unclaimed Rewards
                                            </span>
                                        </div>
                                        <div style={{ 
                                            fontSize: '2rem',
                                            fontWeight: '700',
                                            background: `linear-gradient(135deg, ${goldPrimary}, ${goldLight})`,
                                            WebkitBackgroundClip: 'text',
                                            WebkitTextFillColor: 'transparent',
                                            backgroundClip: 'text'
                                        }}>
                                            {formatUSD(getTotalRewardsUSD())}
                                        </div>
                                        <div style={{ color: theme.colors.mutedText, fontSize: '0.8rem', marginTop: '0.35rem' }}>
                                            {userBalances.filter(([_, b]) => b && Number(b) > 0).length} token{userBalances.filter(([_, b]) => b && Number(b) > 0).length !== 1 ? 's' : ''} available
                                        </div>
                                    </div>
                                )}
                                    
                                {/* Claimed Rewards Card */}
                                {getTotalClaimedRewardsUSD() > 0 && (
                                    <div className="stat-card rewards-card-animate" style={{
                                        background: theme.colors.secondaryBg,
                                        borderRadius: '16px',
                                        padding: '1.25rem',
                                        border: `1px solid ${theme.colors.border}`,
                                        transition: 'all 0.3s ease',
                                        opacity: 0,
                                        animationDelay: '0.2s'
                                    }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem' }}>
                                            <div style={{
                                                width: '44px', 
                                                height: '44px',
                                                minWidth: '44px',
                                                maxWidth: '44px',
                                                flexShrink: 0,
                                                borderRadius: '12px',
                                                background: `linear-gradient(135deg, ${theme.colors.success}30, ${theme.colors.success}20)`,
                                                display: 'flex', 
                                                alignItems: 'center', 
                                                justifyContent: 'center',
                                                color: theme.colors.success
                                            }}>
                                                <FaCheckCircle size={20} />
                                            </div>
                                            <span style={{ color: theme.colors.mutedText, fontSize: '0.85rem', fontWeight: '500' }}>
                                                Total Claimed
                                            </span>
                                        </div>
                                        <div style={{ color: theme.colors.success, fontSize: '2rem', fontWeight: '700' }}>
                                            {formatUSD(getTotalClaimedRewardsUSD())}
                                        </div>
                                        <div style={{ color: theme.colors.mutedText, fontSize: '0.8rem', marginTop: '0.35rem' }}>
                                            Lifetime earnings
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                            
                        {/* Rewards List Section */}
                        <div style={{ marginBottom: '1.5rem' }}>
                            <h2 style={{
                                color: theme.colors.primaryText,
                                fontSize: '1.35rem',
                                fontWeight: '600',
                                marginBottom: '1rem',
                                display: 'flex', 
                                alignItems: 'center', 
                                gap: '0.75rem'
                            }}>
                                <span style={{
                                    width: '36px',
                                    height: '36px',
                                    borderRadius: '10px',
                                    background: `linear-gradient(135deg, ${goldPrimary}, ${goldLight})`,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center'
                                }}>
                                    <FaGift size={16} color="#1a1a1a" />
                                </span>
                                Available Rewards
                            </h2>

                            {userBalances.filter(([_, balance]) => balance && Number(balance) > 0).length > 0 ? (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                                    {userBalances
                                        .filter(([tokenId, balance]) => balance && Number(balance) > 0)
                                        .map(([tokenId, balance], index) => {
                                        const tokenIdStr = tokenId.toString();
                                        const decimals = tokenDecimals[tokenIdStr] || 8;
                                        const usdValue = getTokenUSDValue(balance, tokenId);
                                        const symbol = tokenSymbols[tokenIdStr] || tokenIdStr.slice(0, 8) + '...';
                                        const isClaiming = claimingTokens[tokenIdStr];
                                        const canClaim = balance && Number(balance) > 0 && !isClaiming;
                                        
                                        return (
                                            <div 
                                                key={tokenIdStr}
                                                className="rewards-card rewards-card-animate"
                                                style={{
                                                    background: theme.colors.secondaryBg,
                                                    borderRadius: '14px',
                                                    padding: '1.25rem',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '1rem',
                                                    border: `1px solid ${theme.colors.border}`,
                                                    opacity: 0,
                                                    animationDelay: `${(index + 1) * 0.1}s`
                                                }}
                                            >
                                                {/* Token Logo */}
                                                {renderTokenLogo(tokenIdStr, 48)}
                                                
                                                {/* Token Info */}
                                                <div style={{ flex: 1, minWidth: 0 }}>
                                                    <div style={{
                                                        color: theme.colors.primaryText,
                                                        fontSize: '1.05rem',
                                                        fontWeight: '600',
                                                        marginBottom: '0.2rem'
                                                    }}>
                                                        {symbol}
                                                    </div>
                                                    <div style={{
                                                        color: theme.colors.secondaryText,
                                                        fontSize: '0.9rem'
                                                    }}>
                                                        {formatBalance(balance, decimals)} {symbol}
                                                    </div>
                                                    {usdValue > 0 && (
                                                        <div style={{ 
                                                            color: goldPrimary,
                                                            fontSize: '0.9rem',
                                                            fontWeight: '600',
                                                            marginTop: '0.2rem'
                                                        }}>
                                                            ≈ {formatUSD(usdValue)}
                                                        </div>
                                                    )}
                                                </div>
                                                
                                                {/* Claim Button */}
                                                <button
                                                    onClick={() => handleClaimRewards(tokenId, balance)}
                                                    disabled={!canClaim}
                                                    className="claim-btn"
                                                    style={{
                                                        background: canClaim 
                                                            ? `linear-gradient(135deg, ${goldPrimary}, ${goldDark})`
                                                            : theme.colors.tertiaryBg,
                                                        color: canClaim ? '#1a1a1a' : theme.colors.mutedText,
                                                        border: 'none',
                                                        borderRadius: '10px',
                                                        padding: '0.7rem 1.5rem',
                                                        fontSize: '0.9rem',
                                                        fontWeight: '600',
                                                        cursor: canClaim ? 'pointer' : 'not-allowed',
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: '0.5rem',
                                                        boxShadow: canClaim ? `0 4px 15px ${goldPrimary}30` : 'none',
                                                        minWidth: '100px',
                                                        justifyContent: 'center'
                                                    }}
                                                >
                                                    {isClaiming ? (
                                                        <>
                                                            <Spinner size={16} />
                                                            <span>Claiming...</span>
                                                        </>
                                                    ) : (
                                                        'Claim'
                                                    )}
                                                </button>
                                            </div>
                                        );
                                    })}
                                </div>
                            ) : (
                                <div className="rewards-card-animate" style={{
                                    background: theme.colors.secondaryBg,
                                    borderRadius: '16px',
                                    padding: '3rem 2rem',
                                    textAlign: 'center',
                                    border: `1px solid ${theme.colors.border}`,
                                    opacity: 0,
                                    animationDelay: '0.1s'
                                }}>
                                    <div className="rewards-float" style={{
                                        width: '60px',
                                        height: '60px',
                                        borderRadius: '50%',
                                        background: `linear-gradient(135deg, ${goldPrimary}30, ${goldLight}20)`,
                                        margin: '0 auto 1rem',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        color: goldPrimary
                                    }}>
                                        <FaGift size={24} />
                                    </div>
                                    <h3 style={{
                                        color: theme.colors.primaryText,
                                        marginBottom: '0.75rem',
                                        fontWeight: '600',
                                        fontSize: '1.1rem'
                                    }}>
                                        No Rewards Available
                                    </h3>
                                    <p style={{
                                        color: theme.colors.secondaryText,
                                        maxWidth: '400px',
                                        margin: '0 auto',
                                        lineHeight: '1.6',
                                        fontSize: '0.95rem'
                                    }}>
                                        Participate in Sneed DAO governance to start earning rewards.
                                    </p>
                                </div>
                            )}
                        </div>

                        {/* Claim History Section */}
                        <div style={{ marginBottom: '1.5rem' }}>
                            <button 
                                onClick={() => setIsClaimHistoryExpanded(!isClaimHistoryExpanded)}
                                style={{
                                    width: '100%',
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'center',
                                    background: theme.colors.secondaryBg,
                                    border: `1px solid ${theme.colors.border}`,
                                    borderRadius: '14px',
                                    padding: '1rem 1.25rem',
                                    cursor: 'pointer',
                                    transition: 'all 0.2s ease'
                                }}
                            >
                                <div style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '0.75rem'
                                }}>
                                    <span style={{
                                        width: '36px',
                                        height: '36px',
                                        borderRadius: '10px',
                                        background: `linear-gradient(135deg, ${theme.colors.accent}30, ${theme.colors.accent}20)`,
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        color: theme.colors.accent
                                    }}>
                                        <FaHistory size={16} />
                                    </span>
                                    <span style={{
                                        color: theme.colors.primaryText,
                                        fontSize: '1.1rem',
                                        fontWeight: '600'
                                    }}>
                                        Claim History
                                    </span>
                                    {userClaimEvents.length > 0 && (
                                        <span style={{
                                            background: `${theme.colors.accent}20`,
                                            color: theme.colors.accent,
                                            padding: '0.2rem 0.6rem',
                                            borderRadius: '10px',
                                            fontSize: '0.75rem',
                                            fontWeight: '600'
                                        }}>
                                            {userClaimEvents.length}
                                        </span>
                                    )}
                                </div>
                                <div style={{
                                    color: theme.colors.mutedText,
                                    transition: 'transform 0.2s ease',
                                    transform: isClaimHistoryExpanded ? 'rotate(180deg)' : 'rotate(0deg)'
                                }}>
                                    <FaChevronDown size={16} />
                                </div>
                            </button>

                            {isClaimHistoryExpanded && (
                                <div style={{ 
                                    marginTop: '0.75rem',
                                    background: theme.colors.secondaryBg,
                                    borderRadius: '14px',
                                    border: `1px solid ${theme.colors.border}`,
                                    overflow: 'hidden'
                                }}>
                                    {loadingUserEvents ? (
                                        <div style={{ 
                                            display: 'flex', 
                                            justifyContent: 'center', 
                                            padding: '2rem' 
                                        }}>
                                            <Spinner size={32} />
                                        </div>
                                    ) : userClaimEvents.length > 0 ? (
                                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                                            {Object.entries(groupEventsBySequence(userClaimEvents))
                                                .sort((a, b) => {
                                                    const aLatest = a[1][a[1].length - 1];
                                                    const bLatest = b[1][b[1].length - 1];
                                                    return Number(bLatest.timestamp) - Number(aLatest.timestamp);
                                                })
                                                .slice(0, 10)
                                                .map(([seqNum, events], index, array) => {
                                                    const status = getGroupStatus(events);
                                                    const latestEvent = events[events.length - 1];
                                                    const tokenIdStr = latestEvent.token_id.toString();
                                                    const symbol = tokenSymbols[tokenIdStr] || tokenIdStr.slice(0, 8) + '...';
                                                    const usdValue = getTokenUSDValue(latestEvent.amount, latestEvent.token_id);
                                                    
                                                    const txEvent = events.find(e => e.tx_index && e.tx_index.length > 0);
                                                    const txId = txEvent?.tx_index?.[0];

                                                    const statusColors = {
                                                        'Success': theme.colors.success,
                                                        'Pending': '#f39c12',
                                                        'Failed': theme.colors.error
                                                    };

                                                    return (
                                                        <div 
                                                            key={seqNum} 
                                                            style={{
                                                                padding: '1rem 1.25rem',
                                                                display: 'flex',
                                                                alignItems: 'center',
                                                                gap: '1rem',
                                                                borderBottom: index < array.length - 1 ? `1px solid ${theme.colors.border}` : 'none',
                                                                transition: 'background 0.2s ease'
                                                            }}
                                                        >
                                                            {/* Token Logo */}
                                                            {renderTokenLogo(tokenIdStr, 40)}
                                                            
                                                            {/* Event Info */}
                                                            <div style={{ flex: 1, minWidth: 0 }}>
                                                                <div style={{
                                                                    display: 'flex',
                                                                    alignItems: 'center',
                                                                    gap: '0.75rem',
                                                                    marginBottom: '0.2rem',
                                                                    flexWrap: 'wrap'
                                                                }}>
                                                                    <span style={{
                                                                        color: theme.colors.primaryText,
                                                                        fontWeight: '600',
                                                                        fontSize: '0.95rem'
                                                                    }}>
                                                                        {formatBalance(latestEvent.amount, 8)} {symbol}
                                                                    </span>
                                                                    {usdValue > 0 && (
                                                                        <span style={{ 
                                                                            color: goldPrimary,
                                                                            fontSize: '0.85rem'
                                                                        }}>
                                                                            ({formatUSD(usdValue)})
                                                                        </span>
                                                                    )}
                                                                    {txId !== undefined && status === 'Success' && (
                                                                        <Link
                                                                            to={`/transaction?sns=${SNEED_SNS_ROOT}&id=${txId}&ledger=${tokenIdStr}`}
                                                                            style={{
                                                                                color: theme.colors.accent,
                                                                                fontSize: '0.8rem',
                                                                                display: 'flex',
                                                                                alignItems: 'center',
                                                                                gap: '4px',
                                                                                textDecoration: 'none'
                                                                            }}
                                                                            onClick={(e) => e.stopPropagation()}
                                                                            title="View transaction"
                                                                        >
                                                                            <FaExternalLinkAlt size={10} />
                                                                            <span>Tx</span>
                                                                        </Link>
                                                                    )}
                                                                </div>
                                                                <div 
                                                                    style={{
                                                                        color: theme.colors.mutedText,
                                                                        fontSize: '0.8rem',
                                                                        cursor: 'default'
                                                                    }}
                                                                    title={getFullDate(latestEvent.timestamp)}
                                                                >
                                                                    {getRelativeTime(latestEvent.timestamp)}
                                                                </div>
                                                            </div>
                                                            
                                                            {/* Status Badge */}
                                                            <div style={{
                                                                background: `${statusColors[status] || theme.colors.mutedText}15`,
                                                                color: statusColors[status] || theme.colors.mutedText,
                                                                padding: '0.3rem 0.7rem',
                                                                borderRadius: '6px',
                                                                fontSize: '0.75rem',
                                                                fontWeight: '600',
                                                                textTransform: 'uppercase',
                                                                letterSpacing: '0.03em'
                                                            }}>
                                                                {status}
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                        </div>
                                    ) : (
                                        <div style={{
                                            textAlign: 'center',
                                            padding: '2.5rem 2rem',
                                            color: theme.colors.mutedText
                                        }}>
                                            <FaHistory size={32} style={{ opacity: 0.3, marginBottom: '0.75rem' }} />
                                            <div>No claim history yet</div>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    </>
                )}

                {notification && (
                    <Notification
                        type={notification.type}
                        message={notification.message}
                        onClose={() => setNotification(null)}
                    />
                )}
                </div>
            </main>
        </div>
    );
}

export default Rewards; 
