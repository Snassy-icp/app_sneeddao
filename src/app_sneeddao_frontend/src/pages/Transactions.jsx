import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useSns } from '../contexts/SnsContext';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../AuthContext';
import Header from '../components/Header';
import TransactionList from '../components/TransactionList';
import TokenSelector from '../components/TokenSelector';
import { createActor as createSnsRootActor } from 'external/sns_root';
import { getAllSnses } from '../utils/SnsUtils';

const SELECTED_LEDGER_KEY = 'transactions_selected_ledger';

function Transactions() {
    const { theme } = useTheme();
    const { identity } = useAuth();
    const { selectedSnsRoot } = useSns();
    const [searchParams, setSearchParams] = useSearchParams();
    const [selectedLedger, setSelectedLedger] = useState(null);
    const [snsLedger, setSnsLedger] = useState(null);
    const [loading, setLoading] = useState(true);

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
        <div className='page-container' style={{ background: theme.colors.primaryGradient, minHeight: '100vh' }}>
            <Header showSnsDropdown={true} onSnsChange={handleSnsChange} />
            <main className="wallet-container">
                <div style={{
                    marginBottom: '20px',
                    padding: '20px',
                    background: theme.colors.cardGradient,
                    borderRadius: '12px',
                    border: `1px solid ${theme.colors.border}`,
                    boxShadow: theme.colors.cardShadow
                }}>
                    <label style={{
                        display: 'block',
                        color: theme.colors.primaryText,
                        marginBottom: '8px',
                        fontWeight: '600',
                        fontSize: '0.95rem'
                    }}>
                        Select Token:
                    </label>
                    <TokenSelector
                        value={selectedLedger || ''}
                        onChange={handleLedgerChange}
                        placeholder="Select a token..."
                        disabled={loading}
                    />
                </div>

                {selectedLedger && (
                    <TransactionList 
                        snsRootCanisterId={selectedSnsRoot}
                        ledgerCanisterId={selectedLedger}
                        isCollapsed={false}
                        onToggleCollapse={() => {}}
                    />
                )}
            </main>
        </div>
    );
}

export default Transactions; 