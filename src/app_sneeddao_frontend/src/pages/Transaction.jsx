import React, { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { createActor as createSnsRootActor } from 'external/sns_root';
import { createActor as createSnsArchiveActor } from 'external/sns_archive';
import { createActor as createSnsLedgerActor } from 'external/icrc1_ledger';
import { useAuth } from '../AuthContext';
import { useSns } from '../contexts/SnsContext';
import { useTheme } from '../contexts/ThemeContext';
import { useNaming } from '../NamingContext';
import Header from '../components/Header';
import { PrincipalDisplay, getPrincipalDisplayInfoFromContext } from '../utils/PrincipalUtils';
import { fetchAndCacheSnsData, getSnsById, getAllSnses } from '../utils/SnsUtils';
import { formatAmount, subaccountToHex } from '../utils/StringUtils';
import { getTokenLogo } from '../utils/TokenUtils';
import { getRelativeTime, getFullDate } from '../utils/DateUtils';
import { Principal } from '@dfinity/principal';
import { FaExchangeAlt, FaSearch, FaChevronLeft, FaChevronRight, FaArrowRight, FaArrowDown, FaCoins, FaFire, FaCheckCircle, FaClock, FaCopy, FaExternalLinkAlt } from 'react-icons/fa';

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

@keyframes slideIn {
    from {
        opacity: 0;
        transform: translateX(-10px);
    }
    to {
        opacity: 1;
        transform: translateX(0);
    }
}

.tx-card-animate {
    animation: fadeInUp 0.4s ease-out forwards;
}

.tx-shimmer {
    background: linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.1) 50%, transparent 100%);
    background-size: 200% 100%;
    animation: shimmer 2s infinite;
}

.tx-pulse {
    animation: pulse 2s ease-in-out infinite;
}

