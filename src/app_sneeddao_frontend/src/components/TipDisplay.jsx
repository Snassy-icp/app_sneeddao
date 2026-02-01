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
    const [expandedTokens, setExpandedTokens] = useState(new Set()); // Track which pills are expanded
    
    // Use the token metadata hook
    const { fetchTokenMetadata, getTokenMetadata, isLoadingMetadata } = useTokenMetadata();
    
    // Toggle expansion of a tip pill
    const toggleExpanded = (tokenKey, e) => {
        e.stopPropagation(); // Prevent tooltip from triggering
        setExpandedTokens(prev => {
            const newSet = new Set(prev);
            if (newSet.has(tokenKey)) {
                newSet.delete(tokenKey);
            } else {
                newSet.add(tokenKey);
            }
            return newSet;
        });
    };

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
            gap: '8px',
            alignItems: 'center',
            marginTop: '4px',
            marginBottom: '6px',
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'
            }}>
            
            {Object.entries(tipsByToken).map(([tokenKey, tokenData]) => {
                const decimals = getTokenDecimals(tokenData.principal);
                const symbol = getTokenSymbol(tokenData.principal);
                const logo = getTokenLogo(tokenData.principal);
                const isLoading = isLoadingMetadata(tokenData.principal);
                const isExpanded = expandedTokens.has(tokenKey);
                
                return (
                    <div
                        key={tokenKey}
                        onClick={(e) => toggleExpanded(tokenKey, e)}
                        onMouseEnter={(e) => handleMouseEnter(tokenKey, e)}
                        onMouseLeave={handleMouseLeave}
                        onMouseMove={handleMouseMove}
                        style={{
                            background: isLoading 
                                ? 'linear-gradient(135deg, rgba(100,100,100,0.15) 0%, rgba(80,80,80,0.1) 100%)'
                                : 'linear-gradient(135deg, rgba(255,215,0,0.12) 0%, rgba(255,180,0,0.06) 100%)',
                            border: `1px solid ${isLoading ? 'rgba(150,150,150,0.3)' : 'rgba(255,215,0,0.35)'}`,
                            borderRadius: '16px',
                            padding: isExpanded ? '3px 10px 3px 6px' : '3px 6px',
                            fontSize: '11px',
                            color: isLoading ? theme.colors.mutedText : '#e6c200',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: isExpanded ? '5px' : '4px',
                            fontWeight: '500',
                            opacity: isLoading ? 0.7 : 1,
                            transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
                            boxShadow: isLoading ? 'none' : '0 1px 3px rgba(255,215,0,0.1)',
                            overflow: 'hidden',
                        }}
                        onMouseOver={(e) => {
                            if (!isLoading) {
                                e.currentTarget.style.background = 'linear-gradient(135deg, rgba(255,215,0,0.2) 0%, rgba(255,180,0,0.12) 100%)';
                                e.currentTarget.style.borderColor = 'rgba(255,215,0,0.5)';
                                e.currentTarget.style.boxShadow = '0 2px 8px rgba(255,215,0,0.2)';
                            }
                        }}
                        onMouseOut={(e) => {
                            if (!isLoading) {
                                e.currentTarget.style.background = 'linear-gradient(135deg, rgba(255,215,0,0.12) 0%, rgba(255,180,0,0.06) 100%)';
                                e.currentTarget.style.borderColor = 'rgba(255,215,0,0.35)';
                                e.currentTarget.style.boxShadow = '0 1px 3px rgba(255,215,0,0.1)';
                            }
                        }}
                    >
                        {/* Token icon */}
                        {isLoading ? (
                            <span style={{ fontSize: '12px' }}>⏳</span>
                        ) : logo ? (
                            <img 
                                src={logo} 
                                alt={symbol}
                                style={{
                                    width: '14px',
                                    height: '14px',
                                    borderRadius: '50%',
                                    objectFit: 'cover',
                                    boxShadow: '0 1px 2px rgba(0,0,0,0.2)',
                                    flexShrink: 0
                                }}
                                onError={(e) => {
                                    e.target.style.display = 'none';
                                    e.target.nextSibling.style.display = 'inline';
                                }}
                            />
                        ) : null}
                        <span style={{ display: logo && !isLoading ? 'none' : 'inline', fontSize: '11px', flexShrink: 0 }}>💎</span>
                        
                        {/* Amount and symbol - only show when expanded */}
                        <span style={{ 
                            display: 'flex',
                            alignItems: 'center',
                            letterSpacing: '-0.2px',
                            maxWidth: isExpanded ? '200px' : '0',
                            opacity: isExpanded ? 1 : 0,
                            overflow: 'hidden',
                            whiteSpace: 'nowrap',
                            transition: 'max-width 0.25s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.2s ease'
                        }}>
                            {formatAmount(tokenData.totalAmount, decimals)} {symbol}
                        </span>
                        
                        {/* Tip count badge */}
                        <span style={{ 
                            background: isLoading 
                                ? 'rgba(100,100,100,0.4)'
                                : 'linear-gradient(135deg, #ffd700 0%, #e6ac00 100%)',
                            color: isLoading ? '#ccc' : '#1a1a00',
                            borderRadius: '8px',
                            padding: '1px 5px',
                            fontSize: '9px',
                            fontWeight: '700',
                            minWidth: '14px',
                            textAlign: 'center',
                            boxShadow: isLoading ? 'none' : '0 1px 2px rgba(0,0,0,0.15)',
                            flexShrink: 0
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
                        background: 'linear-gradient(180deg, #1e1e1e 0%, #151515 100%)',
                        border: '1px solid rgba(255,215,0,0.2)',
                        borderRadius: '12px',
                        padding: '14px 16px',
                        color: '#ffffff',
                        fontSize: '12px',
                        maxWidth: '320px',
                        minWidth: '200px',
                        zIndex: 9999,
                        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255,255,255,0.05) inset',
                        pointerEvents: 'none',
                        backdropFilter: 'blur(10px)'
                    }}
                >
                    {/* Header */}
                    <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        marginBottom: '12px',
                        paddingBottom: '10px',
                        borderBottom: '1px solid rgba(255,215,0,0.15)'
                    }}>
                        {getTokenLogo(tipsByToken[hoveredToken].principal) && (
                            <img 
                                src={getTokenLogo(tipsByToken[hoveredToken].principal)} 
                                alt=""
                                style={{
                                    width: '20px',
                                    height: '20px',
                                    borderRadius: '50%',
                                    boxShadow: '0 2px 4px rgba(0,0,0,0.3)'
                                }}
                            />
                        )}
                        <div>
                            <div style={{
                                fontWeight: '600',
                                color: '#ffd700',
                                fontSize: '13px',
                                letterSpacing: '-0.2px'
                            }}>
                                {getTokenSymbol(tipsByToken[hoveredToken].principal)} Tips
                            </div>
                            <div style={{
                                fontSize: '10px',
                                color: 'rgba(255,255,255,0.5)',
                                marginTop: '1px'
                            }}>
                                {tipsByToken[hoveredToken].tips.length} {tipsByToken[hoveredToken].tips.length === 1 ? 'tip' : 'tips'} received
                            </div>
                        </div>
                    </div>
                    
                    {/* Tips List */}
                    <div style={{ 
                        maxHeight: '180px', 
                        overflowY: 'auto',
                        marginRight: '-8px',
                        paddingRight: '8px'
                    }}>
                        {tipsByToken[hoveredToken].tips
                            .sort((a, b) => Number(b.created_at) - Number(a.created_at))
                            .map((tip, index) => (
                                <div key={index} style={{
                                    display: 'flex',
                                    alignItems: 'flex-start',
                                    gap: '10px',
                                    padding: '8px 0',
                                    borderBottom: index < tipsByToken[hoveredToken].tips.length - 1 
                                        ? '1px solid rgba(255,255,255,0.06)' 
                                        : 'none'
                                }}>
                                    <div style={{
                                        width: '6px',
                                        height: '6px',
                                        borderRadius: '50%',
                                        background: 'linear-gradient(135deg, #ffd700 0%, #e6ac00 100%)',
                                        marginTop: '5px',
                                        flexShrink: 0,
                                        boxShadow: '0 0 6px rgba(255,215,0,0.4)'
                                    }} />
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{
                                            color: '#8fbc8f',
                                            fontWeight: '600',
                                            fontSize: '12px',
                                            marginBottom: '3px'
                                        }}>
                                            +{formatAmount(Number(tip.amount), getTokenDecimals(tip.token_ledger_principal))} {getTokenSymbol(tip.token_ledger_principal)}
                                        </div>
                                        <div style={{
                                            color: 'rgba(255,255,255,0.6)',
                                            fontSize: '10px',
                                            overflow: 'hidden',
                                            textOverflow: 'ellipsis',
                                            whiteSpace: 'nowrap',
                                            marginBottom: '2px'
                                        }}>
                                            {(() => {
                                                const principalStr = tip.from_principal.toString();
                                                const displayInfo = principalDisplayInfo.get(principalStr);
                                                const formatted = formatPrincipal(tip.from_principal, displayInfo);
                                                
                                                if (typeof formatted === 'string') {
                                                    return formatted;
                                                } else if (formatted?.name || formatted?.nickname) {
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
                                            color: 'rgba(255,255,255,0.35)',
                                            fontSize: '9px'
                                        }}>
                                            {formatTimestamp(tip.created_at)}
                                        </div>
                                    </div>
                                </div>
                            ))
                        }
                    </div>
                    
                    {/* Total */}
                    <div style={{
                        marginTop: '12px',
                        paddingTop: '10px',
                        borderTop: '1px solid rgba(255,215,0,0.15)',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center'
                    }}>
                        <span style={{ 
                            color: 'rgba(255,255,255,0.5)', 
                            fontSize: '11px',
                            fontWeight: '500'
                        }}>
                            Total
                        </span>
                        <span style={{
                            fontWeight: '700',
                            color: '#ffd700',
                            fontSize: '13px',
                            letterSpacing: '-0.3px'
                        }}>
                            {formatAmount(tipsByToken[hoveredToken].totalAmount, getTokenDecimals(tipsByToken[hoveredToken].principal))} {getTokenSymbol(tipsByToken[hoveredToken].principal)}
                        </span>
                    </div>
                </div>,
                document.body
            )}
        </div>
    );
};

export default TipDisplay;
