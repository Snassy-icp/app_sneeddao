import React, { useState, useEffect, useMemo } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../AuthContext';
import { createActor as createBackendActor } from 'declarations/app_sneeddao_backend';
import { createActor as createLedgerActor } from 'external/icrc1_ledger';
import { getTokenLogo } from '../utils/TokenUtils';

const backendCanisterId = process.env.CANISTER_ID_APP_SNEEDDAO_BACKEND || process.env.REACT_APP_BACKEND_CANISTER_ID;

// Global cache for token metadata (logos)
const logoCache = new Map();

/**
 * TokenSelector - A reusable dropdown component for selecting tokens
 * 
 * Features:
 * - Shows logo, symbol, and name for each token
 * - Searchable/filterable
 * - Uses cached token metadata when possible
 * - Fetches from backend's whitelisted tokens
 * 
 * Props:
 * - value: Selected token principal (string)
 * - onChange: Callback when token is selected (principal: string) => void
 * - placeholder: Placeholder text
 * - disabled: Whether the selector is disabled
 * - style: Additional styles for the container
 * - excludeTokens: Array of token principals to exclude from the list
 */
function TokenSelector({ 
    value, 
    onChange, 
    placeholder = "Select a token...", 
    disabled = false,
    style = {},
    excludeTokens = []
}) {
    const { theme } = useTheme();
    const { identity } = useAuth();
    
    const [tokens, setTokens] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [isOpen, setIsOpen] = useState(false);
    const [tokensWithLogos, setTokensWithLogos] = useState([]);

    // Fetch whitelisted tokens
    useEffect(() => {
        const fetchTokens = async () => {
            try {
                const backendActor = createBackendActor(backendCanisterId, {
                    agentOptions: { identity }
                });
                const whitelistedTokens = await backendActor.get_whitelisted_tokens();
                
                // Filter out excluded tokens
                const filteredTokens = whitelistedTokens.filter(
                    token => !excludeTokens.includes(token.ledger_id.toString())
                );
                
                setTokens(filteredTokens);
            } catch (error) {
                console.error('Error fetching whitelisted tokens:', error);
            } finally {
                setLoading(false);
            }
        };

        fetchTokens();
    }, [identity, excludeTokens]);

    // Fetch logos for tokens (using cache)
    useEffect(() => {
        const fetchLogos = async () => {
            const tokensWithLogoData = await Promise.all(
                tokens.map(async (token) => {
                    const principalStr = token.ledger_id.toString();
                    
                    // Check cache first
                    if (logoCache.has(principalStr)) {
                        return {
                            ...token,
                            logo: logoCache.get(principalStr)
                        };
                    }

                    // Fetch logo from ledger
                    try {
                        const ledgerActor = createLedgerActor(token.ledger_id, {
                            agentOptions: { identity }
                        });
                        const metadata = await ledgerActor.icrc1_metadata();
                        const logo = getTokenLogo(metadata);
                        const finalLogo = token.symbol.toLowerCase() === "icp" && logo === "" 
                            ? "icp_symbol.svg" 
                            : logo;
                        
                        // Cache it
                        logoCache.set(principalStr, finalLogo);
                        
                        return {
                            ...token,
                            logo: finalLogo
                        };
                    } catch (error) {
                        console.error(`Error fetching logo for token ${principalStr}:`, error);
                        return {
                            ...token,
                            logo: ''
                        };
                    }
                })
            );

            setTokensWithLogos(tokensWithLogoData);
        };

        if (tokens.length > 0) {
            fetchLogos();
        }
    }, [tokens, identity]);

    // Filter tokens based on search term
    const filteredTokens = useMemo(() => {
        if (!searchTerm.trim()) {
            return tokensWithLogos;
        }

        const lowerSearch = searchTerm.toLowerCase();
        return tokensWithLogos.filter(token => 
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
        setIsOpen(false);
        setSearchTerm('');
    };

    // Close dropdown when clicking outside
    useEffect(() => {
        const handleClickOutside = (event) => {
            if (isOpen && !event.target.closest('.token-selector-container')) {
                setIsOpen(false);
                setSearchTerm('');
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
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

            {/* Dropdown */}
            {isOpen && !disabled && (
                <div
                    style={{
                        position: 'absolute',
                        top: '100%',
                        left: 0,
                        right: 0,
                        marginTop: '4px',
                        background: theme.colors.cardGradient,
                        border: `1px solid ${theme.colors.border}`,
                        borderRadius: '8px',
                        boxShadow: theme.colors.cardShadow,
                        zIndex: 1000,
                        maxHeight: '400px',
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
                    <div style={{ overflowY: 'auto', maxHeight: '320px' }}>
                        {filteredTokens.length === 0 ? (
                            <div style={{ 
                                padding: '20px', 
                                textAlign: 'center', 
                                color: theme.colors.mutedText,
                                fontSize: '0.9rem'
                            }}>
                                No tokens found
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
                </div>
            )}
        </div>
    );
}

export default TokenSelector;

