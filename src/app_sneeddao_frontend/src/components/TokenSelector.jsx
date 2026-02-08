import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../AuthContext';
import { useWhitelistTokens } from '../contexts/WhitelistTokensContext';
import { createActor as createLedgerActor } from 'external/icrc1_ledger';
import { getTokenLogo } from '../utils/TokenUtils';
import { Principal } from '@dfinity/principal';

// Global cache for token metadata (logos and errors)
const metadataCache = new Map();
const failedTokens = new Set(); // Track tokens that failed to load
// Stable empty array reference to avoid infinite re-render loops
// (default `[]` in function params creates a new reference each render)
const EMPTY_EXCLUDE_TOKENS = [];

/**
 * TokenSelector - A reusable dropdown component for selecting tokens
 * 
 * Features:
 * - Shows logo, symbol, and name for each token
 * - Searchable/filterable
 * - Uses cached token metadata when possible
 * - Fetches from backend's whitelisted tokens
 * - Optional manual ledger entry for tokens not in the list
 * 
 * Props:
 * - value: Selected token principal (string)
 * - onChange: Callback when token is selected (principal: string) => void
 * - onSelectToken: Optional callback with full token data including logo (token: object) => void
 * - placeholder: Placeholder text
 * - disabled: Whether the selector is disabled
 * - style: Additional styles for the container
 * - excludeTokens: Array of token principals to exclude from the list
 * - allowCustom: Allow manual ledger ID entry (default: false)
 */
