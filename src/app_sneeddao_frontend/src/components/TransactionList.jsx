import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Principal } from '@dfinity/principal';
import { decodeIcrcAccount } from '@dfinity/ledger-icrc';
import { createActor as createSnsRootActor } from 'external/sns_root';
import { createActor as createSnsArchiveActor } from 'external/sns_archive';
import { createActor as createSnsLedgerActor } from 'external/icrc1_ledger';
import { createActor as createSnsIndexActor } from 'external/sns_index';
import { PrincipalDisplay, getPrincipalDisplayInfoFromContext } from '../utils/PrincipalUtils';
import { useAuth } from '../AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { useNaming } from '../NamingContext';
import PrincipalInput from './PrincipalInput';
import { Link, useNavigate } from 'react-router-dom';
import { useSearchParams } from 'react-router-dom';
import { subaccountToHex } from '../utils/StringUtils';
import { getRelativeTime, getFullDate } from '../utils/DateUtils';
import { FaExchangeAlt, FaCoins, FaFire, FaCheckCircle, FaSearch, FaFilter, FaDownload, FaChevronLeft, FaChevronRight, FaArrowUp, FaArrowDown, FaSort, FaWallet, FaTimes, FaCopy } from 'react-icons/fa';
import { encodeIcrcAccount } from '@dfinity/ledger-icrc';

// Helper to parse ICRC-1 account from filter string (returns { principal, subaccount } or null)
const parseFilterAsAccount = (filter) => {
    if (!filter || typeof filter !== 'string') return null;
    const trimmed = filter.trim();
    if (!trimmed) return null;
    
    // Try to parse as ICRC-1 extended account format (contains '.')
    if (trimmed.includes('.')) {
        try {
            const decoded = decodeIcrcAccount(trimmed);
            if (decoded && decoded.owner) {
                return {
                    principal: decoded.owner,
                    subaccount: decoded.subaccount ? new Uint8Array(decoded.subaccount) : null
                };
            }
        } catch (e) {
            // Not a valid ICRC account, fall through
        }
    }
    
    // Try to parse as plain principal
    try {
        const principal = Principal.fromText(trimmed);
        return { principal, subaccount: null };
    } catch (e) {
        return null;
    }
};

// Helper to compare subaccounts (Uint8Arrays)
const subaccountsEqual = (sub1, sub2) => {
    if (!sub1 && !sub2) return true;
    if (!sub1 || !sub2) return false;
    if (sub1.length !== sub2.length) return false;
    for (let i = 0; i < sub1.length; i++) {
        if (sub1[i] !== sub2[i]) return false;
    }
    return true;
};

const PAGE_SIZES = [10, 20, 50, 100];
const FETCH_SIZE = 100;

const TransactionType = {
    ALL: 'all',
    TRANSFER: 'transfer',
    MINT: 'mint',
    BURN: 'burn',
    APPROVE: 'approve'
};

// Accent colors
const txPrimary = '#6366f1';
const txSecondary = '#8b5cf6';
const txAccent = '#06b6d4';

// Transaction type colors and icons
const getTypeInfo = (type) => {
    const types = {
        transfer: { color: txPrimary, bg: `${txPrimary}20`, icon: <FaExchangeAlt size={12} />, label: 'Transfer' },
        mint: { color: '#10b981', bg: 'rgba(16, 185, 129, 0.2)', icon: <FaCoins size={12} />, label: 'Mint' },
        burn: { color: '#ef4444', bg: 'rgba(239, 68, 68, 0.2)', icon: <FaFire size={12} />, label: 'Burn' },
        approve: { color: txAccent, bg: `${txAccent}20`, icon: <FaCheckCircle size={12} />, label: 'Approve' }
    };
    return types[type?.toLowerCase()] || { color: '#6b7280', bg: 'rgba(107, 114, 128, 0.2)', icon: null, label: type || 'Unknown' };
};

