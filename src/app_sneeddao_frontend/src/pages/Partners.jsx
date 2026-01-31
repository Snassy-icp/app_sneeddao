import React, { useState, useEffect } from 'react';
import { createActor as createBackendActor, canisterId as backendCanisterId } from 'declarations/app_sneeddao_backend';
import Header from '../components/Header';
import { useTheme } from '../contexts/ThemeContext';
import { FaHandshake, FaUsers, FaExternalLinkAlt, FaSpinner, FaGlobe } from 'react-icons/fa';

// Custom CSS for animations
const customAnimations = `
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

@keyframes partnersFloat {
    0%, 100% { transform: translateY(0px); }
    50% { transform: translateY(-8px); }
}

@keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
}

.partners-float {
    animation: partnersFloat 3s ease-in-out infinite;
}

.partners-fade-in {
    animation: fadeInUp 0.5s ease-out forwards;
}

.partners-spin {
    animation: spin 1s linear infinite;
}
`;

// Page accent colors - teal/cyan theme for partnerships
const partnersPrimary = '#06b6d4';
const partnersSecondary = '#22d3ee';

const getStyles = (theme) => ({
    container: {
        maxWidth: '900px',
        margin: '0 auto',
        padding: '1.25rem',
        color: theme.colors.primaryText,
    },
    grid: {
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
        gap: '1rem',
    },
    partnerCard: {
        background: theme.colors.cardGradient,
        borderRadius: '16px',
        padding: '1.25rem',
        border: `1px solid ${theme.colors.border}`,
        boxShadow: theme.colors.cardShadow,
        transition: 'all 0.3s ease',
        position: 'relative',
        overflow: 'hidden',
    },
    decorativeGlow: {
        position: 'absolute',
        top: '-50%',
        right: '-20%',
        width: '150px',
        height: '150px',
        background: `radial-gradient(circle, ${partnersPrimary}10 0%, transparent 70%)`,
        pointerEvents: 'none',
    },
    logoContainer: {
        width: '64px',
        height: '64px',
        borderRadius: '16px',
        background: `linear-gradient(135deg, ${partnersPrimary}20, ${partnersPrimary}10)`,
        border: `2px solid ${partnersPrimary}30`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        overflow: 'hidden',
    },
    logo: {
        width: '100%',
        height: '100%',
        objectFit: 'cover',
        borderRadius: '14px',
    },
    logoFallback: {
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: `linear-gradient(135deg, ${partnersPrimary}, ${partnersSecondary})`,
        borderRadius: '14px',
        color: '#fff',
        fontSize: '1.5rem',
        fontWeight: '700',
    },
    partnerHeader: {
        display: 'flex',
        alignItems: 'flex-start',
        gap: '1rem',
        marginBottom: '1rem',
    },
    partnerName: {
        color: theme.colors.primaryText,
        margin: '0 0 6px 0',
        fontSize: '1.25rem',
        fontWeight: '700',
    },
    linksContainer: {
        display: 'flex',
        flexWrap: 'wrap',
        gap: '6px',
    },
    linkButton: {
        background: `linear-gradient(135deg, ${partnersPrimary}, ${partnersSecondary})`,
        color: '#fff',
        padding: '5px 12px',
        borderRadius: '8px',
        textDecoration: 'none',
        fontSize: '0.75rem',
        fontWeight: '600',
        transition: 'all 0.3s ease',
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        boxShadow: `0 2px 8px ${partnersPrimary}30`,
    },
    description: {
        color: theme.colors.secondaryText,
        fontSize: '0.9rem',
        lineHeight: '1.6',
    },
    emptyState: {
        background: theme.colors.cardGradient,
        borderRadius: '16px',
        padding: '3rem 1.5rem',
        border: `1px solid ${theme.colors.border}`,
        boxShadow: theme.colors.cardShadow,
        textAlign: 'center',
    },
    emptyIcon: {
        width: '64px',
        height: '64px',
        borderRadius: '16px',
        background: `linear-gradient(135deg, ${partnersPrimary}20, ${partnersPrimary}10)`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        margin: '0 auto 1rem',
    },
    errorBox: {
        backgroundColor: `${theme.colors.error}15`,
        border: `1px solid ${theme.colors.error}30`,
        color: theme.colors.error,
        padding: '1rem',
        borderRadius: '12px',
        marginBottom: '1rem',
        textAlign: 'center',
        fontSize: '0.9rem',
    },
});

