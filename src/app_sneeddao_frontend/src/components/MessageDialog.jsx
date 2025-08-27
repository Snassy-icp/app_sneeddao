import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '../AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { createActor as createSmsActor } from '../../../declarations/sneed_sms';
import { Principal } from '@dfinity/principal';
import PrincipalInput from './PrincipalInput';

const MessageDialog = ({ 
    isOpen, 
    onClose, 
    initialRecipient = '', 
    initialSubject = '', 
    initialBody = '', 
    replyToId = null,
    onSuccess = null 
}) => {
    const { identity } = useAuth();
    const { theme } = useTheme();
    const [config, setConfig] = useState(null);
    const [composeForm, setComposeForm] = useState({
        recipients: [initialRecipient],
        subject: initialSubject,
        body: initialBody,
        replyTo: replyToId
    });
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState(null);
    const [recipientValidation, setRecipientValidation] = useState('');

    // Reset form when dialog opens/closes or initial values change
    useEffect(() => {
        if (isOpen) {
            setComposeForm({
                recipients: [initialRecipient || ''],
                subject: initialSubject || '',
                body: initialBody || '',
                replyTo: replyToId
            });
            setError(null);
            setRecipientValidation('');
        }
    }, [isOpen, initialRecipient, initialSubject, initialBody, replyToId]);

    // Fetch SMS config
    useEffect(() => {
        const fetchConfig = async () => {
            if (!identity || !isOpen) return;
            
            try {
                const actor = getSmsActor();
                if (actor) {
                    const configData = await actor.get_config();
                    setConfig(configData);
                }
            } catch (err) {
                console.error('Error fetching SMS config:', err);
            }
        };

        fetchConfig();
    }, [identity, isOpen]);

    // Create SMS actor
    const getSmsActor = () => {
        if (!identity) return null;
        const canisterId = process.env.CANISTER_ID_SNEED_SMS || 'v33jy-4qaaa-aaaad-absna-cai';
        return createSmsActor(canisterId, {
            agentOptions: { identity }
        });
    };

    // Validate form
    const isFormValid = () => {
        const validRecipients = composeForm.recipients.filter(r => {
            if (!r.trim()) return false;
            try {
                Principal.fromText(r.trim());
                return true;
            } catch (e) {
                return false;
            }
        });
        
        return composeForm.subject.trim() && 
               composeForm.body.trim() && 
               validRecipients.length > 0;
    };

    // Send message
    const sendMessage = async () => {
        if (!identity || !isFormValid()) {
            setError('Please fill in all required fields and ensure at least one recipient is valid');
            return;
        }

        setSubmitting(true);
        setError(null);
        
        try {
            const actor = getSmsActor();
            if (!actor) return;

            // Convert valid recipients to Principal objects
            const validRecipients = composeForm.recipients.filter(r => {
                if (!r.trim()) return false;
                try {
                    Principal.fromText(r.trim());
                    return true;
                } catch (e) {
                    return false;
                }
            });

            const recipientPrincipals = validRecipients.map(r => Principal.fromText(r.trim()));

            const messageInput = {
                recipients: recipientPrincipals,
                subject: composeForm.subject.trim(),
                body: composeForm.body.trim(),
                reply_to: composeForm.replyTo ? [[BigInt(composeForm.replyTo)]] : []
            };

            const result = await actor.send_message(messageInput);
            
            if ('ok' in result) {
                // Success
                if (onSuccess) {
                    onSuccess();
                }
                onClose();
            } else {
                // Extract the specific error message from the backend response
                let errorMsg = 'Failed to send message';
                if (result.err.RateLimited) {
                    errorMsg = `Rate Limited: ${result.err.RateLimited}`;
                } else if (result.err.InvalidInput) {
                    errorMsg = `Invalid Input: ${result.err.InvalidInput}`;
                } else if (result.err.Unauthorized) {
                    errorMsg = `Unauthorized: ${result.err.Unauthorized}`;
                } else if (result.err.NotFound) {
                    errorMsg = `Not Found: ${result.err.NotFound}`;
                } else if (result.err.AlreadyExists) {
                    errorMsg = `Already Exists: ${result.err.AlreadyExists}`;
                }

                setError(errorMsg);
            }
        } catch (err) {
            console.error('Error sending message:', err);
            setError('Failed to send message: ' + (err.message || err.toString()));
        } finally {
            setSubmitting(false);
        }
    };

    // Handle recipient changes
    const handleRecipientChange = (index, value) => {
        const newRecipients = [...composeForm.recipients];
        newRecipients[index] = value;
        setComposeForm(prev => ({ ...prev, recipients: newRecipients }));
    };

    // Add recipient
    const addRecipient = () => {
        setComposeForm(prev => ({ 
            ...prev, 
            recipients: [...prev.recipients, ''] 
        }));
    };

    // Remove recipient
    const removeRecipient = (index) => {
        if (composeForm.recipients.length > 1) {
            const newRecipients = composeForm.recipients.filter((_, i) => i !== index);
            setComposeForm(prev => ({ ...prev, recipients: newRecipients }));
        }
    };

    if (!isOpen) return null;

    return createPortal(
        <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: theme.colors.modalBg,
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            zIndex: 10001
        }}>
            <div style={{
                background: theme.colors.cardGradient,
                border: `1px solid ${theme.colors.border}`,
                boxShadow: theme.colors.cardShadow,
                borderRadius: '8px',
                padding: '20px',
                width: '90%',
                maxWidth: '600px',
                maxHeight: '90vh',
                overflow: 'auto'
            }}>
                <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '20px'
                }}>
                    <h3 style={{ color: theme.colors.primaryText, margin: 0 }}>
                        {replyToId ? 'Reply to Message' : 'Send Message'}
                    </h3>
                    <button
                        onClick={onClose}
                        style={{
                            background: 'none',
                            border: 'none',
                            color: theme.colors.mutedText,
                            fontSize: '24px',
                            cursor: 'pointer',
                            padding: '0',
                            width: '30px',
                            height: '30px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center'
                        }}
                    >
                        ×
                    </button>
                </div>

                {error && (
                    <div style={{
                        background: `linear-gradient(135deg, ${theme.colors.error}20, ${theme.colors.error}10)`,
                        border: `1px solid ${theme.colors.error}`,
                        color: theme.colors.error,
                        padding: '10px',
                        borderRadius: '4px',
                        marginBottom: '15px'
                    }}>
                        {error}
                    </div>
                )}

                <div style={{ marginBottom: '15px' }}>
                    <label style={{ color: theme.colors.primaryText, display: 'block', marginBottom: '8px' }}>
                        Recipients *
                    </label>
                    {composeForm.recipients.map((recipient, index) => (
                        <div key={index} style={{ display: 'flex', gap: '8px', marginBottom: '8px', alignItems: 'center' }}>
                            <PrincipalInput
                                value={recipient}
                                onChange={(value) => handleRecipientChange(index, value)}
                                placeholder="Enter principal ID..."
                                style={{ flex: 1 }}
                            />
                            {composeForm.recipients.length > 1 && (
                                <button
                                    onClick={() => removeRecipient(index)}
                                    style={{
                                        background: theme.colors.error,
                                        color: theme.colors.primaryBg,
                                        border: 'none',
                                        borderRadius: '4px',
                                        padding: '8px 12px',
                                        cursor: 'pointer'
                                    }}
                                >
                                    Remove
                                </button>
                            )}
                        </div>
                    ))}
                    
                    {composeForm.recipients.length < (config?.max_recipients || 20) && (
                        <button
                            onClick={addRecipient}
                            style={{
                                background: theme.colors.success,
                                color: theme.colors.primaryBg,
                                border: 'none',
                                borderRadius: '4px',
                                padding: '8px 12px',
                                cursor: 'pointer',
                                marginTop: '8px'
                            }}
                        >
                            + Add Recipient
                        </button>
                    )}
                </div>

                <div style={{ marginBottom: '15px' }}>
                    <label style={{ color: theme.colors.primaryText, display: 'block', marginBottom: '8px' }}>
                        Subject *
                    </label>
                    <input
                        type="text"
                        value={composeForm.subject}
                        onChange={(e) => setComposeForm(prev => ({ ...prev, subject: e.target.value }))}
                        placeholder="Enter subject..."
                        maxLength={config?.max_subject_length || 200}
                        style={{
                            width: '100%',
                            padding: '10px',
                            background: theme.colors.tertiaryBg,
                            border: `1px solid ${theme.colors.border}`,
                            borderRadius: '4px',
                            color: theme.colors.primaryText,
                            fontSize: '14px'
                        }}
                    />
                </div>

                <div style={{ marginBottom: '20px' }}>
                    <label style={{ color: theme.colors.primaryText, display: 'block', marginBottom: '8px' }}>
                        Message *
                    </label>
                    <textarea
                        value={composeForm.body}
                        onChange={(e) => setComposeForm(prev => ({ ...prev, body: e.target.value }))}
                        placeholder="Enter your message..."
                        maxLength={config?.max_body_length || 5000}
                        rows={6}
                        style={{
                            width: '100%',
                            padding: '10px',
                            background: theme.colors.tertiaryBg,
                            border: `1px solid ${theme.colors.border}`,
                            borderRadius: '4px',
                            color: theme.colors.primaryText,
                            fontSize: '14px',
                            resize: 'vertical'
                        }}
                    />
                </div>

                <div style={{
                    display: 'flex',
                    justifyContent: 'flex-end',
                    gap: '10px'
                }}>
                    <button
                        onClick={onClose}
                        style={{
                            background: theme.colors.mutedText,
                            color: theme.colors.primaryBg,
                            border: 'none',
                            borderRadius: '6px',
                            padding: '10px 20px',
                            cursor: 'pointer'
                        }}
                    >
                        Cancel
                    </button>
                    <button
                        onClick={sendMessage}
                        disabled={!isFormValid() || submitting}
                        style={{
                            background: isFormValid() && !submitting ? theme.colors.accent : theme.colors.mutedText,
                            color: theme.colors.primaryBg,
                            border: 'none',
                            borderRadius: '6px',
                            padding: '10px 20px',
                            cursor: isFormValid() && !submitting ? 'pointer' : 'not-allowed',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px'
                        }}
                    >
                        {submitting ? (
                            <>
                                <span style={{ 
                                    display: 'inline-block',
                                    animation: 'spin 1s linear infinite',
                                    fontSize: '14px'
                                }}>⟳</span>
                                Sending...
                            </>
                        ) : (
                            <>
                                ✉️ Send Message
                            </>
                        )}
                    </button>
                </div>
            </div>
        </div>,
        document.body
    );
};

export default MessageDialog;
