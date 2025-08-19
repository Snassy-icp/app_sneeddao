import React, { useState, useEffect, useRef } from 'react';
import { Principal } from '@dfinity/principal';
import { createActor as createSnsRootActor } from 'external/sns_root';
import { createActor as createSnsArchiveActor } from 'external/sns_archive';
import { createActor as createSnsLedgerActor } from 'external/icrc1_ledger';
import { createActor as createSnsIndexActor } from 'external/sns_index';
import { PrincipalDisplay, getPrincipalDisplayInfoFromContext } from '../utils/PrincipalUtils';
import { useAuth } from '../AuthContext';
import { useNaming } from '../NamingContext';
import { Link } from 'react-router-dom';
import { useSearchParams } from 'react-router-dom';

const validateNameInput = (input) => {
    if (!input.trim()) return 'Name cannot be empty';
    if (input.length > 32) return 'Name cannot be longer than 32 characters';
    // Only allow letters, numbers, spaces, hyphens, underscores, dots, and apostrophes
    const validPattern = /^[a-zA-Z0-9\s\-_.']+$/;
    if (!validPattern.test(input)) {
        return 'Name can only contain letters, numbers, spaces, hyphens (-), underscores (_), dots (.), and apostrophes (\')';
    }
    return '';
};

const PAGE_SIZES = [10, 20, 50, 100];
const FETCH_SIZE = 100; // How many transactions to fetch per request

const styles = {
    container: {
        backgroundColor: '#2a2a2a',
        borderRadius: '8px',
        padding: '20px',
        marginTop: '20px'
    },
    header: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '20px'
    },
    filters: {
        display: 'flex',
        gap: '10px',
        marginBottom: '20px'
    },
    filterButton: {
        backgroundColor: '#3a3a3a',
        border: '1px solid #4a4a4a',
        borderRadius: '4px',
        padding: '8px 16px',
        color: '#fff',
        cursor: 'pointer'
    },
    filterButtonActive: {
        backgroundColor: '#3498db',
        border: '1px solid #2980b9'
    },
    table: {
        width: '100%',
        borderCollapse: 'collapse'
    },
    th: {
        textAlign: 'left',
        padding: '12px',
        borderBottom: '1px solid #3a3a3a',
        color: '#888'
    },
    td: {
        padding: '12px',
        borderBottom: '1px solid #3a3a3a',
        color: '#fff'
    },
    pagination: {
        display: 'flex',
        justifyContent: 'center',
        gap: '10px',
        marginTop: '20px'
    },
    pageButton: {
        backgroundColor: '#3a3a3a',
        border: '1px solid #4a4a4a',
        borderRadius: '4px',
        padding: '8px 16px',
        color: '#fff',
        cursor: 'pointer'
    },
    pageButtonDisabled: {
        opacity: 0.5,
        cursor: 'not-allowed'
    },
    loadingSpinner: {
        display: 'flex',
        justifyContent: 'center',
        padding: '20px',
        color: '#888'
    },
    principalCell: {
        display: 'flex',
        flexDirection: 'column',
        gap: '4px'
    },
    subaccount: {
        fontSize: '12px',
        color: '#888',
        wordBreak: 'break-all'
    },
    paginationControls: {
        display: 'flex',
        alignItems: 'center',
        gap: '10px'
    },
    select: {
        backgroundColor: '#3a3a3a',
        border: '1px solid #4a4a4a',
        borderRadius: '4px',
        padding: '8px',
        color: '#fff',
        cursor: 'pointer'
    },
    sortableHeader: {
        cursor: 'pointer',
        userSelect: 'none',
        display: 'flex',
        alignItems: 'center',
        gap: '4px'
    },
    sortIcon: {
        fontSize: '12px',
        opacity: 0.7
    },
    sortableHeaderGroup: {
        display: 'flex',
        alignItems: 'center',
        gap: '16px'
    },
    sortableSubHeader: {
        display: 'flex',
        alignItems: 'center',
        gap: '4px',
        cursor: 'pointer'
    },
    headerDivider: {
        color: '#666',
        userSelect: 'none'
    },
    filterInput: {
        backgroundColor: '#3a3a3a',
        border: '1px solid #4a4a4a',
        borderRadius: '4px',
        padding: '8px 12px',
        color: '#fff',
        width: '200px'
    },
    filterGroup: {
        display: 'flex',
        alignItems: 'center',
        gap: '8px'
    },
    filterLabel: {
        color: '#888',
        fontSize: '14px'
    },
    filtersContainer: {
        display: 'flex',
        gap: '20px',
        alignItems: 'center',
        marginBottom: '20px'
    },
    filterSelect: {
        backgroundColor: '#3a3a3a',
        border: '1px solid #4a4a4a',
        borderRadius: '4px',
        padding: '8px',
        color: '#fff',
        cursor: 'pointer',
        fontSize: '14px',
        minWidth: '80px'
    },
    headerTitle: {
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        cursor: 'pointer',
        userSelect: 'none'
    },
    collapseIcon: {
        fontSize: '18px',
        color: '#888',
        transition: 'transform 0.2s'
    },
    collapsedIcon: {
        transform: 'rotate(-90deg)'
    },
    tableContainer: {
        display: 'block'
    },
    cardsContainer: {
        display: 'none'
    },
    transactionCard: {
        backgroundColor: '#2a2a2a',
        borderRadius: '8px',
        padding: '15px',
        marginBottom: '10px',
        border: '1px solid #3a3a3a'
    },
    cardHeader: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '10px'
    },
    cardType: {
        padding: '4px 8px',
        borderRadius: '4px',
        fontSize: '12px',
        fontWeight: 'bold',
        textTransform: 'uppercase'
    },
    cardField: {
        marginBottom: '8px'
    },
    cardLabel: {
        color: '#888',
        fontSize: '12px',
        marginBottom: '2px'
    },
    cardValue: {
        color: '#fff',
        fontSize: '14px',
        wordBreak: 'break-all'
    }
};

