import React, { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { createActor as createSnsRootActor } from 'external/sns_root';
import { createActor as createSnsArchiveActor } from 'external/sns_archive';
import { createActor as createSnsLedgerActor } from 'external/icrc1_ledger';
import { useAuth } from '../AuthContext';
import { useSns } from '../contexts/SnsContext';
import { useNaming } from '../NamingContext';
import Header from '../components/Header';
import { PrincipalDisplay, getPrincipalDisplayInfoFromContext } from '../utils/PrincipalUtils';
import { fetchAndCacheSnsData, getSnsById } from '../utils/SnsUtils';
import { formatAmount } from '../utils/StringUtils';
import { getTokenLogo } from '../utils/TokenUtils';
import { Principal } from '@dfinity/principal';

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
    },
    tokenInfo: {
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        padding: '12px',
        backgroundColor: '#222',
        borderRadius: '4px',
        marginBottom: '20px'
    },
    tokenLogo: {
        width: '32px',
        height: '32px',
        borderRadius: '50%',
        objectFit: 'cover'
    },
    tokenDetails: {
        display: 'flex',
        flexDirection: 'column',
        gap: '4px'
    },
    tokenName: {
        color: '#fff',
        fontSize: '16px',
        fontWeight: 'bold'
    },
    tokenSymbol: {
        color: '#888',
        fontSize: '14px'
    },
    navigationButtons: {
        display: 'flex',
        justifyContent: 'space-between',
        gap: '10px',
        marginTop: '20px'
    },
    navButton: {
        backgroundColor: '#3498db',
        color: '#ffffff',
        border: 'none',
        borderRadius: '4px',
        padding: '8px 16px',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        transition: 'background-color 0.2s'
    },
    navButtonDisabled: {
        backgroundColor: '#2c3e50',
        cursor: 'not-allowed',
        opacity: 0.7
    }
};

