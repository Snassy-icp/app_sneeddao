import React, { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Principal } from '@dfinity/principal';
import { useTheme } from '../contexts/ThemeContext';
import { useTokenMetadata } from '../hooks/useTokenMetadata';
import { formatPrincipal } from '../utils/PrincipalUtils';
import { get_token_conversion_rate } from '../utils/TokenUtils';

const TipDisplay = ({ tips = [], tokenInfo = new Map(), principalDisplayInfo = new Map(), isNarrowScreen = false, onTip = null, animateToken = null, postId = null }) => {
    const { theme } = useTheme();
    const [hoveredToken, setHoveredToken] = useState(null);
    const [tooltipPosition, setTooltipPosition] = useState({ x: 0, y: 0 });
    const [expandedTokens, setExpandedTokens] = useState(new Set()); // Track which pills are expanded
    const [animatingTokens, setAnimatingTokens] = useState(new Set()); // Track tokens that just received a new tip
    const pillRefs = useRef(new Map()); // Store refs to pill elements
    const tooltipHoveredRef = useRef(false); // Track if tooltip is being hovered (use ref to avoid stale closures)
    const [tokenPrices, setTokenPrices] = useState({}); // USD prices for tokens
    
    // Use the token metadata hook
    const { fetchTokenMetadata, getTokenMetadata, isLoadingMetadata } = useTokenMetadata();
    
    // Inject animation keyframes
    useEffect(() => {
        const styleId = 'tip-display-animations';
        if (!document.getElementById(styleId)) {
            const style = document.createElement('style');
            style.id = styleId;
            style.textContent = `
                @keyframes tipPulse {
                    0% {
                        transform: scale(1);
                        box-shadow: 0 0 0 rgba(255,215,0,0);
                    }
                    20% {
                        transform: scale(1.2);
                        box-shadow: 0 0 25px rgba(255,215,0,0.7), 0 0 50px rgba(255,215,0,0.4);
                    }
                    40% {
                        transform: scale(1.1);
                    }
                    60% {
                        transform: scale(1.15);
                        box-shadow: 0 0 15px rgba(255,215,0,0.5), 0 0 30px rgba(255,215,0,0.2);
                    }
                    100% {
                        transform: scale(1);
                        box-shadow: 0 1px 3px rgba(255,215,0,0.1);
                    }
                }
                @keyframes tipGlow {
                    0%, 100% {
                        filter: brightness(1);
                    }
                    50% {
                        filter: brightness(1.3);
                    }
                }
            `;
            document.head.appendChild(style);
        }
    }, []);
    
    // Track if the last interaction was touch-based
    const lastInteractionWasTouch = useRef(false);
    
    // Track tooltip position mode (below or above)
    const [tooltipAbove, setTooltipAbove] = useState(false);
    const tooltipRef = useRef(null);
    
    // Position tooltip relative to an element (below or above)
    const updateTooltipPositionFromElement = useCallback((element) => {
        const rect = element.getBoundingClientRect();
        const tooltipWidth = 320;
        const estimatedTooltipHeight = 350; // Conservative estimate for checking fit
        const margin = 10;

        // Center tooltip horizontally relative to pill
        let x = rect.left + (rect.width / 2) - (tooltipWidth / 2);
        
        // Check if tooltip would fit below the pill
        const spaceBelow = window.innerHeight - rect.bottom - margin;
        const fitsBelow = spaceBelow >= estimatedTooltipHeight;
        
        let y;
        if (fitsBelow) {
            // Position below the pill
            y = rect.bottom + margin;
            setTooltipAbove(false);
        } else {
            // Position above the pill - start with estimate, will be corrected after render
            // Use a large estimate to position it high, then correction will bring it down
            y = rect.top - margin - 400;
            setTooltipAbove(true);
        }

        // Adjust horizontal position if tooltip would go off-screen
        if (x + tooltipWidth > window.innerWidth - margin) {
            x = window.innerWidth - tooltipWidth - margin;
        }
        if (x < margin) {
            x = margin;
        }

        // Ensure tooltip doesn't go off-screen at the top
        if (y < margin) {
            y = margin;
        }

        setTooltipPosition({ x, y, pillTop: rect.top, margin, needsCorrection: !fitsBelow });
    }, []);
    
    // Adjust tooltip position after render when positioned above
    useLayoutEffect(() => {
        if (tooltipPosition.needsCorrection && tooltipRef.current && hoveredToken) {
            // Use requestAnimationFrame to ensure the tooltip has been painted
            requestAnimationFrame(() => {
                if (!tooltipRef.current) return;
                
                const tooltipRect = tooltipRef.current.getBoundingClientRect();
                const pillTop = tooltipPosition.pillTop;
                const margin = tooltipPosition.margin || 10;
                
                // Calculate where the tooltip should be so its bottom is flush with top of pill
                const targetY = pillTop - tooltipRect.height - margin;
                const finalY = Math.max(8, targetY); // Ensure it doesn't go off-screen
                
                setTooltipPosition(prev => ({ ...prev, y: finalY, needsCorrection: false }));
            });
        }
    }, [tooltipPosition.needsCorrection, hoveredToken, tooltipPosition.pillTop]);
    
    // Toggle expansion of a tip pill (desktop only - whole pill click)
    const toggleExpanded = (tokenKey, e) => {
        e.stopPropagation();
        e.preventDefault();
        
        // On touch devices, don't handle whole pill click - use separate handlers
        if (lastInteractionWasTouch.current) {
            return;
        }
        
        // Desktop: toggle expansion
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
    
    // Toggle tooltip only (mobile - tap on token icon)
    const toggleTooltipOnly = (tokenKey, e) => {
        e.stopPropagation();
        e.preventDefault();
        
        if (!lastInteractionWasTouch.current) return;
        
        const wasShowingTooltip = hoveredToken === tokenKey;
        
        if (wasShowingTooltip) {
            setHoveredToken(null);
        } else {
            setHoveredToken(tokenKey);
            const pillElement = pillRefs.current.get(tokenKey);
            if (pillElement) {
                updateTooltipPositionFromElement(pillElement);
            }
        }
    };
    
    // Toggle expand only (mobile - tap on count badge)
    const toggleExpandOnly = (tokenKey, e) => {
        e.stopPropagation();
        e.preventDefault();
        
        if (!lastInteractionWasTouch.current) return;
        
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
    
    // Handle touch start to track touch interactions
    const handleTouchStart = useCallback(() => {
        lastInteractionWasTouch.current = true;
    }, []);
    
    // Handle mouse enter to track mouse interactions
    const handleMouseDown = useCallback(() => {
        lastInteractionWasTouch.current = false;
    }, []);
    
    // Handle tip button click
    const handleTipClick = (tokenPrincipal, e) => {
        e.stopPropagation();
        if (onTip) {
            onTip(tokenPrincipal);
        }
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

    // Fetch USD prices for all unique tokens
    useEffect(() => {
        if (!tips || tips.length === 0) return;

        const uniqueTokens = [...new Set(tips.map(tip => tip.token_ledger_principal.toString()))];
        
        uniqueTokens.forEach(async (tokenKey) => {
            if (tokenPrices[tokenKey] !== undefined) return; // Already fetched
            
            try {
                const decimals = getTokenDecimals({ toString: () => tokenKey });
                const price = await get_token_conversion_rate(tokenKey, decimals);
                setTokenPrices(prev => ({ ...prev, [tokenKey]: price }));
            } catch (error) {
                console.warn(`Failed to fetch price for ${tokenKey}:`, error);
                setTokenPrices(prev => ({ ...prev, [tokenKey]: 0 }));
            }
        });
    }, [tips]);

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
                totalAmount: 0,
                isPlaceholder: false
            };
        }
        acc[tokenKey].tips.push(tip);
        acc[tokenKey].totalAmount += Number(tip.amount);
        // Track if this is a placeholder (waiting for flying token to land)
        if (tip._isPlaceholder) {
            acc[tokenKey].isPlaceholder = true;
        }
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

    const formatUsdValue = (amount, decimals, tokenKey) => {
        const price = tokenPrices[tokenKey];
        if (!price || price <= 0) return null;
        const tokenAmount = amount / Math.pow(10, decimals);
        const usdValue = tokenAmount * price;
        if (usdValue < 0.01) return '< $0.01';
        return `$${usdValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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

    // Handle external animation trigger (e.g., when tip dialog closes)
    useEffect(() => {
        if (animateToken) {
            setAnimatingTokens(new Set([animateToken]));
            // Clear animation state after animation completes
            const timer = setTimeout(() => {
                setAnimatingTokens(new Set());
            }, 800);
            return () => clearTimeout(timer);
        }
    }, [animateToken]);
    
    // On mobile, dismiss tooltip when tapping outside
    useEffect(() => {
        if (!hoveredToken) return;
        
        const handleClickOutside = (e) => {
            // Check if click is outside of pills and tooltip
            const clickedPill = e.target.closest('[data-tip-pill]');
            const clickedTooltip = e.target.closest('[data-tip-tooltip]');
            
            if (!clickedPill && !clickedTooltip) {
                setHoveredToken(null);
            }
        };
        
        // Small delay to avoid immediately closing from the same click that opened it
        const timer = setTimeout(() => {
            document.addEventListener('click', handleClickOutside);
            document.addEventListener('touchstart', handleClickOutside);
        }, 100);
        
        return () => {
            clearTimeout(timer);
            document.removeEventListener('click', handleClickOutside);
            document.removeEventListener('touchstart', handleClickOutside);
        };
    }, [hoveredToken]);

    const handleMouseEnter = useCallback((tokenKey) => {
        // If last interaction was touch, don't handle hover - let click handle it
        if (lastInteractionWasTouch.current) {
            return;
        }
        
        setHoveredToken(tokenKey);
        
        // Auto-expand the pill on hover (desktop)
        setExpandedTokens(prev => {
            const newSet = new Set(prev);
            newSet.add(tokenKey);
            return newSet;
        });
        
        // Position tooltip based on the pill element (with small delay for expansion)
        setTimeout(() => {
            const pillElement = pillRefs.current.get(tokenKey);
            if (pillElement) {
                updateTooltipPositionFromElement(pillElement);
            }
        }, 50);
    }, [updateTooltipPositionFromElement]);
    
    const handlePillMouseLeave = useCallback((tokenKey) => {
        // If last interaction was touch, don't handle hover - let click handle it
        if (lastInteractionWasTouch.current) {
            return;
        }
        
        // Delay closing to allow moving to tooltip
        setTimeout(() => {
            // Only close if tooltip is not being hovered
            if (!tooltipHoveredRef.current) {
                setHoveredToken(current => current === tokenKey ? null : current);
                // Also collapse the pill when mouse leaves (desktop)
                setExpandedTokens(prev => {
                    const newSet = new Set(prev);
                    newSet.delete(tokenKey);
                    return newSet;
                });
            }
        }, 150);
    }, []);
    
    const handleTooltipMouseEnter = useCallback(() => {
        tooltipHoveredRef.current = true;
    }, []);
    
    const handleTooltipMouseLeave = useCallback(() => {
        tooltipHoveredRef.current = false;
        // Collapse the pill when leaving the tooltip (desktop)
        setHoveredToken(current => {
            if (current && !lastInteractionWasTouch.current) {
                setExpandedTokens(prev => {
                    const newSet = new Set(prev);
                    newSet.delete(current);
                    return newSet;
                });
            }
            return null;
        });
    }, []);

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
                const isAnimating = animatingTokens.has(tokenKey);
                const isPlaceholder = tokenData.isPlaceholder;
                // Placeholder logos start invisible and fade in when the flying token lands
                const logoOpacity = isPlaceholder && !isAnimating ? 0 : 1;
                
                return (
                    <div
                        key={tokenKey}
                        data-tip-pill={postId !== null ? `${postId}-${tokenKey}` : tokenKey}
                        ref={(el) => {
                            if (el) pillRefs.current.set(tokenKey, el);
                            else pillRefs.current.delete(tokenKey);
                        }}
                        onTouchStart={handleTouchStart}
                        onMouseDown={handleMouseDown}
                        onClick={(e) => toggleExpanded(tokenKey, e)}
                        onMouseEnter={() => handleMouseEnter(tokenKey)}
                        onMouseLeave={() => handlePillMouseLeave(tokenKey)}
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
                            boxShadow: isAnimating 
                                ? '0 0 20px rgba(255,215,0,0.6), 0 0 40px rgba(255,215,0,0.3)'
                                : isLoading ? 'none' : '0 1px 3px rgba(255,215,0,0.1)',
                            overflow: 'hidden',
                            transform: isAnimating ? 'scale(1.15)' : 'scale(1)',
                            animation: isAnimating ? 'tipPulse 0.8s ease-out' : 'none',
                        }}
                        onMouseOver={(e) => {
                            if (!isLoading && !isAnimating) {
                                e.currentTarget.style.background = 'linear-gradient(135deg, rgba(255,215,0,0.2) 0%, rgba(255,180,0,0.12) 100%)';
                                e.currentTarget.style.borderColor = 'rgba(255,215,0,0.5)';
                                e.currentTarget.style.boxShadow = '0 2px 8px rgba(255,215,0,0.2)';
                            }
                        }}
                        onMouseOut={(e) => {
                            if (!isLoading && !isAnimating) {
                                e.currentTarget.style.background = 'linear-gradient(135deg, rgba(255,215,0,0.12) 0%, rgba(255,180,0,0.06) 100%)';
                                e.currentTarget.style.borderColor = 'rgba(255,215,0,0.35)';
                                e.currentTarget.style.boxShadow = '0 1px 3px rgba(255,215,0,0.1)';
                            }
                        }}
                    >
                        {/* Token icon - on mobile, tapping toggles tooltip */}
                        <span 
                            onClick={(e) => toggleTooltipOnly(tokenKey, e)}
                            style={{ 
                                display: 'flex', 
                                alignItems: 'center',
                                cursor: 'pointer'
                            }}
                        >
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
                                        flexShrink: 0,
                                        opacity: logoOpacity,
                                        transition: 'opacity 0.3s ease-out'
                                    }}
                                    onError={(e) => {
                                        e.target.style.display = 'none';
                                        e.target.nextSibling.style.display = 'inline';
                                    }}
                                />
                            ) : null}
                            <span style={{ 
                                display: logo && !isLoading ? 'none' : 'inline', 
                                fontSize: '11px', 
                                flexShrink: 0,
                                opacity: logoOpacity,
                                transition: 'opacity 0.3s ease-out'
                            }}>💎</span>
                        </span>
                        
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
                        
                        {/* Tip button - only show when expanded and onTip is provided */}
                        {onTip && (
                            <button
                                onClick={(e) => handleTipClick(tokenData.principal, e)}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    background: 'rgba(255,215,0,0.15)',
                                    border: '1px solid rgba(255,215,0,0.4)',
                                    borderRadius: '50%',
                                    width: isExpanded ? '18px' : '0',
                                    height: '18px',
                                    minWidth: isExpanded ? '18px' : '0',
                                    padding: 0,
                                    cursor: 'pointer',
                                    color: '#ffd700',
                                    fontSize: '10px',
                                    flexShrink: 0,
                                    opacity: isExpanded ? 1 : 0,
                                    overflow: 'hidden',
                                    transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
                                }}
                                onMouseOver={(e) => {
                                    e.currentTarget.style.background = 'rgba(255,215,0,0.3)';
                                    e.currentTarget.style.borderColor = 'rgba(255,215,0,0.6)';
                                    e.currentTarget.style.transform = 'scale(1.1)';
                                }}
                                onMouseOut={(e) => {
                                    e.currentTarget.style.background = 'rgba(255,215,0,0.15)';
                                    e.currentTarget.style.borderColor = 'rgba(255,215,0,0.4)';
                                    e.currentTarget.style.transform = 'scale(1)';
                                }}
                                title={`Tip with ${symbol}`}
                            >
                                +
                            </button>
                        )}
                        
                        {/* Tip count badge - on mobile, tapping toggles expand/collapse */}
                        <span 
                            onClick={(e) => toggleExpandOnly(tokenKey, e)}
                            style={{ 
                                background: isAnimating 
                                    ? 'rgba(255,215,0,0.6)'
                                    : isLoading 
                                        ? 'rgba(100,100,100,0.25)'
                                        : 'rgba(255,215,0,0.25)',
                                color: isAnimating ? '#fff' : isLoading ? '#999' : '#d4aa00',
                                borderRadius: '50%',
                                padding: tokenData.tips.length > 9 ? '1px 5px' : '1px',
                                fontSize: '9px',
                                fontWeight: '600',
                                width: tokenData.tips.length > 9 ? 'auto' : '14px',
                                height: '14px',
                                minWidth: '14px',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                border: isAnimating 
                                    ? '1px solid rgba(255,215,0,0.8)' 
                                    : isLoading ? '1px solid rgba(150,150,150,0.3)' : '1px solid rgba(255,215,0,0.35)',
                                flexShrink: 0,
                                transition: 'all 0.3s ease',
                                textShadow: isAnimating ? '0 0 8px rgba(255,255,255,0.8)' : 'none',
                                cursor: 'pointer'
                            }}>
                            {tokenData.tips.length}
                        </span>
                    </div>
                );
            })}

            {/* Tooltip */}
            {hoveredToken && createPortal(
                <div
                    ref={tooltipRef}
                    data-tip-tooltip="true"
                    onMouseEnter={handleTooltipMouseEnter}
                    onMouseLeave={handleTooltipMouseLeave}
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
                        pointerEvents: 'auto',
                        backdropFilter: 'blur(10px)',
                        cursor: 'default'
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
                                            display: 'flex',
                                            alignItems: 'baseline',
                                            gap: '6px',
                                            marginBottom: '3px'
                                        }}>
                                            <span style={{
                                                color: '#8fbc8f',
                                                fontWeight: '600',
                                                fontSize: '12px'
                                            }}>
                                                +{formatAmount(Number(tip.amount), getTokenDecimals(tip.token_ledger_principal))} {getTokenSymbol(tip.token_ledger_principal)}
                                            </span>
                                            {formatUsdValue(Number(tip.amount), getTokenDecimals(tip.token_ledger_principal), tip.token_ledger_principal.toString()) && (
                                                <span style={{
                                                    color: 'rgba(255,255,255,0.4)',
                                                    fontSize: '10px'
                                                }}>
                                                    ({formatUsdValue(Number(tip.amount), getTokenDecimals(tip.token_ledger_principal), tip.token_ledger_principal.toString())})
                                                </span>
                                            )}
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
                        borderTop: '1px solid rgba(255,215,0,0.15)'
                    }}>
                        <div style={{
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
                        {formatUsdValue(tipsByToken[hoveredToken].totalAmount, getTokenDecimals(tipsByToken[hoveredToken].principal), hoveredToken) && (
                            <div style={{
                                textAlign: 'right',
                                marginTop: '4px'
                            }}>
                                <span style={{
                                    color: '#8fbc8f',
                                    fontSize: '12px',
                                    fontWeight: '600'
                                }}>
                                    ≈ {formatUsdValue(tipsByToken[hoveredToken].totalAmount, getTokenDecimals(tipsByToken[hoveredToken].principal), hoveredToken)} USD
                                </span>
                            </div>
                        )}
                    </div>
                </div>,
                document.body
            )}
        </div>
    );
};

export default TipDisplay;
