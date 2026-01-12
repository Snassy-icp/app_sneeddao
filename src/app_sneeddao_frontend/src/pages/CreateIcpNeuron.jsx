import React, { useState, useEffect } from 'react';
import { HttpAgent } from '@dfinity/agent';
import { Principal } from '@dfinity/principal';
import { createActor as createFactoryActor, canisterId as factoryCanisterId } from 'external/sneed_icp_neuron_manager_factory';
import Header from '../components/Header';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../AuthContext';

function CreateIcpNeuron() {
    const { theme } = useTheme();
    const { identity, isAuthenticated, login } = useAuth();
    const [managers, setManagers] = useState([]);
    const [loading, setLoading] = useState(false);
    const [creating, setCreating] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [factoryInfo, setFactoryInfo] = useState(null);

    useEffect(() => {
        if (isAuthenticated && identity) {
            fetchMyManagers();
            fetchFactoryInfo();
        }
    }, [isAuthenticated, identity]);

    const getAgent = () => {
        const host = process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging' 
            ? 'https://ic0.app' 
            : 'http://localhost:4943';
        return new HttpAgent({ identity, host });
    };

    const fetchFactoryInfo = async () => {
        try {
            const agent = getAgent();
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
            }
            const factory = createFactoryActor(factoryCanisterId, { agent });
            
            const [version, cyclesBalance, managerCount] = await Promise.all([
                factory.getCurrentVersion(),
                factory.getCyclesBalance(),
                factory.getManagerCount(),
            ]);
            
            setFactoryInfo({
                version: `${version.major}.${version.minor}.${version.patch}`,
                cyclesBalance: Number(cyclesBalance),
                managerCount: Number(managerCount),
            });
        } catch (err) {
            console.error('Error fetching factory info:', err);
        }
    };

    const fetchMyManagers = async () => {
        setLoading(true);
        try {
            const agent = getAgent();
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
            }
            const factory = createFactoryActor(factoryCanisterId, { agent });
            const result = await factory.getMyManagers();
            setManagers(result);
            setError('');
        } catch (err) {
            console.error('Error fetching managers:', err);
            setError('Failed to load your neuron managers');
        } finally {
            setLoading(false);
        }
    };

    const handleCreateManager = async () => {
        if (!isAuthenticated) {
            login();
            return;
        }

        setCreating(true);
        setError('');
        setSuccess('');
        
        try {
            const agent = getAgent();
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
            }
            const factory = createFactoryActor(factoryCanisterId, { agent });
            const result = await factory.createNeuronManager();
            
            if ('Ok' in result) {
                const { canisterId, accountId } = result.Ok;
                const accountIdHex = Array.from(accountId).map(b => b.toString(16).padStart(2, '0')).join('');
                setSuccess(`🎉 Neuron Manager Created!\n\nCanister ID: ${canisterId.toText()}\n\nAccount ID (for funding): ${accountIdHex}`);
                fetchMyManagers();
                fetchFactoryInfo();
            } else if ('Err' in result) {
                const err = result.Err;
                if ('InsufficientCycles' in err) {
                    setError('Factory has insufficient cycles to create a new canister. Please try again later.');
                } else if ('CanisterCreationFailed' in err) {
                    setError(`Canister creation failed: ${err.CanisterCreationFailed}`);
                } else if ('NotAuthorized' in err) {
                    setError('Not authorized to create a neuron manager.');
                } else {
                    setError('Failed to create neuron manager');
                }
            }
        } catch (err) {
            console.error('Error creating manager:', err);
            setError(`Error: ${err.message || 'Failed to create neuron manager'}`);
        } finally {
            setCreating(false);
        }
    };

    const formatAccountId = (accountId) => {
        const hex = Array.from(accountId).map(b => b.toString(16).padStart(2, '0')).join('');
        return hex;
    };

    const formatDate = (timestamp) => {
        try {
            const date = new Date(Number(timestamp) / 1000000);
            return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
        } catch (err) {
            return 'Unknown';
        }
    };

    const copyToClipboard = (text) => {
        navigator.clipboard.writeText(text);
    };

    const cardStyle = {
        background: theme.colors.cardBackground,
        borderRadius: '12px',
        padding: '20px',
        marginBottom: '20px',
        border: `1px solid ${theme.colors.border}`,
    };

    const buttonStyle = {
        background: theme.colors.accent,
        color: '#fff',
        border: 'none',
        borderRadius: '8px',
        padding: '12px 24px',
        fontSize: '16px',
        fontWeight: '600',
        cursor: 'pointer',
        transition: 'opacity 0.2s',
    };

    const smallButtonStyle = {
        background: 'transparent',
        color: theme.colors.accent,
        border: `1px solid ${theme.colors.accent}`,
        borderRadius: '4px',
        padding: '4px 8px',
        fontSize: '12px',
        cursor: 'pointer',
        marginLeft: '8px',
    };

    return (
        <div className='page-container' style={{ background: theme.colors.primaryGradient, minHeight: '100vh' }}>
            <Header />
            <main className="wallet-container">
                <h1 style={{ color: theme.colors.primaryText, marginBottom: '10px', textAlign: 'center' }}>
                    ICP Neuron Manager
                </h1>
                <p style={{ color: theme.colors.mutedText, textAlign: 'center', marginBottom: '30px' }}>
                    Create dedicated canisters to manage your ICP NNS neurons
                </p>

                {/* Factory Info */}
                {factoryInfo && (
                    <div style={{ ...cardStyle, textAlign: 'center', marginBottom: '30px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-around', flexWrap: 'wrap', gap: '20px' }}>
                            <div>
                                <div style={{ color: theme.colors.mutedText, fontSize: '12px' }}>Version</div>
                                <div style={{ color: theme.colors.primaryText, fontSize: '18px', fontWeight: '600' }}>
                                    v{factoryInfo.version}
                                </div>
                            </div>
                            <div>
                                <div style={{ color: theme.colors.mutedText, fontSize: '12px' }}>Total Managers</div>
                                <div style={{ color: theme.colors.primaryText, fontSize: '18px', fontWeight: '600' }}>
                                    {factoryInfo.managerCount}
                                </div>
                            </div>
                            <div>
                                <div style={{ color: theme.colors.mutedText, fontSize: '12px' }}>Factory Cycles</div>
                                <div style={{ color: theme.colors.primaryText, fontSize: '18px', fontWeight: '600' }}>
                                    {(factoryInfo.cyclesBalance / 1_000_000_000_000).toFixed(2)}T
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* Not authenticated message */}
                {!isAuthenticated && (
                    <div style={{ ...cardStyle, textAlign: 'center' }}>
                        <p style={{ color: theme.colors.mutedText, marginBottom: '20px' }}>
                            Please log in to create and manage your ICP neuron managers.
                        </p>
                        <button style={buttonStyle} onClick={login}>
                            Login with Internet Identity
                        </button>
                    </div>
                )}

                {/* Create button */}
                {isAuthenticated && (
                    <div style={{ textAlign: 'center', marginBottom: '30px' }}>
                        <button 
                            style={{ 
                                ...buttonStyle, 
                                opacity: creating ? 0.7 : 1,
                                cursor: creating ? 'not-allowed' : 'pointer',
                            }} 
                            onClick={handleCreateManager}
                            disabled={creating}
                        >
                            {creating ? '⏳ Creating...' : '➕ Create New Neuron Manager'}
                        </button>
                        <p style={{ color: theme.colors.mutedText, fontSize: '13px', marginTop: '10px' }}>
                            Each manager controls one ICP neuron. You can create multiple managers.
                        </p>
                    </div>
                )}

                {/* Success message */}
                {success && (
                    <div style={{ 
                        backgroundColor: `${theme.colors.success || '#22c55e'}20`, 
                        border: `1px solid ${theme.colors.success || '#22c55e'}`,
                        color: theme.colors.success || '#22c55e',
                        padding: '20px',
                        borderRadius: '8px',
                        marginBottom: '20px',
                        whiteSpace: 'pre-line',
                        fontFamily: 'monospace',
                    }}>
                        {success}
                    </div>
                )}

                {/* Error message */}
                {error && (
                    <div style={{ 
                        backgroundColor: `${theme.colors.error}20`, 
                        border: `1px solid ${theme.colors.error}`,
                        color: theme.colors.error,
                        padding: '15px',
                        borderRadius: '8px',
                        marginBottom: '20px',
                        textAlign: 'center'
                    }}>
                        {error}
                    </div>
                )}

                {/* My Managers List */}
                {isAuthenticated && (
                    <>
                        <h2 style={{ color: theme.colors.primaryText, marginBottom: '20px' }}>
                            Your Neuron Managers {managers.length > 0 && `(${managers.length})`}
                        </h2>

                        {loading ? (
                            <div style={{ textAlign: 'center', padding: '40px', color: theme.colors.primaryText }}>
                                Loading your managers...
                            </div>
                        ) : managers.length === 0 ? (
                            <div style={{ ...cardStyle, textAlign: 'center' }}>
                                <p style={{ color: theme.colors.mutedText }}>
                                    You haven't created any neuron managers yet.
                                </p>
                                <p style={{ color: theme.colors.mutedText, fontSize: '14px', marginTop: '10px' }}>
                                    Click "Create New Neuron Manager" above to get started!
                                </p>
                            </div>
                        ) : (
                            <div>
                                {managers.map((manager, index) => (
                                    <div key={manager.canisterId.toText()} style={cardStyle}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '10px' }}>
                                            <div style={{ flex: 1, minWidth: '250px' }}>
                                                <div style={{ color: theme.colors.mutedText, fontSize: '12px', marginBottom: '4px' }}>
                                                    Canister ID
                                                </div>
                                                <div style={{ color: theme.colors.primaryText, fontFamily: 'monospace', fontSize: '14px' }}>
                                                    {manager.canisterId.toText()}
                                                    <button 
                                                        style={smallButtonStyle}
                                                        onClick={() => copyToClipboard(manager.canisterId.toText())}
                                                    >
                                                        Copy
                                                    </button>
                                                </div>
                                            </div>
                                            <div style={{ textAlign: 'right' }}>
                                                <div style={{ color: theme.colors.mutedText, fontSize: '12px' }}>
                                                    Created
                                                </div>
                                                <div style={{ color: theme.colors.primaryText, fontSize: '14px' }}>
                                                    {formatDate(manager.createdAt)}
                                                </div>
                                            </div>
                                        </div>
                                        
                                        <div style={{ marginTop: '15px', paddingTop: '15px', borderTop: `1px solid ${theme.colors.border}` }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
                                                <div>
                                                    <span style={{ color: theme.colors.mutedText, fontSize: '12px' }}>Neuron: </span>
                                                    {manager.neuronId && manager.neuronId.length > 0 ? (
                                                        <span style={{ color: theme.colors.success || '#22c55e', fontFamily: 'monospace' }}>
                                                            #{manager.neuronId[0].id.toString()}
                                                        </span>
                                                    ) : (
                                                        <span style={{ color: theme.colors.warning || '#f59e0b' }}>
                                                            Not created yet
                                                        </span>
                                                    )}
                                                </div>
                                                <div>
                                                    <span style={{ 
                                                        color: theme.colors.mutedText, 
                                                        fontSize: '12px',
                                                        background: `${theme.colors.accent}20`,
                                                        padding: '4px 8px',
                                                        borderRadius: '4px',
                                                    }}>
                                                        v{manager.version.major}.{manager.version.minor}.{manager.version.patch}
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* Refresh button */}
                        {managers.length > 0 && (
                            <div style={{ textAlign: 'center', marginTop: '20px' }}>
                                <button 
                                    style={{ ...smallButtonStyle, marginLeft: 0 }}
                                    onClick={fetchMyManagers}
                                    disabled={loading}
                                >
                                    🔄 Refresh List
                                </button>
                            </div>
                        )}
                    </>
                )}

                {/* Info section */}
                <div style={{ ...cardStyle, marginTop: '40px' }}>
                    <h3 style={{ color: theme.colors.primaryText, marginBottom: '15px' }}>How It Works</h3>
                    <ol style={{ color: theme.colors.mutedText, lineHeight: '1.8', paddingLeft: '20px' }}>
                        <li><strong>Create a Manager:</strong> Each manager is a dedicated canister that will control one ICP neuron.</li>
                        <li><strong>Fund the Manager:</strong> Send ICP to your manager canister's account.</li>
                        <li><strong>Stake a Neuron:</strong> Use the manager to stake ICP and create an NNS neuron.</li>
                        <li><strong>Manage Your Neuron:</strong> Vote, set dissolve delay, manage maturity, and more.</li>
                        <li><strong>Transfer Ownership:</strong> Transfer neuron ownership by transferring control of the canister.</li>
                    </ol>
                </div>
            </main>
        </div>
    );
}

export default CreateIcpNeuron;

