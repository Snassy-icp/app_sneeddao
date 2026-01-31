import React, { useState, useEffect, useCallback } from 'react';
import Header from '../components/Header';
import { Link } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { FaExchangeAlt, FaGavel, FaShieldAlt, FaCubes, FaCoins, FaBrain, FaCog, FaUnlock, FaChartLine, FaRocket, FaCheckCircle, FaArrowRight, FaHome, FaChevronRight } from 'react-icons/fa';
import { createSneedexActor, formatFeeRate } from '../utils/SneedexUtils';

// Custom CSS for animations
const sneedexStyles = `
@keyframes sneedexFadeInUp {
    from {
        opacity: 0;
        transform: translateY(20px);
    }
    to {
        opacity: 1;
        transform: translateY(0);
    }
}

@keyframes sneedexPulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.7; }
}

@keyframes sneedexFloat {
    0%, 100% { transform: translateY(0); }
    50% { transform: translateY(-8px); }
}

@keyframes sneedexGlow {
    0%, 100% { box-shadow: 0 0 20px rgba(16, 185, 129, 0.3); }
    50% { box-shadow: 0 0 40px rgba(16, 185, 129, 0.5); }
}

@keyframes sneedexShimmer {
    0% { background-position: -200% 0; }
    100% { background-position: 200% 0; }
}

.sneedex-animate {
    animation: sneedexFadeInUp 0.6s ease-out forwards;
}

.sneedex-animate-delay-1 {
    animation: sneedexFadeInUp 0.6s ease-out 0.1s forwards;
    opacity: 0;
}

.sneedex-animate-delay-2 {
    animation: sneedexFadeInUp 0.6s ease-out 0.2s forwards;
    opacity: 0;
}

.sneedex-animate-delay-3 {
    animation: sneedexFadeInUp 0.6s ease-out 0.3s forwards;
    opacity: 0;
}

.sneedex-float {
    animation: sneedexFloat 3s ease-in-out infinite;
}

.sneedex-glow {
    animation: sneedexGlow 2s ease-in-out infinite;
}
`;

// Sneedex accent colors
const sneedexPrimary = '#10b981'; // Emerald
const sneedexSecondary = '#059669'; // Darker emerald
const sneedexAccent = '#34d399'; // Light emerald

