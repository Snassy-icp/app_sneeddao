import React from 'react';
import { useTheme } from '../contexts/ThemeContext';
import Header from '../components/Header';
import { Link } from 'react-router-dom';

function Hub() {
    const { theme } = useTheme();
    return (
        <div 
            className='page-container'
            style={{
                background: theme.colors.primaryGradient,
                color: theme.colors.primaryText,
                minHeight: '100vh'
            }}
        >
            <Header showSnsDropdown={true} />
            <main style={{
                maxWidth: '1400px',
                margin: '0 auto',
                padding: '2rem'
            }}>
                {/* Header Section - Spans full width */}
                <div style={{
                    backgroundColor: theme.colors.secondaryBg,
                    borderRadius: '12px',
                    padding: '2rem',
                    marginBottom: '2rem',
                    border: `1px solid ${theme.colors.border}`,
                    textAlign: 'center'
                }}>
                    <h1 style={{
                        fontSize: '2.5rem',
                        color: theme.colors.primaryText,
                        marginBottom: '1rem',
                        fontWeight: 'bold'
                    }}>
                        Welcome to Sneed Hub
                    </h1>
                    <p style={{
                        color: theme.colors.secondaryText,
                        fontSize: '1.1rem',
                        lineHeight: '1.6',
                        maxWidth: '800px',
                        margin: '0 auto 1.5rem auto'
                    }}>
                        Sneed Hub is your all-in-one home for the Internet Computer: trade assets on <strong>Sneedex</strong>, run your own
                        <strong> ICP Neuron Manager</strong> canisters, lock tokens with <strong>Sneed Lock</strong>, and participate in the
                        SNS ecosystem with governance + social tools.
                    </p>
                    
                    <p style={{
                        color: theme.colors.secondaryText,
                        fontSize: '1rem',
                        lineHeight: '1.6',
                        maxWidth: '800px',
                        margin: '0 auto 1.5rem auto'
                    }}>
                        Use the SNS dropdown in the header to switch context across DAOs anywhere on the site.
                    </p>

                    <div style={{
                        display: 'flex',
                        justifyContent: 'center',
                        gap: '1rem',
                        flexWrap: 'wrap',
                        marginTop: '1.5rem'
                    }}>
                        <Link 
                            to="/sneedex_offers"
                            style={{
                                backgroundColor: theme.colors.accent,
                                color: 'white',
                                padding: '0.75rem 1.5rem',
                                borderRadius: '6px',
                                textDecoration: 'none',
                                fontWeight: '500',
                                transition: 'background-color 0.2s ease'
                            }}
                            onMouseEnter={(e) => e.target.style.backgroundColor = theme.colors.accentHover}
                            onMouseLeave={(e) => e.target.style.backgroundColor = theme.colors.accent}
                        >
                            Browse Sneedex
                        </Link>
                        
                        <Link 
                            to="/create_icp_neuron"
                            style={{
                                backgroundColor: theme.colors.success,
                                color: 'white',
                                padding: '0.75rem 1.5rem',
                                borderRadius: '6px',
                                textDecoration: 'none',
                                fontWeight: '500',
                                transition: 'background-color 0.2s ease'
                            }}
                            onMouseEnter={(e) => e.target.style.backgroundColor = '#219a52'}
                            onMouseLeave={(e) => e.target.style.backgroundColor = theme.colors.success}
                        >
                            Create ICP Neuron Manager
                        </Link>
                        
                        <Link 
                            to="/sneedlock_info"
                            style={{
                                backgroundColor: '#9b59b6',
                                color: 'white',
                                padding: '0.75rem 1.5rem',
                                borderRadius: '6px',
                                textDecoration: 'none',
                                fontWeight: '500',
                                transition: 'background-color 0.2s ease'
                            }}
                            onMouseEnter={(e) => e.target.style.backgroundColor = '#8e44ad'}
                            onMouseLeave={(e) => e.target.style.backgroundColor = '#9b59b6'}
                        >
                            Open Sneed Lock
                        </Link>
                    </div>
                </div>

                {/* Feature Grid */}
                <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
                    gap: '1rem'
                }}>
                    {[
                        { title: 'Sneedex', desc: 'Trade canisters, neurons, and tokens via on-chain escrow auctions.', path: '/sneedex_offers', cta: 'Open Marketplace →' },
                        { title: 'ICP Neuron Managers', desc: 'Run a neuron manager canister and manage multiple ICP neurons in one place.', path: '/create_icp_neuron', cta: 'Create Manager →' },
                        { title: 'Sneed Lock', desc: 'Create token locks, vesting schedules, and time-locked positions.', path: '/sneedlock_info', cta: 'Open Sneed Lock →' },
                        { title: 'SNS Directory', desc: 'Browse SNS DAOs and jump into governance + social tools.', path: '/sns', cta: 'Browse SNSes →' },
                        { title: 'Forum', desc: 'Start threads, reply with emojis, and share links with Markdown.', path: '/forum', cta: 'Visit Forum →' },
                        { title: 'Messages', desc: 'Send direct messages with emoji + Markdown support.', path: '/sms', cta: 'Open Messages →' },
                        { title: 'Governance', desc: 'Browse proposals across SNSes and track voting activity.', path: '/proposals', cta: 'View Proposals →' },
                        { title: 'Neurons', desc: 'Explore neurons and voting power, and manage your positions.', path: '/neurons', cta: 'Browse Neurons →' },
                        { title: 'Wallet & Canisters', desc: 'Track balances, manage canisters, and monitor cycles.', path: '/wallet', cta: 'Open Wallet →' },
                    ].map((card) => (
                        <Link
                            key={card.title}
                            to={card.path}
                            style={{
                                textDecoration: 'none',
                                color: 'inherit'
                            }}
                        >
                            <div style={{
                                backgroundColor: theme.colors.secondaryBg,
                                border: `1px solid ${theme.colors.border}`,
                                borderRadius: '12px',
                                padding: '16px',
                                height: '100%'
                            }}>
                                <div style={{ color: theme.colors.primaryText, fontWeight: 800, fontSize: '16px', marginBottom: '6px' }}>
                                    {card.title}
                                </div>
                                <div style={{ color: theme.colors.mutedText, fontSize: '13px', lineHeight: 1.4, marginBottom: '10px' }}>
                                    {card.desc}
                                </div>
                                <div style={{ color: theme.colors.accent, fontWeight: 700, fontSize: '13px' }}>
                                    {card.cta}
                                </div>
                            </div>
                        </Link>
                    ))}
                </div>
            </main>
        </div>
    );
}

export default Hub; 