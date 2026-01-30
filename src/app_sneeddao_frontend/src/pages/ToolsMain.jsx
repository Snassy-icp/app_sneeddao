import React from 'react';
import { Link } from 'react-router-dom';
import { FaUnlock, FaArrowRight, FaList, FaMagic, FaRocket, FaCheckCircle, FaExchangeAlt, FaBrain, FaCog } from 'react-icons/fa';
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
                overflow: 'hidden'
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