function TransactionList({ 
    snsRootCanisterId, 
    ledgerCanisterId: providedLedgerCanisterId = null, 
    principalId = null,
    subaccount = null, // Optional subaccount as Uint8Array or array of bytes - used with principalId for account-specific transactions
    showSubaccountFilter = false, // If true, show dropdown to filter by subaccount (fetches available subaccounts)
    initialSubaccountFilter = null, // Optional initial subaccount for the filter (as Uint8Array or hex string)
    isCollapsed = false, 
    onToggleCollapse = () => {},
    showHeader = true,
    embedded = false,
    headerIcon = null // Optional custom icon to override the default FaExchangeAlt
}) {
    const { theme } = useTheme();
    const { identity, isAuthenticated } = useAuth();
    const { principalNames, principalNicknames } = useNaming();
    const [searchParams, setSearchParams] = useSearchParams();
    const navigate = useNavigate();
    const [rawTransactions, setRawTransactions] = useState([]);
    const [allTransactions, setAllTransactions] = useState([]);
    const [displayedTransactions, setDisplayedTransactions] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [page, setPage] = useState(0);
    const [pageSize, setPageSize] = useState(PAGE_SIZES[0]);
    const [selectedType, setSelectedType] = useState(TransactionType.ALL);
    const [ledgerCanisterId, setLedgerCanisterId] = useState(null);
    const [indexCanisterId, setIndexCanisterId] = useState(null);
    const [principalDisplayInfo, setPrincipalDisplayInfo] = useState(new Map());
    const [sortConfig, setSortConfig] = useState({ key: 'index', direction: embedded ? 'desc' : 'asc' }); // Newest first when embedded, oldest first on dedicated page
    const [fromFilter, setFromFilter] = useState('');
    const [toFilter, setToFilter] = useState('');
    const [filterOperator, setFilterOperator] = useState('and');
    const [totalTransactions, setTotalTransactions] = useState(0);
    // Subaccount filter state - initialize from prop if provided
    const [availableSubaccounts, setAvailableSubaccounts] = useState([]);
    const [selectedSubaccount, setSelectedSubaccount] = useState(() => {
        if (!initialSubaccountFilter) return null;
        // If it's already a Uint8Array, use it directly
        if (initialSubaccountFilter instanceof Uint8Array) return initialSubaccountFilter;
        // If it's a hex string, convert it
        if (typeof initialSubaccountFilter === 'string') {
            try {
                const cleanHex = initialSubaccountFilter.replace(/^0x/i, '').replace(/\s/g, '');
                if (cleanHex.length > 0 && cleanHex.length <= 64) {
                    const paddedHex = cleanHex.padStart(64, '0');
                    return new Uint8Array(paddedHex.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
                }
            } catch (e) {
                console.warn('Invalid initialSubaccountFilter:', e);
            }
        }
        return null;
    });
    const [loadingSubaccounts, setLoadingSubaccounts] = useState(false);
    const [subaccountInput, setSubaccountInput] = useState(() => {
        if (!initialSubaccountFilter) return '';
        if (initialSubaccountFilter instanceof Uint8Array) return subaccountToHex(initialSubaccountFilter);
        if (typeof initialSubaccountFilter === 'string') {
            const cleanHex = initialSubaccountFilter.replace(/^0x/i, '').replace(/\s/g, '');
            if (cleanHex.length > 0 && cleanHex.length <= 64) {
                return cleanHex.padStart(64, '0');
            }
        }
        return '';
    }); // Text input for combo-box
    const [showSubaccountDropdown, setShowSubaccountDropdown] = useState(false);
    const subaccountInputRef = useRef(null);
    const subaccountDropdownRef = useRef(null);
    const [copiedSubaccount, setCopiedSubaccount] = useState(null); // Track which subaccount was just copied
    
    // Helper to copy subaccount to clipboard
    const copySubaccount = async (subaccountBytes, identifier) => {
        try {
            const hex = subaccountToHex(subaccountBytes);
            await navigator.clipboard.writeText(hex);
            setCopiedSubaccount(identifier);
            setTimeout(() => setCopiedSubaccount(null), 2000);
        } catch (err) {
            console.error('Failed to copy subaccount:', err);
        }
    };
    
    // Helper to copy full ICRC-1 account (principal + subaccount) to clipboard
    const copyIcrc1Account = async (principal, subaccountBytes) => {
        try {
            const account = encodeIcrcAccount({
                owner: principal,
                subaccount: subaccountBytes
            });
            await navigator.clipboard.writeText(account);
            return true;
        } catch (err) {
            console.error('Failed to copy ICRC-1 account:', err);
            return false;
        }
    };
    
    // Only read from URL params if not embedded - embedded components shouldn't use URL state
    const [startTxIndex, setStartTxIndex] = useState(() => {
        if (embedded) return 0;
        const urlStart = searchParams.get('start');
        return urlStart ? parseInt(urlStart) : 0;
    });
    const [txIndexInput, setTxIndexInput] = useState(() => {
        if (embedded) return '';
        const urlStart = searchParams.get('start');
        return urlStart ? urlStart : '';
    });
    const [hoveredRow, setHoveredRow] = useState(null);

    // Responsive CSS
    React.useEffect(() => {
        const mediaQueryCSS = `
            <style id="transaction-responsive-css">
                /* Default: show table, hide cards (desktop-first) */
                .transaction-table-container { display: block; }
                .transaction-cards-container { display: none; }
                
                /* Mobile: show cards, hide table */
                @media (max-width: 640px) {
                    .transaction-table-container { display: none !important; }
                    .transaction-cards-container { display: block !important; }
                    .transaction-filters-row {
                        flex-direction: column !important;
                        align-items: stretch !important;
                        gap: 0.75rem !important;
                    }
                    .transaction-filter-group {
                        min-width: 100% !important;
                        flex: 1 1 100% !important;
                        max-width: none !important;
                    }
                }
            </style>
        `;
        
        const existingStyle = document.getElementById('transaction-responsive-css');
        if (existingStyle) existingStyle.remove();
        document.head.insertAdjacentHTML('beforeend', mediaQueryCSS);
        
        return () => {
            const style = document.getElementById('transaction-responsive-css');
            if (style) style.remove();
        };
    }, []);

    // Click outside handler for subaccount dropdown
    useEffect(() => {
        const handleClickOutside = (event) => {
            if (subaccountDropdownRef.current && !subaccountDropdownRef.current.contains(event.target)) {
                setShowSubaccountDropdown(false);
            }
        };
        
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // URL sync effects - only when not embedded
    useEffect(() => {
        // Skip URL sync when embedded - embedded components manage their own state
        if (embedded) return;
        
        const urlStart = searchParams.get('start');
        if (urlStart) {
            const startIndex = parseInt(urlStart);
            setStartTxIndex(startIndex);
            setPage(Math.floor(startIndex / pageSize));
            const inputElement = document.querySelector('input[placeholder="Jump to index..."]');
            if (!inputElement || inputElement !== document.activeElement) {
                setTxIndexInput(startIndex.toString());
            }
        } else if (startTxIndex === 0) {
            setTxIndexInput('');
        }
    }, [searchParams, pageSize, embedded]);

    useEffect(() => {
        // Skip URL sync when embedded - embedded components shouldn't modify URL
        if (embedded) return;
        
        if (!principalId) {
            const newStart = page * pageSize;
            const currentUrlStart = searchParams.get('start');
            const currentUrlStartNum = currentUrlStart ? parseInt(currentUrlStart) : 0;
            
            if (newStart !== currentUrlStartNum && newStart === startTxIndex) {
                setSearchParams(prev => {
                    const newParams = new URLSearchParams(prev);
                    newParams.set('start', newStart.toString());
                    return newParams;
                }, { replace: true });
            }
            
            if (newStart !== startTxIndex) {
                setStartTxIndex(newStart);
            }
        }
    }, [page, pageSize, startTxIndex, principalId, searchParams, setSearchParams, embedded]);

    const handleTxIndexSubmit = (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        const index = parseInt(txIndexInput);
        if (!isNaN(index) && index >= 0) {
            const newPage = Math.floor(index / pageSize);
            setPage(newPage);
            setStartTxIndex(index);
            
            // Only update URL params if not embedded
            if (!embedded) {
                const currentStart = searchParams.get('start');
                if (currentStart !== index.toString()) {
                    setSearchParams(prev => {
                        const newParams = new URLSearchParams(prev);
                        newParams.set('start', index.toString());
                        return newParams;
                    }, { replace: true });
                }
            }
        }
    };

    // Fetch functions
    const fetchCanisterIds = async () => {
        try {
            if (providedLedgerCanisterId) {
                setLedgerCanisterId(providedLedgerCanisterId);
                if (snsRootCanisterId) {
                    try {
                        const snsRootActor = createSnsRootActor(snsRootCanisterId);
                        const response = await snsRootActor.list_sns_canisters({});
                        setIndexCanisterId(response.index[0]);
                    } catch (err) {
                        console.warn('Failed to fetch index canister:', err);
                        // Still have ledger, so continue without index
                    }
                }
                return;
            }

            const snsRootActor = createSnsRootActor(snsRootCanisterId);
            const response = await snsRootActor.list_sns_canisters({});
            setLedgerCanisterId(response.ledger[0]);
            setIndexCanisterId(response.index[0]);
        } catch (err) {
            setError('Failed to fetch canister IDs');
            setLoading(false);
            console.error('Error fetching canister IDs:', err);
        }
    };

    // Fetch available subaccounts for the principal
    const fetchAvailableSubaccounts = async () => {
        if (!indexCanisterId || !principalId || !showSubaccountFilter) return;
        
        setLoadingSubaccounts(true);
        try {
            const indexActor = createSnsIndexActor(indexCanisterId);
            const subaccounts = await indexActor.list_subaccounts({
                owner: Principal.fromText(principalId),
                start: []
            });
            // Convert blobs to Uint8Arrays and filter out empty subaccounts
            const validSubaccounts = subaccounts
                .map(sub => new Uint8Array(sub))
                .filter(sub => sub.some(byte => byte !== 0)); // Filter out all-zero subaccounts
            setAvailableSubaccounts(validSubaccounts);
        } catch (err) {
            console.warn('Failed to fetch subaccounts:', err);
            setAvailableSubaccounts([]);
        } finally {
            setLoadingSubaccounts(false);
        }
    };

    const fetchLedgerTransactions = async () => {
        if (!ledgerCanisterId) return;

        setLoading(true);
        setError(null);

        try {
            const ledgerActor = createSnsLedgerActor(ledgerCanisterId, { agentOptions: { identity } });
            const startIndex = page * pageSize;

            const response = await ledgerActor.get_transactions({
                start: BigInt(startIndex),
                length: BigInt(pageSize)
            });

            let txs = response.transactions.map((tx, idx) => ({
                ...tx,
                txIndex: startIndex + idx
            }));
            setTotalTransactions(Number(response.log_length));

            if (response.archived_transactions.length > 0) {
                for (const archive of response.archived_transactions) {
                    try {
                        const archiveCanisterId = archive.callback[0].toText();
                        const archiveActor = createSnsArchiveActor(archiveCanisterId, { agentOptions: { identity } });
                        
                        const archiveResponse = await archiveActor.get_transactions({
                            start: archive.start,
                            length: archive.length
                        });

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

            setRawTransactions(txs);
        } catch (err) {
            setError('Failed to fetch transactions');
            console.error('Error fetching transactions:', err);
        } finally {
            setLoading(false);
        }
    };

    const fetchAllFromIndex = async () => {
        setLoading(true);
        setError(null);
        
        try {
            const indexActor = createSnsIndexActor(indexCanisterId);
            // Determine which subaccount to use:
            // - If showSubaccountFilter is enabled and a subaccount is selected, use that
            // - Otherwise, use the prop subaccount (for neuron transactions etc.)
            const effectiveSubaccount = showSubaccountFilter ? selectedSubaccount : subaccount;
            
            // Build account with optional subaccount
            const account = {
                owner: Principal.fromText(principalId),
                subaccount: effectiveSubaccount ? [Array.from(effectiveSubaccount)] : []
            };
            
            let allTxs = [];
            let startIndex = 0;
            let hasMore = true;

            while (hasMore) {
                const response = await indexActor.get_account_transactions({
                    account,
                    max_results: FETCH_SIZE,
                    start: startIndex > 0 ? [BigInt(startIndex)] : []
                });

                if (!response.Ok) {
                    throw new Error(response.Err.message);
                }

                const transactions = response.Ok.transactions.map(tx => ({
                    ...tx,
                    // Ensure id is consistently available as a number
                    txId: tx.id !== undefined ? Number(tx.id) : undefined
                }));
                allTxs = [...allTxs, ...transactions];
                
                if (transactions.length < FETCH_SIZE) {
                    hasMore = false;
                } else {
                    startIndex += FETCH_SIZE;
                }
            }

            setAllTransactions(allTxs);
            setTotalTransactions(allTxs.length);
        } catch (err) {
            setError('Failed to fetch transactions from index');
            console.error('Error fetching from index:', err);
        } finally {
            setLoading(false);
        }
    };

    // Helper functions
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

    // Get subaccount from transaction's "from" account
    const getFromSubaccount = (tx) => {
        const transaction = tx.transaction || tx;
        if (transaction.transfer?.[0]?.from?.subaccount?.[0]) {
            return new Uint8Array(transaction.transfer[0].from.subaccount[0]);
        }
        if (transaction.burn?.[0]?.from?.subaccount?.[0]) {
            return new Uint8Array(transaction.burn[0].from.subaccount[0]);
        }
        if (transaction.approve?.[0]?.from?.subaccount?.[0]) {
            return new Uint8Array(transaction.approve[0].from.subaccount[0]);
        }
        return null;
    };

    // Get subaccount from transaction's "to" account
    const getToSubaccount = (tx) => {
        const transaction = tx.transaction || tx;
        if (transaction.transfer?.[0]?.to?.subaccount?.[0]) {
            return new Uint8Array(transaction.transfer[0].to.subaccount[0]);
        }
        if (transaction.mint?.[0]?.to?.subaccount?.[0]) {
            return new Uint8Array(transaction.mint[0].to.subaccount[0]);
        }
        if (transaction.approve?.[0]?.spender?.subaccount?.[0]) {
            return new Uint8Array(transaction.approve[0].spender.subaccount[0]);
        }
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

    // Enhanced filter matching - supports ICRC-1 account strings with subaccounts
    const matchesPrincipalFilter = (principal, txSubaccount, filter, displayInfo) => {
        if (!filter) return true;
        if (!principal) return false;

        const filterLower = filter.toLowerCase();
        const principalStr = principal.toString().toLowerCase();

        // First, try to parse the filter as an ICRC-1 account (may include subaccount)
        const parsedAccount = parseFilterAsAccount(filter);
        if (parsedAccount) {
            // Filter is a valid account - match both principal and subaccount
            const principalMatches = principal.toString() === parsedAccount.principal.toString();
            if (parsedAccount.subaccount) {
                // Filter includes a subaccount - must match both
                return principalMatches && subaccountsEqual(txSubaccount, parsedAccount.subaccount);
            }
            // Filter is just a principal - match if principal matches (any subaccount)
            if (principalMatches) return true;
        }

        // Fall back to string matching (partial match support)
        if (principalStr.includes(filterLower)) return true;

        if (displayInfo) {
            const name = Array.isArray(displayInfo.name) ? displayInfo.name[0] : displayInfo.name;
            if (name && typeof name === 'string' && name.toLowerCase().includes(filterLower)) return true;

            const nickname = Array.isArray(displayInfo.nickname) ? displayInfo.nickname[0] : displayInfo.nickname;
            if (nickname && typeof nickname === 'string' && nickname.toLowerCase().includes(filterLower)) return true;
        }

        return false;
    };

    const getPrincipalSortValue = (principal) => {
        if (!principal || typeof principal.toString !== 'function') return '';
        try {
            const principalStr = principal.toString();
            const displayInfo = principalDisplayInfo.get(principalStr);
            if (!displayInfo) return principalStr;
            if (displayInfo.name) return displayInfo.name;
            if (displayInfo.nickname) return displayInfo.nickname;
            return principalStr;
        } catch (error) {
            return '';
        }
    };

    const sortTransactions = useCallback((transactions) => {
        if (!sortConfig.key) return transactions;

        return [...transactions].sort((a, b) => {
            if (!a || !b) return 0;

            let aValue, bValue;

            try {
                switch (sortConfig.key) {
                    case 'index':
                        aValue = a.txIndex ?? a.id ?? 0n;
                        bValue = b.txIndex ?? b.id ?? 0n;
                        return sortConfig.direction === 'asc' 
                            ? (aValue < bValue ? -1 : aValue > bValue ? 1 : 0)
                            : (bValue < aValue ? -1 : bValue > aValue ? 1 : 0);
                    case 'type':
                        aValue = a.kind || '';
                        bValue = b.kind || '';
                        break;
                    case 'fromAddress':
                        aValue = getFromPrincipal(a) ? getPrincipalSortValue(getFromPrincipal(a)) : '';
                        bValue = getFromPrincipal(b) ? getPrincipalSortValue(getFromPrincipal(b)) : '';
                        break;
                    case 'toAddress':
                        aValue = getToPrincipal(a) ? getPrincipalSortValue(getToPrincipal(a)) : '';
                        bValue = getToPrincipal(b) ? getPrincipalSortValue(getToPrincipal(b)) : '';
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
                        return sortConfig.direction === 'asc' ? aValue - bValue : bValue - aValue;
                    default:
                        return 0;
                }

                if (aValue < bValue) return sortConfig.direction === 'asc' ? -1 : 1;
                if (aValue > bValue) return sortConfig.direction === 'asc' ? 1 : -1;
                return 0;
            } catch (error) {
                return 0;
            }
        });
    }, [sortConfig, principalDisplayInfo]);

    const handleSort = (key) => {
        setSortConfig(prevConfig => ({
            key,
            direction: prevConfig.key === key && prevConfig.direction === 'asc' ? 'desc' : 'asc'
        }));
    };

    const renderSortIcon = (key) => {
        if (sortConfig.key !== key) return <FaSort size={10} style={{ opacity: 0.4 }} />;
        return sortConfig.direction === 'asc' ? <FaArrowUp size={10} /> : <FaArrowDown size={10} />;
    };

    // CSV Export
    const exportTransactionsToCSV = () => {
        if (displayedTransactions.length === 0) {
            alert('No transactions to export');
            return;
        }

        const headers = [
            'Transaction Index', 'Type', 'From Principal', 'From Name', 'From Nickname', 'From Subaccount',
            'To Principal', 'To Name', 'To Nickname', 'To Subaccount', 'Amount (E8s)', 'Amount (Tokens)',
            'Fee (E8s)', 'Fee (Tokens)', 'Timestamp', 'Memo', 'Created At Timestamp'
        ];

        const csvRows = displayedTransactions.map(tx => {
            const transaction = tx.transaction || tx;
            const txType = transaction.kind || 'unknown';
            const fromPrincipal = getFromPrincipal(tx);
            const toPrincipal = getToPrincipal(tx);
            const amount = getTransactionAmount(tx);
            
            const fromDisplayInfo = fromPrincipal ? principalDisplayInfo.get(fromPrincipal.toString()) : null;
            const toDisplayInfo = toPrincipal ? principalDisplayInfo.get(toPrincipal.toString()) : null;
            
            const fromSubaccount = transaction.transfer?.[0]?.from?.subaccount?.[0] || 
                                 transaction.burn?.[0]?.from?.subaccount?.[0] || 
                                 transaction.approve?.[0]?.from?.subaccount?.[0];
            const toSubaccount = transaction.transfer?.[0]?.to?.subaccount?.[0] || 
                               transaction.mint?.[0]?.to?.subaccount?.[0] || 
                               transaction.approve?.[0]?.spender?.subaccount?.[0];
            
            const fee = transaction.transfer?.[0]?.fee?.[0] || transaction.approve?.[0]?.fee?.[0] || 0n;
            const memo = transaction.transfer?.[0]?.memo?.[0] || transaction.mint?.[0]?.memo?.[0] || 
                        transaction.burn?.[0]?.memo?.[0] || transaction.approve?.[0]?.memo?.[0] || '';
            const timestamp = tx.timestamp || transaction.timestamp || '';
            const createdAtTime = transaction.created_at_time?.[0] || '';
            
            return [
                tx.id || '', txType, fromPrincipal ? fromPrincipal.toString() : '',
                fromDisplayInfo?.name || '', fromDisplayInfo?.nickname || '',
                fromSubaccount ? subaccountToHex(fromSubaccount) : '',
                toPrincipal ? toPrincipal.toString() : '', toDisplayInfo?.name || '', toDisplayInfo?.nickname || '',
                toSubaccount ? subaccountToHex(toSubaccount) : '', amount.toString(), formatAmount(amount),
                fee.toString(), formatAmount(fee), timestamp ? formatTimestamp(timestamp) : '',
                Array.isArray(memo) ? memo.join('') : memo, createdAtTime ? formatTimestamp(createdAtTime) : ''
            ];
        });

        const csvContent = [
            headers.join(','),
            ...csvRows.map(row => row.map(cell => {
                const cellStr = String(cell);
                if (cellStr.includes(',') || cellStr.includes('"') || cellStr.includes('\n')) {
                    return `"${cellStr.replace(/"/g, '""')}"`;
                }
                return cellStr;
            }).join(','))
        ].join('\n');

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        
        const timestamp = new Date().toISOString().slice(0, 19).replace(/[:.]/g, '-');
        const filename = `transactions_${timestamp}.csv`;
        
        link.setAttribute('download', filename);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    };

    // Effects
    useEffect(() => {
        fetchCanisterIds();
    }, [snsRootCanisterId, providedLedgerCanisterId]);

    // Fetch available subaccounts when index is available and filter is enabled
    useEffect(() => {
        if (indexCanisterId && principalId && showSubaccountFilter) {
            fetchAvailableSubaccounts();
        }
    }, [indexCanisterId, principalId, showSubaccountFilter]);

    useEffect(() => {
        if (!ledgerCanisterId) return;
        
        // If principalId is provided, we need the index canister to fetch principal-specific transactions
        if (principalId) {
            // Wait for indexCanisterId to be available
            if (indexCanisterId) {
                fetchAllFromIndex();
            }
            // If indexCanisterId is not ready yet, don't fetch anything - wait for it
            return;
        }
        
        // No principalId - fetch all transactions from ledger
        fetchLedgerTransactions();
    }, [ledgerCanisterId, indexCanisterId, principalId, subaccount, selectedSubaccount, page, pageSize]);

    useEffect(() => {
        if (principalId && allTransactions.length > 0) {
            let filtered = selectedType === TransactionType.ALL 
                ? allTransactions 
                : allTransactions.filter(tx => tx.transaction?.kind === selectedType);
            
            filtered = filtered.filter(tx => {
                const fromPrincipal = getFromPrincipal(tx);
                const toPrincipal = getToPrincipal(tx);
                const fromSubaccount = getFromSubaccount(tx);
                const toSubaccount = getToSubaccount(tx);
                const fromMatches = matchesPrincipalFilter(fromPrincipal, fromSubaccount, fromFilter, fromPrincipal ? principalDisplayInfo.get(fromPrincipal.toString()) : null);
                const toMatches = matchesPrincipalFilter(toPrincipal, toSubaccount, toFilter, toPrincipal ? principalDisplayInfo.get(toPrincipal.toString()) : null);
                return filterOperator === 'and' ? (fromMatches && toMatches) : (fromMatches || toMatches);
            });

            const sorted = sortTransactions(filtered);
            const start = page * pageSize;
            setDisplayedTransactions(sorted.slice(start, start + pageSize));
            setTotalTransactions(sorted.length);
        } else if (!principalId && rawTransactions.length > 0) {
            let filteredTxs = rawTransactions;

            if (selectedType !== TransactionType.ALL) {
                filteredTxs = filteredTxs.filter(tx => tx?.kind === selectedType);
            }

            if (fromFilter || toFilter) {
                filteredTxs = filteredTxs.filter(tx => {
                    const fromPrincipal = getFromPrincipal(tx);
                    const toPrincipal = getToPrincipal(tx);
                    const fromSubaccount = getFromSubaccount(tx);
                    const toSubaccount = getToSubaccount(tx);
                    const fromMatches = matchesPrincipalFilter(fromPrincipal, fromSubaccount, fromFilter, fromPrincipal ? principalDisplayInfo.get(fromPrincipal.toString()) : null);
                    const toMatches = matchesPrincipalFilter(toPrincipal, toSubaccount, toFilter, toPrincipal ? principalDisplayInfo.get(toPrincipal.toString()) : null);
                    return filterOperator === 'and' ? (fromMatches && toMatches) : (fromMatches || toMatches);
                });
            }

            const sortedTxs = sortTransactions(filteredTxs);
            setDisplayedTransactions(sortedTxs);
        }
    }, [rawTransactions, allTransactions, principalId, page, selectedType, pageSize, sortConfig, fromFilter, toFilter, filterOperator]);

    useEffect(() => {
        if (displayedTransactions.length > 0 && (sortConfig.key === 'fromAddress' || sortConfig.key === 'toAddress')) {
            const sortedTxs = sortTransactions(displayedTransactions);
            setDisplayedTransactions(sortedTxs);
        }
    }, [principalDisplayInfo, sortConfig.key, sortConfig.direction]);

    useEffect(() => {
        const fetchPrincipalInfo = async () => {
            if (!displayedTransactions.length || !principalNames || !principalNicknames) return;

            const uniquePrincipals = new Set();
            displayedTransactions.forEach(tx => {
                const fromPrincipal = getFromPrincipal(tx);
                const toPrincipal = getToPrincipal(tx);
                if (fromPrincipal) try { uniquePrincipals.add(fromPrincipal.toString()); } catch {}
                if (toPrincipal) try { uniquePrincipals.add(toPrincipal.toString()); } catch {}
            });

            const displayInfoMap = new Map();
            Array.from(uniquePrincipals).forEach(principal => {
                try {
                    const displayInfo = getPrincipalDisplayInfoFromContext(Principal.fromText(principal), principalNames, principalNicknames);
                    displayInfoMap.set(principal, displayInfo);
                } catch {}
            });

            setPrincipalDisplayInfo(displayInfoMap);
        };

        fetchPrincipalInfo();
    }, [displayedTransactions, identity, principalNames, principalNicknames]);

    const handlePageSizeChange = (event) => {
        setPageSize(Number(event.target.value));
        setPage(0);
    };

    // Render transaction card for mobile
    const renderTransactionCard = (tx, index) => {
        const transaction = tx.transaction || tx;
        const txType = transaction.kind;
        const fromPrincipal = getFromPrincipal(tx);
        const toPrincipal = getToPrincipal(tx);
        const amount = getTransactionAmount(tx);
        const typeInfo = getTypeInfo(txType);
        const txId = !principalId ? (tx.txIndex ?? startTxIndex + index) : (tx.id || index);
        const txUrl = `/transaction?sns=${snsRootCanisterId}&id=${txId}${ledgerCanisterId ? `&ledger=${ledgerCanisterId.toString()}` : ''}`;
        
        return (
            <div 
                key={index} 
                onClick={() => navigate(txUrl)}
                style={{
                    background: theme.colors.primaryBg,
                    borderRadius: '12px',
                    padding: '1rem',
                    marginBottom: '0.75rem',
                    border: `1px solid ${theme.colors.border}`,
                    transition: 'all 0.2s ease',
                    cursor: 'pointer'
                }}
            >
                <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '0.75rem'
                }}>
                    <span style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                        padding: '4px 10px',
                        borderRadius: '20px',
                        background: typeInfo.bg,
                        color: typeInfo.color,
                        fontSize: '0.8rem',
                        fontWeight: '600'
                    }}>
                        {typeInfo.icon}
                        {typeInfo.label}
                    </span>
                    <Link 
                        to={`/transaction?sns=${snsRootCanisterId}&id=${txId}${ledgerCanisterId ? `&ledger=${ledgerCanisterId.toString()}` : ''}`}
                        style={{
                            color: txPrimary,
                            textDecoration: 'none',
                            fontSize: '0.85rem',
                            fontWeight: '600'
                        }}
                    >
                        #{txId}
                    </Link>
                </div>
                
                {fromPrincipal && (
                    <div style={{ marginBottom: '0.5rem' }}>
                        <div style={{ color: theme.colors.mutedText, fontSize: '0.75rem', marginBottom: '2px' }}>From</div>
                        <PrincipalDisplay 
                            principal={fromPrincipal}
                            displayInfo={principalDisplayInfo.get(fromPrincipal?.toString?.() || '')}
                            showCopyButton={false}
                            short={true}
                            isAuthenticated={isAuthenticated}
                        />
                    </div>
                )}
                
                {toPrincipal && (
                    <div style={{ marginBottom: '0.5rem' }}>
                        <div style={{ color: theme.colors.mutedText, fontSize: '0.75rem', marginBottom: '2px' }}>To</div>
                        <PrincipalDisplay 
                            principal={toPrincipal}
                            displayInfo={principalDisplayInfo.get(toPrincipal?.toString?.() || '')}
                            showCopyButton={false}
                            short={true}
                            isAuthenticated={isAuthenticated}
                        />
                    </div>
                )}
                
                <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    paddingTop: '0.5rem',
                    borderTop: `1px solid ${theme.colors.border}`
                }}>
                    <span style={{ color: theme.colors.primaryText, fontWeight: '600' }}>
                        {amount ? formatAmount(amount) : '-'}
                    </span>
                    <span 
                        style={{ color: theme.colors.mutedText, fontSize: '0.8rem' }}
                        title={formatTimestamp(transaction.timestamp)}
                    >
                        {getRelativeTime(transaction.timestamp)}
                    </span>
                </div>
            </div>
        );
    };

    const containerStyle = embedded ? {
        backgroundColor: 'transparent',
        borderRadius: 0,
        padding: '1.5rem',
        marginTop: 0
    } : {
        backgroundColor: theme.colors.secondaryBg,
        borderRadius: '16px',
        padding: '1.5rem',
        marginTop: '1rem'
    };

    // Loading state
    if (loading) {
        return (
            <div style={containerStyle}>
                <div style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '3rem',
                    color: theme.colors.mutedText
                }}>
                    <div style={{
                        width: '48px',
                        height: '48px',
                        borderRadius: '50%',
                        background: `linear-gradient(135deg, ${txPrimary}30, ${txSecondary}20)`,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        marginBottom: '1rem',
                        animation: 'pulse 2s ease-in-out infinite'
                    }}>
                        <FaExchangeAlt size={20} style={{ color: txPrimary }} />
                    </div>
                    <p style={{ margin: 0 }}>Loading transactions...</p>
                </div>
            </div>
        );
    }

    return (
        <div style={containerStyle}>
            {showHeader && (
                <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '1.5rem',
                    cursor: 'pointer'
                }}
                onClick={onToggleCollapse}
                >
                    <h2 style={{
                        margin: 0,
                        color: theme.colors.primaryText,
                        fontSize: '1.25rem',
                        fontWeight: '600',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.75rem'
                    }}>
                        {headerIcon || (
                            <span style={{
                                width: '32px',
                                height: '32px',
                                borderRadius: '8px',
                                background: `linear-gradient(135deg, ${txPrimary}, ${txSecondary})`,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center'
                            }}>
                                <FaExchangeAlt size={14} color="white" />
                            </span>
                        )}
                        Transactions
                    </h2>
                    <span style={{
                        color: theme.colors.mutedText,
                        transition: 'transform 0.2s',
                        transform: isCollapsed ? 'rotate(-90deg)' : 'rotate(0)'
                    }}>
                        ▼
                    </span>
                </div>
            )}
            
            {!isCollapsed && !error && (
                <>
                    {/* Filters - Redesigned */}
                    <div style={{ marginBottom: '1.5rem' }}>
                        {/* Top toolbar: Type pills + Actions */}
                        <div style={{
                            display: 'flex',
                            flexWrap: 'wrap',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: '1rem',
                            marginBottom: '1rem'
                        }}>
                            {/* Transaction type pills */}
                            <div style={{
                                display: 'flex',
                                gap: '0.5rem',
                                flexWrap: 'wrap',
                                padding: '0.25rem',
                                background: theme.colors.primaryBg,
                                borderRadius: '24px',
                                border: `1px solid ${theme.colors.border}`
                            }}>
                                {Object.values(TransactionType).map(type => {
                                    const typeInfo = type === 'all' 
                                        ? { color: theme.colors.primaryText, bg: theme.colors.secondaryBg, icon: null, label: 'All' }
                                        : getTypeInfo(type);
                                    const isActive = selectedType === type;
                                    
                                    return (
                                        <button
                                            key={type}
                                            onClick={() => setSelectedType(type)}
                                            style={{
                                                display: 'inline-flex',
                                                alignItems: 'center',
                                                gap: '5px',
                                                padding: '6px 14px',
                                                borderRadius: '20px',
                                                border: 'none',
                                                background: isActive ? (type === 'all' ? txPrimary : typeInfo.color) : 'transparent',
                                                color: isActive ? 'white' : theme.colors.mutedText,
                                                fontSize: '0.8rem',
                                                fontWeight: '500',
                                                cursor: 'pointer',
                                                transition: 'all 0.15s ease'
                                            }}
                                        >
                                            {typeInfo.icon}
                                            {typeInfo.label}
                                        </button>
                                    );
                                })}
                            </div>
                            
                            {/* Right side actions */}
                            <div style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.75rem'
                            }}>
                                {/* Jump to index (ledger mode only) */}
                                {!principalId && (
                                    <form onSubmit={handleTxIndexSubmit} style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '0.5rem'
                                    }}>
                                        <span style={{
                                            color: theme.colors.mutedText,
                                            fontSize: '0.8rem',
                                            whiteSpace: 'nowrap'
                                        }}>
                                            Jump to
                                        </span>
                                        <input
                                            type="text"
                                            value={txIndexInput}
                                            onChange={(e) => setTxIndexInput(e.target.value)}
                                            placeholder="index"
                                            style={{
                                                width: '70px',
                                                padding: '0.45rem 0.6rem',
                                                borderRadius: '6px',
                                                border: `1px solid ${theme.colors.border}`,
                                                background: theme.colors.primaryBg,
                                                color: theme.colors.primaryText,
                                                fontSize: '0.85rem',
                                                outline: 'none',
                                                textAlign: 'center'
                                            }}
                                            onFocus={(e) => e.target.style.borderColor = txPrimary}
                                            onBlur={(e) => e.target.style.borderColor = theme.colors.border}
                                        />
                                        <button
                                            type="submit"
                                            style={{
                                                padding: '0.45rem 0.75rem',
                                                borderRadius: '6px',
                                                border: 'none',
                                                background: txPrimary,
                                                color: 'white',
                                                fontSize: '0.8rem',
                                                fontWeight: '600',
                                                cursor: 'pointer',
                                                transition: 'all 0.15s ease'
                                            }}
                                            onMouseEnter={(e) => e.target.style.background = txSecondary}
                                            onMouseLeave={(e) => e.target.style.background = txPrimary}
                                        >
                                            Go
                                        </button>
                                    </form>
                                )}
                                
                                {/* Export button */}
                                <button
                                    onClick={exportTransactionsToCSV}
                                    disabled={displayedTransactions.length === 0}
                                    title={`Export ${displayedTransactions.length} transactions to CSV`}
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '0.4rem',
                                        padding: '0.5rem 0.875rem',
                                        borderRadius: '8px',
                                        border: 'none',
                                        background: `linear-gradient(135deg, ${txPrimary}, ${txSecondary})`,
                                        color: 'white',
                                        fontSize: '0.8rem',
                                        fontWeight: '600',
                                        cursor: displayedTransactions.length === 0 ? 'not-allowed' : 'pointer',
                                        opacity: displayedTransactions.length === 0 ? 0.5 : 1,
                                        boxShadow: displayedTransactions.length === 0 ? 'none' : `0 2px 8px ${txPrimary}40`
                                    }}
                                >
                                    <FaDownload size={11} />
                                    Export
                                </button>
                            </div>
                        </div>
                        
                        {/* Subaccount filter combo-box - only show when enabled */}
                        {showSubaccountFilter && (
                            <div style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.75rem',
                                padding: '0.75rem 1rem',
                                background: theme.colors.primaryBg,
                                borderRadius: '12px',
                                border: `1px solid ${theme.colors.border}`,
                                marginBottom: '0.75rem'
                            }}>
                                <div style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '0.5rem',
                                    color: theme.colors.mutedText,
                                    fontSize: '0.8rem',
                                    fontWeight: '500',
                                    whiteSpace: 'nowrap'
                                }}>
                                    <FaWallet size={12} />
                                    Subaccount
                                </div>
                                <div style={{ position: 'relative', flex: 1, maxWidth: '400px' }} ref={subaccountDropdownRef}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                        <input
                                            ref={subaccountInputRef}
                                            type="text"
                                            value={subaccountInput}
                                            onChange={(e) => {
                                                setSubaccountInput(e.target.value);
                                                setShowSubaccountDropdown(true);
                                            }}
                                            onFocus={() => setShowSubaccountDropdown(true)}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter') {
                                                    e.preventDefault();
                                                    const trimmed = subaccountInput.trim();
                                                    if (!trimmed) {
                                                        setSelectedSubaccount(null);
                                                    } else {
                                                        // Try to parse as hex
                                                        try {
                                                            const cleanHex = trimmed.replace(/^0x/i, '').replace(/\s/g, '');
                                                            if (/^[0-9a-fA-F]+$/.test(cleanHex) && cleanHex.length <= 64) {
                                                                // Pad to 32 bytes (64 hex chars)
                                                                const paddedHex = cleanHex.padStart(64, '0');
                                                                const bytes = new Uint8Array(paddedHex.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
                                                                setSelectedSubaccount(bytes);
                                                            }
                                                        } catch (err) {
                                                            // Invalid hex, ignore
                                                        }
                                                    }
                                                    setShowSubaccountDropdown(false);
                                                    setPage(0);
                                                } else if (e.key === 'Escape') {
                                                    setShowSubaccountDropdown(false);
                                                }
                                            }}
                                            placeholder={loadingSubaccounts ? 'Loading...' : 'All (type to filter or enter hex)'}
                                            style={{
                                                flex: 1,
                                                padding: '0.5rem 0.75rem',
                                                borderRadius: '8px',
                                                border: `1px solid ${showSubaccountDropdown ? txPrimary : theme.colors.border}`,
                                                background: theme.colors.secondaryBg,
                                                color: theme.colors.primaryText,
                                                fontSize: '0.85rem',
                                                outline: 'none',
                                                fontFamily: 'monospace',
                                                transition: 'border-color 0.15s ease'
                                            }}
                                            disabled={loadingSubaccounts}
                                        />
                                        {(selectedSubaccount || subaccountInput) && (
                                            <button
                                                onClick={() => {
                                                    setSelectedSubaccount(null);
                                                    setSubaccountInput('');
                                                    setPage(0);
                                                }}
                                                style={{
                                                    background: 'none',
                                                    border: 'none',
                                                    padding: '4px',
                                                    cursor: 'pointer',
                                                    color: theme.colors.mutedText,
                                                    display: 'flex',
                                                    alignItems: 'center'
                                                }}
                                                title="Clear filter"
                                            >
                                                <FaTimes size={12} />
                                            </button>
                                        )}
                                    </div>
                                    {/* Dropdown suggestions */}
                                    {showSubaccountDropdown && (
                                        <div style={{
                                            position: 'absolute',
                                            top: '100%',
                                            left: 0,
                                            right: 0,
                                            marginTop: '4px',
                                            background: theme.colors.secondaryBg,
                                            border: `1px solid ${theme.colors.border}`,
                                            borderRadius: '8px',
                                            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                                            zIndex: 100,
                                            maxHeight: '200px',
                                            overflowY: 'auto'
                                        }}>
                                            {/* "All" option */}
                                            <div
                                                onClick={() => {
                                                    setSelectedSubaccount(null);
                                                    setSubaccountInput('');
                                                    setShowSubaccountDropdown(false);
                                                    setPage(0);
                                                }}
                                                style={{
                                                    padding: '0.5rem 0.75rem',
                                                    cursor: 'pointer',
                                                    fontSize: '0.85rem',
                                                    color: !selectedSubaccount ? txPrimary : theme.colors.primaryText,
                                                    background: !selectedSubaccount ? `${txPrimary}10` : 'transparent',
                                                    borderBottom: `1px solid ${theme.colors.border}`
                                                }}
                                                onMouseEnter={(e) => e.target.style.background = `${txPrimary}15`}
                                                onMouseLeave={(e) => e.target.style.background = !selectedSubaccount ? `${txPrimary}10` : 'transparent'}
                                            >
                                                All subaccounts (main + others)
                                            </div>
                                            {/* Filter and show available subaccounts */}
                                            {availableSubaccounts
                                                .filter(sub => {
                                                    if (!subaccountInput.trim()) return true;
                                                    const hex = subaccountToHex(sub).toLowerCase();
                                                    const search = subaccountInput.toLowerCase().replace(/^0x/i, '').replace(/\s/g, '');
                                                    return hex.includes(search);
                                                })
                                                .map((sub, idx) => {
                                                    const hex = subaccountToHex(sub);
                                                    const shortHex = hex.length > 24 ? `${hex.substring(0, 12)}...${hex.substring(hex.length - 12)}` : hex;
                                                    const isSelected = selectedSubaccount && subaccountsEqual(selectedSubaccount, sub);
                                                    return (
                                                        <div
                                                            key={idx}
                                                            onClick={() => {
                                                                setSelectedSubaccount(sub);
                                                                setSubaccountInput(hex);
                                                                setShowSubaccountDropdown(false);
                                                                setPage(0);
                                                            }}
                                                            style={{
                                                                padding: '0.5rem 0.75rem',
                                                                cursor: 'pointer',
                                                                fontSize: '0.8rem',
                                                                fontFamily: 'monospace',
                                                                color: isSelected ? txPrimary : theme.colors.primaryText,
                                                                background: isSelected ? `${txPrimary}10` : 'transparent'
                                                            }}
                                                            onMouseEnter={(e) => e.target.style.background = `${txPrimary}15`}
                                                            onMouseLeave={(e) => e.target.style.background = isSelected ? `${txPrimary}10` : 'transparent'}
                                                        >
                                                            {shortHex}
                                                        </div>
                                                    );
                                                })}
                                            {/* Show hint when typing a custom subaccount */}
                                            {subaccountInput.trim() && /^(0x)?[0-9a-fA-F]+$/.test(subaccountInput.trim().replace(/\s/g, '')) && (
                                                <div
                                                    onClick={() => {
                                                        const trimmed = subaccountInput.trim();
                                                        const cleanHex = trimmed.replace(/^0x/i, '').replace(/\s/g, '');
                                                        if (cleanHex.length <= 64) {
                                                            const paddedHex = cleanHex.padStart(64, '0');
                                                            const bytes = new Uint8Array(paddedHex.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
                                                            setSelectedSubaccount(bytes);
                                                            setSubaccountInput(paddedHex);
                                                            setShowSubaccountDropdown(false);
                                                            setPage(0);
                                                        }
                                                    }}
                                                    style={{
                                                        padding: '0.5rem 0.75rem',
                                                        cursor: 'pointer',
                                                        fontSize: '0.8rem',
                                                        color: txAccent,
                                                        borderTop: `1px solid ${theme.colors.border}`,
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: '0.5rem'
                                                    }}
                                                    onMouseEnter={(e) => e.target.style.background = `${txAccent}10`}
                                                    onMouseLeave={(e) => e.target.style.background = 'transparent'}
                                                >
                                                    <FaSearch size={10} />
                                                    Use "{subaccountInput.trim().substring(0, 16)}{subaccountInput.trim().length > 16 ? '...' : ''}" as subaccount
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                                {availableSubaccounts.length > 0 && (
                                    <span style={{
                                        fontSize: '0.75rem',
                                        color: theme.colors.mutedText,
                                        whiteSpace: 'nowrap'
                                    }}>
                                        {availableSubaccounts.length} found
                                    </span>
                                )}
                            </div>
                        )}
                        
                        {/* Address filter row */}
                        <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.5rem',
                            padding: '0.875rem 1rem',
                            background: theme.colors.primaryBg,
                            borderRadius: '12px',
                            border: `1px solid ${theme.colors.border}`,
                            flexWrap: 'wrap'
                        }} className="transaction-filters-row">
                            {/* Filter icon label */}
                            <div style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.5rem',
                                color: theme.colors.mutedText,
                                fontSize: '0.8rem',
                                fontWeight: '500',
                                minWidth: '55px'
                            }}>
                                <FaFilter size={12} />
                                Filter
                            </div>
                            
                            {/* From input */}
                            <div style={{ flex: '1 1 160px', maxWidth: '280px' }} className="transaction-filter-group">
                                <PrincipalInput
                                    value={fromFilter}
                                    onChange={setFromFilter}
                                    placeholder="From (principal or account)..."
                                    showSubaccountOption={true}
                                />
                            </div>
                            
                            {/* AND/OR toggle */}
                            <div style={{
                                display: 'flex',
                                padding: '3px',
                                borderRadius: '8px',
                                background: theme.colors.tertiaryBg
                            }}>
                                <button
                                    onClick={() => setFilterOperator('and')}
                                    style={{
                                        padding: '0.35rem 0.875rem',
                                        borderRadius: '5px',
                                        border: 'none',
                                        background: filterOperator === 'and' ? txPrimary : 'transparent',
                                        color: filterOperator === 'and' ? 'white' : theme.colors.mutedText,
                                        fontSize: '0.75rem',
                                        fontWeight: '600',
                                        cursor: 'pointer',
                                        transition: 'all 0.15s ease'
                                    }}
                                >
                                    AND
                                </button>
                                <button
                                    onClick={() => setFilterOperator('or')}
                                    style={{
                                        padding: '0.35rem 0.875rem',
                                        borderRadius: '5px',
                                        border: 'none',
                                        background: filterOperator === 'or' ? txPrimary : 'transparent',
                                        color: filterOperator === 'or' ? 'white' : theme.colors.mutedText,
                                        fontSize: '0.75rem',
                                        fontWeight: '600',
                                        cursor: 'pointer',
                                        transition: 'all 0.15s ease'
                                    }}
                                >
                                    OR
                                </button>
                            </div>
                            
                            {/* To input */}
                            <div style={{ flex: '1 1 160px', maxWidth: '280px' }} className="transaction-filter-group">
                                <PrincipalInput
                                    value={toFilter}
                                    onChange={setToFilter}
                                    placeholder="To (principal or account)..."
                                    showSubaccountOption={true}
                                />
                            </div>
                            
                            {/* Clear filters button - only show if filters are active */}
                            {(fromFilter || toFilter) && (
                                <button
                                    onClick={() => {
                                        setFromFilter('');
                                        setToFilter('');
                                    }}
                                    style={{
                                        padding: '0.4rem 0.75rem',
                                        borderRadius: '6px',
                                        border: 'none',
                                        background: `${theme.colors.error}15`,
                                        color: theme.colors.error,
                                        fontSize: '0.75rem',
                                        fontWeight: '500',
                                        cursor: 'pointer',
                                        transition: 'all 0.15s ease'
                                    }}
                                    onMouseEnter={(e) => {
                                        e.target.style.background = `${theme.colors.error}25`;
                                    }}
                                    onMouseLeave={(e) => {
                                        e.target.style.background = `${theme.colors.error}15`;
                                    }}
                                >
                                    ✕ Clear
                                </button>
                            )}
                        </div>
                    </div>

                    {error && (
                        <div style={{
                            padding: '1rem',
                            background: `${theme.colors.error}15`,
                            border: `1px solid ${theme.colors.error}40`,
                            borderRadius: '8px',
                            color: theme.colors.error,
                            marginBottom: '1rem'
                        }}>
                            Error: {error}
                        </div>
                    )}

                    {/* Table view */}
                    <div className="transaction-table-container" style={{ overflowX: 'auto' }}>
                        <table style={{
                            width: '100%',
                            borderCollapse: 'separate',
                            borderSpacing: 0
                        }}>
                            <thead>
                                <tr>
                                    <th 
                                        onClick={() => handleSort('type')}
                                        style={{
                                            textAlign: 'left',
                                            padding: '0.75rem 1rem',
                                            background: theme.colors.primaryBg,
                                            color: theme.colors.mutedText,
                                            fontSize: '0.75rem',
                                            fontWeight: '600',
                                            textTransform: 'uppercase',
                                            letterSpacing: '0.5px',
                                            cursor: 'pointer',
                                            borderBottom: `1px solid ${theme.colors.border}`,
                                            borderRadius: '8px 0 0 0'
                                        }}
                                    >
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                            Type {renderSortIcon('type')}
                                        </div>
                                    </th>
                                    <th 
                                        onClick={() => handleSort('index')}
                                        style={{
                                            textAlign: 'left',
                                            padding: '0.75rem 1rem',
                                            background: theme.colors.primaryBg,
                                            color: theme.colors.mutedText,
                                            fontSize: '0.75rem',
                                            fontWeight: '600',
                                            textTransform: 'uppercase',
                                            letterSpacing: '0.5px',
                                            cursor: 'pointer',
                                            borderBottom: `1px solid ${theme.colors.border}`
                                        }}
                                    >
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                            ID {renderSortIcon('index')}
                                        </div>
                                    </th>
                                    <th style={{
                                        textAlign: 'left',
                                        padding: '0.75rem 1rem',
                                        background: theme.colors.primaryBg,
                                        color: theme.colors.mutedText,
                                        fontSize: '0.75rem',
                                        fontWeight: '600',
                                        textTransform: 'uppercase',
                                        letterSpacing: '0.5px',
                                        borderBottom: `1px solid ${theme.colors.border}`
                                    }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                            <span onClick={() => handleSort('fromAddress')} style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                From {renderSortIcon('fromAddress')}
                                            </span>
                                            <span style={{ color: theme.colors.border }}>/</span>
                                            <span onClick={() => handleSort('toAddress')} style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                To {renderSortIcon('toAddress')}
                                            </span>
                                        </div>
                                    </th>
                                    <th 
                                        onClick={() => handleSort('amount')}
                                        style={{
                                            textAlign: 'right',
                                            padding: '0.75rem 1rem',
                                            background: theme.colors.primaryBg,
                                            color: theme.colors.mutedText,
                                            fontSize: '0.75rem',
                                            fontWeight: '600',
                                            textTransform: 'uppercase',
                                            letterSpacing: '0.5px',
                                            cursor: 'pointer',
                                            borderBottom: `1px solid ${theme.colors.border}`
                                        }}
                                    >
                                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '6px' }}>
                                            Amount {renderSortIcon('amount')}
                                        </div>
                                    </th>
                                    <th 
                                        onClick={() => handleSort('timestamp')}
                                        style={{
                                            textAlign: 'right',
                                            padding: '0.75rem 1rem',
                                            background: theme.colors.primaryBg,
                                            color: theme.colors.mutedText,
                                            fontSize: '0.75rem',
                                            fontWeight: '600',
                                            textTransform: 'uppercase',
                                            letterSpacing: '0.5px',
                                            cursor: 'pointer',
                                            borderBottom: `1px solid ${theme.colors.border}`,
                                            borderRadius: '0 8px 0 0'
                                        }}
                                    >
                                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '6px' }}>
                                            Time {renderSortIcon('timestamp')}
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
                                    const typeInfo = getTypeInfo(txType);
                                    const txId = !principalId ? (tx.txIndex ?? startTxIndex + index) : (tx.txId ?? tx.id ?? index);
                                    const isHovered = hoveredRow === index;

                                    const txUrl = `/transaction?sns=${snsRootCanisterId}&id=${txId}${ledgerCanisterId ? `&ledger=${ledgerCanisterId.toString()}` : ''}`;
                                    
                                    return (
                                        <tr 
                                            key={index}
                                            onMouseEnter={() => setHoveredRow(index)}
                                            onMouseLeave={() => setHoveredRow(null)}
                                            onClick={() => navigate(txUrl)}
                                            style={{
                                                background: isHovered ? theme.colors.primaryBg : 'transparent',
                                                transition: 'background 0.15s ease',
                                                cursor: 'pointer'
                                            }}
                                        >
                                            <td style={{
                                                padding: '0.875rem 1rem',
                                                borderBottom: `1px solid ${theme.colors.border}`,
                                                verticalAlign: 'middle'
                                            }}>
                                                <span style={{
                                                    display: 'inline-flex',
                                                    alignItems: 'center',
                                                    gap: '6px',
                                                    padding: '4px 10px',
                                                    borderRadius: '20px',
                                                    background: typeInfo.bg,
                                                    color: typeInfo.color,
                                                    fontSize: '0.8rem',
                                                    fontWeight: '500'
                                                }}>
                                                    {typeInfo.icon}
                                                    {typeInfo.label}
                                                </span>
                                            </td>
                                            <td style={{
                                                padding: '0.875rem 1rem',
                                                borderBottom: `1px solid ${theme.colors.border}`,
                                                verticalAlign: 'middle'
                                            }}>
                                                <Link 
                                                    to={`/transaction?sns=${snsRootCanisterId}&id=${txId}${ledgerCanisterId ? `&ledger=${ledgerCanisterId.toString()}` : ''}`}
                                                    style={{
                                                        color: txPrimary,
                                                        textDecoration: 'none',
                                                        fontWeight: '600',
                                                        fontSize: '0.9rem'
                                                    }}
                                                >
                                                    #{txId}
                                                </Link>
                                            </td>
                                            <td style={{
                                                padding: '0.875rem 1rem',
                                                borderBottom: `1px solid ${theme.colors.border}`,
                                                verticalAlign: 'top'
                                            }}>
                                                <div style={{ marginBottom: '0.5rem' }}>
                                                    <span style={{ color: theme.colors.mutedText, fontSize: '0.8rem' }}>From: </span>
                                                    {fromPrincipal ? (
                                                        <>
                                                            <PrincipalDisplay 
                                                                principal={fromPrincipal}
                                                                displayInfo={principalDisplayInfo.get(fromPrincipal?.toString?.() || '')}
                                                                showCopyButton={false}
                                                                short={true}
                                                                isAuthenticated={isAuthenticated}
                                                                subaccount={txType === 'transfer' && transaction.transfer?.[0]?.from?.subaccount?.length > 0 ? transaction.transfer[0].from.subaccount[0] : null}
                                                            />
                                                            {(txType === 'transfer' && transaction.transfer?.[0]?.from?.subaccount?.length > 0) && (() => {
                                                                const fromSub = transaction.transfer[0].from.subaccount[0];
                                                                const fromSubHex = subaccountToHex(fromSub);
                                                                const fromSubId = `from-${tx.id}`;
                                                                return (
                                                                    <div style={{ 
                                                                        fontSize: '0.7rem', 
                                                                        color: theme.colors.mutedText, 
                                                                        marginTop: '2px', 
                                                                        fontFamily: 'monospace',
                                                                        display: 'flex',
                                                                        alignItems: 'center',
                                                                        gap: '4px'
                                                                    }}>
                                                                        <Link
                                                                            to={`/principal?id=${fromPrincipal.toString()}&subaccount=${fromSubHex}`}
                                                                            onClick={(e) => e.stopPropagation()}
                                                                            style={{
                                                                                color: theme.colors.mutedText,
                                                                                textDecoration: 'none'
                                                                            }}
                                                                            onMouseEnter={(e) => e.target.style.textDecoration = 'underline'}
                                                                            onMouseLeave={(e) => e.target.style.textDecoration = 'none'}
                                                                            title={`View transactions for this subaccount\n${fromSubHex}`}
                                                                        >
                                                                            Sub: {fromSubHex.substring(0, 16)}...
                                                                        </Link>
                                                                        <button
                                                                            onClick={(e) => {
                                                                                e.stopPropagation();
                                                                                copySubaccount(fromSub, fromSubId);
                                                                            }}
                                                                            style={{
                                                                                background: 'transparent',
                                                                                border: 'none',
                                                                                cursor: 'pointer',
                                                                                padding: '2px',
                                                                                display: 'flex',
                                                                                alignItems: 'center',
                                                                                color: copiedSubaccount === fromSubId ? theme.colors.success : theme.colors.mutedText,
                                                                                transition: 'color 0.2s'
                                                                            }}
                                                                            title="Copy subaccount"
                                                                        >
                                                                            <FaCopy size={10} />
                                                                        </button>
                                                                    </div>
                                                                );
                                                            })()}
                                                        </>
                                                    ) : (
                                                        <span style={{ color: theme.colors.mutedText }}>-</span>
                                                    )}
                                                </div>
                                                <div>
                                                    <span style={{ color: theme.colors.mutedText, fontSize: '0.8rem' }}>To: </span>
                                                    {toPrincipal ? (
                                                        <>
                                                            <PrincipalDisplay 
                                                                principal={toPrincipal}
                                                                displayInfo={principalDisplayInfo.get(toPrincipal?.toString?.() || '')}
                                                                showCopyButton={false}
                                                                short={true}
                                                                isAuthenticated={isAuthenticated}
                                                                subaccount={txType === 'transfer' && transaction.transfer?.[0]?.to?.subaccount?.length > 0 ? transaction.transfer[0].to.subaccount[0] : null}
                                                            />
                                                            {(txType === 'transfer' && transaction.transfer?.[0]?.to?.subaccount?.length > 0) && (() => {
                                                                const toSub = transaction.transfer[0].to.subaccount[0];
                                                                const toSubHex = subaccountToHex(toSub);
                                                                const toSubId = `to-${tx.id}`;
                                                                return (
                                                                    <div style={{ 
                                                                        fontSize: '0.7rem', 
                                                                        color: theme.colors.mutedText, 
                                                                        marginTop: '2px', 
                                                                        fontFamily: 'monospace',
                                                                        display: 'flex',
                                                                        alignItems: 'center',
                                                                        gap: '4px'
                                                                    }}>
                                                                        <Link
                                                                            to={`/principal?id=${toPrincipal.toString()}&subaccount=${toSubHex}`}
                                                                            onClick={(e) => e.stopPropagation()}
                                                                            style={{
                                                                                color: theme.colors.mutedText,
                                                                                textDecoration: 'none'
                                                                            }}
                                                                            onMouseEnter={(e) => e.target.style.textDecoration = 'underline'}
                                                                            onMouseLeave={(e) => e.target.style.textDecoration = 'none'}
                                                                            title={`View transactions for this subaccount\n${toSubHex}`}
                                                                        >
                                                                            Sub: {toSubHex.substring(0, 16)}...
                                                                        </Link>
                                                                        <button
                                                                            onClick={(e) => {
                                                                                e.stopPropagation();
                                                                                copySubaccount(toSub, toSubId);
                                                                            }}
                                                                            style={{
                                                                                background: 'transparent',
                                                                                border: 'none',
                                                                                cursor: 'pointer',
                                                                                padding: '2px',
                                                                                display: 'flex',
                                                                                alignItems: 'center',
                                                                                color: copiedSubaccount === toSubId ? theme.colors.success : theme.colors.mutedText,
                                                                                transition: 'color 0.2s'
                                                                            }}
                                                                            title="Copy subaccount"
                                                                        >
                                                                            <FaCopy size={10} />
                                                                        </button>
                                                                    </div>
                                                                );
                                                            })()}
                                                        </>
                                                    ) : (
                                                        <span style={{ color: theme.colors.mutedText }}>-</span>
                                                    )}
                                                </div>
                                            </td>
                                            <td style={{
                                                padding: '0.875rem 1rem',
                                                borderBottom: `1px solid ${theme.colors.border}`,
                                                textAlign: 'right',
                                                verticalAlign: 'middle',
                                                fontWeight: '600',
                                                color: theme.colors.primaryText
                                            }}>
                                                {amount ? formatAmount(amount) : '-'}
                                            </td>
                                            <td style={{
                                                padding: '0.875rem 1rem',
                                                borderBottom: `1px solid ${theme.colors.border}`,
                                                textAlign: 'right',
                                                verticalAlign: 'middle',
                                                color: theme.colors.secondaryText,
                                                fontSize: '0.85rem'
                                            }}>
                                                <span title={formatTimestamp(transaction.timestamp)}>
                                                    {getRelativeTime(transaction.timestamp)}
                                                </span>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>

                    {/* Cards view for mobile */}
                    <div className="transaction-cards-container">
                        {displayedTransactions.map((tx, index) => renderTransactionCard(tx, index))}
                    </div>

                    {/* Empty state */}
                    {displayedTransactions.length === 0 && !loading && (
                        <div style={{
                            textAlign: 'center',
                            padding: '3rem',
                            color: theme.colors.mutedText
                        }}>
                            <FaExchangeAlt size={32} style={{ opacity: 0.3, marginBottom: '1rem' }} />
                            <p style={{ margin: 0 }}>No transactions found</p>
                        </div>
                    )}

                    {/* Pagination */}
                    {displayedTransactions.length > 0 && (
                        <div style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            marginTop: '1.5rem',
                            padding: '1rem',
                            background: theme.colors.primaryBg,
                            borderRadius: '12px',
                            border: `1px solid ${theme.colors.border}`,
                            flexWrap: 'wrap',
                            gap: '1rem'
                        }}>
                            <div style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.5rem'
                            }}>
                                <button
                                    onClick={() => setPage(p => Math.max(0, p - 1))}
                                    disabled={page === 0}
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '0.5rem',
                                        padding: '0.5rem 1rem',
                                        borderRadius: '8px',
                                        border: `1px solid ${theme.colors.border}`,
                                        background: page === 0 ? theme.colors.tertiaryBg : theme.colors.secondaryBg,
                                        color: page === 0 ? theme.colors.mutedText : theme.colors.primaryText,
                                        fontSize: '0.85rem',
                                        cursor: page === 0 ? 'not-allowed' : 'pointer',
                                        opacity: page === 0 ? 0.5 : 1
                                    }}
                                >
                                    <FaChevronLeft size={12} />
                                    Prev
                                </button>
                                
                                <span style={{
                                    padding: '0.5rem 1rem',
                                    color: theme.colors.secondaryText,
                                    fontSize: '0.9rem'
                                }}>
                                    Page {page + 1} of {Math.max(1, Math.ceil(totalTransactions / pageSize))}
                                </span>
                                
                                <button
                                    onClick={() => setPage(p => p + 1)}
                                    disabled={(page + 1) * pageSize >= totalTransactions}
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '0.5rem',
                                        padding: '0.5rem 1rem',
                                        borderRadius: '8px',
                                        border: `1px solid ${theme.colors.border}`,
                                        background: (page + 1) * pageSize >= totalTransactions ? theme.colors.tertiaryBg : theme.colors.secondaryBg,
                                        color: (page + 1) * pageSize >= totalTransactions ? theme.colors.mutedText : theme.colors.primaryText,
                                        fontSize: '0.85rem',
                                        cursor: (page + 1) * pageSize >= totalTransactions ? 'not-allowed' : 'pointer',
                                        opacity: (page + 1) * pageSize >= totalTransactions ? 0.5 : 1
                                    }}
                                >
                                    Next
                                    <FaChevronRight size={12} />
                                </button>
                            </div>
                            
                            <div style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.5rem',
                                color: theme.colors.secondaryText,
                                fontSize: '0.85rem'
                            }}>
                                <span>Show</span>
                                <select 
                                    value={pageSize} 
                                    onChange={handlePageSizeChange}
                                    style={{
                                        padding: '0.4rem 0.5rem',
                                        borderRadius: '6px',
                                        border: `1px solid ${theme.colors.border}`,
                                        background: theme.colors.secondaryBg,
                                        color: theme.colors.primaryText,
                                        fontSize: '0.85rem',
                                        cursor: 'pointer',
                                        outline: 'none'
                                    }}
                                >
                                    {PAGE_SIZES.map(size => (
                                        <option key={size} value={size}>{size}</option>
                                    ))}
                                </select>
                                <span>per page</span>
                            </div>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}

export default TransactionList;
