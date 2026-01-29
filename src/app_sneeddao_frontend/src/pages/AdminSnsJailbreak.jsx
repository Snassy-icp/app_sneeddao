import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { FaArrowLeft, FaSave, FaSpinner, FaCheck, FaUnlock, FaCrown, FaUser, FaWallet, FaCopy, FaChartBar, FaList, FaChevronDown, FaChevronUp, FaSync } from 'react-icons/fa';
import { Principal } from '@dfinity/principal';
import Header from '../components/Header';
import { useAuth } from '../AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { useAdminCheck } from '../hooks/useAdminCheck';
import { createActor as createBackendActor, canisterId as backendCanisterId } from 'declarations/app_sneeddao_backend';
import { PrincipalDisplay } from '../utils/PrincipalUtils';
import { fetchAndCacheSnsData, fetchSnsLogo, getAllSnses } from '../utils/SnsUtils';
import { HttpAgent } from '@dfinity/agent';

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
    const { isAuthenticated, identity } = useAuth();
    const { theme } = useTheme();
    
    // SNS list and logos state
    const [snsList, setSnsList] = useState([]);
    const [snsLogos, setSnsLogos] = useState(new Map());
    const [loadingLogos, setLoadingLogos] = useState(new Set());
    
    // Admin check
    const { isAdmin, loading: adminLoading } = useAdminCheck({
        identity,
        isAuthenticated,
        redirectPath: '/admin'
    });
    
    // Create backend actor with identity
    const backendActor = useMemo(() => {
        if (!identity) return null;
        return createBackendActor(backendCanisterId, {
            agentOptions: {
                identity,
                host: process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging' 
                    ? 'https://ic0.app' 
                    : 'http://localhost:4943'
            }
        });
    }, [identity]);
    
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
    
    // Stats and logs
    const [stats, setStats] = useState(null);
    const [statsLoading, setStatsLoading] = useState(false);
    const [statsExpanded, setStatsExpanded] = useState(true);
    
    const [logs, setLogs] = useState([]);
    const [logsTotal, setLogsTotal] = useState(0);
    const [logsOffset, setLogsOffset] = useState(0);
    const [logsLoading, setLogsLoading] = useState(false);
    const [logsExpanded, setLogsExpanded] = useState(true);
    const LOGS_PER_PAGE = 10;
    
    // Load current settings
    useEffect(() => {
        const loadSettings = async () => {
            if (!backendActor) return;
            
            setLoading(true);
            try {
                const settings = await backendActor.get_jailbreak_fee_settings();
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
    }, [backendActor]);
    
    // Load stats
    const loadStats = useCallback(async () => {
        if (!backendActor) return;
        setStatsLoading(true);
        try {
            const result = await backendActor.get_jailbreak_payment_stats();
            if ('ok' in result) {
                setStats(result.ok);
            } else {
                console.error('Error loading stats:', result.err);
            }
        } catch (err) {
            console.error('Error loading stats:', err);
        } finally {
            setStatsLoading(false);
        }
    }, [backendActor]);
    
    // Load logs
    const loadLogs = useCallback(async (offset = 0) => {
        if (!backendActor) return;
        setLogsLoading(true);
        try {
            const result = await backendActor.get_jailbreak_payment_logs(BigInt(offset), BigInt(LOGS_PER_PAGE));
            if ('ok' in result) {
                setLogs(result.ok.logs);
                setLogsTotal(Number(result.ok.total));
                setLogsOffset(offset);
            } else {
                console.error('Error loading logs:', result.err);
            }
        } catch (err) {
            console.error('Error loading logs:', err);
        } finally {
            setLogsLoading(false);
        }
    }, [backendActor]);
    
    // Load SNS logo
    const loadSnsLogo = useCallback(async (governanceId) => {
        if (snsLogos.has(governanceId) || loadingLogos.has(governanceId)) return;
        
        setLoadingLogos(prev => new Set([...prev, governanceId]));
        
        try {
            const host = process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging' 
                ? 'https://ic0.app' 
                : 'http://localhost:4943';
            const agent = new HttpAgent({ host, ...(identity && { identity }) });
            
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
            }
            
            const logo = await fetchSnsLogo(governanceId, agent);
            setSnsLogos(prev => new Map(prev).set(governanceId, logo));
        } catch (error) {
            console.error(`Error loading logo for SNS ${governanceId}:`, error);
        } finally {
            setLoadingLogos(prev => {
                const next = new Set(prev);
                next.delete(governanceId);
                return next;
            });
        }
    }, [identity, snsLogos, loadingLogos]);
    
    // Load stats, logs, and SNS data on mount
    useEffect(() => {
        if (backendActor && isAdmin) {
            loadStats();
            loadLogs(0);
            
            // Load SNS list for log display
            const loadSnsList = async () => {
                // First try to get from cache
                let data = getAllSnses();
                if (!data || data.length === 0) {
                    // Fetch fresh data
                    data = await fetchAndCacheSnsData(identity);
                }
                if (data && data.length > 0) {
                    setSnsList(data);
                }
            };
            loadSnsList();
        }
    }, [backendActor, isAdmin, loadStats, loadLogs, identity]);
    
    // Load logos when logs are updated
    useEffect(() => {
        if (logs.length > 0 && snsList.length > 0) {
            logs.forEach(log => {
                const sns = snsList.find(s => s.rootCanisterId === log.sns_root_canister_id.toString());
                if (sns?.canisters?.governance) {
                    loadSnsLogo(sns.canisters.governance);
                }
            });
        }
    }, [logs, snsList, loadSnsLogo]);
    
    // Get SNS info from root canister ID
    const getSnsInfo = useCallback((rootCanisterId) => {
        const rootStr = rootCanisterId.toString();
        const sns = snsList.find(s => s.rootCanisterId === rootStr);
        const logo = sns?.canisters?.governance ? snsLogos.get(sns.canisters.governance) : null;
        const isLoadingLogo = sns?.canisters?.governance ? loadingLogos.has(sns.canisters.governance) : false;
        return {
            name: sns?.name || rootStr.slice(0, 10) + '...',
            logo,
            isLoadingLogo
        };
    }, [snsList, snsLogos, loadingLogos]);
    
    // Format timestamp
    const formatTimestamp = (timestamp) => {
        const date = new Date(Number(timestamp) / 1_000_000);
        return date.toLocaleString();
    };
    
    // Format e8s to ICP
    const formatE8s = (e8s) => {
        return (Number(e8s) / 100_000_000).toFixed(4);
    };
    
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
            
            const result = await backendActor.set_jailbreak_fee_settings(
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
        sectionHeader: {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            cursor: 'pointer',
            padding: '0.5rem 0',
        },
        statsGrid: {
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
            gap: '1rem',
            marginTop: '1rem',
        },
        statCard: {
            background: theme.colors.secondaryBg,
            borderRadius: '12px',
            padding: '1rem',
            textAlign: 'center',
        },
        statValue: {
            fontSize: '1.5rem',
            fontWeight: '700',
            color: theme.colors.accent,
            marginBottom: '4px',
        },
        statLabel: {
            fontSize: '0.8rem',
            color: theme.colors.mutedText,
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
        },
        logsTable: {
            width: '100%',
            borderCollapse: 'collapse',
            marginTop: '1rem',
            fontSize: '0.9rem',
        },
        tableHeader: {
            background: theme.colors.secondaryBg,
            color: theme.colors.primaryText,
            textAlign: 'left',
            padding: '12px 10px',
            fontWeight: '600',
            borderBottom: `2px solid ${theme.colors.border}`,
        },
        tableCell: {
            padding: '12px 10px',
            borderBottom: `1px solid ${theme.colors.border}`,
            color: theme.colors.secondaryText,
            verticalAlign: 'middle',
        },
        paginationContainer: {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginTop: '1rem',
            padding: '0.5rem 0',
        },
        paginationButton: {
            padding: '8px 16px',
            background: theme.colors.secondaryBg,
            border: `1px solid ${theme.colors.border}`,
            borderRadius: '8px',
            color: theme.colors.primaryText,
            cursor: 'pointer',
            fontSize: '0.9rem',
        },
        paginationButtonDisabled: {
            opacity: 0.5,
            cursor: 'not-allowed',
        },
        badge: {
            display: 'inline-block',
            padding: '3px 8px',
            borderRadius: '12px',
            fontSize: '0.75rem',
            fontWeight: '600',
        },
        premiumBadge: {
            background: '#FFD70020',
            color: '#FFD700',
        },
        regularBadge: {
            background: `${theme.colors.mutedText}20`,
            color: theme.colors.mutedText,
        },
        refreshButton: {
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '6px 12px',
            background: 'transparent',
            border: `1px solid ${theme.colors.border}`,
            borderRadius: '6px',
            color: theme.colors.accent,
            cursor: 'pointer',
            fontSize: '0.85rem',
        },
    };
    
    const spinnerKeyframes = `
        @keyframes spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
        }
    `;
    
    if (adminLoading) {
        return (
            <div className='page-container' style={{ background: theme.colors.primaryGradient, minHeight: '100vh' }}>
                <Header />
                <main style={styles.container}>
                    <div style={styles.loadingContainer}>
                        <FaSpinner size={32} style={{ ...styles.spinner, color: theme.colors.accent }} />
                        <p style={{ color: theme.colors.mutedText }}>Checking admin access...</p>
                    </div>
                </main>
            </div>
        );
    }
    
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
                        
                        {/* Stats Section */}
                        <div style={{ ...styles.card, marginTop: '2rem' }}>
                            <div 
                                style={styles.sectionHeader}
                                onClick={() => setStatsExpanded(!statsExpanded)}
                            >
                                <h2 style={{ ...styles.cardTitle, margin: 0 }}>
                                    <FaChartBar style={{ color: theme.colors.success }} />
                                    Payment Statistics
                                </h2>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                    <button
                                        style={styles.refreshButton}
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            loadStats();
                                        }}
                                        disabled={statsLoading}
                                    >
                                        <FaSync style={statsLoading ? styles.spinner : {}} size={12} />
                                        Refresh
                                    </button>
                                    {statsExpanded ? <FaChevronUp /> : <FaChevronDown />}
                                </div>
                            </div>
                            
                            {statsExpanded && (
                                <>
                                    {statsLoading && !stats ? (
                                        <div style={{ textAlign: 'center', padding: '2rem' }}>
                                            <FaSpinner style={styles.spinner} size={24} />
                                        </div>
                                    ) : stats ? (
                                        <div style={styles.statsGrid}>
                                            <div style={styles.statCard}>
                                                <div style={styles.statValue}>{stats.total_scripts_created.toString()}</div>
                                                <div style={styles.statLabel}>Scripts Sold</div>
                                            </div>
                                            <div style={styles.statCard}>
                                                <div style={styles.statValue}>{formatE8s(stats.total_revenue_e8s)}</div>
                                                <div style={styles.statLabel}>Total Revenue (ICP)</div>
                                            </div>
                                            <div style={styles.statCard}>
                                                <div style={styles.statValue}>{stats.unique_users.toString()}</div>
                                                <div style={styles.statLabel}>Unique Buyers</div>
                                            </div>
                                            <div style={{ ...styles.statCard, background: '#FFD70015' }}>
                                                <div style={{ ...styles.statValue, color: '#FFD700' }}>{stats.total_premium_payments.toString()}</div>
                                                <div style={styles.statLabel}>Premium Purchases</div>
                                            </div>
                                            <div style={{ ...styles.statCard, background: `${theme.colors.mutedText}10` }}>
                                                <div style={{ ...styles.statValue, color: theme.colors.secondaryText }}>{stats.total_regular_payments.toString()}</div>
                                                <div style={styles.statLabel}>Regular Purchases</div>
                                            </div>
                                            <div style={styles.statCard}>
                                                <div style={{ ...styles.statValue, fontSize: '1.2rem' }}>{formatE8s(stats.premium_revenue_e8s)} / {formatE8s(stats.regular_revenue_e8s)}</div>
                                                <div style={styles.statLabel}>Premium / Regular Rev (ICP)</div>
                                            </div>
                                        </div>
                                    ) : (
                                        <p style={{ color: theme.colors.mutedText, textAlign: 'center', padding: '1rem' }}>
                                            No stats available
                                        </p>
                                    )}
                                </>
                            )}
                        </div>
                        
                        {/* Logs Section */}
                        <div style={{ ...styles.card, marginTop: '1.5rem' }}>
                            <div 
                                style={styles.sectionHeader}
                                onClick={() => setLogsExpanded(!logsExpanded)}
                            >
                                <h2 style={{ ...styles.cardTitle, margin: 0 }}>
                                    <FaList style={{ color: theme.colors.accent }} />
                                    Payment Logs
                                    {logsTotal > 0 && (
                                        <span style={{ 
                                            fontSize: '0.85rem', 
                                            fontWeight: 'normal', 
                                            color: theme.colors.mutedText,
                                            marginLeft: '8px'
                                        }}>
                                            ({logsTotal} total)
                                        </span>
                                    )}
                                </h2>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                    <button
                                        style={styles.refreshButton}
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            loadLogs(0);
                                        }}
                                        disabled={logsLoading}
                                    >
                                        <FaSync style={logsLoading ? styles.spinner : {}} size={12} />
                                        Refresh
                                    </button>
                                    {logsExpanded ? <FaChevronUp /> : <FaChevronDown />}
                                </div>
                            </div>
                            
                            {logsExpanded && (
                                <>
                                    {logsLoading && logs.length === 0 ? (
                                        <div style={{ textAlign: 'center', padding: '2rem' }}>
                                            <FaSpinner style={styles.spinner} size={24} />
                                        </div>
                                    ) : logs.length > 0 ? (
                                        <>
                                            <div style={{ overflowX: 'auto' }}>
                                                <table style={styles.logsTable}>
                                                    <thead>
                                                        <tr>
                                                            <th style={styles.tableHeader}>#</th>
                                                            <th style={styles.tableHeader}>Date</th>
                                                            <th style={styles.tableHeader}>User</th>
                                                            <th style={styles.tableHeader}>SNS</th>
                                                            <th style={styles.tableHeader}>Amount</th>
                                                            <th style={styles.tableHeader}>Type</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {logs.map((log, idx) => (
                                                            <tr key={log.id.toString()}>
                                                                <td style={styles.tableCell}>
                                                                    {log.id.toString()}
                                                                </td>
                                                                <td style={styles.tableCell}>
                                                                    {formatTimestamp(log.timestamp)}
                                                                </td>
                                                                <td style={styles.tableCell}>
                                                                    <PrincipalDisplay principal={log.user.toString()} />
                                                                </td>
                                                                <td style={styles.tableCell}>
                                                                    {(() => {
                                                                        const snsInfo = getSnsInfo(log.sns_root_canister_id);
                                                                        return (
                                                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                                                {snsInfo.isLoadingLogo ? (
                                                                                    <div style={{
                                                                                        width: '24px',
                                                                                        height: '24px',
                                                                                        borderRadius: '6px',
                                                                                        backgroundColor: theme.colors.tertiaryBg,
                                                                                        display: 'flex',
                                                                                        alignItems: 'center',
                                                                                        justifyContent: 'center'
                                                                                    }}>
                                                                                        <FaSpinner className="spin" size={12} style={{ color: theme.colors.mutedText }} />
                                                                                    </div>
                                                                                ) : snsInfo.logo ? (
                                                                                    <img
                                                                                        src={snsInfo.logo}
                                                                                        alt={snsInfo.name}
                                                                                        style={{
                                                                                            width: '24px',
                                                                                            height: '24px',
                                                                                            borderRadius: '6px',
                                                                                            objectFit: 'cover'
                                                                                        }}
                                                                                    />
                                                                                ) : (
                                                                                    <div style={{
                                                                                        width: '24px',
                                                                                        height: '24px',
                                                                                        borderRadius: '6px',
                                                                                        backgroundColor: theme.colors.accent,
                                                                                        display: 'flex',
                                                                                        alignItems: 'center',
                                                                                        justifyContent: 'center',
                                                                                        color: '#fff',
                                                                                        fontSize: '10px',
                                                                                        fontWeight: '600'
                                                                                    }}>
                                                                                        {snsInfo.name.charAt(0).toUpperCase()}
                                                                                    </div>
                                                                                )}
                                                                                <span>{snsInfo.name}</span>
                                                                            </div>
                                                                        );
                                                                    })()}
                                                                </td>
                                                                <td style={styles.tableCell}>
                                                                    <strong>{formatE8s(log.amount_e8s)} ICP</strong>
                                                                </td>
                                                                <td style={styles.tableCell}>
                                                                    <span style={{
                                                                        ...styles.badge,
                                                                        ...(log.is_premium ? styles.premiumBadge : styles.regularBadge)
                                                                    }}>
                                                                        {log.is_premium ? (
                                                                            <><FaCrown size={10} style={{ marginRight: '4px' }} />Premium</>
                                                                        ) : (
                                                                            'Regular'
                                                                        )}
                                                                    </span>
                                                                </td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            </div>
                                            
                                            {/* Pagination */}
                                            {logsTotal > LOGS_PER_PAGE && (
                                                <div style={styles.paginationContainer}>
                                                    <span style={{ color: theme.colors.mutedText, fontSize: '0.9rem' }}>
                                                        Showing {logsOffset + 1}-{Math.min(logsOffset + LOGS_PER_PAGE, logsTotal)} of {logsTotal}
                                                    </span>
                                                    <div style={{ display: 'flex', gap: '8px' }}>
                                                        <button
                                                            style={{
                                                                ...styles.paginationButton,
                                                                ...(logsOffset === 0 ? styles.paginationButtonDisabled : {})
                                                            }}
                                                            onClick={() => loadLogs(Math.max(0, logsOffset - LOGS_PER_PAGE))}
                                                            disabled={logsOffset === 0 || logsLoading}
                                                        >
                                                            Previous
                                                        </button>
                                                        <button
                                                            style={{
                                                                ...styles.paginationButton,
                                                                ...(logsOffset + LOGS_PER_PAGE >= logsTotal ? styles.paginationButtonDisabled : {})
                                                            }}
                                                            onClick={() => loadLogs(logsOffset + LOGS_PER_PAGE)}
                                                            disabled={logsOffset + LOGS_PER_PAGE >= logsTotal || logsLoading}
                                                        >
                                                            Next
                                                        </button>
                                                    </div>
                                                </div>
                                            )}
                                        </>
                                    ) : (
                                        <p style={{ color: theme.colors.mutedText, textAlign: 'center', padding: '1.5rem' }}>
                                            No payment logs yet. Payment logs will appear here when users purchase scripts.
                                        </p>
                                    )}
                                </>
                            )}
                        </div>
                    </>
                )}
            </main>
        </div>
    );
}

export default AdminSnsJailbreak;
