import React, { useState, useEffect, useCallback } from 'react';
import Header from '../components/Header';
import { Link } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { FaExchangeAlt, FaGavel, FaShieldAlt, FaCubes, FaCoins, FaBrain, FaCog, FaUnlock, FaChartLine, FaRocket, FaCheckCircle, FaArrowRight, FaHome, FaChevronRight, FaSync } from 'react-icons/fa';
import { createSneedexActor, formatFeeRate } from '../utils/SneedexUtils';

// Accent colors for Sneedex (matching SneedexOffers)
const sneedexPrimary = '#8b5cf6'; // Purple
const sneedexSecondary = '#a78bfa';
const sneedexAccent = '#c4b5fd';

// CSS animation keyframes
const injectSneedexStyles = () => {
    if (document.getElementById('sneedex-landing-styles')) return;
    const style = document.createElement('style');
    style.id = 'sneedex-landing-styles';
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
        .sneedex-hero-icon {
            transition: transform 0.3s ease, box-shadow 0.3s ease;
        }
        .sneedex-hero-icon:hover {
            transform: scale(1.1) rotate(5deg);
            box-shadow: 0 8px 32px rgba(139, 92, 246, 0.4);
        }
        .sneedex-card {
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        }
        .sneedex-card:hover {
            transform: translateY(-4px);
            box-shadow: 0 12px 40px rgba(0, 0, 0, 0.15);
        }
        .sneedex-action-btn {
            transition: all 0.2s ease;
        }
        .sneedex-action-btn:hover {
            transform: translateY(-2px);
        }
        .sneedex-section {
            animation: sneedexFadeIn 0.5s ease-out forwards;
        }
    `;
    document.head.appendChild(style);
};

function Sneedex() {
    const { identity, isAuthenticated } = useAuth();
    const { theme } = useTheme();
    const [stats, setStats] = useState(null);
    const [feeRate, setFeeRate] = useState(null);
    const [isAdmin, setIsAdmin] = useState(false);
    const [loading, setLoading] = useState(true);
    
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
        injectSneedexStyles();
        
        const fetchStats = async () => {
            setLoading(true);
            try {
                const actor = createSneedexActor(identity);
                const marketStats = await actor.getMarketStats();
                setStats(marketStats);
            } catch (e) {
                console.error('Failed to fetch market stats:', e);
            } finally {
                setLoading(false);
            }
        };
        fetchStats();
        fetchFeeSettings();
        checkAdminStatus();
    }, [identity, fetchFeeSettings, checkAdminStatus]);

    const assetTypes = [
        {
            icon: <FaCubes size={28} />,
            title: 'Canisters',
            description: 'Trade full Internet Computer canisters. Controllers are transferred atomically through escrow.',
            color: sneedexPrimary,
        },
        {
            icon: <FaBrain size={28} />,
            title: 'SNS Neurons',
            description: 'Buy and sell SNS governance neurons. Hotkey permissions ensure secure atomic transfers.',
            color: '#22c55e',
        },
        {
            icon: '🏛️',
            title: 'ICP Neuron Managers',
            description: 'Trade ICP neurons via manager canisters. Full NNS voting power, liquid ownership.',
            color: '#3b82f6',
        },
        {
            icon: <FaCoins size={28} />,
            title: 'ICRC1 Tokens',
            description: 'Bundle fungible tokens into offers. Perfect for OTC trades and bulk transactions.',
            color: '#f59e0b',
        },
    ];

    const steps = [
        { number: '01', title: 'Create an Offer', description: 'Define your terms: minimum bid, buyout price, and expiration.', icon: <FaGavel size={18} /> },
        { number: '02', title: 'Escrow Your Assets', description: 'Transfer asset control to Sneedex. Your assets are safe.', icon: <FaShieldAlt size={18} /> },
        { number: '03', title: 'Receive Bids', description: 'Buyers place bids. Buyout triggers instant completion.', icon: <FaChartLine size={18} /> },
        { number: '04', title: 'Atomic Settlement', description: 'Assets transfer to winner, payment to seller—atomically.', icon: <FaCheckCircle size={18} /> },
    ];

    const features = [
        { icon: '🔒', title: 'Trustless Escrow', description: 'No middleman, no trust required—just code.' },
        { icon: '⚡', title: 'Atomic Transfers', description: 'All assets change hands simultaneously.' },
        { icon: '📦', title: 'Asset Bundling', description: 'Combine canisters, neurons, and tokens.' },
        { icon: '🎯', title: 'Flexible Pricing', description: 'Auctions, buyouts, or combinations.' },
    ];

    return (
        <div className='page-container' style={{ background: theme.colors.primaryGradient, minHeight: '100vh' }}>
            <Header />
            
            <main style={{ color: theme.colors.primaryText }}>
                {/* Hero Section */}
                <div style={{
                    background: `linear-gradient(180deg, ${sneedexPrimary}12 0%, transparent 100%)`,
                    borderBottom: `1px solid ${theme.colors.border}`,
                    padding: '2rem 1.5rem 2rem',
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
                    
                    <div style={{ maxWidth: '1200px', margin: '0 auto', position: 'relative', zIndex: 1 }}>
                        {/* Breadcrumb */}
                        <nav style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.5rem',
                            marginBottom: '1.5rem',
                            fontSize: '0.85rem',
                        }}>
                            <Link to="/" style={{ 
                                color: theme.colors.mutedText, 
                                textDecoration: 'none',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.35rem',
                            }}>
                                <FaHome size={12} /> Home
                            </Link>
                            <FaChevronRight size={10} style={{ color: theme.colors.mutedText }} />
                            <span style={{ color: sneedexPrimary, fontWeight: '600' }}>Sneedex</span>
                        </nav>
                        
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
                                marginBottom: '0.75rem'
                            }}>
                                <div 
                                    className="sneedex-hero-icon"
                                    style={{
                                        width: '64px',
                                        height: '64px',
                                        borderRadius: '18px',
                                        background: `linear-gradient(135deg, ${sneedexPrimary}, ${sneedexSecondary})`,
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        boxShadow: `0 4px 24px ${sneedexPrimary}40`
                                    }}
                                >
                                    <FaExchangeAlt size={30} color="white" />
                                </div>
                                <h1 style={{
                                    fontSize: 'clamp(2rem, 5vw, 2.75rem)',
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
                                fontSize: '1.1rem',
                                margin: '0 0 0.5rem 0',
                                fontStyle: 'italic',
                            }}>
                                The Decentralized Exchange for Everything
                            </p>
                            
                            <p style={{
                                color: theme.colors.secondaryText,
                                fontSize: '0.95rem',
                                margin: 0,
                                maxWidth: '600px',
                                lineHeight: '1.6',
                            }}>
                                Trade canisters, SNS neurons, ICP Neuron Managers, and ICRC1 tokens through trustless escrow auctions.
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
                            <Link
                                to="/sneedex_offers"
                                className="sneedex-action-btn"
                                style={{
                                    background: `linear-gradient(135deg, ${sneedexPrimary}, ${sneedexSecondary})`,
                                    color: 'white',
                                    padding: '12px 24px',
                                    borderRadius: '12px',
                                    border: 'none',
                                    fontSize: '1rem',
                                    fontWeight: '600',
                                    textDecoration: 'none',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '8px',
                                    boxShadow: `0 4px 16px ${sneedexPrimary}30`
                                }}
                            >
                                <FaExchangeAlt /> Browse Marketplace
                            </Link>
                            {isAuthenticated && (
                                <Link
                                    to="/sneedex_create"
                                    className="sneedex-action-btn"
                                    style={{
                                        background: theme.colors.tertiaryBg,
                                        color: sneedexPrimary,
                                        padding: '12px 24px',
                                        borderRadius: '12px',
                                        border: `2px solid ${sneedexPrimary}`,
                                        fontSize: '1rem',
                                        fontWeight: '600',
                                        textDecoration: 'none',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '8px',
                                    }}
                                >
                                    <FaGavel /> Create Offer
                                </Link>
                            )}
                            {isAuthenticated && (
                                <Link
                                    to="/sneedex_my"
                                    className="sneedex-action-btn"
                                    style={{
                                        background: theme.colors.tertiaryBg,
                                        color: theme.colors.primaryText,
                                        padding: '12px 24px',
                                        borderRadius: '12px',
                                        border: `1px solid ${theme.colors.border}`,
                                        fontSize: '1rem',
                                        fontWeight: '500',
                                        textDecoration: 'none',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '8px',
                                    }}
                                >
                                    📋 My Offers & Bids
                                </Link>
                            )}
                        </div>
                        
                        {/* Live Stats */}
                        {stats && (
                            <div style={{
                                display: 'flex',
                                justifyContent: 'center',
                                gap: '1rem',
                                flexWrap: 'wrap',
                            }}>
                                {[
                                    { label: 'Active', value: Number(stats.active_offers), color: sneedexPrimary },
                                    { label: 'Total', value: Number(stats.total_offers), color: theme.colors.secondaryText },
                                    { label: 'Completed', value: Number(stats.completed_offers), color: '#22c55e' },
                                    { label: 'Bids', value: Number(stats.total_bids), color: '#f59e0b' },
                                    ...(feeRate !== null ? [{ label: 'Fee', value: formatFeeRate(feeRate), color: '#ec4899', isText: true }] : []),
                                ].map((stat, index) => (
                                    <div
                                        key={index}
                                        style={{
                                            background: theme.colors.secondaryBg,
                                            border: `1px solid ${theme.colors.border}`,
                                            borderRadius: '10px',
                                            padding: '0.75rem 1.25rem',
                                            textAlign: 'center',
                                            minWidth: '80px',
                                        }}
                                    >
                                        <div style={{
                                            fontSize: stat.isText ? '1rem' : '1.5rem',
                                            fontWeight: '700',
                                            color: stat.color,
                                        }}>
                                            {stat.value}
                                        </div>
                                        <div style={{
                                            fontSize: '0.7rem',
                                            color: theme.colors.mutedText,
                                            textTransform: 'uppercase',
                                            letterSpacing: '0.5px',
                                        }}>
                                            {stat.label}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
                
                {/* Main Content */}
                <div style={{ padding: '2rem 1.5rem', maxWidth: '1200px', margin: '0 auto' }}>
                    {/* Liquid Staking & Jailbreak Banners */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '2rem' }}>
                        {/* Liquid Staking Banner */}
                        <div className="sneedex-card" style={{
                            background: `linear-gradient(135deg, ${sneedexPrimary}08, #22c55e08)`,
                            border: `1px solid ${sneedexPrimary}25`,
                            borderRadius: '16px',
                            padding: '1.25rem 1.5rem',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: '1rem',
                            flexWrap: 'wrap',
                        }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flex: 1, minWidth: '200px' }}>
                                <span style={{ fontSize: '1.5rem' }}>✨</span>
                                <div>
                                    <div style={{ color: theme.colors.primaryText, fontWeight: '700', fontSize: '1rem' }}>
                                        Liquid Staking
                                    </div>
                                    <div style={{ color: theme.colors.secondaryText, fontSize: '0.85rem' }}>
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
                                        background: 'linear-gradient(135deg, #22c55e, #16a34a)',
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
                        <div className="sneedex-card" style={{
                            background: 'linear-gradient(135deg, #f5730008, #ea580c08)',
                            border: '1px solid #f5730025',
                            borderRadius: '16px',
                            padding: '1rem 1.5rem',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: '1rem',
                            flexWrap: 'wrap',
                        }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flex: 1, minWidth: '200px' }}>
                                <FaUnlock size={20} style={{ color: '#f57300' }} />
                                <div>
                                    <div style={{ color: theme.colors.primaryText, fontWeight: '700', fontSize: '0.95rem' }}>
                                        SNS Jailbreak
                                    </div>
                                    <div style={{ color: theme.colors.secondaryText, fontSize: '0.85rem' }}>
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

                    {/* What is Sneedex */}
                    <section className="sneedex-section" style={{
                        background: theme.colors.cardGradient,
                        border: `1px solid ${theme.colors.border}`,
                        borderRadius: '16px',
                        padding: 'clamp(1.25rem, 3vw, 2rem)',
                        marginBottom: '1.5rem',
                        boxShadow: theme.colors.cardShadow,
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
                            <div style={{
                                width: '40px',
                                height: '40px',
                                borderRadius: '12px',
                                background: `linear-gradient(135deg, ${sneedexPrimary}20, ${sneedexPrimary}10)`,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                            }}>
                                <FaShieldAlt size={18} color={sneedexPrimary} />
                            </div>
                            <h2 style={{ fontSize: '1.35rem', fontWeight: '700', color: theme.colors.primaryText, margin: 0 }}>
                                What is Sneedex?
                            </h2>
                        </div>
                        <p style={{ fontSize: '0.95rem', lineHeight: '1.7', color: theme.colors.secondaryText, margin: 0 }}>
                            Sneedex is a <strong style={{ color: sneedexPrimary }}>trustless marketplace</strong> for trading unique Internet Computer assets. 
                            Unlike traditional DEXes, Sneedex enables atomic trades of <strong>canisters</strong>, <strong>SNS neurons</strong>, and 
                            <strong> ICRC1 tokens</strong>—all through secure escrow. Create offers with flexible pricing and let buyers compete through trustless bidding.
                        </p>
                    </section>

                    {/* Supported Asset Types */}
                    <section className="sneedex-section" style={{
                        background: theme.colors.cardGradient,
                        border: `1px solid ${theme.colors.border}`,
                        borderRadius: '16px',
                        padding: 'clamp(1.25rem, 3vw, 2rem)',
                        marginBottom: '1.5rem',
                        boxShadow: theme.colors.cardShadow,
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.25rem' }}>
                            <div style={{
                                width: '40px',
                                height: '40px',
                                borderRadius: '12px',
                                background: `linear-gradient(135deg, #22c55e20, #22c55e10)`,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                            }}>
                                <FaCubes size={18} color="#22c55e" />
                            </div>
                            <h2 style={{ fontSize: '1.35rem', fontWeight: '700', color: theme.colors.primaryText, margin: 0 }}>
                                Supported Assets
                            </h2>
                        </div>
                        
                        <div style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
                            gap: '1rem',
                        }}>
                            {assetTypes.map((asset, index) => (
                                <div
                                    key={index}
                                    className="sneedex-card"
                                    style={{
                                        background: theme.colors.tertiaryBg,
                                        border: `1px solid ${theme.colors.border}`,
                                        borderRadius: '14px',
                                        padding: '1.25rem',
                                        cursor: 'default',
                                    }}
                                    onMouseEnter={(e) => {
                                        e.currentTarget.style.borderColor = asset.color + '60';
                                    }}
                                    onMouseLeave={(e) => {
                                        e.currentTarget.style.borderColor = theme.colors.border;
                                    }}
                                >
                                    <div style={{ color: asset.color, marginBottom: '0.75rem' }}>
                                        {typeof asset.icon === 'string' ? (
                                            <span style={{ fontSize: '1.75rem' }}>{asset.icon}</span>
                                        ) : asset.icon}
                                    </div>
                                    <h3 style={{ fontSize: '1.05rem', fontWeight: '700', color: asset.color, marginBottom: '0.35rem' }}>
                                        {asset.title}
                                    </h3>
                                    <p style={{ fontSize: '0.85rem', color: theme.colors.secondaryText, lineHeight: '1.5', margin: 0 }}>
                                        {asset.description}
                                    </p>
                                </div>
                            ))}
                        </div>
                    </section>

                    {/* How It Works */}
                    <section className="sneedex-section" style={{
                        background: theme.colors.cardGradient,
                        border: `1px solid ${theme.colors.border}`,
                        borderRadius: '16px',
                        padding: 'clamp(1.25rem, 3vw, 2rem)',
                        marginBottom: '1.5rem',
                        boxShadow: theme.colors.cardShadow,
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.25rem' }}>
                            <div style={{
                                width: '40px',
                                height: '40px',
                                borderRadius: '12px',
                                background: 'linear-gradient(135deg, #f59e0b20, #f59e0b10)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                            }}>
                                <FaRocket size={18} color="#f59e0b" />
                            </div>
                            <h2 style={{ fontSize: '1.35rem', fontWeight: '700', color: theme.colors.primaryText, margin: 0 }}>
                                How It Works
                            </h2>
                        </div>
                        
                        <div style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                            gap: '1rem',
                        }}>
                            {steps.map((step, index) => (
                                <div
                                    key={index}
                                    style={{
                                        background: theme.colors.tertiaryBg,
                                        border: `1px solid ${theme.colors.border}`,
                                        borderRadius: '14px',
                                        padding: '1.25rem',
                                    }}
                                >
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
                                        <span style={{ fontSize: '1.25rem', fontWeight: '800', color: sneedexPrimary, opacity: 0.4 }}>
                                            {step.number}
                                        </span>
                                        <div style={{
                                            width: '32px',
                                            height: '32px',
                                            borderRadius: '8px',
                                            background: `linear-gradient(135deg, ${sneedexPrimary}20, ${sneedexPrimary}10)`,
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            color: sneedexPrimary,
                                        }}>
                                            {step.icon}
                                        </div>
                                    </div>
                                    <h4 style={{ fontSize: '1rem', fontWeight: '700', color: theme.colors.primaryText, marginBottom: '0.35rem' }}>
                                        {step.title}
                                    </h4>
                                    <p style={{ fontSize: '0.85rem', color: theme.colors.secondaryText, lineHeight: '1.5', margin: 0 }}>
                                        {step.description}
                                    </p>
                                </div>
                            ))}
                        </div>
                    </section>

                    {/* Key Features */}
                    <section className="sneedex-section" style={{
                        background: theme.colors.cardGradient,
                        border: `1px solid ${theme.colors.border}`,
                        borderRadius: '16px',
                        padding: 'clamp(1.25rem, 3vw, 2rem)',
                        marginBottom: '1.5rem',
                        boxShadow: theme.colors.cardShadow,
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.25rem' }}>
                            <div style={{
                                width: '40px',
                                height: '40px',
                                borderRadius: '12px',
                                background: `linear-gradient(135deg, ${sneedexPrimary}20, ${sneedexPrimary}10)`,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                            }}>
                                <FaCoins size={18} color={sneedexPrimary} />
                            </div>
                            <h2 style={{ fontSize: '1.35rem', fontWeight: '700', color: theme.colors.primaryText, margin: 0 }}>
                                Key Features
                            </h2>
                        </div>
                        
                        <div style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
                            gap: '1rem',
                        }}>
                            {features.map((feature, index) => (
                                <div
                                    key={index}
                                    style={{
                                        display: 'flex',
                                        alignItems: 'flex-start',
                                        gap: '0.75rem',
                                        padding: '1rem',
                                        background: theme.colors.tertiaryBg,
                                        borderRadius: '12px',
                                        border: `1px solid ${theme.colors.border}`,
                                    }}
                                >
                                    <span style={{ fontSize: '1.5rem', flexShrink: 0 }}>{feature.icon}</span>
                                    <div>
                                        <h4 style={{ fontSize: '0.95rem', fontWeight: '700', color: theme.colors.primaryText, marginBottom: '0.25rem' }}>
                                            {feature.title}
                                        </h4>
                                        <p style={{ fontSize: '0.85rem', color: theme.colors.secondaryText, lineHeight: '1.5', margin: 0 }}>
                                            {feature.description}
                                        </p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </section>
                    
                    {/* Admin Link */}
                    {isAdmin && (
                        <section className="sneedex-section" style={{
                            background: theme.colors.cardGradient,
                            border: `2px solid #f59e0b30`,
                            borderRadius: '16px',
                            padding: '1.25rem 1.5rem',
                            marginBottom: '1.5rem',
                        }}>
                            <Link
                                to="/admin/sneedex"
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '0.75rem',
                                    textDecoration: 'none',
                                }}
                            >
                                <div style={{
                                    width: '40px',
                                    height: '40px',
                                    borderRadius: '12px',
                                    background: 'linear-gradient(135deg, #f59e0b20, #f59e0b10)',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                }}>
                                    <FaCog size={18} color="#f59e0b" />
                                </div>
                                <div>
                                    <h3 style={{ fontSize: '1.1rem', fontWeight: '700', color: theme.colors.primaryText, margin: 0 }}>
                                        Admin Settings
                                    </h3>
                                    <p style={{ color: theme.colors.mutedText, margin: 0, fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                                        Manage fees, admins, and configuration <FaArrowRight size={10} />
                                    </p>
                                </div>
                            </Link>
                        </section>
                    )}

                    {/* CTA Section */}
                    <section className="sneedex-section" style={{
                        background: `linear-gradient(135deg, ${sneedexPrimary}12, ${sneedexSecondary}08)`,
                        border: `1px solid ${sneedexPrimary}25`,
                        borderRadius: '16px',
                        padding: 'clamp(1.5rem, 4vw, 2.5rem)',
                        textAlign: 'center',
                    }}>
                        <h2 style={{ fontSize: '1.5rem', fontWeight: '700', color: theme.colors.primaryText, marginBottom: '0.75rem' }}>
                            Ready to Trade?
                        </h2>
                        <p style={{ fontSize: '0.95rem', color: theme.colors.secondaryText, maxWidth: '500px', margin: '0 auto 1.5rem auto', lineHeight: '1.6' }}>
                            Browse active offers, create your own, or manage your existing trades.
                        </p>
                        <div style={{ display: 'flex', justifyContent: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                            <Link
                                to="/sneedex_offers"
                                className="sneedex-action-btn"
                                style={{
                                    background: `linear-gradient(135deg, ${sneedexPrimary}, ${sneedexSecondary})`,
                                    color: 'white',
                                    padding: '12px 28px',
                                    borderRadius: '12px',
                                    textDecoration: 'none',
                                    fontSize: '1rem',
                                    fontWeight: '600',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '8px',
                                    boxShadow: `0 4px 16px ${sneedexPrimary}30`
                                }}
                            >
                                <FaExchangeAlt /> Explore Marketplace
                            </Link>
                        </div>
                    </section>
                </div>
            </main>
        </div>
    );
}

export default Sneedex;
