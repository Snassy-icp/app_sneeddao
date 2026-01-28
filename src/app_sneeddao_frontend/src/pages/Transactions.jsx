import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useSns } from '../contexts/SnsContext';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../AuthContext';
import Header from '../components/Header';
import TransactionList from '../components/TransactionList';
import TokenSelector from '../components/TokenSelector';
import { createActor as createSnsRootActor } from 'external/sns_root';
import { getAllSnses, fetchSnsLogo } from '../utils/SnsUtils';
import { HttpAgent } from '@dfinity/agent';
import { FaExchangeAlt, FaCoins, FaLayerGroup } from 'react-icons/fa';

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

.txs-card-animate {
    animation: fadeInUp 0.4s ease-out forwards;
}

.txs-shimmer {
    background: linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.1) 50%, transparent 100%);
    background-size: 200% 100%;
    animation: shimmer 2s infinite;
}

.txs-pulse {
    animation: pulse 2s ease-in-out infinite;
}
`;

// Accent colors
const txsPrimary = '#6366f1'; // Indigo
const txsSecondary = '#8b5cf6'; // Purple
const txsAccent = '#06b6d4'; // Cyan

const SELECTED_LEDGER_KEY = 'transactions_selected_ledger';

function Transactions() {
    const { theme } = useTheme();
    const { identity } = useAuth();
    const { selectedSnsRoot } = useSns();
    const [searchParams, setSearchParams] = useSearchParams();
    const [selectedLedger, setSelectedLedger] = useState(null);
    const [snsLedger, setSnsLedger] = useState(null);
    const [loading, setLoading] = useState(true);

    // SNS logo state
    const [snsLogo, setSnsLogo] = useState(null);
    const [loadingLogo, setLoadingLogo] = useState(false);
    const [snsInfo, setSnsInfo] = useState(null);

    // Load SNS information and logo
    const loadSnsInfo = async () => {
        if (!selectedSnsRoot) return;

        setSnsLogo(null);
        setLoadingLogo(false);
        setSnsInfo(null);

        try {
            const allSnses = getAllSnses();
            const currentSnsInfo = allSnses.find(sns => sns.rootCanisterId === selectedSnsRoot);
            
            if (currentSnsInfo) {
                setSnsInfo(currentSnsInfo);
                
                if (currentSnsInfo.canisters.governance) {
                    await loadSnsLogo(currentSnsInfo.canisters.governance, currentSnsInfo.name);
                }
            }
        } catch (error) {
            console.error('Error loading SNS info:', error);
        }
    };

    const loadSnsLogo = async (governanceId, snsName) => {
        if (loadingLogo) return;
        
        setLoadingLogo(true);
        
        try {
            const host = process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging' ? 'https://ic0.app' : 'http://localhost:4943';
            const agent = new HttpAgent({
                host,
                ...(identity && { identity })
            });

            if (process.env.DFX_NETWORK !== 'ic') {
                await agent.fetchRootKey();
            }

            const logo = await fetchSnsLogo(governanceId, agent);
            setSnsLogo(logo);
        } catch (error) {
            console.error(`Error loading logo for SNS ${snsName}:`, error);
        } finally {
            setLoadingLogo(false);
        }
    };

    // Load SNS info when selected SNS changes
    useEffect(() => {
        if (selectedSnsRoot) {
            loadSnsInfo();
        }
    }, [selectedSnsRoot, identity]);

    // Fetch the ledger canister ID for the selected SNS
    useEffect(() => {
        const fetchSnsLedger = async () => {
            if (!selectedSnsRoot) return;

            try {
                // First try to get from cached SNS data
                const allSnses = getAllSnses();
                const currentSns = allSnses.find(sns => sns.rootCanisterId === selectedSnsRoot);
                
                if (currentSns?.canisters?.ledger) {
                    setSnsLedger(currentSns.canisters.ledger);
                } else {
                    // Fallback: fetch from SNS root actor
                    const snsRootActor = createSnsRootActor(selectedSnsRoot);
                    const response = await snsRootActor.list_sns_canisters({});
                    setSnsLedger(response.ledger[0].toString());
                }
            } catch (error) {
                console.error('Error fetching SNS ledger:', error);
            }
        };

        fetchSnsLedger();
    }, [selectedSnsRoot]);

    // Initialize selected ledger from URL or localStorage or SNS default
    useEffect(() => {
        const ledgerParam = searchParams.get('ledger');
        
        if (ledgerParam) {
            // URL parameter takes precedence
            setSelectedLedger(ledgerParam);
            try {
                localStorage.setItem(SELECTED_LEDGER_KEY, ledgerParam);
            } catch (error) {
                console.warn('Failed to save to localStorage:', error);
            }
        } else {
            // Try localStorage first
            try {
                const stored = localStorage.getItem(SELECTED_LEDGER_KEY);
                if (stored) {
                    setSelectedLedger(stored);
                } else if (snsLedger) {
                    // Default to SNS ledger
                    setSelectedLedger(snsLedger);
                }
            } catch (error) {
                console.warn('Failed to read from localStorage:', error);
                if (snsLedger) {
                    setSelectedLedger(snsLedger);
                }
            }
        }
        
        setLoading(false);
    }, [searchParams, snsLedger]);

    // When SNS changes, update the selected ledger to match the new SNS's ledger
    useEffect(() => {
        if (snsLedger) {
            const ledgerParam = searchParams.get('ledger');
            if (!ledgerParam) {
                // Only auto-update if there's no explicit ledger parameter in URL
                setSelectedLedger(snsLedger);
                // Update localStorage as well
                try {
                    localStorage.setItem(SELECTED_LEDGER_KEY, snsLedger);
                } catch (error) {
                    console.warn('Failed to save to localStorage:', error);
                }
            }
        }
    }, [snsLedger, searchParams]);

    // Update URL and localStorage when selected ledger changes
    const handleLedgerChange = (newLedger) => {
        setSelectedLedger(newLedger);
        
        // Update URL parameter
        setSearchParams(prev => {
            const newParams = new URLSearchParams(prev);
            if (newLedger === snsLedger) {
                // Remove ledger parameter if it matches the SNS ledger (default)
                newParams.delete('ledger');
            } else {
                newParams.set('ledger', newLedger);
            }
            return newParams;
        }, { replace: true });

        // Update localStorage
        try {
            localStorage.setItem(SELECTED_LEDGER_KEY, newLedger);
        } catch (error) {
            console.warn('Failed to save to localStorage:', error);
        }
    };

    // Handler for SNS dropdown changes
    const handleSnsChange = (newSnsRoot) => {
        // When SNS changes, we'll fetch the new SNS's ledger and update
        // The effect above will handle updating the selected ledger
    };

    return (
        <div className='page-container'>
            <style>{customStyles}</style>
            <Header showSnsDropdown={true} onSnsChange={handleSnsChange} />
            
            <main style={{
                background: theme.colors.primaryGradient,
                minHeight: '100vh'
            }}>
                {/* Hero Section */}
                <div style={{
                    background: `linear-gradient(135deg, ${theme.colors.primaryBg} 0%, ${txsPrimary}15 50%, ${txsSecondary}10 100%)`,
                    borderBottom: `1px solid ${theme.colors.border}`,
                    padding: '2rem 1.5rem',
                    position: 'relative',
                    overflow: 'hidden'
                }}>
                    {/* Background decoration */}
                    <div style={{
                        position: 'absolute',
                        top: '-50%',
                        right: '-10%',
                        width: '400px',
                        height: '400px',
                        background: `radial-gradient(circle, ${txsPrimary}20 0%, transparent 70%)`,
                        borderRadius: '50%',
                        pointerEvents: 'none'
                    }} />
                    <div style={{
                        position: 'absolute',
                        bottom: '-30%',
                        left: '-5%',
                        width: '300px',
                        height: '300px',
                        background: `radial-gradient(circle, ${txsSecondary}15 0%, transparent 70%)`,
                        borderRadius: '50%',
                        pointerEvents: 'none'
                    }} />
                    
                    <div style={{
                        maxWidth: '1200px',
                        margin: '0 auto',
                        position: 'relative',
                        zIndex: 1
                    }}>
                        {/* SNS Logo and Title */}
                        <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '1.25rem',
                            marginBottom: '1.5rem'
                        }}>
                            {loadingLogo ? (
                                <div style={{
                                    width: '64px',
                                    height: '64px',
                                    borderRadius: '50%',
                                    background: theme.colors.tertiaryBg,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center'
                                }}>
                                    <span className="txs-pulse" style={{ color: theme.colors.mutedText }}>...</span>
                                </div>
                            ) : snsLogo ? (
                                <img
                                    src={snsLogo}
                                    alt={snsInfo?.name || 'SNS Logo'}
                                    style={{
                                        width: '64px',
                                        height: '64px',
                                        borderRadius: '50%',
                                        objectFit: 'cover',
                                        border: `3px solid ${txsPrimary}40`,
                                        boxShadow: `0 4px 20px ${txsPrimary}30`
                                    }}
                                />
                            ) : (
                                <div style={{
                                    width: '64px',
                                    height: '64px',
                                    borderRadius: '50%',
                                    background: `linear-gradient(135deg, ${txsPrimary}, ${txsSecondary})`,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center'
                                }}>
                                    <FaLayerGroup size={28} color="white" />
                                </div>
                            )}
                            
                            <div style={{ flex: 1 }}>
                                <h1 style={{
                                    color: theme.colors.primaryText,
                                    fontSize: '2rem',
                                    fontWeight: '700',
                                    margin: 0,
                                    lineHeight: '1.2'
                                }}>
                                    Transaction History
                                </h1>
                                <p style={{
                                    color: theme.colors.secondaryText,
                                    fontSize: '1rem',
                                    margin: '0.35rem 0 0 0'
                                }}>
                                    Browse and filter all ledger transactions
                                </p>
                            </div>
                        </div>
                        
                        {/* Token Selector Card */}
                        <div 
                            className="txs-card-animate"
                            style={{
                                background: theme.colors.secondaryBg,
                                borderRadius: '16px',
                                border: `1px solid ${theme.colors.border}`,
                                padding: '1.25rem 1.5rem',
                                maxWidth: '500px',
                                opacity: 0
                            }}
                        >
                            <div style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.75rem',
                                marginBottom: '0.75rem'
                            }}>
                                <div style={{
                                    width: '32px',
                                    height: '32px',
                                    borderRadius: '8px',
                                    background: `linear-gradient(135deg, ${txsPrimary}30, ${txsSecondary}20)`,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    color: txsPrimary
                                }}>
                                    <FaCoins size={16} />
                                </div>
                                <label style={{
                                    color: theme.colors.primaryText,
                                    fontWeight: '600',
                                    fontSize: '1rem'
                                }}>
                                    Select Token
                                </label>
                            </div>
                            <TokenSelector
                                value={selectedLedger || ''}
                                onChange={handleLedgerChange}
                                placeholder="Choose a token to view transactions..."
                                disabled={loading}
                            />
                            <p style={{
                                color: theme.colors.mutedText,
                                fontSize: '0.8rem',
                                marginTop: '0.75rem',
                                marginBottom: 0
                            }}>
                                View transaction history for any ICRC-1 token on the Internet Computer
                            </p>
                        </div>
                    </div>
                </div>

                {/* Main Content */}
                <div style={{
                    maxWidth: '1200px',
                    margin: '0 auto',
                    padding: '1.5rem'
                }}>
                    {selectedLedger ? (
                        <div 
                            className="txs-card-animate"
                            style={{
                                background: theme.colors.secondaryBg,
                                borderRadius: '16px',
                                border: `1px solid ${theme.colors.border}`,
                                overflow: 'hidden',
                                opacity: 0,
                                animationDelay: '0.1s'
                            }}
                        >
                            <TransactionList 
                                snsRootCanisterId={selectedSnsRoot}
                                ledgerCanisterId={selectedLedger}
                                isCollapsed={false}
                                onToggleCollapse={() => {}}
                                showHeader={false}
                                embedded={false}
                            />
                        </div>
                    ) : (
                        <div 
                            className="txs-card-animate"
                            style={{
                                textAlign: 'center',
                                padding: '4rem 2rem',
                                background: theme.colors.secondaryBg,
                                borderRadius: '16px',
                                border: `1px solid ${theme.colors.border}`,
                                opacity: 0
                            }}
                        >
                            <div style={{
                                width: '70px',
                                height: '70px',
                                borderRadius: '50%',
                                background: `linear-gradient(135deg, ${txsPrimary}30, ${txsSecondary}20)`,
                                margin: '0 auto 1.5rem',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                color: txsPrimary
                            }}>
                                <FaExchangeAlt size={28} />
                            </div>
                            <h3 style={{
                                color: theme.colors.primaryText,
                                fontSize: '1.25rem',
                                fontWeight: '600',
                                marginBottom: '0.5rem'
                            }}>
                                Select a Token
                            </h3>
                            <p style={{
                                color: theme.colors.secondaryText,
                                fontSize: '0.95rem'
                            }}>
                                Choose a token above to view its transaction history
                            </p>
                        </div>
                    )}
                </div>
            </main>
        </div>
    );
}

export default Transactions;
