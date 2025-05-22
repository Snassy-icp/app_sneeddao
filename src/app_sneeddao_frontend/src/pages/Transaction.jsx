import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import Header from '../components/Header';
import { createActor as createSnsRootActor } from 'external/sns_root';
import { createActor as createSnsArchiveActor } from 'external/sns_archive';
import { PrincipalDisplay, getPrincipalDisplayInfo } from '../utils/PrincipalUtils';
import { useAuth } from '../AuthContext';
import { formatAmount } from '../utils/StringUtils';

const styles = {
    container: {
        maxWidth: '1200px',
        margin: '0 auto',
        padding: '2rem'
    },
    card: {
        backgroundColor: '#2a2a2a',
        borderRadius: '8px',
        padding: '20px',
        marginBottom: '20px',
        border: '1px solid #3a3a3a'
    },
    searchBox: {
        display: 'flex',
        gap: '10px',
        marginBottom: '20px'
    },
    input: {
        backgroundColor: '#3a3a3a',
        border: '1px solid #4a4a4a',
        borderRadius: '4px',
        padding: '8px 12px',
        color: '#fff',
        flex: 1
    },
    button: {
        backgroundColor: '#3498db',
        color: '#fff',
        border: 'none',
        borderRadius: '4px',
        padding: '8px 16px',
        cursor: 'pointer'
    },
    label: {
        color: '#888',
        fontSize: '14px',
        marginBottom: '4px'
    },
    value: {
        color: '#fff',
        fontSize: '16px'
    },
    section: {
        marginBottom: '20px'
    },
    error: {
        backgroundColor: 'rgba(231, 76, 60, 0.2)',
        border: '1px solid #e74c3c',
        color: '#e74c3c',
        padding: '15px',
        borderRadius: '6px',
        marginBottom: '20px'
    },
    loading: {
        color: '#888',
        textAlign: 'center',
        padding: '20px'
    },
    detailRow: {
        display: 'flex',
        flexDirection: 'column',
        gap: '4px',
        marginBottom: '16px'
    },
    accountInfo: {
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        padding: '12px',
        backgroundColor: '#222',
        borderRadius: '4px',
        marginTop: '8px'
    },
    subaccount: {
        fontSize: '12px',
        color: '#888',
        wordBreak: 'break-all'
    }
};

