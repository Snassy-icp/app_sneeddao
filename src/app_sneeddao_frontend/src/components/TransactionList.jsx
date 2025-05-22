import React, { useState, useEffect, useRef } from 'react';
import { Principal } from '@dfinity/principal';
import { createActor as createSnsRootActor } from 'external/sns_root';
import { createActor as createSnsArchiveActor } from 'external/sns_archive';
import { createActor as createSnsLedgerActor } from 'external/icrc1_ledger';
import { PrincipalDisplay, getPrincipalDisplayInfo } from '../utils/PrincipalUtils';
import { useAuth } from '../AuthContext';
import { Link } from 'react-router-dom';

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
    const { identity } = useAuth();
    const [transactions, setTransactions] = useState([]); // Current page of transactions
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [page, setPage] = useState(0);
    const [pageSize, setPageSize] = useState(PAGE_SIZES[0]);
    const [selectedType, setSelectedType] = useState(TransactionType.ALL);
    const [ledgerCanisterId, setLedgerCanisterId] = useState(null);
    const [principalDisplayInfo, setPrincipalDisplayInfo] = useState(new Map());
    const [sortConfig, setSortConfig] = useState({
        key: 'timestamp',
        direction: 'desc'
    });
    const [fromFilter, setFromFilter] = useState('');
    const [toFilter, setToFilter] = useState('');
    const [filterOperator, setFilterOperator] = useState('and');
    const [totalTransactions, setTotalTransactions] = useState(0);

    // Fetch canister IDs from SNS root
    const fetchCanisterIds = async () => {
        try {
            const snsRootActor = createSnsRootActor(snsRootCanisterId);
            const response = await snsRootActor.list_sns_canisters({});
            console.log("list_sns_canisters", response);

            // Set the ledger canister ID
            setLedgerCanisterId(response.ledger[0]);
        } catch (err) {
            setError('Failed to fetch canister IDs');
            console.error('Error fetching canister IDs:', err);
        }
    };

    // Fetch transactions from ledger and archives if needed
    const fetchTransactions = async () => {
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
                        // The callback is an array where the first element is the Principal
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

            // Debug log transaction structure
            console.log('Transaction structure sample:', txs[0]);
            console.log('All transactions:', txs);

            // Check for invalid transactions
            const invalidTxs = txs.filter(tx => !tx || !tx.kind);
            if (invalidTxs.length > 0) {
                console.warn('Found invalid transactions:', invalidTxs);
            }

            // Apply type filter if needed
            const filteredTxs = selectedType === TransactionType.ALL 
                ? txs 
                : txs.filter(tx => {
                    if (!tx?.kind) {
                        console.warn('Transaction missing kind:', tx);
                        return false;
                    }
                    return tx.kind === selectedType;
                });

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

            setTransactions(sortedTxs);
        } catch (err) {
            setError('Failed to fetch transactions');
            console.error('Error fetching transactions:', err);
        } finally {
            setLoading(false);
        }
    };

    // Effect to fetch canister IDs
    useEffect(() => {
        fetchCanisterIds();
    }, [snsRootCanisterId]);

    // Effect to fetch transactions when dependencies change
    useEffect(() => {
        if (ledgerCanisterId) {
            fetchTransactions();
        }
    }, [ledgerCanisterId, page, pageSize, selectedType, fromFilter, toFilter, filterOperator]);

    // Add effect to fetch principal display info
    useEffect(() => {
        const fetchPrincipalInfo = async () => {
            if (!transactions.length) return;

            const uniquePrincipals = new Set();
            transactions.forEach(tx => {
                // Use our helper functions to get principals
                const fromPrincipal = getFromPrincipal(tx);
                const toPrincipal = getToPrincipal(tx);

                if (fromPrincipal) {
                    try {
                        console.log('Adding from principal to Set:', fromPrincipal);
                        uniquePrincipals.add(fromPrincipal.toString());
                    } catch (error) {
                        console.error('Error converting fromPrincipal to string:', fromPrincipal, error);
                    }
                }
                if (toPrincipal) {
                    try {
                        console.log('Adding to principal to Set:', toPrincipal);
                        uniquePrincipals.add(toPrincipal.toString());
                    } catch (error) {
                        console.error('Error converting toPrincipal to string:', toPrincipal, error);
                    }
                }
            });

            console.log('Unique principals to fetch:', Array.from(uniquePrincipals));

            const displayInfoMap = new Map();
            await Promise.all(Array.from(uniquePrincipals).map(async principal => {
                try {
                    console.log('Fetching display info for principal:', principal);
                    const displayInfo = await getPrincipalDisplayInfo(identity, Principal.fromText(principal));
                    console.log('Got display info for principal:', { principal, displayInfo });
                    displayInfoMap.set(principal, displayInfo);
                } catch (error) {
                    console.error('Error processing principal:', principal, error);
                }
            }));

            setPrincipalDisplayInfo(displayInfoMap);
        };

        fetchPrincipalInfo();
    }, [transactions, identity]);

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
        console.log('getFromPrincipal input:', tx);
        if (!tx) {
            console.log('getFromPrincipal: tx is null/undefined');
            return null;
        }

        let result = null;
        if (tx.kind === 'transfer' && tx.transfer?.[0]?.from?.owner) {
            result = tx.transfer[0].from.owner;
        } else if (tx.kind === 'burn' && tx.burn?.[0]?.from?.owner) {
            result = tx.burn[0].from.owner;
        } else if (tx.kind === 'approve' && tx.approve?.[0]?.from?.owner) {
            result = tx.approve[0].from.owner;
        }

        console.log('getFromPrincipal result:', result);
        return result;
    };

    const getToPrincipal = (tx) => {
        console.log('getToPrincipal input:', tx);
        if (!tx) {
            console.log('getToPrincipal: tx is null/undefined');
            return null;
        }

        let result = null;
        if (tx.kind === 'transfer' && tx.transfer?.[0]?.to?.owner) {
            result = tx.transfer[0].to.owner;
        } else if (tx.kind === 'mint' && tx.mint?.[0]?.to?.owner) {
            result = tx.mint[0].to.owner;
        } else if (tx.kind === 'approve' && tx.approve?.[0]?.spender?.owner) {
            result = tx.approve[0].spender.owner;
        }

        console.log('getToPrincipal result:', result);
        return result;
    };

    const getTransactionAmount = (tx) => {
        console.log('getTransactionAmount input:', tx);
        if (!tx) {
            console.log('getTransactionAmount: tx is null/undefined');
            return 0n;
        }

        let result = 0n;
        if (tx.kind === 'transfer' && tx.transfer?.[0]?.amount) {
            result = BigInt(tx.transfer[0].amount);
        } else if (tx.kind === 'mint' && tx.mint?.[0]?.amount) {
            result = BigInt(tx.mint[0].amount);
        } else if (tx.kind === 'burn' && tx.burn?.[0]?.amount) {
            result = BigInt(tx.burn[0].amount);
        } else if (tx.kind === 'approve' && tx.approve?.[0]?.amount) {
            result = BigInt(tx.approve[0].amount);
        }

        console.log('getTransactionAmount result:', result.toString());
        return result;
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

    if (error) {
        return <div style={styles.container}>Error: {error}</div>;
    }

    return (
        <div style={styles.container}>
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
                {!isCollapsed && (
                    <div style={styles.filtersContainer}>
                        <div style={styles.filterGroup}>
                            <span style={styles.filterLabel}>From:</span>
                            <input
                                type="text"
                                value={fromFilter}
                                onChange={(e) => {
                                    setFromFilter(e.target.value);
                                    setPage(0);
                                }}
                                placeholder="Filter by sender"
                                style={styles.filterInput}
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
                        <div style={styles.filterGroup}>
                            <span style={styles.filterLabel}>To:</span>
                            <input
                                type="text"
                                value={toFilter}
                                onChange={(e) => {
                                    setToFilter(e.target.value);
                                    setPage(0);
                                }}
                                placeholder="Filter by recipient"
                                style={styles.filterInput}
                            />
                        </div>
                        <div style={styles.filters}>
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
            </div>

            {!isCollapsed && (
                <>
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
                            {transactions.filter(tx => tx !== null && tx !== undefined).map((tx, index) => {
                                console.log("Processing transaction for render:", tx);
                                console.log("Transaction ID:", {
                                    id: tx.id,
                                    type: typeof tx.id,
                                    hasToString: tx.id?.toString !== undefined
                                });
                                
                                // Extract transaction details safely using our helper functions
                                const txType = tx?.kind;
                                const fromPrincipal = getFromPrincipal(tx);
                                const toPrincipal = getToPrincipal(tx);
                                const amount = getTransactionAmount(tx);

                                // Debug log the principals before rendering
                                console.log('Rendering transaction principals:', {
                                    fromPrincipal: fromPrincipal?.toString?.() || null,
                                    toPrincipal: toPrincipal?.toString?.() || null
                                });

                                return (
                                    <tr key={index}>
                                        <td style={styles.td}>{txType}</td>
                                        <td style={styles.td}>
                                            <Link 
                                                to={`/transaction?sns=${snsRootCanisterId}&id=${getTransactionSequence(tx, index)}`}
                                                style={{
                                                    color: '#3498db',
                                                    textDecoration: 'none',
                                                    ':hover': {
                                                        textDecoration: 'underline'
                                                    }
                                                }}
                                            >
                                                #{getTransactionSequence(tx, index)}
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
                                                    {tx.kind === 'transfer' && tx.transfer?.[0]?.from?.subaccount?.length > 0 && (
                                                        <div style={styles.subaccount}>
                                                            Subaccount: {tx.transfer[0].from.subaccount[0]}
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
                                                    {tx.kind === 'transfer' && tx.transfer?.[0]?.to?.subaccount?.length > 0 && (
                                                        <div style={styles.subaccount}>
                                                            Subaccount: {tx.transfer[0].to.subaccount[0]}
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
                                            {formatTimestamp(tx.timestamp)}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>

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