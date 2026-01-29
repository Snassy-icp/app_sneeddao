import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../AuthContext';
import { useAdminCheck } from '../../hooks/useAdminCheck';
import { useTheme } from '../../contexts/ThemeContext';
import Header from '../../components/Header';
import { Principal } from '@dfinity/principal';
import { createActor as createBackendActor } from 'declarations/app_sneeddao_backend';
import { createActor as createLedgerActor } from 'external/icrc1_ledger';
import { getTokenLogo } from '../../utils/TokenUtils';
import InfoModal from '../../components/InfoModal';
import ConfirmationModal from '../../ConfirmationModal';
import { 
    FaSync, FaPlus, FaTrash, FaSpinner, FaCoins, FaSearch,
    FaCheckCircle, FaExclamationTriangle
} from 'react-icons/fa';

const backendCanisterId = process.env.CANISTER_ID_APP_SNEEDDAO_BACKEND || process.env.REACT_APP_BACKEND_CANISTER_ID;

export default function TokensAdmin() {
    const { isAuthenticated, identity } = useAuth();
    const { theme } = useTheme();
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    
    // Admin check
    const { isAdmin: isGlobalAdmin, loading: adminLoading } = useAdminCheck({
        identity,
        isAuthenticated,
        redirectPath: '/admin'
    });
    
    // Token list state
    const [tokens, setTokens] = useState([]);
    const [tokenLogos, setTokenLogos] = useState({});
    const [searchTerm, setSearchTerm] = useState('');
    
    // Import state
    const [importing, setImporting] = useState(false);
    const [importResult, setImportResult] = useState(null);
    
    // Add token state
    const [newLedgerId, setNewLedgerId] = useState('');
    const [addingToken, setAddingToken] = useState(false);
    const [verifyingToken, setVerifyingToken] = useState(false);
    const [verifiedToken, setVerifiedToken] = useState(null);
    
    // Remove token state
    const [removingToken, setRemovingToken] = useState(null);
    
    // Refresh single token state
    const [selectedRefreshToken, setSelectedRefreshToken] = useState('');
    const [customRefreshLedger, setCustomRefreshLedger] = useState('');
    const [refreshingSingle, setRefreshingSingle] = useState(false);
    const [singleRefreshResult, setSingleRefreshResult] = useState(null);
    
    // Refresh all tokens state
    const [refreshingAll, setRefreshingAll] = useState(false);
    const [refreshAllResult, setRefreshAllResult] = useState(null);
    
    // Modals
    const [infoModal, setInfoModal] = useState({ show: false, title: '', message: '', type: 'info' });
    const [confirmModal, setConfirmModal] = useState({ show: false, title: '', message: '', onConfirm: null });
    
    const showInfo = (title, message, type = 'info') => {
        setInfoModal({ show: true, title, message, type });
    };
    
    const closeInfoModal = () => {
        setInfoModal({ ...infoModal, show: false });
    };
    
    const showConfirm = (title, message, onConfirm) => {
        setConfirmModal({ show: true, title, message, onConfirm });
    };
    
    const closeConfirmModal = () => {
        setConfirmModal({ ...confirmModal, show: false });
    };
    
    const getBackendActor = useCallback(() => {
        if (!identity) return null;
        return createBackendActor(backendCanisterId, {
            agentOptions: { identity }
        });
    }, [identity]);
    
    // Fetch whitelisted tokens
    const fetchTokens = useCallback(async () => {
        if (!isAuthenticated || !identity) return;
        
        setLoading(true);
        setError('');
        
        try {
            const actor = getBackendActor();
            const whitelistedTokens = await actor.get_whitelisted_tokens();
            
            // Sort by symbol
            whitelistedTokens.sort((a, b) => a.symbol.localeCompare(b.symbol));
            setTokens(whitelistedTokens);
            
            // Fetch logos for each token (in background)
            fetchTokenLogos(whitelistedTokens);
        } catch (err) {
            console.error('Error fetching tokens:', err);
            setError('Failed to fetch whitelisted tokens');
        } finally {
            setLoading(false);
        }
    }, [isAuthenticated, identity, getBackendActor]);
    
    // Fetch logos for tokens
    const fetchTokenLogos = async (tokenList) => {
        const logos = {};
        
        for (const token of tokenList) {
            const ledgerId = token.ledger_id.toString();
            try {
                const ledgerActor = createLedgerActor(token.ledger_id, {
                    agentOptions: { identity }
                });
                const metadata = await ledgerActor.icrc1_metadata();
                const logo = getTokenLogo(metadata);
                logos[ledgerId] = token.symbol.toLowerCase() === 'icp' && !logo ? 'icp_symbol.svg' : logo;
            } catch (err) {
                logos[ledgerId] = '';
            }
            
            // Update progressively
            setTokenLogos(prev => ({ ...prev, [ledgerId]: logos[ledgerId] }));
        }
    };
    
    useEffect(() => {
        if (isGlobalAdmin) {
            fetchTokens();
        }
    }, [isGlobalAdmin, fetchTokens]);
    
    // Import from SwapRunner
    const handleImportFromSwapRunner = async () => {
        setImporting(true);
        setImportResult(null);
        
        try {
            const actor = getBackendActor();
            const beforeCount = tokens.length;
            
            await actor.import_whitelist_from_swaprunner();
            
            // Refresh the list
            await fetchTokens();
            
            const afterCount = tokens.length;
            const newTokens = afterCount - beforeCount;
            
            setImportResult({
                success: true,
                message: newTokens > 0 
                    ? `Successfully imported ${newTokens} new token(s) from SwapRunner!`
                    : 'Import complete. No new tokens found.'
            });
        } catch (err) {
            console.error('Error importing from SwapRunner:', err);
            setImportResult({
                success: false,
                message: `Failed to import: ${err.message || 'Unknown error'}`
            });
        } finally {
            setImporting(false);
        }
    };
    
    // Verify a custom ledger
    const handleVerifyToken = async () => {
        if (!newLedgerId.trim()) return;
        
        setVerifyingToken(true);
        setVerifiedToken(null);
        
        try {
            const principal = Principal.fromText(newLedgerId.trim());
            const ledgerActor = createLedgerActor(principal, {
                agentOptions: { identity }
            });
            
            const metadata = await ledgerActor.icrc1_metadata();
            
            // Parse metadata
            let symbol = 'Unknown';
            let name = 'Unknown Token';
            let decimals = 8;
            let fee = 10000n;
            let logo = '';
            
            for (const [key, value] of metadata) {
                if (key === 'icrc1:symbol' && 'Text' in value) {
                    symbol = value.Text;
                } else if (key === 'icrc1:name' && 'Text' in value) {
                    name = value.Text;
                } else if (key === 'icrc1:decimals' && 'Nat' in value) {
                    decimals = Number(value.Nat);
                } else if (key === 'icrc1:fee' && 'Nat' in value) {
                    fee = BigInt(value.Nat);
                }
            }
            
            logo = getTokenLogo(metadata);
            
            setVerifiedToken({
                ledger_id: principal,
                symbol,
                name,
                decimals,
                fee: Number(fee),
                logo,
                standard: 'ICRC1'
            });
        } catch (err) {
            console.error('Error verifying token:', err);
            showInfo('Verification Failed', `Could not verify ledger: ${err.message || 'Invalid canister ID or not an ICRC1 token'}`, 'error');
        } finally {
            setVerifyingToken(false);
        }
    };
    
    // Add verified token to whitelist
    const handleAddToken = async () => {
        if (!verifiedToken) return;
        
        setAddingToken(true);
        
        try {
            const actor = getBackendActor();
            
            await actor.add_whitelisted_token({
                ledger_id: verifiedToken.ledger_id,
                decimals: verifiedToken.decimals,
                fee: verifiedToken.fee,
                name: verifiedToken.name,
                symbol: verifiedToken.symbol,
                standard: verifiedToken.standard
            });
            
            showInfo('Success', `${verifiedToken.symbol} has been added to the whitelist!`, 'success');
            
            // Reset form and refresh
            setNewLedgerId('');
            setVerifiedToken(null);
            await fetchTokens();
        } catch (err) {
            console.error('Error adding token:', err);
            showInfo('Error', `Failed to add token: ${err.message || 'Unknown error'}`, 'error');
        } finally {
            setAddingToken(false);
        }
    };
    
    // Remove token from whitelist
    const handleRemoveToken = async (token) => {
        showConfirm(
            'Remove Token',
            `Are you sure you want to remove ${token.symbol} (${token.name}) from the whitelist?`,
            async () => {
                closeConfirmModal();
                setRemovingToken(token.ledger_id.toString());
                
                try {
                    const actor = getBackendActor();
                    await actor.remove_whitelisted_token(token.ledger_id);
                    
                    showInfo('Success', `${token.symbol} has been removed from the whitelist.`, 'success');
                    await fetchTokens();
                } catch (err) {
                    console.error('Error removing token:', err);
                    showInfo('Error', `Failed to remove token: ${err.message || 'Unknown error'}`, 'error');
                } finally {
                    setRemovingToken(null);
                }
            }
        );
    };
    
    // Refresh single token metadata
    const handleRefreshSingleToken = async () => {
        // Use custom ledger if provided, otherwise use selected token
        const ledgerToRefresh = customRefreshLedger.trim() || selectedRefreshToken;
        if (!ledgerToRefresh) return;
        
        setRefreshingSingle(true);
        setSingleRefreshResult(null);
        
        try {
            const principal = Principal.fromText(ledgerToRefresh);
            const actor = getBackendActor();
            const result = await actor.refresh_token_metadata(principal);
            
            if ('ok' in result) {
                const token = result.ok;
                setSingleRefreshResult({
                    success: true,
                    message: `Successfully refreshed metadata for ${token.symbol} (${token.name})`
                });
                // Refresh the list to show updated metadata
                await fetchTokens();
                // Clear inputs
                setCustomRefreshLedger('');
                setSelectedRefreshToken('');
            } else {
                setSingleRefreshResult({
                    success: false,
                    message: result.err || 'Unknown error'
                });
            }
        } catch (err) {
            console.error('Error refreshing token metadata:', err);
            setSingleRefreshResult({
                success: false,
                message: err.message || 'Invalid canister ID or failed to refresh'
            });
        } finally {
            setRefreshingSingle(false);
        }
    };
    
    // Refresh all whitelisted tokens metadata
    const handleRefreshAllTokens = async () => {
        setRefreshingAll(true);
        setRefreshAllResult(null);
        
        try {
            const actor = getBackendActor();
            const result = await actor.refresh_all_token_metadata();
            
            setRefreshAllResult({
                success: result.failed === 0n || result.failed === 0,
                message: `Refreshed ${result.success} tokens successfully. ${result.failed} failed.`,
                errors: result.errors || []
            });
            
            // Refresh the list to show updated metadata
            await fetchTokens();
        } catch (err) {
            console.error('Error refreshing all token metadata:', err);
            setRefreshAllResult({
                success: false,
                message: `Failed to refresh: ${err.message || 'Unknown error'}`,
                errors: []
            });
        } finally {
            setRefreshingAll(false);
        }
    };
    
    // Filter tokens by search term
    const filteredTokens = tokens.filter(token => {
        if (!searchTerm) return true;
        const term = searchTerm.toLowerCase();
        return token.symbol.toLowerCase().includes(term) ||
               token.name.toLowerCase().includes(term) ||
               token.ledger_id.toString().toLowerCase().includes(term);
    });
    
    const styles = {
        container: {
            maxWidth: '1200px',
            margin: '0 auto',
            padding: '20px',
        },
        header: {
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '30px',
            flexWrap: 'wrap',
            gap: '15px',
        },
        title: {
            color: theme.colors.primaryText,
            margin: 0,
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
        },
        section: {
            backgroundColor: theme.colors.secondaryBg,
            borderRadius: '12px',
            padding: '24px',
            marginBottom: '24px',
            border: `1px solid ${theme.colors.border}`,
        },
        sectionTitle: {
            color: theme.colors.primaryText,
            fontSize: '1.2rem',
            marginBottom: '16px',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
        },
        button: {
            padding: '10px 20px',
            borderRadius: '8px',
            border: 'none',
            cursor: 'pointer',
            fontWeight: '600',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            transition: 'all 0.2s ease',
        },
        primaryButton: {
            backgroundColor: theme.colors.accent,
            color: '#fff',
        },
        secondaryButton: {
            backgroundColor: theme.colors.tertiaryBg,
            color: theme.colors.primaryText,
            border: `1px solid ${theme.colors.border}`,
        },
        dangerButton: {
            backgroundColor: '#e74c3c',
            color: '#fff',
        },
        input: {
            padding: '12px 16px',
            borderRadius: '8px',
            border: `1px solid ${theme.colors.border}`,
            backgroundColor: theme.colors.primaryBg,
            color: theme.colors.primaryText,
            fontSize: '1rem',
            width: '100%',
            outline: 'none',
        },
        tokenGrid: {
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
            gap: '16px',
        },
        tokenCard: {
            backgroundColor: theme.colors.tertiaryBg,
            borderRadius: '10px',
            padding: '16px',
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            border: `1px solid ${theme.colors.border}`,
            transition: 'transform 0.2s ease',
        },
        tokenLogo: {
            width: '40px',
            height: '40px',
            borderRadius: '50%',
            backgroundColor: theme.colors.primaryBg,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
            flexShrink: 0,
        },
        tokenInfo: {
            flex: 1,
            minWidth: 0,
        },
        tokenSymbol: {
            color: theme.colors.primaryText,
            fontWeight: '600',
            fontSize: '1rem',
        },
        tokenName: {
            color: theme.colors.secondaryText,
            fontSize: '0.85rem',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
        },
        tokenLedger: {
            color: theme.colors.mutedText,
            fontSize: '0.75rem',
            fontFamily: 'monospace',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
        },
        removeButton: {
            padding: '8px',
            borderRadius: '6px',
            border: 'none',
            backgroundColor: 'transparent',
            color: theme.colors.mutedText,
            cursor: 'pointer',
            transition: 'all 0.2s ease',
        },
        importResult: {
            padding: '12px 16px',
            borderRadius: '8px',
            marginTop: '16px',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
        },
        verifiedTokenPreview: {
            backgroundColor: theme.colors.tertiaryBg,
            borderRadius: '10px',
            padding: '16px',
            marginTop: '16px',
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            border: `1px solid ${theme.colors.accent}`,
        },
        searchContainer: {
            position: 'relative',
            marginBottom: '20px',
        },
        searchIcon: {
            position: 'absolute',
            left: '14px',
            top: '50%',
            transform: 'translateY(-50%)',
            color: theme.colors.mutedText,
        },
        searchInput: {
            padding: '12px 16px 12px 42px',
            borderRadius: '8px',
            border: `1px solid ${theme.colors.border}`,
            backgroundColor: theme.colors.primaryBg,
            color: theme.colors.primaryText,
            fontSize: '1rem',
            width: '100%',
            outline: 'none',
        },
        stats: {
            color: theme.colors.secondaryText,
            fontSize: '0.9rem',
            marginBottom: '16px',
        },
    };

    if (adminLoading || loading) {
        return (
            <div className='page-container'>
                <Header />
                <main className="wallet-container">
                    <div style={{ textAlign: 'center', padding: '40px 20px', color: theme.colors.primaryText }}>
                        <FaSpinner className="spin" style={{ fontSize: '2rem', marginBottom: '10px' }} />
                        <p>Loading...</p>
                    </div>
                </main>
            </div>
        );
    }

    if (!isGlobalAdmin) {
        return null;
    }

    return (
        <div className='page-container'>
            <Header />
            <main className="wallet-container">
                <div style={styles.container}>
                    <div style={styles.header}>
                        <h1 style={styles.title}>
                            <FaCoins /> Token Whitelist Management
                        </h1>
                        <button
                            onClick={fetchTokens}
                            style={{ ...styles.button, ...styles.secondaryButton }}
                            disabled={loading}
                        >
                            <FaSync className={loading ? 'spin' : ''} /> Refresh
                        </button>
                    </div>

                    {error && (
                        <div style={{
                            backgroundColor: 'rgba(231, 76, 60, 0.1)',
                            border: '1px solid #e74c3c',
                            color: '#e74c3c',
                            padding: '15px',
                            borderRadius: '8px',
                            marginBottom: '20px'
                        }}>
                            {error}
                        </div>
                    )}

                    {/* Import from SwapRunner Section */}
                    <div style={styles.section}>
                        <h2 style={styles.sectionTitle}>
                            <FaSync /> Import from SwapRunner
                        </h2>
                        <p style={{ color: theme.colors.secondaryText, marginBottom: '16px' }}>
                            Import all available tokens from SwapRunner's token registry. This will add any new tokens 
                            that aren't already in your whitelist.
                        </p>
                        <p style={{ color: theme.colors.mutedText, fontSize: '0.85rem', marginBottom: '16px' }}>
                            SwapRunner Canister: <code style={{ backgroundColor: theme.colors.tertiaryBg, padding: '2px 6px', borderRadius: '4px' }}>tt72q-zqaaa-aaaaj-az4va-cai</code>
                        </p>
                        <button
                            onClick={handleImportFromSwapRunner}
                            style={{ ...styles.button, ...styles.primaryButton }}
                            disabled={importing}
                        >
                            {importing ? (
                                <>
                                    <FaSpinner className="spin" /> Importing...
                                </>
                            ) : (
                                <>
                                    <FaSync /> Import Tokens from SwapRunner
                                </>
                            )}
                        </button>
                        
                        {importResult && (
                            <div style={{
                                ...styles.importResult,
                                backgroundColor: importResult.success 
                                    ? 'rgba(46, 204, 113, 0.1)' 
                                    : 'rgba(231, 76, 60, 0.1)',
                                border: `1px solid ${importResult.success ? '#2ecc71' : '#e74c3c'}`,
                                color: importResult.success ? '#2ecc71' : '#e74c3c',
                            }}>
                                {importResult.success ? <FaCheckCircle /> : <FaExclamationTriangle />}
                                {importResult.message}
                            </div>
                        )}
                    </div>

                    {/* Refresh Token Metadata Section */}
                    <div style={styles.section}>
                        <h2 style={styles.sectionTitle}>
                            <FaSync /> Refresh Token Metadata
                        </h2>
                        <p style={{ color: theme.colors.secondaryText, marginBottom: '16px' }}>
                            Refresh metadata (name, symbol, decimals, fee) for a specific token by selecting from the whitelist or entering a custom ledger ID.
                        </p>
                        
                        <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start', flexWrap: 'wrap', marginBottom: '16px' }}>
                            <div style={{ flex: 1, minWidth: '250px' }}>
                                <label style={{ display: 'block', color: theme.colors.secondaryText, fontSize: '0.85rem', marginBottom: '6px' }}>
                                    Select from whitelist:
                                </label>
                                <select
                                    value={selectedRefreshToken}
                                    onChange={(e) => {
                                        setSelectedRefreshToken(e.target.value);
                                        setCustomRefreshLedger('');
                                        setSingleRefreshResult(null);
                                    }}
                                    style={{
                                        ...styles.input,
                                        cursor: 'pointer',
                                    }}
                                    disabled={customRefreshLedger.trim()}
                                >
                                    <option value="">-- Select a token --</option>
                                    {tokens.map((token) => (
                                        <option key={token.ledger_id.toString()} value={token.ledger_id.toString()}>
                                            {token.symbol} - {token.name}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', color: theme.colors.mutedText, paddingTop: '24px' }}>
                                OR
                            </div>
                            <div style={{ flex: 1, minWidth: '250px' }}>
                                <label style={{ display: 'block', color: theme.colors.secondaryText, fontSize: '0.85rem', marginBottom: '6px' }}>
                                    Enter custom ledger ID:
                                </label>
                                <input
                                    type="text"
                                    placeholder="e.g., ryjl3-tyaaa-aaaaa-aaaba-cai"
                                    value={customRefreshLedger}
                                    onChange={(e) => {
                                        setCustomRefreshLedger(e.target.value);
                                        setSelectedRefreshToken('');
                                        setSingleRefreshResult(null);
                                    }}
                                    style={styles.input}
                                />
                            </div>
                            <div style={{ paddingTop: '24px' }}>
                                <button
                                    onClick={handleRefreshSingleToken}
                                    style={{ ...styles.button, ...styles.primaryButton }}
                                    disabled={refreshingSingle || (!selectedRefreshToken && !customRefreshLedger.trim())}
                                >
                                    {refreshingSingle ? (
                                        <>
                                            <FaSpinner className="spin" /> Refreshing...
                                        </>
                                    ) : (
                                        <>
                                            <FaSync /> Refresh Metadata
                                        </>
                                    )}
                                </button>
                            </div>
                        </div>
                        
                        {singleRefreshResult && (
                            <div style={{
                                ...styles.importResult,
                                backgroundColor: singleRefreshResult.success 
                                    ? 'rgba(46, 204, 113, 0.1)' 
                                    : 'rgba(231, 76, 60, 0.1)',
                                border: `1px solid ${singleRefreshResult.success ? '#2ecc71' : '#e74c3c'}`,
                                color: singleRefreshResult.success ? '#2ecc71' : '#e74c3c',
                            }}>
                                {singleRefreshResult.success ? <FaCheckCircle /> : <FaExclamationTriangle />}
                                {singleRefreshResult.message}
                            </div>
                        )}
                    </div>

                    {/* Refresh All Tokens Section */}
                    <div style={styles.section}>
                        <h2 style={styles.sectionTitle}>
                            <FaSync /> Refresh All Token Metadata
                        </h2>
                        <p style={{ color: theme.colors.secondaryText, marginBottom: '16px' }}>
                            Refresh metadata for all {tokens.length} whitelisted tokens. This may take some time depending on the number of tokens.
                        </p>
                        <button
                            onClick={handleRefreshAllTokens}
                            style={{ ...styles.button, ...styles.secondaryButton }}
                            disabled={refreshingAll || tokens.length === 0}
                        >
                            {refreshingAll ? (
                                <>
                                    <FaSpinner className="spin" /> Refreshing {tokens.length} tokens...
                                </>
                            ) : (
                                <>
                                    <FaSync /> Refresh All Tokens
                                </>
                            )}
                        </button>
                        
                        {refreshAllResult && (
                            <div style={{
                                ...styles.importResult,
                                backgroundColor: refreshAllResult.success 
                                    ? 'rgba(46, 204, 113, 0.1)' 
                                    : 'rgba(231, 76, 60, 0.1)',
                                border: `1px solid ${refreshAllResult.success ? '#2ecc71' : '#e74c3c'}`,
                                color: refreshAllResult.success ? '#2ecc71' : '#e74c3c',
                            }}>
                                {refreshAllResult.success ? <FaCheckCircle /> : <FaExclamationTriangle />}
                                {refreshAllResult.message}
                            </div>
                        )}
                        
                        {refreshAllResult && refreshAllResult.errors && refreshAllResult.errors.length > 0 && (
                            <div style={{
                                marginTop: '12px',
                                padding: '12px',
                                backgroundColor: theme.colors.tertiaryBg,
                                borderRadius: '8px',
                                maxHeight: '200px',
                                overflow: 'auto',
                            }}>
                                <div style={{ color: theme.colors.secondaryText, fontSize: '0.85rem', marginBottom: '8px' }}>
                                    Failed tokens:
                                </div>
                                {refreshAllResult.errors.map((error, idx) => (
                                    <div key={idx} style={{ 
                                        color: theme.colors.mutedText, 
                                        fontSize: '0.8rem', 
                                        fontFamily: 'monospace',
                                        padding: '4px 0',
                                        borderBottom: idx < refreshAllResult.errors.length - 1 ? `1px solid ${theme.colors.border}` : 'none'
                                    }}>
                                        {error}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Add Token Manually Section */}
                    <div style={styles.section}>
                        <h2 style={styles.sectionTitle}>
                            <FaPlus /> Add Token Manually
                        </h2>
                        <p style={{ color: theme.colors.secondaryText, marginBottom: '16px' }}>
                            Add a specific ICRC1 token by its ledger canister ID.
                        </p>
                        
                        <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
                            <div style={{ flex: 1, minWidth: '300px' }}>
                                <input
                                    type="text"
                                    placeholder="Enter ledger canister ID (e.g., ryjl3-tyaaa-aaaaa-aaaba-cai)"
                                    value={newLedgerId}
                                    onChange={(e) => {
                                        setNewLedgerId(e.target.value);
                                        setVerifiedToken(null);
                                    }}
                                    style={styles.input}
                                />
                            </div>
                            <button
                                onClick={handleVerifyToken}
                                style={{ ...styles.button, ...styles.secondaryButton }}
                                disabled={verifyingToken || !newLedgerId.trim()}
                            >
                                {verifyingToken ? (
                                    <>
                                        <FaSpinner className="spin" /> Verifying...
                                    </>
                                ) : (
                                    <>
                                        <FaSearch /> Verify
                                    </>
                                )}
                            </button>
                        </div>

                        {verifiedToken && (
                            <div style={styles.verifiedTokenPreview}>
                                <div style={styles.tokenLogo}>
                                    {verifiedToken.logo ? (
                                        <img 
                                            src={verifiedToken.logo} 
                                            alt={verifiedToken.symbol}
                                            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                                        />
                                    ) : (
                                        <span style={{ fontSize: '1.2rem' }}>{verifiedToken.symbol?.charAt(0) || '?'}</span>
                                    )}
                                </div>
                                <div style={styles.tokenInfo}>
                                    <div style={styles.tokenSymbol}>{verifiedToken.symbol}</div>
                                    <div style={styles.tokenName}>{verifiedToken.name}</div>
                                    <div style={styles.tokenLedger}>
                                        Decimals: {verifiedToken.decimals} | Fee: {verifiedToken.fee}
                                    </div>
                                </div>
                                <button
                                    onClick={handleAddToken}
                                    style={{ ...styles.button, ...styles.primaryButton }}
                                    disabled={addingToken}
                                >
                                    {addingToken ? (
                                        <>
                                            <FaSpinner className="spin" /> Adding...
                                        </>
                                    ) : (
                                        <>
                                            <FaPlus /> Add to Whitelist
                                        </>
                                    )}
                                </button>
                            </div>
                        )}
                    </div>

                    {/* Current Whitelisted Tokens Section */}
                    <div style={styles.section}>
                        <h2 style={styles.sectionTitle}>
                            <FaCoins /> Whitelisted Tokens
                        </h2>
                        
                        <div style={styles.searchContainer}>
                            <FaSearch style={styles.searchIcon} />
                            <input
                                type="text"
                                placeholder="Search by symbol, name, or ledger ID..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                style={styles.searchInput}
                            />
                        </div>
                        
                        <div style={styles.stats}>
                            Showing {filteredTokens.length} of {tokens.length} tokens
                        </div>

                        <div style={styles.tokenGrid}>
                            {filteredTokens.map((token) => {
                                const ledgerId = token.ledger_id.toString();
                                const logo = tokenLogos[ledgerId];
                                const isRemoving = removingToken === ledgerId;
                                
                                return (
                                    <div 
                                        key={ledgerId} 
                                        style={styles.tokenCard}
                                        onMouseEnter={(e) => e.currentTarget.style.transform = 'translateY(-2px)'}
                                        onMouseLeave={(e) => e.currentTarget.style.transform = 'translateY(0)'}
                                    >
                                        <div style={styles.tokenLogo}>
                                            {logo ? (
                                                <img 
                                                    src={logo} 
                                                    alt={token.symbol}
                                                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                                                />
                                            ) : (
                                                <span style={{ 
                                                    fontSize: '1.2rem', 
                                                    color: theme.colors.secondaryText 
                                                }}>
                                                    {token.symbol?.charAt(0) || '?'}
                                                </span>
                                            )}
                                        </div>
                                        <div style={styles.tokenInfo}>
                                            <div style={styles.tokenSymbol}>{token.symbol}</div>
                                            <div style={styles.tokenName}>{token.name}</div>
                                            <div style={styles.tokenLedger} title={ledgerId}>
                                                {ledgerId.slice(0, 10)}...{ledgerId.slice(-5)}
                                            </div>
                                        </div>
                                        <button
                                            onClick={() => handleRemoveToken(token)}
                                            style={styles.removeButton}
                                            disabled={isRemoving}
                                            title="Remove from whitelist"
                                            onMouseEnter={(e) => {
                                                e.currentTarget.style.backgroundColor = 'rgba(231, 76, 60, 0.2)';
                                                e.currentTarget.style.color = '#e74c3c';
                                            }}
                                            onMouseLeave={(e) => {
                                                e.currentTarget.style.backgroundColor = 'transparent';
                                                e.currentTarget.style.color = theme.colors.mutedText;
                                            }}
                                        >
                                            {isRemoving ? (
                                                <FaSpinner className="spin" />
                                            ) : (
                                                <FaTrash />
                                            )}
                                        </button>
                                    </div>
                                );
                            })}
                        </div>

                        {filteredTokens.length === 0 && !loading && (
                            <div style={{ 
                                textAlign: 'center', 
                                padding: '40px', 
                                color: theme.colors.mutedText 
                            }}>
                                {searchTerm ? 'No tokens match your search.' : 'No whitelisted tokens yet.'}
                            </div>
                        )}
                    </div>
                </div>
            </main>

            {/* Modals */}
            <InfoModal
                isOpen={infoModal.show}
                onClose={closeInfoModal}
                title={infoModal.title}
                message={infoModal.message}
                type={infoModal.type}
            />
            
            <ConfirmationModal
                isOpen={confirmModal.show}
                onClose={closeConfirmModal}
                onConfirm={confirmModal.onConfirm}
                title={confirmModal.title}
                message={confirmModal.message}
            />

            <style>{`
                .spin {
                    animation: spin 1s linear infinite;
                }
                @keyframes spin {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(360deg); }
                }
            `}</style>
        </div>
    );
}
