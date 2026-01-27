import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { FaArrowLeft, FaSave, FaSpinner, FaCheck, FaUnlock, FaCrown, FaUser, FaWallet, FaCopy } from 'react-icons/fa';
import { Principal } from '@dfinity/principal';
import Header from '../components/Header';
import { useAuth } from '../AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { app_sneeddao_backend } from 'declarations/app_sneeddao_backend';

// Helper to convert hex string to Uint8Array
const hexToBytes = (hex) => {
    if (!hex || hex.length === 0) return null;
    const bytes = [];
    for (let i = 0; i < hex.length; i += 2) {
        bytes.push(parseInt(hex.substr(i, 2), 16));
    }
    return new Uint8Array(bytes);
};

// Helper to convert Uint8Array to hex string
const bytesToHex = (bytes) => {
    if (!bytes || bytes.length === 0) return '';
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
};

function AdminSnsJailbreak() {
    const { isAdmin } = useAuth();
    const { theme } = useTheme();
    
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [error, setError] = useState('');
    
    // Fee settings (stored in e8s, displayed in ICP)
    const [feePremium, setFeePremium] = useState('0');
    const [feeRegular, setFeeRegular] = useState('0');
    
    // ICRC1 Account settings
    const [feeAccountOwner, setFeeAccountOwner] = useState('');
    const [feeAccountSubaccount, setFeeAccountSubaccount] = useState('');
    const [ownerValid, setOwnerValid] = useState(true);
    const [subaccountValid, setSubaccountValid] = useState(true);
    
    // Load current settings
    useEffect(() => {
        const loadSettings = async () => {
            setLoading(true);
            try {
                const settings = await app_sneeddao_backend.get_jailbreak_fee_settings();
                // Convert e8s to ICP for display
                setFeePremium((Number(settings.fee_premium_e8s) / 100_000_000).toString());
                setFeeRegular((Number(settings.fee_regular_e8s) / 100_000_000).toString());
                
                // Fee account owner
                if (settings.fee_account_owner && settings.fee_account_owner.length > 0) {
                    setFeeAccountOwner(settings.fee_account_owner[0].toString());
                } else {
                    setFeeAccountOwner('');
                }
                
                // Fee account subaccount (convert from Blob to hex)
                if (settings.fee_account_subaccount && settings.fee_account_subaccount.length > 0) {
                    const subBytes = settings.fee_account_subaccount[0];
                    setFeeAccountSubaccount(bytesToHex(subBytes));
                } else {
                    setFeeAccountSubaccount('');
                }
            } catch (err) {
                console.error('Error loading jailbreak fee settings:', err);
                setError('Failed to load settings');
            } finally {
                setLoading(false);
            }
        };
        loadSettings();
    }, []);
    
    // Validate principal
    const validatePrincipal = (value) => {
        if (!value || value.trim() === '') {
            return true; // Empty is valid (means canister keeps fees)
        }
        try {
            Principal.fromText(value.trim());
            return true;
        } catch {
            return false;
        }
    };
    
    // Validate subaccount (should be hex, 0-64 chars, converts to 0-32 bytes)
    const validateSubaccount = (value) => {
        if (!value || value.trim() === '') {
            return true; // Empty is valid
        }
        // Must be valid hex and max 64 chars (32 bytes)
        return /^[a-fA-F0-9]{0,64}$/.test(value.trim());
    };
    
    // Handle owner change
    const handleOwnerChange = (value) => {
        setFeeAccountOwner(value);
        setOwnerValid(validatePrincipal(value));
    };
    
    // Handle subaccount change
    const handleSubaccountChange = (value) => {
        // Only allow hex characters
        const cleaned = value.replace(/[^a-fA-F0-9]/g, '').substring(0, 64);
        setFeeAccountSubaccount(cleaned);
        setSubaccountValid(validateSubaccount(cleaned));
    };
    
    // Save settings
    const handleSave = async () => {
        if (!ownerValid) {
            setError('Invalid fee account owner principal');
            return;
        }
        if (!subaccountValid) {
            setError('Invalid fee account subaccount');
            return;
        }
        
        setSaving(true);
        setError('');
        setSaved(false);
        
        try {
            // Convert ICP to e8s
            const premiumE8s = Math.floor(parseFloat(feePremium || '0') * 100_000_000);
            const regularE8s = Math.floor(parseFloat(feeRegular || '0') * 100_000_000);
            
            // Prepare owner (null means canister keeps fees)
            let owner = [];
            if (feeAccountOwner && feeAccountOwner.trim()) {
                owner = [Principal.fromText(feeAccountOwner.trim())];
            }
            
            // Prepare subaccount (convert hex to bytes, pad to 32 bytes)
            let subaccount = [];
            if (feeAccountSubaccount && feeAccountSubaccount.trim()) {
                const bytes = hexToBytes(feeAccountSubaccount.trim().padStart(64, '0'));
                if (bytes) {
                    subaccount = [bytes];
                }
            }
            
            const result = await app_sneeddao_backend.set_jailbreak_fee_settings(
                [BigInt(premiumE8s)],
                [BigInt(regularE8s)],
                [owner.length > 0 ? owner : []],
                [subaccount.length > 0 ? subaccount : []]
            );
            
            if ('ok' in result) {
                setSaved(true);
                setTimeout(() => setSaved(false), 3000);
            } else {
                setError(result.err || 'Failed to save settings');
            }
        } catch (err) {
            console.error('Error saving jailbreak fee settings:', err);
            setError('Failed to save settings: ' + err.message);
        } finally {
            setSaving(false);
        }
    };
    
    const styles = {
        container: {
            maxWidth: '800px',
            margin: '0 auto',
            padding: '2rem',
            color: theme.colors.primaryText,
        },
        backLink: {
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            color: theme.colors.accent,
            textDecoration: 'none',
            marginBottom: '1.5rem',
        },
        title: {
            fontSize: '2rem',
            marginBottom: '0.5rem',
            color: theme.colors.primaryText,
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
        },
        subtitle: {
            fontSize: '1rem',
            color: theme.colors.mutedText,
            marginBottom: '2rem',
        },
        card: {
            background: theme.colors.cardGradient,
            border: `1px solid ${theme.colors.border}`,
            borderRadius: '16px',
            padding: '1.5rem',
            marginBottom: '1.5rem',
        },
        cardTitle: {
            fontSize: '1.2rem',
            fontWeight: '600',
            color: theme.colors.primaryText,
            marginBottom: '1rem',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
        },
        formGroup: {
            marginBottom: '1.5rem',
        },
        label: {
            display: 'block',
            color: theme.colors.primaryText,
            marginBottom: '8px',
            fontWeight: '500',
        },
        labelHint: {
            fontWeight: 'normal',
            color: theme.colors.mutedText,
            fontSize: '0.85rem',
            marginLeft: '8px',
        },
        inputWrapper: {
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
        },
        input: {
            flex: 1,
            padding: '12px',
            background: theme.colors.secondaryBg,
            border: `1px solid ${theme.colors.border}`,
            borderRadius: '8px',
            color: theme.colors.primaryText,
            fontSize: '1rem',
        },
        inputSuffix: {
            color: theme.colors.mutedText,
            fontWeight: '500',
        },
        inputFull: {
            width: '100%',
            padding: '12px',
            background: theme.colors.secondaryBg,
            border: `1px solid ${theme.colors.border}`,
            borderRadius: '8px',
            color: theme.colors.primaryText,
            fontSize: '1rem',
            fontFamily: 'monospace',
        },
        error: {
            color: theme.colors.error,
            fontSize: '0.85rem',
            marginTop: '8px',
        },
        hint: {
            color: theme.colors.mutedText,
            fontSize: '0.85rem',
            marginTop: '8px',
        },
        saveButton: {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            padding: '14px 28px',
            background: saved ? theme.colors.success : theme.colors.accent,
            border: 'none',
            borderRadius: '10px',
            color: theme.colors.primaryBg,
            fontSize: '1rem',
            fontWeight: '600',
            cursor: saving ? 'wait' : 'pointer',
            transition: 'all 0.2s ease',
            opacity: saving ? 0.7 : 1,
        },
        loadingContainer: {
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '3rem',
            gap: '1rem',
        },
        spinner: {
            animation: 'spin 1s linear infinite',
        },
        infoBox: {
            background: `${theme.colors.accent}10`,
            border: `1px solid ${theme.colors.accent}30`,
            borderRadius: '12px',
            padding: '1rem',
            marginBottom: '1.5rem',
        },
        unauthorized: {
            textAlign: 'center',
            padding: '3rem',
            background: theme.colors.cardGradient,
            border: `1px solid ${theme.colors.border}`,
            borderRadius: '16px',
        },
    };
    
    const spinnerKeyframes = `
        @keyframes spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
        }
    `;
    
    if (!isAdmin) {
        return (
            <div className='page-container' style={{ background: theme.colors.primaryGradient, minHeight: '100vh' }}>
                <Header />
                <main style={styles.container}>
                    <div style={styles.unauthorized}>
                        <FaUnlock size={48} style={{ color: theme.colors.mutedText, marginBottom: '1rem' }} />
                        <h2 style={{ color: theme.colors.primaryText, marginBottom: '0.5rem' }}>Access Denied</h2>
                        <p style={{ color: theme.colors.mutedText }}>
                            You need admin access to view this page.
                        </p>
                    </div>
                </main>
            </div>
        );
    }
    
    return (
        <div className='page-container' style={{ background: theme.colors.primaryGradient, minHeight: '100vh' }}>
            <Header />
            <style>{spinnerKeyframes}</style>
            <main style={styles.container}>
                <Link to="/admin" style={styles.backLink}>
                    <FaArrowLeft size={14} />
                    Back to Admin
                </Link>
                
                <h1 style={styles.title}>
                    <FaUnlock style={{ color: theme.colors.accent }} />
                    SNS Jailbreak Settings
                </h1>
                <p style={styles.subtitle}>
                    Configure fees for creating jailbreak scripts
                </p>
                
                {loading ? (
                    <div style={styles.loadingContainer}>
                        <FaSpinner size={32} style={{ ...styles.spinner, color: theme.colors.accent }} />
                        <p style={{ color: theme.colors.mutedText }}>Loading settings...</p>
                    </div>
                ) : (
                    <>
                        {/* Info Box */}
                        <div style={styles.infoBox}>
                            <p style={{ color: theme.colors.secondaryText, fontSize: '0.95rem', margin: 0 }}>
                                <strong>How fees work:</strong> Users must deposit ICP to their payment subaccount on this canister before 
                                creating a jailbreak script. When they create a script, the fee is deducted from their payment balance and 
                                sent to the fee account. Premium members pay the premium fee, regular users pay the regular fee.
                                Set a fee to 0 to make it free for that user type.
                            </p>
                        </div>
                        
                        {/* Fee Settings Card */}
                        <div style={styles.card}>
                            <h2 style={styles.cardTitle}>
                                <FaWallet style={{ color: theme.colors.accent }} />
                                Fee Configuration
                            </h2>
                            
                            {/* Premium Fee */}
                            <div style={styles.formGroup}>
                                <label style={styles.label}>
                                    <FaCrown style={{ color: '#FFD700', marginRight: '8px' }} />
                                    Premium Member Fee
                                    <span style={styles.labelHint}>(Sneed Premium members)</span>
                                </label>
                                <div style={styles.inputWrapper}>
                                    <input
                                        type="number"
                                        step="0.0001"
                                        min="0"
                                        style={styles.input}
                                        value={feePremium}
                                        onChange={(e) => setFeePremium(e.target.value)}
                                        placeholder="0"
                                    />
                                    <span style={styles.inputSuffix}>ICP</span>
                                </div>
                                <p style={styles.hint}>
                                    Current: {feePremium || '0'} ICP ({Math.floor(parseFloat(feePremium || '0') * 100_000_000).toLocaleString()} e8s)
                                </p>
                            </div>
                            
                            {/* Regular Fee */}
                            <div style={styles.formGroup}>
                                <label style={styles.label}>
                                    <FaUser style={{ color: theme.colors.mutedText, marginRight: '8px' }} />
                                    Regular User Fee
                                    <span style={styles.labelHint}>(Non-premium users)</span>
                                </label>
                                <div style={styles.inputWrapper}>
                                    <input
                                        type="number"
                                        step="0.0001"
                                        min="0"
                                        style={styles.input}
                                        value={feeRegular}
                                        onChange={(e) => setFeeRegular(e.target.value)}
                                        placeholder="0"
                                    />
                                    <span style={styles.inputSuffix}>ICP</span>
                                </div>
                                <p style={styles.hint}>
                                    Current: {feeRegular || '0'} ICP ({Math.floor(parseFloat(feeRegular || '0') * 100_000_000).toLocaleString()} e8s)
                                </p>
                            </div>
                        </div>
                        
                        {/* Fee Recipient Account Card */}
                        <div style={styles.card}>
                            <h2 style={styles.cardTitle}>
                                <FaWallet style={{ color: theme.colors.success }} />
                                Fee Recipient Account (ICRC-1)
                            </h2>
                            
                            <p style={{ color: theme.colors.mutedText, fontSize: '0.9rem', marginBottom: '1.5rem' }}>
                                Fees collected will be sent to this ICRC-1 account. Leave empty for the canister to keep the fees.
                            </p>
                            
                            {/* Account Owner */}
                            <div style={styles.formGroup}>
                                <label style={styles.label}>
                                    Account Owner (Principal)
                                    <span style={styles.labelHint}>(Leave empty for canister to keep fees)</span>
                                </label>
                                <input
                                    type="text"
                                    style={{
                                        ...styles.inputFull,
                                        borderColor: ownerValid ? theme.colors.border : theme.colors.error,
                                    }}
                                    value={feeAccountOwner}
                                    onChange={(e) => handleOwnerChange(e.target.value)}
                                    placeholder="Principal ID (e.g., aaaaa-aa)"
                                />
                                {!ownerValid && (
                                    <p style={styles.error}>Invalid principal ID</p>
                                )}
                            </div>
                            
                            {/* Account Subaccount */}
                            <div style={styles.formGroup}>
                                <label style={styles.label}>
                                    Account Subaccount (Hex)
                                    <span style={styles.labelHint}>(Optional, max 32 bytes / 64 hex chars)</span>
                                </label>
                                <input
                                    type="text"
                                    style={{
                                        ...styles.inputFull,
                                        borderColor: subaccountValid ? theme.colors.border : theme.colors.error,
                                    }}
                                    value={feeAccountSubaccount}
                                    onChange={(e) => handleSubaccountChange(e.target.value)}
                                    placeholder="Optional hex subaccount (e.g., 0000...0001)"
                                />
                                {!subaccountValid && (
                                    <p style={styles.error}>Invalid subaccount (must be hex, max 64 characters)</p>
                                )}
                                <p style={styles.hint}>
                                    {feeAccountOwner 
                                        ? `Fees will be sent to: ${feeAccountOwner.slice(0, 15)}...${feeAccountSubaccount ? ` (subaccount: ${feeAccountSubaccount.slice(0, 16)}...)` : ''}`
                                        : 'Fees will be kept by the canister'
                                    }
                                </p>
                            </div>
                        </div>
                        
                        {/* Error Message */}
                        {error && (
                            <div style={{ 
                                background: `${theme.colors.error}15`,
                                border: `1px solid ${theme.colors.error}30`,
                                borderRadius: '12px',
                                padding: '1rem',
                                marginBottom: '1.5rem',
                                color: theme.colors.error,
                            }}>
                                {error}
                            </div>
                        )}
                        
                        {/* Save Button */}
                        <button
                            style={styles.saveButton}
                            onClick={handleSave}
                            disabled={saving || !ownerValid || !subaccountValid}
                        >
                            {saving ? (
                                <>
                                    <FaSpinner style={styles.spinner} />
                                    Saving...
                                </>
                            ) : saved ? (
                                <>
                                    <FaCheck />
                                    Saved!
                                </>
                            ) : (
                                <>
                                    <FaSave />
                                    Save Settings
                                </>
                            )}
                        </button>
                    </>
                )}
            </main>
        </div>
    );
}

export default AdminSnsJailbreak;
