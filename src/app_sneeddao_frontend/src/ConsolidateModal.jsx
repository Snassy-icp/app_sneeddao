import React, { useState } from 'react';
import { useTheme } from './contexts/ThemeContext';
import { formatAmount } from './utils/StringUtils';

const ConsolidateModal = ({ 
    isOpen, 
    onClose, 
    type, // 'fees', 'rewards', 'maturity', or 'all'
    items, // Array of items to consolidate
    onConsolidate 
}) => {
    const { theme } = useTheme();
    const [selectedItems, setSelectedItems] = useState(() => 
        items.map(item => ({ ...item, selected: true, status: 'pending' }))
    );
    const [isProcessing, setIsProcessing] = useState(false);

    if (!isOpen) return null;

    const getTitle = () => {
        switch (type) {
            case 'fees': return 'Consolidate Fees';
            case 'rewards': return 'Consolidate Rewards';
            case 'maturity': return 'Consolidate Maturity';
            case 'all': return 'Consolidate All';
            default: return 'Consolidate';
        }
    };

    const getActionLabel = () => {
        switch (type) {
            case 'fees': return 'Claim Fees';
            case 'rewards': return 'Claim Rewards';
            case 'maturity': return 'Disburse Maturity';
            case 'all': return 'Consolidate All';
            default: return 'Consolidate';
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
                console.error(`Error consolidating item:`, error);
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

    return (
        <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.7)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '20px'
        }}>
            <div style={{
                backgroundColor: theme.colors.primaryBg,
                borderRadius: '12px',
                padding: '24px',
                maxWidth: '600px',
                width: '100%',
                maxHeight: '80vh',
                display: 'flex',
                flexDirection: 'column',
                border: `1px solid ${theme.colors.border}`,
                boxShadow: '0 4px 20px rgba(0, 0, 0, 0.3)'
            }}>
                {/* Header */}
                <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '20px'
                }}>
                    <h2 style={{
                        margin: 0,
                        color: theme.colors.primaryText,
                        fontSize: '1.5rem'
                    }}>
                        {getTitle()}
                    </h2>
                    <button
                        onClick={onClose}
                        disabled={isProcessing}
                        style={{
                            background: 'none',
                            border: 'none',
                            fontSize: '1.5rem',
                            cursor: isProcessing ? 'not-allowed' : 'pointer',
                            color: theme.colors.mutedText,
                            padding: '0',
                            opacity: isProcessing ? 0.5 : 1
                        }}
                    >
                        ×
                    </button>
                </div>

                {/* Select All Toggle */}
                {!anyProcessed && (
                    <div style={{
                        marginBottom: '16px',
                        paddingBottom: '12px',
                        borderBottom: `1px solid ${theme.colors.border}`
                    }}>
                        <label style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            cursor: 'pointer',
                            color: theme.colors.primaryText,
                            fontWeight: '600'
                        }}>
                            <input
                                type="checkbox"
                                checked={allSelected}
                                onChange={toggleAll}
                                disabled={isProcessing}
                                style={{ cursor: 'pointer' }}
                            />
                            Select All ({selectedCount} of {selectedItems.length} selected)
                        </label>
                    </div>
                )}

                {/* Items List */}
                <div style={{
                    flex: 1,
                    overflowY: 'auto',
                    marginBottom: '20px'
                }}>
                    {selectedItems.length === 0 ? (
                        <p style={{ color: theme.colors.mutedText, textAlign: 'center' }}>
                            No items available to consolidate
                        </p>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                            {selectedItems.map((item, index) => (
                                <div
                                    key={index}
                                    style={{
                                        backgroundColor: theme.colors.secondaryBg,
                                        padding: '12px',
                                        borderRadius: '8px',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '12px',
                                        border: `1px solid ${theme.colors.border}`,
                                        opacity: (!item.selected && !anyProcessed) ? 0.5 : 1
                                    }}
                                >
                                    {!anyProcessed && (
                                        <input
                                            type="checkbox"
                                            checked={item.selected}
                                            onChange={() => toggleItem(index)}
                                            disabled={isProcessing}
                                            style={{ cursor: isProcessing ? 'not-allowed' : 'pointer' }}
                                        />
                                    )}
                                    
                                    <div style={{ flex: 1 }}>
                                        <div style={{
                                            color: theme.colors.primaryText,
                                            fontWeight: '500',
                                            marginBottom: '4px'
                                        }}>
                                            {item.name}
                                        </div>
                                        <div style={{
                                            color: theme.colors.secondaryText,
                                            fontSize: '0.9rem'
                                        }}>
                                            {item.description}
                                        </div>
                                        {item.usdValue > 0 && (
                                            <div style={{
                                                color: theme.colors.accent,
                                                fontSize: '0.9rem',
                                                marginTop: '4px',
                                                fontWeight: '500'
                                            }}>
                                                ${item.usdValue.toLocaleString(undefined, { 
                                                    minimumFractionDigits: 2, 
                                                    maximumFractionDigits: 2 
                                                })}
                                            </div>
                                        )}
                                        {item.status === 'error' && item.error && (
                                            <div style={{
                                                color: theme.colors.error || '#e74c3c',
                                                fontSize: '0.85rem',
                                                marginTop: '4px'
                                            }}>
                                                Error: {item.error}
                                            </div>
                                        )}
                                    </div>
                                    
                                    {getStatusIcon(item.status) && (
                                        <span style={{ fontSize: '1.2rem' }}>
                                            {getStatusIcon(item.status)}
                                        </span>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Action Buttons */}
                <div style={{
                    display: 'flex',
                    gap: '12px',
                    justifyContent: 'flex-end'
                }}>
                    <button
                        onClick={onClose}
                        disabled={isProcessing}
                        style={{
                            padding: '10px 20px',
                            borderRadius: '8px',
                            border: `1px solid ${theme.colors.border}`,
                            backgroundColor: theme.colors.secondaryBg,
                            color: theme.colors.primaryText,
                            cursor: isProcessing ? 'not-allowed' : 'pointer',
                            fontSize: '1rem',
                            fontWeight: '500',
                            opacity: isProcessing ? 0.5 : 1
                        }}
                    >
                        {anyProcessed ? 'Close' : 'Cancel'}
                    </button>
                    
                    {!anyProcessed && (
                        <button
                            onClick={handleConsolidate}
                            disabled={isProcessing || selectedCount === 0}
                            style={{
                                padding: '10px 20px',
                                borderRadius: '8px',
                                border: 'none',
                                backgroundColor: theme.colors.accent,
                                color: theme.colors.primaryBg,
                                cursor: (isProcessing || selectedCount === 0) ? 'not-allowed' : 'pointer',
                                fontSize: '1rem',
                                fontWeight: '600',
                                opacity: (isProcessing || selectedCount === 0) ? 0.5 : 1,
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px'
                            }}
                        >
                            {isProcessing && (
                                <div style={{
                                    width: '16px',
                                    height: '16px',
                                    border: `2px solid ${theme.colors.primaryBg}`,
                                    borderTop: '2px solid transparent',
                                    borderRadius: '50%',
                                    animation: 'spin 1s linear infinite'
                                }} />
                            )}
                            {getActionLabel()}
                        </button>
                    )}
                </div>
            </div>
            
            <style>{`
                @keyframes spin {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(360deg); }
                }
            `}</style>
        </div>
    );
};

export default ConsolidateModal;

