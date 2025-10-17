import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Principal } from '@dfinity/principal';
import { createActor as createSnsRootActor } from 'external/sns_root';
import { createActor as createSnsArchiveActor } from 'external/sns_archive';
import { createActor as createSnsLedgerActor } from 'external/icrc1_ledger';
import { createActor as createSnsIndexActor } from 'external/sns_index';
import { PrincipalDisplay, getPrincipalDisplayInfoFromContext } from '../utils/PrincipalUtils';
import { useAuth } from '../AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { useNaming } from '../NamingContext';
import PrincipalInput from './PrincipalInput';
import { Link } from 'react-router-dom';
import { useSearchParams } from 'react-router-dom';
import { subaccountToHex } from '../utils/StringUtils';

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

const TRANSACTION_TYPES = {
    TRANSFER: 'transfer',
    MINT: 'mint',
    BURN: 'burn',
    APPROVE: 'approve'
};

const TransactionType = {
    ALL: 'all',
    TRANSFER: 'transfer',
    MINT: 'mint',
    BURN: 'burn',
    APPROVE: 'approve'
};

function TransactionList({ snsRootCanisterId, ledgerCanisterId: providedLedgerCanisterId = null, principalId = null, isCollapsed, onToggleCollapse }) {
    const { theme } = useTheme();
    
    const styles = {
        container: {
            backgroundColor: theme.colors.secondaryBg,
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
            backgroundColor: theme.colors.tertiaryBg,
            border: `1px solid ${theme.colors.border}`,
            borderRadius: '4px',
            padding: '8px 16px',
            color: theme.colors.primaryText,
            cursor: 'pointer'
        },
        filterButtonActive: {
            backgroundColor: theme.colors.accent,
            border: `1px solid ${theme.colors.accent}`
        },
        table: {
            width: '100%',
            borderCollapse: 'collapse'
        },
        th: {
            textAlign: 'left',
            padding: '12px',
            borderBottom: `1px solid ${theme.colors.border}`,
            color: theme.colors.mutedText
        },
        td: {
            padding: '12px',
            borderBottom: `1px solid ${theme.colors.border}`,
            color: theme.colors.primaryText
        },
        pagination: {
            display: 'flex',
            justifyContent: 'center',
            gap: '10px',
            marginTop: '20px'
        },
        pageButton: {
            backgroundColor: theme.colors.tertiaryBg,
            border: `1px solid ${theme.colors.border}`,
            borderRadius: '4px',
            padding: '8px 16px',
            color: theme.colors.primaryText,
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
            color: theme.colors.mutedText
        },
        filtersContainer: {
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
            marginBottom: '20px'
        },
        filtersRow: {
            display: 'flex',
            flexWrap: 'wrap',
            gap: '16px',
            alignItems: 'center'
        },
        filterGroup: {
            display: 'flex',
            flexDirection: 'column',
            gap: '4px',
            minWidth: '180px',
            flex: '1 1 180px',
            maxWidth: '250px'
        },
        compactFilterGroup: {
            display: 'flex',
            flexDirection: 'column',
            gap: '4px',
            minWidth: '120px',
            flex: '0 0 auto'
        },
        filterLabel: {
            color: theme.colors.mutedText,
            fontSize: '14px'
        },
        filterInput: {
            backgroundColor: theme.colors.tertiaryBg,
            border: `1px solid ${theme.colors.border}`,
            borderRadius: '4px',
            padding: '8px 12px',
            color: theme.colors.primaryText,
            width: '200px'
        },
        filterSelect: {
            backgroundColor: theme.colors.tertiaryBg,
            border: `1px solid ${theme.colors.border}`,
            borderRadius: '4px',
            padding: '8px',
            color: theme.colors.primaryText,
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
            color: theme.colors.mutedText,
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
            backgroundColor: theme.colors.secondaryBg,
            borderRadius: '8px',
            padding: '15px',
            marginBottom: '10px',
            border: `1px solid ${theme.colors.border}`
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
            color: theme.colors.mutedText,
            fontSize: '12px',
            marginBottom: '2px'
        },
        cardValue: {
            color: theme.colors.primaryText,
            fontSize: '14px',
            wordBreak: 'break-all'
        },
        paginationControls: {
            display: 'flex',
            alignItems: 'center',
            gap: '10px'
        },
        select: {
            backgroundColor: theme.colors.tertiaryBg,
            border: `1px solid ${theme.colors.border}`,
            borderRadius: '4px',
            padding: '8px',
            color: theme.colors.primaryText,
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
            color: theme.colors.mutedText,
            userSelect: 'none'
        },
        principalCell: {
            display: 'flex',
            flexDirection: 'column',
            gap: '4px'
        },
        subaccount: {
            fontSize: '12px',
            color: theme.colors.mutedText,
            wordBreak: 'break-all'
        }
    };


    const { identity, isAuthenticated } = useAuth();
    const { principalNames, principalNicknames } = useNaming();
    const [searchParams, setSearchParams] = useSearchParams();
    const [rawTransactions, setRawTransactions] = useState([]); // Raw transactions from server (ledger mode)
    const [allTransactions, setAllTransactions] = useState([]); // All transactions for specific principal (index mode)
    const [displayedTransactions, setDisplayedTransactions] = useState([]); // Filtered and sorted transactions
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [page, setPage] = useState(0);
    const [pageSize, setPageSize] = useState(PAGE_SIZES[0]);
    const [selectedType, setSelectedType] = useState(TransactionType.ALL);
    const [ledgerCanisterId, setLedgerCanisterId] = useState(null);
    const [indexCanisterId, setIndexCanisterId] = useState(null);
    const [principalDisplayInfo, setPrincipalDisplayInfo] = useState(new Map());
    const [sortConfig, setSortConfig] = useState({
        key: 'index',
        direction: 'asc'
    });
    const [fromFilter, setFromFilter] = useState('');
    const [toFilter, setToFilter] = useState('');
    const [filterOperator, setFilterOperator] = useState('and');
    const [totalTransactions, setTotalTransactions] = useState(0);
    const [startTxIndex, setStartTxIndex] = useState(() => {
        const urlStart = searchParams.get('start');
        return urlStart ? parseInt(urlStart) : 0;
    });
    const [txIndexInput, setTxIndexInput] = useState(() => {
        const urlStart = searchParams.get('start');
        return urlStart ? urlStart : '';
    });
    // Add responsive CSS for table/cards switching and filter layout
    React.useEffect(() => {
        const mediaQueryCSS = `
            <style id="transaction-responsive-css">
                @media (max-width: 768px) {
                    .transaction-table-container { display: none !important; }
                    .transaction-cards-container { display: block !important; }
                    .transaction-filters-row {
                        flex-direction: column !important;
                        align-items: stretch !important;
                    }
                    .transaction-filter-group,
                    .transaction-compact-filter-group {
                        min-width: 100% !important;
                        flex: 1 1 100% !important;
                    }
                }
                @media (min-width: 769px) and (max-width: 1024px) {
                    .transaction-filters-row {
                        flex-wrap: wrap !important;
                    }
                    .transaction-filter-group {
                        flex: 1 1 40% !important;
                        min-width: 180px !important;
                        max-width: 220px !important;
                    }
                    .transaction-compact-filter-group {
                        flex: 1 1 20% !important;
                        min-width: 120px !important;
                    }
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

    // Effect to sync page with URL start parameter and input field
    useEffect(() => {
        const urlStart = searchParams.get('start');
        if (urlStart) {
            const startIndex = parseInt(urlStart);
            setStartTxIndex(startIndex);
            setPage(Math.floor(startIndex / pageSize));
            // Always sync input field with URL parameter on page load/refresh
            // but don't override if user is actively typing (input has focus)
            const inputElement = document.querySelector('input[placeholder="Go to tx index"]');
            if (!inputElement || inputElement !== document.activeElement) {
                setTxIndexInput(startIndex.toString());
            }
        } else if (startTxIndex === 0) {
            // Only reset input if we're at the beginning
            setTxIndexInput('');
        }
    }, [searchParams, pageSize]);

    // Update URL when page changes (but only for pagination, not direct tx input)
    useEffect(() => {
        if (!principalId) {  // Only update URL in ledger mode
            const newStart = page * pageSize;
            const currentUrlStart = searchParams.get('start');
            const currentUrlStartNum = currentUrlStart ? parseInt(currentUrlStart) : 0;
            
            // Only update URL if:
            // 1. The calculated start differs from current URL start
            // 2. The difference is due to page navigation, not direct tx input
            // 3. We're not in the middle of processing a direct tx input
            if (newStart !== currentUrlStartNum && newStart === startTxIndex) {
                setSearchParams(prev => {
                    const newParams = new URLSearchParams(prev);
                    newParams.set('start', newStart.toString());
                    return newParams;
                }, { replace: true }); // Use replace to prevent history buildup
            }
            
            // Always keep startTxIndex in sync with the calculated page start
            if (newStart !== startTxIndex) {
                setStartTxIndex(newStart);
            }
        }
    }, [page, pageSize, startTxIndex, principalId, searchParams, setSearchParams]);

    // Handle direct transaction index input
    const handleTxIndexSubmit = (e) => {
        e.preventDefault();
        e.stopPropagation(); // Prevent event bubbling that might cause issues on mobile
        
        const index = parseInt(txIndexInput);
        if (!isNaN(index) && index >= 0) {
            const newPage = Math.floor(index / pageSize);
            
            // Update state first
            setPage(newPage);
            setStartTxIndex(index);
            // Don't clear the input - keep the value that matches the URL param
            
            // Update URL parameters only if they would actually change
            const currentStart = searchParams.get('start');
            if (currentStart !== index.toString()) {
                setSearchParams(prev => {
                    const newParams = new URLSearchParams(prev);
                    newParams.set('start', index.toString());
                    return newParams;
                }, { replace: true }); // Use replace instead of push to prevent history buildup
            }
        }
    };

    // Fetch canister IDs from SNS root
    const fetchCanisterIds = async () => {
        try {
            // If ledger canister ID is provided directly, use it
            if (providedLedgerCanisterId) {
                setLedgerCanisterId(providedLedgerCanisterId);
                // Try to fetch index canister if we have SNS root
                if (snsRootCanisterId) {
                    try {
                        const snsRootActor = createSnsRootActor(snsRootCanisterId);
                        const response = await snsRootActor.list_sns_canisters({});
                        setIndexCanisterId(response.index[0]);
                    } catch (err) {
                        console.warn('Failed to fetch index canister, will work without it:', err);
                    }
                }
                return;
            }

            // Otherwise, fetch from SNS root
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

            // Add the actual transaction index to each transaction
            let txs = response.transactions.map((tx, idx) => ({
                ...tx,
                txIndex: startIndex + idx
            }));
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

                        // Add transaction index to archived transactions
                        const archivedTxsWithIndex = archiveResponse.transactions.map((tx, idx) => ({
                            ...tx,
                            txIndex: Number(archive.start) + idx
                        }));
                        txs = [...txs, ...archivedTxsWithIndex];
                    } catch (archiveErr) {
                        console.error('Error fetching from archive:', archiveErr);
                    }
                }
            }

            // Store raw transactions - filtering will be done separately
            setRawTransactions(txs);

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
            // Filtering will be handled by the separate useEffect
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
    }, [snsRootCanisterId, providedLedgerCanisterId]);

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
    }, [ledgerCanisterId, indexCanisterId, principalId, page, pageSize]);

    // Effect to filter and sort transactions client-side
    useEffect(() => {
        if (principalId && allTransactions.length > 0) {
            // For index transactions (specific principal)
            updateDisplayedTransactions(allTransactions, page, selectedType, pageSize);
        } else if (!principalId && rawTransactions.length > 0) {
            // For ledger transactions (all transactions) - filter client-side
            let filteredTxs = rawTransactions;

            // Apply type filter
            if (selectedType !== TransactionType.ALL) {
                filteredTxs = filteredTxs.filter(tx => tx?.kind === selectedType);
            }

            // Apply from/to filters
            if (fromFilter || toFilter) {
                filteredTxs = filteredTxs.filter(tx => {
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
            }

            // Sort transactions
            const sortedTxs = sortTransactions(filteredTxs);
            setDisplayedTransactions(sortedTxs);
        }
    }, [rawTransactions, allTransactions, principalId, page, selectedType, pageSize, sortConfig, fromFilter, toFilter, filterOperator]);

    // Separate effect to re-sort when principal display info changes (only for principal-based sorting)
    useEffect(() => {
        if (displayedTransactions.length > 0 && (sortConfig.key === 'fromAddress' || sortConfig.key === 'toAddress')) {
            const sortedTxs = sortTransactions(displayedTransactions);
            setDisplayedTransactions(sortedTxs);
        }
    }, [principalDisplayInfo, sortConfig.key, sortConfig.direction]);

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
    const sortTransactions = useCallback((transactions) => {
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
                    case 'index':
                        aValue = a.txIndex ?? a.id ?? 0;
                        bValue = b.txIndex ?? b.id ?? 0;
                        return sortConfig.direction === 'asc' 
                            ? aValue - bValue 
                            : bValue - aValue;
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
    }, [sortConfig, principalDisplayInfo]);

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

    // CSV export function for transactions
    const exportTransactionsToCSV = () => {
        if (displayedTransactions.length === 0) {
            alert('No transactions to export');
            return;
        }

        // Define CSV headers
        const headers = [
            'Transaction Index',
            'Type',
            'From Principal',
            'From Name',
            'From Nickname',
            'From Subaccount',
            'To Principal', 
            'To Name',
            'To Nickname',
            'To Subaccount',
            'Amount (E8s)',
            'Amount (Tokens)',
            'Fee (E8s)',
            'Fee (Tokens)',
            'Timestamp',
            'Memo',
            'Created At Timestamp'
        ];

        // Convert transactions to CSV rows
        const csvRows = displayedTransactions.map(tx => {
            const transaction = tx.transaction || tx;
            const txType = transaction.kind || 'unknown';
            const fromPrincipal = getFromPrincipal(tx);
            const toPrincipal = getToPrincipal(tx);
            const amount = getTransactionAmount(tx);
            
            // Get display info for principals
            const fromDisplayInfo = fromPrincipal ? principalDisplayInfo.get(fromPrincipal.toString()) : null;
            const toDisplayInfo = toPrincipal ? principalDisplayInfo.get(toPrincipal.toString()) : null;
            
            // Get subaccounts
            const fromSubaccount = transaction.transfer?.[0]?.from?.subaccount?.[0] || 
                                 transaction.burn?.[0]?.from?.subaccount?.[0] || 
                                 transaction.approve?.[0]?.from?.subaccount?.[0];
            const toSubaccount = transaction.transfer?.[0]?.to?.subaccount?.[0] || 
                               transaction.mint?.[0]?.to?.subaccount?.[0] || 
                               transaction.approve?.[0]?.spender?.subaccount?.[0];
            
            // Get fee
            const fee = transaction.transfer?.[0]?.fee?.[0] || 
                       transaction.approve?.[0]?.fee?.[0] || 0n;
            
            // Get memo
            const memo = transaction.transfer?.[0]?.memo?.[0] || 
                        transaction.mint?.[0]?.memo?.[0] || 
                        transaction.burn?.[0]?.memo?.[0] || 
                        transaction.approve?.[0]?.memo?.[0] || '';
            
            // Get timestamp
            const timestamp = tx.timestamp || transaction.timestamp || '';
            const createdAtTime = transaction.created_at_time?.[0] || '';
            
            // Format timestamps
            const formattedTimestamp = timestamp ? formatTimestamp(timestamp) : '';
            const formattedCreatedAt = createdAtTime ? formatTimestamp(createdAtTime) : '';
            
            return [
                tx.id || '',
                txType,
                fromPrincipal ? fromPrincipal.toString() : '',
                fromDisplayInfo?.name || '',
                fromDisplayInfo?.nickname || '',
                fromSubaccount ? subaccountToHex(fromSubaccount) : '',
                toPrincipal ? toPrincipal.toString() : '',
                toDisplayInfo?.name || '',
                toDisplayInfo?.nickname || '',
                toSubaccount ? subaccountToHex(toSubaccount) : '',
                amount.toString(),
                formatAmount(amount),
                fee.toString(),
                formatAmount(fee),
                formattedTimestamp,
                Array.isArray(memo) ? memo.join('') : memo,
                formattedCreatedAt
            ];
        });

        // Create CSV content
        const csvContent = [
            headers.join(','),
            ...csvRows.map(row => 
                row.map(cell => {
                    // Escape cells that contain commas, quotes, or newlines
                    const cellStr = String(cell);
                    if (cellStr.includes(',') || cellStr.includes('"') || cellStr.includes('\n')) {
                        return `"${cellStr.replace(/"/g, '""')}"`;
                    }
                    return cellStr;
                }).join(',')
            )
        ].join('\n');

        // Create and download file
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        
        // Create filename with timestamp and filter info
        const timestamp = new Date().toISOString().slice(0, 19).replace(/[:.]/g, '-');
        const typeFilter = selectedType !== TransactionType.ALL ? `_${selectedType}` : '';
        const principalFilter = (fromFilter || toFilter) ? '_filtered' : '';
        const principalSuffix = principalId ? `_${principalId.slice(0, 8)}` : '';
        const filename = `transactions_${snsRootCanisterId}_${timestamp}${typeFilter}${principalFilter}${principalSuffix}.csv`;
        
        link.setAttribute('download', filename);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
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

        // Calculate correct transaction ID (same logic as table view)
        const txId = !principalId ? (tx.txIndex ?? startTxIndex + index) : (tx.id || index);
        
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
                    <Link 
                        to={`/transaction?sns=${snsRootCanisterId}&id=${txId}${ledgerCanisterId ? `&ledger=${ledgerCanisterId.toString()}` : ''}`}
                        style={{
                            color: '#3498db',
                            textDecoration: 'none',
                            fontSize: '12px',
                            ':hover': {
                                textDecoration: 'underline'
                            }
                        }}
                    >
                        #{txId}
                    </Link>
                </div>
                
                {fromPrincipal && (
                    <div style={styles.cardField}>
                        <div style={styles.cardLabel}>From</div>
                        <div style={styles.cardValue}>
                            <PrincipalDisplay 
                                principal={fromPrincipal}
                                displayInfo={principalDisplayInfo.get(fromPrincipal?.toString?.() || '')}
                                showCopyButton={false}
                                short={true}
                                isAuthenticated={isAuthenticated}
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
                                short={true}
                                isAuthenticated={isAuthenticated}
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
            
            {/* Filters - Only when expanded */}
            {!isCollapsed && (
                <div style={styles.filtersContainer}>
                    {/* First Row: Go to TX Index (if in ledger mode) */}
                    {!principalId && (
                        <div style={styles.filtersRow}>
                            <form 
                                onSubmit={handleTxIndexSubmit}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '8px'
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
                                        backgroundColor: theme.colors.accent,
                                        color: theme.colors.primaryText,
                                        border: 'none',
                                        borderRadius: '4px',
                                        padding: '8px 12px',
                                        cursor: 'pointer'
                                    }}
                                >
                                    Go
                                </button>
                            </form>
                        </div>
                    )}
                    
                    {/* Second Row: Principal Filters */}
                    <div style={styles.filtersRow} className="transaction-filters-row">
                        <div style={styles.filterGroup} className="transaction-filter-group">
                            <span style={styles.filterLabel}>From:</span>
                            <PrincipalInput
                                value={fromFilter}
                                onChange={(value) => {
                                    setFromFilter(value);
                                }}
                                placeholder="Filter by sender"
                            />
                        </div>
                        
                        <div style={styles.compactFilterGroup} className="transaction-compact-filter-group">
                            <span style={styles.filterLabel}>Operator:</span>
                            <select
                                value={filterOperator}
                                onChange={(e) => {
                                    setFilterOperator(e.target.value);
                                }}
                                style={styles.filterSelect}
                            >
                                <option value="and">AND</option>
                                <option value="or">OR</option>
                            </select>
                        </div>
                        
                        <div style={styles.filterGroup} className="transaction-filter-group">
                            <span style={styles.filterLabel}>To:</span>
                            <PrincipalInput
                                value={toFilter}
                                onChange={(value) => {
                                    setToFilter(value);
                                }}
                                placeholder="Filter by recipient"
                            />
                        </div>
                        
                        <div style={styles.compactFilterGroup} className="transaction-compact-filter-group">
                            <span style={styles.filterLabel}>Type:</span>
                            <select
                                value={selectedType}
                                onChange={(e) => {
                                    setSelectedType(e.target.value);
                                }}
                                style={styles.filterSelect}
                            >
                                {Object.values(TransactionType).map(type => (
                                    <option key={type} value={type}>
                                        {type.charAt(0).toUpperCase() + type.slice(1)}
                                    </option>
                                ))}
                            </select>
                        </div>
                        
                        <div style={styles.compactFilterGroup} className="transaction-compact-filter-group">
                            <button
                                onClick={exportTransactionsToCSV}
                                style={{
                                    backgroundColor: theme.colors.accent,
                                    color: theme.colors.primaryText,
                                    border: 'none',
                                    borderRadius: '4px',
                                    padding: '8px 12px',
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '6px',
                                    fontSize: '14px'
                                }}
                                disabled={loading || displayedTransactions.length === 0}
                                title={`Export ${displayedTransactions.length} transactions to CSV`}
                            >
                                <span style={{ fontSize: '14px' }}>📄</span>
                                Export CSV
                            </button>
                        </div>
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
                                <th 
                                    style={{...styles.th, width: '10%'}}
                                    onClick={() => handleSort('index')}
                                >
                                    <div style={styles.sortableHeader}>
                                        ID
                                        <span style={styles.sortIcon}>{renderSortIndicator('index')}</span>
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
                                                to={`/transaction?sns=${snsRootCanisterId}&id=${!principalId ? (tx.txIndex ?? startTxIndex + index) : (tx.id || index)}${ledgerCanisterId ? `&ledger=${ledgerCanisterId.toString()}` : ''}`}
                                                style={{
                                                    color: '#3498db',
                                                    textDecoration: 'none',
                                                    ':hover': {
                                                        textDecoration: 'underline'
                                                    }
                                                }}
                                            >
                                                #{!principalId ? (tx.txIndex ?? startTxIndex + index) : (tx.id.toString() || index)}
                                            </Link>
                                        </td>
                                        <td style={{...styles.td, ...styles.principalCell}}>
                                            <div>
                                                <span style={{color: '#888'}}>From: </span>
                                                {fromPrincipal ? (
                                                    <>
                                                        <PrincipalDisplay 
                                                            principal={fromPrincipal}
                                                            displayInfo={principalDisplayInfo.get(fromPrincipal?.toString?.() || '')}
                                                            showCopyButton={false}
                                                            short={true}
                                                            isAuthenticated={isAuthenticated}
                                                        />
                                                        {(txType === 'transfer' && transaction.transfer?.[0]?.from?.subaccount?.length > 0) && (
                                                            <div style={styles.subaccount}>
                                                                Subaccount: {subaccountToHex(transaction.transfer[0].from.subaccount[0])}
                                                            </div>
                                                        )}
                                                        {(txType === 'burn' && transaction.burn?.[0]?.from?.subaccount?.length > 0) && (
                                                            <div style={styles.subaccount}>
                                                                Subaccount: {subaccountToHex(transaction.burn[0].from.subaccount[0])}
                                                            </div>
                                                        )}
                                                        {(txType === 'approve' && transaction.approve?.[0]?.from?.subaccount?.length > 0) && (
                                                            <div style={styles.subaccount}>
                                                                Subaccount: {subaccountToHex(transaction.approve[0].from.subaccount[0])}
                                                            </div>
                                                        )}
                                                    </>
                                                ) : (
                                                    <span style={{color: '#888'}}>-</span>
                                                )}
                                            </div>
                                            <div style={{marginTop: '8px'}}>
                                                <span style={{color: '#888'}}>To: </span>
                                                {toPrincipal ? (
                                                    <>
                                                        <PrincipalDisplay 
                                                            principal={toPrincipal}
                                                            displayInfo={principalDisplayInfo.get(toPrincipal?.toString?.() || '')}
                                                            showCopyButton={false}
                                                            short={true}
                                                            isAuthenticated={isAuthenticated}
                                                        />
                                                        {(txType === 'transfer' && transaction.transfer?.[0]?.to?.subaccount?.length > 0) && (
                                                            <div style={styles.subaccount}>
                                                                Subaccount: {subaccountToHex(transaction.transfer[0].to.subaccount[0])}
                                                            </div>
                                                        )}
                                                        {(txType === 'mint' && transaction.mint?.[0]?.to?.subaccount?.length > 0) && (
                                                            <div style={styles.subaccount}>
                                                                Subaccount: {subaccountToHex(transaction.mint[0].to.subaccount[0])}
                                                            </div>
                                                        )}
                                                        {(txType === 'approve' && transaction.approve?.[0]?.spender?.subaccount?.length > 0) && (
                                                            <div style={styles.subaccount}>
                                                                Subaccount: {subaccountToHex(transaction.approve[0].spender.subaccount[0])}
                                                            </div>
                                                        )}
                                                    </>
                                                ) : (
                                                    <span style={{color: '#888'}}>-</span>
                                                )}
                                            </div>
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