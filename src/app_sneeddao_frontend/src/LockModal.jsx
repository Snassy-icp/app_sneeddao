// LockModal.jsx
import React, { useState, useEffect } from 'react';
import './LockModal.css';
import ConfirmationModal from './ConfirmationModal';
import { get_short_timezone, format_duration, dateToReadable, getInitialExpiry } from './utils/DateUtils';
import { formatAmount } from './utils/StringUtils';

function LockModal({ show, onClose, token, locks, onAddLock }) {
    const [newLockAmount, setNewLockAmount] = useState('');
    const [newLockExpiry, setNewLockExpiry] = useState(getInitialExpiry());
    const [isLoading, setIsLoading] = useState(false);
    const [errorText, setErrorText] = useState('');
    const [showConfirmModal, setShowConfirmModal] = useState(false);
    const [confirmAction, setConfirmAction] = useState(null);
    const [confirmMessage, setConfirmMessage] = useState('');

    useEffect(() => {
        if (show) {
            setNewLockExpiry(getInitialExpiry());
            setErrorText('');
        }
    }, [show]);

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
        <div className="modal-backdrop">
            <div className="modal-content">
                <h2>{token ? `Lock ${token.symbol}` : 'All Lock Details'}</h2>
                {/* {locks[token.ledger_canister_id] && locks[token.ledger_canister_id].length === 0 ? (
                    <p>No locks found.</p>
                ) : (
                    <ul className="lock-list">
                        {locks[token.ledger_canister_id]?.map((lock, index) => (
                            <li key={index} className="lock-item">
                                <p>Amount: {lock.amount.toString()}</p>
                                <p>Expiration ({get_short_timezone()}): {new Date(Number(lock.expiry)).toLocaleString()}</p>
                            </li>
                        ))}
                    </ul>
                )}              */}
                <h3>Add New Lock</h3>
                <label>
                    Amount:
                    <div className="amount-input-container">
                        <input 
                            type="number"
                            placeholder="Amount"
                            value={newLockAmount}
                            onChange={(e) => setNewLockAmount(e.target.value)}
                        />
                        <button className="max-button" onClick={handleSetMax}>MAX</button>
                    </div>
                </label>
                <label>
                    Expiration ({get_short_timezone()}):
                    <input
                        type="datetime-local"
                        value={newLockExpiry}
                        onChange={(e) => setNewLockExpiry(e.target.value)}
                    />
                </label>
                {errorText && <p className="error-text">{errorText}</p>}
                {isLoading ? (
                    <div>
                        <br />
                        <div className="spinner"></div>
                    </div>
                ) : (
                    <div className="button-group">  
                        <button onClick={handleAddLock}>Add Lock</button>
                        <button onClick={onClose}>Close</button>
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