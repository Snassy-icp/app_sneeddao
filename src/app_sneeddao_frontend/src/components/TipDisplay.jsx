import React, { useState } from 'react';
import { Principal } from '@dfinity/principal';

const TipDisplay = ({ tips = [], tokenInfo = new Map() }) => {
    const [hoveredToken, setHoveredToken] = useState(null);
    const [tooltipPosition, setTooltipPosition] = useState({ x: 0, y: 0 });

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
        const info = tokenInfo.get(principal.toString());
        return info?.symbol || principal.toString().slice(0, 8) + '...';
    };

    const getTokenDecimals = (principal) => {
        const info = tokenInfo.get(principal.toString());
        return info?.decimals || 8;
    };

    const handleMouseEnter = (tokenKey, event) => {
        setHoveredToken(tokenKey);
        setTooltipPosition({
            x: event.clientX,
            y: event.clientY
        });
    };

    const handleMouseLeave = () => {
        setHoveredToken(null);
    };

    const handleMouseMove = (event) => {
        if (hoveredToken) {
            setTooltipPosition({
                x: event.clientX,
                y: event.clientY
            });
        }
    };

    return (
        <div style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '6px',
            alignItems: 'center',
            marginTop: '8px'
        }}>
            <span style={{
                fontSize: '12px',
                color: '#888',
                marginRight: '4px'
            }}>
                💰 Tips:
            </span>
            
            {Object.entries(tipsByToken).map(([tokenKey, tokenData]) => {
                const decimals = getTokenDecimals(tokenData.principal);
                const symbol = getTokenSymbol(tokenData.principal);
                
                return (
                    <div
                        key={tokenKey}
                        onMouseEnter={(e) => handleMouseEnter(tokenKey, e)}
                        onMouseLeave={handleMouseLeave}
                        onMouseMove={handleMouseMove}
                        style={{
                            backgroundColor: '#1a1a1a',
                            border: '1px solid #f39c12',
                            borderRadius: '12px',
                            padding: '4px 8px',
                            fontSize: '12px',
                            color: '#f39c12',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px',
                            fontWeight: '500'
                        }}
                    >
                        <span>💎</span>
                        <span>
                            {formatAmount(tokenData.totalAmount, decimals)} {symbol}
                        </span>
                        <span style={{ 
                            backgroundColor: '#f39c12',
                            color: '#000',
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
            {hoveredToken && (
                <div
                    style={{
                        position: 'fixed',
                        left: tooltipPosition.x + 10,
                        top: tooltipPosition.y - 10,
                        backgroundColor: '#1a1a1a',
                        border: '1px solid #4a4a4a',
                        borderRadius: '6px',
                        padding: '12px',
                        color: '#ffffff',
                        fontSize: '12px',
                        maxWidth: '300px',
                        zIndex: 1000,
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
                                            color: '#888',
                                            fontSize: '10px',
                                            fontFamily: 'monospace',
                                            overflow: 'hidden',
                                            textOverflow: 'ellipsis',
                                            whiteSpace: 'nowrap'
                                        }}>
                                            From: {tip.from_principal.toString().slice(0, 12)}...
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
                </div>
            )}
        </div>
    );
};

export default TipDisplay;