.tx-slide-in {
    animation: slideIn 0.3s ease-out forwards;
}
`;

// Accent colors
const txPrimary = '#6366f1'; // Indigo
const txSecondary = '#8b5cf6'; // Purple
const txAccent = '#06b6d4'; // Cyan

function Transaction() {
    const { theme } = useTheme();
    const { identity, isAuthenticated } = useAuth();
    const { selectedSnsRoot, SNEED_SNS_ROOT } = useSns();
    const { principalNames, principalNicknames } = useNaming();
    const [searchParams, setSearchParams] = useSearchParams();
    const [currentId, setCurrentId] = useState(searchParams.get('id') || '');
    const [archiveCanisterId, setArchiveCanisterId] = useState(null);
    const [transaction, setTransaction] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [principalDisplayInfo, setPrincipalDisplayInfo] = useState(new Map());
    const [ledgerCanisterId, setLedgerCanisterId] = useState(null);
    const [tokenMetadata, setTokenMetadata] = useState({
        name: '',
        symbol: '',
        logo: '',
        decimals: 8
    });
    const [copiedId, setCopiedId] = useState(false);

    const fetchTransaction = async () => {
        if (!currentId || !ledgerCanisterId) return;

        setLoading(true);
        setError(null);
        try {
            // Clean and validate the transaction ID
            const cleanId = currentId.replace(/[^0-9]/g, '');
            if (!cleanId) {
                throw new Error('Invalid transaction ID');
            }

            // Use the ledger canister ID that was determined (either from URL param or SNS)
            const ledgerActor = createSnsLedgerActor(ledgerCanisterId, {
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

    // Determine which ledger canister to use (from URL param or SNS)
    useEffect(() => {
        const determineLedgerCanister = async () => {
            try {
                const ledgerParam = searchParams.get('ledger');
                
                if (ledgerParam) {
                    // Use the ledger from URL parameter
                    setLedgerCanisterId(Principal.fromText(ledgerParam));
                } else {
                    // Fall back to SNS ledger
                    const snsRoot = searchParams.get('sns') || selectedSnsRoot || SNEED_SNS_ROOT;
                    const selectedSns = getSnsById(snsRoot);
                    
                    if (selectedSns?.canisters?.ledger) {
                        setLedgerCanisterId(Principal.fromText(selectedSns.canisters.ledger));
                    } else {
                        // Try to fetch from SNS root if not in cache
                        const snsRootActor = createSnsRootActor(snsRoot);
                        const response = await snsRootActor.list_sns_canisters({});
                        setLedgerCanisterId(response.ledger[0]);
                    }
                }
            } catch (err) {
                console.error('Error determining ledger canister:', err);
                setError('Failed to determine ledger canister');
            }
        };

        determineLedgerCanister();
    }, [searchParams, selectedSnsRoot]);

    // Fetch token metadata when ledger canister changes
    useEffect(() => {
        const fetchTokenMetadata = async () => {
            if (!ledgerCanisterId) return;

            try {
                const ledgerActor = createSnsLedgerActor(ledgerCanisterId);
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
    }, [ledgerCanisterId]);

    // Fetch transaction when ID or ledger changes
    useEffect(() => {
        if (searchParams.get('id') && ledgerCanisterId) {
            fetchTransaction();
        }
    }, [currentId, ledgerCanisterId]);

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
            // Preserve ledger parameter if it exists
            const ledgerParam = searchParams.get('ledger');
            if (ledgerParam) {
                params.set('ledger', ledgerParam);
            }
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

    const handleNavigation = (direction) => {
        const newId = direction === 'prev' ? 
            BigInt(currentId) - 1n : 
            BigInt(currentId) + 1n;
        
        setCurrentId(newId.toString());
        setSearchParams(prev => {
            prev.set('id', newId.toString());
            // Preserve ledger parameter if it exists
            const ledgerParam = searchParams.get('ledger');
            if (ledgerParam) {
                prev.set('ledger', ledgerParam);
            }
            return prev;
        });
    };

    const copyTransactionId = () => {
        if (currentId) {
            navigator.clipboard.writeText(currentId);
            setCopiedId(true);
            setTimeout(() => setCopiedId(false), 2000);
        }
    };

    // Get transaction type info
    const getTransactionTypeInfo = (kind) => {
        const types = {
            transfer: { 
                label: 'Transfer', 
                icon: <FaExchangeAlt size={18} />,
                color: txPrimary,
                bg: `${txPrimary}15`,
                description: 'Token transfer between accounts'
            },
            mint: { 
                label: 'Mint', 
                icon: <FaCoins size={18} />,
                color: '#10b981',
                bg: 'rgba(16, 185, 129, 0.15)',
                description: 'New tokens created'
            },
            burn: { 
                label: 'Burn', 
                icon: <FaFire size={18} />,
                color: '#ef4444',
                bg: 'rgba(239, 68, 68, 0.15)',
                description: 'Tokens permanently destroyed'
            },
            approve: { 
                label: 'Approve', 
                icon: <FaCheckCircle size={18} />,
                color: txAccent,
                bg: `${txAccent}15`,
                description: 'Spending allowance granted'
            }
        };
        return types[kind?.toLowerCase()] || { 
            label: kind || 'Unknown', 
            icon: <FaExchangeAlt size={18} />,
            color: theme.colors.mutedText,
            bg: theme.colors.tertiaryBg,
            description: 'Transaction'
        };
    };

    const renderAccountCard = (account, label, isFrom = false) => {
        if (!account || !account.owner) return null;
        try {
            return (
                <div 
                    className="tx-slide-in"
                    style={{
                        background: theme.colors.primaryBg,
                        borderRadius: '12px',
                        padding: '1rem 1.25rem',
                        border: `1px solid ${theme.colors.border}`,
                        flex: '1 1 250px'
                    }}
                >
                    <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem',
                        marginBottom: '0.75rem',
                        color: isFrom ? theme.colors.error : theme.colors.success,
                        fontSize: '0.85rem',
                        fontWeight: '600'
                    }}>
                        {isFrom ? <FaArrowRight size={12} /> : <FaArrowDown size={12} />}
                        {label}
                    </div>
                    <div style={{ marginBottom: account.subaccount && account.subaccount.length > 0 ? '0.75rem' : 0 }}>
                        <PrincipalDisplay
                            principal={account.owner}
                            displayInfo={account.owner ? principalDisplayInfo.get(account.owner.toString()) : null}
                            showCopyButton={true}
                            short={false}
                            enableContextMenu={true}
                            isAuthenticated={isAuthenticated}
                        />
                    </div>
                    {account.subaccount && account.subaccount.length > 0 && (
                        <div style={{
                            fontSize: '0.75rem',
                            color: theme.colors.mutedText,
                            wordBreak: 'break-all',
                            background: theme.colors.secondaryBg,
                            padding: '0.5rem 0.75rem',
                            borderRadius: '6px',
                            fontFamily: 'monospace'
                        }}>
                            <span style={{ color: theme.colors.secondaryText }}>Subaccount: </span>
                            {subaccountToHex(account.subaccount[0])}
                        </div>
                    )}
                </div>
            );
        } catch (e) {
            console.error('Error rendering account info:', e, 'Account:', account);
            return null;
        }
    };

    // Loading state
    if (loading && !transaction) {
        return (
            <div className="page-container">
                <style>{customStyles}</style>
                <Header showSnsDropdown={true} />
                <main style={{
                    background: theme.colors.primaryGradient,
                    minHeight: '100vh',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                }}>
                    <div style={{
                        textAlign: 'center',
                        color: theme.colors.mutedText
                    }}>
                        <div className="tx-pulse" style={{
                            width: '60px',
                            height: '60px',
                            borderRadius: '50%',
                            background: `linear-gradient(135deg, ${txPrimary}, ${txSecondary})`,
                            margin: '0 auto 1rem',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center'
                        }}>
                            <FaExchangeAlt size={28} color="white" />
                        </div>
                        <p style={{ fontSize: '1.1rem' }}>Loading transaction...</p>
                    </div>
                </main>
            </div>
        );
    }

    const txTypeInfo = transaction ? getTransactionTypeInfo(transaction.kind) : null;

    return (
        <div className="page-container">
            <style>{customStyles}</style>
            <Header showSnsDropdown={true} />
            
            <main style={{
                background: theme.colors.primaryGradient,
                minHeight: '100vh'
            }}>
                {/* Hero Section */}
                <div style={{
                    background: `linear-gradient(135deg, ${theme.colors.primaryBg} 0%, ${txPrimary}15 50%, ${txSecondary}10 100%)`,
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
                        background: `radial-gradient(circle, ${txPrimary}20 0%, transparent 70%)`,
                        borderRadius: '50%',
                        pointerEvents: 'none'
                    }} />
                    <div style={{
                        position: 'absolute',
                        bottom: '-30%',
                        left: '-5%',
                        width: '300px',
                        height: '300px',
                        background: `radial-gradient(circle, ${txSecondary}15 0%, transparent 70%)`,
                        borderRadius: '50%',
                        pointerEvents: 'none'
                    }} />
                    
                    <div style={{
                        maxWidth: '800px',
                        margin: '0 auto',
                        position: 'relative',
                        zIndex: 1
                    }}>
                        <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '1rem',
                            marginBottom: '1.5rem'
                        }}>
                            <div style={{
                                width: '56px',
                                height: '56px',
                                borderRadius: '50%',
                                background: `linear-gradient(135deg, ${txPrimary}, ${txSecondary})`,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center'
                            }}>
                                <FaExchangeAlt size={24} color="white" />
                            </div>
                            <div>
                                <h1 style={{
                                    color: theme.colors.primaryText,
                                    fontSize: '1.75rem',
                                    fontWeight: '700',
                                    margin: 0
                                }}>
                                    Transaction Explorer
                                </h1>
                                <p style={{
                                    color: theme.colors.secondaryText,
                                    fontSize: '0.95rem',
                                    margin: '0.25rem 0 0 0'
                                }}>
                                    View detailed transaction information on the ledger
                                </p>
                            </div>
                        </div>
                        
                        {/* Search Box */}
                        <div style={{
                            display: 'flex',
                            gap: '0.75rem',
                            maxWidth: '500px'
                        }}>
                            <div style={{
                                flex: 1,
                                position: 'relative'
                            }}>
                                <FaSearch size={14} style={{
                                    position: 'absolute',
                                    left: '14px',
                                    top: '50%',
                                    transform: 'translateY(-50%)',
                                    color: theme.colors.mutedText
                                }} />
                                <input
                                    type="text"
                                    value={currentId}
                                    onChange={(e) => setCurrentId(e.target.value)}
                                    onKeyPress={handleKeyPress}
                                    placeholder="Enter transaction ID..."
                                    style={{
                                        width: '100%',
                                        padding: '0.75rem 1rem 0.75rem 2.5rem',
                                        borderRadius: '12px',
                                        border: `1px solid ${theme.colors.border}`,
                                        background: theme.colors.secondaryBg,
                                        color: theme.colors.primaryText,
                                        fontSize: '1rem',
                                        outline: 'none',
                                        boxSizing: 'border-box',
                                        transition: 'border-color 0.2s ease'
                                    }}
                                />
                            </div>
                            <button 
                                onClick={handleSearch} 
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '0.5rem',
                                    padding: '0.75rem 1.5rem',
                                    borderRadius: '12px',
                                    border: 'none',
                                    background: `linear-gradient(135deg, ${txPrimary}, ${txSecondary})`,
                                    color: 'white',
                                    fontSize: '0.95rem',
                                    fontWeight: '600',
                                    cursor: 'pointer',
                                    transition: 'all 0.3s ease',
                                    boxShadow: `0 4px 15px ${txPrimary}40`
                                }}
                            >
                                <FaSearch size={14} />
                                Search
                            </button>
                        </div>
                    </div>
                </div>

                {/* Main Content */}
                <div style={{
                    maxWidth: '800px',
                    margin: '0 auto',
                    padding: '1.5rem'
                }}>
                    {/* Error Message */}
                    {error && (
                        <div 
                            className="tx-card-animate"
                            style={{
                                background: `${theme.colors.error}15`,
                                border: `1px solid ${theme.colors.error}40`,
                                borderRadius: '12px',
                                padding: '1rem 1.25rem',
                                marginBottom: '1.5rem',
                                color: theme.colors.error,
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.75rem'
                            }}
                        >
                            <span>⚠️</span>
                            {error}
                        </div>
                    )}

                    {/* Transaction Details */}
                    {transaction && (
                        <div className="tx-card-animate" style={{ opacity: 0 }}>
                            {/* Token & Transaction Type Header */}
                            <div style={{
                                background: theme.colors.secondaryBg,
                                borderRadius: '16px',
                                border: `1px solid ${theme.colors.border}`,
                                overflow: 'hidden',
                                marginBottom: '1rem'
                            }}>
                                {/* Top banner with type */}
                                <div style={{
                                    padding: '1.25rem 1.5rem',
                                    background: `linear-gradient(135deg, ${txTypeInfo.bg} 0%, transparent 100%)`,
                                    borderBottom: `1px solid ${theme.colors.border}`,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    flexWrap: 'wrap',
                                    gap: '1rem'
                                }}>
                                    <div style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '1rem'
                                    }}>
                                        <div style={{
                                            width: '48px',
                                            height: '48px',
                                            borderRadius: '12px',
                                            background: txTypeInfo.bg,
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            color: txTypeInfo.color
                                        }}>
                                            {txTypeInfo.icon}
                                        </div>
                                        <div>
                                            <div style={{
                                                color: txTypeInfo.color,
                                                fontSize: '1.25rem',
                                                fontWeight: '700'
                                            }}>
                                                {txTypeInfo.label}
                                            </div>
                                            <div style={{
                                                color: theme.colors.secondaryText,
                                                fontSize: '0.85rem'
                                            }}>
                                                {txTypeInfo.description}
                                            </div>
                                        </div>
                                    </div>
                                    
                                    {/* Token Info */}
                                    <div style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '0.75rem',
                                        padding: '0.5rem 1rem',
                                        background: theme.colors.primaryBg,
                                        borderRadius: '10px',
                                        border: `1px solid ${theme.colors.border}`
                                    }}>
                                        {tokenMetadata.logo ? (
                                            <img 
                                                src={tokenMetadata.logo} 
                                                alt={tokenMetadata.symbol} 
                                                style={{
                                                    width: '32px',
                                                    height: '32px',
                                                    borderRadius: '50%',
                                                    objectFit: 'cover'
                                                }}
                                            />
                                        ) : (
                                            <div style={{
                                                width: '32px',
                                                height: '32px',
                                                borderRadius: '50%',
                                                background: `linear-gradient(135deg, ${txPrimary}40, ${txSecondary}40)`,
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                color: theme.colors.primaryText,
                                                fontSize: '0.75rem',
                                                fontWeight: '600'
                                            }}>
                                                {tokenMetadata.symbol?.substring(0, 2) || '?'}
                                            </div>
                                        )}
                                        <div>
                                            <div style={{
                                                color: theme.colors.primaryText,
                                                fontWeight: '600',
                                                fontSize: '0.95rem'
                                            }}>
                                                {tokenMetadata.name || 'Token'}
                                            </div>
                                            <div style={{
                                                color: theme.colors.mutedText,
                                                fontSize: '0.8rem'
                                            }}>
                                                {tokenMetadata.symbol}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                
                                {/* Transaction ID & Timestamp */}
                                <div style={{
                                    padding: '1rem 1.5rem',
                                    display: 'grid',
                                    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                                    gap: '1rem'
                                }}>
                                    <div>
                                        <div style={{
                                            color: theme.colors.mutedText,
                                            fontSize: '0.8rem',
                                            marginBottom: '0.35rem',
                                            textTransform: 'uppercase',
                                            letterSpacing: '0.5px'
                                        }}>
                                            Transaction ID
                                        </div>
                                        <div style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '0.5rem'
                                        }}>
                                            <span style={{
                                                color: theme.colors.primaryText,
                                                fontWeight: '600',
                                                fontSize: '1.1rem',
                                                fontFamily: 'monospace'
                                            }}>
                                                #{currentId}
                                            </span>
                                            <button
                                                onClick={copyTransactionId}
                                                style={{
                                                    background: 'none',
                                                    border: 'none',
                                                    color: copiedId ? theme.colors.success : theme.colors.mutedText,
                                                    cursor: 'pointer',
                                                    padding: '4px',
                                                    borderRadius: '4px',
                                                    transition: 'all 0.2s ease'
                                                }}
                                                title="Copy ID"
                                            >
                                                {copiedId ? <FaCheckCircle size={14} /> : <FaCopy size={14} />}
                                            </button>
                                        </div>
                                    </div>
                                    <div>
                                        <div style={{
                                            color: theme.colors.mutedText,
                                            fontSize: '0.8rem',
                                            marginBottom: '0.35rem',
                                            textTransform: 'uppercase',
                                            letterSpacing: '0.5px'
                                        }}>
                                            Timestamp
                                        </div>
                                        <div style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '0.5rem',
                                            color: theme.colors.primaryText,
                                            fontSize: '0.95rem'
                                        }}>
                                            <FaClock size={14} style={{ color: theme.colors.mutedText }} />
                                            <span title={formatTimestamp(transaction.timestamp)}>
                                                {getRelativeTime(transaction.timestamp)}
                                            </span>
                                            <span style={{
                                                color: theme.colors.mutedText,
                                                fontSize: '0.85rem'
                                            }}>
                                                ({formatTimestamp(transaction.timestamp)})
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Transfer details */}
                            {transaction.transfer?.[0] && (
                                <div style={{
                                    background: theme.colors.secondaryBg,
                                    borderRadius: '16px',
                                    border: `1px solid ${theme.colors.border}`,
                                    padding: '1.5rem',
                                    marginBottom: '1rem'
                                }}>
                                    {/* Amount */}
                                    <div style={{
                                        textAlign: 'center',
                                        marginBottom: '1.5rem',
                                        padding: '1.5rem',
                                        background: `linear-gradient(135deg, ${txPrimary}10 0%, ${txSecondary}10 100%)`,
                                        borderRadius: '12px'
                                    }}>
                                        <div style={{
                                            color: theme.colors.mutedText,
                                            fontSize: '0.85rem',
                                            marginBottom: '0.5rem',
                                            textTransform: 'uppercase',
                                            letterSpacing: '0.5px'
                                        }}>
                                            Amount
                                        </div>
                                        <div style={{
                                            color: theme.colors.primaryText,
                                            fontSize: '2rem',
                                            fontWeight: '700'
                                        }}>
                                            {formatSafeAmount(transaction.transfer[0].amount)} 
                                            <span style={{
                                                color: txPrimary,
                                                marginLeft: '0.5rem',
                                                fontSize: '1.25rem'
                                            }}>
                                                {tokenMetadata.symbol}
                                            </span>
                                        </div>
                                        {transaction.transfer[0].fee && (
                                            <div style={{
                                                color: theme.colors.mutedText,
                                                fontSize: '0.85rem',
                                                marginTop: '0.5rem'
                                            }}>
                                                Fee: {formatSafeAmount(transaction.transfer[0].fee)} {tokenMetadata.symbol}
                                            </div>
                                        )}
                                    </div>
                                    
                                    {/* From/To Cards */}
                                    <div style={{
                                        display: 'flex',
                                        gap: '1rem',
                                        flexWrap: 'wrap'
                                    }}>
                                        {renderAccountCard(transaction.transfer[0].from, "From", true)}
                                        {renderAccountCard(transaction.transfer[0].to, "To", false)}
                                    </div>
                                    
                                    {transaction.transfer[0].spender && (
                                        <div style={{ marginTop: '1rem' }}>
                                            {renderAccountCard(transaction.transfer[0].spender, "Spender")}
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Mint details */}
                            {transaction.mint?.[0] && (
                                <div style={{
                                    background: theme.colors.secondaryBg,
                                    borderRadius: '16px',
                                    border: `1px solid ${theme.colors.border}`,
                                    padding: '1.5rem',
                                    marginBottom: '1rem'
                                }}>
                                    {/* Amount */}
                                    <div style={{
                                        textAlign: 'center',
                                        marginBottom: '1.5rem',
                                        padding: '1.5rem',
                                        background: 'rgba(16, 185, 129, 0.1)',
                                        borderRadius: '12px'
                                    }}>
                                        <div style={{
                                            color: theme.colors.mutedText,
                                            fontSize: '0.85rem',
                                            marginBottom: '0.5rem',
                                            textTransform: 'uppercase',
                                            letterSpacing: '0.5px'
                                        }}>
                                            Minted Amount
                                        </div>
                                        <div style={{
                                            color: '#10b981',
                                            fontSize: '2rem',
                                            fontWeight: '700'
                                        }}>
                                            +{formatSafeAmount(transaction.mint[0].amount)} 
                                            <span style={{ marginLeft: '0.5rem', fontSize: '1.25rem' }}>
                                                {tokenMetadata.symbol}
                                            </span>
                                        </div>
                                    </div>
                                    
                                    {renderAccountCard(transaction.mint[0].to, "To", false)}
                                </div>
                            )}

                            {/* Burn details */}
                            {transaction.burn?.[0] && (
                                <div style={{
                                    background: theme.colors.secondaryBg,
                                    borderRadius: '16px',
                                    border: `1px solid ${theme.colors.border}`,
                                    padding: '1.5rem',
                                    marginBottom: '1rem'
                                }}>
                                    {/* Amount */}
                                    <div style={{
                                        textAlign: 'center',
                                        marginBottom: '1.5rem',
                                        padding: '1.5rem',
                                        background: 'rgba(239, 68, 68, 0.1)',
                                        borderRadius: '12px'
                                    }}>
                                        <div style={{
                                            color: theme.colors.mutedText,
                                            fontSize: '0.85rem',
                                            marginBottom: '0.5rem',
                                            textTransform: 'uppercase',
                                            letterSpacing: '0.5px'
                                        }}>
                                            Burned Amount
                                        </div>
                                        <div style={{
                                            color: '#ef4444',
                                            fontSize: '2rem',
                                            fontWeight: '700'
                                        }}>
                                            -{formatSafeAmount(transaction.burn[0].amount)} 
                                            <span style={{ marginLeft: '0.5rem', fontSize: '1.25rem' }}>
                                                {tokenMetadata.symbol}
                                            </span>
                                        </div>
                                    </div>
                                    
                                    <div style={{
                                        display: 'flex',
                                        gap: '1rem',
                                        flexWrap: 'wrap'
                                    }}>
                                        {renderAccountCard(transaction.burn[0].from, "From", true)}
                                        {transaction.burn[0].spender && 
                                            renderAccountCard(transaction.burn[0].spender, "Spender")}
                                    </div>
                                </div>
                            )}

                            {/* Approve details */}
                            {transaction.approve?.[0] && (
                                <div style={{
                                    background: theme.colors.secondaryBg,
                                    borderRadius: '16px',
                                    border: `1px solid ${theme.colors.border}`,
                                    padding: '1.5rem',
                                    marginBottom: '1rem'
                                }}>
                                    {/* Amount */}
                                    <div style={{
                                        textAlign: 'center',
                                        marginBottom: '1.5rem',
                                        padding: '1.5rem',
                                        background: `${txAccent}10`,
                                        borderRadius: '12px'
                                    }}>
                                        <div style={{
                                            color: theme.colors.mutedText,
                                            fontSize: '0.85rem',
                                            marginBottom: '0.5rem',
                                            textTransform: 'uppercase',
                                            letterSpacing: '0.5px'
                                        }}>
                                            Approved Amount
                                        </div>
                                        <div style={{
                                            color: txAccent,
                                            fontSize: '2rem',
                                            fontWeight: '700'
                                        }}>
                                            {formatSafeAmount(transaction.approve[0].amount)} 
                                            <span style={{ marginLeft: '0.5rem', fontSize: '1.25rem' }}>
                                                {tokenMetadata.symbol}
                                            </span>
                                        </div>
                                        {transaction.approve[0].fee && (
                                            <div style={{
                                                color: theme.colors.mutedText,
                                                fontSize: '0.85rem',
                                                marginTop: '0.5rem'
                                            }}>
                                                Fee: {formatSafeAmount(transaction.approve[0].fee)} {tokenMetadata.symbol}
                                            </div>
                                        )}
                                        {transaction.approve[0].expires_at && (
                                            <div style={{
                                                color: theme.colors.mutedText,
                                                fontSize: '0.85rem',
                                                marginTop: '0.5rem'
                                            }}>
                                                Expires: {formatTimestamp(transaction.approve[0].expires_at)}
                                            </div>
                                        )}
                                    </div>
                                    
                                    <div style={{
                                        display: 'flex',
                                        gap: '1rem',
                                        flexWrap: 'wrap'
                                    }}>
                                        {renderAccountCard(transaction.approve[0].from, "From", true)}
                                        {renderAccountCard(transaction.approve[0].spender, "Spender")}
                                    </div>
                                </div>
                            )}

                            {/* Navigation Buttons */}
                            <div style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                gap: '1rem',
                                marginTop: '1.5rem'
                            }}>
                                <button
                                    onClick={() => handleNavigation('prev')}
                                    disabled={BigInt(currentId) <= 0n}
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '0.5rem',
                                        padding: '0.75rem 1.5rem',
                                        borderRadius: '10px',
                                        border: `1px solid ${theme.colors.border}`,
                                        background: BigInt(currentId) <= 0n ? theme.colors.tertiaryBg : theme.colors.secondaryBg,
                                        color: BigInt(currentId) <= 0n ? theme.colors.mutedText : theme.colors.primaryText,
                                        fontSize: '0.9rem',
                                        fontWeight: '500',
                                        cursor: BigInt(currentId) <= 0n ? 'not-allowed' : 'pointer',
                                        opacity: BigInt(currentId) <= 0n ? 0.5 : 1,
                                        transition: 'all 0.2s ease'
                                    }}
                                >
                                    <FaChevronLeft size={14} />
                                    Previous
                                </button>
                                <button
                                    onClick={() => handleNavigation('next')}
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '0.5rem',
                                        padding: '0.75rem 1.5rem',
                                        borderRadius: '10px',
                                        border: `1px solid ${theme.colors.border}`,
                                        background: theme.colors.secondaryBg,
                                        color: theme.colors.primaryText,
                                        fontSize: '0.9rem',
                                        fontWeight: '500',
                                        cursor: 'pointer',
                                        transition: 'all 0.2s ease'
                                    }}
                                >
                                    Next
                                    <FaChevronRight size={14} />
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Empty State */}
                    {!transaction && !loading && !error && (
                        <div 
                            className="tx-card-animate"
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
                                background: `linear-gradient(135deg, ${txPrimary}30, ${txSecondary}20)`,
                                margin: '0 auto 1.5rem',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                color: txPrimary
                            }}>
                                <FaSearch size={28} />
                            </div>
                            <h3 style={{
                                color: theme.colors.primaryText,
                                fontSize: '1.25rem',
                                fontWeight: '600',
                                marginBottom: '0.5rem'
                            }}>
                                Search for a Transaction
                            </h3>
                            <p style={{
                                color: theme.colors.secondaryText,
                                fontSize: '0.95rem'
                            }}>
                                Enter a transaction ID above to view its details
                            </p>
                        </div>
                    )}
                </div>
            </main>
        </div>
    );
}

export default Transaction;
