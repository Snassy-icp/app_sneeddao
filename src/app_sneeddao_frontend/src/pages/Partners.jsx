import React, { useState, useEffect } from 'react';
import { createActor as createBackendActor, canisterId as backendCanisterId } from 'declarations/app_sneeddao_backend';
import Header from '../components/Header';
import { useTheme } from '../contexts/ThemeContext';

function Partners() {
    const { theme } = useTheme();
    const [partners, setPartners] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    useEffect(() => {
        fetchPartners();
    }, []);

    const fetchPartners = async () => {
        setLoading(true);
        try {
            const backendActor = createBackendActor(backendCanisterId, {
                agentOptions: {
                    host: process.env.DFX_NETWORK === 'ic' ? 'https://ic0.app' : 'http://localhost:4943',
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

    const formatDate = (timestamp) => {
        try {
            // Convert nanoseconds to milliseconds
            const date = new Date(Number(timestamp) / 1000000);
            return date.toLocaleDateString();
        } catch (err) {
            return 'Invalid Date';
        }
    };

    return (
        <div className='page-container' style={{ background: theme.colors.primaryGradient, minHeight: '100vh' }}>
            <Header />
            <main className="wallet-container">
                <h1 style={{ color: theme.colors.primaryText, marginBottom: '30px', textAlign: 'center' }}>Our Partners</h1>
                
                {error && (
                    <div style={{ 
                        backgroundColor: `${theme.colors.error}20`, 
                        border: `1px solid ${theme.colors.error}`,
                        color: theme.colors.error,
                        padding: '15px',
                        borderRadius: '8px',
                        marginBottom: '20px',
                        textAlign: 'center'
                    }}>
                        {error}
                    </div>
                )}

                {loading ? (
                    <div style={{ 
                        textAlign: 'center', 
                        padding: '40px 20px', 
                        color: theme.colors.primaryText 
                    }}>
                        Loading partners...
                    </div>
                ) : partners.length === 0 ? (
                    <div style={{ 
                        textAlign: 'center', 
                        padding: '40px 20px', 
                        color: theme.colors.mutedText 
                    }}>
                        <p>No partners to display yet.</p>
                        <p>Check back soon as we continue to grow our ecosystem!</p>
                    </div>
                ) : (
                    <div style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(350px, 1fr))',
                        gap: '30px',
                        padding: '20px 0'
                    }}>
                        {partners.map((partner) => (
                            <div
                                key={partner.id}
                                style={{
                                    background: theme.colors.cardGradient,
                                    borderRadius: '12px',
                                    padding: '25px',
                                    border: `1px solid ${theme.colors.border}`,
                                    boxShadow: theme.colors.cardShadow,
                                    transition: 'all 0.3s ease',
                                    cursor: 'default'
                                }}
                                onMouseEnter={(e) => {
                                    e.currentTarget.style.transform = 'translateY(-5px)';
                                    e.currentTarget.style.boxShadow = `0 12px 35px ${theme.colors.accent}20`;
                                }}
                                onMouseLeave={(e) => {
                                    e.currentTarget.style.transform = 'translateY(0)';
                                    e.currentTarget.style.boxShadow = theme.colors.cardShadow;
                                }}
                            >
                                {/* Partner Logo and Name */}
                                <div style={{
                                    display: 'flex',
                                    alignItems: 'flex-start',
                                    justifyContent: 'flex-start',
                                    gap: '15px',
                                    marginBottom: '20px',
                                    width: '100%'
                                }}>
                                    <img
                                        src={partner.logo_url}
                                        alt={`${partner.name} logo`}
                                        style={{
                                            width: '60px',
                                            height: '60px',
                                            borderRadius: '50%',
                                            objectFit: 'cover',
                                            border: `2px solid ${theme.colors.border}`,
                                            flexShrink: 0
                                        }}
                                        onError={(e) => {
                                            e.target.style.display = 'none';
                                        }}
                                    />
                                    <div style={{ 
                                        textAlign: 'left',
                                        flex: 1,
                                        alignSelf: 'flex-start'
                                    }}>
                                        <h2 style={{
                                            color: theme.colors.primaryText,
                                            margin: '0 0 8px 0',
                                            fontSize: '24px',
                                            fontWeight: 'bold',
                                            textAlign: 'left'
                                        }}>
                                            {partner.name}
                                        </h2>
                                        {/* Links */}
                                        {partner.links && partner.links.length > 0 && (
                                            <div style={{
                                                display: 'flex',
                                                flexWrap: 'wrap',
                                                gap: '8px'
                                            }}>
                                                {partner.links.map((link, index) => (
                                                    <a
                                                        key={index}
                                                        href={link.url}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        style={{
                                                            background: `linear-gradient(135deg, ${theme.colors.accent}, ${theme.colors.accent}dd)`,
                                                            color: theme.colors.primaryBg,
                                                            padding: '6px 14px',
                                                            borderRadius: '6px',
                                                            textDecoration: 'none',
                                                            fontSize: '12px',
                                                            fontWeight: '600',
                                                            transition: 'all 0.3s ease',
                                                            display: 'inline-block',
                                                            boxShadow: theme.colors.accentShadow
                                                        }}
                                                        onMouseEnter={(e) => {
                                                            e.target.style.transform = 'translateY(-1px)';
                                                            e.target.style.boxShadow = `0 6px 20px ${theme.colors.accent}40`;
                                                        }}
                                                        onMouseLeave={(e) => {
                                                            e.target.style.transform = 'translateY(0)';
                                                            e.target.style.boxShadow = theme.colors.accentShadow;
                                                        }}
                                                    >
                                                        {link.title}
                                                    </a>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* Description */}
                                <div style={{
                                    color: theme.colors.secondaryText,
                                    fontSize: '16px',
                                    lineHeight: '1.6',
                                    marginBottom: '20px'
                                }}>
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