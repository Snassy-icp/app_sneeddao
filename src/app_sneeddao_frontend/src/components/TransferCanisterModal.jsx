import React, { useState, useEffect } from 'react';
import { FaExclamationTriangle, FaTimes } from 'react-icons/fa';
import { Principal } from '@dfinity/principal';
import { HttpAgent, Actor } from '@dfinity/agent';
import { useTheme } from '../contexts/ThemeContext';
import { useNaming } from '../NamingContext';
import PrincipalInput from './PrincipalInput';

// Management canister IDL factory
const managementCanisterIdlFactory = ({ IDL }) => {
    return IDL.Service({
        canister_status: IDL.Func(
            [IDL.Record({ canister_id: IDL.Principal })],
            [IDL.Record({
                status: IDL.Variant({ running: IDL.Null, stopping: IDL.Null, stopped: IDL.Null }),
                memory_size: IDL.Nat,
                cycles: IDL.Nat,
                settings: IDL.Record({
                    freezing_threshold: IDL.Nat,
                    controllers: IDL.Vec(IDL.Principal),
                    memory_allocation: IDL.Nat,
                    compute_allocation: IDL.Nat,
                }),
                module_hash: IDL.Opt(IDL.Vec(IDL.Nat8)),
            })],
            ['query']
        ),
        update_settings: IDL.Func(
            [IDL.Record({
                canister_id: IDL.Principal,
                settings: IDL.Record({
                    controllers: IDL.Opt(IDL.Vec(IDL.Principal)),
                    compute_allocation: IDL.Opt(IDL.Nat),
                    memory_allocation: IDL.Opt(IDL.Nat),
                    freezing_threshold: IDL.Opt(IDL.Nat),
                }),
            })],
            [],
            []
        ),
    });
};

const MANAGEMENT_CANISTER_ID = 'aaaaa-aa';

/**
 * Reusable modal for transferring canister control
 * Can be used from Wallet, PrincipalBox, or any other page
 */
