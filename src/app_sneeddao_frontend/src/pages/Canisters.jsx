import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../AuthContext';
import { Link } from 'react-router-dom';
import Header from '../components/Header';
import { useTheme } from '../contexts/ThemeContext';
import { Principal } from '@dfinity/principal';
import { HttpAgent } from '@dfinity/agent';
import { getTrackedCanisters, registerTrackedCanister, unregisterTrackedCanister } from '../utils/BackendUtils';
import { PrincipalDisplay, getPrincipalDisplayInfoFromContext } from '../utils/PrincipalUtils';
import { useNaming } from '../NamingContext';
import { FaPlus, FaTrash, FaCube, FaSpinner, FaChevronDown, FaChevronRight, FaBrain } from 'react-icons/fa';
import { createActor as createFactoryActor, canisterId as factoryCanisterId } from 'declarations/sneed_icp_neuron_manager_factory';
import { createActor as createManagerActor } from 'declarations/sneed_icp_neuron_manager';

export default function CanistersPage() {
    const { theme } = useTheme();
    const { identity, isAuthenticated } = useAuth();
    const { principalNames, principalNicknames } = useNaming();
    const [canisters, setCanisters] = useState([]);
    const [loading, setLoading] = useState(true);
    const [newCanisterId, setNewCanisterId] = useState('');
    const [addingCanister, setAddingCanister] = useState(false);
    const [removingCanister, setRemovingCanister] = useState(null);
    const [confirmRemoveCanister, setConfirmRemoveCanister] = useState(null);
    const [error, setError] = useState(null);
    const [successMessage, setSuccessMessage] = useState(null);
    
    // Neuron Managers state
    const [neuronManagers, setNeuronManagers] = useState([]);
    const [loadingNeuronManagers, setLoadingNeuronManagers] = useState(true);
    const [newManagerId, setNewManagerId] = useState('');
    const [addingManager, setAddingManager] = useState(false);
    const [removingManager, setRemovingManager] = useState(null);
    const [confirmRemoveManager, setConfirmRemoveManager] = useState(null);
    const [managerError, setManagerError] = useState(null);
    
    // Collapsible section states
    const [customExpanded, setCustomExpanded] = useState(() => {
        try {
            const saved = localStorage.getItem('canisters_customExpanded');
            return saved !== null ? JSON.parse(saved) : true;
        } catch { return true; }
    });
    const [neuronManagersExpanded, setNeuronManagersExpanded] = useState(() => {
        try {
            const saved = localStorage.getItem('canisters_neuronManagersExpanded');
            return saved !== null ? JSON.parse(saved) : true;
        } catch { return true; }
    });

    // Fetch neuron managers
    const fetchNeuronManagers = useCallback(async () => {
        if (!identity) {
            setNeuronManagers([]);
            setLoadingNeuronManagers(false);
            return;
        }
        
        setLoadingNeuronManagers(true);
        try {
            const host = process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging' 
                ? 'https://ic0.app' 
                : 'http://localhost:4943';
            const agent = new HttpAgent({ identity, host });
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
            }
            
            const factory = createFactoryActor(factoryCanisterId, { agent });
            const canisterIds = await factory.getMyManagers(); // Now returns [Principal]
            
            // Fetch current version and neuron count from each canister
            const managersWithInfo = await Promise.all(
                canisterIds.map(async (canisterIdPrincipal) => {
                    const canisterId = canisterIdPrincipal.toString();
                    try {
                        const managerActor = createManagerActor(canisterId, { agent });
                        const [currentVersion, neuronIds] = await Promise.all([
                            managerActor.getVersion(),
                            managerActor.getNeuronIds(),
                        ]);
                        return { 
                            canisterId: canisterIdPrincipal, 
                            version: currentVersion,
                            neuronCount: neuronIds?.length || 0,
                        };
                    } catch (err) {
                        console.error(`Error fetching info for ${canisterId}:`, err);
                        return { canisterId: canisterIdPrincipal, version: { major: 0, minor: 0, patch: 0 }, neuronCount: 0 };
                    }
                })
            );
            
            setNeuronManagers(managersWithInfo);
        } catch (err) {
            console.error('Error loading neuron managers:', err);
        } finally {
            setLoadingNeuronManagers(false);
        }
    }, [identity]);

    // Load tracked canisters on mount and when identity changes
    useEffect(() => {
        const loadCanisters = async () => {
            if (!identity) {
                setCanisters([]);
                setLoading(false);
                return;
            }

            setLoading(true);
            try {
                const result = await getTrackedCanisters(identity);
                setCanisters(result.map(p => p.toString()));
            } catch (err) {
                console.error('Error loading tracked canisters:', err);
                setError('Failed to load tracked canisters');
            } finally {
                setLoading(false);
            }
        };

        loadCanisters();
        fetchNeuronManagers();
    }, [identity, fetchNeuronManagers]);
    
    // Persist collapsible states
    useEffect(() => {
        try { localStorage.setItem('canisters_customExpanded', JSON.stringify(customExpanded)); } catch {}
    }, [customExpanded]);
    
    useEffect(() => {
        try { localStorage.setItem('canisters_neuronManagersExpanded', JSON.stringify(neuronManagersExpanded)); } catch {}
    }, [neuronManagersExpanded]);

    // Clear messages after timeout
    useEffect(() => {
        if (error) {
            const timeout = setTimeout(() => setError(null), 5000);
            return () => clearTimeout(timeout);
        }
    }, [error]);

    useEffect(() => {
        if (successMessage) {
            const timeout = setTimeout(() => setSuccessMessage(null), 3000);
            return () => clearTimeout(timeout);
        }
    }, [successMessage]);

    const handleAddCanister = async () => {
        if (!newCanisterId.trim()) return;

        // Validate principal format
        let canisterPrincipal;
        try {
            canisterPrincipal = Principal.fromText(newCanisterId.trim());
        } catch (err) {
            setError('Invalid canister ID format');
            return;
        }

        // Check if already tracked
        if (canisters.includes(canisterPrincipal.toString())) {
            setError('This canister is already being tracked');
            return;
        }

        setAddingCanister(true);
        setError(null);

        try {
            await registerTrackedCanister(identity, canisterPrincipal);
            setCanisters(prev => [canisterPrincipal.toString(), ...prev]);
            setNewCanisterId('');
            setSuccessMessage('Canister added to tracking list');
        } catch (err) {
            console.error('Error adding canister:', err);
            setError('Failed to add canister');
        } finally {
            setAddingCanister(false);
        }
    };

    const handleRemoveCanister = async (canisterId) => {
        setRemovingCanister(canisterId);
        setError(null);

        try {
            await unregisterTrackedCanister(identity, canisterId);
            setCanisters(prev => prev.filter(c => c !== canisterId));
            setSuccessMessage('Canister removed from tracking list');
        } catch (err) {
            console.error('Error removing canister:', err);
            setError('Failed to remove canister');
        } finally {
            setRemovingCanister(null);
        }
    };

    const handleAddManager = async () => {
        if (!newManagerId.trim()) return;

        let canisterId;
        try {
            canisterId = Principal.fromText(newManagerId.trim());
        } catch (err) {
            setManagerError('Invalid canister ID format');
            return;
        }

        setAddingManager(true);
        setManagerError(null);

        try {
            const host = process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging' 
                ? 'https://ic0.app' 
                : 'http://localhost:4943';
            const agent = new HttpAgent({ identity, host });
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
            }
            
            const factory = createFactoryActor(factoryCanisterId, { agent });
            const result = await factory.registerManager(canisterId);
            
            if ('Err' in result) {
                throw new Error(result.Err);
            }
            
            await fetchNeuronManagers();
            setNewManagerId('');
            setSuccessMessage('Manager added to list');
        } catch (err) {
            console.error('Error adding manager:', err);
            setManagerError(err.message || 'Failed to add manager');
        } finally {
            setAddingManager(false);
        }
    };

    const handleRemoveManager = async (canisterId) => {
        setRemovingManager(canisterId.toString());
        setManagerError(null);

        try {
            const host = process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging' 
                ? 'https://ic0.app' 
                : 'http://localhost:4943';
            const agent = new HttpAgent({ identity, host });
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
            }
            
            const factory = createFactoryActor(factoryCanisterId, { agent });
            const result = await factory.deregisterManager(canisterId);
            
            if ('Err' in result) {
                throw new Error(result.Err);
            }
            
            await fetchNeuronManagers();
            setSuccessMessage('Manager removed from list');
        } catch (err) {
            console.error('Error removing manager:', err);
            setManagerError(err.message || 'Failed to remove manager');
        } finally {
            setRemovingManager(null);
        }
    };

    const styles = {
        pageContainer: {
            minHeight: '100vh',
            backgroundColor: theme.colors.background,
            color: theme.colors.text,
        },
        container: {
            maxWidth: '900px',
            margin: '0 auto',
            padding: '24px',
        },
        title: {
            fontSize: '28px',
            fontWeight: 600,
            marginBottom: '24px',
            color: theme.colors.text,
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
        },
        addSection: {
            backgroundColor: theme.colors.card,
            borderRadius: '12px',
            padding: '20px',
            marginBottom: '24px',
            border: `1px solid ${theme.colors.border}`,
        },
        addSectionTitle: {
            fontSize: '16px',
            fontWeight: 500,
            marginBottom: '12px',
            color: theme.colors.textSecondary,
        },
        inputRow: {
            display: 'flex',
            gap: '12px',
            alignItems: 'center',
        },
        input: {
            flex: 1,
            padding: '12px 16px',
            borderRadius: '8px',
            border: `1px solid ${theme.colors.border}`,
            backgroundColor: theme.colors.inputBackground,
            color: theme.colors.text,
            fontSize: '14px',
            fontFamily: 'monospace',
            outline: 'none',
        },
        addButton: {
            padding: '12px 20px',
            borderRadius: '8px',
            border: 'none',
            backgroundColor: (addingCanister || !newCanisterId.trim()) ? '#6c757d' : '#28a745',
            color: '#fff',
            fontSize: '14px',
            fontWeight: 600,
            cursor: (addingCanister || !newCanisterId.trim()) ? 'not-allowed' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            transition: 'all 0.2s',
            opacity: (addingCanister || !newCanisterId.trim()) ? 0.6 : 1,
        },
        canisterList: {
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
        },
        canisterCard: {
            backgroundColor: theme.colors.card,
            borderRadius: '12px',
            padding: '16px 20px',
            border: `1px solid ${theme.colors.border}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            transition: 'border-color 0.2s',
        },
        canisterInfo: {
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            flex: 1,
        },
        canisterIcon: {
            width: '40px',
            height: '40px',
            borderRadius: '8px',
            backgroundColor: theme.colors.primary + '20',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: theme.colors.primary,
        },
        canisterId: {
            fontFamily: 'monospace',
            fontSize: '14px',
            color: theme.colors.text,
            wordBreak: 'break-all',
        },
        canisterLink: {
            color: theme.colors.primary,
            textDecoration: 'none',
            fontFamily: 'monospace',
            fontSize: '14px',
        },
        removeButton: {
            padding: '8px 12px',
            borderRadius: '6px',
            border: `1px solid ${theme.colors.border}`,
            backgroundColor: 'transparent',
            color: theme.colors.textSecondary,
            fontSize: '14px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            transition: 'all 0.2s',
        },
        removeButtonHover: {
            borderColor: '#dc3545',
            color: '#dc3545',
        },
        emptyState: {
            textAlign: 'center',
            padding: '48px 24px',
            backgroundColor: theme.colors.card,
            borderRadius: '12px',
            border: `1px solid ${theme.colors.border}`,
        },
        emptyIcon: {
            fontSize: '48px',
            color: theme.colors.textSecondary,
            marginBottom: '16px',
            opacity: 0.5,
        },
        emptyText: {
            fontSize: '16px',
            color: theme.colors.textSecondary,
            marginBottom: '8px',
        },
        emptySubtext: {
            fontSize: '14px',
            color: theme.colors.textSecondary,
            opacity: 0.7,
        },
        message: {
            padding: '12px 16px',
            borderRadius: '8px',
            marginBottom: '16px',
            fontSize: '14px',
        },
        errorMessage: {
            backgroundColor: '#dc354520',
            color: '#dc3545',
            border: '1px solid #dc354540',
        },
        successMessage: {
            backgroundColor: '#28a74520',
            color: '#28a745',
            border: '1px solid #28a74540',
        },
        loadingSpinner: {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '48px',
            color: theme.colors.textSecondary,
        },
        notLoggedIn: {
            textAlign: 'center',
            padding: '48px 24px',
            backgroundColor: theme.colors.card,
            borderRadius: '12px',
            border: `1px solid ${theme.colors.border}`,
        },
        viewLink: {
            padding: '8px 16px',
            borderRadius: '6px',
            backgroundColor: theme.colors.primary + '15',
            color: theme.colors.primary,
            textDecoration: 'none',
            fontSize: '13px',
            fontWeight: 500,
        },
        sectionHeader: {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '16px 0',
            cursor: 'pointer',
            borderBottom: `1px solid ${theme.colors.border}`,
            marginBottom: '16px',
        },
        sectionTitle: {
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            fontSize: '18px',
            fontWeight: 600,
            color: theme.colors.text,
        },
        sectionCount: {
            fontSize: '14px',
            fontWeight: 400,
            color: theme.colors.textSecondary,
            backgroundColor: theme.colors.primary + '15',
            padding: '2px 10px',
            borderRadius: '12px',
        },
        sectionToggle: {
            color: theme.colors.textSecondary,
            fontSize: '14px',
        },
        managerCard: {
            backgroundColor: theme.colors.card,
            borderRadius: '12px',
            padding: '16px 20px',
            border: `1px solid ${theme.colors.border}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
            flexWrap: 'wrap',
        },
        managerInfo: {
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            flex: 1,
            minWidth: '200px',
        },
        managerIcon: {
            width: '40px',
            height: '40px',
            borderRadius: '8px',
            backgroundColor: '#8b5cf620',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#8b5cf6',
        },
        managerVersion: {
            fontSize: '11px',
            color: theme.colors.textSecondary,
            backgroundColor: theme.colors.inputBackground,
            padding: '2px 8px',
            borderRadius: '10px',
        },
    };

    return (
        <div style={styles.pageContainer}>
            <Header />
            <div style={styles.container}>
                <h1 style={styles.title}>
                    <FaCube /> Tracked Canisters
                </h1>

                {!isAuthenticated ? (
                    <div style={styles.notLoggedIn}>
                        <div style={styles.emptyIcon}>🔒</div>
                        <div style={styles.emptyText}>Please log in to track canisters</div>
                        <div style={styles.emptySubtext}>
                            You can track any canister on the Internet Computer to quickly access its details.
                        </div>
                    </div>
                ) : (
                    <>
                        {/* Messages */}
                        {error && (
                            <div style={{ ...styles.message, ...styles.errorMessage }}>
                                {error}
                            </div>
                        )}
                        {successMessage && (
                            <div style={{ ...styles.message, ...styles.successMessage }}>
                                {successMessage}
                            </div>
                        )}

                        {/* Add canister section */}
                        <div style={styles.addSection}>
                            <div style={styles.addSectionTitle}>Add a canister to track</div>
                            <div style={styles.inputRow}>
                                <input
                                    type="text"
                                    placeholder="Enter canister ID (e.g., ryjl3-tyaaa-aaaaa-aaaba-cai)"
                                    value={newCanisterId}
                                    onChange={(e) => setNewCanisterId(e.target.value)}
                                    onKeyDown={(e) => e.key === 'Enter' && handleAddCanister()}
                                    style={styles.input}
                                    disabled={addingCanister}
                                />
                                <button
                                    onClick={handleAddCanister}
                                    style={styles.addButton}
                                    disabled={addingCanister || !newCanisterId.trim()}
                                >
                                    {addingCanister ? (
                                        <FaSpinner className="spin" />
                                    ) : (
                                        <FaPlus />
                                    )}
                                    Add
                                </button>
                            </div>
                        </div>

                        {/* Custom Canisters Section */}
                        <div 
                            style={styles.sectionHeader}
                            onClick={() => setCustomExpanded(!customExpanded)}
                        >
                            <div style={styles.sectionTitle}>
                                {customExpanded ? <FaChevronDown /> : <FaChevronRight />}
                                <FaCube />
                                Custom
                                {canisters.length > 0 && (
                                    <span style={styles.sectionCount}>{canisters.length}</span>
                                )}
                            </div>
                        </div>
                        
                        {customExpanded && (
                            <>
                                {loading ? (
                                    <div style={styles.loadingSpinner}>
                                        <FaSpinner className="spin" size={24} />
                                    </div>
                                ) : canisters.length === 0 ? (
                                    <div style={{ ...styles.emptyState, marginBottom: '24px' }}>
                                        <div style={styles.emptyIcon}>📦</div>
                                        <div style={styles.emptyText}>No custom canisters being tracked</div>
                                        <div style={styles.emptySubtext}>
                                            Add a canister ID above to start tracking it.
                                        </div>
                                    </div>
                                ) : (
                                    <div style={{ ...styles.canisterList, marginBottom: '24px' }}>
                                        {canisters.map((canisterId) => {
                                            const displayInfo = getPrincipalDisplayInfoFromContext(canisterId, principalNames, principalNicknames);
                                            
                                            return (
                                            <div 
                                                key={canisterId} 
                                                style={styles.canisterCard}
                                            >
                                                <div style={styles.canisterInfo}>
                                                    <div style={styles.canisterIcon}>
                                                        <FaCube size={18} />
                                                    </div>
                                                    <PrincipalDisplay
                                                        principal={canisterId}
                                                        displayInfo={displayInfo}
                                                        showCopyButton={true}
                                                        isAuthenticated={isAuthenticated}
                                                        noLink={true}
                                                        style={{ fontSize: '14px' }}
                                                        showSendMessage={false}
                                                        showViewProfile={false}
                                                    />
                                                </div>
                                                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                                    <Link
                                                        to={`/canister?id=${canisterId}`}
                                                        style={styles.viewLink}
                                                    >
                                                        View Details
                                                    </Link>
                                                    {confirmRemoveCanister === canisterId ? (
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }} onClick={(e) => e.stopPropagation()}>
                                                            <span style={{ 
                                                                color: '#888', 
                                                                fontSize: '11px',
                                                                whiteSpace: 'nowrap'
                                                            }}>
                                                                Remove?
                                                            </span>
                                                            <button
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    setConfirmRemoveCanister(null);
                                                                    handleRemoveCanister(canisterId);
                                                                }}
                                                                disabled={removingCanister === canisterId}
                                                                style={{
                                                                    backgroundColor: '#ef4444',
                                                                    color: '#fff',
                                                                    border: 'none',
                                                                    borderRadius: '4px',
                                                                    padding: '4px 10px',
                                                                    cursor: removingCanister === canisterId ? 'not-allowed' : 'pointer',
                                                                    fontSize: '12px',
                                                                    fontWeight: '500',
                                                                    opacity: removingCanister === canisterId ? 0.7 : 1,
                                                                }}
                                                            >
                                                                {removingCanister === canisterId ? '...' : 'Yes'}
                                                            </button>
                                                            <button
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    setConfirmRemoveCanister(null);
                                                                }}
                                                                style={{
                                                                    backgroundColor: '#2a2a2a',
                                                                    color: '#fff',
                                                                    border: '1px solid #3a3a3a',
                                                                    borderRadius: '4px',
                                                                    padding: '4px 10px',
                                                                    cursor: 'pointer',
                                                                    fontSize: '12px',
                                                                }}
                                                            >
                                                                No
                                                            </button>
                                                        </div>
                                                    ) : (
                                                        <button
                                                            onClick={(e) => { 
                                                                e.stopPropagation(); 
                                                                setConfirmRemoveCanister(canisterId);
                                                            }}
                                                            style={styles.removeButton}
                                                            disabled={removingCanister === canisterId}
                                                            title="Remove from tracking"
                                                        >
                                                            {removingCanister === canisterId ? (
                                                                <FaSpinner className="spin" />
                                                            ) : (
                                                                <FaTrash />
                                                            )}
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </>
                        )}

                        {/* ICP Neuron Managers Section */}
                        <div 
                            style={styles.sectionHeader}
                            onClick={() => setNeuronManagersExpanded(!neuronManagersExpanded)}
                        >
                            <div style={styles.sectionTitle}>
                                {neuronManagersExpanded ? <FaChevronDown /> : <FaChevronRight />}
                                <FaBrain style={{ color: '#8b5cf6' }} />
                                ICP Neuron Managers
                                {neuronManagers.length > 0 && (
                                    <span style={styles.sectionCount}>{neuronManagers.length}</span>
                                )}
                            </div>
                            <Link 
                                to="/create_icp_neuron"
                                onClick={(e) => e.stopPropagation()}
                                style={{
                                    padding: '6px 12px',
                                    borderRadius: '8px',
                                    border: 'none',
                                    backgroundColor: '#8b5cf6',
                                    color: '#fff',
                                    fontSize: '12px',
                                    fontWeight: 600,
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '6px',
                                    textDecoration: 'none',
                                }}
                            >
                                <FaPlus size={10} /> Create
                            </Link>
                        </div>
                        
                        {neuronManagersExpanded && (
                            <>
                                {/* Add existing manager input */}
                                <div style={{ ...styles.addSection, marginBottom: '16px' }}>
                                    <div style={styles.addSectionTitle}>Add existing manager</div>
                                    <div style={styles.inputRow}>
                                        <input
                                            type="text"
                                            placeholder="Enter neuron manager canister ID"
                                            value={newManagerId}
                                            onChange={(e) => {
                                                setNewManagerId(e.target.value);
                                                setManagerError(null);
                                            }}
                                            onKeyDown={(e) => e.key === 'Enter' && handleAddManager()}
                                            style={styles.input}
                                            disabled={addingManager}
                                        />
                                        <button
                                            onClick={handleAddManager}
                                            style={{
                                                ...styles.addButton,
                                                backgroundColor: (addingManager || !newManagerId.trim()) ? '#6c757d' : '#8b5cf6',
                                                cursor: (addingManager || !newManagerId.trim()) ? 'not-allowed' : 'pointer',
                                                opacity: (addingManager || !newManagerId.trim()) ? 0.6 : 1,
                                            }}
                                            disabled={addingManager || !newManagerId.trim()}
                                        >
                                            {addingManager ? (
                                                <FaSpinner className="spin" />
                                            ) : (
                                                <FaPlus />
                                            )}
                                            Add
                                        </button>
                                    </div>
                                    {managerError && (
                                        <div style={{ color: '#dc3545', fontSize: '13px', marginTop: '8px' }}>
                                            {managerError}
                                        </div>
                                    )}
                                </div>

                                {loadingNeuronManagers ? (
                                    <div style={styles.loadingSpinner}>
                                        <FaSpinner className="spin" size={24} />
                                    </div>
                                ) : neuronManagers.length === 0 ? (
                                    <div style={styles.emptyState}>
                                        <div style={styles.emptyIcon}>🧠</div>
                                        <div style={styles.emptyText}>No ICP Neuron Managers</div>
                                        <div style={styles.emptySubtext}>
                                            <Link to="/create_icp_neuron" style={{ color: theme.colors.primary }}>
                                                Create your first neuron manager →
                                            </Link>
                                        </div>
                                    </div>
                                ) : (
                                    <div style={styles.canisterList}>
                                        {neuronManagers.map((manager) => {
                                            const canisterId = manager.canisterId.toText();
                                            const displayInfo = getPrincipalDisplayInfoFromContext(canisterId, principalNames, principalNicknames);
                                            
                                            return (
                                                <div 
                                                    key={canisterId} 
                                                    style={styles.managerCard}
                                                >
                                                    <div style={styles.managerInfo}>
                                                        <div style={styles.managerIcon}>
                                                            <FaBrain size={18} />
                                                        </div>
                                                        <div>
                                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                                                                <PrincipalDisplay
                                                                    principal={canisterId}
                                                                    displayInfo={displayInfo}
                                                                    showCopyButton={true}
                                                                    isAuthenticated={isAuthenticated}
                                                                    noLink={true}
                                                                    style={{ fontSize: '14px' }}
                                                                    showSendMessage={false}
                                                                    showViewProfile={false}
                                                                />
                                                            </div>
                                                            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                                                <span style={styles.managerVersion}>
                                                                    v{Number(manager.version.major)}.{Number(manager.version.minor)}.{Number(manager.version.patch)}
                                                                </span>
                                                                <span style={{
                                                                    ...styles.managerVersion,
                                                                    backgroundColor: manager.neuronCount > 0 ? '#8b5cf620' : theme.colors.inputBackground,
                                                                    color: manager.neuronCount > 0 ? '#8b5cf6' : theme.colors.textSecondary,
                                                                }}>
                                                                    🧠 {manager.neuronCount} neuron{manager.neuronCount !== 1 ? 's' : ''}
                                                                </span>
                                                            </div>
                                                        </div>
                                                    </div>
                                                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                                        <Link
                                                            to={`/icp_neuron_manager/${canisterId}`}
                                                            style={{
                                                                ...styles.viewLink,
                                                                backgroundColor: '#8b5cf615',
                                                                color: '#8b5cf6',
                                                            }}
                                                        >
                                                            Manage
                                                        </Link>
                                                        <Link
                                                            to={`/canister?id=${canisterId}`}
                                                            style={styles.viewLink}
                                                        >
                                                            Details
                                                        </Link>
                                                        {confirmRemoveManager === canisterId ? (
                                                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }} onClick={(e) => e.stopPropagation()}>
                                                                <span style={{ 
                                                                    color: '#888', 
                                                                    fontSize: '11px',
                                                                    whiteSpace: 'nowrap'
                                                                }}>
                                                                    Remove?
                                                                </span>
                                                                <button
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        setConfirmRemoveManager(null);
                                                                        handleRemoveManager(manager.canisterId);
                                                                    }}
                                                                    disabled={removingManager === canisterId}
                                                                    style={{
                                                                        backgroundColor: '#ef4444',
                                                                        color: '#fff',
                                                                        border: 'none',
                                                                        borderRadius: '4px',
                                                                        padding: '4px 10px',
                                                                        cursor: removingManager === canisterId ? 'not-allowed' : 'pointer',
                                                                        fontSize: '12px',
                                                                        fontWeight: '500',
                                                                        opacity: removingManager === canisterId ? 0.7 : 1,
                                                                    }}
                                                                >
                                                                    {removingManager === canisterId ? '...' : 'Yes'}
                                                                </button>
                                                                <button
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        setConfirmRemoveManager(null);
                                                                    }}
                                                                    style={{
                                                                        backgroundColor: '#2a2a2a',
                                                                        color: '#fff',
                                                                        border: '1px solid #3a3a3a',
                                                                        borderRadius: '4px',
                                                                        padding: '4px 10px',
                                                                        cursor: 'pointer',
                                                                        fontSize: '12px',
                                                                    }}
                                                                >
                                                                    No
                                                                </button>
                                                            </div>
                                                        ) : (
                                                            <button
                                                                onClick={(e) => { 
                                                                    e.stopPropagation(); 
                                                                    setConfirmRemoveManager(canisterId);
                                                                }}
                                                                style={styles.removeButton}
                                                                disabled={removingManager === canisterId}
                                                                title="Remove from list (does not delete canister)"
                                                            >
                                                                {removingManager === canisterId ? (
                                                                    <FaSpinner className="spin" />
                                                                ) : (
                                                                    <FaTrash />
                                                                )}
                                                            </button>
                                                        )}
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </>
                        )}
                    </>
                )}
            </div>

            {/* Spinner animation */}
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

