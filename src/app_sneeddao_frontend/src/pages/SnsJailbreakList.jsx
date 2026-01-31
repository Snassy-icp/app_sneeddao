import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { FaArrowLeft, FaCheck, FaSpinner, FaUnlock, FaCopy, FaExternalLinkAlt, FaBrain, FaTrash, FaPlus, FaExclamationTriangle, FaCode, FaList } from 'react-icons/fa';
import { Principal } from '@dfinity/principal';
import Header from '../components/Header';
import { useAuth } from '../AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { useNaming } from '../NamingContext';
import { fetchAndCacheSnsData, fetchSnsLogo, getSnsById } from '../utils/SnsUtils';
import { createActor as createBackendActor, canisterId as backendCanisterId } from 'declarations/app_sneeddao_backend';
import { HttpAgent } from '@dfinity/agent';
import { PrincipalDisplay } from '../utils/PrincipalUtils';
import { NeuronDisplay } from '../components/NeuronDisplay';

// Custom CSS for animations
const customStyles = `
@keyframes fadeInUp {
    from {
        opacity: 0;
        transform: translateY(20px);
    }
    to {
        opacity: 1;
        transform: translateY(0);
    }
}

@keyframes float {
    0%, 100% { transform: translateY(0px); }
    50% { transform: translateY(-8px); }
}

@keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
}

.jailbreak-list-float {
    animation: float 3s ease-in-out infinite;
}

.jailbreak-list-fade-in {
    animation: fadeInUp 0.5s ease-out forwards;
}

.jailbreak-list-spin {
    animation: spin 1s linear infinite;
}
`;

// Page accent colors - orange theme
const jailbreakPrimary = '#f97316';
const jailbreakSecondary = '#fb923c';

const RAW_GITHUB_BASE_URL = 'https://raw.githubusercontent.com/Snassy-icp/app_sneeddao/main/resources/sns_jailbreak/base_script.js';