function Transaction() {
    const SNEED_SNS_ROOT = 'fp274-iaaaa-aaaaq-aacha-cai';
    const { identity } = useAuth();
    const [searchParams, setSearchParams] = useSearchParams();
    const [transactionId, setTransactionId] = useState(searchParams.get('id') || '');
    const [archiveCanisterId, setArchiveCanisterId] = useState(null);
    const [transaction, setTransaction] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [principalDisplayInfo, setPrincipalDisplayInfo] = useState(new Map());

    // Fetch archive canister ID when SNS root changes
    useEffect(() => {
        const fetchArchiveCanisterId = async () => {
            try {
                const snsRoot = searchParams.get('sns') || SNEED_SNS_ROOT;
                const snsRootActor = createSnsRootActor(snsRoot);
                const response = await snsRootActor.list_sns_canisters({});
                setArchiveCanisterId(response.archives[0]);
            } catch (err) {
                setError('Failed to fetch archive canister ID');
                console.error('Error fetching archive canister ID:', err);
            }
        };

        fetchArchiveCanisterId();
    }, [searchParams]);

    // Fetch transaction details when ID changes
    useEffect(() => {
        const fetchTransaction = async () => {
            if (!archiveCanisterId || !transactionId) return;

            setLoading(true);
            setError(null);
            try {
                // Validate transaction ID
                const parsedId = transactionId.trim();
                if (!parsedId) {
                    setError('Please enter a transaction ID');
                    setTransaction(null);
                    return;
                }

                // Try to convert to BigInt
                let bigIntId;
                try {
                    bigIntId = BigInt(parsedId);
                } catch (e) {
                    setError('Invalid transaction ID format. Please enter a valid number.');
                    setTransaction(null);
                    return;
                }

                const archiveActor = createSnsArchiveActor(archiveCanisterId);
                const response = await archiveActor.get_transaction(bigIntId);
                if (response.length === 0) {
                    setError('Transaction not found');
                    setTransaction(null);
                } else {
                    console.log("Transaction:", response[0]);
                    setTransaction(response[0]);
                }
            } catch (err) {
                setError('Failed to fetch transaction details');
                console.error('Error fetching transaction:', err);
            } finally {
                setLoading(false);
            }
        };

        if (searchParams.get('id')) {
            fetchTransaction();
        }
    }, [archiveCanisterId, searchParams]);

    // Fetch principal display info when transaction changes
    useEffect(() => {
        const fetchPrincipalInfo = async () => {
            if (!transaction) return;

            const principals = new Set();
            
            // Add principals from transfer
            if (transaction.transfer?.[0]) {
                if (transaction.transfer[0].from?.owner) {
                    principals.add(transaction.transfer[0].from.owner.toString());
                }
                if (transaction.transfer[0].to?.owner) {
                    principals.add(transaction.transfer[0].to.owner.toString());
                }
                if (transaction.transfer[0].spender?.owner) {
                    principals.add(transaction.transfer[0].spender.owner.toString());
                }
            }

            // Add principals from mint
            if (transaction.mint?.[0]?.to?.owner) {
                principals.add(transaction.mint[0].to.owner.toString());
            }

            // Add principals from burn
            if (transaction.burn?.[0]) {
                if (transaction.burn[0].from?.owner) {
                    principals.add(transaction.burn[0].from.owner.toString());
                }
                if (transaction.burn[0].spender?.owner) {
                    principals.add(transaction.burn[0].spender.owner.toString());
                }
            }

            // Add principals from approve
            if (transaction.approve?.[0]) {
                if (transaction.approve[0].from?.owner) {
                    principals.add(transaction.approve[0].from.owner.toString());
                }
                if (transaction.approve[0].spender?.owner) {
                    principals.add(transaction.approve[0].spender.owner.toString());
                }
            }

            const displayInfoMap = new Map();
            await Promise.all(Array.from(principals).map(async principal => {
                const displayInfo = await getPrincipalDisplayInfo(identity, principal);
                displayInfoMap.set(principal, displayInfo);
            }));

            setPrincipalDisplayInfo(displayInfoMap);
        };

        fetchPrincipalInfo();
    }, [transaction, identity]);

    const handleSearch = () => {
        // Validate input before updating URL
        const parsedId = transactionId.trim();
        if (!parsedId) {
            setError('Please enter a transaction ID');
            return;
        }

        // Try to convert to BigInt to validate format
        try {
            BigInt(parsedId);
            const params = new URLSearchParams(searchParams);
            params.set('id', parsedId);
            setSearchParams(params);
            setError(null);
        } catch (e) {
            setError('Invalid transaction ID format. Please enter a valid number.');
        }
    };

    // Add key press handler for search input
    const handleKeyPress = (e) => {
        if (e.key === 'Enter') {
            handleSearch();
        }
    };

    const formatTimestamp = (timestamp) => {
        return new Date(Number(timestamp) / 1_000_000).toLocaleString();
    };

    const formatSafeAmount = (amount) => {
        if (amount === undefined || amount === null) return '-';
        try {
            // Handle BigInt, Number, and string inputs
            let amountStr;
            if (typeof amount === 'bigint') {
                amountStr = amount.toString();
            } else if (typeof amount === 'number') {
                amountStr = amount.toString();
            } else if (typeof amount === 'string') {
                amountStr = amount;
            } else {
                console.error('Invalid amount type:', typeof amount);
                return '-';
            }
            return formatAmount(amountStr, 8); // Default to 8 decimals for SNS tokens
        } catch (e) {
            console.error('Error formatting amount:', e, 'Amount:', amount);
            return '-';
        }
    };

    const renderAccountInfo = (account, label) => {
        if (!account || !account.owner) return null;
        try {
            return (
                <div style={styles.accountInfo}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ color: '#888' }}>{label}:</span>
                        <PrincipalDisplay
                            principal={account.owner}
                            displayInfo={account.owner ? principalDisplayInfo.get(account.owner.toString()) : null}
                            showCopyButton={true}
                        />
                    </div>
                    {account.subaccount && account.subaccount.length > 0 && (
                        <div style={styles.subaccount}>
                            Subaccount: {account.subaccount[0]}
                        </div>
                    )}
                </div>
            );
        } catch (e) {
            console.error('Error rendering account info:', e, 'Account:', account);
            return null;
        }
    };

    return (
        <div className="page-container">
            <Header showSnsDropdown={true} />
            <main style={styles.container}>
                <div style={styles.card}>
                    <div style={styles.searchBox}>
                        <input
                            type="text"
                            value={transactionId}
                            onChange={(e) => setTransactionId(e.target.value)}
                            onKeyPress={handleKeyPress}
                            placeholder="Enter transaction ID"
                            style={styles.input}
                        />
                        <button 
                            onClick={handleSearch}
                            style={styles.button}
                        >
                            Search
                        </button>
                    </div>

                    {loading && (
                        <div style={styles.loading}>Loading transaction details...</div>
                    )}

                    {error && (
                        <div style={styles.error}>{error}</div>
                    )}

                    {transaction && (
                        <div>
                            <div style={styles.detailRow}>
                                <div style={styles.label}>Transaction Type</div>
                                <div style={styles.value}>{transaction.kind}</div>
                            </div>

                            <div style={styles.detailRow}>
                                <div style={styles.label}>Timestamp</div>
                                <div style={styles.value}>{formatTimestamp(transaction.timestamp)}</div>
                            </div>

                            {/* Transfer details */}
                            {transaction.transfer?.[0] && (
                                <>
                                    {renderAccountInfo(transaction.transfer[0].from, "From")}
                                    {renderAccountInfo(transaction.transfer[0].to, "To")}
                                    {transaction.transfer[0].spender && 
                                        renderAccountInfo(transaction.transfer[0].spender, "Spender")}
                                    <div style={styles.detailRow}>
                                        <div style={styles.label}>Amount</div>
                                        <div style={styles.value}>
                                            {formatSafeAmount(transaction.transfer[0].amount)}
                                        </div>
                                    </div>
                                    {transaction.transfer[0].fee && (
                                        <div style={styles.detailRow}>
                                            <div style={styles.label}>Fee</div>
                                            <div style={styles.value}>
                                                {formatSafeAmount(transaction.transfer[0].fee)}
                                            </div>
                                        </div>
                                    )}
                                </>
                            )}

                            {/* Mint details */}
                            {transaction.mint?.[0] && (
                                <>
                                    {renderAccountInfo(transaction.mint[0].to, "To")}
                                    <div style={styles.detailRow}>
                                        <div style={styles.label}>Amount</div>
                                        <div style={styles.value}>
                                            {formatSafeAmount(transaction.mint[0].amount)}
                                        </div>
                                    </div>
                                </>
                            )}

                            {/* Burn details */}
                            {transaction.burn?.[0] && (
                                <>
                                    {renderAccountInfo(transaction.burn[0].from, "From")}
                                    {transaction.burn[0].spender && 
                                        renderAccountInfo(transaction.burn[0].spender, "Spender")}
                                    <div style={styles.detailRow}>
                                        <div style={styles.label}>Amount</div>
                                        <div style={styles.value}>
                                            {formatSafeAmount(transaction.burn[0].amount)}
                                        </div>
                                    </div>
                                </>
                            )}

                            {/* Approve details */}
                            {transaction.approve?.[0] && (
                                <>
                                    {renderAccountInfo(transaction.approve[0].from, "From")}
                                    {renderAccountInfo(transaction.approve[0].spender, "Spender")}
                                    <div style={styles.detailRow}>
                                        <div style={styles.label}>Amount</div>
                                        <div style={styles.value}>
                                            {formatSafeAmount(transaction.approve[0].amount)}
                                        </div>
                                    </div>
                                    {transaction.approve[0].fee && (
                                        <div style={styles.detailRow}>
                                            <div style={styles.label}>Fee</div>
                                            <div style={styles.value}>
                                                {formatSafeAmount(transaction.approve[0].fee)}
                                            </div>
                                        </div>
                                    )}
                                    {transaction.approve[0].expires_at && (
                                        <div style={styles.detailRow}>
                                            <div style={styles.label}>Expires At</div>
                                            <div style={styles.value}>
                                                {formatTimestamp(transaction.approve[0].expires_at)}
                                            </div>
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                    )}
                </div>
            </main>
        </div>
    );
}

export default Transaction; 