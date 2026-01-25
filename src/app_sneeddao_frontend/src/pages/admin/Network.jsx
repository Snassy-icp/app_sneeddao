import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../AuthContext';
import { useAdminCheck } from '../../hooks/useAdminCheck';
import { useTheme } from '../../contexts/ThemeContext';
import Header from '../../components/Header';
import { Principal } from '@dfinity/principal';
import InfoModal from '../../components/InfoModal';
import ConfirmationModal from '../../ConfirmationModal';
import { 
    FaNetworkWired, FaSave, FaSpinner, FaSync, FaCheck, FaTimes,
    FaDatabase, FaLock, FaComments, FaEnvelope, FaCrown, FaRobot, FaExchangeAlt,
    FaCopy, FaLink, FaUnlink
} from 'react-icons/fa';

// Import actors
import { createSneedexActor } from '../../utils/SneedexUtils';
import { createActor as createSneedLockActor, canisterId as sneedLockCanisterId } from 'declarations/sneed_lock';
import { createActor as createBackendActor, canisterId as backendCanisterId } from 'declarations/app_sneeddao_backend';
import { createActor as createForumActor, canisterId as forumCanisterId } from 'declarations/sneed_sns_forum';
import { createActor as createSmsActor, canisterId as smsCanisterId } from 'declarations/sneed_sms';
import { createActor as createPremiumActor, canisterId as premiumCanisterId } from 'declarations/sneed_premium';
import { createActor as createFactoryActor, canisterId as factoryCanisterId } from 'declarations/sneed_icp_neuron_manager_factory';
import { createActor as createSneedexActorDecl, canisterId as sneedexCanisterId } from 'declarations/sneedex';

const getHost = () => process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging' ? 'https://icp0.io' : 'http://localhost:4943';

// Known canister IDs for reference
const KNOWN_CANISTERS = {
    backend: backendCanisterId,
    sneed_lock: sneedLockCanisterId,
    sneed_sns_forum: forumCanisterId,
    sneed_sms: smsCanisterId,
    sneed_premium: premiumCanisterId,
    sneed_icp_neuron_manager_factory: factoryCanisterId,
    sneedex: sneedexCanisterId,
    // External canisters
    icp_ledger: 'ryjl3-tyaaa-aaaaa-aaaba-cai',
    sneed_governance: 'fi3zi-fyaaa-aaaaq-aachq-cai',
    sneed_ledger: 'hvgxa-wqaaa-aaaaq-aacia-cai',
};

