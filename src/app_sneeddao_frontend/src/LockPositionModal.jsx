// LockPositionModal.jsx
import React, { useState, useEffect } from 'react';
import './LockPositionModal.css';
import ConfirmationModal from './ConfirmationModal';
import { get_short_timezone, format_duration, dateToReadable, getInitialExpiry } from './utils/DateUtils';

function LockPositionModal({ show, onClose, liquidityPosition, onAddLockPosition }) {    
    const [newLockPositionExpiry, setNewLockPositionExpiry] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [errorText, setErrorText] = useState('');
    const [showConfirmModal, setShowConfirmModal] = useState(false);
    const [confirmAction, setConfirmAction] = useState(null);
    const [confirmMessage, setConfirmMessage] = useState('');

    useEffect(() => {
        if (show) {
            setNewLockPositionExpiry(getInitialExpiry());
            setErrorText('');
        }
    }, [show]);

    if (!show) {
        return null;
    }

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

        setConfirmAction(() => async () => {
            try {
                setIsLoading(true);
                setErrorText('');
                const result = await onAddLockPosition(liquidityPosition, new Date(newLockPositionExpiry).getTime());
                if (result["Err"]) {
                    const error_text = result["Err"].message;
                    setErrorText(error_text);
                } else {
                    setNewLockPositionExpiry('');
                    onClose();
                }
            } catch (error) {
                setErrorText('Error adding lock position: ' + error.toString());
            }
            finally {
                setIsLoading(false);
            }
        });

        setConfirmMessage(
            `You are about to lock position #${liquidityPosition.id.toString()} of ${liquidityPosition.symbols} ` +
            `until ${dateToReadable(new Date(newLockPositionExpiry))} ${get_short_timezone()} ` +
            `(for ${format_duration(new Date(newLockPositionExpiry) - new Date())}).`
        );
        setShowConfirmModal(true);
    };

    return (
        <div className="modal-backdrop">
            <div className="modal-content">
                <h2>{`Lock ${liquidityPosition.symbols} #${liquidityPosition.id.toString()}`}</h2>
                {isLoading ? (
                    <div className="spinner"></div>
                ) : (
                    <div>
                        <h3>Add New Lock</h3>
                        <label>
                            Expiration ({get_short_timezone()}):
                            <input
                                type="datetime-local"
                                value={newLockPositionExpiry}
                                onChange={(e) => setNewLockPositionExpiry(e.target.value)}
                            />
                        </label>
                        {errorText && <p className="error-text">{errorText}</p>}
                        <div className="button-group">
                            <button onClick={handleAddLockPosition}>Add Lock</button>
                            <button onClick={onClose}>Close</button>
                        </div>
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

export default LockPositionModal;