// LockModal.jsx
import React, { useState, useEffect } from 'react';
import './LockModal.css';
import ConfirmationModal from './ConfirmationModal';
import { get_short_timezone, format_duration, dateToReadable, getInitialExpiry } from './utils/DateUtils';
import { formatAmount } from './utils/StringUtils';
import { useTheme } from './contexts/ThemeContext';
import { Principal } from '@dfinity/principal';
import { createActor as createSneedLockActor, canisterId as sneedLockCanisterId } from 'declarations/sneed_lock';
import { createActor as createLedgerActor } from 'external/icrc1_ledger';
import { FaSpinner, FaWallet, FaCheck, FaCrown } from 'react-icons/fa';

const ICP_LEDGER_ID = 'ryjl3-tyaaa-aaaaa-aaaba-cai';

function LockModal({ show, onClose, token, locks, onAddLock, identity, isPremium }) {
    const { theme } = useTheme();
    const [newLockAmount, setNewLockAmount] = useState('');
    const [newLockExpiry, setNewLockExpiry] = useState(getInitialExpiry());
    const [isLoading, setIsLoading] = useState(false);
    const [errorText, setErrorText] = useState('');
    const [showConfirmModal, setShowConfirmModal] = useState(false);
    const [confirmAction, setConfirmAction] = useState(null);
    const [confirmMessage, setConfirmMessage] = useState('');
    
    // Payment state
    const [lockFeeConfig, setLockFeeConfig] = useState(null);
    const [requiredFee, setRequiredFee] = useState(0n);
    const [paymentBalance, setPaymentBalance] = useState(0n);
    const [paymentSubaccount, setPaymentSubaccount] = useState(null);
    const [loadingPayment, setLoadingPayment] = useState(false);
    const [isPayingFee, setIsPayingFee] = useState(false);
    const [icpWalletBalance, setIcpWalletBalance] = useState(0n);

    useEffect(() => {
        if (show) {
            setNewLockExpiry(getInitialExpiry());
            setErrorText('');
            fetchPaymentInfo();
        }
    }, [show, identity, isPremium]);

    const fetchPaymentInfo = async () => {
        if (!identity) return;
        
        setLoadingPayment(true);
        try {
            const sneedLockActor = createSneedLockActor(sneedLockCanisterId, { agentOptions: { identity } });
            const icpLedgerActor = createLedgerActor(ICP_LEDGER_ID, { agentOptions: { identity } });
            
            // Get fee configuration
            const feeConfig = await sneedLockActor.get_lock_fees_icp();
            setLockFeeConfig(feeConfig);
            
            // Determine required fee based on premium status (token lock)
            const fee = isPremium ? feeConfig.premium_token_lock_fee_icp_e8s : feeConfig.token_lock_fee_icp_e8s;
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

    const handlePayFee = async () => {
        if (!identity || !paymentSubaccount) return;
        
        setIsPayingFee(true);
        setErrorText('');
        
        try {
            const icpLedgerActor = createLedgerActor(ICP_LEDGER_ID, { agentOptions: { identity } });
            
            // Calculate amount to send
            const existingBalance = paymentBalance;
            const amountNeeded = BigInt(requiredFee) - existingBalance;
            const icpTxFee = 10_000n;
            const amountToSend = amountNeeded + icpTxFee;
            
            if (icpWalletBalance < amountToSend) {
                setErrorText(`Insufficient ICP balance. Need ${formatIcp(amountToSend)}, have ${formatIcp(icpWalletBalance)}`);
                setIsPayingFee(false);
                return;
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
                throw new Error(`Transfer failed: ${JSON.stringify(result.Err)}`);
            }
            
            // Refresh payment balance
            const sneedLockActor = createSneedLockActor(sneedLockCanisterId, { agentOptions: { identity } });
            const newBalance = await sneedLockActor.getPaymentBalance(identity.getPrincipal());
            setPaymentBalance(BigInt(newBalance));
            
            // Refresh wallet balance
            const walletBal = await icpLedgerActor.icrc1_balance_of({
                owner: identity.getPrincipal(),
                subaccount: []
            });
            setIcpWalletBalance(BigInt(walletBal));
        } catch (error) {
            console.error('Payment error:', error);
            setErrorText(error.message || 'Failed to send payment');
        } finally {
            setIsPayingFee(false);
        }
    };

    const formatIcp = (e8s) => {
        const icp = Number(e8s) / 100_000_000;
        return `${icp.toFixed(4)} ICP`;
    };

    if (!show) {
        return null;
    }

    const handleSetMax = () => {
        // example
        // balance: 200
        // locked: 100
        // available: 100
        // backend_available: 70
        // frontend_available: available - backend_available
        // max: backend_available + frontend_available - fee

        var max = token.available_backend;
        if (token.available > token.available_backend) {
            var frontend_max = (token.available - token.available_backend - token.fee);
            if (frontend_max < 0n) { frontend_max = 0n; }
            max += frontend_max;
        }

        if (max < 0n) { max = 0n; }
        setNewLockAmount(formatAmount(max, token.decimals));
    };
    
    const handleAddLock = async () => {
        setErrorText('');

        if (newLockAmount == "") {
            setErrorText("Please enter an amount first!");
            return;
        }

        // Convert to BigInt safely - handle decimal inputs from formatAmount
        const amountFloat = parseFloat(newLockAmount);
        if (isNaN(amountFloat) || amountFloat <= 0) {
            setErrorText("Invalid amount! Please enter a positive amount.");
            return;
        }
        
        const scaledAmount = amountFloat * (10 ** token.decimals);
        const bigIntAmount = BigInt(Math.floor(scaledAmount));

        if (bigIntAmount > token.available_backend) {
            if (bigIntAmount > BigInt(token.available) - BigInt(token.fee)) {
                setErrorText("Insufficient available balance! Please enter an amount less than or equal to your available balance.");
                return;
            }
        }

        if (newLockExpiry == "") {
            setErrorText("Please enter expiration first!");
            return;
        }

        if (new Date(newLockExpiry) < new Date()) {
            setErrorText("Please enter expiration in the future!");
            return;
        }

        setConfirmAction(() => async () => {            
            try {
                setIsLoading(true);
                setErrorText('');
                const result = await onAddLock(token, newLockAmount, new Date(newLockExpiry).getTime());
                if (result["Err"]) {
                    var error_text = result["Err"].message;
                    setErrorText(error_text);
                } else {
                    setNewLockAmount('');
                    setNewLockExpiry('');
                    onClose();
                }
            } catch (error) {
                setErrorText('Error adding lock:', error);
            } finally {
                setIsLoading(false);
            }
        });

        setConfirmMessage(
            `You are about to lock ${newLockAmount} ${token.symbol} ` +
            `until ${dateToReadable(new Date(newLockExpiry))} ${get_short_timezone()} ` +
            `(for ${format_duration(new Date(newLockExpiry) - new Date())}).`
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
            background: theme.colors.modalBg,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000
        }}>
            <div style={{
                background: theme.colors.cardGradient,
                border: `1px solid ${theme.colors.border}`,
                boxShadow: theme.colors.cardShadow,
                borderRadius: '16px',
                padding: '32px',
                width: '450px',
                maxWidth: '90vw',
                maxHeight: '90vh',
                overflow: 'auto'
            }}>
                <h2 style={{
                    color: theme.colors.primaryText,
                    marginTop: '0',
                    marginBottom: '24px',
                    fontSize: '1.5rem',
                    fontWeight: '600'
                }}>
                    {token ? `Lock ${token.symbol}` : 'All Lock Details'}
                </h2>

                <h3 style={{
                    color: theme.colors.primaryText,
                    marginBottom: '20px',
                    fontSize: '1.2rem',
                    fontWeight: '500'
                }}>
                    Add New Lock
                </h3>
                
                <div style={{ marginBottom: '20px' }}>
                    <label style={{
                        display: 'block',
                        color: theme.colors.primaryText,
                        marginBottom: '8px',
                        fontWeight: '500'
                    }}>
                        Amount:
                    </label>
                    <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px'
                    }}>
                        <input 
                            type="number"
                            placeholder="Amount"
                            value={newLockAmount}
                            onChange={(e) => setNewLockAmount(e.target.value)}
                            style={{
                                flex: '1',
                                padding: '12px',
                                background: theme.colors.secondaryBg,
                                border: `1px solid ${theme.colors.border}`,
                                borderRadius: '8px',
                                color: theme.colors.primaryText,
                                fontSize: '0.9rem',
                                boxSizing: 'border-box'
                            }}
                        />
                        <button 
                            onClick={handleSetMax}
                            style={{
                                background: theme.colors.accent,
                                color: theme.colors.primaryBg,
                                border: 'none',
                                borderRadius: '8px',
                                padding: '12px 16px',
                                cursor: 'pointer',
                                fontSize: '0.85rem',
                                fontWeight: '600',
                                transition: 'all 0.2s ease'
                            }}
                            onMouseEnter={(e) => {
                                e.target.style.background = theme.colors.accentHover;
                            }}
                            onMouseLeave={(e) => {
                                e.target.style.background = theme.colors.accent;
                            }}
                        >
                            MAX
                        </button>
                    </div>
                </div>

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
                        value={newLockExpiry}
                        onChange={(e) => setNewLockExpiry(e.target.value)}
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

                {/* Lock Fee Section - Loading */}
                {loadingPayment && (
                    <div style={{
                        marginBottom: '20px',
                        padding: '16px',
                        background: theme.colors.secondaryBg,
                        border: `1px solid ${theme.colors.border}`,
                        borderRadius: '12px',
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

                {/* Lock Fee Section */}
                {!loadingPayment && lockFeeConfig && (
                    <div style={{
                        marginBottom: '20px',
                        padding: '16px',
                        background: theme.colors.secondaryBg,
                        border: `1px solid ${theme.colors.border}`,
                        borderRadius: '12px'
                    }}>
                        <div style={{ 
                            display: 'flex', 
                            justifyContent: 'space-between', 
                            alignItems: 'center',
                            marginBottom: BigInt(requiredFee) > 0n ? '12px' : '0'
                        }}>
                            <span style={{ color: theme.colors.secondaryText, display: 'flex', alignItems: 'center', gap: '6px' }}>
                                Lock Fee:
                                {isPremium && <FaCrown size={12} style={{ color: '#FFD700' }} />}
                            </span>
                            <span style={{ 
                                color: BigInt(requiredFee) === 0n ? theme.colors.success : theme.colors.primaryText,
                                fontWeight: 'bold'
                            }}>
                                {BigInt(requiredFee) === 0n ? 'FREE' : formatIcp(requiredFee)}
                            </span>
                        </div>
                        
                        {BigInt(requiredFee) > 0n && (
                            <>
                                <div style={{ 
                                    display: 'flex', 
                                    justifyContent: 'space-between', 
                                    alignItems: 'center',
                                    marginBottom: '12px'
                                }}>
                                    <span style={{ color: theme.colors.secondaryText }}>Payment Deposited:</span>
                                    <span style={{ 
                                        color: paymentBalance >= BigInt(requiredFee) ? theme.colors.success : theme.colors.warning,
                                        fontWeight: '500'
                                    }}>
                                        {formatIcp(paymentBalance)}
                                    </span>
                                </div>
                                
                                <div style={{ 
                                    display: 'flex', 
                                    justifyContent: 'space-between', 
                                    alignItems: 'center',
                                    paddingTop: '12px',
                                    borderTop: `1px solid ${theme.colors.border}`
                                }}>
                                    <span style={{ color: theme.colors.secondaryText }}>Your ICP Wallet:</span>
                                    <span style={{ color: theme.colors.primaryText }}>
                                        {formatIcp(icpWalletBalance)}
                                    </span>
                                </div>
                                
                                {paymentBalance < BigInt(requiredFee) && (
                                    <div style={{ marginTop: '12px' }}>
                                        <button
                                            onClick={handlePayFee}
                                            disabled={isPayingFee || icpWalletBalance < (BigInt(requiredFee) - paymentBalance + 10_000n)}
                                            style={{
                                                width: '100%',
                                                background: theme.colors.accent,
                                                color: theme.colors.primaryBg,
                                                border: 'none',
                                                borderRadius: '8px',
                                                padding: '10px 16px',
                                                fontWeight: '600',
                                                cursor: isPayingFee ? 'not-allowed' : 'pointer',
                                                opacity: isPayingFee ? 0.7 : 1,
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                gap: '8px'
                                            }}
                                        >
                                            {isPayingFee ? (
                                                <>
                                                    <FaSpinner className="spin" />
                                                    Sending...
                                                </>
                                            ) : (
                                                <>
                                                    <FaWallet />
                                                    Pay {formatIcp(BigInt(requiredFee) - paymentBalance + 10_000n)}
                                                </>
                                            )}
                                        </button>
                                    </div>
                                )}
                                
                                {paymentBalance >= BigInt(requiredFee) && (
                                    <div style={{ 
                                        marginTop: '12px', 
                                        display: 'flex', 
                                        alignItems: 'center', 
                                        gap: '8px',
                                        color: theme.colors.success 
                                    }}>
                                        <FaCheck />
                                        <span>Payment ready!</span>
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                )}

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

                {isLoading || loadingPayment ? (
                    <div style={{
                        display: 'flex',
                        justifyContent: 'center',
                        padding: '20px'
                    }}>
                        <div className="spinner" style={{
                            width: '24px',
                            height: '24px',
                            border: `3px solid ${theme.colors.border}`,
                            borderTop: `3px solid ${theme.colors.accent}`,
                            borderRadius: '50%',
                            animation: 'spin 1s linear infinite'
                        }}></div>
                    </div>
                ) : (
                    <div style={{
                        display: 'flex',
                        gap: '12px',
                        marginTop: '24px'
                    }}>
                        <button 
                            onClick={handleAddLock}
                            disabled={BigInt(requiredFee) > 0n && paymentBalance < BigInt(requiredFee)}
                            style={{
                                flex: '1',
                                background: (BigInt(requiredFee) > 0n && paymentBalance < BigInt(requiredFee)) 
                                    ? theme.colors.tertiaryBg 
                                    : theme.colors.accent,
                                color: (BigInt(requiredFee) > 0n && paymentBalance < BigInt(requiredFee)) 
                                    ? theme.colors.mutedText 
                                    : theme.colors.primaryBg,
                                border: 'none',
                                borderRadius: '8px',
                                padding: '12px 24px',
                                cursor: (BigInt(requiredFee) > 0n && paymentBalance < BigInt(requiredFee)) 
                                    ? 'not-allowed' 
                                    : 'pointer',
                                fontSize: '0.95rem',
                                fontWeight: '600',
                                transition: 'all 0.2s ease'
                            }}
                            onMouseEnter={(e) => {
                                if (!(BigInt(requiredFee) > 0n && paymentBalance < BigInt(requiredFee))) {
                                    e.target.style.background = theme.colors.accentHover;
                                }
                            }}
                            onMouseLeave={(e) => {
                                if (!(BigInt(requiredFee) > 0n && paymentBalance < BigInt(requiredFee))) {
                                    e.target.style.background = theme.colors.accent;
                                }
                            }}
                        >
                            {BigInt(requiredFee) > 0n && paymentBalance < BigInt(requiredFee) 
                                ? 'Pay First to Lock' 
                                : 'Add Lock'}
                        </button>
                        <button 
                            onClick={onClose}
                            style={{
                                flex: '1',
                                background: theme.colors.secondaryBg,
                                color: theme.colors.mutedText,
                                border: `1px solid ${theme.colors.border}`,
                                borderRadius: '8px',
                                padding: '12px 24px',
                                cursor: 'pointer',
                                fontSize: '0.95rem',
                                fontWeight: '500',
                                transition: 'all 0.2s ease'
                            }}
                            onMouseEnter={(e) => {
                                e.target.style.background = theme.colors.tertiaryBg;
                                e.target.style.color = theme.colors.primaryText;
                            }}
                            onMouseLeave={(e) => {
                                e.target.style.background = theme.colors.secondaryBg;
                                e.target.style.color = theme.colors.mutedText;
                            }}
                        >
                            Close
                        </button>
                    </div>
                )}
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

export default LockModal;