function Transaction() {
    const { identity } = useAuth();
    const { selectedSnsRoot, SNEED_SNS_ROOT } = useSns();
    const { principalNames, principalNicknames } = useNaming();
    const [searchParams, setSearchParams] = useSearchParams();
    const [currentId, setCurrentId] = useState(searchParams.get('id') || '');
    const [archiveCanisterId, setArchiveCanisterId] = useState(null);
    const [transaction, setTransaction] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [principalDisplayInfo, setPrincipalDisplayInfo] = useState(new Map());
    const [tokenMetadata, setTokenMetadata] = useState({
        name: '',
        symbol: '',
        logo: '',
        decimals: 8
    });

    const fetchTransaction = async () => {
        if (!currentId) return;

        setLoading(true);
        setError(null);
        try {
            // Clean and validate the transaction ID
            const cleanId = currentId.replace(/[^0-9]/g, '');
            if (!cleanId) {
                throw new Error('Invalid transaction ID');
            }

            const snsRoot = searchParams.get('sns') || selectedSnsRoot || SNEED_SNS_ROOT;
            const selectedSns = getSnsById(snsRoot);
            if (!selectedSns) {
                throw new Error('Selected SNS not found');
            }

            // First try to get the transaction directly from the ledger
            const ledgerActor = createSnsLedgerActor(selectedSns.canisters.ledger, {
                agentOptions: { identity }
            });

            const response = await ledgerActor.get_transactions({
                start: BigInt(cleanId),
                length: 1n
            });

            let tx = null;

            // Check if the transaction is in the direct response
            if (response.transactions.length > 0) {
                tx = response.transactions[0];
            }
            // If not found in direct response, check if it's archived
            else if (response.archived_transactions.length > 0) {
                const archiveInfo = response.archived_transactions[0];
                console.log('Archive info:', archiveInfo);
                
                // The callback is an array where the first element is the Principal
                const archiveCanisterId = archiveInfo.callback[0].toText();
                console.log('Archive canister ID:', archiveCanisterId);
                
                const archiveActor = createSnsArchiveActor(archiveCanisterId, {
                    agentOptions: { identity }
                });
                const archiveResponse = await archiveActor.get_transactions({
                    start: BigInt(cleanId),
                    length: 1n
                });
                if (archiveResponse.transactions.length > 0) {
                    tx = archiveResponse.transactions[0];
                }
            }

            if (!tx) {
                throw new Error('Transaction not found');
            }

            setTransaction(tx);
            console.log('Full transaction details:', tx);
            if (tx.transfer?.[0]) {
                console.log('Transfer details:', tx.transfer[0]);
                console.log('Amount structure:', tx.transfer[0].amount);
            }

        } catch (err) {
            console.error('Error fetching transaction:', err);
            setError(err.message || 'Failed to load transaction');
        } finally {
            setLoading(false);
        }
    };

    // Fetch token metadata when SNS root changes
    useEffect(() => {
        const fetchTokenMetadata = async () => {
            try {
                const snsRoot = searchParams.get('sns') || selectedSnsRoot || SNEED_SNS_ROOT;
                const selectedSns = getSnsById(snsRoot);
                if (!selectedSns) {
                    throw new Error('Selected SNS not found');
                }

                const ledgerActor = createSnsLedgerActor(selectedSns.canisters.ledger);
                const [metadata, decimals] = await Promise.all([
                    ledgerActor.icrc1_metadata(),
                    ledgerActor.icrc1_decimals()
                ]);

                const name = metadata.find(([key]) => key === 'icrc1:name')?.[1]?.Text || '';
                const symbol = metadata.find(([key]) => key === 'icrc1:symbol')?.[1]?.Text || '';
                const logo = getTokenLogo(metadata);

                setTokenMetadata({
                    name,
                    symbol,
                    logo,
                    decimals
                });
            } catch (err) {
                console.error('Error fetching token metadata:', err);
            }
        };

        fetchTokenMetadata();
    }, [searchParams]);

    // Fetch archive canister ID when SNS root changes
    useEffect(() => {
        const fetchArchiveCanisterId = async () => {
            try {
                const snsRoot = searchParams.get('sns') || selectedSnsRoot || SNEED_SNS_ROOT;
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

    // Fetch transaction when ID changes
    useEffect(() => {
        if (searchParams.get('id')) {
            fetchTransaction();
        }
    }, [archiveCanisterId, searchParams]);

    // Fetch principal display info when transaction changes
    useEffect(() => {
        const fetchPrincipalInfo = () => {
            if (!transaction || !principalNames || !principalNicknames) return;

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
            Array.from(principals).forEach(principal => {
                const displayInfo = getPrincipalDisplayInfoFromContext(Principal.fromText(principal), principalNames, principalNicknames);
                displayInfoMap.set(principal, displayInfo);
            });

            setPrincipalDisplayInfo(displayInfoMap);
        };

        fetchPrincipalInfo();
    }, [transaction, principalNames, principalNicknames]);

    const handleSearch = () => {
        // Validate input before updating URL
        const parsedId = currentId.trim();
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

    const formatSafeAmount = (amount) => {
        if (amount === undefined || amount === null) return '-';
        try {
            // Debug log
            console.log('Amount to format:', amount, 'Type:', typeof amount);
            
            // If amount is an object with an e8s field (common in IC transactions)
            if (typeof amount === 'object' && 'e8s' in amount) {
                return formatAmount(amount.e8s.toString(), tokenMetadata.decimals);
            }

            // Handle array of BigInt (e.g., fee array)
            if (Array.isArray(amount) && amount.length > 0 && typeof amount[0] === 'bigint') {
                return formatAmount(amount[0].toString(), tokenMetadata.decimals);
            }

            // Handle BigInt, Number, and string inputs
            let amountStr;
            if (typeof amount === 'bigint') {
                amountStr = amount.toString();
            } else if (typeof amount === 'number') {
                amountStr = amount.toString();
            } else if (typeof amount === 'string') {
                amountStr = amount;
            } else {
                console.error('Invalid amount type:', typeof amount, 'Amount:', amount);
                return '-';
            }
            return formatAmount(amountStr, tokenMetadata.decimals);
        } catch (e) {
            console.error('Error formatting amount:', e, 'Amount:', amount);
            return '-';
        }
    };

    const formatTimestamp = (timestamp) => {
        return new Date(Number(timestamp) / 1_000_000).toLocaleString();
    };

    // Add debug logging to see transaction structure
    useEffect(() => {
        if (transaction) {
            console.log('Full transaction details:', transaction);
            if (transaction.transfer?.[0]) {
                console.log('Transfer details:', transaction.transfer[0]);
                console.log('Amount structure:', transaction.transfer[0].amount);
            }
        }
    }, [transaction]);

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

    // Add navigation handler
    const handleNavigation = (direction) => {
        const newId = direction === 'prev' ? 
            BigInt(currentId) - 1n : 
            BigInt(currentId) + 1n;
        
        setCurrentId(newId.toString());
        setSearchParams(prev => {
            prev.set('id', newId.toString());
            return prev;
        });
    };

    // Update useEffect to use currentId
    useEffect(() => {
        if (archiveCanisterId && currentId) {
            fetchTransaction();
        }
    }, [currentId, archiveCanisterId]);

    return (
        <div className="page-container">
            <Header showSnsDropdown={true} />
            <main style={styles.container}>
                <div style={styles.card}>
                    <div style={styles.searchBox}>
                        <input
                            type="text"
                            value={currentId}
                            onChange={(e) => setCurrentId(e.target.value)}
                            onKeyPress={handleKeyPress}
                            placeholder="Enter transaction ID"
                            style={styles.input}
                        />
                        <button onClick={handleSearch} style={styles.button}>
                            Search
                        </button>
                    </div>

                    {error && (
                        <div style={styles.error}>{error}</div>
                    )}

                    {loading ? (
                        <div style={styles.loading}>Loading transaction details...</div>
                    ) : transaction && (
                        <>
                            {/* Token Info */}
                            <div style={styles.tokenInfo}>
                                <img 
                                    src={tokenMetadata.logo || 'icp_symbol.svg'} 
                                    alt={tokenMetadata.symbol} 
                                    style={styles.tokenLogo}
                                />
                                <div style={styles.tokenDetails}>
                                    <div style={styles.tokenName}>{tokenMetadata.name}</div>
                                    <div style={styles.tokenSymbol}>{tokenMetadata.symbol}</div>
                                </div>
                            </div>

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
                                            {formatSafeAmount(transaction.transfer[0].amount)} {tokenMetadata.symbol}
                                        </div>
                                    </div>
                                    {transaction.transfer[0].fee && (
                                        <div style={styles.detailRow}>
                                            <div style={styles.label}>Fee</div>
                                            <div style={styles.value}>
                                                {formatSafeAmount(transaction.transfer[0].fee)} {tokenMetadata.symbol}
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
                                            {formatSafeAmount(transaction.mint[0].amount)} {tokenMetadata.symbol}
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
                                            {formatSafeAmount(transaction.burn[0].amount)} {tokenMetadata.symbol}
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
                                            {formatSafeAmount(transaction.approve[0].amount)} {tokenMetadata.symbol}
                                        </div>
                                    </div>
                                    {transaction.approve[0].fee && (
                                        <div style={styles.detailRow}>
                                            <div style={styles.label}>Fee</div>
                                            <div style={styles.value}>
                                                {formatSafeAmount(transaction.approve[0].fee)} {tokenMetadata.symbol}
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

                            {/* Navigation Buttons */}
                            <div style={styles.navigationButtons}>
                                <button
                                    onClick={() => handleNavigation('prev')}
                                    disabled={BigInt(currentId) <= 0n}
                                    style={{
                                        ...styles.navButton,
                                        ...(BigInt(currentId) <= 0n ? styles.navButtonDisabled : {})
                                    }}
                                >
                                    ← Previous
                                </button>
                                <button
                                    onClick={() => handleNavigation('next')}
                                    style={styles.navButton}
                                >
                                    Next →
                                </button>
                            </div>
                        </>
                    )}
                </div>
            </main>
        </div>
    );
}

export default Transaction; 