function SnsJailbreakList() {
    const { identity, isAuthenticated } = useAuth();
    const { theme } = useTheme();
    const { getNeuronDisplayName: getNeuronNameInfo } = useNaming();
    
    // Create authenticated backend actor
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
    
    const [configs, setConfigs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [snsList, setSnsList] = useState([]);
    const [snsLogos, setSnsLogos] = useState(new Map());
    const [loadingLogos, setLoadingLogos] = useState(new Set());
    
    // Modal state for showing generated script
    const [selectedConfig, setSelectedConfig] = useState(null);
    const [baseScript, setBaseScript] = useState('');
    const [loadingScript, setLoadingScript] = useState(false);
    const [scriptError, setScriptError] = useState('');
    const [copied, setCopied] = useState(false);
    
    // Delete confirmation
    const [deletingId, setDeletingId] = useState(null);
    const [confirmDelete, setConfirmDelete] = useState(null);
    
    // Load SNS data
    useEffect(() => {
        const loadSnsData = async () => {
            try {
                const data = await fetchAndCacheSnsData(identity);
                setSnsList(data);
                
                // Start loading logos
                data.forEach(sns => {
                    if (sns.canisters?.governance) {
                        loadSnsLogo(sns.canisters.governance);
                    }
                });
            } catch (e) {
                console.error('Failed to load SNS data:', e);
            }
        };
        loadSnsData();
    }, [identity]);
    
    // Load saved configs
    useEffect(() => {
        const loadConfigs = async () => {
            if (!isAuthenticated || !backendActor) return;
            
            setLoading(true);
            try {
                const result = await backendActor.get_my_jailbreak_configs();
                // Sort by created_at descending (newest first)
                const sorted = [...result].sort((a, b) => 
                    Number(b.created_at) - Number(a.created_at)
                );
                setConfigs(sorted);
            } catch (error) {
                console.error('Error loading jailbreak configs:', error);
            } finally {
                setLoading(false);
            }
        };
        loadConfigs();
    }, [isAuthenticated, backendActor]);
    
    // Load individual SNS logo
    const loadSnsLogo = async (governanceId) => {
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
    };
    
    // Get SNS info by root canister ID
    const getSnsInfo = useCallback((rootCanisterId) => {
        const rootText = rootCanisterId.toString();
        return snsList.find(s => s.rootCanisterId === rootText);
    }, [snsList]);
    
    // Format date
    const formatDate = (nanoseconds) => {
        const ms = Number(nanoseconds) / 1_000_000;
        return new Date(ms).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });
    };
    
    // Fetch base script and show modal
    const openScriptModal = async (config) => {
        setSelectedConfig(config);
        setScriptError('');
        setCopied(false);
        
        if (baseScript) {
            // Already have the base script
            return;
        }
        
        setLoadingScript(true);
        try {
            const response = await fetch(RAW_GITHUB_BASE_URL);
            if (!response.ok) {
                throw new Error(`Failed to fetch: ${response.status} ${response.statusText}`);
            }
            const script = await response.text();
            setBaseScript(script);
        } catch (error) {
            console.error('Error fetching base script:', error);
            setScriptError(`Failed to load base script: ${error.message}`);
        } finally {
            setLoadingScript(false);
        }
    };
    
    // Generate script for a config
    const generateScript = useCallback((config) => {
        if (!config || !baseScript) return '';
        
        const snsInfo = getSnsInfo(config.sns_root_canister_id);
        const governanceId = snsInfo?.canisters?.governance || '';
        
        if (!governanceId) return '';
        
        const customScript = `
// ============================================================
// SNS Jailbreak Script - Generated by Sneed Hub
// ============================================================
// This script adds a controller to your SNS neuron
// GitHub Source: ${RAW_GITHUB_BASE_URL}
// ============================================================

// Custom parameters:
const GOVERNANCE_ID = "${governanceId}";
const NEURON_ID = "${config.neuron_id_hex}";
const NEW_CONTROLLER = "${config.target_principal.toString()}";

// Execute after base script is ready
(async () => {
    console.log('🔓 Adding controller to SNS neuron...');
    console.log('  Governance: ' + GOVERNANCE_ID);
    console.log('  Neuron ID: ' + NEURON_ID);
    console.log('  New Controller: ' + NEW_CONTROLLER);
    
    try {
        await yolosns.addControllerToNeuron(
            GOVERNANCE_ID,
            NEURON_ID,
            NEW_CONTROLLER
        );
        console.log('✅ Controller added successfully!');
        console.log('🎉 Your neuron is now jailbroken! You can manage it from Sneed Hub.');
    } catch (error) {
        console.error('❌ Error adding controller:', error);
    }
})();
`;
        
        return baseScript + '\n\n' + customScript;
    }, [baseScript, getSnsInfo]);
    
    // Copy to clipboard
    const handleCopy = async () => {
        if (!selectedConfig) return;
        const script = generateScript(selectedConfig);
        try {
            await navigator.clipboard.writeText(script);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch (e) {
            console.error('Failed to copy:', e);
        }
    };
    
    // Delete a config
    const handleDelete = async (id) => {
        if (!backendActor) return;
        setDeletingId(id);
        try {
            const result = await backendActor.delete_jailbreak_config(BigInt(id));
            if ('ok' in result) {
                setConfigs(prev => prev.filter(c => Number(c.id) !== id));
            } else {
                console.error('Failed to delete config:', result.err);
            }
        } catch (error) {
            console.error('Error deleting config:', error);
        } finally {
            setDeletingId(null);
            setConfirmDelete(null);
        }
    };
    
    const styles = {
        container: {
            maxWidth: '900px',
            margin: '0 auto',
            padding: '1.5rem 1rem',
            color: theme.colors.primaryText,
        },
        card: {
            background: theme.colors.cardGradient,
            border: `1px solid ${theme.colors.border}`,
            borderRadius: '16px',
            padding: '1.5rem',
            marginBottom: '1rem',
            boxShadow: theme.colors.cardShadow,
        },
        emptyState: {
            textAlign: 'center',
            padding: '2.5rem 1.5rem',
            background: theme.colors.cardGradient,
            border: `1px solid ${theme.colors.border}`,
            borderRadius: '20px',
            boxShadow: theme.colors.cardShadow,
        },
        configItem: {
            display: 'flex',
            alignItems: 'flex-start',
            gap: '14px',
            padding: '14px',
            background: theme.colors.cardGradient,
            border: `1px solid ${theme.colors.border}`,
            borderRadius: '14px',
            marginBottom: '10px',
            flexWrap: 'wrap',
            boxShadow: theme.colors.cardShadow,
        },
        snsLogo: {
            width: '48px',
            height: '48px',
            minWidth: '48px',
            minHeight: '48px',
            maxWidth: '48px',
            maxHeight: '48px',
            borderRadius: '50%',
            objectFit: 'cover',
            background: theme.colors.secondaryBg,
            flexShrink: 0,
            padding: 0,
            margin: 0,
            border: `2px solid ${theme.colors.border}`,
        },
        configInfo: {
            flex: '1 1 200px',
            minWidth: '150px',
        },
        configActions: {
            display: 'flex',
            gap: '8px',
            flexShrink: 0,
            flexWrap: 'wrap',
        },
        actionButton: (color) => ({
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px',
            padding: '10px 16px',
            background: `linear-gradient(135deg, ${color || jailbreakPrimary}, ${color || jailbreakPrimary}dd)`,
            border: 'none',
            borderRadius: '10px',
            color: '#fff',
            cursor: 'pointer',
            fontSize: '0.85rem',
            fontWeight: '600',
            transition: 'all 0.2s ease',
            boxShadow: `0 4px 12px ${color || jailbreakPrimary}30`,
        }),
        iconButton: (color) => ({
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '38px',
            height: '38px',
            background: `${color || theme.colors.border}15`,
            border: `1px solid ${color || theme.colors.border}50`,
            borderRadius: '10px',
            color: color || theme.colors.mutedText,
            cursor: 'pointer',
            transition: 'all 0.2s ease',
        }),
        modal: {
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0, 0, 0, 0.85)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '1rem',
        },
        modalContent: {
            background: theme.colors.primaryBg,
            borderRadius: '20px',
            maxWidth: '700px',
            width: '100%',
            maxHeight: '90vh',
            overflow: 'auto',
            padding: '1.5rem',
            border: `1px solid ${theme.colors.border}`,
            boxShadow: `0 20px 60px rgba(0,0,0,0.4)`,
        },
        modalHeader: {
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '1.25rem',
        },
        codeBlock: {
            background: theme.colors.primaryBg,
            border: `1px solid ${theme.colors.border}`,
            borderRadius: '10px',
            padding: '1rem',
            fontFamily: 'monospace',
            fontSize: '0.8rem',
            color: theme.colors.primaryText,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
            maxHeight: '350px',
            overflow: 'auto',
        },
        loadingContainer: {
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '3rem',
            gap: '1rem',
        },
        backLink: {
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            color: jailbreakPrimary,
            textDecoration: 'none',
            marginBottom: '1rem',
            fontWeight: '500',
            fontSize: '0.9rem',
        },
        deleteConfirm: {
            background: `${theme.colors.error}10`,
            border: `1px solid ${theme.colors.error}30`,
            borderRadius: '10px',
            padding: '12px',
            marginTop: '10px',
        },
        loginPrompt: {
            textAlign: 'center',
            padding: '2.5rem 1.5rem',
            background: theme.colors.cardGradient,
            border: `1px solid ${theme.colors.border}`,
            borderRadius: '20px',
            boxShadow: theme.colors.cardShadow,
        },
    };
    
    if (!isAuthenticated) {
        return (
            <div className='page-container' style={{ background: theme.colors.primaryGradient, minHeight: '100vh' }}>
                <style>{customStyles}</style>
                <Header />
                <main style={styles.container}>
                    <div className="jailbreak-list-fade-in" style={styles.loginPrompt}>
                        <div className="jailbreak-list-float" style={{
                            width: '72px',
                            height: '72px',
                            borderRadius: '18px',
                            background: `linear-gradient(135deg, ${jailbreakPrimary}, ${jailbreakSecondary})`,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            margin: '0 auto 1.5rem',
                            boxShadow: `0 8px 32px ${jailbreakPrimary}50`,
                        }}>
                            <FaList size={28} style={{ color: '#fff' }} />
                        </div>
                        <h2 style={{ color: theme.colors.primaryText, marginBottom: '0.75rem', fontSize: '1.5rem', fontWeight: '700' }}>
                            My Jailbreak Scripts
                        </h2>
                        <p style={{ fontSize: '1rem', color: theme.colors.secondaryText }}>
                            Please log in to view your saved jailbreak scripts
                        </p>
                    </div>
                </main>
            </div>
        );
    }
    
    return (
        <div className='page-container' style={{ background: theme.colors.primaryGradient, minHeight: '100vh' }}>
            <style>{customStyles}</style>
            <Header />
            
            {/* Hero Banner */}
            <div style={{
                background: `linear-gradient(135deg, ${theme.colors.primaryBg} 0%, ${jailbreakPrimary}12 50%, ${jailbreakSecondary}08 100%)`,
                borderBottom: `1px solid ${theme.colors.border}`,
                padding: '1.5rem 1rem',
                position: 'relative',
                overflow: 'hidden',
                width: '100%',
                boxSizing: 'border-box'
            }}>
                {/* Background decorations */}
                <div style={{
                    position: 'absolute',
                    top: '-50%',
                    right: '-5%',
                    width: '300px',
                    height: '300px',
                    background: `radial-gradient(circle, ${jailbreakPrimary}15 0%, transparent 70%)`,
                    pointerEvents: 'none'
                }} />
                
                <div style={{ maxWidth: '900px', margin: '0 auto', textAlign: 'center', position: 'relative', zIndex: 1 }}>
                    <div style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '8px',
                        background: `${jailbreakPrimary}20`,
                        color: jailbreakPrimary,
                        padding: '6px 14px',
                        borderRadius: '20px',
                        fontSize: '0.8rem',
                        fontWeight: '600',
                        marginBottom: '0.5rem'
                    }}>
                        <FaList size={12} /> Saved Configurations
                    </div>
                    <h1 style={{
                        fontSize: '1.75rem',
                        fontWeight: '700',
                        color: theme.colors.primaryText,
                        margin: '0.5rem 0',
                        letterSpacing: '-0.5px'
                    }}>
                        My Jailbreak Scripts
                    </h1>
                    <p style={{
                        color: theme.colors.secondaryText,
                        fontSize: '0.95rem',
                        margin: 0
                    }}>
                        View and regenerate scripts for previously configured neuron jailbreaks
                    </p>
                </div>
            </div>
            
            <main style={styles.container}>
                <Link to="/tools/sns_jailbreak" style={styles.backLink}>
                    <FaArrowLeft size={12} />
                    Back to SNS Jailbreak Wizard
                </Link>
                
                {loading ? (
                    <div className="jailbreak-list-fade-in" style={styles.loadingContainer}>
                        <FaSpinner size={32} className="jailbreak-list-spin" style={{ color: jailbreakPrimary }} />
                        <p style={{ color: theme.colors.mutedText }}>Loading saved scripts...</p>
                    </div>
                ) : configs.length === 0 ? (
                    <div className="jailbreak-list-fade-in" style={styles.emptyState}>
                        <div style={{
                            width: '64px',
                            height: '64px',
                            borderRadius: '16px',
                            background: `${jailbreakPrimary}15`,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            margin: '0 auto 1.25rem',
                        }}>
                            <FaBrain size={28} style={{ color: jailbreakPrimary }} />
                        </div>
                        <h2 style={{ color: theme.colors.primaryText, marginBottom: '0.5rem', fontSize: '1.25rem', fontWeight: '700' }}>
                            No saved scripts yet
                        </h2>
                        <p style={{ color: theme.colors.mutedText, marginBottom: '1.5rem', fontSize: '0.95rem' }}>
                            Jailbreak a neuron to save the configuration for easy script regeneration later.
                        </p>
                        <Link
                            to="/tools/sns_jailbreak"
                            style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '8px',
                                padding: '12px 24px',
                                background: `linear-gradient(135deg, ${jailbreakPrimary}, ${jailbreakSecondary})`,
                                color: '#fff',
                                borderRadius: '12px',
                                textDecoration: 'none',
                                fontWeight: '600',
                                boxShadow: `0 4px 16px ${jailbreakPrimary}40`,
                            }}
                        >
                            <FaPlus />
                            Create Jailbreak Script
                        </Link>
                    </div>
                ) : (
                    <div>
                        {configs.map(config => {
                            const snsInfo = getSnsInfo(config.sns_root_canister_id);
                            const governanceId = snsInfo?.canisters?.governance;
                            const logo = governanceId ? snsLogos.get(governanceId) : null;
                            const isLoadingLogo = governanceId && loadingLogos.has(governanceId);
                            const isDeleting = deletingId === Number(config.id);
                            const showDeleteConfirm = confirmDelete === Number(config.id);
                            
                            return (
                                <div key={Number(config.id)} style={styles.configItem}>
                                    {/* SNS Logo */}
                                    {isLoadingLogo ? (
                                        <div style={{ ...styles.snsLogo, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                            <FaSpinner size={20} style={{ ...styles.spinner, color: theme.colors.mutedText }} />
                                        </div>
                                    ) : logo ? (
                                        <img src={logo} alt={snsInfo?.name} style={styles.snsLogo} />
                                    ) : (
                                        <div style={{ ...styles.snsLogo, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                            <FaBrain size={24} style={{ color: theme.colors.mutedText }} />
                                        </div>
                                    )}
                                    
                                    {/* Config Info */}
                                    <div style={styles.configInfo}>
                                        <div style={{ fontWeight: '600', color: theme.colors.primaryText, marginBottom: '4px' }}>
                                            {snsInfo?.name || 'Unknown SNS'}
                                        </div>
                                        <div style={{ fontSize: '0.8rem', color: theme.colors.mutedText, marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                            <span>Neuron:</span>
                                            <NeuronDisplay
                                                neuronId={config.neuron_id_hex}
                                                snsRoot={config.sns_root_canister_id.toString()}
                                                showCopyButton={false}
                                                enableContextMenu={false}
                                                isAuthenticated={isAuthenticated}
                                                noLink={true}
                                                style={{ fontSize: '0.8rem' }}
                                            />
                                        </div>
                                        <div style={{ fontSize: '0.8rem', color: theme.colors.mutedText, marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                            <span>Controller:</span>
                                            <PrincipalDisplay
                                                principal={config.target_principal}
                                                showCopyButton={false}
                                                enableContextMenu={false}
                                                isAuthenticated={isAuthenticated}
                                                noLink={true}
                                                style={{ fontSize: '0.8rem' }}
                                            />
                                        </div>
                                        <div style={{ fontSize: '0.75rem', color: theme.colors.mutedText }}>
                                            Created: {formatDate(config.created_at)}
                                        </div>
                                        
                                        {/* Delete confirmation */}
                                        {showDeleteConfirm && (
                                            <div style={styles.deleteConfirm}>
                                                <p style={{ color: theme.colors.error, fontSize: '0.9rem', marginBottom: '8px' }}>
                                                    Are you sure you want to delete this saved script?
                                                </p>
                                                <div style={{ display: 'flex', gap: '8px' }}>
                                                    <button
                                                        onClick={() => handleDelete(Number(config.id))}
                                                        disabled={isDeleting}
                                                        style={{
                                                            ...styles.actionButton(theme.colors.error),
                                                            opacity: isDeleting ? 0.6 : 1,
                                                        }}
                                                    >
                                                        {isDeleting ? <FaSpinner style={styles.spinner} /> : 'Yes, Delete'}
                                                    </button>
                                                    <button
                                                        onClick={() => setConfirmDelete(null)}
                                                        style={{
                                                            ...styles.actionButton(theme.colors.secondaryBg),
                                                            color: theme.colors.primaryText,
                                                            border: `1px solid ${theme.colors.border}`,
                                                        }}
                                                    >
                                                        Cancel
                                                    </button>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                    
                                    {/* Actions */}
                                    {!showDeleteConfirm && (
                                        <div style={styles.configActions}>
                                            <button
                                                onClick={() => openScriptModal(config)}
                                                style={styles.actionButton(theme.colors.accent)}
                                                title="Generate Script"
                                            >
                                                <FaCode />
                                                Script
                                            </button>
                                            <Link
                                                to={`/neuron?sns=${config.sns_root_canister_id.toString()}&neuronid=${config.neuron_id_hex}`}
                                                style={{
                                                    ...styles.iconButton(theme.colors.accent),
                                                    textDecoration: 'none',
                                                    display: 'flex',
                                                }}
                                                title="View Neuron"
                                            >
                                                <FaExternalLinkAlt size={14} />
                                            </Link>
                                            <button
                                                onClick={() => setConfirmDelete(Number(config.id))}
                                                style={styles.iconButton(theme.colors.error)}
                                                title="Delete"
                                            >
                                                <FaTrash size={14} />
                                            </button>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
                
                {/* Script Modal */}
                {selectedConfig && (
                    <div style={styles.modal} onClick={() => setSelectedConfig(null)}>
                        <div className="jailbreak-list-fade-in" style={styles.modalContent} onClick={(e) => e.stopPropagation()}>
                            <div style={styles.modalHeader}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                    <div style={{
                                        width: '40px',
                                        height: '40px',
                                        borderRadius: '10px',
                                        background: `linear-gradient(135deg, ${jailbreakPrimary}20, ${jailbreakPrimary}10)`,
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                    }}>
                                        <FaCode size={18} style={{ color: jailbreakPrimary }} />
                                    </div>
                                    <h2 style={{ color: theme.colors.primaryText, margin: 0, fontSize: '1.25rem', fontWeight: '700' }}>
                                        Generated Script
                                    </h2>
                                </div>
                                <button
                                    onClick={() => setSelectedConfig(null)}
                                    style={{
                                        background: theme.colors.tertiaryBg,
                                        border: `1px solid ${theme.colors.border}`,
                                        color: theme.colors.mutedText,
                                        cursor: 'pointer',
                                        fontSize: '1.25rem',
                                        padding: '4px 10px',
                                        borderRadius: '8px',
                                    }}
                                >
                                    ×
                                </button>
                            </div>
                            
                            {/* Summary */}
                            <div style={{ 
                                background: theme.colors.secondaryBg, 
                                borderRadius: '8px', 
                                padding: '12px', 
                                marginBottom: '1rem',
                            }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
                                    {(() => {
                                        const snsInfo = getSnsInfo(selectedConfig.sns_root_canister_id);
                                        const logo = snsInfo?.canisters?.governance ? snsLogos.get(snsInfo.canisters.governance) : null;
                                        return logo ? (
                                            <img src={logo} alt={snsInfo?.name} style={{ width: '32px', height: '32px', minWidth: '32px', minHeight: '32px', maxWidth: '32px', maxHeight: '32px', borderRadius: '50%', objectFit: 'cover', padding: 0, margin: 0 }} />
                                        ) : (
                                            <FaBrain size={24} style={{ color: theme.colors.mutedText }} />
                                        );
                                    })()}
                                    <div>
                                        <div style={{ fontWeight: '600', color: theme.colors.primaryText }}>
                                            {getSnsInfo(selectedConfig.sns_root_canister_id)?.name || 'Unknown SNS'}
                                        </div>
                                        <div style={{ fontSize: '0.8rem', color: theme.colors.mutedText, display: 'flex', alignItems: 'center', gap: '4px' }}>
                                            <span>Neuron:</span>
                                            <NeuronDisplay
                                                neuronId={selectedConfig.neuron_id_hex}
                                                snsRoot={selectedConfig.sns_root_canister_id.toString()}
                                                showCopyButton={false}
                                                enableContextMenu={false}
                                                isAuthenticated={isAuthenticated}
                                                noLink={true}
                                                style={{ fontSize: '0.8rem' }}
                                            />
                                        </div>
                                    </div>
                                </div>
                                <div style={{ fontSize: '0.85rem', color: theme.colors.mutedText, display: 'flex', alignItems: 'center', gap: '4px' }}>
                                    <span>Adding controller:</span>
                                    <PrincipalDisplay
                                        principal={selectedConfig.target_principal}
                                        showCopyButton={true}
                                        enableContextMenu={false}
                                        isAuthenticated={isAuthenticated}
                                        noLink={true}
                                        style={{ fontSize: '0.85rem' }}
                                    />
                                </div>
                            </div>
                            
                            {loadingScript ? (
                                <div style={styles.loadingContainer}>
                                    <FaSpinner size={32} style={{ ...styles.spinner, color: theme.colors.accent }} />
                                    <p style={{ color: theme.colors.mutedText }}>Loading script from GitHub...</p>
                                </div>
                            ) : scriptError ? (
                                <div style={{ textAlign: 'center', padding: '2rem' }}>
                                    <FaExclamationTriangle size={32} style={{ color: theme.colors.error, marginBottom: '1rem' }} />
                                    <p style={{ color: theme.colors.error, marginBottom: '1rem' }}>{scriptError}</p>
                                    <button
                                        onClick={() => openScriptModal(selectedConfig)}
                                        style={styles.actionButton(theme.colors.accent)}
                                    >
                                        Retry
                                    </button>
                                </div>
                            ) : (
                                <>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '10px' }}>
                                        <span style={{ color: theme.colors.mutedText, fontSize: '0.85rem' }}>
                                            Copy and paste this script into the NNS app browser console
                                        </span>
                                        <button
                                            onClick={handleCopy}
                                            style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '6px',
                                                background: copied 
                                                    ? `linear-gradient(135deg, ${theme.colors.success}, ${theme.colors.success}dd)` 
                                                    : `linear-gradient(135deg, ${jailbreakPrimary}, ${jailbreakSecondary})`,
                                                color: '#fff',
                                                border: 'none',
                                                padding: '10px 18px',
                                                borderRadius: '10px',
                                                cursor: 'pointer',
                                                fontWeight: '600',
                                                fontSize: '0.9rem',
                                                boxShadow: copied 
                                                    ? `0 4px 12px ${theme.colors.success}40` 
                                                    : `0 4px 12px ${jailbreakPrimary}40`,
                                            }}
                                        >
                                            {copied ? <FaCheck size={14} /> : <FaCopy size={14} />}
                                            {copied ? 'Copied!' : 'Copy Script'}
                                        </button>
                                    </div>
                                    <pre style={styles.codeBlock}>
                                        {generateScript(selectedConfig)}
                                    </pre>
                                </>
                            )}
                        </div>
                    </div>
                )}
            </main>
        </div>
    );
}

export default SnsJailbreakList;