function TokenSelector({ 
    value, 
    onChange, 
    onSelectToken,
    placeholder = "Select a token...", 
    disabled = false,
    style = {},
    excludeTokens = EMPTY_EXCLUDE_TOKENS,
    allowCustom = false
}) {
    const { theme } = useTheme();
    const { identity } = useAuth();
    const { whitelistedTokens: whitelistFromContext, loading: whitelistLoading } = useWhitelistTokens();
    
    // Stabilize excludeTokens by content so callers passing inline arrays don't cause infinite re-renders
    const excludeTokensKey = useMemo(() => excludeTokens.join(','), [excludeTokens]);
    
    const [tokens, setTokens] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [isOpen, setIsOpen] = useState(false);
    const [tokensWithLogos, setTokensWithLogos] = useState([]);
    const [loadingLogos, setLoadingLogos] = useState(true);
    
    // Custom ledger entry state
    const [showCustomEntry, setShowCustomEntry] = useState(false);
    const [customLedgerId, setCustomLedgerId] = useState('');
    const [customLedgerError, setCustomLedgerError] = useState('');
    const [verifyingCustomLedger, setVerifyingCustomLedger] = useState(false);
    const [customTokenInfo, setCustomTokenInfo] = useState(null); // Verified custom token metadata

    // Verify custom ledger ID by fetching its ICRC1 metadata
    const verifyCustomLedger = useCallback(async () => {
        if (!customLedgerId.trim()) {
            setCustomLedgerError('Please enter a ledger ID');
            return;
        }
        
        // Validate principal format
        try {
            Principal.fromText(customLedgerId.trim());
        } catch (e) {
            setCustomLedgerError('Invalid principal format');
            return;
        }
        
        setVerifyingCustomLedger(true);
        setCustomLedgerError('');
        setCustomTokenInfo(null);
        
        try {
            const ledgerActor = createLedgerActor(customLedgerId.trim(), {
                agentOptions: { identity }
            });
            
            const metadata = await ledgerActor.icrc1_metadata();
            
            // Extract token info from metadata
            let symbol = 'TOKEN';
            let name = 'Unknown Token';
            let decimals = 8;
            let fee = 0n;
            let logo = '';
            
            for (const [key, value] of metadata) {
                if (key === 'icrc1:symbol' && 'Text' in value) {
                    symbol = value.Text;
                } else if (key === 'icrc1:name' && 'Text' in value) {
                    name = value.Text;
                } else if (key === 'icrc1:decimals' && 'Nat' in value) {
                    decimals = Number(value.Nat);
                } else if (key === 'icrc1:fee' && 'Nat' in value) {
                    fee = value.Nat;
                } else if (key === 'icrc1:logo' && 'Text' in value) {
                    logo = value.Text;
                }
            }
            
            const tokenInfo = {
                ledger_id: customLedgerId.trim(),
                symbol,
                name,
                decimals,
                fee,
                logo
            };
            
            setCustomTokenInfo(tokenInfo);
        } catch (error) {
            console.error('Error verifying custom ledger:', error);
            setCustomLedgerError('Failed to verify ledger. Make sure this is a valid ICRC1 token ledger.');
        } finally {
            setVerifyingCustomLedger(false);
        }
    }, [customLedgerId, identity]);

    // Handle selecting custom token
    const handleSelectCustomToken = useCallback(() => {
        if (!customTokenInfo) return;
        
        onChange(customTokenInfo.ledger_id);
        if (onSelectToken) {
            onSelectToken(customTokenInfo);
        }
        setIsOpen(false);
        setSearchTerm('');
        setShowCustomEntry(false);
        setCustomLedgerId('');
        setCustomTokenInfo(null);
    }, [customTokenInfo, onChange, onSelectToken]);

    // Use whitelist from context (single cache), filter excluded
    useEffect(() => {
        const filtered = whitelistFromContext.filter(
            token => !excludeTokens.includes(token.ledger_id?.toString?.() ?? String(token.ledger_id))
        );
        setTokens(filtered);
        setLoading(whitelistLoading);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [whitelistFromContext, excludeTokensKey, whitelistLoading]);

    // Fetch logos for tokens progressively (using cache)
    useEffect(() => {
        if (tokens.length === 0) return;

        let isMounted = true;
        setLoadingLogos(true);

        const fetchLogosProgressively = async () => {
            // Initialize with cached or placeholder data
            const initialTokens = tokens.map(token => {
                const principalStr = token.ledger_id.toString();
                
                if (metadataCache.has(principalStr)) {
                    const cached = metadataCache.get(principalStr);
                    return { ...token, ...cached };
                }
                
                return {
                    ...token,
                    logo: '',
                    loading: true
                };
            });

            if (isMounted) {
                setTokensWithLogos(initialTokens);
            }

            // Fetch logos progressively
            for (let i = 0; i < tokens.length; i++) {
                if (!isMounted) break;

                const token = tokens[i];
                const principalStr = token.ledger_id.toString();

                // Skip if already cached or previously failed
                if (metadataCache.has(principalStr) || failedTokens.has(principalStr)) {
                    continue;
                }

                try {
                    const ledgerActor = createLedgerActor(token.ledger_id, {
                        agentOptions: { identity }
                    });
                    const metadata = await ledgerActor.icrc1_metadata();
                    const logo = getTokenLogo(metadata);
                    const finalLogo = token.symbol.toLowerCase() === "icp" && logo === "" 
                        ? "icp_symbol.svg" 
                        : logo;
                    
                    // Cache successful result
                    const tokenData = {
                        logo: finalLogo,
                        loading: false,
                        failed: false
                    };
                    metadataCache.set(principalStr, tokenData);
                    
                    // Update state progressively
                    if (isMounted) {
                        setTokensWithLogos(prev => prev.map(t => 
                            t.ledger_id.toString() === principalStr 
                                ? { ...t, ...tokenData }
                                : t
                        ));
                    }
                } catch (error) {
                    // Silently handle error, cache as failed
                    const failedData = {
                        logo: '',
                        loading: false,
                        failed: true,
                        symbol: 'Unknown',
                        name: 'Unknown Token'
                    };
                    metadataCache.set(principalStr, failedData);
                    failedTokens.add(principalStr);
                    
                    // Update state with failed token
                    if (isMounted) {
                        setTokensWithLogos(prev => prev.map(t => 
                            t.ledger_id.toString() === principalStr 
                                ? { ...t, ...failedData }
                                : t
                        ));
                    }
                }
            }

            if (isMounted) {
                setLoadingLogos(false);
            }
        };

        fetchLogosProgressively();

        return () => {
            isMounted = false;
        };
    }, [tokens, identity]);

    // Filter tokens based on search term (exclude failed tokens)
    const filteredTokens = useMemo(() => {
        // Filter out failed tokens
        const validTokens = tokensWithLogos.filter(token => !token.failed);

        if (!searchTerm.trim()) {
            return validTokens;
        }

        const lowerSearch = searchTerm.toLowerCase();
        return validTokens.filter(token => 
            token.symbol.toLowerCase().includes(lowerSearch) ||
            token.name.toLowerCase().includes(lowerSearch) ||
            token.ledger_id.toString().toLowerCase().includes(lowerSearch)
        );
    }, [tokensWithLogos, searchTerm]);

    // Find selected token
    const selectedToken = tokensWithLogos.find(
        token => token.ledger_id.toString() === value
    );

    // Handle token selection
    const handleSelect = (token) => {
        onChange(token.ledger_id.toString());
        // Also pass full token data including logo if callback provided
        if (onSelectToken) {
            onSelectToken({
                ledger_id: token.ledger_id.toString(),
                symbol: token.symbol,
                name: token.name,
                decimals: token.decimals,
                fee: token.fee,
                logo: token.logo || ''
            });
        }
        setIsOpen(false);
        setSearchTerm('');
    };

    // Close dropdown when clicking outside (handled differently with portal)
    useEffect(() => {
        if (!isOpen) return;

        const handleClickOutside = (event) => {
            // Check if click is on the trigger button
            const trigger = event.target.closest('.token-selector-trigger');
            if (trigger) return;

            // Check if click is inside the portal dropdown
            const dropdown = event.target.closest('.token-selector-dropdown');
            if (dropdown) return;

            // Click was outside - close dropdown
            setIsOpen(false);
            setSearchTerm('');
        };

        // Use timeout to avoid catching the opening click
        setTimeout(() => {
            document.addEventListener('mousedown', handleClickOutside);
        }, 0);

        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isOpen]);

    return (
        <div 
            className="token-selector-container" 
            style={{
                position: 'relative',
                width: '100%',
                ...style
            }}
        >
            {/* Selected token or placeholder */}
            <div
                className="token-selector-trigger"
                onClick={() => !disabled && !loading && setIsOpen(!isOpen)}
                style={{
                    width: '100%',
                    padding: '12px',
                    background: disabled ? theme.colors.tertiaryBg : theme.colors.secondaryBg,
                    border: `1px solid ${isOpen ? theme.colors.accent : theme.colors.border}`,
                    borderRadius: '8px',
                    color: selectedToken ? theme.colors.primaryText : theme.colors.mutedText,
                    fontSize: '0.9rem',
                    boxSizing: 'border-box',
                    cursor: disabled || loading ? 'not-allowed' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    transition: 'all 0.2s ease'
                }}
            >
                {loading ? (
                    <span>Loading tokens...</span>
                ) : selectedToken ? (
                    <>
                        {selectedToken.logo && (
                            <img 
                                src={selectedToken.logo} 
                                alt={selectedToken.symbol}
                                style={{
                                    width: '24px',
                                    height: '24px',
                                    borderRadius: '50%',
                                    objectFit: 'cover'
                                }}
                                onError={(e) => e.target.style.display = 'none'}
                            />
                        )}
                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '2px' }}>
                            <span style={{ fontWeight: '600', color: theme.colors.primaryText }}>
                                {selectedToken.symbol}
                            </span>
                            <span style={{ fontSize: '0.8rem', color: theme.colors.mutedText }}>
                                {selectedToken.name}
                            </span>
                        </div>
                    </>
                ) : (
                    <span>{placeholder}</span>
                )}
                <span style={{ marginLeft: 'auto', color: theme.colors.mutedText }}>
                    {isOpen ? '▲' : '▼'}
                </span>
            </div>

            {/* Dropdown - Use portal for proper z-index layering */}
            {isOpen && !disabled && createPortal(
                <div
                    className="token-selector-dropdown"
                    style={{
                        position: 'fixed',
                        top: '50%',
                        left: '50%',
                        transform: 'translate(-50%, -50%)',
                        background: theme.colors.primaryBg,
                        border: `1px solid ${theme.colors.border}`,
                        borderRadius: '8px',
                        boxShadow: theme.colors.cardShadow,
                        zIndex: 10000,
                        width: '90%',
                        maxWidth: '500px',
                        maxHeight: '80vh',
                        overflow: 'hidden',
                        display: 'flex',
                        flexDirection: 'column'
                    }}
                >
                    {/* Search input */}
                    <div style={{ padding: '12px', borderBottom: `1px solid ${theme.colors.border}` }}>
                        <input
                            type="text"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            placeholder="Search tokens..."
                            autoFocus
                            style={{
                                width: '100%',
                                padding: '8px 12px',
                                background: theme.colors.secondaryBg,
                                border: `1px solid ${theme.colors.border}`,
                                borderRadius: '6px',
                                color: theme.colors.primaryText,
                                fontSize: '0.85rem',
                                boxSizing: 'border-box',
                                outline: 'none'
                            }}
                        />
                    </div>

                    {/* Token list */}
                    <div style={{ overflowY: 'auto', flex: 1 }}>
                        {loading ? (
                            <div style={{ 
                                padding: '40px', 
                                textAlign: 'center', 
                                color: theme.colors.mutedText,
                                fontSize: '0.9rem'
                            }}>
                                <div className="spinner" style={{
                                    width: '32px',
                                    height: '32px',
                                    border: `3px solid ${theme.colors.border}`,
                                    borderTop: `3px solid ${theme.colors.accent}`,
                                    borderRadius: '50%',
                                    animation: 'spin 1s linear infinite',
                                    margin: '0 auto 12px'
                                }}></div>
                                Loading tokens...
                            </div>
                        ) : filteredTokens.length === 0 && !allowCustom ? (
                            <div style={{ 
                                padding: '40px', 
                                textAlign: 'center', 
                                color: theme.colors.mutedText,
                                fontSize: '0.9rem'
                            }}>
                                No tokens found
                            </div>
                        ) : filteredTokens.length === 0 && allowCustom ? (
                            <div style={{ 
                                padding: '20px', 
                                textAlign: 'center', 
                                color: theme.colors.mutedText,
                                fontSize: '0.9rem'
                            }}>
                                No tokens found. Use the manual entry below.
                            </div>
                        ) : (
                            filteredTokens.map((token) => (
                                <div
                                    key={token.ledger_id.toString()}
                                    onClick={() => handleSelect(token)}
                                    style={{
                                        padding: '12px',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '12px',
                                        cursor: 'pointer',
                                        borderBottom: `1px solid ${theme.colors.border}`,
                                        transition: 'all 0.2s ease',
                                        background: value === token.ledger_id.toString() 
                                            ? `${theme.colors.accent}15` 
                                            : 'transparent'
                                    }}
                                    onMouseEnter={(e) => {
                                        e.currentTarget.style.background = `${theme.colors.accent}15`;
                                    }}
                                    onMouseLeave={(e) => {
                                        if (value !== token.ledger_id.toString()) {
                                            e.currentTarget.style.background = 'transparent';
                                        }
                                    }}
                                >
                                    {token.logo ? (
                                        <img 
                                            src={token.logo} 
                                            alt={token.symbol}
                                            style={{
                                                width: '32px',
                                                height: '32px',
                                                borderRadius: '50%',
                                                objectFit: 'cover',
                                                flexShrink: 0
                                            }}
                                            onError={(e) => e.target.style.display = 'none'}
                                        />
                                    ) : (
                                        <div style={{
                                            width: '32px',
                                            height: '32px',
                                            borderRadius: '50%',
                                            background: theme.colors.secondaryBg,
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            fontWeight: '600',
                                            fontSize: '0.9rem',
                                            color: theme.colors.mutedText,
                                            flexShrink: 0
                                        }}>
                                            {token.symbol.slice(0, 2).toUpperCase()}
                                        </div>
                                    )}
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ 
                                            fontWeight: '600', 
                                            color: theme.colors.primaryText,
                                            fontSize: '0.9rem'
                                        }}>
                                            {token.symbol}
                                        </div>
                                        <div style={{ 
                                            fontSize: '0.8rem', 
                                            color: theme.colors.mutedText,
                                            overflow: 'hidden',
                                            textOverflow: 'ellipsis',
                                            whiteSpace: 'nowrap'
                                        }}>
                                            {token.name}
                                        </div>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>

                    {/* Manual entry section (when allowCustom is true) */}
                    {allowCustom && (
                        <div style={{ 
                            padding: '12px', 
                            borderTop: `1px solid ${theme.colors.border}`,
                            background: theme.colors.secondaryBg
                        }}>
                            {!showCustomEntry ? (
                                <button
                                    onClick={() => setShowCustomEntry(true)}
                                    style={{
                                        width: '100%',
                                        padding: '10px',
                                        background: 'transparent',
                                        color: theme.colors.accent,
                                        border: `1px dashed ${theme.colors.accent}`,
                                        borderRadius: '6px',
                                        cursor: 'pointer',
                                        fontSize: '0.85rem',
                                        fontWeight: '500'
                                    }}
                                >
                                    + Enter ledger ID manually
                                </button>
                            ) : (
                                <div>
                                    <div style={{ 
                                        fontSize: '0.85rem', 
                                        fontWeight: '600', 
                                        color: theme.colors.primaryText,
                                        marginBottom: '8px' 
                                    }}>
                                        Manual Ledger Entry
                                    </div>
                                    <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                                        <input
                                            type="text"
                                            value={customLedgerId}
                                            onChange={(e) => {
                                                setCustomLedgerId(e.target.value);
                                                setCustomLedgerError('');
                                                setCustomTokenInfo(null);
                                            }}
                                            placeholder="Ledger canister ID"
                                            style={{
                                                flex: 1,
                                                padding: '8px 12px',
                                                background: theme.colors.primaryBg,
                                                border: `1px solid ${customLedgerError ? theme.colors.error : theme.colors.border}`,
                                                borderRadius: '6px',
                                                color: theme.colors.primaryText,
                                                fontSize: '0.85rem',
                                                boxSizing: 'border-box',
                                                outline: 'none'
                                            }}
                                        />
                                        <button
                                            onClick={verifyCustomLedger}
                                            disabled={verifyingCustomLedger || !customLedgerId.trim()}
                                            style={{
                                                padding: '8px 16px',
                                                background: theme.colors.accent,
                                                color: '#fff',
                                                border: 'none',
                                                borderRadius: '6px',
                                                cursor: verifyingCustomLedger || !customLedgerId.trim() ? 'not-allowed' : 'pointer',
                                                fontSize: '0.85rem',
                                                fontWeight: '500',
                                                opacity: verifyingCustomLedger || !customLedgerId.trim() ? 0.5 : 1,
                                                whiteSpace: 'nowrap'
                                            }}
                                        >
                                            {verifyingCustomLedger ? 'Verifying...' : 'Verify'}
                                        </button>
                                    </div>
                                    
                                    {/* Error message */}
                                    {customLedgerError && (
                                        <div style={{ 
                                            color: theme.colors.error, 
                                            fontSize: '0.8rem',
                                            marginBottom: '8px'
                                        }}>
                                            {customLedgerError}
                                        </div>
                                    )}
                                    
                                    {/* Verified token info */}
                                    {customTokenInfo && (
                                        <div style={{
                                            padding: '12px',
                                            background: `${theme.colors.success}15`,
                                            border: `1px solid ${theme.colors.success}40`,
                                            borderRadius: '8px',
                                            marginBottom: '8px'
                                        }}>
                                            <div style={{ 
                                                display: 'flex', 
                                                alignItems: 'center', 
                                                gap: '12px',
                                                marginBottom: '8px'
                                            }}>
                                                {customTokenInfo.logo ? (
                                                    <img 
                                                        src={customTokenInfo.logo} 
                                                        alt={customTokenInfo.symbol}
                                                        style={{
                                                            width: '32px',
                                                            height: '32px',
                                                            borderRadius: '50%',
                                                            objectFit: 'cover'
                                                        }}
                                                        onError={(e) => e.target.style.display = 'none'}
                                                    />
                                                ) : (
                                                    <div style={{
                                                        width: '32px',
                                                        height: '32px',
                                                        borderRadius: '50%',
                                                        background: theme.colors.tertiaryBg,
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        justifyContent: 'center',
                                                        fontWeight: '600',
                                                        fontSize: '0.8rem',
                                                        color: theme.colors.mutedText
                                                    }}>
                                                        {customTokenInfo.symbol.slice(0, 2).toUpperCase()}
                                                    </div>
                                                )}
                                                <div>
                                                    <div style={{ 
                                                        fontWeight: '600', 
                                                        color: theme.colors.primaryText 
                                                    }}>
                                                        {customTokenInfo.symbol}
                                                    </div>
                                                    <div style={{ 
                                                        fontSize: '0.8rem', 
                                                        color: theme.colors.secondaryText 
                                                    }}>
                                                        {customTokenInfo.name}
                                                    </div>
                                                </div>
                                            </div>
                                            <div style={{ 
                                                fontSize: '0.75rem', 
                                                color: theme.colors.mutedText 
                                            }}>
                                                Decimals: {customTokenInfo.decimals}
                                            </div>
                                            <button
                                                onClick={handleSelectCustomToken}
                                                style={{
                                                    width: '100%',
                                                    marginTop: '8px',
                                                    padding: '8px',
                                                    background: theme.colors.success,
                                                    color: '#fff',
                                                    border: 'none',
                                                    borderRadius: '6px',
                                                    cursor: 'pointer',
                                                    fontSize: '0.85rem',
                                                    fontWeight: '600'
                                                }}
                                            >
                                                Use this token
                                            </button>
                                        </div>
                                    )}
                                    
                                    <button
                                        onClick={() => {
                                            setShowCustomEntry(false);
                                            setCustomLedgerId('');
                                            setCustomLedgerError('');
                                            setCustomTokenInfo(null);
                                        }}
                                        style={{
                                            padding: '6px 12px',
                                            background: 'transparent',
                                            color: theme.colors.mutedText,
                                            border: 'none',
                                            cursor: 'pointer',
                                            fontSize: '0.8rem'
                                        }}
                                    >
                                        Cancel
                                    </button>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Close button */}
                    <div style={{ 
                        padding: '12px', 
                        borderTop: `1px solid ${theme.colors.border}`,
                        display: 'flex',
                        justifyContent: 'flex-end'
                    }}>
                        <button
                            onClick={() => {
                                setIsOpen(false);
                                setSearchTerm('');
                                setShowCustomEntry(false);
                                setCustomLedgerId('');
                                setCustomLedgerError('');
                                setCustomTokenInfo(null);
                            }}
                            style={{
                                padding: '8px 24px',
                                background: theme.colors.secondaryBg,
                                color: theme.colors.primaryText,
                                border: `1px solid ${theme.colors.border}`,
                                borderRadius: '6px',
                                cursor: 'pointer',
                                fontSize: '0.9rem',
                                fontWeight: '500'
                            }}
                        >
                            Close
                        </button>
                    </div>
                </div>,
                document.body
            )}
        </div>
    );
}

export default TokenSelector;

