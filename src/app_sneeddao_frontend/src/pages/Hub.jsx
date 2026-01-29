import React, { useState } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import Header from '../components/Header';
import { Link } from 'react-router-dom';
import { FaExchangeAlt, FaCoins, FaLock, FaComments, FaWallet, FaServer, FaNewspaper, FaUsers, FaVoteYea, FaRss, FaArrowRight, FaHistory, FaStar, FaUnlock, FaShieldAlt, FaGlobe } from 'react-icons/fa';

// Custom CSS for animations
const customStyles = `
@keyframes shimmer {
    0% { background-position: -200% 0; }
    100% { background-position: 200% 0; }
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

@keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.7; }
}

@keyframes float {
    0%, 100% { transform: translateY(0px); }
    50% { transform: translateY(-8px); }
}

@keyframes gradientShift {
    0% { background-position: 0% 50%; }
    50% { background-position: 100% 50%; }
    100% { background-position: 0% 50%; }
}

@keyframes glow {
    0%, 100% { box-shadow: 0 0 20px rgba(99, 102, 241, 0.3); }
    50% { box-shadow: 0 0 40px rgba(99, 102, 241, 0.5); }
}

.hub-card-animate {
    animation: fadeInUp 0.5s ease-out forwards;
    opacity: 0;
}

.hub-shimmer {
    background: linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.08) 50%, transparent 100%);
    background-size: 200% 100%;
    animation: shimmer 2s infinite;
}

.hub-pulse {
    animation: pulse 2s ease-in-out infinite;
}

.hub-float {
    animation: float 4s ease-in-out infinite;
}

.hub-glow {
    animation: glow 3s ease-in-out infinite;
}

.hub-gradient-animate {
    background-size: 200% 200%;
    animation: gradientShift 8s ease infinite;
}
`;

// Accent colors for the hub
const hubPrimary = '#6366f1'; // Indigo
const hubSecondary = '#8b5cf6'; // Purple
const hubAccent = '#06b6d4'; // Cyan