const TransferCanisterModal = ({
    show,
    onClose,
    canisterId,
    identity,
    onTransferComplete, // Callback after successful transfer
    isNeuronManager = false, // Show neuron manager specific warnings
}) => {
    const { theme } = useTheme();
    const { getPrincipalDisplayName } = useNaming();
    
    const [recipient, setRecipient] = useState('');
    const [transferring, setTransferring] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');

    // Reset state when modal opens
    useEffect(() => {
        if (show) {
            setRecipient('');
            setError('');
            setSuccess('');
            setTransferring(false);
        }
    }, [show, canisterId]);

    // Handle escape key
    useEffect(() => {
        const handleEscape = (e) => {
            if (e.key === 'Escape' && show && !transferring) {
                onClose();
            }
        };
        
        if (show) {
            document.addEventListener('keydown', handleEscape);
            document.body.style.overflow = 'hidden';
        }
        
        return () => {
            document.removeEventListener('keydown', handleEscape);
            document.body.style.overflow = '';
        };
    }, [show, onClose, transferring]);

    const handleTransfer = async () => {
        if (!identity || !canisterId || !recipient.trim()) return;
        
        setTransferring(true);
        setError('');
        setSuccess('');
        
        try {
            // Validate recipient principal
            let recipientPrincipal;
            try {
                recipientPrincipal = Principal.fromText(recipient.trim());
            } catch (e) {
                setError('Invalid recipient principal ID');
                setTransferring(false);
                return;
            }
            
            // Create agent
            const host = process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging' 
                ? 'https://ic0.app' 
                : 'http://localhost:4943';
            const agent = new HttpAgent({ identity, host });
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
            }
            
            const canisterPrincipal = Principal.fromText(canisterId);
            
            // Create management canister actor
            const mgmtActor = Actor.createActor(managementCanisterIdlFactory, {
                agent,
                canisterId: MANAGEMENT_CANISTER_ID,
                callTransform: (methodName, args, callConfig) => ({
                    ...callConfig,
                    effectiveCanisterId: canisterPrincipal,
                }),
            });
            
            // Get current settings to preserve other controllers if any
            const status = await mgmtActor.canister_status({ canister_id: canisterPrincipal });
            const currentControllers = status.settings.controllers;
            
            // Remove the current user from controllers and add the recipient
            const myPrincipal = identity.getPrincipal();
            const newControllers = currentControllers.filter(
                c => c.toString() !== myPrincipal.toString()
            );
            newControllers.push(recipientPrincipal);
            
            // Update canister settings
            await mgmtActor.update_settings({
                canister_id: canisterPrincipal,
                settings: {
                    controllers: [newControllers],
                    compute_allocation: [],
                    memory_allocation: [],
                    freezing_threshold: [],
                },
            });
            
            const recipientName = getPrincipalDisplayName(recipient.trim())?.name || recipient.trim();
            setSuccess(`Successfully transferred control to ${recipientName}`);
            
            // Call completion callback
            if (onTransferComplete) {
                onTransferComplete(canisterId, recipient.trim());
            }
            
            // Close modal after brief delay
            setTimeout(() => {
                onClose();
            }, 2000);
            
        } catch (err) {
            console.error('Transfer error:', err);
            setError(err.message || 'Failed to transfer canister control');
        } finally {
            setTransferring(false);
        }
    };

    if (!show || !canisterId) return null;

    const displayInfo = getPrincipalDisplayName(canisterId);
    const displayName = displayInfo?.name || `${canisterId.slice(0, 8)}...${canisterId.slice(-6)}`;
    const dangerPrimary = '#ef4444';

    return (
        <div 
            onClick={(e) => {
                if (e.target === e.currentTarget && !transferring) onClose();
            }}
            style={{
                position: 'fixed',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                backgroundColor: 'rgba(0, 0, 0, 0.7)',
                backdropFilter: 'blur(4px)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 10001,
                padding: '16px',
            }}
        >
            <div 
                onClick={(e) => e.stopPropagation()}
                style={{
                    backgroundColor: theme.colors.primaryBg,
                    borderRadius: '16px',
                    border: `1px solid ${theme.colors.border}`,
                    width: '100%',
                    maxWidth: '450px',
                    boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
                }}
            >
                {/* Header */}
                <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '16px 20px',
                    borderBottom: `1px solid ${theme.colors.border}`,
                }}>
                    <h3 style={{ 
                        color: theme.colors.primaryText, 
                        margin: 0,
                        fontSize: '16px',
                        fontWeight: '600',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                    }}>
                        <FaExclamationTriangle size={14} style={{ color: '#f59e0b' }} />
                        Transfer {isNeuronManager ? 'Neuron Manager' : 'Canister'}
                    </h3>
                    <button
                        onClick={onClose}
                        disabled={transferring}
                        style={{
                            background: 'none',
                            border: 'none',
                            cursor: transferring ? 'not-allowed' : 'pointer',
                            padding: '8px',
                            display: 'flex',
                            color: theme.colors.mutedText,
                            opacity: transferring ? 0.5 : 1,
                        }}
                    >
                        <FaTimes size={18} />
                    </button>
                </div>
                
                {/* Content */}
                <div style={{ padding: '20px' }}>
                    {/* Warning */}
                    <div style={{
                        backgroundColor: '#fef3c720',
                        border: '1px solid #f59e0b40',
                        borderRadius: '10px',
                        padding: '12px 16px',
                        marginBottom: '20px',
                    }}>
                        <p style={{ 
                            color: '#f59e0b', 
                            margin: 0, 
                            fontSize: '13px',
                            lineHeight: '1.5',
                        }}>
                            <strong>Warning:</strong> This will transfer control of this {isNeuronManager ? 'neuron manager' : 'canister'} to another principal.
                            {isNeuronManager && ' All neurons managed by this canister will be controlled by the new owner.'}
                            {' '}This action cannot be undone.
                        </p>
                    </div>

                    {/* Canister being transferred */}
                    <div style={{ marginBottom: '16px' }}>
                        <label style={{ 
                            color: theme.colors.mutedText, 
                            fontSize: '12px',
                            textTransform: 'uppercase',
                            letterSpacing: '0.5px',
                            display: 'block',
                            marginBottom: '6px',
                        }}>
                            {isNeuronManager ? 'Neuron Manager' : 'Canister'} to Transfer
                        </label>
                        <div style={{
                            backgroundColor: theme.colors.secondaryBg,
                            padding: '12px 16px',
                            borderRadius: '8px',
                            fontFamily: 'monospace',
                            fontSize: '13px',
                            color: theme.colors.primaryText,
                            wordBreak: 'break-all',
                        }}>
                            {displayName !== canisterId ? (
                                <div>
                                    <div style={{ fontWeight: '500', marginBottom: '4px' }}>{displayName}</div>
                                    <div style={{ color: theme.colors.mutedText, fontSize: '12px' }}>{canisterId}</div>
                                </div>
                            ) : canisterId}
                        </div>
                    </div>

                    {/* Recipient input */}
                    <div style={{ marginBottom: '20px' }}>
                        <label style={{ 
                            color: theme.colors.mutedText, 
                            fontSize: '12px',
                            textTransform: 'uppercase',
                            letterSpacing: '0.5px',
                            display: 'block',
                            marginBottom: '6px',
                        }}>
                            New Owner (Principal ID)
                        </label>
                        <PrincipalInput
                            value={recipient}
                            onChange={setRecipient}
                            placeholder="Enter recipient principal ID"
                            disabled={transferring}
                        />
                    </div>

                    {/* Error/Success messages */}
                    {error && (
                        <div style={{
                            backgroundColor: '#fef2f210',
                            border: '1px solid #ef444440',
                            borderRadius: '8px',
                            padding: '12px',
                            marginBottom: '16px',
                            color: '#ef4444',
                            fontSize: '13px',
                        }}>
                            {error}
                        </div>
                    )}
                    
                    {success && (
                        <div style={{
                            backgroundColor: '#dcfce710',
                            border: '1px solid #22c55e40',
                            borderRadius: '8px',
                            padding: '12px',
                            marginBottom: '16px',
                            color: '#22c55e',
                            fontSize: '13px',
                        }}>
                            {success}
                        </div>
                    )}

                    {/* Action buttons */}
                    <div style={{ display: 'flex', gap: '12px' }}>
                        <button
                            onClick={onClose}
                            disabled={transferring}
                            style={{
                                flex: 1,
                                padding: '12px 16px',
                                borderRadius: '10px',
                                border: `1px solid ${theme.colors.border}`,
                                backgroundColor: theme.colors.secondaryBg,
                                color: theme.colors.primaryText,
                                fontSize: '14px',
                                fontWeight: '500',
                                cursor: transferring ? 'not-allowed' : 'pointer',
                                opacity: transferring ? 0.5 : 1,
                            }}
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleTransfer}
                            disabled={transferring || !recipient.trim() || success}
                            style={{
                                flex: 2,
                                padding: '12px 16px',
                                borderRadius: '10px',
                                border: 'none',
                                backgroundColor: transferring ? theme.colors.mutedText : dangerPrimary,
                                color: '#fff',
                                fontSize: '14px',
                                fontWeight: '600',
                                cursor: (transferring || !recipient.trim() || success) ? 'not-allowed' : 'pointer',
                                opacity: (transferring || success) ? 0.7 : 1,
                            }}
                        >
                            {transferring ? 'Transferring...' : 'Transfer Control'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default TransferCanisterModal;
