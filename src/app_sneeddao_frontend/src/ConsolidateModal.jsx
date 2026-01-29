import React, { useState, useEffect } from 'react';
import { useTheme } from './contexts/ThemeContext';
import { formatAmount } from './utils/StringUtils';

// Accent colors matching wallet page
const walletPrimary = '#10b981';
const walletSecondary = '#059669';

const ConsolidateModal = ({ 
    isOpen, 
    onClose, 
    type, // 'fees', 'rewards', 'maturity', or 'all'
    items, // Array of items to consolidate
    onConsolidate 
}) => {
    const { theme } = useTheme();
    const [selectedItems, setSelectedItems] = useState([]);
    const [isProcessing, setIsProcessing] = useState(false);

    // Update selectedItems when items prop changes
    useEffect(() => {
        if (items && items.length > 0) {
            setSelectedItems(items.map(item => ({ ...item, selected: true, status: 'pending' })));
            setIsProcessing(false);
        }
    }, [items]);

    // Reset when modal closes
    useEffect(() => {
        if (!isOpen) {
            setSelectedItems([]);
            setIsProcessing(false);
        }
    }, [isOpen]);

    if (!isOpen) return null;

    const getTitle = () => {
        switch (type) {
            case 'fees': return 'Collect Fees';
            case 'rewards': return 'Collect Rewards';
            case 'maturity': return 'Collect Maturity';
            case 'all': return 'Collect All';
            default: return 'Collect';
        }
    };

    const getActionLabel = () => {
        switch (type) {
            case 'fees': return 'Claim Fees';
            case 'rewards': return 'Claim Rewards';
            case 'maturity': return 'Disburse Maturity';
            case 'all': return 'Collect All';
            default: return 'Collect';
        }
    };

    const toggleItem = (index) => {
        if (isProcessing) return;
        setSelectedItems(prev => prev.map((item, i) => 
            i === index ? { ...item, selected: !item.selected } : item
        ));
    };

    const toggleAll = () => {
        if (isProcessing) return;
        const allSelected = selectedItems.every(item => item.selected);
        setSelectedItems(prev => prev.map(item => ({ ...item, selected: !allSelected })));
    };

    const handleConsolidate = async () => {
        setIsProcessing(true);
        
        const itemsToProcess = selectedItems.filter(item => item.selected);
        
        for (let i = 0; i < itemsToProcess.length; i++) {
            const item = itemsToProcess[i];
            const index = selectedItems.findIndex(si => si === item);
            
            // Update status to processing
            setSelectedItems(prev => prev.map((si, idx) => 
                idx === index ? { ...si, status: 'processing' } : si
            ));
            
            try {
                // Call the consolidation function
                await onConsolidate(item);
                
                // Update status to success
                setSelectedItems(prev => prev.map((si, idx) => 
                    idx === index ? { ...si, status: 'success' } : si
                ));
            } catch (error) {
                console.error(`Error collecting item:`, error);
                // Update status to error
                setSelectedItems(prev => prev.map((si, idx) => 
                    idx === index ? { ...si, status: 'error', error: error.message } : si
                ));
            }
        }
        
        setIsProcessing(false);
    };

    const getStatusIcon = (status) => {
        switch (status) {
            case 'pending': return null;
            case 'processing': return '⏳';
            case 'success': return '✅';
            case 'error': return '❌';
            default: return null;
        }
    };

    const selectedCount = selectedItems.filter(item => item.selected).length;
    const allSelected = selectedItems.every(item => item.selected);
    const anyProcessed = selectedItems.some(item => item.status !== 'pending');

    // Calculate totals for selected items
    const calculateTotals = () => {
        const selectedFilteredItems = selectedItems.filter(item => item.selected);
        const totalUSD = selectedFilteredItems.reduce((sum, item) => sum + (item.usdValue || 0), 0);
        
        // Aggregate by token
        const tokenTotals = {};
        selectedFilteredItems.forEach(item => {
            if (item.type === 'fee') {
                // Parse description like "0.00301529 SNEED + 118.98941312 DKP"
                const parts = item.description.split(' + ');
                parts.forEach(part => {
                    const match = part.match(/^([\d.]+)\s+(.+)$/);
                    if (match) {
                        const [, amount, symbol] = match;
                        if (!tokenTotals[symbol]) tokenTotals[symbol] = 0;
                        tokenTotals[symbol] += parseFloat(amount);
                    }
                });
            } else if (item.type === 'reward' || item.type === 'maturity') {
                // Parse description like "1234.56 SNEED"
                const match = item.description.match(/^([\d.]+)\s+(.+)$/);
                if (match) {
                    const [, amount, symbol] = match;
                    if (!tokenTotals[symbol]) tokenTotals[symbol] = 0;
                    tokenTotals[symbol] += parseFloat(amount);
                }
            }
        });
        
        return { totalUSD, tokenTotals };
    };

    const { totalUSD, tokenTotals } = calculateTotals();

    const getItemIcon = (item) => {
        switch (item.type) {
            case 'fee': return '💸';
            case 'reward': return '🎁';
            case 'maturity': return '🌱';
            default: return '';
        }
    };

    return (
        <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.75)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '20px',
            backdropFilter: 'blur(4px)'
        }}>
            <div style={{
                background: `linear-gradient(135deg, ${theme.colors.primaryBg} 0%, ${walletPrimary}08 100%)`,
                borderRadius: '16px',
                padding: '0',
                maxWidth: '550px',
                width: '100%',
                maxHeight: '85vh',
                display: 'flex',
                flexDirection: 'column',
                border: `1px solid ${theme.colors.border}`,
                boxShadow: `0 20px 60px rgba(0, 0, 0, 0.4), 0 0 40px ${walletPrimary}15`,
                overflow: 'hidden'
            }}>
                {/* Header */}
                <div style={{
                    background: `linear-gradient(135deg, ${walletPrimary}, ${walletSecondary})`,
                    padding: '1.25rem 1.5rem',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center'
                }}>
                    <h2 style={{
                        margin: 0,
                        color: 'white',
                        fontSize: '1.25rem',
                        fontWeight: '600',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem'
                    }}>
                        {type === 'fees' && '💸'}
                        {type === 'rewards' && '🎁'}
                        {type === 'maturity' && '🌱'}
                        {type === 'all' && '✨'}
                        {getTitle()}
                    </h2>
                    <button
                        onClick={onClose}
                        disabled={isProcessing}
                        style={{
                            background: 'rgba(255, 255, 255, 0.2)',
                            border: 'none',
                            fontSize: '1.25rem',
                            cursor: isProcessing ? 'not-allowed' : 'pointer',
                            color: 'white',
                            width: '32px',
                            height: '32px',
                            borderRadius: '8px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            opacity: isProcessing ? 0.5 : 1,
                            transition: 'all 0.2s ease'
                        }}
                    >
                        ×
                    </button>
                </div>

                <div style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
                    {/* Select All Toggle */}
                    {!anyProcessed && selectedItems.length > 0 && (
                        <div style={{
                            marginBottom: '1rem',
                            paddingBottom: '0.75rem',
                            borderBottom: `1px solid ${theme.colors.border}`
                        }}>
                            <label style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.75rem',
                                cursor: 'pointer',
                                color: theme.colors.primaryText,
                                fontWeight: '500',
                                fontSize: '0.9rem'
                            }}>
                                <input
                                    type="checkbox"
                                    checked={allSelected}
                                    onChange={toggleAll}
                                    disabled={isProcessing}
                                    style={{ 
                                        cursor: 'pointer',
                                        width: '18px',
                                        height: '18px',
                                        accentColor: walletPrimary
                                    }}
                                />
                                Select All 
                                <span style={{ 
                                    color: walletPrimary,
                                    fontWeight: '600'
                                }}>
                                    ({selectedCount} of {selectedItems.length})
                                </span>
                            </label>
                        </div>
                    )}

                    {/* Items List */}
                    <div style={{
                        flex: 1,
                        overflowY: 'auto',
                        marginBottom: '1rem'
                    }}>
                        {selectedItems.length === 0 ? (
                            <p style={{ 
                                color: theme.colors.mutedText, 
                                textAlign: 'center',
                                padding: '2rem'
                            }}>
                                No items available to collect
                            </p>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                                {selectedItems.map((item, index) => (
                                    <div
                                        key={index}
                                        onClick={() => !anyProcessed && toggleItem(index)}
                                        style={{
                                            background: item.selected 
                                                ? `linear-gradient(135deg, ${theme.colors.secondaryBg} 0%, ${walletPrimary}08 100%)`
                                                : theme.colors.secondaryBg,
                                            padding: '1rem',
                                            borderRadius: '12px',
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '0.875rem',
                                            border: item.selected 
                                                ? `1px solid ${walletPrimary}40`
                                                : `1px solid ${theme.colors.border}`,
                                            opacity: (!item.selected && !anyProcessed) ? 0.6 : 1,
                                            cursor: anyProcessed ? 'default' : 'pointer',
                                            transition: 'all 0.2s ease'
                                        }}
                                    >
                                        {!anyProcessed && (
                                            <input
                                                type="checkbox"
                                                checked={item.selected}
                                                onChange={() => {}}
                                                disabled={isProcessing}
                                                style={{ 
                                                    cursor: isProcessing ? 'not-allowed' : 'pointer',
                                                    width: '18px',
                                                    height: '18px',
                                                    accentColor: walletPrimary,
                                                    flexShrink: 0
                                                }}
                                            />
                                        )}
                                        
                                        {/* Item Icon */}
                                        <div style={{ 
                                            width: '40px',
                                            height: '40px',
                                            borderRadius: '10px',
                                            background: `linear-gradient(135deg, ${walletPrimary}20, ${walletSecondary}15)`,
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            fontSize: '1.25rem',
                                            flexShrink: 0
                                        }}>
                                            {getItemIcon(item)}
                                        </div>
                                        
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            <div style={{
                                                color: theme.colors.primaryText,
                                                fontWeight: '600',
                                                fontSize: '0.9rem',
                                                marginBottom: '0.25rem',
                                                whiteSpace: 'nowrap',
                                                overflow: 'hidden',
                                                textOverflow: 'ellipsis'
                                            }}>
                                                {item.name}
                                            </div>
                                            <div style={{
                                                color: theme.colors.secondaryText,
                                                fontSize: '0.8rem'
                                            }}>
                                                {item.description}
                                            </div>
                                            {item.usdValue > 0 && (
                                                <div style={{
                                                    color: walletPrimary,
                                                    fontSize: '0.85rem',
                                                    marginTop: '0.35rem',
                                                    fontWeight: '600'
                                                }}>
                                                    ${item.usdValue.toLocaleString(undefined, { 
                                                        minimumFractionDigits: 2, 
                                                        maximumFractionDigits: 2 
                                                    })}
                                                </div>
                                            )}
                                            {item.status === 'error' && item.error && (
                                                <div style={{
                                                    color: '#ef4444',
                                                    fontSize: '0.8rem',
                                                    marginTop: '0.35rem'
                                                }}>
                                                    Error: {item.error}
                                                </div>
                                            )}
                                        </div>
                                        
                                        {getStatusIcon(item.status) && (
                                            <span style={{ fontSize: '1.25rem', flexShrink: 0 }}>
                                                {getStatusIcon(item.status)}
                                            </span>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Totals Section */}
                    {!anyProcessed && selectedCount > 0 && (
                        <div style={{
                            padding: '1rem',
                            background: `linear-gradient(135deg, ${walletPrimary}10 0%, ${walletSecondary}08 100%)`,
                            borderRadius: '12px',
                            marginBottom: '1rem',
                            border: `1px solid ${walletPrimary}25`
                        }}>
                            <div style={{
                                color: theme.colors.primaryText,
                                fontWeight: '600',
                                marginBottom: '0.75rem',
                                fontSize: '0.85rem',
                                textTransform: 'uppercase',
                                letterSpacing: '0.5px'
                            }}>
                                Selected Totals
                            </div>
                            
                            {/* USD Total */}
                            <div style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                marginBottom: '0.75rem',
                                paddingBottom: '0.75rem',
                                borderBottom: `1px solid ${theme.colors.border}`
                            }}>
                                <span style={{ 
                                    color: theme.colors.secondaryText,
                                    fontSize: '0.9rem'
                                }}>
                                    Total Value
                                </span>
                                <span style={{ 
                                    color: walletPrimary,
                                    fontWeight: '700',
                                    fontSize: '1.25rem'
                                }}>
                                    ${totalUSD.toLocaleString(undefined, { 
                                        minimumFractionDigits: 2, 
                                        maximumFractionDigits: 2 
                                    })}
                                </span>
                            </div>
                            
                            {/* Token Breakdown */}
                            <div style={{
                                display: 'flex',
                                flexWrap: 'wrap',
                                gap: '0.5rem'
                            }}>
                                {Object.entries(tokenTotals).map(([symbol, amount]) => (
                                    <div 
                                        key={symbol}
                                        style={{
                                            background: theme.colors.tertiaryBg,
                                            padding: '0.4rem 0.75rem',
                                            borderRadius: '8px',
                                            fontSize: '0.8rem',
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '0.35rem'
                                        }}
                                    >
                                        <span style={{ color: theme.colors.secondaryText }}>
                                            {symbol}:
                                        </span>
                                        <span style={{ 
                                            color: theme.colors.primaryText,
                                            fontWeight: '600'
                                        }}>
                                            {amount.toLocaleString(undefined, {
                                                minimumFractionDigits: 2,
                                                maximumFractionDigits: 6
                                            })}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Action Buttons */}
                    <div style={{
                        display: 'flex',
                        gap: '0.75rem',
                        justifyContent: 'flex-end'
                    }}>
                        <button
                            onClick={onClose}
                            disabled={isProcessing}
                            style={{
                                padding: '0.75rem 1.25rem',
                                borderRadius: '10px',
                                border: `1px solid ${theme.colors.border}`,
                                background: theme.colors.secondaryBg,
                                color: theme.colors.primaryText,
                                cursor: isProcessing ? 'not-allowed' : 'pointer',
                                fontSize: '0.9rem',
                                fontWeight: '500',
                                opacity: isProcessing ? 0.5 : 1,
                                transition: 'all 0.2s ease'
                            }}
                        >
                            {anyProcessed ? 'Close' : 'Cancel'}
                        </button>
                        
                        {!anyProcessed && (
                            <button
                                onClick={handleConsolidate}
                                disabled={isProcessing || selectedCount === 0}
                                style={{
                                    padding: '0.75rem 1.5rem',
                                    borderRadius: '10px',
                                    border: 'none',
                                    background: (isProcessing || selectedCount === 0) 
                                        ? theme.colors.mutedText
                                        : `linear-gradient(135deg, ${walletPrimary}, ${walletSecondary})`,
                                    color: 'white',
                                    cursor: (isProcessing || selectedCount === 0) ? 'not-allowed' : 'pointer',
                                    fontSize: '0.9rem',
                                    fontWeight: '600',
                                    opacity: (isProcessing || selectedCount === 0) ? 0.6 : 1,
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '0.5rem',
                                    boxShadow: (isProcessing || selectedCount === 0) 
                                        ? 'none' 
                                        : `0 4px 15px ${walletPrimary}40`,
                                    transition: 'all 0.2s ease'
                                }}
                            >
                                {isProcessing && (
                                    <div style={{
                                        width: '16px',
                                        height: '16px',
                                        border: '2px solid rgba(255,255,255,0.3)',
                                        borderTop: '2px solid white',
                                        borderRadius: '50%',
                                        animation: 'modalSpin 0.8s linear infinite'
                                    }} />
                                )}
                                {getActionLabel()}
                            </button>
                        )}
                    </div>
                </div>
            </div>
            
            <style>{`
                @keyframes modalSpin {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(360deg); }
                }
            `}</style>
        </div>
    );
};

export default ConsolidateModal;