function Hub() {
    const { theme } = useTheme();
    const [hoveredCard, setHoveredCard] = useState(null);

    const featuredProducts = [
        {
            title: 'Sneedex Marketplace',
            icon: <FaExchangeAlt size={28} />,
            desc: 'Trade canisters, neurons, tokens, and more through secure on-chain escrow. Buy and sell staking positions, neuron managers, and digital assets with confidence.',
            path: '/sneedex_offers',
            cta: 'Browse Marketplace',
            color: hubPrimary,
            badge: 'Popular',
            gradient: `linear-gradient(135deg, ${hubPrimary}20 0%, ${hubSecondary}10 100%)`,
        },
        {
            title: 'Liquid Staking',
            icon: <FaCoins size={28} />,
            desc: 'Make your staking positions tradable! Create ICP Neuron Manager canisters or stake SNS tokens in a way that keeps them transferable and sellable on Sneedex.',
            path: '/liquid_staking',
            cta: 'Start Staking',
            color: theme.colors.success,
            badge: 'New',
            gradient: `linear-gradient(135deg, ${theme.colors.success}20 0%, #10b98110 100%)`,
        },
        {
            title: 'Sneed Lock',
            icon: <FaLock size={28} />,
            desc: 'Lock tokens or ICPSwap liquidity positions with transferable "Liquid Locks" — keep your locks tradable on Sneedex. Perfect for team tokens, investor vesting, or secure savings.',
            path: '/sneedlock_info',
            cta: 'Create Lock',
            color: '#9b59b6',
            badge: 'New',
            gradient: `linear-gradient(135deg, #9b59b620 0%, #8e44ad10 100%)`,
        },
        {
            title: 'SNS Jailbreak',
            icon: <FaUnlock size={28} />,
            desc: 'Unlock your SNS neurons! Add your Sneed Wallet as a full controller to make neurons tradable on Sneedex, fully manageable from your wallet, and truly liquid.',
            path: '/tools/sns_jailbreak',
            cta: 'Jailbreak Neurons',
            color: '#e67e22',
            badge: 'Tool',
            gradient: `linear-gradient(135deg, #e67e2220 0%, #d3540010 100%)`,
        },
    ];

    const communityFeatures = [
        {
            title: 'SNS Forum',
            icon: <FaComments size={22} />,
            desc: 'Discuss proposals, share ideas, and engage with your DAO community. Rich text with Markdown and emoji support.',
            path: '/forum',
            cta: 'Visit Forum',
            color: '#e74c3c',
        },
        {
            title: 'Activity Feed',
            icon: <FaRss size={22} />,
            desc: 'Stay up to date with the latest activity across SNS DAOs. See proposals, votes, and community updates in real-time.',
            path: '/feed',
            cta: 'View Feed',
            color: '#f39c12',
        },
        {
            title: 'Direct Messages',
            icon: <FaUsers size={22} />,
            desc: 'Send private messages to other users with full Markdown and emoji support.',
            path: '/sms',
            cta: 'Open Messages',
            color: '#1abc9c',
        },
    ];

    const governanceFeatures = [
        {
            title: 'Proposals',
            icon: <FaVoteYea size={22} />,
            desc: 'Browse and vote on proposals across all SNS DAOs. Track voting activity and governance decisions.',
            path: '/proposals',
            cta: 'View Proposals',
            color: hubPrimary,
        },
        {
            title: 'Neurons',
            icon: <FaNewspaper size={22} />,
            desc: 'Explore neurons, manage voting power, and configure your staking positions.',
            path: '/neurons',
            cta: 'Browse Neurons',
            color: theme.colors.success,
        },
        {
            title: 'Users',
            icon: <FaUsers size={22} />,
            desc: 'Discover users with neuron holdings, see their stake, and explore their governance activity.',
            path: '/users',
            cta: 'Browse Users',
            color: '#f39c12',
        },
        {
            title: 'SNS Directory',
            icon: <FaUsers size={22} />,
            desc: 'Discover SNS DAOs and explore their governance, communities, and tokens.',
            path: '/sns',
            cta: 'Browse SNSes',
            color: '#9b59b6',
        },
    ];

    const utilityFeatures = [
        {
            title: 'Wallet',
            icon: <FaWallet size={22} />,
            desc: 'Track your token balances across all SNS tokens and ICP. Send, receive, and manage your assets.',
            path: '/wallet',
            cta: 'Open Wallet',
            color: hubPrimary,
        },
        {
            title: 'Canisters',
            icon: <FaServer size={22} />,
            desc: 'Monitor your canisters, check cycles, and manage canister ownership and controllers.',
            path: '/canisters',
            cta: 'Manage Canisters',
            color: theme.colors.success,
        },
        {
            title: 'Transactions',
            icon: <FaHistory size={22} />,
            desc: 'Browse and search transaction history across tokens. Track transfers, swaps, and more.',
            path: '/transactions',
            cta: 'View Transactions',
            color: '#9b59b6',
        },
    ];

    const renderFeatureCard = (card, index, sectionOffset = 0) => {
        const cardKey = `${card.title}-${index}`;
        const isHovered = hoveredCard === cardKey;
        
        return (
            <Link
                key={card.title}
                to={card.path}
                className="hub-card-animate"
                style={{
                    background: theme.colors.secondaryBg,
                    border: `1px solid ${isHovered ? card.color : theme.colors.border}`,
                    borderRadius: '16px',
                    padding: '1.5rem',
                    display: 'flex',
                    flexDirection: 'column',
                    textDecoration: 'none',
                    color: 'inherit',
                    transition: 'all 0.3s ease',
                    transform: isHovered ? 'translateY(-4px)' : 'translateY(0)',
                    boxShadow: isHovered 
                        ? `0 12px 40px ${card.color}25` 
                        : '0 2px 10px rgba(0,0,0,0.1)',
                    animationDelay: `${(sectionOffset + index) * 0.08}s`,
                    opacity: 0,
                }}
                onMouseEnter={() => setHoveredCard(cardKey)}
                onMouseLeave={() => setHoveredCard(null)}
            >
                <div style={{
                    width: '48px',
                    height: '48px',
                    borderRadius: '12px',
                    background: `${card.color}15`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginBottom: '1rem',
                    color: card.color,
                    transition: 'all 0.3s ease',
                    transform: isHovered ? 'scale(1.1)' : 'scale(1)',
                }}>
                    {card.icon}
                </div>
                <div style={{
                    color: theme.colors.primaryText,
                    fontWeight: '700',
                    fontSize: '1.1rem',
                    marginBottom: '0.5rem',
                }}>
                    {card.title}
                </div>
                <div style={{
                    color: theme.colors.mutedText,
                    fontSize: '0.9rem',
                    lineHeight: '1.6',
                    marginBottom: '1rem',
                    flex: 1,
                }}>
                    {card.desc}
                </div>
                <div style={{
                    color: card.color,
                    fontWeight: '600',
                    fontSize: '0.9rem',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    transition: 'all 0.2s ease',
                    transform: isHovered ? 'translateX(4px)' : 'translateX(0)',
                }}>
                    {card.cta}
                    <FaArrowRight size={12} />
                </div>
            </Link>
        );
    };

    const renderSectionHeader = (icon, title, color, delay = 0) => (
        <div 
            className="hub-card-animate"
            style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                marginBottom: '1.25rem',
                animationDelay: `${delay}s`,
                opacity: 0,
            }}
        >
            <div style={{
                width: '40px',
                height: '40px',
                borderRadius: '12px',
                background: `linear-gradient(135deg, ${color}, ${color}cc)`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'white',
                boxShadow: `0 4px 15px ${color}40`,
            }}>
                {icon}
            </div>
            <h2 style={{
                fontSize: '1.5rem',
                fontWeight: '700',
                color: theme.colors.primaryText,
                margin: 0,
            }}>
                {title}
            </h2>
        </div>
    );

    return (
        <div 
            className='page-container'
            style={{
                background: theme.colors.primaryGradient,
                color: theme.colors.primaryText,
                minHeight: '100vh'
            }}
        >
            <style>{customStyles}</style>
            <Header showSnsDropdown={true} />
            
            <main style={{
                maxWidth: '1200px',
                margin: '0 auto',
                padding: '2rem'
            }}>
                {/* Hero Section */}
                <div style={{
                    background: `linear-gradient(135deg, ${theme.colors.secondaryBg} 0%, ${hubPrimary}15 50%, ${hubSecondary}10 100%)`,
                    borderRadius: '24px',
                    padding: '3.5rem 2.5rem',
                    marginBottom: '2rem',
                    border: `1px solid ${theme.colors.border}`,
                    textAlign: 'center',
                    position: 'relative',
                    overflow: 'hidden',
                }}>
                    {/* Background decorations */}
                    <div style={{
                        position: 'absolute',
                        top: '-60%',
                        right: '-10%',
                        width: '500px',
                        height: '500px',
                        background: `radial-gradient(circle, ${hubPrimary}20 0%, transparent 70%)`,
                        borderRadius: '50%',
                        pointerEvents: 'none',
                    }} />
                    <div style={{
                        position: 'absolute',
                        bottom: '-40%',
                        left: '-5%',
                        width: '400px',
                        height: '400px',
                        background: `radial-gradient(circle, ${hubSecondary}15 0%, transparent 70%)`,
                        borderRadius: '50%',
                        pointerEvents: 'none',
                    }} />
                    <div style={{
                        position: 'absolute',
                        top: '20%',
                        left: '10%',
                        width: '200px',
                        height: '200px',
                        background: `radial-gradient(circle, ${hubAccent}10 0%, transparent 70%)`,
                        borderRadius: '50%',
                        pointerEvents: 'none',
                    }} />
                    
                    {/* Hero Content */}
                    <div style={{ position: 'relative', zIndex: 1 }}>
                        {/* Animated Icon */}
                        <div 
                            className="hub-float hub-glow"
                            style={{
                                width: '80px',
                                height: '80px',
                                borderRadius: '50%',
                                background: `linear-gradient(135deg, ${hubPrimary}, ${hubSecondary})`,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                margin: '0 auto 1.5rem auto',
                                padding: '12px',
                                boxSizing: 'border-box',
                            }}
                        >
                            <img 
                                src="sneed_logo.png" 
                                alt="Sneed Logo" 
                                style={{
                                    width: '100%',
                                    height: '100%',
                                    borderRadius: '50%',
                                    objectFit: 'cover',
                                }}
                            />
                        </div>
                        
                        <h1 style={{
                            fontSize: 'clamp(2rem, 5vw, 3rem)',
                            fontWeight: '800',
                            color: theme.colors.primaryText,
                            marginBottom: '1.5rem',
                            letterSpacing: '-0.02em',
                            lineHeight: '1.2',
                        }}>
                            Your Home on the{' '}
                            <span style={{
                                background: `linear-gradient(135deg, ${hubPrimary}, ${hubSecondary})`,
                                WebkitBackgroundClip: 'text',
                                WebkitTextFillColor: 'transparent',
                                backgroundClip: 'text',
                            }}>
                                Internet Computer
                            </span>
                        </h1>
                        
                        <p style={{
                            color: theme.colors.secondaryText,
                            fontSize: '1.15rem',
                            lineHeight: '1.8',
                            maxWidth: '800px',
                            margin: '0 auto 2rem auto',
                        }}>
                            Trade assets on <Link to="/sneedex_offers" style={{ color: hubPrimary, fontWeight: '600', textDecoration: 'none' }}>Sneedex</Link>, 
                            unlock <Link to="/liquid_staking" style={{ color: theme.colors.success, fontWeight: '600', textDecoration: 'none' }}>liquid staking</Link> for ICP and SNS neurons, 
                            secure tokens with <Link to="/sneedlock_info" style={{ color: '#9b59b6', fontWeight: '600', textDecoration: 'none' }}>Sneed Lock</Link>, 
                            engage in <Link to="/proposals" style={{ color: hubPrimary, fontWeight: '600', textDecoration: 'none' }}>DAO governance</Link>, 
                            discuss in <Link to="/forum" style={{ color: '#e74c3c', fontWeight: '600', textDecoration: 'none' }}>forums</Link>, 
                            and manage everything from your <Link to="/wallet" style={{ color: hubAccent, fontWeight: '600', textDecoration: 'none' }}>wallet</Link>.
                        </p>
                        
                        {/* CTA Buttons */}
                        <div style={{
                            display: 'flex',
                            justifyContent: 'center',
                            gap: '1rem',
                            flexWrap: 'wrap',
                        }}>
                            <Link 
                                to="/sneedex_offers" 
                                style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '8px',
                                    background: `linear-gradient(135deg, ${hubPrimary}, ${hubSecondary})`,
                                    color: '#fff',
                                    padding: '14px 28px',
                                    borderRadius: '12px',
                                    textDecoration: 'none',
                                    fontWeight: '700',
                                    fontSize: '1rem',
                                    boxShadow: `0 4px 20px ${hubPrimary}40`,
                                    transition: 'all 0.3s ease',
                                }}
                            >
                                <FaExchangeAlt />
                                Browse Sneedex
                            </Link>
                            <Link 
                                to="/liquid_staking" 
                                style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '8px',
                                    background: theme.colors.success,
                                    color: '#fff',
                                    padding: '14px 28px',
                                    borderRadius: '12px',
                                    textDecoration: 'none',
                                    fontWeight: '700',
                                    fontSize: '1rem',
                                    boxShadow: `0 4px 20px ${theme.colors.success}40`,
                                    transition: 'all 0.3s ease',
                                }}
                            >
                                <FaCoins />
                                Liquid Staking
                            </Link>
                            <Link 
                                to="/sneedlock_info" 
                                style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '8px',
                                    background: '#9b59b6',
                                    color: '#fff',
                                    padding: '14px 28px',
                                    borderRadius: '12px',
                                    textDecoration: 'none',
                                    fontWeight: '700',
                                    fontSize: '1rem',
                                    boxShadow: '0 4px 20px rgba(155, 89, 182, 0.4)',
                                    transition: 'all 0.3s ease',
                                }}
                            >
                                <FaLock />
                                Sneed Lock
                            </Link>
                        </div>
                    </div>
                </div>

                {/* Context Note */}
                <div 
                    className="hub-card-animate hub-shimmer"
                    style={{
                        background: `linear-gradient(135deg, ${hubPrimary}10 0%, ${hubSecondary}08 100%)`,
                        border: `1px solid ${hubPrimary}30`,
                        borderRadius: '14px',
                        padding: '1rem 1.5rem',
                        marginBottom: '2.5rem',
                        textAlign: 'center',
                        color: theme.colors.secondaryText,
                        fontSize: '0.95rem',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '10px',
                        animationDelay: '0.1s',
                        opacity: 0,
                    }}
                >
                    <span style={{ fontSize: '1.2rem' }}>💡</span>
                    <span>
                        Use the <strong style={{ color: hubPrimary }}>SNS dropdown</strong> in the header to switch context across DAOs anywhere on the site.
                    </span>
                </div>

                {/* Value Props */}
                <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                    gap: '1rem',
                    marginBottom: '3rem',
                }}>
                    {[
                        { icon: <FaShieldAlt size={20} />, title: 'Secure Escrow', desc: 'On-chain trading', color: hubPrimary },
                        { icon: <FaCoins size={20} />, title: 'Liquid Positions', desc: 'Tradable staking', color: theme.colors.success },
                        { icon: <FaGlobe size={20} />, title: 'Multi-DAO', desc: 'All SNS in one place', color: '#9b59b6' },
                    ].map((item, idx) => (
                        <div 
                            key={item.title}
                            className="hub-card-animate"
                            style={{
                                background: theme.colors.secondaryBg,
                                borderRadius: '14px',
                                padding: '1.25rem',
                                border: `1px solid ${theme.colors.border}`,
                                display: 'flex',
                                alignItems: 'center',
                                gap: '1rem',
                                animationDelay: `${0.15 + idx * 0.08}s`,
                                opacity: 0,
                            }}
                        >
                            <div style={{
                                width: '44px',
                                height: '44px',
                                borderRadius: '12px',
                                background: `linear-gradient(135deg, ${item.color}25, ${item.color}10)`,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                color: item.color,
                                flexShrink: 0,
                            }}>
                                {item.icon}
                            </div>
                            <div>
                                <div style={{ color: theme.colors.primaryText, fontWeight: '600', fontSize: '1rem' }}>
                                    {item.title}
                                </div>
                                <div style={{ color: theme.colors.mutedText, fontSize: '0.85rem' }}>
                                    {item.desc}
                                </div>
                            </div>
                        </div>
                    ))}
                </div>

                {/* Featured Products */}
                <div style={{ marginBottom: '3rem' }}>
                    {renderSectionHeader(<FaStar size={20} />, 'Featured Products', hubPrimary, 0.3)}
                    
                    <div style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                        gap: '1.25rem',
                    }}>
                        {featuredProducts.map((product, index) => {
                            const cardKey = `featured-${product.title}`;
                            const isHovered = hoveredCard === cardKey;
                            
                            return (
                                <Link
                                    key={product.title}
                                    to={product.path}
                                    className="hub-card-animate"
                                    style={{
                                        background: product.gradient,
                                        border: `2px solid ${isHovered ? product.color : `${product.color}30`}`,
                                        borderRadius: '20px',
                                        padding: '1.75rem',
                                        display: 'flex',
                                        flexDirection: 'column',
                                        textDecoration: 'none',
                                        color: 'inherit',
                                        position: 'relative',
                                        overflow: 'hidden',
                                        transition: 'all 0.3s ease',
                                        transform: isHovered ? 'translateY(-6px)' : 'translateY(0)',
                                        boxShadow: isHovered 
                                            ? `0 20px 50px ${product.color}30` 
                                            : '0 4px 20px rgba(0,0,0,0.1)',
                                        animationDelay: `${0.4 + index * 0.1}s`,
                                        opacity: 0,
                                    }}
                                    onMouseEnter={() => setHoveredCard(cardKey)}
                                    onMouseLeave={() => setHoveredCard(null)}
                                >
                                    {/* Badge */}
                                    <div style={{
                                        position: 'absolute',
                                        top: '1rem',
                                        right: '1rem',
                                        background: `${product.color}20`,
                                        color: product.color,
                                        padding: '4px 12px',
                                        borderRadius: '20px',
                                        fontSize: '0.75rem',
                                        fontWeight: '700',
                                        textTransform: 'uppercase',
                                        letterSpacing: '0.5px',
                                    }}>
                                        {product.badge}
                                    </div>
                                    
                                    {/* Icon */}
                                    <div style={{
                                        width: '56px',
                                        height: '56px',
                                        borderRadius: '16px',
                                        background: `linear-gradient(135deg, ${product.color}30, ${product.color}15)`,
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        color: product.color,
                                        marginBottom: '1.25rem',
                                        transition: 'all 0.3s ease',
                                        transform: isHovered ? 'scale(1.1) rotate(5deg)' : 'scale(1)',
                                    }}>
                                        {product.icon}
                                    </div>
                                    
                                    <div style={{
                                        fontSize: '1.35rem',
                                        fontWeight: '700',
                                        color: theme.colors.primaryText,
                                        marginBottom: '0.75rem',
                                    }}>
                                        {product.title}
                                    </div>
                                    
                                    <div style={{
                                        color: theme.colors.secondaryText,
                                        fontSize: '0.95rem',
                                        lineHeight: '1.7',
                                        marginBottom: '1.5rem',
                                        flex: 1,
                                    }}>
                                        {product.desc}
                                    </div>
                                    
                                    <div style={{
                                        color: product.color,
                                        fontWeight: '600',
                                        fontSize: '0.95rem',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '6px',
                                        transition: 'all 0.2s ease',
                                        transform: isHovered ? 'translateX(6px)' : 'translateX(0)',
                                    }}>
                                        {product.cta}
                                        <FaArrowRight size={14} />
                                    </div>
                                </Link>
                            );
                        })}
                    </div>
                </div>

                {/* Community & Social */}
                <div style={{ marginBottom: '3rem' }}>
                    {renderSectionHeader(<FaComments size={20} />, 'Community & Social', '#e74c3c', 0.8)}
                    <div style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                        gap: '1rem',
                    }}>
                        {communityFeatures.map((card, index) => renderFeatureCard(card, index, 9))}
                    </div>
                </div>

                {/* Governance */}
                <div style={{ marginBottom: '3rem' }}>
                    {renderSectionHeader(<FaVoteYea size={20} />, 'Governance', hubPrimary, 1.1)}
                    <div style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                        gap: '1rem',
                    }}>
                        {governanceFeatures.map((card, index) => renderFeatureCard(card, index, 12))}
                    </div>
                </div>

                {/* Utilities */}
                <div style={{ marginBottom: '2.5rem' }}>
                    {renderSectionHeader(<FaWallet size={20} />, 'Utilities', theme.colors.success, 1.4)}
                    <div style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                        gap: '1rem',
                    }}>
                        {utilityFeatures.map((card, index) => renderFeatureCard(card, index, 15))}
                    </div>
                </div>

                {/* Sneed Premium */}
                <Link 
                    to="/premium"
                    className="hub-card-animate hub-gradient-animate"
                    style={{
                        display: 'block',
                        background: `linear-gradient(135deg, #ffd700 0%, #ffb700 25%, #ff9500 50%, #ffb700 75%, #ffd700 100%)`,
                        backgroundSize: '200% 200%',
                        borderRadius: '20px',
                        padding: '28px 32px',
                        marginTop: '1rem',
                        textDecoration: 'none',
                        position: 'relative',
                        overflow: 'hidden',
                        boxShadow: '0 8px 30px rgba(255, 215, 0, 0.35)',
                        animationDelay: '1.7s',
                        opacity: 0,
                    }}
                >
                    {/* Shimmer effect */}
                    <div 
                        className="hub-shimmer"
                        style={{
                            position: 'absolute',
                            inset: 0,
                            background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.3) 50%, transparent 100%)',
                            backgroundSize: '200% 100%',
                        }}
                    />
                    
                    <div style={{ 
                        display: 'flex', 
                        alignItems: 'center', 
                        gap: '20px', 
                        flexWrap: 'wrap',
                        position: 'relative',
                        zIndex: 1,
                    }}>
                        <div style={{
                            width: '56px',
                            height: '56px',
                            borderRadius: '16px',
                            background: 'rgba(26, 26, 26, 0.9)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            boxShadow: '0 4px 15px rgba(0,0,0,0.2)',
                        }}>
                            <FaStar size={28} style={{ color: '#ffd700' }} />
                        </div>
                        <div style={{ flex: 1, minWidth: '200px' }}>
                            <div style={{ 
                                color: '#1a1a1a', 
                                fontWeight: '800', 
                                fontSize: '1.5rem', 
                                marginBottom: '6px',
                                textShadow: '0 1px 2px rgba(255,255,255,0.3)',
                            }}>
                                Sneed Premium ✨
                            </div>
                            <div style={{ 
                                color: '#333', 
                                fontSize: '1.05rem', 
                                lineHeight: '1.5' 
                            }}>
                                Unlock exclusive features, priority support, and special perks. Join the premium experience!
                            </div>
                        </div>
                        <div style={{
                            background: '#1a1a1a',
                            color: '#ffd700',
                            padding: '14px 28px',
                            borderRadius: '12px',
                            fontWeight: '700',
                            fontSize: '1rem',
                            whiteSpace: 'nowrap',
                            boxShadow: '0 4px 15px rgba(0,0,0,0.2)',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                        }}>
                            Learn More
                            <FaArrowRight size={14} />
                        </div>
                    </div>
                </Link>
            </main>
        </div>
    );
}

export default Hub;
