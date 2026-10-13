import React from 'react';
import { Link } from 'react-router-dom';
import { FaUnlock, FaArrowRight, FaList, FaMagic, FaRocket, FaCheckCircle, FaExchangeAlt, FaBrain, FaCog, FaKey, FaFingerprint, FaDatabase, FaShieldAlt, FaSearch, FaEye, FaFlask, FaWrench, FaProjectDiagram, FaLock } from 'react-icons/fa';
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

.tools-float {
    animation: float 3s ease-in-out infinite;
}

.tools-fade-in {
    animation: fadeInUp 0.5s ease-out forwards;
}

.tools-fade-in-delay {
    animation: fadeInUp 0.5s ease-out 0.2s forwards;
    opacity: 0;
}
`;

// Page accent colors - purple/violet theme for tools
const toolsPrimary = '#8b5cf6';
const toolsSecondary = '#a78bfa';

// Jailbreak accent - orange
const jailbreakPrimary = '#f97316';
const jailbreakSecondary = '#fb923c';

// Account tool accent - teal
const accountPrimary = '#14b8a6';
const accountSecondary = '#2dd4bf';

// ICRC-3 browser accent - indigo
const icrc3Primary = '#6366f1';
const studioPrimary = '#10b981';
const moneyPrimary = '#eab308';

function ToolsMain() {
    const { theme } = useTheme();
    
    const styles = {
        container: {
            maxWidth: '900px',
            margin: '0 auto',
            padding: '1.5rem 1rem',
            color: theme.colors.primaryText,
        },
        toolCard: {
            background: theme.colors.cardGradient,
            border: `1px solid ${theme.colors.border}`,
            borderRadius: '20px',
            padding: '1.5rem',
            marginBottom: '1rem',
            transition: 'all 0.3s ease',
            position: 'relative',
            overflow: 'hidden',
            boxShadow: theme.colors.cardShadow,
        },
        toolIcon: {
            width: '56px',
            height: '56px',
            borderRadius: '14px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: '1rem',
            flexShrink: 0,
        },
        toolTitle: {
            fontSize: '1.35rem',
            fontWeight: '700',
            color: theme.colors.primaryText,
            marginBottom: '0.5rem',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            flexWrap: 'wrap',
        },
        toolDescription: {
            fontSize: '0.95rem',
            lineHeight: '1.7',
            color: theme.colors.secondaryText,
            marginBottom: '1.25rem',
        },
        featureList: {
            display: 'flex',
            flexWrap: 'wrap',
            gap: '8px',
            marginBottom: '1.25rem',
        },
        feature: (color) => ({
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            background: `${color}15`,
            padding: '6px 12px',
            borderRadius: '20px',
            fontSize: '0.8rem',
            color: color,
            fontWeight: '500',
        }),
        buttonRow: {
            display: 'flex',
            gap: '10px',
            flexWrap: 'wrap',
        },
        primaryButton: (color) => ({
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            padding: '12px 20px',
            background: `linear-gradient(135deg, ${color}, ${color}dd)`,
            border: 'none',
            borderRadius: '12px',
            color: '#fff',
            fontSize: '0.95rem',
            fontWeight: '600',
            cursor: 'pointer',
            textDecoration: 'none',
            transition: 'all 0.2s ease',
            boxShadow: `0 4px 16px ${color}40`,
        }),
        secondaryButton: {
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            padding: '12px 20px',
            background: theme.colors.cardGradient,
            border: `1px solid ${theme.colors.border}`,
            borderRadius: '12px',
            color: theme.colors.primaryText,
            fontSize: '0.95rem',
            fontWeight: '500',
            cursor: 'pointer',
            textDecoration: 'none',
            transition: 'all 0.2s ease',
        },
        decorativeGlow: (color) => ({
            position: 'absolute',
            top: '-50%',
            right: '-15%',
            width: '250px',
            height: '250px',
            background: `radial-gradient(circle, ${color}15 0%, transparent 70%)`,
            pointerEvents: 'none',
        }),
        badge: (bg) => ({
            fontSize: '0.65rem', 
            background: bg,
            color: '#fff',
            padding: '4px 10px',
            borderRadius: '12px',
            fontWeight: '600',
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
        }),
    };

    return (
        <div className="page-container" style={{ background: theme.colors.primaryGradient, minHeight: '100vh' }}>
            <style>{customStyles}</style>
            <Header />
            
            {/* Hero Banner */}
            <div style={{
                background: `linear-gradient(135deg, ${theme.colors.primaryBg} 0%, ${toolsPrimary}12 50%, ${toolsSecondary}08 100%)`,
                borderBottom: `1px solid ${theme.colors.border}`,
                padding: '2.5rem 1rem',
                position: 'relative',
                overflow: 'hidden',
                width: '100%',
                boxSizing: 'border-box'
            }}>
                {/* Background decorations */}
                <div style={{
                    position: 'absolute',
                    top: '-30%',
                    right: '-5%',
                    width: '350px',
                    height: '350px',
                    background: `radial-gradient(circle, ${toolsPrimary}15 0%, transparent 70%)`,
                    pointerEvents: 'none'
                }} />
                <div style={{
                    position: 'absolute',
                    bottom: '-50%',
                    left: '5%',
                    width: '250px',
                    height: '250px',
                    background: `radial-gradient(circle, ${toolsSecondary}10 0%, transparent 70%)`,
                    pointerEvents: 'none'
                }} />
                
                <div className="tools-fade-in" style={{ maxWidth: '900px', margin: '0 auto', textAlign: 'center', position: 'relative', zIndex: 1 }}>
                    <div className="tools-float" style={{
                        width: '72px',
                        height: '72px',
                        borderRadius: '18px',
                        background: `linear-gradient(135deg, ${toolsPrimary}, ${toolsSecondary})`,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        margin: '0 auto 1.25rem',
                        boxShadow: `0 12px 40px ${toolsPrimary}50`,
                    }}>
                        <FaCog size={32} style={{ color: '#fff' }} />
                    </div>
                    
                    <h1 style={{
                        fontSize: '2rem',
                        fontWeight: '700',
                        color: theme.colors.primaryText,
                        margin: '0 0 0.75rem',
                        letterSpacing: '-0.5px'
                    }}>
                        Sneed Tools
                    </h1>
                    <p style={{
                        fontSize: '1.05rem',
                        color: theme.colors.secondaryText,
                        maxWidth: '550px',
                        margin: '0 auto',
                        lineHeight: '1.6',
                    }}>
                        Powerful utilities to unlock the full potential of your DeFi assets on the Internet Computer
                    </p>
                </div>
            </div>
            
            <main style={styles.container}>
                {/* Token Studio Card */}
                <div className="tools-fade-in-delay" style={styles.toolCard}>
                    <div style={styles.decorativeGlow(studioPrimary)} />
                    <div style={{ ...styles.toolIcon, background: `linear-gradient(135deg, ${studioPrimary}25, ${studioPrimary}10)` }}>
                        <FaFlask size={26} style={{ color: studioPrimary }} />
                    </div>
                    <h2 style={styles.toolTitle}>
                        Token Studio
                        <span style={styles.badge(studioPrimary)}>Free</span>
                    </h2>
                    <p style={styles.toolDescription}>
                        Check any token against what the chain says about it: who controls the ledger, which code it runs,
                        who can mint, who holds it, what is locked, how deep the liquidity is. Harden what the report flags,
                        or launch a new token on the same ledger code every SNS runs. Nothing here is self-reported.
                    </p>
                    <div style={styles.featureList}>
                        <div style={styles.feature(studioPrimary)}>
                            <FaShieldAlt size={12} />
                            Safety rating from public data
                        </div>
                        <div style={styles.feature(studioPrimary)}>
                            <FaWrench size={12} />
                            A fix for every weak line
                        </div>
                        <div style={styles.feature(studioPrimary)}>
                            <FaLock size={12} />
                            Lock supply and liquidity
                        </div>
                        <div style={styles.feature(studioPrimary)}>
                            <FaRocket size={12} />
                            Launch on NNS-approved code
                        </div>
                    </div>
                    <div style={styles.buttonRow}>
                        <Link to="/studio" style={styles.primaryButton(studioPrimary)}>
                            Open Token Studio
                            <FaArrowRight size={14} />
                        </Link>
                        <Link to="/studio/launch" style={styles.secondaryButton}>
                            <FaRocket size={14} />
                            Launch a token
                        </Link>
                    </div>
                </div>

                {/* Follow the Money Card */}
                <div className="tools-fade-in-delay" style={styles.toolCard}>
                    <div style={styles.decorativeGlow(moneyPrimary)} />
                    <div style={{ ...styles.toolIcon, background: `linear-gradient(135deg, ${moneyPrimary}25, ${moneyPrimary}10)` }}>
                        <FaProjectDiagram size={26} style={{ color: moneyPrimary }} />
                    </div>
                    <h2 style={styles.toolTitle}>
                        Follow the Money
                        <span style={styles.badge(moneyPrimary)}>Free</span>
                    </h2>
                    <p style={styles.toolDescription}>
                        An explorable graph of who sent what to whom on any ledger, built from the index canister. Start
                        from an account, expand its neighbours, fold satellite wallets into their funder, and read every
                        edge with Sneed names where we know them.
                    </p>
                    <div style={styles.featureList}>
                        <div style={styles.feature(moneyPrimary)}>
                            <FaSearch size={12} />
                            Start from any account
                        </div>
                        <div style={styles.feature(moneyPrimary)}>
                            <FaEye size={12} />
                            Hover any edge for the transfers
                        </div>
                        <div style={styles.feature(moneyPrimary)}>
                            <FaBrain size={12} />
                            Satellites and fan-out folded
                        </div>
                        <div style={styles.feature(moneyPrimary)}>
                            <FaDatabase size={12} />
                            Any ledger with an index
                        </div>
                    </div>
                    <div style={styles.buttonRow}>
                        <Link to="/tools/money" style={styles.primaryButton(moneyPrimary)}>
                            Open the graph
                            <FaArrowRight size={14} />
                        </Link>
                        <Link to="/tools/money?ledger=hvgxa-wqaaa-aaaaq-aacia-cai" style={styles.secondaryButton}>
                            <FaProjectDiagram size={14} />
                            SNEED
                        </Link>
                    </div>
                </div>

                {/* SNS Jailbreak Tool Card */}
                <div className="tools-fade-in-delay" style={styles.toolCard}>
                    <div style={styles.decorativeGlow(jailbreakPrimary)} />
                    
                    <div style={{ ...styles.toolIcon, background: `linear-gradient(135deg, ${jailbreakPrimary}25, ${jailbreakPrimary}10)` }}>
                        <FaUnlock size={26} style={{ color: jailbreakPrimary }} />
                    </div>
                    
                    <h2 style={styles.toolTitle}>
                        SNS Jailbreak
                        <span style={styles.badge(theme.colors.success)}>Premium</span>
                    </h2>
                    
                    <p style={styles.toolDescription}>
                        Free your SNS neurons from the NNS interface! This wizard generates a script that adds your 
                        Sneed Wallet as a full controller to your SNS neurons. Once jailbroken, you gain complete 
                        control over your neurons directly from Sneed Hub.
                    </p>
                    
                    <div style={styles.featureList}>
                        <div style={styles.feature(jailbreakPrimary)}>
                            <FaCheckCircle size={12} />
                            Full neuron control
                        </div>
                        <div style={styles.feature(jailbreakPrimary)}>
                            <FaExchangeAlt size={12} />
                            Transfer neurons
                        </div>
                        <div style={styles.feature(jailbreakPrimary)}>
                            <FaRocket size={12} />
                            Trade on Sneedex
                        </div>
                        <div style={styles.feature(jailbreakPrimary)}>
                            <FaBrain size={12} />
                            Manage from Sneed Hub
                        </div>
                    </div>
                    
                    <div style={styles.buttonRow}>
                        <Link to="/tools/sns_jailbreak" style={styles.primaryButton(jailbreakPrimary)}>
                            Launch Wizard
                            <FaArrowRight size={14} />
                        </Link>
                        <Link to="/tools/sns_jailbreak_list" style={styles.secondaryButton}>
                            <FaList size={14} />
                            My Saved Scripts
                        </Link>
                    </div>
                </div>
                
                {/* Account Tool Card */}
                <div className="tools-fade-in-delay" style={styles.toolCard}>
                    <div style={styles.decorativeGlow(accountPrimary)} />
                    
                    <div style={{ ...styles.toolIcon, background: `linear-gradient(135deg, ${accountPrimary}25, ${accountPrimary}10)` }}>
                        <FaKey size={26} style={{ color: accountPrimary }} />
                    </div>
                    
                    <h2 style={styles.toolTitle}>
                        Account Tool
                        <span style={styles.badge(accountPrimary)}>Free</span>
                    </h2>
                    
                    <p style={styles.toolDescription}>
                        Convert between ICP account formats instantly. Enter a principal, a principal with subaccount 
                        in multiple formats, or an ICRC-1 account string to see all derived representations including 
                        the legacy ICP account identifier.
                    </p>
                    
                    <div style={styles.featureList}>
                        <div style={styles.feature(accountPrimary)}>
                            <FaFingerprint size={12} />
                            Principal parsing
                        </div>
                        <div style={styles.feature(accountPrimary)}>
                            <FaExchangeAlt size={12} />
                            ICRC-1 encoding
                        </div>
                        <div style={styles.feature(accountPrimary)}>
                            <FaCheckCircle size={12} />
                            Multiple subaccount formats
                        </div>
                        <div style={styles.feature(accountPrimary)}>
                            <FaKey size={12} />
                            Legacy account IDs
                        </div>
                    </div>
                    
                    <div style={styles.buttonRow}>
                        <Link to="/tools/account" style={styles.primaryButton(accountPrimary)}>
                            Open Account Tool
                            <FaArrowRight size={14} />
                        </Link>
                    </div>
                </div>
                
                {/* ICRC-3 Browser Card */}
                <div className="tools-fade-in-delay" style={styles.toolCard}>
                    <div style={styles.decorativeGlow(icrc3Primary)} />
                    
                    <div style={{ ...styles.toolIcon, background: `linear-gradient(135deg, ${icrc3Primary}25, ${icrc3Primary}10)` }}>
                        <FaDatabase size={26} style={{ color: icrc3Primary }} />
                    </div>
                    
                    <h2 style={styles.toolTitle}>
                        ICRC-3 Browser
                        <span style={styles.badge(icrc3Primary)}>Free</span>
                    </h2>
                    
                    <p style={styles.toolDescription}>
                        Browse the block log of any canister that implements ICRC-3: token ledgers, Sneed Lock's 
                        activity log, or anything else. Verify the certified tip and the hash chain, page through 
                        history, and read blocks in a purpose-built view where we know the block types or in a 
                        compact or verbose generic view everywhere else.
                    </p>
                    
                    <div style={styles.featureList}>
                        <div style={styles.feature(icrc3Primary)}>
                            <FaSearch size={12} />
                            Any ICRC-3 canister
                        </div>
                        <div style={styles.feature(icrc3Primary)}>
                            <FaShieldAlt size={12} />
                            Certified tip verification
                        </div>
                        <div style={styles.feature(icrc3Primary)}>
                            <FaEye size={12} />
                            Specific, compact and verbose views
                        </div>
                        <div style={styles.feature(icrc3Primary)}>
                            <FaList size={12} />
                            Pagination and archives
                        </div>
                    </div>
                    
                    <div style={styles.buttonRow}>
                        <Link to="/tools/icrc3" style={styles.primaryButton(icrc3Primary)}>
                            Open ICRC-3 Browser
                            <FaArrowRight size={14} />
                        </Link>
                        <Link to="/tools/icrc3?canister=pqsms-lqaaa-aaaal-ajjza-cai" style={styles.secondaryButton}>
                            <FaDatabase size={14} />
                            Sneed Lock log
                        </Link>
                    </div>
                </div>
                
                {/* More tools coming soon placeholder */}
                <div className="tools-fade-in-delay" style={{
                    ...styles.toolCard,
                    background: `linear-gradient(135deg, ${theme.colors.cardGradient || theme.colors.cardBackground} 0%, ${toolsPrimary}05 100%)`,
                    border: `1px dashed ${theme.colors.border}`,
                    textAlign: 'center',
                    padding: '2rem',
                }}>
                    <div style={{
                        width: '48px',
                        height: '48px',
                        borderRadius: '12px',
                        background: `${toolsPrimary}15`,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        margin: '0 auto 1rem',
                    }}>
                        <FaMagic size={20} style={{ color: toolsPrimary }} />
                    </div>
                    <h3 style={{ color: theme.colors.primaryText, fontSize: '1.1rem', fontWeight: '600', marginBottom: '0.5rem' }}>
                        More Tools Coming Soon
                    </h3>
                    <p style={{ color: theme.colors.mutedText, fontSize: '0.9rem', margin: 0 }}>
                        We're building more powerful utilities for the IC ecosystem
                    </p>
                </div>
            </main>
        </div>
    );
}

export default ToolsMain;