function Sneedex() {
    const { identity, isAuthenticated } = useAuth();
    const { theme } = useTheme();
    const [stats, setStats] = useState(null);
    const [feeRate, setFeeRate] = useState(null);
    const [isAdmin, setIsAdmin] = useState(false);
    
    const fetchFeeSettings = useCallback(async () => {
        try {
            const actor = createSneedexActor(identity);
            const rate = await actor.getMarketplaceFeeRate();
            setFeeRate(Number(rate));
        } catch (e) {
            console.error('Failed to fetch fee settings:', e);
        }
    }, [identity]);
    
    const checkAdminStatus = useCallback(async () => {
        if (!isAuthenticated || !identity) {
            setIsAdmin(false);
            return;
        }
        try {
            const actor = createSneedexActor(identity);
            const config = await actor.getConfig();
            const userPrincipal = identity.getPrincipal().toString();
            const adminList = config.admins.map(p => p.toString());
            setIsAdmin(adminList.includes(userPrincipal));
        } catch (e) {
            console.error('Failed to check admin status:', e);
            setIsAdmin(false);
        }
    }, [identity, isAuthenticated]);
    
    useEffect(() => {
        const fetchStats = async () => {
            try {
                const actor = createSneedexActor(identity);
                const marketStats = await actor.getMarketStats();
                setStats(marketStats);
            } catch (e) {
                console.error('Failed to fetch market stats:', e);
            }
        };
        fetchStats();
        fetchFeeSettings();
        checkAdminStatus();
    }, [identity, fetchFeeSettings, checkAdminStatus]);

    const assetTypes = [
        {
            icon: <FaCubes size={32} />,
            title: 'Canisters',
            description: 'Trade full Internet Computer canisters. Controllers are transferred atomically through escrow.',
            color: sneedexPrimary,
            gradient: `linear-gradient(135deg, ${sneedexPrimary}20, ${sneedexPrimary}05)`,
        },
        {
            icon: <FaBrain size={32} />,
            title: 'SNS Neurons',
            description: 'Buy and sell SNS governance neurons. Hotkey permissions ensure secure atomic transfers.',
            color: '#8B5CF6',
            gradient: 'linear-gradient(135deg, #8B5CF620, #8B5CF605)',
        },
        {
            icon: '🏛️',
            title: 'ICP Neuron Managers',
            description: 'Trade ICP neurons via manager canisters. Full NNS voting power, liquid ownership.',
            color: '#3b82f6',
            gradient: 'linear-gradient(135deg, #3b82f620, #3b82f605)',
        },
        {
            icon: <FaCoins size={32} />,
            title: 'ICRC1 Tokens',
            description: 'Bundle fungible tokens into offers. Perfect for OTC trades and bulk transactions.',
            color: '#f59e0b',
            gradient: 'linear-gradient(135deg, #f59e0b20, #f59e0b05)',
        },
    ];

    const steps = [
        {
            number: '01',
            title: 'Create an Offer',
            description: 'Define your terms: minimum bid, buyout price, and expiration date. Add assets to your offer.',
            icon: <FaGavel size={20} />,
        },
        {
            number: '02',
            title: 'Escrow Your Assets',
            description: 'Transfer asset control to Sneedex. Controllers are snapshotted, tokens moved to escrow.',
            icon: <FaShieldAlt size={20} />,
        },
        {
            number: '03',
            title: 'Receive Bids',
            description: 'Buyers place bids by depositing tokens. Buyout triggers instant completion.',
            icon: <FaChartLine size={20} />,
        },
        {
            number: '04',
            title: 'Atomic Settlement',
            description: 'Assets transfer to the winner and payment to the seller—atomically.',
            icon: <FaCheckCircle size={20} />,
        },
    ];

    const features = [
        {
            icon: '🔒',
            title: 'Trustless Escrow',
            description: 'Assets are held securely until the trade completes. No middleman, no trust required.',
        },
        {
            icon: '⚡',
            title: 'Atomic Transfers',
            description: 'All assets in an offer change hands simultaneously. No partial fills.',
        },
        {
            icon: '📦',
            title: 'Asset Bundling',
            description: 'Combine multiple canisters, neurons, and tokens into a single offer.',
        },
        {
            icon: '🎯',
            title: 'Flexible Pricing',
            description: 'Auctions, instant buyouts, timed expirations—you choose the terms.',
        },
    ];

    return (
        <div className='page-container' style={{ background: theme.colors.primaryGradient, minHeight: '100vh' }}>
            <style>{sneedexStyles}</style>
            <Header />
            
            <main style={{
                maxWidth: '1200px',
                margin: '0 auto',
                padding: '0 1.5rem 3rem 1.5rem',
            }}>
                {/* Breadcrumb */}
                <nav className="sneedex-animate" style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    padding: '1rem 0',
                    fontSize: '0.9rem',
                }}>
                    <Link to="/" style={{ 
                        color: theme.colors.mutedText, 
                        textDecoration: 'none',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.35rem',
                        transition: 'color 0.2s ease'
                    }}>
                        <FaHome size={14} /> Home
                    </Link>
                    <FaChevronRight size={10} style={{ color: theme.colors.mutedText }} />
                    <span style={{ color: sneedexPrimary, fontWeight: '600' }}>Sneedex</span>
                </nav>

                {/* Hero Section */}
                <div className="sneedex-animate" style={{
                    background: theme.colors.cardGradient,
                    borderRadius: '24px',
                    border: `1px solid ${theme.colors.border}`,
                    padding: 'clamp(1.5rem, 4vw, 3rem)',
                    marginBottom: '2rem',
                    position: 'relative',
                    overflow: 'hidden',
                    boxShadow: theme.colors.cardShadow,
                }}>
                    {/* Background glow */}
                    <div style={{
                        position: 'absolute',
                        top: '-50%',
                        right: '-20%',
                        width: '500px',
                        height: '500px',
                        background: `radial-gradient(circle, ${sneedexPrimary}15 0%, transparent 70%)`,
                        pointerEvents: 'none',
                    }} />
                    <div style={{
                        position: 'absolute',
                        bottom: '-30%',
                        left: '-10%',
                        width: '400px',
                        height: '400px',
                        background: `radial-gradient(circle, #8B5CF615 0%, transparent 70%)`,
                        pointerEvents: 'none',
                    }} />
                    
                    <div style={{ position: 'relative', zIndex: 1 }}>
                        {/* Title area */}
                        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
                            <div style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '1rem',
                                marginBottom: '1rem',
                            }}>
                                <div className="sneedex-float" style={{
                                    width: '70px',
                                    height: '70px',
                                    borderRadius: '20px',
                                    background: `linear-gradient(135deg, ${sneedexPrimary}, ${sneedexSecondary})`,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    boxShadow: `0 8px 32px ${sneedexPrimary}40`,
                                }}>
                                    <FaExchangeAlt size={32} color="white" />
                                </div>
                            </div>
                            
                            <h1 style={{
                                fontSize: 'clamp(2.5rem, 6vw, 4rem)',
                                fontWeight: '800',
                                background: `linear-gradient(135deg, ${sneedexPrimary}, ${sneedexAccent}, #8B5CF6)`,
                                WebkitBackgroundClip: 'text',
                                WebkitTextFillColor: 'transparent',
                                backgroundClip: 'text',
                                margin: '0 0 0.75rem 0',
                                letterSpacing: '-0.02em',
                            }}>
                                Sneedex
                            </h1>
                            
                            <p style={{
                                fontSize: 'clamp(1rem, 2.5vw, 1.35rem)',
                                color: theme.colors.mutedText,
                                fontStyle: 'italic',
                                margin: '0 0 1rem 0',
                            }}>
                                The Decentralized Exchange for Everything
                            </p>
                            
                            <p style={{
                                fontSize: 'clamp(0.95rem, 2vw, 1.15rem)',
                                color: theme.colors.secondaryText,
                                maxWidth: '750px',
                                margin: '0 auto',
                                lineHeight: '1.7',
                            }}>
                                Trade canisters, SNS neurons, ICP Neuron Managers, and ICRC1 tokens through trustless escrow auctions.
                                Bundle multiple assets, set your terms, and let the market decide.
                            </p>
                        </div>

                        {/* CTA Buttons */}
                        <div style={{
                            display: 'flex',
                            justifyContent: 'center',
                            gap: '1rem',
                            flexWrap: 'wrap',
                            marginBottom: '2rem',
                        }}>
                            <Link
                                to="/sneedex_offers"
                                style={{
                                    background: `linear-gradient(135deg, ${sneedexPrimary}, ${sneedexSecondary})`,
                                    color: 'white',
                                    padding: '1rem 2rem',
                                    borderRadius: '14px',
                                    textDecoration: 'none',
                                    fontSize: '1.1rem',
                                    fontWeight: '700',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '0.75rem',
                                    boxShadow: `0 4px 20px ${sneedexPrimary}40`,
                                    transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                                }}
                                onMouseEnter={(e) => {
                                    e.currentTarget.style.transform = 'translateY(-3px)';
                                    e.currentTarget.style.boxShadow = `0 8px 30px ${sneedexPrimary}50`;
                                }}
                                onMouseLeave={(e) => {
                                    e.currentTarget.style.transform = 'translateY(0)';
                                    e.currentTarget.style.boxShadow = `0 4px 20px ${sneedexPrimary}40`;
                                }}
                            >
                                <FaExchangeAlt /> Browse Marketplace
                            </Link>
                            
                            {isAuthenticated && (
                                <Link
                                    to="/sneedex_create"
                                    style={{
                                        background: theme.colors.tertiaryBg,
                                        color: sneedexPrimary,
                                        padding: '1rem 2rem',
                                        borderRadius: '14px',
                                        textDecoration: 'none',
                                        fontSize: '1.1rem',
                                        fontWeight: '700',
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: '0.75rem',
                                        border: `2px solid ${sneedexPrimary}`,
                                        transition: 'all 0.3s ease',
                                    }}
                                    onMouseEnter={(e) => {
                                        e.currentTarget.style.background = sneedexPrimary;
                                        e.currentTarget.style.color = 'white';
                                    }}
                                    onMouseLeave={(e) => {
                                        e.currentTarget.style.background = theme.colors.tertiaryBg;
                                        e.currentTarget.style.color = sneedexPrimary;
                                    }}
                                >
                                    <FaGavel /> Create Offer
                                </Link>
                            )}
                            
                            {isAuthenticated && (
                                <Link
                                    to="/sneedex_my"
                                    style={{
                                        background: theme.colors.tertiaryBg,
                                        color: '#8B5CF6',
                                        padding: '1rem 2rem',
                                        borderRadius: '14px',
                                        textDecoration: 'none',
                                        fontSize: '1.1rem',
                                        fontWeight: '700',
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: '0.75rem',
                                        border: `2px solid #8B5CF6`,
                                        transition: 'all 0.3s ease',
                                    }}
                                    onMouseEnter={(e) => {
                                        e.currentTarget.style.background = '#8B5CF6';
                                        e.currentTarget.style.color = 'white';
                                    }}
                                    onMouseLeave={(e) => {
                                        e.currentTarget.style.background = theme.colors.tertiaryBg;
                                        e.currentTarget.style.color = '#8B5CF6';
                                    }}
                                >
                                    📋 My Offers & Bids
                                </Link>
                            )}
                        </div>

                        {/* Liquid Staking Banner */}
                        <div style={{
                            background: `linear-gradient(135deg, ${sneedexPrimary}10, #8B5CF610)`,
                            border: `1px solid ${sneedexPrimary}30`,
                            borderRadius: '16px',
                            padding: '1.25rem 1.5rem',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: '1rem',
                            flexWrap: 'wrap',
                            marginBottom: '1rem',
                        }}>
                            <div style={{ 
                                display: 'flex', 
                                alignItems: 'center', 
                                gap: '0.75rem',
                                flex: 1,
                                minWidth: '200px',
                            }}>
                                <span style={{ fontSize: '1.5rem' }}>✨</span>
                                <div>
                                    <div style={{ 
                                        color: theme.colors.primaryText, 
                                        fontWeight: '700',
                                        fontSize: '1rem',
                                    }}>
                                        Liquid Staking
                                    </div>
                                    <div style={{ 
                                        color: theme.colors.secondaryText, 
                                        fontSize: '0.85rem',
                                    }}>
                                        Create tradable ICP or SNS neurons and sell them here!
                                    </div>
                                </div>
                            </div>
                            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                                <Link
                                    to="/create_icp_neuron"
                                    style={{
                                        background: `linear-gradient(135deg, ${sneedexPrimary}, ${sneedexSecondary})`,
                                        color: 'white',
                                        padding: '0.6rem 1rem',
                                        borderRadius: '10px',
                                        textDecoration: 'none',
                                        fontWeight: '600',
                                        fontSize: '0.85rem',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '0.5rem',
                                        whiteSpace: 'nowrap',
                                    }}
                                >
                                    ICP Staking <FaArrowRight size={12} />
                                </Link>
                                <Link
                                    to="/sns_neuron_wizard"
                                    style={{
                                        background: 'linear-gradient(135deg, #8B5CF6, #7c3aed)',
                                        color: 'white',
                                        padding: '0.6rem 1rem',
                                        borderRadius: '10px',
                                        textDecoration: 'none',
                                        fontWeight: '600',
                                        fontSize: '0.85rem',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '0.5rem',
                                        whiteSpace: 'nowrap',
                                    }}
                                >
                                    SNS Staking <FaArrowRight size={12} />
                                </Link>
                            </div>
                        </div>

                        {/* SNS Jailbreak Banner */}
                        <div style={{
                            background: 'linear-gradient(135deg, #f5730010, #ea580c10)',
                            border: '1px solid #f5730030',
                            borderRadius: '16px',
                            padding: '1rem 1.5rem',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: '1rem',
                            flexWrap: 'wrap',
                        }}>
                            <div style={{ 
                                display: 'flex', 
                                alignItems: 'center', 
                                gap: '0.75rem',
                                flex: 1,
                                minWidth: '200px',
                            }}>
                                <FaUnlock size={20} style={{ color: '#f57300' }} />
                                <div>
                                    <div style={{ 
                                        color: theme.colors.primaryText, 
                                        fontWeight: '700',
                                        fontSize: '0.95rem',
                                    }}>
                                        SNS Jailbreak
                                    </div>
                                    <div style={{ 
                                        color: theme.colors.secondaryText, 
                                        fontSize: '0.85rem',
                                    }}>
                                        Already have SNS neurons? Make them tradable!
                                    </div>
                                </div>
                            </div>
                            <Link
                                to="/tools/sns_jailbreak"
                                style={{
                                    background: 'linear-gradient(135deg, #f57300, #ea580c)',
                                    color: 'white',
                                    padding: '0.6rem 1rem',
                                    borderRadius: '10px',
                                    textDecoration: 'none',
                                    fontWeight: '600',
                                    fontSize: '0.85rem',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '0.5rem',
                                    whiteSpace: 'nowrap',
                                }}
                            >
                                <FaUnlock size={12} /> Jailbreak <FaArrowRight size={12} />
                            </Link>
                        </div>
                    </div>
                </div>

                {/* Live Stats */}
                {stats && (
                    <div className="sneedex-animate-delay-1" style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
                        gap: '1rem',
                        marginBottom: '2rem',
                    }}>
                        {[
                            { label: 'Active Offers', value: Number(stats.active_offers), color: sneedexPrimary },
                            { label: 'Total Offers', value: Number(stats.total_offers), color: '#8B5CF6' },
                            { label: 'Completed', value: Number(stats.completed_offers), color: '#22c55e' },
                            { label: 'Total Bids', value: Number(stats.total_bids), color: '#f59e0b' },
                            ...(feeRate !== null ? [{ label: 'Marketplace Fee', value: formatFeeRate(feeRate), color: '#ec4899', isText: true }] : []),
                        ].map((stat, index) => (
                            <div
                                key={index}
                                style={{
                                    background: theme.colors.cardGradient,
                                    border: `1px solid ${theme.colors.border}`,
                                    borderRadius: '16px',
                                    padding: '1.5rem',
                                    textAlign: 'center',
                                    transition: 'all 0.3s ease',
                                }}
                                onMouseEnter={(e) => {
                                    e.currentTarget.style.transform = 'translateY(-4px)';
                                    e.currentTarget.style.borderColor = stat.color;
                                    e.currentTarget.style.boxShadow = `0 8px 25px ${stat.color}20`;
                                }}
                                onMouseLeave={(e) => {
                                    e.currentTarget.style.transform = 'translateY(0)';
                                    e.currentTarget.style.borderColor = theme.colors.border;
                                    e.currentTarget.style.boxShadow = 'none';
                                }}
                            >
                                <div style={{
                                    fontSize: stat.isText ? '1.5rem' : '2.25rem',
                                    fontWeight: '800',
                                    color: stat.color,
                                    marginBottom: '0.25rem',
                                    letterSpacing: '-0.02em',
                                }}>
                                    {stat.value}
                                </div>
                                <div style={{
                                    fontSize: '0.8rem',
                                    color: theme.colors.mutedText,
                                    textTransform: 'uppercase',
                                    letterSpacing: '0.5px',
                                    fontWeight: '600',
                                }}>
                                    {stat.label}
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {/* What is Sneedex */}
                <section className="sneedex-animate-delay-1" style={{
                    background: theme.colors.cardGradient,
                    border: `1px solid ${theme.colors.border}`,
                    borderRadius: '20px',
                    padding: 'clamp(1.5rem, 4vw, 2.5rem)',
                    marginBottom: '2rem',
                    boxShadow: theme.colors.cardShadow,
                }}>
                    <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '1rem',
                        marginBottom: '1.5rem',
                    }}>
                        <div style={{
                            width: '48px',
                            height: '48px',
                            borderRadius: '14px',
                            background: `linear-gradient(135deg, ${sneedexPrimary}20, ${sneedexPrimary}10)`,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                        }}>
                            <FaShieldAlt size={22} color={sneedexPrimary} />
                        </div>
                        <h2 style={{
                            fontSize: 'clamp(1.5rem, 3vw, 1.85rem)',
                            fontWeight: '700',
                            color: theme.colors.primaryText,
                            margin: 0,
                        }}>
                            What is Sneedex?
                        </h2>
                    </div>
                    
                    <p style={{
                        fontSize: '1.05rem',
                        lineHeight: '1.8',
                        color: theme.colors.secondaryText,
                        marginBottom: '1.25rem',
                    }}>
                        Sneedex is a <strong style={{ color: sneedexPrimary }}>trustless marketplace</strong> for trading unique Internet Computer assets. 
                        Unlike traditional DEXes that only handle fungible tokens, Sneedex enables 
                        atomic trades of <strong>canisters</strong>, <strong>SNS neurons</strong>, and 
                        <strong> ICRC1 tokens</strong>—all through secure escrow.
                    </p>
                    <p style={{
                        fontSize: '1.05rem',
                        lineHeight: '1.8',
                        color: theme.colors.secondaryText,
                        margin: 0,
                    }}>
                        Create offers with flexible pricing: set a minimum bid for auctions, a buyout 
                        price for instant sales, or both. Bundle multiple assets into a single offer, 
                        and let buyers compete through trustless bidding.
                    </p>
                </section>

                {/* Supported Asset Types */}
                <section className="sneedex-animate-delay-2" style={{
                    background: theme.colors.cardGradient,
                    border: `1px solid ${theme.colors.border}`,
                    borderRadius: '20px',
                    padding: 'clamp(1.5rem, 4vw, 2.5rem)',
                    marginBottom: '2rem',
                    boxShadow: theme.colors.cardShadow,
                }}>
                    <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '1rem',
                        marginBottom: '1.5rem',
                    }}>
                        <div style={{
                            width: '48px',
                            height: '48px',
                            borderRadius: '14px',
                            background: 'linear-gradient(135deg, #8B5CF620, #8B5CF610)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                        }}>
                            <FaCubes size={22} color="#8B5CF6" />
                        </div>
                        <div>
                            <h2 style={{
                                fontSize: 'clamp(1.5rem, 3vw, 1.85rem)',
                                fontWeight: '700',
                                color: theme.colors.primaryText,
                                margin: 0,
                            }}>
                                Supported Asset Types
                            </h2>
                            <p style={{
                                fontSize: '0.9rem',
                                color: theme.colors.mutedText,
                                margin: '0.25rem 0 0 0',
                            }}>
                                Four asset types, with more coming
                            </p>
                        </div>
                    </div>
                    
                    <div style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
                        gap: '1.25rem',
                    }}>
                        {assetTypes.map((asset, index) => (
                            <div
                                key={index}
                                style={{
                                    background: asset.gradient,
                                    border: `1px solid ${theme.colors.border}`,
                                    borderRadius: '16px',
                                    padding: '1.5rem',
                                    transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                                    cursor: 'default',
                                }}
                                onMouseEnter={(e) => {
                                    e.currentTarget.style.transform = 'translateY(-5px)';
                                    e.currentTarget.style.borderColor = asset.color;
                                    e.currentTarget.style.boxShadow = `0 12px 35px ${asset.color}20`;
                                }}
                                onMouseLeave={(e) => {
                                    e.currentTarget.style.transform = 'translateY(0)';
                                    e.currentTarget.style.borderColor = theme.colors.border;
                                    e.currentTarget.style.boxShadow = 'none';
                                }}
                            >
                                <div style={{
                                    color: asset.color,
                                    marginBottom: '1rem',
                                }}>
                                    {typeof asset.icon === 'string' ? (
                                        <span style={{ fontSize: '2rem' }}>{asset.icon}</span>
                                    ) : (
                                        asset.icon
                                    )}
                                </div>
                                <h3 style={{
                                    fontSize: '1.2rem',
                                    fontWeight: '700',
                                    color: asset.color,
                                    marginBottom: '0.5rem',
                                }}>
                                    {asset.title}
                                </h3>
                                <p style={{
                                    fontSize: '0.9rem',
                                    color: theme.colors.secondaryText,
                                    lineHeight: '1.6',
                                    margin: 0,
                                }}>
                                    {asset.description}
                                </p>
                            </div>
                        ))}
                    </div>
                </section>

                {/* How It Works */}
                <section className="sneedex-animate-delay-2" style={{
                    background: theme.colors.cardGradient,
                    border: `1px solid ${theme.colors.border}`,
                    borderRadius: '20px',
                    padding: 'clamp(1.5rem, 4vw, 2.5rem)',
                    marginBottom: '2rem',
                    boxShadow: theme.colors.cardShadow,
                }}>
                    <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '1rem',
                        marginBottom: '2rem',
                    }}>
                        <div style={{
                            width: '48px',
                            height: '48px',
                            borderRadius: '14px',
                            background: 'linear-gradient(135deg, #f59e0b20, #f59e0b10)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                        }}>
                            <FaRocket size={22} color="#f59e0b" />
                        </div>
                        <h2 style={{
                            fontSize: 'clamp(1.5rem, 3vw, 1.85rem)',
                            fontWeight: '700',
                            color: theme.colors.primaryText,
                            margin: 0,
                        }}>
                            How It Works
                        </h2>
                    </div>
                    
                    <div style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
                        gap: '1.5rem',
                    }}>
                        {steps.map((step, index) => (
                            <div
                                key={index}
                                style={{
                                    background: theme.colors.tertiaryBg,
                                    border: `1px solid ${theme.colors.border}`,
                                    borderRadius: '16px',
                                    padding: '1.5rem',
                                    position: 'relative',
                                    transition: 'all 0.3s ease',
                                }}
                                onMouseEnter={(e) => {
                                    e.currentTarget.style.borderColor = sneedexPrimary;
                                }}
                                onMouseLeave={(e) => {
                                    e.currentTarget.style.borderColor = theme.colors.border;
                                }}
                            >
                                <div style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '0.75rem',
                                    marginBottom: '1rem',
                                }}>
                                    <span style={{
                                        fontSize: '1.75rem',
                                        fontWeight: '800',
                                        color: sneedexPrimary,
                                        opacity: 0.3,
                                    }}>
                                        {step.number}
                                    </span>
                                    <div style={{
                                        width: '36px',
                                        height: '36px',
                                        borderRadius: '10px',
                                        background: `linear-gradient(135deg, ${sneedexPrimary}20, ${sneedexPrimary}10)`,
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        color: sneedexPrimary,
                                    }}>
                                        {step.icon}
                                    </div>
                                </div>
                                <h4 style={{
                                    fontSize: '1.1rem',
                                    fontWeight: '700',
                                    color: theme.colors.primaryText,
                                    marginBottom: '0.5rem',
                                }}>
                                    {step.title}
                                </h4>
                                <p style={{
                                    fontSize: '0.9rem',
                                    color: theme.colors.secondaryText,
                                    lineHeight: '1.6',
                                    margin: 0,
                                }}>
                                    {step.description}
                                </p>
                            </div>
                        ))}
                    </div>
                </section>

                {/* Key Features */}
                <section className="sneedex-animate-delay-3" style={{
                    background: theme.colors.cardGradient,
                    border: `1px solid ${theme.colors.border}`,
                    borderRadius: '20px',
                    padding: 'clamp(1.5rem, 4vw, 2.5rem)',
                    marginBottom: '2rem',
                    boxShadow: theme.colors.cardShadow,
                }}>
                    <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '1rem',
                        marginBottom: '1.5rem',
                    }}>
                        <div style={{
                            width: '48px',
                            height: '48px',
                            borderRadius: '14px',
                            background: `linear-gradient(135deg, ${sneedexPrimary}20, ${sneedexPrimary}10)`,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                        }}>
                            <FaCoins size={22} color={sneedexPrimary} />
                        </div>
                        <h2 style={{
                            fontSize: 'clamp(1.5rem, 3vw, 1.85rem)',
                            fontWeight: '700',
                            color: theme.colors.primaryText,
                            margin: 0,
                        }}>
                            Key Features
                        </h2>
                    </div>
                    
                    <div style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                        gap: '1.25rem',
                    }}>
                        {features.map((feature, index) => (
                            <div
                                key={index}
                                style={{
                                    display: 'flex',
                                    alignItems: 'flex-start',
                                    gap: '1rem',
                                    padding: '1.25rem',
                                    background: theme.colors.tertiaryBg,
                                    borderRadius: '14px',
                                    border: `1px solid ${theme.colors.border}`,
                                    transition: 'all 0.3s ease',
                                }}
                                onMouseEnter={(e) => {
                                    e.currentTarget.style.borderColor = sneedexPrimary + '60';
                                }}
                                onMouseLeave={(e) => {
                                    e.currentTarget.style.borderColor = theme.colors.border;
                                }}
                            >
                                <span style={{
                                    fontSize: '1.75rem',
                                    flexShrink: 0,
                                }}>
                                    {feature.icon}
                                </span>
                                <div>
                                    <h4 style={{
                                        fontSize: '1.05rem',
                                        fontWeight: '700',
                                        color: theme.colors.primaryText,
                                        marginBottom: '0.35rem',
                                    }}>
                                        {feature.title}
                                    </h4>
                                    <p style={{
                                        fontSize: '0.9rem',
                                        color: theme.colors.secondaryText,
                                        lineHeight: '1.55',
                                        margin: 0,
                                    }}>
                                        {feature.description}
                                    </p>
                                </div>
                            </div>
                        ))}
                    </div>
                </section>
                
                {/* Admin Link */}
                {isAdmin && (
                    <section className="sneedex-animate-delay-3" style={{
                        background: theme.colors.cardGradient,
                        border: `2px solid #f59e0b40`,
                        borderRadius: '20px',
                        padding: '1.5rem 2rem',
                        marginBottom: '2rem',
                        boxShadow: theme.colors.cardShadow,
                    }}>
                        <Link
                            to="/admin/sneedex"
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '1rem',
                                textDecoration: 'none',
                            }}
                        >
                            <div style={{
                                width: '48px',
                                height: '48px',
                                borderRadius: '14px',
                                background: 'linear-gradient(135deg, #f59e0b20, #f59e0b10)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                            }}>
                                <FaCog size={22} color="#f59e0b" />
                            </div>
                            <div>
                                <h3 style={{
                                    fontSize: '1.2rem',
                                    fontWeight: '700',
                                    color: theme.colors.primaryText,
                                    margin: '0 0 0.25rem 0',
                                }}>
                                    Admin Settings
                                </h3>
                                <p style={{ 
                                    color: theme.colors.mutedText, 
                                    margin: 0, 
                                    fontSize: '0.9rem',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '0.5rem',
                                }}>
                                    Manage marketplace fees, admins, and configuration 
                                    <FaArrowRight size={12} />
                                </p>
                            </div>
                        </Link>
                    </section>
                )}

                {/* CTA Section */}
                <section className="sneedex-animate-delay-3" style={{
                    background: `linear-gradient(135deg, ${sneedexPrimary}15, #8B5CF615)`,
                    border: `1px solid ${sneedexPrimary}30`,
                    borderRadius: '20px',
                    padding: 'clamp(2rem, 5vw, 3rem)',
                    textAlign: 'center',
                }}>
                    <h2 style={{
                        fontSize: 'clamp(1.5rem, 3vw, 2rem)',
                        fontWeight: '700',
                        color: theme.colors.primaryText,
                        marginBottom: '1rem',
                    }}>
                        Ready to Trade?
                    </h2>
                    <p style={{
                        fontSize: '1.05rem',
                        color: theme.colors.secondaryText,
                        maxWidth: '550px',
                        margin: '0 auto 2rem auto',
                        lineHeight: '1.7',
                    }}>
                        Browse active offers, create your own, or manage your existing trades. 
                        The decentralized marketplace awaits.
                    </p>
                    <div style={{
                        display: 'flex',
                        justifyContent: 'center',
                        gap: '1rem',
                        flexWrap: 'wrap',
                    }}>
                        <Link
                            to="/sneedex_offers"
                            style={{
                                background: `linear-gradient(135deg, ${sneedexPrimary}, ${sneedexSecondary})`,
                                color: 'white',
                                padding: '1rem 2.5rem',
                                borderRadius: '14px',
                                textDecoration: 'none',
                                fontSize: '1.1rem',
                                fontWeight: '700',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '0.75rem',
                                boxShadow: `0 4px 20px ${sneedexPrimary}40`,
                                transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                            }}
                            onMouseEnter={(e) => {
                                e.currentTarget.style.transform = 'translateY(-3px)';
                                e.currentTarget.style.boxShadow = `0 8px 30px ${sneedexPrimary}50`;
                            }}
                            onMouseLeave={(e) => {
                                e.currentTarget.style.transform = 'translateY(0)';
                                e.currentTarget.style.boxShadow = `0 4px 20px ${sneedexPrimary}40`;
                            }}
                        >
                            <FaExchangeAlt /> Explore Marketplace
                        </Link>
                    </div>
                </section>
            </main>
        </div>
    );
}

export default Sneedex;
