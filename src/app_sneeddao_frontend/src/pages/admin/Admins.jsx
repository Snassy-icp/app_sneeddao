import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../AuthContext';
import { useAdminCheck } from '../../hooks/useAdminCheck';
import { useTheme } from '../../contexts/ThemeContext';
import Header from '../../components/Header';
import { Principal } from '@dfinity/principal';
import InfoModal from '../../components/InfoModal';
import ConfirmationModal from '../../ConfirmationModal';
import { PrincipalDisplay } from '../../utils/PrincipalUtils';
import { 
    FaUserShield, FaSpinner, FaSync, FaPlus, FaTrash, 
    FaChevronDown, FaChevronUp, FaCheck, FaTimes, FaDatabase,
    FaLock, FaComments, FaEnvelope, FaCrown, FaExchangeAlt, FaCopy,
    FaBrain, FaMinus, FaGift
} from 'react-icons/fa';

// Import actors
import { createActor as createBackendActor, canisterId as backendCanisterId } from 'declarations/app_sneeddao_backend';
import { createActor as createSneedLockActor, canisterId as sneedLockCanisterId } from 'declarations/sneed_lock';
import { createActor as createForumActor, canisterId as forumCanisterId } from 'declarations/sneed_sns_forum';
import { createActor as createSmsActor, canisterId as smsCanisterId } from 'declarations/sneed_sms';
import { createActor as createPremiumActor, canisterId as premiumCanisterId } from 'declarations/sneed_premium';
import { createActor as createSneedexActorDecl, canisterId as sneedexCanisterId } from 'declarations/sneedex';
import { createActor as createFactoryActor, canisterId as factoryCanisterId } from 'declarations/sneedapp';
import { createActor as createRllActor, canisterId as rllCanisterId } from 'declarations/rll';

const getHost = () => process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging' ? 'https://icp0.io' : 'http://localhost:4943';

