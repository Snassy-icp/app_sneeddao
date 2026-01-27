import React from 'react';
import { Link } from 'react-router-dom';
import { FaUnlock, FaArrowRight, FaList, FaMagic, FaRocket } from 'react-icons/fa';
import Header from '../components/Header';
import { useTheme } from '../contexts/ThemeContext';

function ToolsMain() {
    const { theme } = useTheme();
    
    const styles = {
        container: {
            maxWidth: '900px',
            margin: '0 auto',
            padding: '2rem',
            color: theme.colors.primaryText,
        },
        hero: {
            textAlign: 'center',
            marginBottom: '3rem',
            padding: '2rem 0',
        },
        title: {
            fontSize: '2.8rem',
            marginBottom: '1rem',
            color: theme.colors.primaryText,
            fontWeight: 'bold',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '16px',
        },
        subtitle: {
            fontSize: '1.2rem',
            color: theme.colors.mutedText,
            maxWidth: '600px',
            margin: '0 auto',
            lineHeight: '1.6',
        },
        toolCard: {
            background: theme.colors.cardGradient,
            border: `1px solid ${theme.colors.border}`,
            borderRadius: '20px',
            padding: '2.5rem',
            marginBottom: '1.5rem',
            transition: 'all 0.3s ease',
            position: 'relative',
            overflow: 'hidden',
        },
        toolCardHover: {
            transform: 'translateY(-4px)',
            boxShadow: theme.colors.accentShadow,
            borderColor: theme.colors.accent,
        },
        toolIcon: {
            width: '70px',
            height: '70px',
            borderRadius: '16px',
            background: `linear-gradient(135deg, ${theme.colors.accent}20, ${theme.colors.accent}40)`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: '1.5rem',
        },
        toolTitle: {
            fontSize: '1.8rem',
            fontWeight: '700',
            color: theme.colors.primaryText,
            marginBottom: '0.75rem',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
        },
        toolDescription: {
            fontSize: '1.05rem',
            lineHeight: '1.7',
            color: theme.colors.secondaryText,
            marginBottom: '1.5rem',
        },
        featureList: {
            display: 'flex',
            flexWrap: 'wrap',
            gap: '12px',
            marginBottom: '1.5rem',
        },
        feature: {
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            background: `${theme.colors.accent}15`,
            padding: '8px 14px',
            borderRadius: '20px',
            fontSize: '0.9rem',
            color: theme.colors.accent,
            fontWeight: '500',
        },
        buttonRow: {
            display: 'flex',
            gap: '12px',
            flexWrap: 'wrap',
        },
        primaryButton: {
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            padding: '14px 28px',
            background: `linear-gradient(135deg, ${theme.colors.accent}, ${theme.colors.accent}dd)`,
            border: 'none',
            borderRadius: '12px',
            color: theme.colors.primaryBg,
            fontSize: '1rem',
            fontWeight: '600',
            cursor: 'pointer',
            textDecoration: 'none',
            transition: 'all 0.2s ease',
            boxShadow: theme.colors.accentShadow,
        },
        secondaryButton: {
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            padding: '14px 28px',
            background: theme.colors.secondaryBg,
            border: `1px solid ${theme.colors.border}`,
            borderRadius: '12px',
            color: theme.colors.primaryText,
            fontSize: '1rem',
            fontWeight: '500',
            cursor: 'pointer',
            textDecoration: 'none',
            transition: 'all 0.2s ease',
        },
        decorativeGlow: {
            position: 'absolute',
            top: '-50%',
            right: '-20%',
            width: '300px',
            height: '300px',
            background: `radial-gradient(circle, ${theme.colors.accent}10 0%, transparent 70%)`,
            pointerEvents: 'none',
        },
    };

    const [hoverState, setHoverState] = React.useState(false);

    return (
        <div className="page-container" style={{ background: theme.colors.primaryGradient, minHeight: '100vh' }}>
            <Header />
            <main style={styles.container}>
                {/* Hero Section */}
                <div style={styles.hero}>
                    <h1 style={styles.title}>
                        <FaMagic style={{ color: theme.colors.accent }} />
                        Sneed Tools
                    </h1>
                    <p style={styles.subtitle}>
                        Powerful utilities to unlock the full potential of your DeFi assets on the Internet Computer
                    </p>
                </div>
                
                {/* SNS Jailbreak Tool Card */}
                <div 
                    style={{
                        ...styles.toolCard,
                        ...(hoverState ? styles.toolCardHover : {}),
                    }}
                    onMouseEnter={() => setHoverState(true)}
                    onMouseLeave={() => setHoverState(false)}
                >
                    <div style={styles.decorativeGlow} />
                    
                    <div style={styles.toolIcon}>
                        <FaUnlock size={32} style={{ color: theme.colors.accent }} />
                    </div>
                    
                    <h2 style={styles.toolTitle}>
                        SNS Jailbreak
                        <span style={{ 
                            fontSize: '0.7rem', 
                            background: theme.colors.success,
                            color: theme.colors.primaryBg,
                            padding: '4px 10px',
                            borderRadius: '12px',
                            fontWeight: '600',
                        }}>
                            NEW
                        </span>
                    </h2>
                    
                    <p style={styles.toolDescription}>
                        Free your SNS neurons from the NNS interface! This wizard generates a script that adds your 
                        Sneed Wallet as a full controller to your SNS neurons. Once jailbroken, you gain complete 
                        control over your neurons directly from Sneed Hub.
                    </p>
                    
                    <div style={styles.featureList}>
                        <div style={styles.feature}>
                            <FaRocket size={14} />
                            Full neuron control
                        </div>
                        <div style={styles.feature}>
                            <FaRocket size={14} />
                            Transfer neurons
                        </div>
                        <div style={styles.feature}>
                            <FaRocket size={14} />
                            Trade on Sneedex
                        </div>
                        <div style={styles.feature}>
                            <FaRocket size={14} />
                            Manage from Sneed Hub
                        </div>
                    </div>
                    
                    <div style={styles.buttonRow}>
                        <Link to="/tools/sns_jailbreak" style={styles.primaryButton}>
                            Launch Wizard
                            <FaArrowRight />
                        </Link>
                        <Link to="/tools/sns_jailbreak_list" style={styles.secondaryButton}>
                            <FaList />
                            My Saved Scripts
                        </Link>
                    </div>
                </div>
            </main>
        </div>
    );
}

export default ToolsMain;