export default function NetworkAdmin() {
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
    
    // Network settings state - stores current values from each canister
    const [networkSettings, setNetworkSettings] = useState({
        backend: {
            sneed_premium_canister_id: null,
            loading: false,
            error: null,
        },
        sneed_lock: {
            sneed_premium_canister_id: null,
            loading: false,
            error: null,
        },
        sneed_sns_forum: {
            sneed_premium_canister_id: null,
            loading: false,
            error: null,
        },
        sneed_sms: {
            sneed_premium_canister_id: null,
            loading: false,
            error: null,
        },
        sneed_premium: {
            icp_ledger_id: null,
            sneed_governance_id: null,
            loading: false,
            error: null,
        },
        sneed_icp_neuron_manager_factory: {
            sneed_governance: null,
            sneed_premium_canister_id: null,
            loading: false,
            error: null,
        },
        sneedex: {
            sneed_premium_canister_id: null,
            backend_canister_id: null,
            neuron_manager_factory_canister_id: null,
            loading: false,
            error: null,
        },
    });
    
    // Edit form state
    const [editForms, setEditForms] = useState({});
    const [saving, setSaving] = useState({});
    
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
    
    // Helper to format principal for display
    const formatPrincipal = (principal) => {
        if (!principal) return 'Not set';
        const text = principal.toString();
        if (text.length <= 20) return text;
        return `${text.slice(0, 10)}...${text.slice(-8)}`;
    };
    
    // Helper to get canister name from ID
    const getCanisterName = (canisterId) => {
        if (!canisterId) return null;
        const cidText = canisterId.toString();
        for (const [name, id] of Object.entries(KNOWN_CANISTERS)) {
            if (id === cidText) return name;
        }
        return null;
    };
    
    // Copy to clipboard
    const copyToClipboard = async (text) => {
        try {
            await navigator.clipboard.writeText(text);
            showInfo('Copied', 'Copied to clipboard', 'success');
        } catch (e) {
            console.error('Failed to copy:', e);
        }
    };
    
    // Fetch settings from all canisters
    const fetchAllSettings = useCallback(async () => {
        if (!isAuthenticated || !identity) return;
        
        setLoading(true);
        setError('');
        
        const newSettings = { ...networkSettings };
        
        // Fetch from Backend
        try {
            const backendActor = createBackendActor(backendCanisterId, { agentOptions: { identity, host: getHost() } });
            const limitsConfig = await backendActor.get_nickname_limits_config();
            newSettings.backend = {
                ...newSettings.backend,
                sneed_premium_canister_id: limitsConfig.sneed_premium_canister_id?.[0] || null,
                loading: false,
                error: null,
            };
        } catch (e) {
            console.error('Error fetching backend settings:', e);
            newSettings.backend = { ...newSettings.backend, loading: false, error: e.message };
        }
        
        // Fetch from SneedLock
        try {
            const lockActor = createSneedLockActor(sneedLockCanisterId, { agentOptions: { identity, host: getHost() } });
            const feeConfig = await lockActor.get_icp_fee_config();
            newSettings.sneed_lock = {
                ...newSettings.sneed_lock,
                sneed_premium_canister_id: feeConfig.sneed_premium_canister_id?.[0] || null,
                loading: false,
                error: null,
            };
        } catch (e) {
            console.error('Error fetching sneed_lock settings:', e);
            newSettings.sneed_lock = { ...newSettings.sneed_lock, loading: false, error: e.message };
        }
        
        // Fetch from Forum
        try {
            const forumActor = createForumActor(forumCanisterId, { agentOptions: { identity, host: getHost() } });
            const premiumConfig = await forumActor.get_premium_config();
            newSettings.sneed_sns_forum = {
                ...newSettings.sneed_sns_forum,
                sneed_premium_canister_id: premiumConfig.sneed_premium_canister_id?.[0] || null,
                loading: false,
                error: null,
            };
        } catch (e) {
            console.error('Error fetching forum settings:', e);
            newSettings.sneed_sns_forum = { ...newSettings.sneed_sns_forum, loading: false, error: e.message };
        }
        
        // Fetch from SMS
        try {
            const smsActor = createSmsActor(smsCanisterId, { agentOptions: { identity, host: getHost() } });
            const premiumConfig = await smsActor.get_premium_config();
            newSettings.sneed_sms = {
                ...newSettings.sneed_sms,
                sneed_premium_canister_id: premiumConfig.sneed_premium_canister_id?.[0] || null,
                loading: false,
                error: null,
            };
        } catch (e) {
            console.error('Error fetching sms settings:', e);
            newSettings.sneed_sms = { ...newSettings.sneed_sms, loading: false, error: e.message };
        }
        
        // Fetch from Premium
        try {
            const premiumActor = createPremiumActor(premiumCanisterId, { agentOptions: { identity, host: getHost() } });
            const config = await premiumActor.getConfig();
            newSettings.sneed_premium = {
                ...newSettings.sneed_premium,
                icp_ledger_id: config.icpLedgerId || null,
                sneed_governance_id: config.sneedGovernanceId || null,
                loading: false,
                error: null,
            };
        } catch (e) {
            console.error('Error fetching premium settings:', e);
            newSettings.sneed_premium = { ...newSettings.sneed_premium, loading: false, error: e.message };
        }
        
        // Fetch from Factory
        try {
            const factoryActor = createFactoryActor(factoryCanisterId, { agentOptions: { identity, host: getHost() } });
            const [governance, premiumId] = await Promise.all([
                factoryActor.getSneedGovernance(),
                factoryActor.getSneedPremiumCanisterId(),
            ]);
            newSettings.sneed_icp_neuron_manager_factory = {
                ...newSettings.sneed_icp_neuron_manager_factory,
                sneed_governance: governance?.[0] || null,
                sneed_premium_canister_id: premiumId?.[0] || null,
                loading: false,
                error: null,
            };
        } catch (e) {
            console.error('Error fetching factory settings:', e);
            newSettings.sneed_icp_neuron_manager_factory = { ...newSettings.sneed_icp_neuron_manager_factory, loading: false, error: e.message };
        }
        
        // Fetch from Sneedex
        try {
            const sneedexActor = createSneedexActor(identity);
            const [premiumId, backendId, factoryId] = await Promise.all([
                sneedexActor.getSneedPremiumCanisterId(),
                sneedexActor.getBackendCanisterId(),
                sneedexActor.getNeuronManagerFactoryCanisterId(),
            ]);
            newSettings.sneedex = {
                ...newSettings.sneedex,
                sneed_premium_canister_id: premiumId?.[0] || null,
                backend_canister_id: backendId?.[0] || null,
                neuron_manager_factory_canister_id: factoryId?.[0] || null,
                loading: false,
                error: null,
            };
        } catch (e) {
            console.error('Error fetching sneedex settings:', e);
            newSettings.sneedex = { ...newSettings.sneedex, loading: false, error: e.message };
        }
        
        setNetworkSettings(newSettings);
        setLoading(false);
    }, [isAuthenticated, identity]);
    
    useEffect(() => {
        if (isGlobalAdmin && isAuthenticated && identity) {
            fetchAllSettings();
        }
    }, [isGlobalAdmin, isAuthenticated, identity, fetchAllSettings]);
    
    // Save handlers for each canister/setting
    const saveSetting = async (canister, settingKey, value) => {
        const saveKey = `${canister}_${settingKey}`;
        setSaving(prev => ({ ...prev, [saveKey]: true }));
        
        try {
            let principal = null;
            if (value && value.trim()) {
                try {
                    principal = Principal.fromText(value.trim());
                } catch (e) {
                    showInfo('Error', 'Invalid principal format', 'error');
                    setSaving(prev => ({ ...prev, [saveKey]: false }));
                    return;
                }
            }
            
            const optPrincipal = principal ? [principal] : [];
            
            switch (canister) {
                case 'backend': {
                    const actor = createBackendActor(backendCanisterId, { agentOptions: { identity, host: getHost() } });
                    const result = await actor.set_nickname_premium_canister(optPrincipal.length > 0 ? optPrincipal[0] : null);
                    if ('ok' in result) {
                        showInfo('Success', 'Backend premium canister ID updated', 'success');
                        setNetworkSettings(prev => ({
                            ...prev,
                            backend: { ...prev.backend, sneed_premium_canister_id: principal }
                        }));
                    } else {
                        showInfo('Error', 'Failed: ' + JSON.stringify(result.err), 'error');
                    }
                    break;
                }
                case 'sneed_lock': {
                    const actor = createSneedLockActor(sneedLockCanisterId, { agentOptions: { identity, host: getHost() } });
                    const result = await actor.admin_set_sneed_premium_canister_id(optPrincipal.length > 0 ? optPrincipal[0] : null);
                    if ('Ok' in result) {
                        showInfo('Success', 'SneedLock premium canister ID updated', 'success');
                        setNetworkSettings(prev => ({
                            ...prev,
                            sneed_lock: { ...prev.sneed_lock, sneed_premium_canister_id: principal }
                        }));
                    } else {
                        showInfo('Error', 'Failed: ' + result.Err, 'error');
                    }
                    break;
                }
                case 'sneed_sns_forum': {
                    const actor = createForumActor(forumCanisterId, { agentOptions: { identity, host: getHost() } });
                    // For Forum, sneed_premium_canister_id is ??Principal (null = no change, ?null = clear, ?(?id) = set)
                    // In JS: [] = no change, [[]] = clear, [[principal]] = set
                    const forumOpt = principal ? [[principal]] : [[]];
                    const result = await actor.update_premium_config({
                        sneed_premium_canister_id: forumOpt,
                        premium_post_body_max_length: [],
                        premium_thread_body_max_length: [],
                    });
                    if ('ok' in result) {
                        showInfo('Success', 'Forum premium canister ID updated', 'success');
                        setNetworkSettings(prev => ({
                            ...prev,
                            sneed_sns_forum: { ...prev.sneed_sns_forum, sneed_premium_canister_id: principal }
                        }));
                    } else {
                        showInfo('Error', 'Failed: ' + JSON.stringify(result.err), 'error');
                    }
                    break;
                }
                case 'sneed_sms': {
                    const actor = createSmsActor(smsCanisterId, { agentOptions: { identity, host: getHost() } });
                    // For SMS, we pass ??Principal format (null = no change, ?null = clear, ?(?id) = set)
                    // In JS: [] = no change, [[]] = clear, [[principal]] = set
                    const smsOpt = principal ? [[principal]] : [[]];
                    const result = await actor.update_premium_config(
                        smsOpt, // sneed_premium_canister_id
                        [],     // premium_max_subject_length (no change)
                        [],     // premium_max_body_length (no change)
                        [],     // premium_rate_limit_minutes (no change)
                        []      // premium_max_recipients (no change)
                    );
                    if ('ok' in result) {
                        showInfo('Success', 'SMS premium canister ID updated', 'success');
                        setNetworkSettings(prev => ({
                            ...prev,
                            sneed_sms: { ...prev.sneed_sms, sneed_premium_canister_id: principal }
                        }));
                    } else {
                        showInfo('Error', 'Failed: ' + JSON.stringify(result.err), 'error');
                    }
                    break;
                }
                case 'sneed_premium': {
                    const actor = createPremiumActor(premiumCanisterId, { agentOptions: { identity, host: getHost() } });
                    if (settingKey === 'icp_ledger_id') {
                        const result = await actor.setIcpLedgerId(principal);
                        if ('ok' in result) {
                            showInfo('Success', 'Premium ICP ledger ID updated', 'success');
                            setNetworkSettings(prev => ({
                                ...prev,
                                sneed_premium: { ...prev.sneed_premium, icp_ledger_id: principal }
                            }));
                        } else {
                            showInfo('Error', 'Failed: ' + JSON.stringify(result.err), 'error');
                        }
                    } else if (settingKey === 'sneed_governance_id') {
                        const result = await actor.setSneedGovernanceId(principal);
                        if ('ok' in result) {
                            showInfo('Success', 'Premium Sneed governance ID updated', 'success');
                            setNetworkSettings(prev => ({
                                ...prev,
                                sneed_premium: { ...prev.sneed_premium, sneed_governance_id: principal }
                            }));
                        } else {
                            showInfo('Error', 'Failed: ' + JSON.stringify(result.err), 'error');
                        }
                    }
                    break;
                }
                case 'sneed_icp_neuron_manager_factory': {
                    const actor = createFactoryActor(factoryCanisterId, { agentOptions: { identity, host: getHost() } });
                    if (settingKey === 'sneed_governance') {
                        await actor.setSneedGovernance(optPrincipal.length > 0 ? optPrincipal : []);
                        showInfo('Success', 'Factory Sneed governance updated', 'success');
                        setNetworkSettings(prev => ({
                            ...prev,
                            sneed_icp_neuron_manager_factory: { ...prev.sneed_icp_neuron_manager_factory, sneed_governance: principal }
                        }));
                    } else if (settingKey === 'sneed_premium_canister_id') {
                        await actor.setSneedPremiumCanisterId(optPrincipal.length > 0 ? optPrincipal : []);
                        showInfo('Success', 'Factory premium canister ID updated', 'success');
                        setNetworkSettings(prev => ({
                            ...prev,
                            sneed_icp_neuron_manager_factory: { ...prev.sneed_icp_neuron_manager_factory, sneed_premium_canister_id: principal }
                        }));
                    }
                    break;
                }
                case 'sneedex': {
                    const actor = createSneedexActor(identity);
                    if (settingKey === 'sneed_premium_canister_id') {
                        const result = await actor.setSneedPremiumCanisterId(optPrincipal);
                        if ('ok' in result) {
                            showInfo('Success', 'Sneedex premium canister ID updated', 'success');
                            setNetworkSettings(prev => ({
                                ...prev,
                                sneedex: { ...prev.sneedex, sneed_premium_canister_id: principal }
                            }));
                        } else {
                            showInfo('Error', 'Failed: ' + JSON.stringify(result.err), 'error');
                        }
                    } else if (settingKey === 'backend_canister_id') {
                        const result = await actor.setBackendCanisterId(optPrincipal);
                        if ('ok' in result) {
                            showInfo('Success', 'Sneedex backend canister ID updated', 'success');
                            setNetworkSettings(prev => ({
                                ...prev,
                                sneedex: { ...prev.sneedex, backend_canister_id: principal }
                            }));
                        } else {
                            showInfo('Error', 'Failed: ' + JSON.stringify(result.err), 'error');
                        }
                    } else if (settingKey === 'neuron_manager_factory_canister_id') {
                        const result = await actor.setNeuronManagerFactoryCanisterId(optPrincipal);
                        if ('ok' in result) {
                            showInfo('Success', 'Sneedex factory canister ID updated', 'success');
                            setNetworkSettings(prev => ({
                                ...prev,
                                sneedex: { ...prev.sneedex, neuron_manager_factory_canister_id: principal }
                            }));
                        } else {
                            showInfo('Error', 'Failed: ' + JSON.stringify(result.err), 'error');
                        }
                    }
                    break;
                }
            }
        } catch (e) {
            console.error('Error saving setting:', e);
            showInfo('Error', 'Failed to save: ' + e.message, 'error');
        } finally {
            setSaving(prev => ({ ...prev, [saveKey]: false }));
            // Clear edit form
            setEditForms(prev => ({ ...prev, [saveKey]: undefined }));
        }
    };
    
    // Propagate Premium canister ID to all canisters
    const propagatePremiumCanisterId = async () => {
        if (!premiumCanisterId) {
            showInfo('Error', 'Premium canister ID not available', 'error');
            return;
        }
        
        showConfirm(
            'Propagate Premium Canister ID',
            `This will set the Sneed Premium canister ID (${premiumCanisterId}) on all canisters that need it. Continue?`,
            async () => {
                closeConfirmModal();
                setLoading(true);
                
                const results = [];
                const canisters = [
                    'backend',
                    'sneed_lock',
                    'sneed_sns_forum',
                    'sneed_sms',
                    'sneed_icp_neuron_manager_factory',
                    'sneedex'
                ];
                
                for (const canister of canisters) {
                    try {
                        await saveSetting(canister, 'sneed_premium_canister_id', premiumCanisterId);
                        results.push({ canister, success: true });
                    } catch (e) {
                        results.push({ canister, success: false, error: e.message });
                    }
                }
                
                const failed = results.filter(r => !r.success);
                if (failed.length === 0) {
                    showInfo('Success', 'Premium canister ID propagated to all canisters', 'success');
                } else {
                    showInfo('Partial Success', `Failed on: ${failed.map(f => f.canister).join(', ')}`, 'warning');
                }
                
                await fetchAllSettings();
            }
        );
    };
    
    // Styles
    const styles = {
        pageContainer: {
            backgroundColor: theme === 'dark' ? '#0f0f0f' : '#f5f5f5',
            minHeight: '100vh',
        },
        container: {
            maxWidth: '1400px',
            margin: '0 auto',
            padding: '20px',
        },
        header: {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: '30px',
            flexWrap: 'wrap',
            gap: '15px',
        },
        title: {
            color: theme === 'dark' ? '#ffffff' : '#1a1a2e',
            fontSize: '28px',
            fontWeight: '600',
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
        },
        titleIcon: {
            color: '#00d4aa',
        },
        actions: {
            display: 'flex',
            gap: '10px',
        },
        button: {
            padding: '10px 20px',
            borderRadius: '8px',
            border: 'none',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            fontWeight: '500',
            fontSize: '14px',
            transition: 'all 0.2s ease',
        },
        primaryButton: {
            backgroundColor: '#00d4aa',
            color: '#000',
        },
        secondaryButton: {
            backgroundColor: theme === 'dark' ? '#2a2a2a' : '#e0e0e0',
            color: theme === 'dark' ? '#fff' : '#333',
        },
        grid: {
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(400px, 1fr))',
            gap: '20px',
        },
        card: {
            backgroundColor: theme === 'dark' ? '#1a1a2e' : '#ffffff',
            borderRadius: '12px',
            padding: '20px',
            border: `1px solid ${theme === 'dark' ? '#2a2a4a' : '#e0e0e0'}`,
        },
        cardHeader: {
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            marginBottom: '20px',
            paddingBottom: '15px',
            borderBottom: `1px solid ${theme === 'dark' ? '#2a2a4a' : '#e0e0e0'}`,
        },
        cardIcon: {
            fontSize: '24px',
            color: '#00d4aa',
        },
        cardTitle: {
            color: theme === 'dark' ? '#ffffff' : '#1a1a2e',
            fontSize: '18px',
            fontWeight: '600',
            flex: 1,
        },
        cardSubtitle: {
            color: theme === 'dark' ? '#888' : '#666',
            fontSize: '12px',
            fontFamily: 'monospace',
        },
        settingRow: {
            marginBottom: '15px',
        },
        settingLabel: {
            color: theme === 'dark' ? '#aaa' : '#666',
            fontSize: '12px',
            marginBottom: '5px',
            fontWeight: '500',
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
        },
        settingValue: {
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
        },
        principalDisplay: {
            backgroundColor: theme === 'dark' ? '#0f0f1a' : '#f5f5f5',
            padding: '10px 12px',
            borderRadius: '6px',
            fontFamily: 'monospace',
            fontSize: '13px',
            color: theme === 'dark' ? '#00d4aa' : '#00a080',
            flex: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
        },
        notSet: {
            color: theme === 'dark' ? '#666' : '#999',
            fontStyle: 'italic',
        },
        knownCanister: {
            backgroundColor: theme === 'dark' ? '#1a2a1a' : '#e8f5e9',
            color: theme === 'dark' ? '#4caf50' : '#2e7d32',
            padding: '2px 8px',
            borderRadius: '4px',
            fontSize: '11px',
            fontWeight: '500',
        },
        iconButton: {
            padding: '8px',
            borderRadius: '6px',
            border: 'none',
            cursor: 'pointer',
            backgroundColor: theme === 'dark' ? '#2a2a2a' : '#e0e0e0',
            color: theme === 'dark' ? '#fff' : '#333',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'all 0.2s ease',
        },
        input: {
            width: '100%',
            padding: '10px 12px',
            borderRadius: '6px',
            border: `1px solid ${theme === 'dark' ? '#3a3a5a' : '#ddd'}`,
            backgroundColor: theme === 'dark' ? '#0f0f1a' : '#fff',
            color: theme === 'dark' ? '#fff' : '#333',
            fontFamily: 'monospace',
            fontSize: '13px',
        },
        inputRow: {
            display: 'flex',
            gap: '8px',
            marginTop: '8px',
        },
        statusBadge: {
            padding: '4px 10px',
            borderRadius: '12px',
            fontSize: '11px',
            fontWeight: '600',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '4px',
        },
        statusSet: {
            backgroundColor: theme === 'dark' ? '#1a3a1a' : '#e8f5e9',
            color: '#4caf50',
        },
        statusNotSet: {
            backgroundColor: theme === 'dark' ? '#3a1a1a' : '#ffebee',
            color: '#f44336',
        },
        loadingOverlay: {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '60px 20px',
            color: theme === 'dark' ? '#888' : '#666',
        },
        errorBox: {
            backgroundColor: theme === 'dark' ? 'rgba(244, 67, 54, 0.1)' : '#ffebee',
            border: '1px solid #f44336',
            color: '#f44336',
            padding: '12px 16px',
            borderRadius: '8px',
            marginTop: '10px',
            fontSize: '13px',
        },
        summaryCard: {
            backgroundColor: theme === 'dark' ? '#1a2a3a' : '#e3f2fd',
            borderRadius: '12px',
            padding: '20px',
            marginBottom: '30px',
            border: `1px solid ${theme === 'dark' ? '#2a4a6a' : '#bbdefb'}`,
        },
        summaryTitle: {
            color: theme === 'dark' ? '#90caf9' : '#1976d2',
            fontSize: '16px',
            fontWeight: '600',
            marginBottom: '15px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
        },
        summaryGrid: {
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
            gap: '15px',
        },
        summaryItem: {
            backgroundColor: theme === 'dark' ? '#0f1a2a' : '#fff',
            padding: '12px',
            borderRadius: '8px',
        },
        summaryLabel: {
            color: theme === 'dark' ? '#90caf9' : '#1976d2',
            fontSize: '11px',
            fontWeight: '500',
            marginBottom: '4px',
        },
        summaryValue: {
            color: theme === 'dark' ? '#fff' : '#333',
            fontSize: '13px',
            fontFamily: 'monospace',
        },
    };
    
    // Render setting row with edit capability
    const renderSetting = (canister, settingKey, label, currentValue, description) => {
        const editKey = `${canister}_${settingKey}`;
        const isEditing = editForms[editKey] !== undefined;
        const isSaving = saving[editKey];
        const knownName = getCanisterName(currentValue);
        
        return (
            <div style={styles.settingRow} key={editKey}>
                <div style={styles.settingLabel}>{label}</div>
                <div style={styles.settingValue}>
                    {isEditing ? (
                        <div style={{ flex: 1 }}>
                            <div style={styles.inputRow}>
                                <input
                                    type="text"
                                    value={editForms[editKey]}
                                    onChange={(e) => setEditForms(prev => ({ ...prev, [editKey]: e.target.value }))}
                                    placeholder="Enter principal ID (leave empty to clear)"
                                    style={styles.input}
                                    disabled={isSaving}
                                />
                                <button
                                    style={{ ...styles.iconButton, backgroundColor: '#00d4aa', color: '#000' }}
                                    onClick={() => saveSetting(canister, settingKey, editForms[editKey])}
                                    disabled={isSaving}
                                    title="Save"
                                >
                                    {isSaving ? <FaSpinner className="spin" /> : <FaSave />}
                                </button>
                                <button
                                    style={styles.iconButton}
                                    onClick={() => setEditForms(prev => ({ ...prev, [editKey]: undefined }))}
                                    disabled={isSaving}
                                    title="Cancel"
                                >
                                    <FaTimes />
                                </button>
                            </div>
                        </div>
                    ) : (
                        <>
                            <div style={{ ...styles.principalDisplay, ...(currentValue ? {} : styles.notSet) }}>
                                {currentValue ? currentValue.toString() : 'Not set'}
                            </div>
                            {knownName && (
                                <span style={styles.knownCanister}>{knownName}</span>
                            )}
                            {currentValue && (
                                <button
                                    style={styles.iconButton}
                                    onClick={() => copyToClipboard(currentValue.toString())}
                                    title="Copy"
                                >
                                    <FaCopy size={12} />
                                </button>
                            )}
                            <button
                                style={styles.iconButton}
                                onClick={() => setEditForms(prev => ({ 
                                    ...prev, 
                                    [editKey]: currentValue ? currentValue.toString() : '' 
                                }))}
                                title="Edit"
                            >
                                <FaLink size={12} />
                            </button>
                        </>
                    )}
                </div>
                {!isEditing && (
                    <span style={{ ...styles.statusBadge, ...(currentValue ? styles.statusSet : styles.statusNotSet), marginTop: '8px' }}>
                        {currentValue ? <><FaCheck size={10} /> Configured</> : <><FaTimes size={10} /> Not configured</>}
                    </span>
                )}
            </div>
        );
    };
    
    // Loading state
    if (adminLoading || (loading && Object.keys(editForms).length === 0)) {
        return (
            <div style={styles.pageContainer}>
                <Header />
                <main style={styles.container}>
                    <div style={styles.loadingOverlay}>
                        <FaSpinner className="spin" style={{ marginRight: '10px' }} />
                        Loading network settings...
                    </div>
                </main>
            </div>
        );
    }
    
    if (!isGlobalAdmin) {
        return null;
    }
    
    // Count configured settings
    const countConfigured = () => {
        let total = 0;
        let configured = 0;
        
        // Backend
        total++; configured += networkSettings.backend.sneed_premium_canister_id ? 1 : 0;
        // SneedLock
        total++; configured += networkSettings.sneed_lock.sneed_premium_canister_id ? 1 : 0;
        // Forum
        total++; configured += networkSettings.sneed_sns_forum.sneed_premium_canister_id ? 1 : 0;
        // SMS
        total++; configured += networkSettings.sneed_sms.sneed_premium_canister_id ? 1 : 0;
        // Premium
        total += 2;
        configured += networkSettings.sneed_premium.icp_ledger_id ? 1 : 0;
        configured += networkSettings.sneed_premium.sneed_governance_id ? 1 : 0;
        // Factory
        total += 2;
        configured += networkSettings.sneed_icp_neuron_manager_factory.sneed_governance ? 1 : 0;
        configured += networkSettings.sneed_icp_neuron_manager_factory.sneed_premium_canister_id ? 1 : 0;
        // Sneedex
        total += 3;
        configured += networkSettings.sneedex.sneed_premium_canister_id ? 1 : 0;
        configured += networkSettings.sneedex.backend_canister_id ? 1 : 0;
        configured += networkSettings.sneedex.neuron_manager_factory_canister_id ? 1 : 0;
        
        return { total, configured };
    };
    
    const { total, configured } = countConfigured();
    
    return (
        <div style={styles.pageContainer}>
            <Header />
            <main style={styles.container}>
                <div style={styles.header}>
                    <h1 style={styles.title}>
                        <FaNetworkWired style={styles.titleIcon} />
                        Network Configuration
                    </h1>
                    <div style={styles.actions}>
                        <button
                            style={{ ...styles.button, ...styles.secondaryButton }}
                            onClick={fetchAllSettings}
                            disabled={loading}
                        >
                            {loading ? <FaSpinner className="spin" /> : <FaSync />}
                            Refresh
                        </button>
                        <button
                            style={{ ...styles.button, ...styles.primaryButton }}
                            onClick={propagatePremiumCanisterId}
                            disabled={loading}
                        >
                            <FaCrown />
                            Propagate Premium ID
                        </button>
                    </div>
                </div>
                
                {/* Summary Card */}
                <div style={styles.summaryCard}>
                    <div style={styles.summaryTitle}>
                        <FaNetworkWired />
                        Network Overview
                    </div>
                    <div style={styles.summaryGrid}>
                        <div style={styles.summaryItem}>
                            <div style={styles.summaryLabel}>CONFIGURATION STATUS</div>
                            <div style={styles.summaryValue}>
                                {configured} / {total} settings configured
                            </div>
                        </div>
                        <div style={styles.summaryItem}>
                            <div style={styles.summaryLabel}>SNEED PREMIUM</div>
                            <div style={styles.summaryValue}>
                                {premiumCanisterId ? formatPrincipal(Principal.fromText(premiumCanisterId)) : 'Not available'}
                            </div>
                        </div>
                        <div style={styles.summaryItem}>
                            <div style={styles.summaryLabel}>BACKEND</div>
                            <div style={styles.summaryValue}>
                                {backendCanisterId ? formatPrincipal(Principal.fromText(backendCanisterId)) : 'Not available'}
                            </div>
                        </div>
                        <div style={styles.summaryItem}>
                            <div style={styles.summaryLabel}>FACTORY</div>
                            <div style={styles.summaryValue}>
                                {factoryCanisterId ? formatPrincipal(Principal.fromText(factoryCanisterId)) : 'Not available'}
                            </div>
                        </div>
                    </div>
                </div>
                
                {error && (
                    <div style={styles.errorBox}>{error}</div>
                )}
                
                {/* Canister Settings Grid */}
                <div style={styles.grid}>
                    {/* Backend */}
                    <div style={styles.card}>
                        <div style={styles.cardHeader}>
                            <FaDatabase style={styles.cardIcon} />
                            <div>
                                <div style={styles.cardTitle}>Backend</div>
                                <div style={styles.cardSubtitle}>{backendCanisterId}</div>
                            </div>
                        </div>
                        {networkSettings.backend.error ? (
                            <div style={styles.errorBox}>{networkSettings.backend.error}</div>
                        ) : (
                            renderSetting('backend', 'sneed_premium_canister_id', 'Sneed Premium Canister ID', 
                                networkSettings.backend.sneed_premium_canister_id, 
                                'Used for premium membership checks')
                        )}
                    </div>
                    
                    {/* SneedLock */}
                    <div style={styles.card}>
                        <div style={styles.cardHeader}>
                            <FaLock style={styles.cardIcon} />
                            <div>
                                <div style={styles.cardTitle}>SneedLock</div>
                                <div style={styles.cardSubtitle}>{sneedLockCanisterId}</div>
                            </div>
                        </div>
                        {networkSettings.sneed_lock.error ? (
                            <div style={styles.errorBox}>{networkSettings.sneed_lock.error}</div>
                        ) : (
                            renderSetting('sneed_lock', 'sneed_premium_canister_id', 'Sneed Premium Canister ID', 
                                networkSettings.sneed_lock.sneed_premium_canister_id,
                                'Used for premium membership checks')
                        )}
                    </div>
                    
                    {/* Forum */}
                    <div style={styles.card}>
                        <div style={styles.cardHeader}>
                            <FaComments style={styles.cardIcon} />
                            <div>
                                <div style={styles.cardTitle}>SNS Forum</div>
                                <div style={styles.cardSubtitle}>{forumCanisterId}</div>
                            </div>
                        </div>
                        {networkSettings.sneed_sns_forum.error ? (
                            <div style={styles.errorBox}>{networkSettings.sneed_sns_forum.error}</div>
                        ) : (
                            renderSetting('sneed_sns_forum', 'sneed_premium_canister_id', 'Sneed Premium Canister ID', 
                                networkSettings.sneed_sns_forum.sneed_premium_canister_id,
                                'Used for premium post limits')
                        )}
                    </div>
                    
                    {/* SMS */}
                    <div style={styles.card}>
                        <div style={styles.cardHeader}>
                            <FaEnvelope style={styles.cardIcon} />
                            <div>
                                <div style={styles.cardTitle}>SMS</div>
                                <div style={styles.cardSubtitle}>{smsCanisterId}</div>
                            </div>
                        </div>
                        {networkSettings.sneed_sms.error ? (
                            <div style={styles.errorBox}>{networkSettings.sneed_sms.error}</div>
                        ) : (
                            renderSetting('sneed_sms', 'sneed_premium_canister_id', 'Sneed Premium Canister ID', 
                                networkSettings.sneed_sms.sneed_premium_canister_id,
                                'Used for premium messaging limits')
                        )}
                    </div>
                    
                    {/* Premium */}
                    <div style={styles.card}>
                        <div style={styles.cardHeader}>
                            <FaCrown style={styles.cardIcon} />
                            <div>
                                <div style={styles.cardTitle}>Sneed Premium</div>
                                <div style={styles.cardSubtitle}>{premiumCanisterId}</div>
                            </div>
                        </div>
                        {networkSettings.sneed_premium.error ? (
                            <div style={styles.errorBox}>{networkSettings.sneed_premium.error}</div>
                        ) : (
                            <>
                                {renderSetting('sneed_premium', 'icp_ledger_id', 'ICP Ledger Canister ID', 
                                    networkSettings.sneed_premium.icp_ledger_id,
                                    'ICP ledger for payments')}
                                {renderSetting('sneed_premium', 'sneed_governance_id', 'Sneed Governance Canister ID', 
                                    networkSettings.sneed_premium.sneed_governance_id,
                                    'Sneed SNS governance for VP checks')}
                            </>
                        )}
                    </div>
                    
                    {/* Factory */}
                    <div style={styles.card}>
                        <div style={styles.cardHeader}>
                            <FaRobot style={styles.cardIcon} />
                            <div>
                                <div style={styles.cardTitle}>Neuron Manager Factory</div>
                                <div style={styles.cardSubtitle}>{factoryCanisterId}</div>
                            </div>
                        </div>
                        {networkSettings.sneed_icp_neuron_manager_factory.error ? (
                            <div style={styles.errorBox}>{networkSettings.sneed_icp_neuron_manager_factory.error}</div>
                        ) : (
                            <>
                                {renderSetting('sneed_icp_neuron_manager_factory', 'sneed_governance', 'Sneed Governance', 
                                    networkSettings.sneed_icp_neuron_manager_factory.sneed_governance,
                                    'Sneed governance for proposals')}
                                {renderSetting('sneed_icp_neuron_manager_factory', 'sneed_premium_canister_id', 'Sneed Premium Canister ID', 
                                    networkSettings.sneed_icp_neuron_manager_factory.sneed_premium_canister_id,
                                    'Used for premium discounts')}
                            </>
                        )}
                    </div>
                    
                    {/* Sneedex */}
                    <div style={styles.card}>
                        <div style={styles.cardHeader}>
                            <FaExchangeAlt style={styles.cardIcon} />
                            <div>
                                <div style={styles.cardTitle}>Sneedex</div>
                                <div style={styles.cardSubtitle}>{sneedexCanisterId}</div>
                            </div>
                        </div>
                        {networkSettings.sneedex.error ? (
                            <div style={styles.errorBox}>{networkSettings.sneedex.error}</div>
                        ) : (
                            <>
                                {renderSetting('sneedex', 'sneed_premium_canister_id', 'Sneed Premium Canister ID', 
                                    networkSettings.sneedex.sneed_premium_canister_id,
                                    'Used for premium discounts')}
                                {renderSetting('sneedex', 'backend_canister_id', 'Backend Canister ID', 
                                    networkSettings.sneedex.backend_canister_id,
                                    'For wallet canister registrations')}
                                {renderSetting('sneedex', 'neuron_manager_factory_canister_id', 'Neuron Manager Factory ID', 
                                    networkSettings.sneedex.neuron_manager_factory_canister_id,
                                    'For manager registrations')}
                            </>
                        )}
                    </div>
                </div>
                
                {/* Info Modal */}
                <InfoModal
                    isOpen={infoModal.show}
                    onClose={closeInfoModal}
                    title={infoModal.title}
                    message={infoModal.message}
                    type={infoModal.type}
                />
                
                {/* Confirmation Modal */}
                <ConfirmationModal
                    isOpen={confirmModal.show}
                    onClose={closeConfirmModal}
                    onConfirm={confirmModal.onConfirm}
                    title={confirmModal.title}
                    message={confirmModal.message}
                />
            </main>
            
            <style>{`
                .spin {
                    animation: spin 1s linear infinite;
                }
                @keyframes spin {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(360deg); }
                }
            `}</style>
        </div>
    );
}