// Canister configurations
const CANISTERS = {
    backend: {
        id: backendCanisterId,
        name: 'Backend',
        icon: FaDatabase,
        color: '#3b82f6',
        getActor: (identity) => createBackendActor(backendCanisterId, { agentOptions: { identity, host: getHost() } }),
        getAdmins: async (actor) => await actor.get_admins(),
        addAdmin: async (actor, principal) => await actor.add_admin(principal),
        removeAdmin: async (actor, principal) => await actor.remove_admin(principal),
        formatAdmins: (admins) => admins.map(p => ({ principal: p })),
    },
    sneed_lock: {
        id: sneedLockCanisterId,
        name: 'Sneed Lock',
        icon: FaLock,
        color: '#f59e0b',
        getActor: (identity) => createSneedLockActor(sneedLockCanisterId, { agentOptions: { identity, host: getHost() } }),
        getAdmins: async (actor) => await actor.get_admin_list(),
        addAdmin: async (actor, principal) => {
            const result = await actor.admin_add_admin(principal);
            if ('Err' in result) throw new Error(result.Err);
            return result;
        },
        removeAdmin: async (actor, principal) => {
            const result = await actor.admin_remove_admin(principal);
            if ('Err' in result) throw new Error(result.Err);
            return result;
        },
        formatAdmins: (admins) => admins.map(p => ({ principal: p })),
    },
    sneed_sns_forum: {
        id: forumCanisterId,
        name: 'Forum',
        icon: FaComments,
        color: '#22c55e',
        getActor: (identity) => createForumActor(forumCanisterId, { agentOptions: { identity, host: getHost() } }),
        getAdmins: async (actor) => await actor.get_admins(),
        addAdmin: async (actor, principal) => {
            const result = await actor.add_admin(principal);
            if ('err' in result) throw new Error(JSON.stringify(result.err));
            return result;
        },
        removeAdmin: async (actor, principal) => {
            const result = await actor.remove_admin(principal);
            if ('err' in result) throw new Error(JSON.stringify(result.err));
            return result;
        },
        formatAdmins: (admins) => admins.map(a => ({ principal: a.principal, addedAt: a.addedAt })),
    },
    sneed_sms: {
        id: smsCanisterId,
        name: 'SMS',
        icon: FaEnvelope,
        color: '#ec4899',
        getActor: (identity) => createSmsActor(smsCanisterId, { agentOptions: { identity, host: getHost() } }),
        getAdmins: async (actor) => await actor.get_admins(),
        addAdmin: async (actor, principal) => {
            const result = await actor.add_admin(principal);
            if ('err' in result) throw new Error(JSON.stringify(result.err));
            return result;
        },
        removeAdmin: async (actor, principal) => {
            const result = await actor.remove_admin(principal);
            if ('err' in result) throw new Error(JSON.stringify(result.err));
            return result;
        },
        formatAdmins: (admins) => admins.map(a => ({ principal: a.principal, addedAt: a.addedAt })),
    },
    sneed_premium: {
        id: premiumCanisterId,
        name: 'Premium',
        icon: FaCrown,
        color: '#a855f7',
        getActor: (identity) => createPremiumActor(premiumCanisterId, { agentOptions: { identity, host: getHost() } }),
        getAdmins: async (actor) => {
            const config = await actor.getConfig();
            return config.admins || [];
        },
        addAdmin: async (actor, principal) => {
            const result = await actor.addAdmin(principal);
            if ('err' in result) throw new Error(JSON.stringify(result.err));
            return result;
        },
        removeAdmin: async (actor, principal) => {
            const result = await actor.removeAdmin(principal);
            if ('err' in result) throw new Error(JSON.stringify(result.err));
            return result;
        },
        formatAdmins: (admins) => admins.map(p => ({ principal: p })),
    },
    sneedex: {
        id: sneedexCanisterId,
        name: 'Sneedex',
        icon: FaExchangeAlt,
        color: '#06b6d4',
        getActor: (identity) => createSneedexActorDecl(sneedexCanisterId, { agentOptions: { identity, host: getHost() } }),
        getAdmins: async (actor) => {
            const config = await actor.getConfig();
            return config.admins || [];
        },
        addAdmin: async (actor, principal) => {
            const result = await actor.addAdmin(principal);
            if ('err' in result) throw new Error(JSON.stringify(result.err));
            return result;
        },
        removeAdmin: async (actor, principal) => {
            const result = await actor.removeAdmin(principal);
            if ('err' in result) throw new Error(JSON.stringify(result.err));
            return result;
        },
        formatAdmins: (admins) => admins.map(p => ({ principal: p })),
    },
    neuron_manager_factory: {
        id: factoryCanisterId,
        name: 'Staking Bot Factory',
        icon: FaBrain,
        color: '#8b5cf6',
        getActor: (identity) => createFactoryActor(factoryCanisterId, { agentOptions: { identity, host: getHost() } }),
        getAdmins: async (actor) => await actor.getAdmins(),
        addAdmin: async (actor, principal) => await actor.addAdmin(principal),
        removeAdmin: async (actor, principal) => await actor.removeAdmin(principal),
        formatAdmins: (admins) => admins.map(p => ({ principal: p })),
    },
    rll: {
        id: rllCanisterId,
        name: 'Rewards (RLL)',
        icon: FaGift,
        color: '#d4af37',
        getActor: (identity) => createRllActor(rllCanisterId, { agentOptions: { identity, host: getHost() } }),
        getAdmins: async (actor) => await actor.list_admins(),
        addAdmin: async (actor, principal) => {
            const result = await actor.add_admin(principal);
            if ('err' in result) throw new Error(result.err);
            return result;
        },
        removeAdmin: async (actor, principal) => {
            const result = await actor.remove_admin(principal);
            if ('err' in result) throw new Error(result.err);
            return result;
        },
        formatAdmins: (admins) => admins.map(p => ({ principal: p })),
    },
};

