import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Principal } from '@dfinity/principal';
import { useTheme } from '../contexts/ThemeContext';
import { useTokenMetadata } from '../hooks/useTokenMetadata';
import { formatPrincipal } from '../utils/PrincipalUtils';

const TipDisplay = ({ tips = [], tokenInfo = new Map(), principalDisplayInfo = new Map(), isNarrowScreen = false }) => {
    const { theme } = useTheme();
    const [hoveredToken, setHoveredToken] = useState(null);
    const [tooltipPosition, setTooltipPosition] = useState({ x: 0, y: 0 });
    
    // Use the token metadata hook
    const { fetchTokenMetadata, getTokenMetadata, isLoadingMetadata } = useTokenMetadata();

    // Fetch metadata for all unique tokens when tips change
    useEffect(() => {
        if (!tips || tips.length === 0) return;

        const uniqueTokens = [...new Set(tips.map(tip => tip.token_ledger_principal))];
        
        uniqueTokens.forEach(tokenPrincipal => {
            // Only fetch if we don't have metadata and it's not provided in tokenInfo
            const tokenKey = tokenPrincipal.toString();
            if (!tokenInfo.has(tokenKey) && !getTokenMetadata(tokenPrincipal)) {
                fetchTokenMetadata(tokenPrincipal);
            }
        });
    }, [tips, tokenInfo, fetchTokenMetadata, getTokenMetadata]);

    if (!tips || tips.length === 0) {
        return null;
    }

    // Group tips by token
    const tipsByToken = tips.reduce((acc, tip) => {
        const tokenKey = tip.token_ledger_principal.toString();
        if (!acc[tokenKey]) {
            acc[tokenKey] = {
                principal: tip.token_ledger_principal,
                tips: [],
                totalAmount: 0
            };
        }
        acc[tokenKey].tips.push(tip);
        acc[tokenKey].totalAmount += Number(tip.amount);
        return acc;
    }, {});

    const formatAmount = (amount, decimals = 8) => {
        const formatted = (amount / Math.pow(10, decimals)).toLocaleString(undefined, {
            minimumFractionDigits: 0,
            maximumFractionDigits: decimals
        });
        return formatted;
    };

    const formatTimestamp = (timestamp) => {
        return new Date(Number(timestamp) / 1000000).toLocaleString();
    };

    const getTokenSymbol = (principal) => {
        const principalStr = principal.toString();
        
        // First check provided tokenInfo
        const info = tokenInfo.get(principalStr);
        if (info?.symbol) return info.symbol;
        
        // Then check cached metadata
        const metadata = getTokenMetadata(principal);
        if (metadata?.symbol) return metadata.symbol;
        
        // Show loading or fallback
        if (isLoadingMetadata(principal)) {
            return '...';
        }
        
        return principalStr.slice(0, 8) + '...';
    };

    const getTokenDecimals = (principal) => {
        const principalStr = principal.toString();
        
        // First check provided tokenInfo
        const info = tokenInfo.get(principalStr);
        if (info?.decimals !== undefined) return info.decimals;
        
        // Then check cached metadata
        const metadata = getTokenMetadata(principal);
        if (metadata?.decimals !== undefined) return metadata.decimals;
        
        return 8; // Default fallback
    };

    const getTokenLogo = (principal) => {
        const principalStr = principal.toString();
        
        // First check provided tokenInfo
        const info = tokenInfo.get(principalStr);
        if (info?.logo) return info.logo;
        
        // Then check cached metadata
        const metadata = getTokenMetadata(principal);
        if (metadata?.logo) return metadata.logo;
        
        return null; // No logo available
    };

    const handleMouseEnter = (tokenKey, event) => {
        setHoveredToken(tokenKey);
        updateTooltipPosition(event);
    };

    const handleMouseLeave = () => {
        setHoveredToken(null);
    };

    const handleMouseMove = (event) => {
        if (hoveredToken) {
            updateTooltipPosition(event);
        }
    };

    const updateTooltipPosition = (event) => {
        const tooltipWidth = 300; // Approximate tooltip width
        const tooltipHeight = 200; // Approximate tooltip height
        const margin = 15;

        // Simple approach: use clientX/clientY directly for position: fixed
        let x = event.clientX + margin;
        let y = event.clientY - margin;

        // Adjust if tooltip would go off-screen to the right
        if (x + tooltipWidth > window.innerWidth) {
            x = event.clientX - tooltipWidth - margin;
        }

        // Adjust if tooltip would go off-screen at the bottom
        if (y + tooltipHeight > window.innerHeight) {
            y = event.clientY - tooltipHeight - margin;
        }

        // Ensure tooltip doesn't go off-screen at the top or left
        x = Math.max(margin, x);
        y = Math.max(margin, y);

        setTooltipPosition({ x, y });
    };

    return (
        <div style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '6px',
            alignItems: 'center',
            marginTop: '8px',
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'
            }}>
            
            {Object.entries(tipsByToken).map(([tokenKey, tokenData]) => {
                const decimals = getTokenDecimals(tokenData.principal);
                const symbol = getTokenSymbol(tokenData.principal);
                const logo = getTokenLogo(tokenData.principal);
                const isLoading = isLoadingMetadata(tokenData.principal);
                
                return (
                    <div
                        key={tokenKey}
                        onMouseEnter={(e) => handleMouseEnter(tokenKey, e)}
                        onMouseLeave={handleMouseLeave}
                        onMouseMove={handleMouseMove}
                        style={{
                            backgroundColor: theme.colors.primaryBg,
                            border: `1px solid ${isLoading ? theme.colors.mutedText : theme.colors.warning}`,
                            borderRadius: '12px',
                            padding: '4px 8px',
                            fontSize: '12px',
                            color: isLoading ? theme.colors.mutedText : theme.colors.warning,
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px',
                            fontWeight: '500',
                            opacity: isLoading ? 0.7 : 1
                        }}
                    >
                        {isLoading ? (
                            <span>⏳</span>
                        ) : logo ? (
                            <img 
                                src={logo} 
                                alt={symbol}
                                style={{
                                    width: '16px',
                                    height: '16px',
                                    borderRadius: '50%',
                                    objectFit: 'cover'
                                }}
                                onError={(e) => {
                                    // Fallback to diamond if logo fails to load
                                    e.target.style.display = 'none';
                                    e.target.nextSibling.style.display = 'inline';
                                }}
                            />
                        ) : null}
                        {/* Fallback diamond - hidden by default if logo exists */}
                        <span style={{ display: logo && !isLoading ? 'none' : 'inline' }}>💎</span>
                        {!isNarrowScreen && (
                            <span>
                                {formatAmount(tokenData.totalAmount, decimals)} {symbol}
                            </span>
                        )}
                        <span style={{ 
                            backgroundColor: isLoading ? '#666' : '#f39c12',
                            color: isLoading ? '#ccc' : '#000',
                            borderRadius: '6px',
                            padding: '1px 4px',
                            fontSize: '10px',
                            fontWeight: 'bold'
                        }}>
                            {tokenData.tips.length}
                        </span>
                    </div>
                );
            })}

            {/* Tooltip */}
            {hoveredToken && createPortal(
                <div
                    style={{
                        position: 'fixed',
                        left: tooltipPosition.x,
                        top: tooltipPosition.y,
                        backgroundColor: '#1a1a1a',
                        border: '1px solid #4a4a4a',
                        borderRadius: '6px',
                        padding: '12px',
                        color: '#ffffff',
                        fontSize: '12px',
                        maxWidth: '300px',
                        zIndex: 9999,
                        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
                        pointerEvents: 'none'
                    }}
                >
                    <div style={{
                        fontWeight: 'bold',
                        color: '#f39c12',
                        marginBottom: '8px',
                        borderBottom: '1px solid #333',
                        paddingBottom: '4px'
                    }}>
                        {getTokenSymbol(tipsByToken[hoveredToken].principal)} Tips ({tipsByToken[hoveredToken].tips.length})
                    </div>
                    
                    <div style={{ maxHeight: '200px', overflowY: 'auto' }}>
                        {tipsByToken[hoveredToken].tips
                            .sort((a, b) => Number(b.created_at) - Number(a.created_at)) // Most recent first
                            .map((tip, index) => (
                                <div key={index} style={{
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'flex-start',
                                    marginBottom: index < tipsByToken[hoveredToken].tips.length - 1 ? '6px' : '0',
                                    paddingBottom: index < tipsByToken[hoveredToken].tips.length - 1 ? '6px' : '0',
                                    borderBottom: index < tipsByToken[hoveredToken].tips.length - 1 ? '1px solid #333' : 'none',
                                    gap: '8px'
                                }}>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{
                                            color: '#6b8e6b',
                                            fontWeight: '500',
                                            marginBottom: '2px'
                                        }}>
                                            {formatAmount(Number(tip.amount), getTokenDecimals(tip.token_ledger_principal))} {getTokenSymbol(tip.token_ledger_principal)}
                                        </div>
                                        <div style={{
                                            color: theme.colors.mutedText,
                                            fontSize: '10px',
                                            overflow: 'hidden',
                                            textOverflow: 'ellipsis',
                                            whiteSpace: 'nowrap'
                                        }}>
                                            From: {(() => {
                                                const principalStr = tip.from_principal.toString();
                                                const displayInfo = principalDisplayInfo.get(principalStr);
                                                const formatted = formatPrincipal(tip.from_principal, displayInfo);
                                                
                                                if (typeof formatted === 'string') {
                                                    return formatted;
                                                } else if (formatted?.name || formatted?.nickname) {
                                                    // Show name/nickname with truncated ID
                                                    const parts = [];
                                                    if (formatted.name) parts.push(formatted.name);
                                                    if (formatted.nickname) parts.push(`"${formatted.nickname}"`);
                                                    return `${parts.join(' • ')} (${formatted.truncatedId})`;
                                                } else {
                                                    return principalStr.slice(0, 12) + '...';
                                                }
                                            })()}
                                        </div>
                                        <div style={{
                                            color: '#666',
                                            fontSize: '10px'
                                        }}>
                                            {formatTimestamp(tip.created_at)}
                                        </div>
                                    </div>
                                </div>
                            ))
                        }
                    </div>
                    
                    <div style={{
                        marginTop: '8px',
                        paddingTop: '8px',
                        borderTop: '1px solid #333',
                        fontWeight: 'bold',
                        color: '#f39c12'
                    }}>
                        Total: {formatAmount(tipsByToken[hoveredToken].totalAmount, getTokenDecimals(tipsByToken[hoveredToken].principal))} {getTokenSymbol(tipsByToken[hoveredToken].principal)}
                    </div>
                </div>,
                document.body
            )}
        </div>
    );
};

export default TipDisplay;
