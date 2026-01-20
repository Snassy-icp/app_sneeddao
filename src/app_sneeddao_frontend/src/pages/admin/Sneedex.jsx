import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../AuthContext';
import { useAdminCheck } from '../../hooks/useAdminCheck';
import { useTheme } from '../../contexts/ThemeContext';
import Header from '../../components/Header';
import { Principal } from '@dfinity/principal';
import { createSneedexActor, formatFeeRate, formatAmount } from '../../utils/SneedexUtils';
import { PrincipalDisplay } from '../../utils/PrincipalUtils';
import InfoModal from '../../components/InfoModal';
import ConfirmationModal from '../../ConfirmationModal';
import { 
    FaCog, FaPercent, FaWallet, FaSave, FaSpinner, FaUserShield, 
    FaPlus, FaTrash, FaClock, FaCubes, FaChartLine, FaLayerGroup,
    FaCheckCircle, FaTimesCircle
} from 'react-icons/fa';

export default function SneedexAdmin() {
    const { isAuthenticated, identity } = useAuth();
    const { theme } = useTheme();
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    
    // Admin check
    const { isAdmin: isGlobalAdmin, loading: adminLoading } = useAdminCheck({
        identity,
        isAuthenticated,
        redirectPath: '/admin'
    });
    
    // Config state
    const [config, setConfig] = useState(null);
    const [adminList, setAdminList] = useState([]);
    const [feeRate, setFeeRate] = useState(null);
    const [feeRecipient, setFeeRecipient] = useState(null);
    const [assetTypes, setAssetTypes] = useState([]);
    const [stats, setStats] = useState(null);
    
    // Form states
    const [newFeeRate, setNewFeeRate] = useState('');
    const [newFeeRecipientPrincipal, setNewFeeRecipientPrincipal] = useState('');
    const [newFeeRecipientSubaccount, setNewFeeRecipientSubaccount] = useState('');
    const [newAdminPrincipal, setNewAdminPrincipal] = useState('');
    const [newAssetTypeName, setNewAssetTypeName] = useState('');
    const [newAssetTypeDescription, setNewAssetTypeDescription] = useState('');
    const [newMinDuration, setNewMinDuration] = useState('');
    const [newMaxAssets, setNewMaxAssets] = useState('');
    
    // Loading states
    const [savingFeeRate, setSavingFeeRate] = useState(false);
    const [savingFeeRecipient, setSavingFeeRecipient] = useState(false);
    const [addingAdmin, setAddingAdmin] = useState(false);
    const [removingAdmin, setRemovingAdmin] = useState(null);
    const [addingAssetType, setAddingAssetType] = useState(false);
    const [deactivatingAssetType, setDeactivatingAssetType] = useState(null);
    const [savingConfig, setSavingConfig] = useState(false);
    
    // Modals
    const [infoModal, setInfoModal] = useState({ show: false, title: '', message: '', type: 'info' });
    const [confirmModal, setConfirmModal] = useState({ show: false, title: '', message: '', onConfirm: null });
    
    const showInfo = (title, message, type = 'info') => {
        setInfoModal({ show: true, title, message, type });
    };
    
    const closeInfoModal = () => {
        setInfoModal({ ...infoModal, show: false });
    };
    
    const showConfirm = (title, message, onConfirm) => {
        setConfirmModal({ show: true, title, message, onConfirm });
    };
    
    const closeConfirmModal = () => {
        setConfirmModal({ ...confirmModal, show: false });
    };
    
    const getSneedexActor = useCallback(() => {
        if (!identity) return null;
        return createSneedexActor(identity);
    }, [identity]);
    
    const fetchData = useCallback(async () => {
        if (!isAuthenticated || !identity) return;
        
        setLoading(true);
        setError('');
        
        try {
            const actor = getSneedexActor();
            if (!actor) return;
            
            const [configResult, feeRateResult, feeRecipientResult, assetTypesResult, statsResult] = await Promise.all([
                actor.getConfig(),
                actor.getMarketplaceFeeRate(),
                actor.getFeeRecipient(),
                actor.getAssetTypes(),
                actor.getMarketStats(),
            ]);
            
            setConfig(configResult);
            setAdminList(configResult.admins || []);
            setFeeRate(Number(feeRateResult));
            setFeeRecipient(feeRecipientResult);
            setAssetTypes(assetTypesResult);
            setStats(statsResult);
            
            // Pre-fill form with current values
            setNewMinDuration(String(Number(configResult.min_offer_duration_ns) / 1_000_000_000 / 3600)); // Convert ns to hours
            setNewMaxAssets(String(Number(configResult.max_assets_per_offer)));
            
        } catch (err) {
            console.error('Failed to fetch Sneedex config:', err);
            setError('Failed to load Sneedex configuration: ' + err.message);
        } finally {
            setLoading(false);
        }
    }, [isAuthenticated, identity, getSneedexActor]);
    
    useEffect(() => {
        if (isAuthenticated && identity && !adminLoading) {
            fetchData();
        }
    }, [isAuthenticated, identity, adminLoading, fetchData]);
    
    // Check if user is Sneedex admin
    const isSneedexAdmin = adminList.some(admin => 
        admin.toString() === identity?.getPrincipal()?.toString()
    );
    
    // Fee Rate handlers
    const handleSaveFeeRate = async () => {
        const rateBps = Math.round(parseFloat(newFeeRate) * 100);
        if (isNaN(rateBps) || rateBps < 0 || rateBps > 5000) {
            showInfo('Invalid Fee Rate', 'Fee rate must be between 0% and 50%', 'error');
            return;
        }
        
        setSavingFeeRate(true);
        try {
            const actor = getSneedexActor();
            const result = await actor.setMarketplaceFeeRate(BigInt(rateBps));
            if ('ok' in result) {
                showInfo('Success', `Fee rate updated to ${formatFeeRate(rateBps)}`, 'success');
                setFeeRate(rateBps);
                setNewFeeRate('');
            } else {
                showInfo('Error', 'Failed to update fee rate: ' + JSON.stringify(result.err), 'error');
            }
        } catch (e) {
            showInfo('Error', 'Failed to update fee rate: ' + e.message, 'error');
        }
        setSavingFeeRate(false);
    };
    
    // Fee Recipient handlers
    const handleSaveFeeRecipient = async () => {
        let principal;
        try {
            principal = Principal.fromText(newFeeRecipientPrincipal);
        } catch (e) {
            showInfo('Invalid Principal', 'Please enter a valid principal ID', 'error');
            return;
        }
        
        let subaccount = [];
        if (newFeeRecipientSubaccount.trim()) {
            try {
                const hex = newFeeRecipientSubaccount.replace(/^0x/, '');
                const bytes = [];
                for (let i = 0; i < hex.length; i += 2) {
                    bytes.push(parseInt(hex.substr(i, 2), 16));
                }
                if (bytes.length !== 32) {
                    throw new Error('Subaccount must be 32 bytes');
                }
                subaccount = [bytes];
            } catch (e) {
                showInfo('Invalid Subaccount', 'Subaccount must be a 64-character hex string (32 bytes)', 'error');
                return;
            }
        }
        
        setSavingFeeRecipient(true);
        try {
            const actor = getSneedexActor();
            const result = await actor.setFeeRecipient({
                owner: principal,
                subaccount: subaccount,
            });
            if ('ok' in result) {
                showInfo('Success', 'Fee recipient updated successfully', 'success');
                fetchData();
                setNewFeeRecipientPrincipal('');
                setNewFeeRecipientSubaccount('');
            } else {
                showInfo('Error', 'Failed to update fee recipient: ' + JSON.stringify(result.err), 'error');
            }
        } catch (e) {
            showInfo('Error', 'Failed to update fee recipient: ' + e.message, 'error');
        }
        setSavingFeeRecipient(false);
    };
    
    // Admin management handlers
    const handleAddAdmin = async () => {
        let principal;
        try {
            principal = Principal.fromText(newAdminPrincipal);
        } catch (e) {
            showInfo('Invalid Principal', 'Please enter a valid principal ID', 'error');
            return;
        }
        
        setAddingAdmin(true);
        try {
            const actor = getSneedexActor();
            const result = await actor.addAdmin(principal);
            if ('ok' in result) {
                showInfo('Success', 'Admin added successfully', 'success');
                fetchData();
                setNewAdminPrincipal('');
            } else {
                showInfo('Error', 'Failed to add admin: ' + JSON.stringify(result.err), 'error');
            }
        } catch (e) {
            showInfo('Error', 'Failed to add admin: ' + e.message, 'error');
        }
        setAddingAdmin(false);
    };
    
    const handleRemoveAdmin = async (adminPrincipal) => {
        showConfirm(
            'Remove Admin',
            `Are you sure you want to remove this admin?\n\n${adminPrincipal.toString()}`,
            async () => {
                closeConfirmModal();
                setRemovingAdmin(adminPrincipal.toString());
                try {
                    const actor = getSneedexActor();
                    const result = await actor.removeAdmin(adminPrincipal);
                    if ('ok' in result) {
                        showInfo('Success', 'Admin removed successfully', 'success');
                        fetchData();
                    } else {
                        showInfo('Error', 'Failed to remove admin: ' + JSON.stringify(result.err), 'error');
                    }
                } catch (e) {
                    showInfo('Error', 'Failed to remove admin: ' + e.message, 'error');
                }
                setRemovingAdmin(null);
            }
        );
    };
    
    // Asset type handlers
    const handleAddAssetType = async () => {
        if (!newAssetTypeName.trim()) {
            showInfo('Invalid Name', 'Please enter an asset type name', 'error');
            return;
        }
        
        setAddingAssetType(true);
        try {
            const actor = getSneedexActor();
            const result = await actor.addAssetType(newAssetTypeName, newAssetTypeDescription);
            if ('ok' in result) {
                showInfo('Success', `Asset type "${newAssetTypeName}" added with ID ${result.ok}`, 'success');
                fetchData();
                setNewAssetTypeName('');
                setNewAssetTypeDescription('');
            } else {
                showInfo('Error', 'Failed to add asset type: ' + JSON.stringify(result.err), 'error');
            }
        } catch (e) {
            showInfo('Error', 'Failed to add asset type: ' + e.message, 'error');
        }
        setAddingAssetType(false);
    };
    
    const handleDeactivateAssetType = async (assetType) => {
        showConfirm(
            'Deactivate Asset Type',
            `Are you sure you want to deactivate "${assetType.name}"?\n\nThis will prevent new offers from using this asset type.`,
            async () => {
                closeConfirmModal();
                setDeactivatingAssetType(assetType.id);
                try {
                    const actor = getSneedexActor();
                    const result = await actor.deactivateAssetType(assetType.id);
                    if ('ok' in result) {
                        showInfo('Success', `Asset type "${assetType.name}" deactivated`, 'success');
                        fetchData();
                    } else {
                        showInfo('Error', 'Failed to deactivate asset type: ' + JSON.stringify(result.err), 'error');
                    }
                } catch (e) {
                    showInfo('Error', 'Failed to deactivate asset type: ' + e.message, 'error');
                }
                setDeactivatingAssetType(null);
            }
        );
    };
    
    // Config update handler
    const handleSaveConfig = async () => {
        const durationHours = parseFloat(newMinDuration);
        const maxAssets = parseInt(newMaxAssets);
        
        if (isNaN(durationHours) || durationHours < 0) {
            showInfo('Invalid Duration', 'Please enter a valid minimum offer duration', 'error');
            return;
        }
        if (isNaN(maxAssets) || maxAssets < 1 || maxAssets > 100) {
            showInfo('Invalid Max Assets', 'Please enter a valid max assets per offer (1-100)', 'error');
            return;
        }
        
        setSavingConfig(true);
        try {
            const actor = getSneedexActor();
            const newConfig = {
                admins: adminList,
                min_offer_duration_ns: BigInt(Math.floor(durationHours * 3600 * 1_000_000_000)),
                max_assets_per_offer: BigInt(maxAssets),
            };
            const result = await actor.updateConfig(newConfig);
            if ('ok' in result) {
                showInfo('Success', 'Configuration updated successfully', 'success');
                fetchData();
            } else {
                showInfo('Error', 'Failed to update configuration: ' + JSON.stringify(result.err), 'error');
            }
        } catch (e) {
            showInfo('Error', 'Failed to update configuration: ' + e.message, 'error');
        }
        setSavingConfig(false);
    };
    
    const styles = {
        container: {
            maxWidth: '1200px',
            margin: '0 auto',
            padding: '2rem',
            color: theme.colors.primaryText,
        },
        title: {
            fontSize: '2.5rem',
            marginBottom: '0.5rem',
            background: `linear-gradient(135deg, ${theme.colors.accent}, ${theme.colors.success})`,
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
            fontWeight: 'bold',
            display: 'flex',
            alignItems: 'center',
            gap: '16px',
        },
        subtitle: {
            color: theme.colors.mutedText,
            marginBottom: '2rem',
            fontSize: '1.1rem',
        },
        section: {
            background: theme.colors.cardGradient,
            border: `1px solid ${theme.colors.border}`,
            borderRadius: '16px',
            padding: '1.5rem',
            marginBottom: '1.5rem',
            boxShadow: theme.colors.cardShadow,
        },
        sectionTitle: {
            fontSize: '1.3rem',
            fontWeight: '600',
            marginBottom: '1rem',
            color: theme.colors.primaryText,
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
        },
        row: {
            display: 'flex',
            gap: '1rem',
            alignItems: 'center',
            flexWrap: 'wrap',
            marginBottom: '1rem',
        },
        input: {
            padding: '10px 14px',
            borderRadius: '8px',
            border: `1px solid ${theme.colors.border}`,
            background: theme.colors.secondaryBg,
            color: theme.colors.primaryText,
            fontSize: '1rem',
            flex: '1',
            minWidth: '200px',
        },
        inputSmall: {
            padding: '10px 14px',
            borderRadius: '8px',
            border: `1px solid ${theme.colors.border}`,
            background: theme.colors.secondaryBg,
            color: theme.colors.primaryText,
            fontSize: '1rem',
            width: '120px',
        },
        button: {
            padding: '10px 20px',
            borderRadius: '8px',
            border: 'none',
            background: theme.colors.accent,
            color: theme.colors.primaryBg,
            fontWeight: '600',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            whiteSpace: 'nowrap',
        },
        buttonSuccess: {
            padding: '10px 20px',
            borderRadius: '8px',
            border: 'none',
            background: theme.colors.success,
            color: theme.colors.primaryBg,
            fontWeight: '600',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            whiteSpace: 'nowrap',
        },
        buttonDanger: {
            padding: '8px 14px',
            borderRadius: '8px',
            border: 'none',
            background: theme.colors.error,
            color: '#fff',
            fontWeight: '600',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
        },
        list: {
            display: 'flex',
            flexDirection: 'column',
            gap: '0.75rem',
        },
        listItem: {
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '12px 16px',
            background: theme.colors.tertiaryBg,
            borderRadius: '10px',
            border: `1px solid ${theme.colors.border}`,
        },
        label: {
            color: theme.colors.mutedText,
            fontSize: '0.9rem',
            marginBottom: '0.5rem',
            display: 'block',
        },
        value: {
            color: theme.colors.primaryText,
            fontWeight: '600',
        },
        statsGrid: {
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
            gap: '1rem',
            marginTop: '1rem',
        },
        statCard: {
            background: theme.colors.tertiaryBg,
            border: `1px solid ${theme.colors.border}`,
            borderRadius: '10px',
            padding: '1rem',
            textAlign: 'center',
        },
        statValue: {
            fontSize: '1.75rem',
            fontWeight: '700',
            color: theme.colors.accent,
            marginBottom: '0.25rem',
        },
        statLabel: {
            fontSize: '0.85rem',
            color: theme.colors.mutedText,
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
        },
        badge: {
            padding: '4px 10px',
            borderRadius: '20px',
            fontSize: '0.8rem',
            fontWeight: '600',
        },
        badgeActive: {
            background: `${theme.colors.success}20`,
            color: theme.colors.success,
        },
        badgeInactive: {
            background: `${theme.colors.error}20`,
            color: theme.colors.error,
        },
        error: {
            background: `${theme.colors.error}15`,
            border: `1px solid ${theme.colors.error}`,
            color: theme.colors.error,
            padding: '1rem',
            borderRadius: '10px',
            marginBottom: '1rem',
        },
        loading: {
            textAlign: 'center',
            padding: '3rem',
            color: theme.colors.mutedText,
        },
    };
    
    if (adminLoading || loading) {
        return (
            <div className="page-container" style={{ background: theme.colors.primaryGradient, minHeight: '100vh' }}>
                <Header />
                <main style={styles.container}>
                    <div style={styles.loading}>
                        <FaSpinner className="spin" size={32} />
                        <p style={{ marginTop: '1rem' }}>Loading Sneedex Admin...</p>
                    </div>
                </main>
            </div>
        );
    }
    
    if (!isGlobalAdmin && !isSneedexAdmin) {
        return (
            <div className="page-container" style={{ background: theme.colors.primaryGradient, minHeight: '100vh' }}>
                <Header />
                <main style={styles.container}>
                    <div style={styles.error}>
                        <h2>Access Denied</h2>
                        <p>You must be a Sneedex admin to access this page.</p>
                    </div>
                </main>
            </div>
        );
    }
    
    return (
        <div className="page-container" style={{ background: theme.colors.primaryGradient, minHeight: '100vh' }}>
            <Header />
            <main style={styles.container}>
                <h1 style={styles.title}>
                    <FaCog style={{ color: theme.colors.accent }} />
                    Sneedex Admin
                </h1>
                <p style={styles.subtitle}>
                    Manage marketplace settings, fees, admins, and asset types
                </p>
                
                {error && (
                    <div style={styles.error}>{error}</div>
                )}
                
                {/* Stats Overview */}
                {stats && (
                    <section style={styles.section}>
                        <h2 style={styles.sectionTitle}>
                            <FaChartLine style={{ color: theme.colors.success }} />
                            Marketplace Overview
                        </h2>
                        <div style={styles.statsGrid}>
                            <div style={styles.statCard}>
                                <div style={styles.statValue}>{Number(stats.total_offers)}</div>
                                <div style={styles.statLabel}>Total Offers</div>
                            </div>
                            <div style={styles.statCard}>
                                <div style={styles.statValue}>{Number(stats.active_offers)}</div>
                                <div style={styles.statLabel}>Active Offers</div>
                            </div>
                            <div style={styles.statCard}>
                                <div style={styles.statValue}>{Number(stats.completed_offers)}</div>
                                <div style={styles.statLabel}>Completed</div>
                            </div>
                            <div style={styles.statCard}>
                                <div style={styles.statValue}>{Number(stats.total_bids)}</div>
                                <div style={styles.statLabel}>Total Bids</div>
                            </div>
                            <div style={styles.statCard}>
                                <div style={{ ...styles.statValue, color: theme.colors.warning }}>
                                    {feeRate !== null ? formatFeeRate(feeRate) : '--'}
                                </div>
                                <div style={styles.statLabel}>Fee Rate</div>
                            </div>
                        </div>
                    </section>
                )}
                
                {/* Fee Settings */}
                <section style={styles.section}>
                    <h2 style={styles.sectionTitle}>
                        <FaPercent style={{ color: theme.colors.warning }} />
                        Marketplace Fee Rate
                    </h2>
                    <p style={{ color: theme.colors.mutedText, marginBottom: '1rem' }}>
                        Current fee: <strong style={{ color: theme.colors.warning }}>{feeRate !== null ? formatFeeRate(feeRate) : 'Loading...'}</strong>
                        <br />
                        <small>This fee is deducted from winning bids. New offers inherit the rate at creation time.</small>
                    </p>
                    <div style={styles.row}>
                        <input
                            type="number"
                            step="0.01"
                            min="0"
                            max="50"
                            placeholder="New fee % (e.g., 2.5)"
                            value={newFeeRate}
                            onChange={(e) => setNewFeeRate(e.target.value)}
                            style={styles.inputSmall}
                        />
                        <span style={{ color: theme.colors.mutedText }}>%</span>
                        <button
                            onClick={handleSaveFeeRate}
                            disabled={savingFeeRate || !newFeeRate}
                            style={{
                                ...styles.button,
                                opacity: savingFeeRate || !newFeeRate ? 0.5 : 1,
                                cursor: savingFeeRate || !newFeeRate ? 'not-allowed' : 'pointer',
                            }}
                        >
                            {savingFeeRate ? <FaSpinner className="spin" /> : <FaSave />}
                            Save
                        </button>
                    </div>
                </section>
                
                {/* Fee Recipient */}
                <section style={styles.section}>
                    <h2 style={styles.sectionTitle}>
                        <FaWallet style={{ color: theme.colors.success }} />
                        Fee Recipient Account
                    </h2>
                    <p style={{ color: theme.colors.mutedText, marginBottom: '1rem' }}>
                        Current recipient: {feeRecipient ? (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                                <PrincipalDisplay principal={feeRecipient.owner.toString()} />
                                {feeRecipient.subaccount?.[0] && (
                                    <span style={{ fontSize: '0.8rem' }}>
                                        (sub: 0x{Array.from(feeRecipient.subaccount[0]).map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 12)}...)
                                    </span>
                                )}
                            </span>
                        ) : 'Loading...'}
                    </p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                        <input
                            type="text"
                            placeholder="Principal ID"
                            value={newFeeRecipientPrincipal}
                            onChange={(e) => setNewFeeRecipientPrincipal(e.target.value)}
                            style={{ ...styles.input, maxWidth: '500px' }}
                        />
                        <input
                            type="text"
                            placeholder="Subaccount (optional, 64-char hex)"
                            value={newFeeRecipientSubaccount}
                            onChange={(e) => setNewFeeRecipientSubaccount(e.target.value)}
                            style={{ ...styles.input, maxWidth: '500px' }}
                        />
                        <button
                            onClick={handleSaveFeeRecipient}
                            disabled={savingFeeRecipient || !newFeeRecipientPrincipal}
                            style={{
                                ...styles.buttonSuccess,
                                width: 'fit-content',
                                opacity: savingFeeRecipient || !newFeeRecipientPrincipal ? 0.5 : 1,
                                cursor: savingFeeRecipient || !newFeeRecipientPrincipal ? 'not-allowed' : 'pointer',
                            }}
                        >
                            {savingFeeRecipient ? <FaSpinner className="spin" /> : <FaSave />}
                            Save Recipient
                        </button>
                    </div>
                </section>
                
                {/* Admin Management */}
                <section style={styles.section}>
                    <h2 style={styles.sectionTitle}>
                        <FaUserShield style={{ color: theme.colors.accent }} />
                        Sneedex Admins
                    </h2>
                    <p style={{ color: theme.colors.mutedText, marginBottom: '1rem' }}>
                        Admins can modify marketplace settings, add asset types, and manage other admins.
                    </p>
                    
                    <div style={styles.list}>
                        {adminList.map((admin, index) => (
                            <div key={index} style={styles.listItem}>
                                <PrincipalDisplay principal={admin.toString()} />
                                <button
                                    onClick={() => handleRemoveAdmin(admin)}
                                    disabled={removingAdmin === admin.toString() || adminList.length === 1}
                                    style={{
                                        ...styles.buttonDanger,
                                        opacity: removingAdmin === admin.toString() || adminList.length === 1 ? 0.5 : 1,
                                        cursor: removingAdmin === admin.toString() || adminList.length === 1 ? 'not-allowed' : 'pointer',
                                    }}
                                    title={adminList.length === 1 ? 'Cannot remove last admin' : 'Remove admin'}
                                >
                                    {removingAdmin === admin.toString() ? <FaSpinner className="spin" /> : <FaTrash />}
                                </button>
                            </div>
                        ))}
                    </div>
                    
                    <div style={{ ...styles.row, marginTop: '1rem' }}>
                        <input
                            type="text"
                            placeholder="New admin principal ID"
                            value={newAdminPrincipal}
                            onChange={(e) => setNewAdminPrincipal(e.target.value)}
                            style={styles.input}
                        />
                        <button
                            onClick={handleAddAdmin}
                            disabled={addingAdmin || !newAdminPrincipal}
                            style={{
                                ...styles.buttonSuccess,
                                opacity: addingAdmin || !newAdminPrincipal ? 0.5 : 1,
                                cursor: addingAdmin || !newAdminPrincipal ? 'not-allowed' : 'pointer',
                            }}
                        >
                            {addingAdmin ? <FaSpinner className="spin" /> : <FaPlus />}
                            Add Admin
                        </button>
                    </div>
                </section>
                
                {/* General Config */}
                <section style={styles.section}>
                    <h2 style={styles.sectionTitle}>
                        <FaClock style={{ color: theme.colors.info || theme.colors.accent }} />
                        General Configuration
                    </h2>
                    
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '1.5rem' }}>
                        <div>
                            <label style={styles.label}>Minimum Offer Duration (hours)</label>
                            <input
                                type="number"
                                min="0"
                                step="0.5"
                                value={newMinDuration}
                                onChange={(e) => setNewMinDuration(e.target.value)}
                                style={{ ...styles.input, width: '100%' }}
                            />
                            <small style={{ color: theme.colors.mutedText }}>
                                Minimum time an offer must remain active
                            </small>
                        </div>
                        <div>
                            <label style={styles.label}>Max Assets Per Offer</label>
                            <input
                                type="number"
                                min="1"
                                max="100"
                                value={newMaxAssets}
                                onChange={(e) => setNewMaxAssets(e.target.value)}
                                style={{ ...styles.input, width: '100%' }}
                            />
                            <small style={{ color: theme.colors.mutedText }}>
                                Maximum assets that can be bundled in one offer
                            </small>
                        </div>
                    </div>
                    
                    <button
                        onClick={handleSaveConfig}
                        disabled={savingConfig}
                        style={{
                            ...styles.button,
                            marginTop: '1.5rem',
                            opacity: savingConfig ? 0.5 : 1,
                            cursor: savingConfig ? 'not-allowed' : 'pointer',
                        }}
                    >
                        {savingConfig ? <FaSpinner className="spin" /> : <FaSave />}
                        Save Configuration
                    </button>
                </section>
                
                {/* Asset Types */}
                <section style={styles.section}>
                    <h2 style={styles.sectionTitle}>
                        <FaLayerGroup style={{ color: theme.colors.success }} />
                        Asset Types
                    </h2>
                    <p style={{ color: theme.colors.mutedText, marginBottom: '1rem' }}>
                        Asset types define what can be traded on the marketplace. Deactivated types cannot be used for new offers.
                    </p>
                    
                    <div style={styles.list}>
                        {assetTypes.map((assetType) => (
                            <div key={assetType.id} style={styles.listItem}>
                                <div style={{ flex: 1 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                        <span style={styles.value}>
                                            #{Number(assetType.id)} {assetType.name}
                                        </span>
                                        <span style={{
                                            ...styles.badge,
                                            ...(assetType.active ? styles.badgeActive : styles.badgeInactive),
                                        }}>
                                            {assetType.active ? (
                                                <><FaCheckCircle style={{ marginRight: '4px' }} />Active</>
                                            ) : (
                                                <><FaTimesCircle style={{ marginRight: '4px' }} />Inactive</>
                                            )}
                                        </span>
                                    </div>
                                    {assetType.description && (
                                        <div style={{ color: theme.colors.mutedText, fontSize: '0.9rem', marginTop: '0.25rem' }}>
                                            {assetType.description}
                                        </div>
                                    )}
                                </div>
                                {assetType.active && (
                                    <button
                                        onClick={() => handleDeactivateAssetType(assetType)}
                                        disabled={deactivatingAssetType === assetType.id}
                                        style={{
                                            ...styles.buttonDanger,
                                            opacity: deactivatingAssetType === assetType.id ? 0.5 : 1,
                                            cursor: deactivatingAssetType === assetType.id ? 'not-allowed' : 'pointer',
                                        }}
                                    >
                                        {deactivatingAssetType === assetType.id ? <FaSpinner className="spin" /> : <FaTimesCircle />}
                                        Deactivate
                                    </button>
                                )}
                            </div>
                        ))}
                    </div>
                    
                    <div style={{ marginTop: '1.5rem', padding: '1rem', background: theme.colors.tertiaryBg, borderRadius: '10px' }}>
                        <h3 style={{ marginBottom: '1rem', fontSize: '1.1rem', color: theme.colors.primaryText }}>
                            <FaPlus style={{ marginRight: '8px' }} />
                            Add New Asset Type
                        </h3>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                            <input
                                type="text"
                                placeholder="Asset type name (e.g., NFT)"
                                value={newAssetTypeName}
                                onChange={(e) => setNewAssetTypeName(e.target.value)}
                                style={styles.input}
                            />
                            <input
                                type="text"
                                placeholder="Description (optional)"
                                value={newAssetTypeDescription}
                                onChange={(e) => setNewAssetTypeDescription(e.target.value)}
                                style={styles.input}
                            />
                            <button
                                onClick={handleAddAssetType}
                                disabled={addingAssetType || !newAssetTypeName.trim()}
                                style={{
                                    ...styles.buttonSuccess,
                                    width: 'fit-content',
                                    opacity: addingAssetType || !newAssetTypeName.trim() ? 0.5 : 1,
                                    cursor: addingAssetType || !newAssetTypeName.trim() ? 'not-allowed' : 'pointer',
                                }}
                            >
                                {addingAssetType ? <FaSpinner className="spin" /> : <FaPlus />}
                                Add Asset Type
                            </button>
                        </div>
                    </div>
                </section>
                
            </main>
            
            <InfoModal
                isOpen={infoModal.show}
                onClose={closeInfoModal}
                title={infoModal.title}
                message={infoModal.message}
                type={infoModal.type}
            />
            
            <ConfirmationModal
                isOpen={confirmModal.show}
                onClose={closeConfirmModal}
                onConfirm={confirmModal.onConfirm}
                title={confirmModal.title}
                message={confirmModal.message}
            />
        </div>
    );
}

