import React from 'react';
import { Link } from 'react-router-dom';
import { FaArrowRight, FaExchangeAlt, FaLock, FaUnlock, FaCoins, FaCheckCircle, FaRocket, FaShieldAlt, FaBrain, FaWater } from 'react-icons/fa';
import Header from '../components/Header';
import { useTheme } from '../contexts/ThemeContext';

// Custom CSS for animations
const customStyles = `
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

@keyframes float {
    0%, 100% { transform: translateY(0px); }
    50% { transform: translateY(-8px); }
}

@keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.7; }
}

@keyframes shimmer {
    0% { background-position: -200% center; }
    100% { background-position: 200% center; }
}

.liquid-float {
    animation: float 3s ease-in-out infinite;
}

.liquid-fade-in {
    animation: fadeInUp 0.5s ease-out forwards;
}

.liquid-card-animate {
    animation: fadeInUp 0.4s ease-out forwards;
}
`;

// Page accent colors - teal/cyan theme for liquid
const liquidPrimary = '#06b6d4';
const liquidSecondary = '#22d3ee';
const liquidAccent = '#67e8f9';

export default function LiquidStaking() {
    const { theme } = useTheme();

    return (
        <div className="page-container" style={{ background: theme.colors.primaryGradient, minHeight: '100vh' }}>
            <style>{customStyles}</style>
            <Header />
            
            {/* Hero Section */}
            <div style={{
                background: `linear-gradient(135deg, ${theme.colors.primaryBg} 0%, ${liquidPrimary}15 50%, ${liquidSecondary}10 100%)`,
                borderBottom: `1px solid ${theme.colors.border}`,
                padding: '2.5rem 1.5rem',
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
                    background: `radial-gradient(circle, ${liquidPrimary}20 0%, transparent 70%)`,
                    pointerEvents: 'none'
                }} />
                <div style={{
                    position: 'absolute',
                    bottom: '-30%',
                    left: '5%',
                    width: '300px',
                    height: '300px',
                    background: `radial-gradient(circle, ${liquidSecondary}15 0%, transparent 70%)`,
                    pointerEvents: 'none'
                }} />
                
                <div style={{ maxWidth: '1000px', margin: '0 auto', position: 'relative', zIndex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem', marginBottom: '1rem' }}>
                        <div className="liquid-float" style={{
                            width: '64px',
                            height: '64px',
                            borderRadius: '18px',
                            background: `linear-gradient(135deg, ${liquidPrimary}, ${liquidSecondary})`,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            boxShadow: `0 8px 32px ${liquidPrimary}50`,
                            fontSize: '2rem'
                        }}>
                            💧
                        </div>
                        <div>
                            <div style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '6px',
                                background: `linear-gradient(135deg, ${liquidPrimary}25, ${liquidPrimary}10)`,
                                border: `1px solid ${liquidPrimary}40`,
                                borderRadius: '20px',
                                padding: '4px 12px',
                                fontSize: '0.75rem',
                                color: liquidPrimary,
                                fontWeight: '600',
                                marginBottom: '0.5rem'
                            }}>
                                <FaRocket size={10} />
                                Sneed DAO's Core Innovation
                            </div>
                            <h1 style={{
                                fontSize: '2rem',
                                fontWeight: '700',
                                color: theme.colors.primaryText,
                                margin: 0,
                                letterSpacing: '-0.5px'
                            }}>
                                Liquid Staking
                            </h1>
                        </div>
                    </div>
                    <p style={{
                        color: theme.colors.secondaryText,
                        fontSize: '1.05rem',
                        lineHeight: '1.7',
                        marginBottom: '1.25rem',
                        maxWidth: '800px'
                    }}>
                        Transform your staking positions into <span style={{ color: liquidPrimary, fontWeight: '600' }}>tradable assets</span>. 
                        When you create neurons through Sneed, they remain 
                        <span style={{ color: liquidPrimary, fontWeight: '600' }}> transferable and liquid</span> — 
                        sell your position anytime on Sneedex without waiting for dissolve delays.
                    </p>
                    
                    {/* Jailbreak callout */}
                    <div style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '10px',
                        background: `linear-gradient(135deg, ${theme.colors.success}15, ${liquidPrimary}10)`,
                        border: `1px solid ${theme.colors.success}40`,
                        borderRadius: '10px',
                        padding: '10px 16px',
                        fontSize: '0.9rem',
                        color: theme.colors.success,
                        marginBottom: '1.5rem',
                    }}>
                        <FaUnlock size={14} />
                        <span><strong>Already have SNS neurons?</strong> Use the <Link to="/tools/sns_jailbreak" style={{ color: theme.colors.success, fontWeight: '700' }}>Jailbreak Wizard</Link> to make them tradable!</span>
                    </div>
                    
                    {/* Action buttons */}
                    <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                        <Link 
                            to="/create_icp_neuron" 
                            style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '8px',
                                background: `linear-gradient(135deg, ${liquidPrimary}, ${liquidSecondary})`,
                                color: '#fff',
                                padding: '0.7rem 1.25rem',
                                borderRadius: '10px',
                                textDecoration: 'none',
                                fontWeight: '600',
                                fontSize: '0.9rem',
                                boxShadow: `0 4px 16px ${liquidPrimary}40`,
                                transition: 'all 0.2s'
                            }}
                        >
                            Start ICP Liquid Staking <FaArrowRight size={12} />
                        </Link>
                        <Link 
                            to="/sns_neuron_wizard" 
                            style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '8px',
                                background: 'transparent',
                                color: theme.colors.primaryText,
                                padding: '0.7rem 1.25rem',
                                borderRadius: '10px',
                                textDecoration: 'none',
                                fontWeight: '600',
                                fontSize: '0.9rem',
                                border: `1px solid ${theme.colors.border}`,
                                transition: 'all 0.2s'
                            }}
                        >
                            Stake SNS Tokens <FaArrowRight size={12} />
                        </Link>
                        <Link 
                            to="/tools/sns_jailbreak" 
                            style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '8px',
                                background: 'transparent',
                                color: theme.colors.success,
                                padding: '0.7rem 1.25rem',
                                borderRadius: '10px',
                                textDecoration: 'none',
                                fontWeight: '600',
                                fontSize: '0.9rem',
                                border: `1px solid ${theme.colors.success}50`,
                                transition: 'all 0.2s'
                            }}
                        >
                            <FaUnlock size={12} /> Jailbreak Wizard
                        </Link>
                    </div>
                </div>
            </div>

            {/* Main Content */}
            <main style={{ maxWidth: '1000px', margin: '0 auto', padding: '1.5rem 1rem' }}>
                
                {/* Feature Cards Grid */}
                <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
                    gap: '1.25rem',
                    marginBottom: '1.5rem'
                }}>
                    {/* ICP Liquid Staking Card */}
                    <div className="liquid-card-animate" style={{
                        background: theme.colors.cardGradient,
                        borderRadius: '16px',
                        border: `2px solid ${liquidPrimary}30`,
                        overflow: 'hidden',
                        boxShadow: theme.colors.cardShadow,
                    }}>
                        {/* Card Header */}
                        <div style={{
                            padding: '1rem 1.25rem',
                            background: `linear-gradient(90deg, ${liquidPrimary}15 0%, transparent 100%)`,
                            borderBottom: `1px solid ${theme.colors.border}`,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between'
                        }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                <div style={{
                                    width: '36px',
                                    height: '36px',
                                    borderRadius: '10px',
                                    background: `linear-gradient(135deg, ${liquidPrimary}30, ${liquidPrimary}10)`,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                }}>
                                    <FaBrain style={{ color: liquidPrimary, fontSize: '16px' }} />
                                </div>
                                <span style={{ color: theme.colors.primaryText, fontWeight: '600', fontSize: '1.05rem' }}>
                                    ICP Liquid Staking
                                </span>
                            </div>
                            <span style={{
                                background: `${liquidPrimary}20`,
                                color: liquidPrimary,
                                padding: '4px 10px',
                                borderRadius: '12px',
                                fontSize: '0.7rem',
                                fontWeight: '700',
                                textTransform: 'uppercase',
                            }}>
                                Featured
                            </span>
                        </div>
                        
                        {/* Card Body */}
                        <div style={{ padding: '1.25rem' }}>
                            <p style={{ color: theme.colors.secondaryText, fontSize: '0.9rem', lineHeight: '1.6', marginBottom: '1rem' }}>
                                ICP neurons on the NNS cannot be directly transferred — they're permanently tied to their controller. 
                                <strong style={{ color: theme.colors.primaryText }}> Our solution:</strong> Create a dedicated canister that owns your neurons. 
                                You control the canister, and the canister can be <strong style={{ color: theme.colors.primaryText }}>traded on Sneedex</strong>.
                            </p>
                            
                            <div style={{
                                background: `${theme.colors.warning}10`,
                                borderRadius: '8px',
                                padding: '10px 12px',
                                marginBottom: '1rem',
                                fontSize: '0.8rem',
                                color: theme.colors.warning,
                                lineHeight: '1.5',
                                border: `1px solid ${theme.colors.warning}20`
                            }}>
                                💡 <strong>Important:</strong> You must create new neurons through your Staking Bot app canister. 
                                Existing neurons in your NNS wallet cannot be transferred into a manager.
                            </div>
                            
                            <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 1rem 0' }}>
                                {[
                                    'Deploy your own Staking Bot app canister in seconds',
                                    'Stake ICP and manage multiple neurons from one place',
                                    'Trade your entire staking position by transferring the canister',
                                    'Full NNS governance: vote, set dissolve delay, spawn maturity',
                                ].map((item, i) => (
                                    <li key={i} style={{ 
                                        display: 'flex', 
                                        alignItems: 'flex-start', 
                                        gap: '8px', 
                                        marginBottom: '8px',
                                        color: theme.colors.secondaryText,
                                        fontSize: '0.85rem',
                                        lineHeight: '1.4'
                                    }}>
                                        <FaCheckCircle style={{ color: theme.colors.success, marginTop: '2px', flexShrink: 0 }} size={12} />
                                        <span>{item}</span>
                                    </li>
                                ))}
                            </ul>
                            
                            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                                <Link to="/create_icp_neuron" style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '6px',
                                    background: `linear-gradient(135deg, ${liquidPrimary}, ${liquidSecondary})`,
                                    color: '#fff',
                                    padding: '0.6rem 1rem',
                                    borderRadius: '8px',
                                    textDecoration: 'none',
                                    fontWeight: '600',
                                    fontSize: '0.85rem',
                                }}>
                                    Create ICP Staking Bot <FaArrowRight size={11} />
                                </Link>
                                <Link to="/help/icp-neuron-manager" style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '6px',
                                    color: theme.colors.secondaryText,
                                    padding: '0.6rem 1rem',
                                    borderRadius: '8px',
                                    textDecoration: 'none',
                                    fontWeight: '500',
                                    fontSize: '0.85rem',
                                    border: `1px solid ${theme.colors.border}`,
                                }}>
                                    Learn More
                                </Link>
                            </div>
                        </div>
                    </div>

                    {/* SNS Liquid Staking Card */}
                    <div className="liquid-card-animate" style={{
                        background: theme.colors.cardGradient,
                        borderRadius: '16px',
                        border: `1px solid ${theme.colors.border}`,
                        overflow: 'hidden',
                        boxShadow: theme.colors.cardShadow,
                        animationDelay: '0.1s'
                    }}>
                        {/* Card Header */}
                        <div style={{
                            padding: '1rem 1.25rem',
                            background: `linear-gradient(90deg, ${theme.colors.success}15 0%, transparent 100%)`,
                            borderBottom: `1px solid ${theme.colors.border}`,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between'
                        }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                <div style={{
                                    width: '36px',
                                    height: '36px',
                                    borderRadius: '10px',
                                    background: `${theme.colors.success}20`,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    fontSize: '18px'
                                }}>
                                    🧬
                                </div>
                                <span style={{ color: theme.colors.primaryText, fontWeight: '600', fontSize: '1.05rem' }}>
                                    SNS Liquid Staking
                                </span>
                            </div>
                            <span style={{
                                background: `${theme.colors.success}20`,
                                color: theme.colors.success,
                                padding: '4px 10px',
                                borderRadius: '12px',
                                fontSize: '0.7rem',
                                fontWeight: '700',
                                textTransform: 'uppercase',
                            }}>
                                Native Support
                            </span>
                        </div>
                        
                        {/* Card Body */}
                        <div style={{ padding: '1.25rem' }}>
                            <p style={{ color: theme.colors.secondaryText, fontSize: '0.9rem', lineHeight: '1.6', marginBottom: '1rem' }}>
                                Great news: SNS neurons are <strong style={{ color: theme.colors.primaryText }}>natively transferable</strong>! 
                                When you create SNS neurons through Sneed (instead of the NNS dapp), 
                                they remain liquid and can be <strong style={{ color: theme.colors.primaryText }}>sent to other wallets</strong> or <strong style={{ color: theme.colors.primaryText }}>traded on Sneedex</strong>.
                            </p>
                            
                            <div style={{
                                background: `${theme.colors.success}10`,
                                borderRadius: '8px',
                                padding: '10px 12px',
                                marginBottom: '1rem',
                                fontSize: '0.8rem',
                                color: theme.colors.success,
                                lineHeight: '1.5',
                                border: `1px solid ${theme.colors.success}20`
                            }}>
                                ✨ <strong>Existing neurons?</strong> Use the <Link to="/tools/sns_jailbreak" style={{ color: theme.colors.success, fontWeight: '600' }}>Jailbreak Wizard</Link> to 
                                add your Sneed Wallet as a controller and make them tradable!
                            </div>
                            
                            <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 1rem 0' }}>
                                {[
                                    'Stake tokens in any SNS DAO (Dragginz, OpenChat, etc.)',
                                    'Neurons remain fully transferable to any wallet',
                                    'List and sell your neurons on Sneedex marketplace',
                                    'Participate in governance and earn rewards',
                                ].map((item, i) => (
                                    <li key={i} style={{ 
                                        display: 'flex', 
                                        alignItems: 'flex-start', 
                                        gap: '8px', 
                                        marginBottom: '8px',
                                        color: theme.colors.secondaryText,
                                        fontSize: '0.85rem',
                                        lineHeight: '1.4'
                                    }}>
                                        <FaCheckCircle style={{ color: theme.colors.success, marginTop: '2px', flexShrink: 0 }} size={12} />
                                        <span>{item}</span>
                                    </li>
                                ))}
                            </ul>
                            
                            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                                <Link to="/sns_neuron_wizard" style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '6px',
                                    background: `linear-gradient(135deg, ${theme.colors.success}, ${theme.colors.success}dd)`,
                                    color: '#fff',
                                    padding: '0.6rem 1rem',
                                    borderRadius: '8px',
                                    textDecoration: 'none',
                                    fontWeight: '600',
                                    fontSize: '0.85rem',
                                }}>
                                    SNS Staking Wizard <FaArrowRight size={11} />
                                </Link>
                                <Link to="/tools/sns_jailbreak" style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '6px',
                                    color: theme.colors.success,
                                    padding: '0.6rem 1rem',
                                    borderRadius: '8px',
                                    textDecoration: 'none',
                                    fontWeight: '500',
                                    fontSize: '0.85rem',
                                    border: `1px solid ${theme.colors.success}40`,
                                }}>
                                    <FaUnlock size={11} /> Jailbreak Wizard
                                </Link>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Sneedex Marketplace Section */}
                <div className="liquid-card-animate" style={{
                    background: `linear-gradient(135deg, ${theme.colors.success}08 0%, ${liquidPrimary}05 100%)`,
                    borderRadius: '16px',
                    border: `1px solid ${theme.colors.success}30`,
                    padding: '1.5rem',
                    marginBottom: '1.5rem',
                    boxShadow: theme.colors.cardShadow,
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '1rem' }}>
                        <div style={{
                            width: '40px',
                            height: '40px',
                            borderRadius: '10px',
                            background: `${theme.colors.success}20`,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                        }}>
                            <FaExchangeAlt style={{ color: theme.colors.success, fontSize: '18px' }} />
                        </div>
                        <h3 style={{ 
                            color: theme.colors.primaryText, 
                            fontWeight: '700', 
                            fontSize: '1.15rem',
                            margin: 0
                        }}>
                            Trade on Sneedex Marketplace
                        </h3>
                    </div>
                    <p style={{ color: theme.colors.secondaryText, fontSize: '0.9rem', lineHeight: '1.6', marginBottom: '1.25rem' }}>
                        <strong style={{ color: theme.colors.primaryText }}>Sneedex</strong> is Sneed DAO's on-chain escrow marketplace where you can buy and sell 
                        staking positions securely. List your ICP Staking Bot app canisters or SNS neurons, 
                        set your price, and trade with confidence — all transactions are secured by smart contract escrow.
                    </p>
                    <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                        <Link to="/sneedex_offers" style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '6px',
                            background: `linear-gradient(135deg, ${theme.colors.success}, ${theme.colors.success}dd)`,
                            color: '#fff',
                            padding: '0.6rem 1rem',
                            borderRadius: '8px',
                            textDecoration: 'none',
                            fontWeight: '600',
                            fontSize: '0.85rem',
                        }}>
                            Browse Marketplace <FaArrowRight size={11} />
                        </Link>
                        <Link to="/sneedex_create" style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '6px',
                            color: theme.colors.primaryText,
                            padding: '0.6rem 1rem',
                            borderRadius: '8px',
                            textDecoration: 'none',
                            fontWeight: '500',
                            fontSize: '0.85rem',
                            border: `1px solid ${theme.colors.border}`,
                        }}>
                            Create an Offer
                        </Link>
                        <Link to="/help/sneedex" style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '6px',
                            color: theme.colors.secondaryText,
                            padding: '0.6rem 1rem',
                            borderRadius: '8px',
                            textDecoration: 'none',
                            fontWeight: '500',
                            fontSize: '0.85rem',
                            border: `1px solid ${theme.colors.border}`,
                        }}>
                            How Sneedex Works
                        </Link>
                    </div>
                </div>

                {/* Comparison Section */}
                <div className="liquid-card-animate" style={{
                    background: theme.colors.cardGradient,
                    borderRadius: '16px',
                    border: `1px solid ${theme.colors.border}`,
                    padding: '1.5rem',
                    marginBottom: '1.5rem',
                    boxShadow: theme.colors.cardShadow,
                }}>
                    <h3 style={{ 
                        color: theme.colors.primaryText, 
                        fontWeight: '700', 
                        fontSize: '1.1rem',
                        textAlign: 'center',
                        marginBottom: '1.25rem'
                    }}>
                        Why Liquid Staking Changes Everything
                    </h3>
                    <div style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
                        gap: '1rem',
                    }}>
                        {/* Traditional Staking */}
                        <div style={{
                            background: `${theme.colors.error}08`,
                            borderRadius: '12px',
                            padding: '1.25rem',
                            border: `1px solid ${theme.colors.error}20`,
                            textAlign: 'center'
                        }}>
                            <FaLock size={28} style={{ color: theme.colors.error, marginBottom: '0.75rem' }} />
                            <h4 style={{ color: theme.colors.primaryText, fontWeight: '700', marginBottom: '0.75rem', fontSize: '1rem' }}>
                                Traditional Staking
                            </h4>
                            <ul style={{ 
                                textAlign: 'left', 
                                color: theme.colors.secondaryText, 
                                lineHeight: '1.7', 
                                paddingLeft: '1.25rem', 
                                margin: 0,
                                fontSize: '0.85rem'
                            }}>
                                <li>Tokens locked for months or years</li>
                                <li>No way to exit early</li>
                                <li>Can't transfer your position</li>
                                <li>Miss opportunities while locked</li>
                                <li>ICP neurons tied to one wallet</li>
                            </ul>
                        </div>
                        
                        {/* Liquid Staking */}
                        <div style={{
                            background: `${theme.colors.success}08`,
                            borderRadius: '12px',
                            padding: '1.25rem',
                            border: `1px solid ${theme.colors.success}20`,
                            textAlign: 'center'
                        }}>
                            <FaUnlock size={28} style={{ color: theme.colors.success, marginBottom: '0.75rem' }} />
                            <h4 style={{ color: theme.colors.primaryText, fontWeight: '700', marginBottom: '0.75rem', fontSize: '1rem' }}>
                                Liquid Staking on Sneed
                            </h4>
                            <ul style={{ 
                                textAlign: 'left', 
                                color: theme.colors.secondaryText, 
                                lineHeight: '1.7', 
                                paddingLeft: '1.25rem', 
                                margin: 0,
                                fontSize: '0.85rem'
                            }}>
                                <li>Earn staking rewards as normal</li>
                                <li>Sell your position anytime on Sneedex</li>
                                <li>Transfer neurons to other wallets</li>
                                <li>Stay liquid — never miss an opportunity</li>
                                <li>Full governance participation maintained</li>
                            </ul>
                        </div>
                    </div>
                </div>

                {/* Security Note */}
                <div className="liquid-card-animate" style={{
                    background: theme.colors.cardGradient,
                    borderRadius: '12px',
                    padding: '1.25rem',
                    border: `1px solid ${theme.colors.border}`,
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '1rem',
                    boxShadow: theme.colors.cardShadow,
                }}>
                    <div style={{
                        width: '40px',
                        height: '40px',
                        borderRadius: '10px',
                        background: `${liquidPrimary}15`,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0
                    }}>
                        <FaShieldAlt size={18} style={{ color: liquidPrimary }} />
                    </div>
                    <div>
                        <h4 style={{ color: theme.colors.primaryText, marginBottom: '0.5rem', fontWeight: '700', fontSize: '0.95rem' }}>
                            Your Assets Are Always Safe
                        </h4>
                        <p style={{ color: theme.colors.secondaryText, margin: 0, lineHeight: '1.6', fontSize: '0.85rem' }}>
                            ICP neurons are stored on the NNS governance system, not inside your canister. 
                            Even if a canister runs low on cycles, your neurons remain safe and you stay the controller.
                            SNS neurons use ICRC-7 standard and can always be recovered. 
                            All Sneedex trades use secure on-chain escrow — no trust required.
                        </p>
                    </div>
                </div>
            </main>
        </div>
    );
}
