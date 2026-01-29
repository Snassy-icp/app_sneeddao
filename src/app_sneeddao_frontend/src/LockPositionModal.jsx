// LockPositionModal.jsx
import React, { useState, useEffect } from 'react';
import ConfirmationModal from './ConfirmationModal';
import { get_short_timezone, format_duration, dateToReadable, getInitialExpiry } from './utils/DateUtils';
import { useTheme } from './contexts/ThemeContext';
import { Principal } from '@dfinity/principal';
import { createActor as createSneedLockActor, canisterId as sneedLockCanisterId } from 'declarations/sneed_lock';
import { createActor as createLedgerActor } from 'external/icrc1_ledger';
import { FaSpinner, FaWallet, FaCheck, FaCrown, FaLock, FaCreditCard, FaCheckCircle } from 'react-icons/fa';

const ICP_LEDGER_ID = 'ryjl3-tyaaa-aaaaa-aaaba-cai';

// Accent colors for lock modal
const lockPrimary = '#f59e0b';
const lockSecondary = '#d97706';
const successGreen = '#22c55e';

// Progress Overlay Component
function ProgressOverlay({ steps, currentStep, isComplete, onSuccess, position, expiry, theme }) {
    return (
        <div style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: `linear-gradient(135deg, ${theme.colors.primaryBg}f5 0%, ${isComplete ? successGreen : lockPrimary}15 100%)`,
            backdropFilter: 'blur(8px)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '40px',
            zIndex: 10,
            borderRadius: '16px',
        }}>
            {isComplete ? (
                // Success State
                <div style={{
                    textAlign: 'center',
                    animation: 'fadeIn 0.5s ease-out'
                }}>
                    <div style={{
                        width: '80px',
                        height: '80px',
                        borderRadius: '50%',
                        background: `linear-gradient(135deg, ${successGreen}, #16a34a)`,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        margin: '0 auto 20px',
                        boxShadow: `0 8px 32px ${successGreen}40`,
                        animation: 'scaleIn 0.5s ease-out'
                    }}>
                        <FaCheckCircle size={40} color="white" />
                    </div>
                    <h3 style={{
                        color: successGreen,
                        fontSize: '1.5rem',
                        fontWeight: '700',
                        margin: '0 0 8px 0'
                    }}>
                        🎉 Position Locked!
                    </h3>
                    <p style={{
                        color: theme.colors.primaryText,
                        fontSize: '1rem',
                        margin: '0 0 16px 0',
                        fontWeight: '600'
                    }}>
                        {position?.symbols} #{position?.id?.toString()}
                    </p>
                    <p style={{
                        color: theme.colors.secondaryText,
                        fontSize: '0.9rem',
                        margin: '0 0 24px 0'
                    }}>
                        Locked until {dateToReadable(new Date(expiry))}
                    </p>
                    <button
                        onClick={onSuccess}
                        style={{
                            background: `linear-gradient(135deg, ${successGreen}, #16a34a)`,
                            color: 'white',
                            border: 'none',
                            borderRadius: '10px',
                            padding: '14px 32px',
                            cursor: 'pointer',
                            fontSize: '1rem',
                            fontWeight: '600',
                            boxShadow: `0 4px 16px ${successGreen}40`
                        }}
                    >
                        Done
                    </button>
                </div>
            ) : (
                // Progress Steps
                <div style={{ width: '100%', maxWidth: '300px' }}>
                    <h3 style={{
                        color: theme.colors.primaryText,
                        textAlign: 'center',
                        marginBottom: '32px',
                        fontSize: '1.1rem',
                        fontWeight: '600'
                    }}>
                        Processing Lock...
                    </h3>
                    
                    {steps.map((step, index) => {
                        const isActive = index === currentStep;
                        const isCompleted = index < currentStep;
                        const isPending = index > currentStep;
                        
                        return (
                            <div key={index} style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '16px',
                                marginBottom: index < steps.length - 1 ? '24px' : '0',
                                opacity: isPending ? 0.4 : 1,
                                transition: 'all 0.3s ease'
                            }}>
                                <div style={{
                                    width: '40px',
                                    height: '40px',
                                    borderRadius: '50%',
                                    background: isCompleted 
                                        ? successGreen 
                                        : isActive 
                                            ? `linear-gradient(135deg, ${lockPrimary}, ${lockSecondary})`
                                            : theme.colors.secondaryBg,
                                    border: isPending ? `2px solid ${theme.colors.border}` : 'none',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    flexShrink: 0,
                                    boxShadow: isActive ? `0 4px 16px ${lockPrimary}40` : 'none',
                                    transition: 'all 0.3s ease'
                                }}>
                                    {isCompleted ? (
                                        <FaCheck color="white" size={16} />
                                    ) : isActive ? (
                                        <FaSpinner className="spin" color="white" size={16} />
                                    ) : (
                                        step.icon
                                    )}
                                </div>
                                <div style={{ flex: 1 }}>
                                    <div style={{
                                        color: isActive ? theme.colors.primaryText : theme.colors.secondaryText,
                                        fontWeight: isActive ? '600' : '500',
                                        fontSize: '0.95rem'
                                    }}>
                                        {step.label}
                                    </div>
                                    {isActive && step.sublabel && (
                                        <div style={{
                                            color: theme.colors.mutedText,
                                            fontSize: '0.8rem',
                                            marginTop: '2px'
                                        }}>
                                            {step.sublabel}
                                        </div>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
            
            <style>{`
                @keyframes fadeIn {
                    from { opacity: 0; transform: translateY(10px); }
                    to { opacity: 1; transform: translateY(0); }
                }
                @keyframes scaleIn {
                    from { transform: scale(0.5); opacity: 0; }
                    to { transform: scale(1); opacity: 1; }
                }
            `}</style>
        </div>
    );
}

function LockPositionModal({ show, onClose, liquidityPosition, onAddLockPosition, identity, isPremium }) {    
    const { theme } = useTheme();
    const [newLockPositionExpiry, setNewLockPositionExpiry] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [errorText, setErrorText] = useState('');
    const [showConfirmModal, setShowConfirmModal] = useState(false);
    const [confirmAction, setConfirmAction] = useState(null);
    const [confirmMessage, setConfirmMessage] = useState('');
    
    // Progress overlay state
    const [showProgress, setShowProgress] = useState(false);
    const [progressStep, setProgressStep] = useState(0);
    const [progressComplete, setProgressComplete] = useState(false);
    const [progressSteps, setProgressSteps] = useState([]);
    
    // Payment state
    const [lockFeeConfig, setLockFeeConfig] = useState(null);
    const [requiredFee, setRequiredFee] = useState(0n);
    const [paymentBalance, setPaymentBalance] = useState(0n);
    const [paymentSubaccount, setPaymentSubaccount] = useState(null);
    const [loadingPayment, setLoadingPayment] = useState(false);
    const [icpWalletBalance, setIcpWalletBalance] = useState(0n);

    useEffect(() => {
        if (show) {
            setNewLockPositionExpiry(getInitialExpiry());
            setErrorText('');
            fetchPaymentInfo();
        }
    }, [show, identity, isPremium]);

    const formatIcp = (e8s) => {
        const icp = Number(e8s) / 100_000_000;
        return `${icp.toFixed(4)} ICP`;
    };

    const fetchPaymentInfo = async () => {
        if (!identity) return;
        
        setLoadingPayment(true);
        try {
            const sneedLockActor = createSneedLockActor(sneedLockCanisterId, { agentOptions: { identity } });
            const icpLedgerActor = createLedgerActor(ICP_LEDGER_ID, { agentOptions: { identity } });
            
            // Get fee configuration
            const feeConfig = await sneedLockActor.get_lock_fees_icp();
            setLockFeeConfig(feeConfig);
            
            // Determine required fee based on premium status (position lock)
            const fee = isPremium ? feeConfig.premium_position_lock_fee_icp_e8s : feeConfig.position_lock_fee_icp_e8s;
            setRequiredFee(fee);
            
            // Get payment subaccount
            const subaccount = await sneedLockActor.getPaymentSubaccount(identity.getPrincipal());
            setPaymentSubaccount(subaccount);
            
            // Get current payment balance
            const payBal = await sneedLockActor.getPaymentBalance(identity.getPrincipal());
            setPaymentBalance(BigInt(payBal));
            
            // Get ICP wallet balance
            const walletBal = await icpLedgerActor.icrc1_balance_of({
                owner: identity.getPrincipal(),
                subaccount: []
            });
            setIcpWalletBalance(BigInt(walletBal));
        } catch (error) {
            console.error('Error fetching payment info:', error);
        } finally {
            setLoadingPayment(false);
        }
    };

    if (!show) {
        return null;
    }

    // Helper function to pay the fee
    const payFeeIfNeeded = async () => {
        if (BigInt(requiredFee) === 0n || paymentBalance >= BigInt(requiredFee)) {
            return true; // No payment needed or already paid
        }
        
        if (!identity || !paymentSubaccount) {
            setErrorText('Unable to process payment. Please try again.');
            return false;
        }
        
        try {
            const icpLedgerActor = createLedgerActor(ICP_LEDGER_ID, { agentOptions: { identity } });
            
            // Calculate amount to send
            const existingBalance = paymentBalance;
            const amountNeeded = BigInt(requiredFee) - existingBalance;
            const icpTxFee = 10_000n;
            const amountToSend = amountNeeded + icpTxFee;
            
            if (icpWalletBalance < amountToSend) {
                setErrorText(`Insufficient ICP balance. Need ${formatIcp(amountToSend)}, have ${formatIcp(icpWalletBalance)}`);
                return false;
            }
            
            // Transfer ICP to payment subaccount
            const result = await icpLedgerActor.icrc1_transfer({
                to: { owner: Principal.fromText(sneedLockCanisterId), subaccount: [paymentSubaccount] },
                fee: [],
                memo: [],
                from_subaccount: [],
                created_at_time: [],
                amount: amountToSend - icpTxFee
            });
            
            if (result.Err) {
                throw new Error(`Payment failed: ${JSON.stringify(result.Err)}`);
            }
            
            // Update balances
            const sneedLockActor = createSneedLockActor(sneedLockCanisterId, { agentOptions: { identity } });
            const newBalance = await sneedLockActor.getPaymentBalance(identity.getPrincipal());
            setPaymentBalance(BigInt(newBalance));
            
            const walletBal = await icpLedgerActor.icrc1_balance_of({
                owner: identity.getPrincipal(),
                subaccount: []
            });
            setIcpWalletBalance(BigInt(walletBal));
            
            return true;
        } catch (error) {
            console.error('Payment error:', error);
            setErrorText(error.message || 'Failed to process payment');
            return false;
        }
    };

    const handleAddLockPosition = async () => {
        setErrorText('');
        
        if (newLockPositionExpiry == "") {
            setErrorText("Please enter expiration first!");
            return;
        }

        if (new Date(newLockPositionExpiry) < new Date()) {
            setErrorText("Please enter expiration in the future!");
            return;
        }

        // Check if fee payment is needed
        const needsPayment = BigInt(requiredFee) > 0n && paymentBalance < BigInt(requiredFee);
        const feeMessage = needsPayment 
            ? ` A lock fee of ${formatIcp(requiredFee)} will be charged.`
            : '';

        setConfirmAction(() => async () => {
            try {
                setIsLoading(true);
                setErrorText('');
                
                // Build progress steps based on whether payment is needed
                const steps = [];
                if (needsPayment) {
                    steps.push({
                        label: 'Processing Payment',
                        sublabel: `Paying ${formatIcp(requiredFee)} fee`,
                        icon: <FaCreditCard color={theme.colors.mutedText} size={16} />
                    });
                }
                steps.push({
                    label: 'Creating Lock',
                    sublabel: `Locking position #${liquidityPosition.id.toString()}`,
                    icon: <FaLock color={theme.colors.mutedText} size={16} />
                });
                
                setProgressSteps(steps);
                setProgressStep(0);
                setProgressComplete(false);
                setShowProgress(true);
                
                // Pay fee if needed
                if (needsPayment) {
                    const paymentSuccess = await payFeeIfNeeded();
                    if (!paymentSuccess) {
                        setIsLoading(false);
                        setShowProgress(false);
                        return;
                    }
                    // Move to next step
                    setProgressStep(1);
                }
                
                const result = await onAddLockPosition(liquidityPosition, new Date(newLockPositionExpiry).getTime());
                if (result["Err"]) {
                    const error_text = result["Err"].message;
                    setErrorText(error_text);
                    setShowProgress(false);
                } else {
                    // Show success state
                    setProgressComplete(true);
                }
            } catch (error) {
                setErrorText('Error adding lock position: ' + (error.message || error.toString()));
                setShowProgress(false);
            }
            finally {
                setIsLoading(false);
            }
        });

        setConfirmMessage(
            `You are about to lock position #${liquidityPosition.id.toString()} of ${liquidityPosition.symbols} ` +
            `until ${dateToReadable(new Date(newLockPositionExpiry))} ${get_short_timezone()} ` +
            `(for ${format_duration(new Date(newLockPositionExpiry) - new Date())}).${feeMessage}`
        );
        setShowConfirmModal(true);
    };

    return (
        <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            backgroundColor: 'rgba(0, 0, 0, 0.75)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '20px',
            backdropFilter: 'blur(4px)'
        }}>
            <div style={{
                background: `linear-gradient(135deg, ${theme.colors.primaryBg} 0%, ${lockPrimary}08 100%)`,
                border: `1px solid ${theme.colors.border}`,
                boxShadow: `0 20px 60px rgba(0, 0, 0, 0.4), 0 0 40px ${lockPrimary}15`,
                borderRadius: '16px',
                padding: '0',
                width: '480px',
                maxWidth: '90vw',
                maxHeight: '90vh',
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
                position: 'relative'
            }}>
                {/* Progress Overlay */}
                {showProgress && (
                    <ProgressOverlay
                        steps={progressSteps}
                        currentStep={progressStep}
                        isComplete={progressComplete}
                        onSuccess={() => {
                            setShowProgress(false);
                            setNewLockPositionExpiry('');
                            onClose();
                        }}
                        position={liquidityPosition}
                        expiry={newLockPositionExpiry}
                        theme={theme}
                    />
                )}
                
                {/* Header */}
                <div style={{
                    background: `linear-gradient(135deg, ${lockPrimary}, ${lockSecondary})`,
                    padding: '1.25rem 1.5rem',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between'
                }}>
                    <h2 style={{
                        color: 'white',
                        margin: 0,
                        fontSize: '1.2rem',
                        fontWeight: '600',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem'
                    }}>
                        🔒 Lock {liquidityPosition.symbols} #{liquidityPosition.id.toString()}
                    </h2>
                    <button
                        onClick={onClose}
                        disabled={isLoading}
                        style={{
                            background: 'rgba(255, 255, 255, 0.2)',
                            border: 'none',
                            fontSize: '1.25rem',
                            cursor: isLoading ? 'not-allowed' : 'pointer',
                            color: 'white',
                            width: '32px',
                            height: '32px',
                            borderRadius: '8px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            opacity: isLoading ? 0.5 : 1
                        }}
                    >
                        ×
                    </button>
                </div>

                {/* Content */}
                <div style={{ padding: '1.25rem', flex: 1, overflowY: 'auto' }}>
                
                {isLoading ? (
                    <div style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        padding: '40px 20px'
                    }}>
                        <div className="spinner" style={{
                            width: '28px',
                            height: '28px',
                            border: `3px solid ${theme.colors.border}`,
                            borderTop: `3px solid ${lockPrimary}`,
                            borderRadius: '50%',
                            animation: 'spin 1s linear infinite',
                            marginBottom: '10px'
                        }}></div>
                        <span style={{ color: theme.colors.mutedText, fontSize: '0.85rem' }}>Processing...</span>
                    </div>
                ) : (
                    <div>
                        <h3 style={{
                            color: theme.colors.primaryText,
                            marginTop: 0,
                            marginBottom: '20px',
                            fontSize: '1rem',
                            fontWeight: '500'
                        }}>
                            Add New Lock
                        </h3>

                        {/* ICP Lock Fee Section - Loading */}
                        {loadingPayment && (
                            <div style={{
                                background: theme.colors.secondaryBg,
                                border: `1px solid ${theme.colors.border}`,
                                borderRadius: '8px',
                                padding: '16px',
                                marginBottom: '20px',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '12px'
                            }}>
                                <FaSpinner className="spin" style={{ color: theme.colors.accent }} />
                                <span style={{ color: theme.colors.secondaryText }}>
                                    Loading payment info...
                                </span>
                            </div>
                        )}

                        {/* ICP Lock Fee Section */}
                        {!loadingPayment && lockFeeConfig && (
                            <div style={{
                                background: theme.colors.secondaryBg,
                                border: `1px solid ${theme.colors.border}`,
                                borderRadius: '8px',
                                padding: '16px',
                                marginBottom: BigInt(requiredFee) > 0n ? '20px' : '12px'
                            }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                                    <span style={{ color: theme.colors.secondaryText, display: 'flex', alignItems: 'center', gap: '6px' }}>
                                        <FaWallet /> Lock Fee {isPremium && <FaCrown style={{ color: '#FFD700' }} />}
                                    </span>
                                    <span style={{
                                        color: BigInt(requiredFee) === 0n ? theme.colors.success : theme.colors.primaryText,
                                        fontWeight: '600'
                                    }}>
                                        {BigInt(requiredFee) === 0n ? 'FREE' : formatIcp(requiredFee)}
                                    </span>
                                </div>
                                
                                {BigInt(requiredFee) > 0n && (
                                    <>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                                            <span style={{ color: theme.colors.secondaryText }}>Payment Deposited:</span>
                                            <span style={{
                                                color: paymentBalance >= BigInt(requiredFee) ? theme.colors.success : theme.colors.warning,
                                                fontWeight: '600'
                                            }}>
                                                {formatIcp(paymentBalance)}
                                            </span>
                                        </div>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                                            <span style={{ color: theme.colors.secondaryText }}>Your ICP Balance:</span>
                                            <span style={{ color: theme.colors.primaryText }}>{formatIcp(icpWalletBalance)}</span>
                                        </div>
                                        
                                        {paymentBalance >= BigInt(requiredFee) ? (
                                            <div style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '6px',
                                                color: theme.colors.success,
                                                fontWeight: '600'
                                            }}>
                                                <FaCheck /> Fee already deposited
                                            </div>
                                        ) : (
                                            <div style={{ 
                                                fontSize: '0.8rem',
                                                color: theme.colors.secondaryText,
                                                fontStyle: 'italic'
                                            }}>
                                                Fee will be paid automatically when you click "Pay & Lock"
                                            </div>
                                        )}
                                    </>
                                )}
                            </div>
                        )}
                        
                        <div style={{ marginBottom: '20px' }}>
                            <label style={{
                                display: 'block',
                                color: theme.colors.primaryText,
                                marginBottom: '8px',
                                fontWeight: '500'
                            }}>
                                Expiration ({get_short_timezone()}):
                            </label>
                            <input
                                type="datetime-local"
                                value={newLockPositionExpiry}
                                onChange={(e) => setNewLockPositionExpiry(e.target.value)}
                                style={{
                                    width: '100%',
                                    padding: '12px',
                                    background: theme.colors.secondaryBg,
                                    border: `1px solid ${theme.colors.border}`,
                                    borderRadius: '8px',
                                    color: theme.colors.primaryText,
                                    fontSize: '0.9rem',
                                    boxSizing: 'border-box'
                                }}
                            />
                        </div>

                        {errorText && (
                            <p style={{
                                color: theme.colors.error,
                                marginBottom: '20px',
                                padding: '12px',
                                background: `${theme.colors.error}15`,
                                border: `1px solid ${theme.colors.error}30`,
                                borderRadius: '8px',
                                fontSize: '0.9rem'
                            }}>
                                {errorText}
                            </p>
                        )}

                        <div style={{
                            display: 'flex',
                            gap: '12px',
                            marginTop: '20px'
                        }}>
                            <button 
                                onClick={handleAddLockPosition}
                                style={{
                                    flex: '2',
                                    background: `linear-gradient(135deg, ${lockPrimary}, ${lockSecondary})`,
                                    color: 'white',
                                    border: 'none',
                                    borderRadius: '10px',
                                    padding: '14px 24px',
                                    cursor: 'pointer',
                                    fontSize: '0.95rem',
                                    fontWeight: '600',
                                    boxShadow: `0 4px 12px ${lockPrimary}40`
                                }}
                            >
                                {BigInt(requiredFee) > 0n && paymentBalance < BigInt(requiredFee)
                                    ? '💰 Pay & Lock'
                                    : '🔒 Add Lock'}
                            </button>
                            <button 
                                onClick={onClose}
                                style={{
                                    flex: '1',
                                    background: theme.colors.secondaryBg,
                                    color: theme.colors.primaryText,
                                    border: `1px solid ${theme.colors.border}`,
                                    borderRadius: '10px',
                                    padding: '14px 24px',
                                    cursor: 'pointer',
                                    fontSize: '0.95rem',
                                    fontWeight: '500'
                                }}
                            >
                                Close
                            </button>
                        </div>
                    </div>
                )}
                </div>
            </div>
            <ConfirmationModal
                show={showConfirmModal}
                onClose={() => setShowConfirmModal(false)}
                onSubmit={confirmAction}
                message={confirmMessage}
                doAwait={false}
            />
        </div>
    );
}

export default LockPositionModal;