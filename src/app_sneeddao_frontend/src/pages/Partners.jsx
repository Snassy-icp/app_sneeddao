import React, { useState, useEffect } from 'react';
import { createActor as createBackendActor, canisterId as backendCanisterId } from 'declarations/app_sneeddao_backend';
import Header from '../components/Header';

function Partners() {
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
        <div className='page-container'>
            <Header />
            <main className="wallet-container">
                <h1 style={{ color: '#ffffff', marginBottom: '30px', textAlign: 'center' }}>Our Partners</h1>
                
                {error && (
                    <div style={{ 
                        backgroundColor: 'rgba(231, 76, 60, 0.2)', 
                        border: '1px solid #e74c3c',
                        color: '#e74c3c',
                        padding: '15px',
                        borderRadius: '6px',
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
                        color: '#ffffff' 
                    }}>
                        Loading partners...
                    </div>
                ) : partners.length === 0 ? (
                    <div style={{ 
                        textAlign: 'center', 
                        padding: '40px 20px', 
                        color: '#888' 
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
                                    backgroundColor: '#2a2a2a',
                                    borderRadius: '12px',
                                    padding: '25px',
                                    border: '1px solid #3a3a3a',
                                    transition: 'transform 0.2s ease, box-shadow 0.2s ease',
                                    cursor: 'default'
                                }}
                                onMouseEnter={(e) => {
                                    e.currentTarget.style.transform = 'translateY(-5px)';
                                    e.currentTarget.style.boxShadow = '0 8px 25px rgba(0, 0, 0, 0.3)';
                                }}
                                onMouseLeave={(e) => {
                                    e.currentTarget.style.transform = 'translateY(0)';
                                    e.currentTarget.style.boxShadow = 'none';
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
                                            borderRadius: '8px',
                                            objectFit: 'cover',
                                            border: '2px solid #3a3a3a',
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
                                            color: '#ffffff',
                                            margin: '0 0 5px 0',
                                            fontSize: '24px',
                                            fontWeight: 'bold',
                                            textAlign: 'left'
                                        }}>
                                            {partner.name}
                                        </h2>
                                        <div style={{
                                            color: '#888',
                                            fontSize: '14px',
                                            textAlign: 'left'
                                        }}>
                                            Partner since {formatDate(partner.created_at)}
                                        </div>
                                    </div>
                                </div>

                                {/* Description */}
                                <div style={{
                                    color: '#cccccc',
                                    fontSize: '16px',
                                    lineHeight: '1.6',
                                    marginBottom: '20px'
                                }}>
                                    {partner.description}
                                </div>

                                {/* Links */}
                                {partner.links && partner.links.length > 0 && (
                                    <div>
                                        <h3 style={{
                                            color: '#ffffff',
                                            fontSize: '18px',
                                            marginBottom: '15px',
                                            fontWeight: '500'
                                        }}>
                                            Links
                                        </h3>
                                        <div style={{
                                            display: 'flex',
                                            flexWrap: 'wrap',
                                            gap: '10px'
                                        }}>
                                            {partner.links.map((link, index) => (
                                                <a
                                                    key={index}
                                                    href={link.url}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    style={{
                                                        backgroundColor: '#3498db',
                                                        color: '#ffffff',
                                                        padding: '8px 16px',
                                                        borderRadius: '6px',
                                                        textDecoration: 'none',
                                                        fontSize: '14px',
                                                        fontWeight: '500',
                                                        transition: 'background-color 0.2s ease',
                                                        display: 'inline-block'
                                                    }}
                                                    onMouseEnter={(e) => {
                                                        e.target.style.backgroundColor = '#2980b9';
                                                    }}
                                                    onMouseLeave={(e) => {
                                                        e.target.style.backgroundColor = '#3498db';
                                                    }}
                                                >
                                                    {link.title}
                                                </a>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </main>
        </div>
    );
}

export default Partners; 