function Partners() {
    const { theme } = useTheme();
    const styles = getStyles(theme);
    const [partners, setPartners] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [logoErrors, setLogoErrors] = useState({});

    useEffect(() => {
        fetchPartners();
    }, []);

    const fetchPartners = async () => {
        setLoading(true);
        try {
            const backendActor = createBackendActor(backendCanisterId, {
                agentOptions: {
                    host: process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging' ? 'https://ic0.app' : 'http://localhost:4943',
                }
            });
            const result = await backendActor.get_partners();
            setPartners(result);
            setError('');
        } catch (err) {
            console.error('Error fetching partners:', err);
            setError('Failed to load partners');
        } finally {
            setLoading(false);
        }
    };

    const handleLogoError = (partnerId) => {
        setLogoErrors(prev => ({ ...prev, [partnerId]: true }));
    };

    return (
        <div className='page-container' style={{ background: theme.colors.primaryGradient, minHeight: '100vh' }}>
            <style>{customAnimations}</style>
            <Header />
            
            {/* Hero Banner */}
            <div style={{
                background: `linear-gradient(135deg, ${theme.colors.primaryBg} 0%, ${partnersPrimary}12 50%, ${partnersSecondary}08 100%)`,
                borderBottom: `1px solid ${theme.colors.border}`,
                padding: '2rem 1rem',
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
                    width: '300px',
                    height: '300px',
                    background: `radial-gradient(circle, ${partnersPrimary}15 0%, transparent 70%)`,
                    pointerEvents: 'none'
                }} />
                
                <div className="partners-fade-in" style={{ maxWidth: '900px', margin: '0 auto', textAlign: 'center', position: 'relative', zIndex: 1 }}>
                    <div className="partners-float" style={{
                        width: '72px',
                        height: '72px',
                        borderRadius: '18px',
                        background: `linear-gradient(135deg, ${partnersPrimary}, ${partnersSecondary})`,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        margin: '0 auto 1rem',
                        boxShadow: `0 12px 40px ${partnersPrimary}50`,
                    }}>
                        <FaHandshake size={32} style={{ color: '#fff' }} />
                    </div>
                    
                    <div style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                        padding: '6px 14px',
                        borderRadius: '20px',
                        background: `${partnersPrimary}15`,
                        color: partnersPrimary,
                        fontSize: '0.8rem',
                        fontWeight: '600',
                        marginBottom: '0.75rem'
                    }}>
                        <FaUsers size={12} />
                        Ecosystem Collaborations
                    </div>
                    
                    <h1 style={{
                        fontSize: '1.75rem',
                        fontWeight: '700',
                        color: theme.colors.primaryText,
                        margin: '0 0 0.5rem',
                        letterSpacing: '-0.5px'
                    }}>
                        Our Partners
                    </h1>
                    <p style={{
                        fontSize: '0.95rem',
                        color: theme.colors.secondaryText,
                        margin: 0
                    }}>
                        Building the future of Web3 together
                    </p>
                </div>
            </div>
            
            <main style={styles.container}>
                {error && (
                    <div className="partners-fade-in" style={styles.errorBox}>
                        {error}
                    </div>
                )}

                {loading ? (
                    <div className="partners-fade-in" style={{ 
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        padding: '3rem 1rem',
                        gap: '1rem'
                    }}>
                        <FaSpinner className="partners-spin" size={32} style={{ color: partnersPrimary }} />
                        <span style={{ color: theme.colors.secondaryText }}>Loading partners...</span>
                    </div>
                ) : partners.length === 0 ? (
                    <div className="partners-fade-in" style={styles.emptyState}>
                        <div style={styles.emptyIcon}>
                            <FaGlobe size={28} style={{ color: partnersPrimary }} />
                        </div>
                        <h3 style={{ color: theme.colors.primaryText, margin: '0 0 0.5rem', fontSize: '1.1rem' }}>
                            No partners yet
                        </h3>
                        <p style={{ color: theme.colors.secondaryText, margin: 0, fontSize: '0.9rem' }}>
                            Check back soon as we continue to grow our ecosystem!
                        </p>
                    </div>
                ) : (
                    <div style={styles.grid}>
                        {partners.map((partner, index) => (
                            <div
                                key={partner.id}
                                className="partners-fade-in"
                                style={{ ...styles.partnerCard, animationDelay: `${index * 0.05}s` }}
                            >
                                <div style={styles.decorativeGlow} />
                                
                                {/* Partner Logo and Name */}
                                <div style={styles.partnerHeader}>
                                    <div style={styles.logoContainer}>
                                        {!logoErrors[partner.id] ? (
                                            <img
                                                src={partner.logo_url}
                                                alt={`${partner.name} logo`}
                                                style={styles.logo}
                                                onError={() => handleLogoError(partner.id)}
                                            />
                                        ) : (
                                            <div style={styles.logoFallback}>
                                                {partner.name.charAt(0).toUpperCase()}
                                            </div>
                                        )}
                                    </div>
                                    <div style={{ flex: 1 }}>
                                        <h2 style={styles.partnerName}>
                                            {partner.name}
                                        </h2>
                                        {/* Links */}
                                        {partner.links && partner.links.length > 0 && (
                                            <div style={styles.linksContainer}>
                                                {partner.links.map((link, linkIndex) => (
                                                    <a
                                                        key={linkIndex}
                                                        href={link.url}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        style={styles.linkButton}
                                                    >
                                                        {link.title}
                                                        <FaExternalLinkAlt size={9} />
                                                    </a>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* Description */}
                                <div style={styles.description}>
                                    {partner.description}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </main>
        </div>
    );
}

export default Partners; 