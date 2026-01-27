import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { FaArrowLeft, FaCheck, FaSpinner, FaUnlock, FaCopy, FaExternalLinkAlt, FaBrain, FaTrash, FaPlus, FaExclamationTriangle, FaCode } from 'react-icons/fa';
import { Principal } from '@dfinity/principal';
import Header from '../components/Header';
import { useAuth } from '../AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { useNaming } from '../NamingContext';
import { fetchAndCacheSnsData, fetchSnsLogo, getSnsById } from '../utils/SnsUtils';
import { createActor as createBackendActor, canisterId as backendCanisterId } from 'declarations/app_sneeddao_backend';
import { HttpAgent } from '@dfinity/agent';

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
            maxWidth: '1000px',
            margin: '0 auto',
            padding: '2rem',
            color: theme.colors.primaryText,
        },
        hero: {
            textAlign: 'center',
            marginBottom: '2rem',
        },
        title: {
            fontSize: '2.2rem',
            marginBottom: '0.5rem',
            color: theme.colors.primaryText,
            fontWeight: 'bold',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '12px',
        },
        subtitle: {
            fontSize: '1.1rem',
            color: theme.colors.mutedText,
            marginBottom: '1rem',
            lineHeight: '1.5',
        },
        card: {
            background: theme.colors.cardGradient,
            border: `1px solid ${theme.colors.border}`,
            borderRadius: '16px',
            padding: '1.5rem',
            marginBottom: '1rem',
        },
        emptyState: {
            textAlign: 'center',
            padding: '3rem',
            background: theme.colors.cardGradient,
            border: `1px solid ${theme.colors.border}`,
            borderRadius: '16px',
        },
        configItem: {
            display: 'flex',
            alignItems: 'center',
            gap: '16px',
            padding: '16px',
            background: theme.colors.cardGradient,
            border: `1px solid ${theme.colors.border}`,
            borderRadius: '12px',
            marginBottom: '12px',
        },
        snsLogo: {
            width: '48px',
            height: '48px',
            borderRadius: '50%',
            objectFit: 'cover',
            background: theme.colors.secondaryBg,
            flexShrink: 0,
        },
        configInfo: {
            flex: 1,
            minWidth: 0,
        },
        configActions: {
            display: 'flex',
            gap: '8px',
            flexShrink: 0,
        },
        actionButton: (color) => ({
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px',
            padding: '8px 16px',
            background: color || theme.colors.accent,
            border: 'none',
            borderRadius: '8px',
            color: theme.colors.primaryBg,
            cursor: 'pointer',
            fontSize: '0.9rem',
            fontWeight: '500',
            transition: 'all 0.2s ease',
        }),
        iconButton: (color) => ({
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '36px',
            height: '36px',
            background: `${color || theme.colors.border}20`,
            border: `1px solid ${color || theme.colors.border}`,
            borderRadius: '8px',
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
            background: 'rgba(0, 0, 0, 0.8)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '2rem',
        },
        modalContent: {
            background: theme.colors.primaryBg,
            borderRadius: '16px',
            maxWidth: '800px',
            width: '100%',
            maxHeight: '90vh',
            overflow: 'auto',
            padding: '2rem',
            border: `1px solid ${theme.colors.border}`,
        },
        modalHeader: {
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '1.5rem',
        },
        codeBlock: {
            background: theme.colors.secondaryBg,
            border: `1px solid ${theme.colors.border}`,
            borderRadius: '8px',
            padding: '1rem',
            fontFamily: 'monospace',
            fontSize: '0.85rem',
            color: theme.colors.primaryText,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
            maxHeight: '400px',
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
        spinner: {
            animation: 'spin 1s linear infinite',
        },
        backLink: {
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            color: theme.colors.accent,
            textDecoration: 'none',
            marginBottom: '1rem',
        },
        deleteConfirm: {
            background: `${theme.colors.error}10`,
            border: `1px solid ${theme.colors.error}30`,
            borderRadius: '8px',
            padding: '12px',
            marginTop: '8px',
        },
    };
    
    const spinnerKeyframes = `
        @keyframes spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
        }
    `;
    
    if (!isAuthenticated) {
        return (
            <div className='page-container' style={{ background: theme.colors.primaryGradient, minHeight: '100vh' }}>
                <Header />
                <main style={styles.container}>
                    <div style={styles.emptyState}>
                        <FaUnlock size={48} style={{ color: theme.colors.mutedText, marginBottom: '1rem' }} />
                        <p style={{ fontSize: '1.2rem', color: theme.colors.secondaryText }}>
                            Please log in to view your saved jailbreak scripts
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
                <Link to="/tools/sns_jailbreak" style={styles.backLink}>
                    <FaArrowLeft size={14} />
                    Back to SNS Jailbreak Wizard
                </Link>
                
                <div style={styles.hero}>
                    <h1 style={styles.title}>
                        <FaUnlock style={{ color: theme.colors.accent }} />
                        My Jailbreak Scripts
                    </h1>
                    <p style={styles.subtitle}>
                        View and regenerate scripts for previously configured neuron jailbreaks
                    </p>
                </div>
                
                {loading ? (
                    <div style={styles.loadingContainer}>
                        <FaSpinner size={32} style={{ ...styles.spinner, color: theme.colors.accent }} />
                        <p style={{ color: theme.colors.mutedText }}>Loading saved scripts...</p>
                    </div>
                ) : configs.length === 0 ? (
                    <div style={styles.emptyState}>
                        <FaBrain size={48} style={{ color: theme.colors.mutedText, marginBottom: '1rem' }} />
                        <h2 style={{ color: theme.colors.primaryText, marginBottom: '0.5rem' }}>
                            No saved scripts yet
                        </h2>
                        <p style={{ color: theme.colors.mutedText, marginBottom: '1.5rem' }}>
                            Jailbreak a neuron to save the configuration for easy script regeneration later.
                        </p>
                        <Link
                            to="/tools/sns_jailbreak"
                            style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '8px',
                                padding: '12px 24px',
                                background: theme.colors.accent,
                                color: theme.colors.primaryBg,
                                borderRadius: '10px',
                                textDecoration: 'none',
                                fontWeight: '600',
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
                                        <div style={{ fontSize: '0.8rem', color: theme.colors.mutedText, marginBottom: '4px' }}>
                                            Neuron: {config.neuron_id_hex.slice(0, 16)}...{config.neuron_id_hex.slice(-8)}
                                        </div>
                                        <div style={{ fontSize: '0.8rem', color: theme.colors.mutedText, marginBottom: '4px' }}>
                                            Controller: {config.target_principal.toString().slice(0, 15)}...
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
                        <div style={styles.modalContent} onClick={(e) => e.stopPropagation()}>
                            <div style={styles.modalHeader}>
                                <h2 style={{ color: theme.colors.primaryText, margin: 0 }}>
                                    Generated Script
                                </h2>
                                <button
                                    onClick={() => setSelectedConfig(null)}
                                    style={{
                                        background: 'none',
                                        border: 'none',
                                        color: theme.colors.mutedText,
                                        cursor: 'pointer',
                                        fontSize: '1.5rem',
                                        padding: '4px',
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
                                            <img src={logo} alt={snsInfo?.name} style={{ width: '32px', height: '32px', borderRadius: '50%' }} />
                                        ) : (
                                            <FaBrain size={24} style={{ color: theme.colors.mutedText }} />
                                        );
                                    })()}
                                    <div>
                                        <div style={{ fontWeight: '600', color: theme.colors.primaryText }}>
                                            {getSnsInfo(selectedConfig.sns_root_canister_id)?.name || 'Unknown SNS'}
                                        </div>
                                        <div style={{ fontSize: '0.8rem', color: theme.colors.mutedText }}>
                                            Neuron: {selectedConfig.neuron_id_hex.slice(0, 16)}...
                                        </div>
                                    </div>
                                </div>
                                <div style={{ fontSize: '0.85rem', color: theme.colors.mutedText }}>
                                    Adding controller: <span style={{ fontFamily: 'monospace', color: theme.colors.accent }}>
                                        {selectedConfig.target_principal.toString()}
                                    </span>
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
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                                        <span style={{ color: theme.colors.mutedText, fontSize: '0.9rem' }}>
                                            Copy and paste this script into the NNS app browser console
                                        </span>
                                        <button
                                            onClick={handleCopy}
                                            style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '6px',
                                                background: copied ? theme.colors.success : theme.colors.accent,
                                                color: theme.colors.primaryBg,
                                                border: 'none',
                                                padding: '8px 16px',
                                                borderRadius: '6px',
                                                cursor: 'pointer',
                                                fontWeight: '500',
                                            }}
                                        >
                                            {copied ? <FaCheck /> : <FaCopy />}
                                            {copied ? 'Copied!' : 'Copy'}
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