const TransactionType = {
    ALL: 'all',
    TRANSFER: 'transfer',
    MINT: 'mint',
    BURN: 'burn',
    APPROVE: 'approve'
};

function TransactionList({ snsRootCanisterId, principalId = null, isCollapsed, onToggleCollapse }) {
    // Add responsive CSS for table/cards switching
    React.useEffect(() => {
        const mediaQueryCSS = `
            <style id="transaction-responsive-css">
                @media (max-width: 768px) {
                    .transaction-table-container { display: none !important; }
                    .transaction-cards-container { display: block !important; }
                }
                @media (min-width: 769px) {
                    .transaction-table-container { display: block !important; }
                    .transaction-cards-container { display: none !important; }
                }
            </style>
        `;
        
        // Remove existing style if it exists
        const existingStyle = document.getElementById('transaction-responsive-css');
        if (existingStyle) {
            existingStyle.remove();
        }
        
        // Add new style
        document.head.insertAdjacentHTML('beforeend', mediaQueryCSS);
        
        // Cleanup on unmount
        return () => {
            const style = document.getElementById('transaction-responsive-css');
            if (style) style.remove();
        };
    }, []);
    const { identity } = useAuth();
    const { principalNames, principalNicknames } = useNaming();
    const [searchParams, setSearchParams] = useSearchParams();
    const [allTransactions, setAllTransactions] = useState([]); // Store all fetched transactions
    const [displayedTransactions, setDisplayedTransactions] = useState([]); // Current page of transactions
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [page, setPage] = useState(0);
    const [pageSize, setPageSize] = useState(PAGE_SIZES[0]);
    const [selectedType, setSelectedType] = useState(TransactionType.ALL);
    const [ledgerCanisterId, setLedgerCanisterId] = useState(null);
    const [indexCanisterId, setIndexCanisterId] = useState(null);
    const [principalDisplayInfo, setPrincipalDisplayInfo] = useState(new Map());
    const [sortConfig, setSortConfig] = useState({
        key: 'timestamp',
        direction: 'desc'
    });
    const [fromFilter, setFromFilter] = useState('');
    const [toFilter, setToFilter] = useState('');
    const [filterOperator, setFilterOperator] = useState('and');
    const [totalTransactions, setTotalTransactions] = useState(0);
    const [startTxIndex, setStartTxIndex] = useState(() => {
        const urlStart = searchParams.get('start');
        return urlStart ? parseInt(urlStart) : 0;
    });
    const [txIndexInput, setTxIndexInput] = useState('');

    // Effect to sync page with URL start parameter
    useEffect(() => {
        const urlStart = searchParams.get('start');
        if (urlStart) {
            const startIndex = parseInt(urlStart);
            setStartTxIndex(startIndex);
            setPage(Math.floor(startIndex / pageSize));
        }
    }, [searchParams, pageSize]);

    // Update URL when page changes
    useEffect(() => {
        if (!principalId) {  // Only update URL in ledger mode
            const newStart = page * pageSize;
            if (newStart !== startTxIndex) {
                setSearchParams(prev => {
                    const newParams = new URLSearchParams(prev);
                    newParams.set('start', newStart.toString());
                    return newParams;
                });
                setStartTxIndex(newStart);
            }
        }
    }, [page, pageSize]);

    // Handle direct transaction index input
    const handleTxIndexSubmit = (e) => {
        e.preventDefault();
        const index = parseInt(txIndexInput);
        if (!isNaN(index) && index >= 0) {
            const newPage = Math.floor(index / pageSize);
            setPage(newPage);
            setSearchParams(prev => {
                const newParams = new URLSearchParams(prev);
                newParams.set('start', index.toString());
                return newParams;
            });
            setStartTxIndex(index);
            setTxIndexInput('');
        }
    };

    // Fetch canister IDs from SNS root
    const fetchCanisterIds = async () => {
        try {
            const snsRootActor = createSnsRootActor(snsRootCanisterId);
            const response = await snsRootActor.list_sns_canisters({});
            console.log("list_sns_canisters", response);

            // Set both ledger and index canister IDs
            setLedgerCanisterId(response.ledger[0]);
            setIndexCanisterId(response.index[0]);
        } catch (err) {
            setError('Failed to fetch canister IDs');
            console.error('Error fetching canister IDs:', err);
        }
    };

    // Fetch transactions from ledger and archives if needed
    const fetchLedgerTransactions = async () => {
        if (!ledgerCanisterId) return;

        setLoading(true);
        setError(null);

        try {
            const ledgerActor = createSnsLedgerActor(ledgerCanisterId, { agentOptions: { identity } });
            const startIndex = page * pageSize;

            // First try to get transactions from the ledger
            const response = await ledgerActor.get_transactions({
                start: BigInt(startIndex),
                length: BigInt(pageSize)
            });

            console.log("Ledger response:", response);

            let txs = [...response.transactions];
            setTotalTransactions(Number(response.log_length));

            // If we have archived transactions to fetch, get them
            if (response.archived_transactions.length > 0) {
                for (const archive of response.archived_transactions) {
                    try {
                        const archiveCanisterId = archive.callback[0].toText();
                        console.log("Archive info:", {
                            callback: archive.callback,
                            archiveCanisterId,
                            start: archive.start,
                            length: archive.length
                        });
                        
                        const archiveActor = createSnsArchiveActor(archiveCanisterId, { agentOptions: { identity } });
                        
                        const archiveResponse = await archiveActor.get_transactions({
                            start: archive.start,
                            length: archive.length
                        });

                        txs = [...txs, ...archiveResponse.transactions];
                    } catch (archiveErr) {
                        console.error('Error fetching from archive:', archiveErr);
                    }
                }
            }

            // Apply type filter if needed
            const filteredTxs = selectedType === TransactionType.ALL 
                ? txs 
                : txs.filter(tx => tx?.kind === selectedType);

            // Apply from/to filters
            const filteredByAddress = filteredTxs.filter(tx => {
                const fromPrincipal = getFromPrincipal(tx);
                const toPrincipal = getToPrincipal(tx);

                const fromMatches = matchesPrincipalFilter(
                    fromPrincipal,
                    fromFilter,
                    fromPrincipal ? principalDisplayInfo.get(fromPrincipal.toString()) : null
                );

                const toMatches = matchesPrincipalFilter(
                    toPrincipal,
                    toFilter,
                    toPrincipal ? principalDisplayInfo.get(toPrincipal.toString()) : null
                );

                return filterOperator === 'and' ? (fromMatches && toMatches) : (fromMatches || toMatches);
            });

            // Sort transactions
            const sortedTxs = sortTransactions(filteredByAddress);
            setDisplayedTransactions(sortedTxs);

        } catch (err) {
            setError('Failed to fetch transactions');
            console.error('Error fetching transactions:', err);
        } finally {
            setLoading(false);
        }
    };

    // Fetch all transactions from index canister
    const fetchAllFromIndex = async () => {
        try {
            const indexActor = createSnsIndexActor(indexCanisterId);
            const account = {
                owner: Principal.fromText(principalId),
                subaccount: []
            };
            
            let allTxs = [];
            let startIndex = 0;
            let hasMore = true;

            while (hasMore) {
                console.log("Fetching transactions from index", startIndex);
                const response = await indexActor.get_account_transactions({
                    account,
                    max_results: FETCH_SIZE,
                    start: startIndex > 0 ? [BigInt(startIndex)] : []
                });

                if (!response.Ok) {
                    throw new Error(response.Err.message);
                }

                const transactions = response.Ok.transactions;
                allTxs = [...allTxs, ...transactions];
                
                // If we got less than the fetch size, we're done
                if (transactions.length < FETCH_SIZE) {
                    hasMore = false;
                } else {
                    startIndex += FETCH_SIZE;
                }
            }

            console.log("Total transactions fetched:", allTxs.length);
            setAllTransactions(allTxs);
            setTotalTransactions(allTxs.length);
            updateDisplayedTransactions(allTxs, 0, selectedType, pageSize);
        } catch (err) {
            setError('Failed to fetch transactions from index');
            console.error('Error fetching from index:', err);
        } finally {
            setLoading(false);
        }
    };

    // Update displayed transactions based on page and filter
    const updateDisplayedTransactions = (transactions, pageNum, type, size) => {
        const filtered = type === TransactionType.ALL 
            ? transactions 
            : transactions.filter(tx => tx.transaction?.kind === type);
        
        // Apply from/to filters
        const filteredByAddress = filtered.filter(tx => {
            const fromPrincipal = getFromPrincipal(tx);
            const toPrincipal = getToPrincipal(tx);

            const fromMatches = matchesPrincipalFilter(
                fromPrincipal,
                fromFilter,
                fromPrincipal ? principalDisplayInfo.get(fromPrincipal.toString()) : null
            );

            const toMatches = matchesPrincipalFilter(
                toPrincipal,
                toFilter,
                toPrincipal ? principalDisplayInfo.get(toPrincipal.toString()) : null
            );

            return filterOperator === 'and' ? (fromMatches && toMatches) : (fromMatches || toMatches);
        });

        const sorted = sortTransactions(filteredByAddress);
        const start = pageNum * size;
        const end = start + size;
        setDisplayedTransactions(sorted.slice(start, end));
        setTotalTransactions(sorted.length);
    };

    // Effect to fetch canister IDs
    useEffect(() => {
        fetchCanisterIds();
    }, [snsRootCanisterId]);

    // Effect to fetch transactions when dependencies change
    useEffect(() => {
        if (!ledgerCanisterId) return;

        if (principalId && indexCanisterId) {
            // Use index canister for principal-specific queries
            fetchAllFromIndex();
        } else {
            // Use ledger for general transaction list
            fetchLedgerTransactions();
        }
    }, [ledgerCanisterId, indexCanisterId, principalId, page, pageSize, selectedType, fromFilter, toFilter, filterOperator]);

    // Effect to update displayed transactions when filters change (for index transactions)
    useEffect(() => {
        if (principalId && allTransactions.length > 0) {
            updateDisplayedTransactions(allTransactions, page, selectedType, pageSize);
        }
    }, [page, selectedType, pageSize, sortConfig, fromFilter, toFilter, filterOperator]);

    // Add effect to fetch principal display info
    useEffect(() => {
        const fetchPrincipalInfo = async () => {
            if (!displayedTransactions.length || !principalNames || !principalNicknames) return;

            const uniquePrincipals = new Set();
            displayedTransactions.forEach(tx => {
                const fromPrincipal = getFromPrincipal(tx);
                const toPrincipal = getToPrincipal(tx);

                if (fromPrincipal) {
                    try {
                        uniquePrincipals.add(fromPrincipal.toString());
                    } catch (error) {
                        console.error('Error converting fromPrincipal to string:', fromPrincipal, error);
                    }
                }

                if (toPrincipal) {
                    try {
                        uniquePrincipals.add(toPrincipal.toString());
                    } catch (error) {
                        console.error('Error converting toPrincipal to string:', toPrincipal, error);
                    }
                }
            });

            console.log('Unique principals to fetch:', Array.from(uniquePrincipals));

            const displayInfoMap = new Map();
            Array.from(uniquePrincipals).forEach(principal => {
                try {
                    console.log('Fetching display info for principal:', principal);
                    const displayInfo = getPrincipalDisplayInfoFromContext(Principal.fromText(principal), principalNames, principalNicknames);
                    console.log('Got display info for principal:', { principal, displayInfo });
                    displayInfoMap.set(principal, displayInfo);
                } catch (error) {
                    console.error('Error processing principal:', principal, error);
                }
            });

            setPrincipalDisplayInfo(displayInfoMap);
        };

        fetchPrincipalInfo();
    }, [displayedTransactions, identity, principalNames, principalNicknames]);

    const formatAmount = (amount, decimals = 8) => {
        const value = Number(amount) / Math.pow(10, decimals);
        return value.toLocaleString(undefined, {
            minimumFractionDigits: 0,
            maximumFractionDigits: 8
        });
    };

    const formatTimestamp = (timestamp) => {
        return new Date(Number(timestamp) / 1_000_000).toLocaleString();
    };

    // Update handlePageSizeChange
    const handlePageSizeChange = (event) => {
        const newSize = Number(event.target.value);
        setPageSize(newSize);
        setPage(0); // Reset to first page when changing page size
    };

    // Get display value for principal sorting
    const getPrincipalSortValue = (principal) => {
        console.log('getPrincipalSortValue input:', principal);
        if (!principal || typeof principal.toString !== 'function') {
            console.log('Invalid principal in getPrincipalSortValue:', principal);
            return '';
        }
        try {
            console.log('Converting principal to string:', principal);
            const principalStr = principal.toString();
            console.log('Got principal string:', principalStr);
            const displayInfo = principalDisplayInfo.get(principalStr);
            if (!displayInfo) return principalStr;
            
            // Prioritize name > nickname > principal ID
            if (displayInfo.name) return displayInfo.name;
            if (displayInfo.nickname) return displayInfo.nickname;
            return principalStr;
        } catch (error) {
            console.error('Error in getPrincipalSortValue:', error);
            return '';
        }
    };

    // Add sorting function
    const sortTransactions = (transactions) => {
        if (!sortConfig.key) return transactions;

        console.log('Sorting transactions with config:', sortConfig);
        return [...transactions].sort((a, b) => {
            if (!a || !b) {
                console.warn('Invalid transaction in sort:', { a, b });
                return 0;
            }

            let aValue, bValue;

            try {
                switch (sortConfig.key) {
                    case 'type':
                        aValue = a.kind || '';
                        bValue = b.kind || '';
                        break;
                    case 'fromAddress':
                        const aFromPrincipal = getFromPrincipal(a);
                        const bFromPrincipal = getFromPrincipal(b);
                        console.log('Sorting fromAddress:', { aFromPrincipal, bFromPrincipal });
                        aValue = aFromPrincipal ? getPrincipalSortValue(aFromPrincipal) : '';
                        bValue = bFromPrincipal ? getPrincipalSortValue(bFromPrincipal) : '';
                        break;
                    case 'toAddress':
                        const aToPrincipal = getToPrincipal(a);
                        const bToPrincipal = getToPrincipal(b);
                        console.log('Sorting toAddress:', { aToPrincipal, bToPrincipal });
                        aValue = aToPrincipal ? getPrincipalSortValue(aToPrincipal) : '';
                        bValue = bToPrincipal ? getPrincipalSortValue(bToPrincipal) : '';
                        break;
                    case 'amount':
                        aValue = getTransactionAmount(a) || 0n;
                        bValue = getTransactionAmount(b) || 0n;
                        return sortConfig.direction === 'asc' 
                            ? (aValue < bValue ? -1 : aValue > bValue ? 1 : 0)
                            : (bValue < aValue ? -1 : bValue > aValue ? 1 : 0);
                    case 'timestamp':
                        aValue = Number(a.timestamp || 0);
                        bValue = Number(b.timestamp || 0);
                        return sortConfig.direction === 'asc' 
                            ? aValue - bValue 
                            : bValue - aValue;
                    default:
                        return 0;
                }

                console.log('Sort values:', { aValue, bValue });

                if (aValue < bValue) return sortConfig.direction === 'asc' ? -1 : 1;
                if (aValue > bValue) return sortConfig.direction === 'asc' ? 1 : -1;
                return 0;
            } catch (error) {
                console.error('Error during sort:', error, { a, b });
                return 0;
            }
        });
    };

    // Update helper functions to handle both formats
    const getFromPrincipal = (tx) => {
        const transaction = tx.transaction || tx;
        if (transaction.transfer?.[0]?.from?.owner) return transaction.transfer[0].from.owner;
        if (transaction.burn?.[0]?.from?.owner) return transaction.burn[0].from.owner;
        if (transaction.approve?.[0]?.from?.owner) return transaction.approve[0].from.owner;
        return null;
    };

    const getToPrincipal = (tx) => {
        const transaction = tx.transaction || tx;
        if (transaction.transfer?.[0]?.to?.owner) return transaction.transfer[0].to.owner;
        if (transaction.mint?.[0]?.to?.owner) return transaction.mint[0].to.owner;
        if (transaction.approve?.[0]?.spender?.owner) return transaction.approve[0].spender.owner;
        return null;
    };

    const getTransactionAmount = (tx) => {
        const transaction = tx.transaction || tx;
        if (transaction.transfer?.[0]?.amount) return BigInt(transaction.transfer[0].amount);
        if (transaction.mint?.[0]?.amount) return BigInt(transaction.mint[0].amount);
        if (transaction.burn?.[0]?.amount) return BigInt(transaction.burn[0].amount);
        if (transaction.approve?.[0]?.amount) return BigInt(transaction.approve[0].amount);
        return 0n;
    };

    // Add sort handler
    const handleSort = (key) => {
        setSortConfig(prevConfig => ({
            key,
            direction: prevConfig.key === key && prevConfig.direction === 'asc' ? 'desc' : 'asc'
        }));
    };

    // Add debug logging to the filter function
    const matchesPrincipalFilter = (principal, filter, displayInfo) => {
        if (!filter) return true;
        if (!principal) return false;

        const filterLower = filter.toLowerCase();
        const principalStr = principal.toString().toLowerCase();

        // Debug log
        console.log('Matching principal:', {
            principal: principalStr,
            filter: filterLower,
            displayInfo
        });

        // Check principal ID
        if (principalStr.includes(filterLower)) return true;

        // Check name and nickname if available
        if (displayInfo) {
            // Handle name which might be an array or string
            const name = Array.isArray(displayInfo.name) ? displayInfo.name[0] : displayInfo.name;
            if (name && typeof name === 'string' && name.toLowerCase().includes(filterLower)) return true;

            // Handle nickname which might be an array or string
            const nickname = Array.isArray(displayInfo.nickname) ? displayInfo.nickname[0] : displayInfo.nickname;
            if (nickname && typeof nickname === 'string' && nickname.toLowerCase().includes(filterLower)) return true;
        }

        return false;
    };

    // Render sort indicator
    const renderSortIndicator = (key) => {
        if (sortConfig.key !== key) return '↕';
        return sortConfig.direction === 'asc' ? '↑' : '↓';
    };

    // Add helper function to get transaction sequence number
    const getTransactionSequence = (tx, index) => {
        console.log('Getting sequence number for transaction:', tx, 'at index:', index);
        let sequence = null;

        if (tx?.transfer?.[0]?.sequence_number) {
            sequence = tx.transfer[0].sequence_number;
        } else if (tx?.mint?.[0]?.sequence_number) {
            sequence = tx.mint[0].sequence_number;
        } else if (tx?.burn?.[0]?.sequence_number) {
            sequence = tx.burn[0].sequence_number;
        } else if (tx?.approve?.[0]?.sequence_number) {
            sequence = tx.approve[0].sequence_number;
        } else {
            // Calculate sequence based on page, pageSize and index
            sequence = (page * pageSize) + index;
        }

        console.log('Found sequence number:', sequence);
        return sequence;
    };

    if (loading) {
        return <div style={styles.loadingSpinner}>Loading transactions...</div>;
    }

    const renderTransactionCard = (tx, index) => {
        const transaction = tx.transaction || tx;
        const txType = transaction.kind;
        const fromPrincipal = getFromPrincipal(tx);
        const toPrincipal = getToPrincipal(tx);
        const amount = getTransactionAmount(tx);
        
        const getTypeColor = (type) => {
            switch (type?.toLowerCase()) {
                case 'transfer': return '#3498db';
                case 'mint': return '#2ecc71';
                case 'burn': return '#e74c3c';
                case 'approve': return '#f39c12';
                default: return '#95a5a6';
            }
        };
        
        return (
            <div key={index} style={styles.transactionCard}>
                <div style={styles.cardHeader}>
                    <div 
                        style={{
                            ...styles.cardType,
                            backgroundColor: getTypeColor(txType),
                            color: '#fff'
                        }}
                    >
                        {txType}
                    </div>
                    <div style={{ color: '#888', fontSize: '12px' }}>
                        #{tx.id || index}
                    </div>
                </div>
                
                {fromPrincipal && (
                    <div style={styles.cardField}>
                        <div style={styles.cardLabel}>From</div>
                        <div style={styles.cardValue}>
                            <PrincipalDisplay 
                                principal={fromPrincipal}
                                displayInfo={principalDisplayInfo.get(fromPrincipal?.toString?.() || '')}
                                showCopyButton={false}
                            />
                        </div>
                    </div>
                )}
                
                {toPrincipal && (
                    <div style={styles.cardField}>
                        <div style={styles.cardLabel}>To</div>
                        <div style={styles.cardValue}>
                            <PrincipalDisplay 
                                principal={toPrincipal}
                                displayInfo={principalDisplayInfo.get(toPrincipal?.toString?.() || '')}
                                showCopyButton={false}
                            />
                        </div>
                    </div>
                )}
                
                {amount !== null && amount !== undefined && (
                    <div style={styles.cardField}>
                        <div style={styles.cardLabel}>Amount</div>
                        <div style={styles.cardValue}>
                            {formatAmount(amount)}
                        </div>
                    </div>
                )}
                
                <div style={styles.cardField}>
                    <div style={styles.cardLabel}>Time</div>
                    <div style={styles.cardValue}>
                        {new Date(Number(transaction.timestamp / 1000000n)).toLocaleString()}
                    </div>
                </div>
            </div>
        );
    };

    if (error) {
        return <div style={styles.container}>Error: {error}</div>;
    }

    return (
        <div style={styles.container}>
            {/* Header Row - Always visible */}
            <div style={styles.header}>
                <div 
                    style={styles.headerTitle}
                    onClick={onToggleCollapse}
                >
                    <span 
                        style={{
                            ...styles.collapseIcon,
                            ...(isCollapsed ? styles.collapsedIcon : {})
                        }}
                    >
                        ▼
                    </span>
                    <h2 style={{ margin: 0 }}>Transactions</h2>
                </div>
            </div>
            
            {/* Filters Row - Only when expanded */}
            {!isCollapsed && (
                <div style={{
                    ...styles.filtersContainer,
                    flexWrap: 'wrap',
                    gap: '15px',
                    marginTop: '15px'
                }}>
                        {!principalId && ( // Only show in ledger mode
                            <form 
                                onSubmit={handleTxIndexSubmit}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '8px',
                                    marginRight: '20px'
                                }}
                            >
                                <input
                                    type="text"
                                    value={txIndexInput}
                                    onChange={(e) => setTxIndexInput(e.target.value)}
                                    placeholder="Go to tx index"
                                    style={{
                                        ...styles.filterInput,
                                        width: '120px'
                                    }}
                                />
                                <button
                                    type="submit"
                                    style={{
                                        backgroundColor: '#3498db',
                                        color: '#ffffff',
                                        border: 'none',
                                        borderRadius: '4px',
                                        padding: '8px 12px',
                                        cursor: 'pointer'
                                    }}
                                >
                                    Go
                                </button>
                            </form>
                        )}
                    <div style={{...styles.filterGroup, flexWrap: 'wrap'}}>
                        <span style={styles.filterLabel}>From:</span>
                        <input
                            type="text"
                            value={fromFilter}
                            onChange={(e) => {
                                setFromFilter(e.target.value);
                                setPage(0);
                            }}
                            placeholder="Filter by sender"
                            style={{
                                ...styles.filterInput,
                                minWidth: '150px',
                                flex: '1 1 200px'
                            }}
                        />
                    </div>
                    <select
                        value={filterOperator}
                        onChange={(e) => {
                            setFilterOperator(e.target.value);
                            setPage(0);
                        }}
                        style={styles.filterSelect}
                    >
                        <option value="and">AND</option>
                        <option value="or">OR</option>
                    </select>
                    <div style={{...styles.filterGroup, flexWrap: 'wrap'}}>
                        <span style={styles.filterLabel}>To:</span>
                        <input
                            type="text"
                            value={toFilter}
                            onChange={(e) => {
                                setToFilter(e.target.value);
                                setPage(0);
                            }}
                            placeholder="Filter by recipient"
                            style={{
                                ...styles.filterInput,
                                minWidth: '150px',
                                flex: '1 1 200px'
                            }}
                        />
                    </div>
                    <div style={{...styles.filters, flexWrap: 'wrap'}}>
                        {Object.values(TransactionType).map(type => (
                            <button
                                key={type}
                                style={{
                                    ...styles.filterButton,
                                    ...(selectedType === type ? styles.filterButtonActive : {})
                                }}
                                onClick={() => {
                                    setSelectedType(type);
                                    setPage(0);
                                }}
                            >
                                {type.charAt(0).toUpperCase() + type.slice(1)}
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {!isCollapsed && (
                <>
                    {/* Table view for wide screens */}
                    <div style={styles.tableContainer} className="transaction-table-container">
                        <table style={styles.table}>
                        <thead>
                            <tr>
                                <th 
                                    style={{...styles.th, width: '10%'}}
                                    onClick={() => handleSort('type')}
                                >
                                    <div style={styles.sortableHeader}>
                                        Type
                                        <span style={styles.sortIcon}>{renderSortIndicator('type')}</span>
                                    </div>
                                </th>
                                <th style={{...styles.th, width: '10%'}}>
                                    <div style={styles.sortableHeader}>
                                        ID
                                    </div>
                                </th>
                                <th style={{...styles.th, width: '35%'}}>
                                    <div style={styles.sortableHeaderGroup}>
                                        <div 
                                            style={styles.sortableSubHeader}
                                            onClick={() => handleSort('fromAddress')}
                                        >
                                            From
                                            <span style={styles.sortIcon}>{renderSortIndicator('fromAddress')}</span>
                                        </div>
                                        <span style={styles.headerDivider}>/</span>
                                        <div 
                                            style={styles.sortableSubHeader}
                                            onClick={() => handleSort('toAddress')}
                                        >
                                            To
                                            <span style={styles.sortIcon}>{renderSortIndicator('toAddress')}</span>
                                        </div>
                                    </div>
                                </th>
                                <th 
                                    style={{...styles.th, width: '15%'}}
                                    onClick={() => handleSort('amount')}
                                >
                                    <div style={styles.sortableHeader}>
                                        Amount
                                        <span style={styles.sortIcon}>{renderSortIndicator('amount')}</span>
                                    </div>
                                </th>
                                <th 
                                    style={{...styles.th, width: '20%'}}
                                    onClick={() => handleSort('timestamp')}
                                >
                                    <div style={styles.sortableHeader}>
                                        Time
                                        <span style={styles.sortIcon}>{renderSortIndicator('timestamp')}</span>
                                    </div>
                                </th>
                            </tr>
                        </thead>
                        <tbody>
                            {displayedTransactions.map((tx, index) => {
                                const transaction = tx.transaction || tx;
                                const txType = transaction.kind;
                                const fromPrincipal = getFromPrincipal(tx);
                                const toPrincipal = getToPrincipal(tx);
                                const amount = getTransactionAmount(tx);

                                return (
                                    <tr key={index}>
                                        <td style={styles.td}>{txType}</td>
                                        <td style={styles.td}>
                                            <Link 
                                                to={`/transaction?sns=${snsRootCanisterId}&id=${!principalId ? startTxIndex + index : (tx.id || index)}`}
                                                style={{
                                                    color: '#3498db',
                                                    textDecoration: 'none',
                                                    ':hover': {
                                                        textDecoration: 'underline'
                                                    }
                                                }}
                                            >
                                                #{!principalId ? startTxIndex + index : (tx.id.toString() || index)}
                                            </Link>
                                        </td>
                                        <td style={{...styles.td, ...styles.principalCell}}>
                                            {fromPrincipal && (
                                                <div>
                                                    <span style={{color: '#888'}}>From: </span>
                                                    <PrincipalDisplay 
                                                        principal={fromPrincipal}
                                                        displayInfo={principalDisplayInfo.get(fromPrincipal?.toString?.() || '')}
                                                        showCopyButton={false}
                                                    />
                                                    {txType === 'transfer' && transaction.transfer?.[0]?.from?.subaccount?.length > 0 && (
                                                        <div style={styles.subaccount}>
                                                            Subaccount: {transaction.transfer[0].from.subaccount[0]}
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                            {toPrincipal && (
                                                <div style={{marginTop: fromPrincipal ? '8px' : '0'}}>
                                                    <span style={{color: '#888'}}>To: </span>
                                                    <PrincipalDisplay 
                                                        principal={toPrincipal}
                                                        displayInfo={principalDisplayInfo.get(toPrincipal?.toString?.() || '')}
                                                        showCopyButton={false}
                                                    />
                                                    {txType === 'transfer' && transaction.transfer?.[0]?.to?.subaccount?.length > 0 && (
                                                        <div style={styles.subaccount}>
                                                            Subaccount: {transaction.transfer[0].to.subaccount[0]}
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                            {!fromPrincipal && !toPrincipal && '-'}
                                        </td>
                                        <td style={styles.td}>
                                            {amount ? formatAmount(amount) : '-'}
                                        </td>
                                        <td style={styles.td}>
                                            {formatTimestamp(transaction.timestamp)}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                        </table>
                    </div>

                    {/* Cards view for narrow screens */}
                    <div style={styles.cardsContainer} className="transaction-cards-container">
                        {displayedTransactions.map((tx, index) => renderTransactionCard(tx, index))}
                    </div>

                    <div style={styles.pagination}>
                        <div style={styles.paginationControls}>
                            <button
                                style={{
                                    ...styles.pageButton,
                                    ...(page === 0 ? styles.pageButtonDisabled : {})
                                }}
                                onClick={() => setPage(p => Math.max(0, p - 1))}
                                disabled={page === 0}
                            >
                                Previous
                            </button>
                            <span style={{ color: '#fff', alignSelf: 'center' }}>
                                Page {page + 1} of {Math.ceil(totalTransactions / pageSize)}
                            </span>
                            <button
                                style={{
                                    ...styles.pageButton,
                                    ...((page + 1) * pageSize >= totalTransactions ? styles.pageButtonDisabled : {})
                                }}
                                onClick={() => setPage(p => p + 1)}
                                disabled={(page + 1) * pageSize >= totalTransactions}
                            >
                                Next
                            </button>
                        </div>
                        <select 
                            value={pageSize} 
                            onChange={handlePageSizeChange}
                            style={styles.select}
                        >
                            {PAGE_SIZES.map(size => (
                                <option key={size} value={size}>
                                    {size} per page
                                </option>
                            ))}
                        </select>
                    </div>
                </>
            )}
        </div>
    );
}

export default TransactionList; 