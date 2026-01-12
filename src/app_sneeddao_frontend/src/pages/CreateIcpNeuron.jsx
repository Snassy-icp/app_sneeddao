import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { HttpAgent } from '@dfinity/agent';
import { Principal } from '@dfinity/principal';
import { sha224 } from '@dfinity/principal/lib/esm/utils/sha224';
import { createActor as createFactoryActor, canisterId as factoryCanisterId } from 'external/sneed_icp_neuron_manager_factory';
import { createActor as createLedgerActor } from 'external/icrc1_ledger';

const ICP_LEDGER_CANISTER_ID = 'ryjl3-tyaaa-aaaaa-aaaba-cai';
import Header from '../components/Header';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../AuthContext';

function CreateIcpNeuron() {
    const { theme } = useTheme();
    const { identity, isAuthenticated, login } = useAuth();
    const [managers, setManagers] = useState([]);
    const [balances, setBalances] = useState({}); // canisterId -> balance in e8s
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
            
            // Fetch balances for all managers
            if (result.length > 0) {
                fetchBalances(result, agent);
            }
        } catch (err) {
            console.error('Error fetching managers:', err);
            setError('Failed to load your neuron managers');
        } finally {
            setLoading(false);
        }
    };

    const fetchBalances = async (managerList, agent) => {
        try {
            const ledger = createLedgerActor(ICP_LEDGER_CANISTER_ID, { agent });
            const newBalances = {};
            
            // Fetch balances in parallel
            const balancePromises = managerList.map(async (manager) => {
                try {
                    // ICRC-1 uses { owner, subaccount } format
                    const balance = await ledger.icrc1_balance_of({
                        owner: manager.canisterId,
                        subaccount: [],
                    });
                    return { canisterId: manager.canisterId.toText(), balance: Number(balance) };
                } catch (err) {
                    console.error(`Error fetching balance for ${manager.canisterId.toText()}:`, err);
                    return { canisterId: manager.canisterId.toText(), balance: null };
                }
            });
            
            const results = await Promise.all(balancePromises);
            results.forEach(({ canisterId, balance }) => {
                newBalances[canisterId] = balance;
            });
            
            setBalances(newBalances);
        } catch (err) {
            console.error('Error fetching balances:', err);
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

    const formatIcp = (e8s) => {
        if (e8s === null || e8s === undefined) return '...';
        const icp = e8s / 100_000_000;
        return icp.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 8 });
    };

    const copyToClipboard = (text) => {
        navigator.clipboard.writeText(text);
    };

    // Compute account ID from principal (same algorithm as the canister)
    const computeAccountId = (principal) => {
        try {
            const principalBytes = principal.toUint8Array();
            // Domain separator: 0x0a + "account-id"
            const domainSeparator = new Uint8Array([0x0a, ...new TextEncoder().encode('account-id')]);
            // Subaccount: 32 zero bytes (default subaccount)
            const subaccount = new Uint8Array(32);
            // Preimage: domain separator + principal bytes + subaccount
            const preimage = new Uint8Array(domainSeparator.length + principalBytes.length + subaccount.length);
            preimage.set(domainSeparator, 0);
            preimage.set(principalBytes, domainSeparator.length);
            preimage.set(subaccount, domainSeparator.length + principalBytes.length);
            // SHA-224 hash
            const hash = sha224(preimage);
            // CRC32 checksum
            const crc = crc32(hash);
            // Account ID: CRC32 (4 bytes) + hash (28 bytes)
            const accountId = new Uint8Array(32);
            accountId[0] = (crc >> 24) & 0xff;
            accountId[1] = (crc >> 16) & 0xff;
            accountId[2] = (crc >> 8) & 0xff;
            accountId[3] = crc & 0xff;
            accountId.set(hash, 4);
            return Array.from(accountId).map(b => b.toString(16).padStart(2, '0')).join('');
        } catch (err) {
            console.error('Error computing account ID:', err);
            return null;
        }
    };

    // CRC32 implementation
    const crc32 = (data) => {
        let crc = 0xffffffff;
        const table = getCrc32Table();
        for (let i = 0; i < data.length; i++) {
            crc = (crc >>> 8) ^ table[(crc ^ data[i]) & 0xff];
        }
        return (crc ^ 0xffffffff) >>> 0;
    };

    const getCrc32Table = () => {
        const table = new Uint32Array(256);
        for (let i = 0; i < 256; i++) {
            let c = i;
            for (let j = 0; j < 8; j++) {
                c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
            }
            table[i] = c;
        }
        return table;
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
                                {managers.map((manager, index) => {
                                    const accountId = computeAccountId(manager.canisterId);
                                    const canisterIdText = manager.canisterId.toText();
                                    const balance = balances[canisterIdText];
                                    return (
                                        <div key={canisterIdText} style={cardStyle}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '10px' }}>
                                                <div style={{ flex: 1, minWidth: '250px' }}>
                                                    <div style={{ color: theme.colors.mutedText, fontSize: '12px', marginBottom: '4px' }}>
                                                        Canister ID
                                                    </div>
                                                    <div style={{ color: theme.colors.primaryText, fontFamily: 'monospace', fontSize: '14px' }}>
                                                        {canisterIdText}
                                                        <button 
                                                            style={smallButtonStyle}
                                                            onClick={() => copyToClipboard(canisterIdText)}
                                                        >
                                                            Copy
                                                        </button>
                                                    </div>
                                                </div>
                                                <div style={{ textAlign: 'right' }}>
                                                    <div style={{ color: theme.colors.mutedText, fontSize: '12px' }}>
                                                        ICP Balance
                                                    </div>
                                                    <div style={{ 
                                                        color: balance > 0 ? (theme.colors.success || '#22c55e') : theme.colors.primaryText, 
                                                        fontSize: '18px', 
                                                        fontWeight: '600' 
                                                    }}>
                                                        {formatIcp(balance)} ICP
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Account ID for funding */}
                                            {accountId && (
                                                <div style={{ marginTop: '12px' }}>
                                                    <div style={{ color: theme.colors.mutedText, fontSize: '12px', marginBottom: '4px' }}>
                                                        Account ID (send ICP here to fund)
                                                    </div>
                                                    <div style={{ 
                                                        color: theme.colors.accent, 
                                                        fontFamily: 'monospace', 
                                                        fontSize: '12px',
                                                        wordBreak: 'break-all',
                                                        background: `${theme.colors.accent}10`,
                                                        padding: '8px',
                                                        borderRadius: '4px',
                                                    }}>
                                                        {accountId}
                                                        <button 
                                                            style={{ ...smallButtonStyle, marginTop: '4px' }}
                                                            onClick={() => copyToClipboard(accountId)}
                                                        >
                                                            Copy
                                                        </button>
                                                    </div>
                                                </div>
                                            )}
                                            
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
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                                                        <span style={{ color: theme.colors.mutedText, fontSize: '12px', flexShrink: 0 }}>
                                                            Version {Number(manager.version.major)}.{Number(manager.version.minor)}.{Number(manager.version.patch)}
                                                        </span>
                                                        <Link 
                                                            to={`/icp_neuron_manager/${canisterIdText}`}
                                                            style={{
                                                                background: theme.colors.accent,
                                                                color: '#fff',
                                                                padding: '8px 16px',
                                                                borderRadius: '6px',
                                                                textDecoration: 'none',
                                                                fontSize: '13px',
                                                                fontWeight: '600',
                                                            }}
                                                        >
                                                            Manage →
                                                        </Link>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
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