export default function AdminsAdmin() {
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
    
    // State for each canister's admin list
    const [canisterStates, setCanisterStates] = useState(
        Object.fromEntries(
            Object.keys(CANISTERS).map(key => [key, {
                admins: [],
                loading: true,
                error: null,
                expanded: true,
            }])
        )
    );
    
    // Input state for adding new admin per canister
    const [newAdminInputs, setNewAdminInputs] = useState(
        Object.fromEntries(Object.keys(CANISTERS).map(key => [key, '']))
    );
    
    // Loading states for add/remove operations
    const [addingAdmin, setAddingAdmin] = useState({}); // canisterKey -> boolean
    const [removingAdmin, setRemovingAdmin] = useState({}); // canisterKey:principal -> boolean
    
    // Bulk operations state
    const [bulkInput, setBulkInput] = useState('');
    const [bulkExpanded, setBulkExpanded] = useState(true);
    const [bulkAdding, setBulkAdding] = useState(false);
    const [bulkRemoving, setBulkRemoving] = useState(false);
    const [selectedCanisters, setSelectedCanisters] = useState(
        Object.fromEntries(Object.keys(CANISTERS).map(key => [key, true]))
    );
    
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
    
    // Copy to clipboard
    const copyToClipboard = async (text) => {
        try {
            await navigator.clipboard.writeText(text);
            showInfo('Copied', 'Copied to clipboard', 'success');
        } catch (err) {
            console.error('Failed to copy:', err);
        }
    };
    
    // Fetch admins for a single canister
    const fetchCanisterAdmins = useCallback(async (canisterKey) => {
        if (!identity) return;
        
        const canister = CANISTERS[canisterKey];
        
        setCanisterStates(prev => ({
            ...prev,
            [canisterKey]: { ...prev[canisterKey], loading: true, error: null }
        }));
        
        try {
            const actor = canister.getActor(identity);
            const admins = await canister.getAdmins(actor);
            const formattedAdmins = canister.formatAdmins(admins);
            
            setCanisterStates(prev => ({
                ...prev,
                [canisterKey]: { ...prev[canisterKey], admins: formattedAdmins, loading: false }
            }));
        } catch (err) {
            console.error(`Error fetching ${canisterKey} admins:`, err);
            setCanisterStates(prev => ({
                ...prev,
                [canisterKey]: { ...prev[canisterKey], loading: false, error: err.message }
            }));
        }
    }, [identity]);
    
    // Fetch all canister admins
    const fetchAllAdmins = useCallback(async () => {
        setLoading(true);
        await Promise.all(Object.keys(CANISTERS).map(key => fetchCanisterAdmins(key)));
        setLoading(false);
    }, [fetchCanisterAdmins]);
    
    // Initial load
    useEffect(() => {
        if (isAuthenticated && identity && isGlobalAdmin) {
            fetchAllAdmins();
        }
    }, [isAuthenticated, identity, isGlobalAdmin, fetchAllAdmins]);
    
    // Add admin to a canister
    const handleAddAdmin = async (canisterKey) => {
        const principalText = newAdminInputs[canisterKey]?.trim();
        if (!principalText) {
            showInfo('Error', 'Please enter a principal ID', 'error');
            return;
        }
        
        let principal;
        try {
            principal = Principal.fromText(principalText);
        } catch (err) {
            showInfo('Error', 'Invalid principal ID', 'error');
            return;
        }
        
        const canister = CANISTERS[canisterKey];
        
        setAddingAdmin(prev => ({ ...prev, [canisterKey]: true }));
        
        try {
            const actor = canister.getActor(identity);
            await canister.addAdmin(actor, principal);
            
            // Clear input and refresh
            setNewAdminInputs(prev => ({ ...prev, [canisterKey]: '' }));
            await fetchCanisterAdmins(canisterKey);
            
            showInfo('Success', `Admin added to ${canister.name}`, 'success');
        } catch (err) {
            console.error(`Error adding admin to ${canisterKey}:`, err);
            showInfo('Error', `Failed to add admin: ${err.message}`, 'error');
        } finally {
            setAddingAdmin(prev => ({ ...prev, [canisterKey]: false }));
        }
    };
    
    // Remove admin from a canister
    const handleRemoveAdmin = async (canisterKey, principalText) => {
        const canister = CANISTERS[canisterKey];
        
        showConfirm(
            'Remove Admin',
            `Are you sure you want to remove this admin from ${canister.name}?`,
            async () => {
                closeConfirmModal();
                
                const removeKey = `${canisterKey}:${principalText}`;
                setRemovingAdmin(prev => ({ ...prev, [removeKey]: true }));
                
                try {
                    const principal = Principal.fromText(principalText);
                    const actor = canister.getActor(identity);
                    await canister.removeAdmin(actor, principal);
                    
                    await fetchCanisterAdmins(canisterKey);
                    showInfo('Success', `Admin removed from ${canister.name}`, 'success');
                } catch (err) {
                    console.error(`Error removing admin from ${canisterKey}:`, err);
                    showInfo('Error', `Failed to remove admin: ${err.message}`, 'error');
                } finally {
                    setRemovingAdmin(prev => ({ ...prev, [removeKey]: false }));
                }
            }
        );
    };
    
    // Select all / deselect all canisters
    const selectAllCanisters = () => {
        setSelectedCanisters(Object.fromEntries(Object.keys(CANISTERS).map(key => [key, true])));
    };
    
    const deselectAllCanisters = () => {
        setSelectedCanisters(Object.fromEntries(Object.keys(CANISTERS).map(key => [key, false])));
    };
    
    // Bulk add admin to selected canisters
    const handleBulkAddAdmin = async () => {
        const principalText = bulkInput?.trim();
        if (!principalText) {
            showInfo('Error', 'Please enter a principal ID', 'error');
            return;
        }
        
        let principal;
        try {
            principal = Principal.fromText(principalText);
        } catch (err) {
            showInfo('Error', 'Invalid principal ID', 'error');
            return;
        }
        
        const selectedKeys = Object.entries(selectedCanisters)
            .filter(([_, selected]) => selected)
            .map(([key]) => key);
        
        if (selectedKeys.length === 0) {
            showInfo('Error', 'Please select at least one canister', 'error');
            return;
        }
        
        setBulkAdding(true);
        
        const results = { success: [], failed: [] };
        
        for (const canisterKey of selectedKeys) {
            const canister = CANISTERS[canisterKey];
            try {
                const actor = canister.getActor(identity);
                await canister.addAdmin(actor, principal);
                results.success.push(canister.name);
            } catch (err) {
                console.error(`Error adding admin to ${canisterKey}:`, err);
                results.failed.push({ name: canister.name, error: err.message });
            }
        }
        
        setBulkAdding(false);
        setBulkInput('');
        
        // Refresh all affected canisters
        await Promise.all(selectedKeys.map(key => fetchCanisterAdmins(key)));
        
        if (results.failed.length === 0) {
            showInfo('Success', `Admin added to: ${results.success.join(', ')}`, 'success');
        } else if (results.success.length === 0) {
            showInfo('Error', `Failed to add admin to all canisters`, 'error');
        } else {
            showInfo('Partial Success', 
                `Added to: ${results.success.join(', ')}\n\nFailed: ${results.failed.map(f => f.name).join(', ')}`, 
                'warning'
            );
        }
    };
    
    // Bulk remove admin from selected canisters
    const handleBulkRemoveAdmin = async () => {
        const principalText = bulkInput?.trim();
        if (!principalText) {
            showInfo('Error', 'Please enter a principal ID', 'error');
            return;
        }
        
        let principal;
        try {
            principal = Principal.fromText(principalText);
        } catch (err) {
            showInfo('Error', 'Invalid principal ID', 'error');
            return;
        }
        
        const selectedKeys = Object.entries(selectedCanisters)
            .filter(([_, selected]) => selected)
            .map(([key]) => key);
        
        if (selectedKeys.length === 0) {
            showInfo('Error', 'Please select at least one canister', 'error');
            return;
        }
        
        showConfirm(
            'Remove Admin from All Selected',
            `Are you sure you want to remove this admin from ${selectedKeys.length} canister(s)?\n\nCanisters: ${selectedKeys.map(k => CANISTERS[k].name).join(', ')}`,
            async () => {
                closeConfirmModal();
                setBulkRemoving(true);
                
                const results = { success: [], failed: [] };
                
                for (const canisterKey of selectedKeys) {
                    const canister = CANISTERS[canisterKey];
                    try {
                        const actor = canister.getActor(identity);
                        await canister.removeAdmin(actor, principal);
                        results.success.push(canister.name);
                    } catch (err) {
                        console.error(`Error removing admin from ${canisterKey}:`, err);
                        results.failed.push({ name: canister.name, error: err.message });
                    }
                }
                
                setBulkRemoving(false);
                setBulkInput('');
                
                // Refresh all affected canisters
                await Promise.all(selectedKeys.map(key => fetchCanisterAdmins(key)));
                
                if (results.failed.length === 0) {
                    showInfo('Success', `Admin removed from: ${results.success.join(', ')}`, 'success');
                } else if (results.success.length === 0) {
                    showInfo('Error', `Failed to remove admin from all canisters`, 'error');
                } else {
                    showInfo('Partial Success', 
                        `Removed from: ${results.success.join(', ')}\n\nFailed: ${results.failed.map(f => f.name).join(', ')}`, 
                        'warning'
                    );
                }
            }
        );
    };
    
    // Toggle canister expansion
    const toggleCanisterExpanded = (canisterKey) => {
        setCanisterStates(prev => ({
            ...prev,
            [canisterKey]: { ...prev[canisterKey], expanded: !prev[canisterKey].expanded }
        }));
    };
    
    // Styles
    const styles = {
        container: {
            minHeight: '100vh',
            background: theme.colors.primaryGradient,
            color: theme.colors.primaryText,
        },
        main: {
            maxWidth: '1200px',
            margin: '0 auto',
            padding: '20px',
        },
        header: {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: '24px',
            flexWrap: 'wrap',
            gap: '16px',
        },
        title: {
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            fontSize: '1.8rem',
            fontWeight: '600',
            margin: 0,
        },
        refreshButton: {
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '10px 16px',
            background: theme.colors.accent,
            color: '#fff',
            border: 'none',
            borderRadius: '8px',
            cursor: 'pointer',
            fontSize: '14px',
            fontWeight: '500',
        },
        card: {
            background: theme.colors.secondaryBg,
            borderRadius: '12px',
            padding: '20px',
            marginBottom: '16px',
            border: `1px solid ${theme.colors.border}`,
        },
        cardHeader: {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            cursor: 'pointer',
            userSelect: 'none',
        },
        cardTitle: {
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            fontSize: '1.1rem',
            fontWeight: '600',
            margin: 0,
        },
        cardContent: {
            marginTop: '16px',
        },
        adminList: {
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
        },
        adminItem: {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px',
            background: theme.colors.tertiaryBg || 'rgba(0,0,0,0.1)',
            borderRadius: '8px',
            gap: '12px',
        },
        adminPrincipal: {
            fontFamily: 'monospace',
            fontSize: '0.85rem',
            flex: 1,
        },
        addAdminRow: {
            display: 'flex',
            gap: '8px',
            marginTop: '12px',
        },
        input: {
            flex: 1,
            padding: '10px 14px',
            background: theme.colors.tertiaryBg || 'rgba(0,0,0,0.1)',
            border: `1px solid ${theme.colors.border}`,
            borderRadius: '8px',
            color: theme.colors.primaryText,
            fontSize: '14px',
            fontFamily: 'monospace',
        },
        addButton: {
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '10px 16px',
            background: theme.colors.success || '#22c55e',
            color: '#fff',
            border: 'none',
            borderRadius: '8px',
            cursor: 'pointer',
            fontSize: '14px',
            fontWeight: '500',
            whiteSpace: 'nowrap',
        },
        removeButton: {
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            padding: '6px 12px',
            background: theme.colors.error || '#ef4444',
            color: '#fff',
            border: 'none',
            borderRadius: '6px',
            cursor: 'pointer',
            fontSize: '12px',
        },
        badge: {
            display: 'inline-flex',
            alignItems: 'center',
            gap: '4px',
            padding: '4px 10px',
            borderRadius: '12px',
            fontSize: '0.8rem',
            fontWeight: '500',
        },
        loadingSpinner: {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '40px',
        },
        error: {
            color: theme.colors.error || '#ef4444',
            padding: '12px',
            background: `${theme.colors.error || '#ef4444'}15`,
            borderRadius: '8px',
            fontSize: '14px',
        },
        bulkAddCard: {
            background: `linear-gradient(135deg, ${theme.colors.accent}15, ${theme.colors.accent}05)`,
            borderColor: theme.colors.accent,
        },
        checkboxLabel: {
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            cursor: 'pointer',
            padding: '8px 12px',
            borderRadius: '8px',
            background: theme.colors.tertiaryBg || 'rgba(0,0,0,0.1)',
        },
        checkboxGrid: {
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
            gap: '8px',
            marginBottom: '12px',
        },
    };
    
    if (adminLoading) {
        return (
            <div style={styles.container}>
                <Header />
                <main style={styles.main}>
                    <div style={styles.loadingSpinner}>
                        <FaSpinner className="spin" size={32} />
                    </div>
                </main>
            </div>
        );
    }
    
    if (!isGlobalAdmin) {
        return (
            <div style={styles.container}>
                <Header />
                <main style={styles.main}>
                    <div style={styles.error}>
                        You do not have permission to view this page.
                    </div>
                </main>
            </div>
        );
    }
    
    return (
        <div style={styles.container}>
            <Header />
            <main style={styles.main}>
                <div style={styles.header}>
                    <h1 style={styles.title}>
                        <FaUserShield style={{ color: theme.colors.accent }} />
                        Admin Management
                    </h1>
                    <button
                        style={styles.refreshButton}
                        onClick={fetchAllAdmins}
                        disabled={loading}
                    >
                        {loading ? (
                            <FaSpinner className="spin" />
                        ) : (
                            <FaSync />
                        )}
                        Refresh All
                    </button>
                </div>
                
                {error && (
                    <div style={{ ...styles.error, marginBottom: '16px' }}>
                        {error}
                    </div>
                )}
                
                {/* Bulk Operations Section */}
                <div style={{ ...styles.card, ...styles.bulkAddCard }}>
                    <div
                        style={styles.cardHeader}
                        onClick={() => setBulkExpanded(!bulkExpanded)}
                    >
                        <h2 style={styles.cardTitle}>
                            <FaUserShield style={{ color: theme.colors.accent }} />
                            Bulk Admin Operations
                        </h2>
                        {bulkExpanded ? <FaChevronUp /> : <FaChevronDown />}
                    </div>
                    
                    {bulkExpanded && (
                        <div style={styles.cardContent}>
                            <p style={{ color: theme.colors.secondaryText, marginBottom: '12px', fontSize: '14px' }}>
                                Add or remove an admin to/from multiple canisters at once. Select which canisters to affect, then enter the principal ID.
                            </p>
                            
                            {/* Select All / Deselect All buttons */}
                            <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
                                <button
                                    onClick={selectAllCanisters}
                                    style={{
                                        padding: '6px 12px',
                                        background: theme.colors.accent,
                                        color: '#fff',
                                        border: 'none',
                                        borderRadius: '6px',
                                        cursor: 'pointer',
                                        fontSize: '12px',
                                        fontWeight: '500',
                                    }}
                                >
                                    <FaCheck style={{ marginRight: '4px' }} />
                                    Select All
                                </button>
                                <button
                                    onClick={deselectAllCanisters}
                                    style={{
                                        padding: '6px 12px',
                                        background: theme.colors.secondaryBg,
                                        color: theme.colors.primaryText,
                                        border: `1px solid ${theme.colors.border}`,
                                        borderRadius: '6px',
                                        cursor: 'pointer',
                                        fontSize: '12px',
                                        fontWeight: '500',
                                    }}
                                >
                                    <FaTimes style={{ marginRight: '4px' }} />
                                    Deselect All
                                </button>
                                <span style={{ 
                                    marginLeft: 'auto', 
                                    color: theme.colors.mutedText, 
                                    fontSize: '12px',
                                    display: 'flex',
                                    alignItems: 'center'
                                }}>
                                    {Object.values(selectedCanisters).filter(Boolean).length} of {Object.keys(CANISTERS).length} selected
                                </span>
                            </div>
                            
                            <div style={styles.checkboxGrid}>
                                {Object.entries(CANISTERS).map(([key, canister]) => {
                                    const Icon = canister.icon;
                                    return (
                                        <label key={key} style={{
                                            ...styles.checkboxLabel,
                                            border: selectedCanisters[key] ? `1px solid ${canister.color}` : `1px solid transparent`,
                                        }}>
                                            <input
                                                type="checkbox"
                                                checked={selectedCanisters[key]}
                                                onChange={(e) => setSelectedCanisters(prev => ({
                                                    ...prev,
                                                    [key]: e.target.checked
                                                }))}
                                            />
                                            <Icon style={{ color: canister.color }} />
                                            {canister.name}
                                        </label>
                                    );
                                })}
                            </div>
                            
                            <div style={{ 
                                display: 'flex', 
                                gap: '8px', 
                                marginTop: '16px',
                                flexWrap: 'wrap'
                            }}>
                                <input
                                    type="text"
                                    style={{ ...styles.input, flex: '1 1 300px' }}
                                    placeholder="Enter principal ID..."
                                    value={bulkInput}
                                    onChange={(e) => setBulkInput(e.target.value)}
                                    onKeyDown={(e) => e.key === 'Enter' && handleBulkAddAdmin()}
                                />
                                <button
                                    style={styles.addButton}
                                    onClick={handleBulkAddAdmin}
                                    disabled={bulkAdding || bulkRemoving}
                                >
                                    {bulkAdding ? (
                                        <FaSpinner className="spin" />
                                    ) : (
                                        <FaPlus />
                                    )}
                                    Add to Selected
                                </button>
                                <button
                                    style={{
                                        ...styles.removeButton,
                                        padding: '10px 16px',
                                        fontSize: '14px',
                                    }}
                                    onClick={handleBulkRemoveAdmin}
                                    disabled={bulkAdding || bulkRemoving}
                                >
                                    {bulkRemoving ? (
                                        <FaSpinner className="spin" />
                                    ) : (
                                        <FaMinus />
                                    )}
                                    Remove from Selected
                                </button>
                            </div>
                        </div>
                    )}
                </div>
                
                {/* Individual Canister Cards */}
                {Object.entries(CANISTERS).map(([key, canister]) => {
                    const state = canisterStates[key];
                    const Icon = canister.icon;
                    
                    return (
                        <div key={key} style={styles.card}>
                            <div
                                style={styles.cardHeader}
                                onClick={() => toggleCanisterExpanded(key)}
                            >
                                <h2 style={styles.cardTitle}>
                                    <Icon style={{ color: canister.color }} />
                                    {canister.name}
                                    <span style={{
                                        ...styles.badge,
                                        background: `${canister.color}20`,
                                        color: canister.color,
                                    }}>
                                        {state.loading ? '...' : state.admins.length} admin{state.admins.length !== 1 ? 's' : ''}
                                    </span>
                                </h2>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <button
                                        style={{
                                            ...styles.refreshButton,
                                            padding: '6px 10px',
                                            fontSize: '12px',
                                            background: theme.colors.secondaryBg,
                                            color: theme.colors.primaryText,
                                            border: `1px solid ${theme.colors.border}`,
                                        }}
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            fetchCanisterAdmins(key);
                                        }}
                                        disabled={state.loading}
                                    >
                                        {state.loading ? <FaSpinner className="spin" size={12} /> : <FaSync size={12} />}
                                    </button>
                                    {state.expanded ? <FaChevronUp /> : <FaChevronDown />}
                                </div>
                            </div>
                            
                            {state.expanded && (
                                <div style={styles.cardContent}>
                                    {/* Canister ID */}
                                    <div style={{ 
                                        display: 'flex', 
                                        alignItems: 'center', 
                                        gap: '8px',
                                        marginBottom: '12px',
                                        fontSize: '12px',
                                        color: theme.colors.mutedText
                                    }}>
                                        <span>Canister ID:</span>
                                        <code style={{ fontFamily: 'monospace' }}>{canister.id}</code>
                                        <button
                                            onClick={() => copyToClipboard(canister.id)}
                                            style={{
                                                background: 'none',
                                                border: 'none',
                                                cursor: 'pointer',
                                                color: theme.colors.mutedText,
                                                padding: '4px',
                                            }}
                                        >
                                            <FaCopy size={12} />
                                        </button>
                                    </div>
                                    
                                    {state.error ? (
                                        <div style={styles.error}>
                                            Error: {state.error}
                                        </div>
                                    ) : state.loading ? (
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: theme.colors.mutedText }}>
                                            <FaSpinner className="spin" />
                                            Loading admins...
                                        </div>
                                    ) : (
                                        <>
                                            {state.admins.length === 0 ? (
                                                <div style={{ color: theme.colors.mutedText, fontStyle: 'italic' }}>
                                                    No admins configured (using controller only)
                                                </div>
                                            ) : (
                                                <div style={styles.adminList}>
                                                    {state.admins.map((admin, idx) => {
                                                        const principalText = admin.principal?.toString?.() || admin.principal;
                                                        const removeKey = `${key}:${principalText}`;
                                                        const isRemoving = removingAdmin[removeKey];
                                                        
                                                        return (
                                                            <div key={idx} style={styles.adminItem}>
                                                                <div style={{ flex: 1 }}>
                                                                    <PrincipalDisplay principal={principalText} />
                                                                </div>
                                                                {admin.addedAt && (
                                                                    <span style={{ 
                                                                        fontSize: '11px', 
                                                                        color: theme.colors.mutedText 
                                                                    }}>
                                                                        Added: {new Date(Number(admin.addedAt) / 1000000).toLocaleDateString()}
                                                                    </span>
                                                                )}
                                                                <button
                                                                    style={styles.removeButton}
                                                                    onClick={() => handleRemoveAdmin(key, principalText)}
                                                                    disabled={isRemoving}
                                                                >
                                                                    {isRemoving ? (
                                                                        <FaSpinner className="spin" size={10} />
                                                                    ) : (
                                                                        <FaTrash size={10} />
                                                                    )}
                                                                    Remove
                                                                </button>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            )}
                                            
                                            {/* Add admin input */}
                                            <div style={styles.addAdminRow}>
                                                <input
                                                    type="text"
                                                    style={styles.input}
                                                    placeholder="Enter principal ID to add..."
                                                    value={newAdminInputs[key] || ''}
                                                    onChange={(e) => setNewAdminInputs(prev => ({
                                                        ...prev,
                                                        [key]: e.target.value
                                                    }))}
                                                    onKeyDown={(e) => e.key === 'Enter' && handleAddAdmin(key)}
                                                />
                                                <button
                                                    style={styles.addButton}
                                                    onClick={() => handleAddAdmin(key)}
                                                    disabled={addingAdmin[key]}
                                                >
                                                    {addingAdmin[key] ? (
                                                        <FaSpinner className="spin" />
                                                    ) : (
                                                        <FaPlus />
                                                    )}
                                                    Add
                                                </button>
                                            </div>
                                        </>
                                    )}
                                </div>
                            )}
                        </div>
                    );
                })}
            </main>
            
            {/* Modals */}
            <InfoModal
                show={infoModal.show}
                title={infoModal.title}
                message={infoModal.message}
                type={infoModal.type}
                onClose={closeInfoModal}
            />
            
            <ConfirmationModal
                show={confirmModal.show}
                title={confirmModal.title}
                message={confirmModal.message}
                onConfirm={confirmModal.onConfirm}
                onCancel={closeConfirmModal}
            />
        </div>
    );
}
