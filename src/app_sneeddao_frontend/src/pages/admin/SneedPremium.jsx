import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../AuthContext';
import { useAdminCheck } from '../../hooks/useAdminCheck';
import { useTheme } from '../../contexts/ThemeContext';
import Header from '../../components/Header';
import { Principal } from '@dfinity/principal';
import { 
    createSneedPremiumActor, 
    formatDuration, 
    formatIcp, 
    formatVotingPower,
    formatTimestamp,
    getTimeRemaining,
    parseDurationToNs,
    parseIcpToE8s,
    E8S_PER_ICP,
    NS_PER_DAY,
    NS_PER_MONTH,
    NS_PER_YEAR
} from '../../utils/SneedPremiumUtils';
import { PrincipalDisplay } from '../../utils/PrincipalUtils';
import InfoModal from '../../components/InfoModal';
import ConfirmationModal from '../../ConfirmationModal';
import { 
    FaCrown, FaUserShield, FaSave, FaSpinner, FaPlus, FaTrash, 
    FaClock, FaCoins, FaVoteYea, FaUsers, FaEdit, FaCheckCircle, 
    FaTimesCircle, FaCog, FaWallet
} from 'react-icons/fa';

export default function SneedPremiumAdmin() {
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
    const [icpTiers, setIcpTiers] = useState([]);
    const [vpTiers, setVpTiers] = useState([]);
    const [memberships, setMemberships] = useState([]);
    const [canisterId, setCanisterId] = useState(null);
    
    // Form states - Admin management
    const [newAdminPrincipal, setNewAdminPrincipal] = useState('');
    
    // Form states - ICP Tier
    const [newIcpTierName, setNewIcpTierName] = useState('');
    const [newIcpTierAmount, setNewIcpTierAmount] = useState('');
    const [newIcpTierDuration, setNewIcpTierDuration] = useState('');
    const [newIcpTierDurationUnit, setNewIcpTierDurationUnit] = useState('months');
    
    // Form states - VP Tier
    const [newVpTierName, setNewVpTierName] = useState('');
    const [newVpTierMinVp, setNewVpTierMinVp] = useState('');
    const [newVpTierDuration, setNewVpTierDuration] = useState('');
    const [newVpTierDurationUnit, setNewVpTierDurationUnit] = useState('months');
    
    // Form states - Config
    const [newPaymentRecipientPrincipal, setNewPaymentRecipientPrincipal] = useState('');
    const [newPaymentRecipientSubaccount, setNewPaymentRecipientSubaccount] = useState('');
    const [newMinClaimInterval, setNewMinClaimInterval] = useState('');
    const [newMinClaimIntervalUnit, setNewMinClaimIntervalUnit] = useState('hours');
    
    // Form states - Manual membership
    const [manualMemberPrincipal, setManualMemberPrincipal] = useState('');
    const [manualMemberDuration, setManualMemberDuration] = useState('');
    const [manualMemberDurationUnit, setManualMemberDurationUnit] = useState('months');
    
    // Loading states
    const [addingAdmin, setAddingAdmin] = useState(false);
    const [removingAdmin, setRemovingAdmin] = useState(null);
    const [addingIcpTier, setAddingIcpTier] = useState(false);
    const [removingIcpTier, setRemovingIcpTier] = useState(null);
    const [addingVpTier, setAddingVpTier] = useState(false);
    const [removingVpTier, setRemovingVpTier] = useState(null);
    const [savingPaymentRecipient, setSavingPaymentRecipient] = useState(false);
    const [savingMinClaimInterval, setSavingMinClaimInterval] = useState(false);
    const [grantingMembership, setGrantingMembership] = useState(false);
    const [revokingMembership, setRevokingMembership] = useState(null);
    
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
    
    const getActor = useCallback(async () => {
        if (!identity) return null;
        return await createSneedPremiumActor(identity);
    }, [identity]);
    
    const fetchData = useCallback(async () => {
        if (!isAuthenticated || !identity) return;
        
        setLoading(true);
        setError('');
        
        try {
            const actor = await getActor();
            if (!actor) return;
            
            const [configResult, icpTiersResult, vpTiersResult, membershipsResult, canisterIdResult] = await Promise.all([
                actor.getConfig(),
                actor.getAllIcpTiers(),
                actor.getAllVotingPowerTiers(),
                actor.getAllMemberships(),
                actor.getCanisterId(),
            ]);
            
            setConfig(configResult);
            setAdminList(configResult.admins || []);
            setIcpTiers(icpTiersResult);
            setVpTiers(vpTiersResult);
            setMemberships(membershipsResult);
            setCanisterId(canisterIdResult);
            
        } catch (err) {
            console.error('Failed to fetch Sneed Premium config:', err);
            setError('Failed to load Sneed Premium configuration: ' + err.message);
        } finally {
            setLoading(false);
        }
    }, [isAuthenticated, identity, getActor]);
    
    useEffect(() => {
        if (isAuthenticated && identity && !adminLoading) {
            fetchData();
        }
    }, [isAuthenticated, identity, adminLoading, fetchData]);
    
    // Check if user is Premium admin
    const isPremiumAdmin = adminList.some(admin => 
        admin.toString() === identity?.getPrincipal()?.toString()
    );
    
    // ============================================
    // Admin Management Handlers
    // ============================================
    
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
            const actor = await getActor();
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
                    const actor = await getActor();
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
    
    // ============================================
    // ICP Tier Handlers
    // ============================================
    
    const handleAddIcpTier = async () => {
        if (!newIcpTierName.trim()) {
            showInfo('Invalid Name', 'Please enter a tier name', 'error');
            return;
        }
        
        let amountE8s;
        try {
            amountE8s = parseIcpToE8s(newIcpTierAmount);
        } catch (e) {
            showInfo('Invalid Amount', 'Please enter a valid ICP amount', 'error');
            return;
        }
        
        const durationNum = parseFloat(newIcpTierDuration);
        if (isNaN(durationNum) || durationNum <= 0) {
            showInfo('Invalid Duration', 'Please enter a valid duration', 'error');
            return;
        }
        
        const durationNs = parseDurationToNs(durationNum, newIcpTierDurationUnit);
        
        setAddingIcpTier(true);
        try {
            const actor = await getActor();
            const tier = {
                amountE8s: amountE8s,
                durationNs: durationNs,
                name: newIcpTierName.trim(),
                active: true,
            };
            const result = await actor.addIcpTier(tier);
            if ('ok' in result) {
                showInfo('Success', `ICP tier "${newIcpTierName}" added successfully`, 'success');
                fetchData();
                setNewIcpTierName('');
                setNewIcpTierAmount('');
                setNewIcpTierDuration('');
            } else {
                showInfo('Error', 'Failed to add ICP tier: ' + JSON.stringify(result.err), 'error');
            }
        } catch (e) {
            showInfo('Error', 'Failed to add ICP tier: ' + e.message, 'error');
        }
        setAddingIcpTier(false);
    };
    
    const handleRemoveIcpTier = async (index) => {
        const tier = icpTiers[index];
        showConfirm(
            'Remove ICP Tier',
            `Are you sure you want to remove "${tier.name}"?\n\n${formatIcp(tier.amountE8s)} → ${formatDuration(tier.durationNs)}`,
            async () => {
                closeConfirmModal();
                setRemovingIcpTier(index);
                try {
                    const actor = await getActor();
                    const result = await actor.removeIcpTier(BigInt(index));
                    if ('ok' in result) {
                        showInfo('Success', 'ICP tier removed successfully', 'success');
                        fetchData();
                    } else {
                        showInfo('Error', 'Failed to remove ICP tier: ' + JSON.stringify(result.err), 'error');
                    }
                } catch (e) {
                    showInfo('Error', 'Failed to remove ICP tier: ' + e.message, 'error');
                }
                setRemovingIcpTier(null);
            }
        );
    };
    
    // ============================================
    // Voting Power Tier Handlers
    // ============================================
    
    const handleAddVpTier = async () => {
        if (!newVpTierName.trim()) {
            showInfo('Invalid Name', 'Please enter a tier name', 'error');
            return;
        }
        
        const minVpNum = parseFloat(newVpTierMinVp);
        if (isNaN(minVpNum) || minVpNum < 0) {
            showInfo('Invalid Voting Power', 'Please enter a valid minimum voting power', 'error');
            return;
        }
        const minVpE8s = BigInt(Math.round(minVpNum * Number(E8S_PER_ICP)));
        
        const durationNum = parseFloat(newVpTierDuration);
        if (isNaN(durationNum) || durationNum <= 0) {
            showInfo('Invalid Duration', 'Please enter a valid duration', 'error');
            return;
        }
        
        const durationNs = parseDurationToNs(durationNum, newVpTierDurationUnit);
        
        setAddingVpTier(true);
        try {
            const actor = await getActor();
            const tier = {
                minVotingPowerE8s: minVpE8s,
                durationNs: durationNs,
                name: newVpTierName.trim(),
                active: true,
            };
            const result = await actor.addVpTier(tier);
            if ('ok' in result) {
                showInfo('Success', `Voting power tier "${newVpTierName}" added successfully`, 'success');
                fetchData();
                setNewVpTierName('');
                setNewVpTierMinVp('');
                setNewVpTierDuration('');
            } else {
                showInfo('Error', 'Failed to add VP tier: ' + JSON.stringify(result.err), 'error');
            }
        } catch (e) {
            showInfo('Error', 'Failed to add VP tier: ' + e.message, 'error');
        }
        setAddingVpTier(false);
    };
    
    const handleRemoveVpTier = async (index) => {
        const tier = vpTiers[index];
        showConfirm(
            'Remove Voting Power Tier',
            `Are you sure you want to remove "${tier.name}"?\n\n${formatVotingPower(tier.minVotingPowerE8s)} → ${formatDuration(tier.durationNs)}`,
            async () => {
                closeConfirmModal();
                setRemovingVpTier(index);
                try {
                    const actor = await getActor();
                    const result = await actor.removeVpTier(BigInt(index));
                    if ('ok' in result) {
                        showInfo('Success', 'VP tier removed successfully', 'success');
                        fetchData();
                    } else {
                        showInfo('Error', 'Failed to remove VP tier: ' + JSON.stringify(result.err), 'error');
                    }
                } catch (e) {
                    showInfo('Error', 'Failed to remove VP tier: ' + e.message, 'error');
                }
                setRemovingVpTier(null);
            }
        );
    };
    
    // ============================================
    // Config Handlers
    // ============================================
    
    const handleSavePaymentRecipient = async () => {
        let principal;
        try {
            principal = Principal.fromText(newPaymentRecipientPrincipal);
        } catch (e) {
            showInfo('Invalid Principal', 'Please enter a valid principal ID', 'error');
            return;
        }
        
        let subaccount = [];
        if (newPaymentRecipientSubaccount.trim()) {
            try {
                const hex = newPaymentRecipientSubaccount.replace(/^0x/, '');
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
        
        setSavingPaymentRecipient(true);
        try {
            const actor = await getActor();
            const result = await actor.setPaymentRecipient({
                owner: principal,
                subaccount: subaccount,
            });
            if ('ok' in result) {
                showInfo('Success', 'Payment recipient updated successfully', 'success');
                fetchData();
                setNewPaymentRecipientPrincipal('');
                setNewPaymentRecipientSubaccount('');
            } else {
                showInfo('Error', 'Failed to update payment recipient: ' + JSON.stringify(result.err), 'error');
            }
        } catch (e) {
            showInfo('Error', 'Failed to update payment recipient: ' + e.message, 'error');
        }
        setSavingPaymentRecipient(false);
    };
    
    const handleSaveMinClaimInterval = async () => {
        const intervalNum = parseFloat(newMinClaimInterval);
        if (isNaN(intervalNum) || intervalNum < 0) {
            showInfo('Invalid Interval', 'Please enter a valid interval', 'error');
            return;
        }
        
        const intervalNs = parseDurationToNs(intervalNum, newMinClaimIntervalUnit);
        
        setSavingMinClaimInterval(true);
        try {
            const actor = await getActor();
            const result = await actor.setMinClaimInterval(intervalNs);
            if ('ok' in result) {
                showInfo('Success', 'Minimum claim interval updated successfully', 'success');
                fetchData();
                setNewMinClaimInterval('');
            } else {
                showInfo('Error', 'Failed to update interval: ' + JSON.stringify(result.err), 'error');
            }
        } catch (e) {
            showInfo('Error', 'Failed to update interval: ' + e.message, 'error');
        }
        setSavingMinClaimInterval(false);
    };
    
    // ============================================
    // Membership Management Handlers
    // ============================================
    
    const handleGrantMembership = async () => {
        let principal;
        try {
            principal = Principal.fromText(manualMemberPrincipal);
        } catch (e) {
            showInfo('Invalid Principal', 'Please enter a valid principal ID', 'error');
            return;
        }
        
        const durationNum = parseFloat(manualMemberDuration);
        if (isNaN(durationNum) || durationNum <= 0) {
            showInfo('Invalid Duration', 'Please enter a valid duration', 'error');
            return;
        }
        
        const durationNs = parseDurationToNs(durationNum, manualMemberDurationUnit);
        
        setGrantingMembership(true);
        try {
            const actor = await getActor();
            const result = await actor.extendMembershipAdmin(principal, durationNs);
            if ('ok' in result) {
                showInfo('Success', `Membership granted/extended for ${durationNum} ${manualMemberDurationUnit}`, 'success');
                fetchData();
                setManualMemberPrincipal('');
                setManualMemberDuration('');
            } else {
                showInfo('Error', 'Failed to grant membership: ' + JSON.stringify(result.err), 'error');
            }
        } catch (e) {
            showInfo('Error', 'Failed to grant membership: ' + e.message, 'error');
        }
        setGrantingMembership(false);
    };
    
    const handleRevokeMembership = async (principal) => {
        showConfirm(
            'Revoke Membership',
            `Are you sure you want to revoke membership for this principal?\n\n${principal.toString()}`,
            async () => {
                closeConfirmModal();
                setRevokingMembership(principal.toString());
                try {
                    const actor = await getActor();
                    const result = await actor.revokeMembership(principal);
                    if ('ok' in result) {
                        showInfo('Success', 'Membership revoked successfully', 'success');
                        fetchData();
                    } else {
                        showInfo('Error', 'Failed to revoke membership: ' + JSON.stringify(result.err), 'error');
                    }
                } catch (e) {
                    showInfo('Error', 'Failed to revoke membership: ' + e.message, 'error');
                }
                setRevokingMembership(null);
            }
        );
    };
    
    // ============================================
    // Styles
    // ============================================
    
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
            background: `linear-gradient(135deg, ${theme.colors.accent}, #FFD700)`,
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
            minWidth: '150px',
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
        select: {
            padding: '10px 14px',
            borderRadius: '8px',
            border: `1px solid ${theme.colors.border}`,
            background: theme.colors.secondaryBg,
            color: theme.colors.primaryText,
            fontSize: '1rem',
            cursor: 'pointer',
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
        tierItem: {
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '16px',
            background: theme.colors.tertiaryBg,
            borderRadius: '10px',
            border: `1px solid ${theme.colors.border}`,
            gap: '1rem',
        },
        tierInfo: {
            flex: 1,
        },
        tierName: {
            fontWeight: '600',
            color: theme.colors.primaryText,
            marginBottom: '4px',
        },
        tierDetails: {
            fontSize: '0.9rem',
            color: theme.colors.mutedText,
            display: 'flex',
            gap: '1rem',
            flexWrap: 'wrap',
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
        badgeExpired: {
            background: `${theme.colors.error}20`,
            color: theme.colors.error,
        },
        label: {
            color: theme.colors.mutedText,
            fontSize: '0.9rem',
            marginBottom: '0.5rem',
            display: 'block',
        },
        infoBox: {
            padding: '1rem',
            background: theme.colors.tertiaryBg,
            borderRadius: '10px',
            marginBottom: '1rem',
        },
        infoLabel: {
            color: theme.colors.mutedText,
            fontSize: '0.85rem',
            marginBottom: '4px',
        },
        infoValue: {
            color: theme.colors.primaryText,
            fontWeight: '500',
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
        emptyState: {
            textAlign: 'center',
            padding: '2rem',
            color: theme.colors.mutedText,
            fontStyle: 'italic',
        },
    };
    
    // ============================================
    // Render
    // ============================================
    
    if (adminLoading || loading) {
        return (
            <div className="page-container" style={{ background: theme.colors.primaryGradient, minHeight: '100vh' }}>
                <Header />
                <main style={styles.container}>
                    <div style={styles.loading}>
                        <FaSpinner className="spin" size={32} />
                        <p style={{ marginTop: '1rem' }}>Loading Sneed Premium Admin...</p>
                    </div>
                </main>
            </div>
        );
    }
    
    if (!isGlobalAdmin && !isPremiumAdmin) {
        return (
            <div className="page-container" style={{ background: theme.colors.primaryGradient, minHeight: '100vh' }}>
                <Header />
                <main style={styles.container}>
                    <div style={styles.error}>
                        <h2>Access Denied</h2>
                        <p>You must be a Sneed Premium admin to access this page.</p>
                    </div>
                </main>
            </div>
        );
    }
    
    const now = BigInt(Date.now()) * 1_000_000n;
    const activeMemberships = memberships.filter(([_, m]) => BigInt(m.expiration) > now);
    
    return (
        <div className="page-container" style={{ background: theme.colors.primaryGradient, minHeight: '100vh' }}>
            <Header />
            <main style={styles.container}>
                <h1 style={styles.title}>
                    <FaCrown style={{ color: '#FFD700' }} />
                    Sneed Premium Admin
                </h1>
                <p style={styles.subtitle}>
                    Manage premium membership tiers, admins, and configuration
                </p>
                
                {error && (
                    <div style={styles.error}>{error}</div>
                )}
                
                {/* Overview */}
                <section style={styles.section}>
                    <h2 style={styles.sectionTitle}>
                        <FaCog style={{ color: theme.colors.accent }} />
                        Configuration Overview
                    </h2>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '1rem' }}>
                        <div style={styles.infoBox}>
                            <div style={styles.infoLabel}>Canister ID</div>
                            <div style={styles.infoValue}>
                                {canisterId ? <PrincipalDisplay principal={canisterId.toString()} /> : 'Loading...'}
                            </div>
                        </div>
                        <div style={styles.infoBox}>
                            <div style={styles.infoLabel}>ICP Ledger</div>
                            <div style={styles.infoValue}>
                                {config ? <PrincipalDisplay principal={config.icpLedgerId.toString()} short /> : 'Loading...'}
                            </div>
                        </div>
                        <div style={styles.infoBox}>
                            <div style={styles.infoLabel}>Sneed Governance</div>
                            <div style={styles.infoValue}>
                                {config ? <PrincipalDisplay principal={config.sneedGovernanceId.toString()} short /> : 'Loading...'}
                            </div>
                        </div>
                        <div style={styles.infoBox}>
                            <div style={styles.infoLabel}>Active Members</div>
                            <div style={{ ...styles.infoValue, color: theme.colors.success, fontSize: '1.5rem' }}>
                                {activeMemberships.length}
                            </div>
                        </div>
                    </div>
                </section>
                
                {/* Payment Recipient */}
                <section style={styles.section}>
                    <h2 style={styles.sectionTitle}>
                        <FaWallet style={{ color: theme.colors.success }} />
                        Payment Recipient
                    </h2>
                    <p style={{ color: theme.colors.mutedText, marginBottom: '1rem' }}>
                        ICP payments will be forwarded to this account.
                        <br />
                        Current recipient: {config?.paymentRecipient ? (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                                <PrincipalDisplay principal={config.paymentRecipient.owner.toString()} />
                            </span>
                        ) : 'Loading...'}
                    </p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                        <input
                            type="text"
                            placeholder="Principal ID"
                            value={newPaymentRecipientPrincipal}
                            onChange={(e) => setNewPaymentRecipientPrincipal(e.target.value)}
                            style={{ ...styles.input, maxWidth: '500px' }}
                        />
                        <input
                            type="text"
                            placeholder="Subaccount (optional, 64-char hex)"
                            value={newPaymentRecipientSubaccount}
                            onChange={(e) => setNewPaymentRecipientSubaccount(e.target.value)}
                            style={{ ...styles.input, maxWidth: '500px' }}
                        />
                        <button
                            onClick={handleSavePaymentRecipient}
                            disabled={savingPaymentRecipient || !newPaymentRecipientPrincipal}
                            style={{
                                ...styles.buttonSuccess,
                                width: 'fit-content',
                                opacity: savingPaymentRecipient || !newPaymentRecipientPrincipal ? 0.5 : 1,
                                cursor: savingPaymentRecipient || !newPaymentRecipientPrincipal ? 'not-allowed' : 'pointer',
                            }}
                        >
                            {savingPaymentRecipient ? <FaSpinner className="spin" /> : <FaSave />}
                            Save Recipient
                        </button>
                    </div>
                </section>
                
                {/* Min Claim Interval */}
                <section style={styles.section}>
                    <h2 style={styles.sectionTitle}>
                        <FaClock style={{ color: theme.colors.warning }} />
                        Voting Power Claim Settings
                    </h2>
                    <p style={{ color: theme.colors.mutedText, marginBottom: '1rem' }}>
                        Minimum time between VP-based membership claims (prevents spam).
                        <br />
                        Current interval: <strong>{config ? formatDuration(config.minClaimIntervalNs) : 'Loading...'}</strong>
                    </p>
                    <div style={styles.row}>
                        <input
                            type="number"
                            min="0"
                            step="1"
                            placeholder="Interval"
                            value={newMinClaimInterval}
                            onChange={(e) => setNewMinClaimInterval(e.target.value)}
                            style={styles.inputSmall}
                        />
                        <select
                            value={newMinClaimIntervalUnit}
                            onChange={(e) => setNewMinClaimIntervalUnit(e.target.value)}
                            style={styles.select}
                        >
                            <option value="hours">Hours</option>
                            <option value="days">Days</option>
                            <option value="weeks">Weeks</option>
                        </select>
                        <button
                            onClick={handleSaveMinClaimInterval}
                            disabled={savingMinClaimInterval || !newMinClaimInterval}
                            style={{
                                ...styles.button,
                                opacity: savingMinClaimInterval || !newMinClaimInterval ? 0.5 : 1,
                                cursor: savingMinClaimInterval || !newMinClaimInterval ? 'not-allowed' : 'pointer',
                            }}
                        >
                            {savingMinClaimInterval ? <FaSpinner className="spin" /> : <FaSave />}
                            Save
                        </button>
                    </div>
                </section>
                
                {/* ICP Tiers */}
                <section style={styles.section}>
                    <h2 style={styles.sectionTitle}>
                        <FaCoins style={{ color: '#FFD700' }} />
                        ICP Payment Tiers
                    </h2>
                    <p style={{ color: theme.colors.mutedText, marginBottom: '1rem' }}>
                        Configure how much membership duration different ICP amounts provide.
                    </p>
                    
                    {icpTiers.length > 0 ? (
                        <div style={styles.list}>
                            {icpTiers.map((tier, index) => (
                                <div key={index} style={styles.tierItem}>
                                    <div style={styles.tierInfo}>
                                        <div style={styles.tierName}>{tier.name}</div>
                                        <div style={styles.tierDetails}>
                                            <span><FaCoins style={{ marginRight: '4px' }} />{formatIcp(tier.amountE8s)}</span>
                                            <span>→</span>
                                            <span><FaClock style={{ marginRight: '4px' }} />{formatDuration(tier.durationNs)}</span>
                                        </div>
                                    </div>
                                    <span style={{ ...styles.badge, ...(tier.active ? styles.badgeActive : styles.badgeExpired) }}>
                                        {tier.active ? <><FaCheckCircle style={{ marginRight: '4px' }} />Active</> : <><FaTimesCircle style={{ marginRight: '4px' }} />Inactive</>}
                                    </span>
                                    <button
                                        onClick={() => handleRemoveIcpTier(index)}
                                        disabled={removingIcpTier === index}
                                        style={{
                                            ...styles.buttonDanger,
                                            opacity: removingIcpTier === index ? 0.5 : 1,
                                            cursor: removingIcpTier === index ? 'not-allowed' : 'pointer',
                                        }}
                                    >
                                        {removingIcpTier === index ? <FaSpinner className="spin" /> : <FaTrash />}
                                    </button>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div style={styles.emptyState}>No ICP tiers configured yet.</div>
                    )}
                    
                    <div style={{ marginTop: '1.5rem', padding: '1rem', background: theme.colors.tertiaryBg, borderRadius: '10px' }}>
                        <h3 style={{ marginBottom: '1rem', fontSize: '1.1rem', color: theme.colors.primaryText }}>
                            <FaPlus style={{ marginRight: '8px' }} />
                            Add ICP Tier
                        </h3>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                            <input
                                type="text"
                                placeholder="Tier name (e.g., '1 Month Premium')"
                                value={newIcpTierName}
                                onChange={(e) => setNewIcpTierName(e.target.value)}
                                style={styles.input}
                            />
                            <div style={styles.row}>
                                <input
                                    type="number"
                                    step="0.0001"
                                    min="0"
                                    placeholder="ICP amount"
                                    value={newIcpTierAmount}
                                    onChange={(e) => setNewIcpTierAmount(e.target.value)}
                                    style={styles.inputSmall}
                                />
                                <span style={{ color: theme.colors.mutedText }}>ICP →</span>
                                <input
                                    type="number"
                                    step="1"
                                    min="1"
                                    placeholder="Duration"
                                    value={newIcpTierDuration}
                                    onChange={(e) => setNewIcpTierDuration(e.target.value)}
                                    style={styles.inputSmall}
                                />
                                <select
                                    value={newIcpTierDurationUnit}
                                    onChange={(e) => setNewIcpTierDurationUnit(e.target.value)}
                                    style={styles.select}
                                >
                                    <option value="days">Days</option>
                                    <option value="weeks">Weeks</option>
                                    <option value="months">Months</option>
                                    <option value="years">Years</option>
                                </select>
                            </div>
                            <button
                                onClick={handleAddIcpTier}
                                disabled={addingIcpTier || !newIcpTierName.trim() || !newIcpTierAmount || !newIcpTierDuration}
                                style={{
                                    ...styles.buttonSuccess,
                                    width: 'fit-content',
                                    opacity: addingIcpTier || !newIcpTierName.trim() || !newIcpTierAmount || !newIcpTierDuration ? 0.5 : 1,
                                    cursor: addingIcpTier || !newIcpTierName.trim() || !newIcpTierAmount || !newIcpTierDuration ? 'not-allowed' : 'pointer',
                                }}
                            >
                                {addingIcpTier ? <FaSpinner className="spin" /> : <FaPlus />}
                                Add Tier
                            </button>
                        </div>
                    </div>
                </section>
                
                {/* VP Tiers */}
                <section style={styles.section}>
                    <h2 style={styles.sectionTitle}>
                        <FaVoteYea style={{ color: theme.colors.info || theme.colors.accent }} />
                        Voting Power Tiers
                    </h2>
                    <p style={{ color: theme.colors.mutedText, marginBottom: '1rem' }}>
                        Configure how much membership duration different Sneed staking levels grant.
                    </p>
                    
                    {vpTiers.length > 0 ? (
                        <div style={styles.list}>
                            {vpTiers.map((tier, index) => (
                                <div key={index} style={styles.tierItem}>
                                    <div style={styles.tierInfo}>
                                        <div style={styles.tierName}>{tier.name}</div>
                                        <div style={styles.tierDetails}>
                                            <span><FaVoteYea style={{ marginRight: '4px' }} />≥ {formatVotingPower(tier.minVotingPowerE8s)}</span>
                                            <span>→</span>
                                            <span><FaClock style={{ marginRight: '4px' }} />{formatDuration(tier.durationNs)}</span>
                                        </div>
                                    </div>
                                    <span style={{ ...styles.badge, ...(tier.active ? styles.badgeActive : styles.badgeExpired) }}>
                                        {tier.active ? <><FaCheckCircle style={{ marginRight: '4px' }} />Active</> : <><FaTimesCircle style={{ marginRight: '4px' }} />Inactive</>}
                                    </span>
                                    <button
                                        onClick={() => handleRemoveVpTier(index)}
                                        disabled={removingVpTier === index}
                                        style={{
                                            ...styles.buttonDanger,
                                            opacity: removingVpTier === index ? 0.5 : 1,
                                            cursor: removingVpTier === index ? 'not-allowed' : 'pointer',
                                        }}
                                    >
                                        {removingVpTier === index ? <FaSpinner className="spin" /> : <FaTrash />}
                                    </button>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div style={styles.emptyState}>No voting power tiers configured yet.</div>
                    )}
                    
                    <div style={{ marginTop: '1.5rem', padding: '1rem', background: theme.colors.tertiaryBg, borderRadius: '10px' }}>
                        <h3 style={{ marginBottom: '1rem', fontSize: '1.1rem', color: theme.colors.primaryText }}>
                            <FaPlus style={{ marginRight: '8px' }} />
                            Add Voting Power Tier
                        </h3>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                            <input
                                type="text"
                                placeholder="Tier name (e.g., 'Sneed Staker')"
                                value={newVpTierName}
                                onChange={(e) => setNewVpTierName(e.target.value)}
                                style={styles.input}
                            />
                            <div style={styles.row}>
                                <input
                                    type="number"
                                    step="1"
                                    min="0"
                                    placeholder="Min VP (in SNEED)"
                                    value={newVpTierMinVp}
                                    onChange={(e) => setNewVpTierMinVp(e.target.value)}
                                    style={styles.inputSmall}
                                />
                                <span style={{ color: theme.colors.mutedText }}>VP →</span>
                                <input
                                    type="number"
                                    step="1"
                                    min="1"
                                    placeholder="Duration"
                                    value={newVpTierDuration}
                                    onChange={(e) => setNewVpTierDuration(e.target.value)}
                                    style={styles.inputSmall}
                                />
                                <select
                                    value={newVpTierDurationUnit}
                                    onChange={(e) => setNewVpTierDurationUnit(e.target.value)}
                                    style={styles.select}
                                >
                                    <option value="days">Days</option>
                                    <option value="weeks">Weeks</option>
                                    <option value="months">Months</option>
                                    <option value="years">Years</option>
                                </select>
                            </div>
                            <button
                                onClick={handleAddVpTier}
                                disabled={addingVpTier || !newVpTierName.trim() || !newVpTierMinVp || !newVpTierDuration}
                                style={{
                                    ...styles.buttonSuccess,
                                    width: 'fit-content',
                                    opacity: addingVpTier || !newVpTierName.trim() || !newVpTierMinVp || !newVpTierDuration ? 0.5 : 1,
                                    cursor: addingVpTier || !newVpTierName.trim() || !newVpTierMinVp || !newVpTierDuration ? 'not-allowed' : 'pointer',
                                }}
                            >
                                {addingVpTier ? <FaSpinner className="spin" /> : <FaPlus />}
                                Add Tier
                            </button>
                        </div>
                    </div>
                </section>
                
                {/* Admin Management */}
                <section style={styles.section}>
                    <h2 style={styles.sectionTitle}>
                        <FaUserShield style={{ color: theme.colors.accent }} />
                        Premium Admins
                    </h2>
                    <p style={{ color: theme.colors.mutedText, marginBottom: '1rem' }}>
                        Admins can modify premium settings, tiers, and manage memberships.
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
                
                {/* Manual Membership Grant */}
                <section style={styles.section}>
                    <h2 style={styles.sectionTitle}>
                        <FaCrown style={{ color: '#FFD700' }} />
                        Grant Membership Manually
                    </h2>
                    <p style={{ color: theme.colors.mutedText, marginBottom: '1rem' }}>
                        Grant or extend premium membership for a principal. Duration is added to any existing membership.
                    </p>
                    
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                        <input
                            type="text"
                            placeholder="Principal ID"
                            value={manualMemberPrincipal}
                            onChange={(e) => setManualMemberPrincipal(e.target.value)}
                            style={{ ...styles.input, maxWidth: '500px' }}
                        />
                        <div style={styles.row}>
                            <input
                                type="number"
                                step="1"
                                min="1"
                                placeholder="Duration"
                                value={manualMemberDuration}
                                onChange={(e) => setManualMemberDuration(e.target.value)}
                                style={styles.inputSmall}
                            />
                            <select
                                value={manualMemberDurationUnit}
                                onChange={(e) => setManualMemberDurationUnit(e.target.value)}
                                style={styles.select}
                            >
                                <option value="days">Days</option>
                                <option value="weeks">Weeks</option>
                                <option value="months">Months</option>
                                <option value="years">Years</option>
                            </select>
                            <button
                                onClick={handleGrantMembership}
                                disabled={grantingMembership || !manualMemberPrincipal || !manualMemberDuration}
                                style={{
                                    ...styles.buttonSuccess,
                                    opacity: grantingMembership || !manualMemberPrincipal || !manualMemberDuration ? 0.5 : 1,
                                    cursor: grantingMembership || !manualMemberPrincipal || !manualMemberDuration ? 'not-allowed' : 'pointer',
                                }}
                            >
                                {grantingMembership ? <FaSpinner className="spin" /> : <FaCrown />}
                                Grant Membership
                            </button>
                        </div>
                    </div>
                </section>
                
                {/* Current Members */}
                <section style={styles.section}>
                    <h2 style={styles.sectionTitle}>
                        <FaUsers style={{ color: theme.colors.success }} />
                        Current Members ({memberships.length})
                    </h2>
                    <p style={{ color: theme.colors.mutedText, marginBottom: '1rem' }}>
                        All registered premium memberships.
                    </p>
                    
                    {memberships.length > 0 ? (
                        <div style={styles.list}>
                            {memberships.map(([principal, membership], index) => {
                                const isActive = BigInt(membership.expiration) > now;
                                return (
                                    <div key={index} style={styles.tierItem}>
                                        <div style={styles.tierInfo}>
                                            <div style={styles.tierName}>
                                                <PrincipalDisplay principal={principal.toString()} />
                                            </div>
                                            <div style={styles.tierDetails}>
                                                <span>
                                                    {isActive ? (
                                                        <>Expires: {formatTimestamp(membership.expiration)} ({getTimeRemaining(membership.expiration)})</>
                                                    ) : (
                                                        <>Expired: {formatTimestamp(membership.expiration)}</>
                                                    )}
                                                </span>
                                            </div>
                                        </div>
                                        <span style={{ ...styles.badge, ...(isActive ? styles.badgeActive : styles.badgeExpired) }}>
                                            {isActive ? <><FaCheckCircle style={{ marginRight: '4px' }} />Active</> : <><FaTimesCircle style={{ marginRight: '4px' }} />Expired</>}
                                        </span>
                                        <button
                                            onClick={() => handleRevokeMembership(principal)}
                                            disabled={revokingMembership === principal.toString()}
                                            style={{
                                                ...styles.buttonDanger,
                                                opacity: revokingMembership === principal.toString() ? 0.5 : 1,
                                                cursor: revokingMembership === principal.toString() ? 'not-allowed' : 'pointer',
                                            }}
                                        >
                                            {revokingMembership === principal.toString() ? <FaSpinner className="spin" /> : <FaTrash />}
                                        </button>
                                    </div>
                                );
                            })}
                        </div>
                    ) : (
                        <div style={styles.emptyState}>No members registered yet.</div>
                    )}
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

