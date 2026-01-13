import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { HttpAgent } from '@dfinity/agent';
import { Principal } from '@dfinity/principal';
import { sha224 } from '@dfinity/principal/lib/esm/utils/sha224';
import { createActor as createManagerActor } from 'declarations/sneed_icp_neuron_manager';
import { createActor as createLedgerActor } from 'external/icrc1_ledger';
import Header from '../components/Header';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../AuthContext';

const ICP_LEDGER_CANISTER_ID = 'ryjl3-tyaaa-aaaaa-aaaba-cai';
const E8S = 100_000_000;

// NNS Governance Topics
const NNS_TOPICS = [
    { id: 0, name: 'Catch-all (Unspecified)', description: 'Default topic for proposals that don\'t fit elsewhere' },
    { id: 1, name: 'Neuron Management', description: 'Proposals about neuron-related changes' },
    { id: 3, name: 'Network Economics', description: 'ICP tokenomics, rewards, etc.' },
    { id: 4, name: 'Governance', description: 'Changes to the governance system itself' },
    { id: 5, name: 'Node Admin', description: 'Node operator management' },
    { id: 6, name: 'Participant Management', description: 'Managing participants in the network' },
    { id: 7, name: 'Subnet Management', description: 'Creating/managing subnets' },
    { id: 8, name: 'Network Canister Management', description: 'NNS canister upgrades' },
    { id: 9, name: 'KYC', description: 'Know Your Customer related' },
    { id: 10, name: 'Node Provider Rewards', description: 'Rewards for node providers' },
    { id: 12, name: 'SNS & Community Fund', description: 'SNS launches and community fund' },
    { id: 13, name: 'Subnet Rental', description: 'Subnet rental requests' },
    { id: 14, name: 'Protocol Canister Management', description: 'Protocol-level canister management' },
];

function IcpNeuronManager() {
    const { canisterId } = useParams();
    const navigate = useNavigate();
    const { theme } = useTheme();
    const { identity, isAuthenticated, login } = useAuth();
    
    // Manager state
    const [managerInfo, setManagerInfo] = useState(null);
    const [icpBalance, setIcpBalance] = useState(null);
    const [neuronId, setNeuronId] = useState(null);
    const [neuronInfo, setNeuronInfo] = useState(null);
    const [fullNeuron, setFullNeuron] = useState(null);
    
    // UI state
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [actionLoading, setActionLoading] = useState('');
    
    // Form state
    const [stakeAmount, setStakeAmount] = useState('1');
    const [stakeDissolveDelay, setStakeDissolveDelay] = useState('365'); // Default 1 year for new neurons
    const [dissolveDelay, setDissolveDelay] = useState('');
    const [hotKeyPrincipal, setHotKeyPrincipal] = useState('');
    const [disburseAmount, setDisburseAmount] = useState('');
    const [disburseToAccount, setDisburseToAccount] = useState('');
    const [selectedTopic, setSelectedTopic] = useState(0);
    const [followeeIds, setFolloweeIds] = useState('');
    const [increaseStakeAmount, setIncreaseStakeAmount] = useState('');
    const [maturityPercentage, setMaturityPercentage] = useState('100');
    const [spawnController, setSpawnController] = useState('');
    const [disburseMaturityDestination, setDisburseMaturityDestination] = useState('');
    
    // Tabs
    const [activeTab, setActiveTab] = useState('overview');

    const getAgent = useCallback(() => {
        const host = process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging' 
            ? 'https://ic0.app' 
            : 'http://localhost:4943';
        return new HttpAgent({ identity, host });
    }, [identity]);

    const fetchManagerData = useCallback(async () => {
        if (!canisterId) return;
        
        setLoading(true);
        setError('');
        
        try {
            const agent = getAgent();
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
            }
            
            const manager = createManagerActor(canisterId, { agent });
            
            // Fetch basic info
            const [owner, version, neuronIdResult, accountId] = await Promise.all([
                manager.getOwner(),
                manager.getVersion(),
                manager.getNeuronId(),
                manager.getAccountId(),
            ]);
            
            setManagerInfo({
                canisterId,
                owner: owner.toText(),
                version: `${Number(version.major)}.${Number(version.minor)}.${Number(version.patch)}`,
                accountId: Array.from(accountId).map(b => b.toString(16).padStart(2, '0')).join(''),
            });
            
            // Set neuron ID if exists
            if (neuronIdResult && neuronIdResult.length > 0) {
                setNeuronId(neuronIdResult[0]);
                // Fetch neuron info
                fetchNeuronInfo(manager);
            } else {
                setNeuronId(null);
                setNeuronInfo(null);
                setFullNeuron(null);
            }
            
            // Fetch ICP balance
            fetchIcpBalance(agent);
            
        } catch (err) {
            console.error('Error fetching manager data:', err);
            setError(`Failed to load manager: ${err.message || 'Unknown error'}`);
        } finally {
            setLoading(false);
        }
    }, [canisterId, getAgent]);

    const fetchIcpBalance = async (agent) => {
        try {
            const ledger = createLedgerActor(ICP_LEDGER_CANISTER_ID, { agent });
            const balance = await ledger.icrc1_balance_of({
                owner: Principal.fromText(canisterId),
                subaccount: [],
            });
            setIcpBalance(Number(balance));
        } catch (err) {
            console.error('Error fetching ICP balance:', err);
        }
    };

    const fetchNeuronInfo = async (manager) => {
        try {
            const [infoResult, fullResult] = await Promise.all([
                manager.getNeuronInfo(),
                manager.getFullNeuron(),
            ]);
            
            // These return optional types directly, not Results
            if (infoResult && infoResult.length > 0) {
                setNeuronInfo(infoResult[0]);
            }
            if (fullResult && fullResult.length > 0) {
                setFullNeuron(fullResult[0]);
            }
        } catch (err) {
            console.error('Error fetching neuron info:', err);
        }
    };

    useEffect(() => {
        if (isAuthenticated && identity && canisterId) {
            fetchManagerData();
        }
    }, [isAuthenticated, identity, canisterId, fetchManagerData]);

    // Action handlers
    const handleStakeNeuron = async () => {
        if (!stakeAmount || parseFloat(stakeAmount) < 1) {
            setError('Minimum stake is 1 ICP');
            return;
        }
        
        const delayDays = parseInt(stakeDissolveDelay);
        if (!delayDays || delayDays < 183) {
            setError('Minimum dissolve delay is 183 days (~6 months) to vote');
            return;
        }
        if (delayDays > 2922) {
            setError('Maximum dissolve delay is 2922 days (8 years)');
            return;
        }
        
        setActionLoading('stake');
        setError('');
        setSuccess('');
        
        try {
            const agent = getAgent();
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
            }
            const manager = createManagerActor(canisterId, { agent });
            
            const amountE8s = BigInt(Math.floor(parseFloat(stakeAmount) * E8S));
            const dissolveDelaySeconds = BigInt(delayDays * 24 * 60 * 60);
            const result = await manager.stakeNeuron(amountE8s, dissolveDelaySeconds);
            
            if ('Ok' in result) {
                setSuccess(`🎉 Neuron created! ID: ${result.Ok.id.toString()}`);
                setNeuronId(result.Ok);
                fetchManagerData();
            } else {
                const err = result.Err;
                if ('InsufficientFunds' in err) {
                    setError(`Insufficient funds: have ${Number(err.InsufficientFunds.balance) / E8S} ICP, need ${Number(err.InsufficientFunds.required) / E8S} ICP`);
                } else if ('TransferFailed' in err) {
                    setError(`Transfer failed: ${err.TransferFailed}`);
                } else if ('NeuronAlreadyExists' in err) {
                    setError('A neuron already exists for this manager');
                } else if ('InvalidDissolveDelay' in err) {
                    const d = err.InvalidDissolveDelay;
                    setError(`Invalid dissolve delay: min ${Math.floor(Number(d.min) / 86400)} days, max ${Math.floor(Number(d.max) / 86400)} days, you provided ${Math.floor(Number(d.provided) / 86400)} days`);
                } else if ('GovernanceError' in err) {
                    setError(`Governance error: ${err.GovernanceError.error_message}`);
                } else {
                    setError('Failed to create neuron');
                }
            }
        } catch (err) {
            console.error('Error staking neuron:', err);
            setError(`Error: ${err.message || 'Failed to stake neuron'}`);
        } finally {
            setActionLoading('');
        }
    };

    const handleSetDissolveDelay = async () => {
        if (!dissolveDelay || parseInt(dissolveDelay) < 1) {
            setError('Please enter a valid dissolve delay in days');
            return;
        }
        
        setActionLoading('dissolve');
        setError('');
        setSuccess('');
        
        try {
            const agent = getAgent();
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
            }
            const manager = createManagerActor(canisterId, { agent });
            
            // setDissolveDelay takes Nat32 (additional seconds to add)
            const delaySeconds = parseInt(dissolveDelay) * 24 * 60 * 60;
            const result = await manager.setDissolveDelay(delaySeconds);
            
            if ('Ok' in result) {
                setSuccess(`✅ Added ${dissolveDelay} days to dissolve delay`);
                setDissolveDelay('');
                fetchManagerData();
            } else {
                handleOperationError(result.Err);
            }
        } catch (err) {
            console.error('Error setting dissolve delay:', err);
            setError(`Error: ${err.message}`);
        } finally {
            setActionLoading('');
        }
    };

    const handleStartDissolving = async () => {
        setActionLoading('startDissolve');
        setError('');
        setSuccess('');
        
        try {
            const agent = getAgent();
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
            }
            const manager = createManagerActor(canisterId, { agent });
            const result = await manager.startDissolving();
            
            if ('Ok' in result) {
                setSuccess('✅ Neuron is now dissolving');
                fetchManagerData();
            } else {
                handleOperationError(result.Err);
            }
        } catch (err) {
            console.error('Error starting dissolve:', err);
            setError(`Error: ${err.message}`);
        } finally {
            setActionLoading('');
        }
    };

    const handleStopDissolving = async () => {
        setActionLoading('stopDissolve');
        setError('');
        setSuccess('');
        
        try {
            const agent = getAgent();
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
            }
            const manager = createManagerActor(canisterId, { agent });
            const result = await manager.stopDissolving();
            
            if ('Ok' in result) {
                setSuccess('✅ Neuron stopped dissolving');
                fetchManagerData();
            } else {
                handleOperationError(result.Err);
            }
        } catch (err) {
            console.error('Error stopping dissolve:', err);
            setError(`Error: ${err.message}`);
        } finally {
            setActionLoading('');
        }
    };

    const handleAddHotKey = async () => {
        if (!hotKeyPrincipal) {
            setError('Please enter a principal ID');
            return;
        }
        
        setActionLoading('addHotKey');
        setError('');
        setSuccess('');
        
        try {
            const principal = Principal.fromText(hotKeyPrincipal);
            const agent = getAgent();
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
            }
            const manager = createManagerActor(canisterId, { agent });
            const result = await manager.addHotKey(principal);
            
            if ('Ok' in result) {
                setSuccess(`✅ Hot key added: ${hotKeyPrincipal}`);
                setHotKeyPrincipal('');
                fetchManagerData();
            } else {
                handleOperationError(result.Err);
            }
        } catch (err) {
            console.error('Error adding hot key:', err);
            setError(`Error: ${err.message}`);
        } finally {
            setActionLoading('');
        }
    };

    const handleRemoveHotKey = async (principal) => {
        setActionLoading('removeHotKey');
        setError('');
        setSuccess('');
        
        try {
            const agent = getAgent();
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
            }
            const manager = createManagerActor(canisterId, { agent });
            const result = await manager.removeHotKey(principal);
            
            if ('Ok' in result) {
                setSuccess(`✅ Hot key removed`);
                fetchManagerData();
            } else {
                handleOperationError(result.Err);
            }
        } catch (err) {
            console.error('Error removing hot key:', err);
            setError(`Error: ${err.message}`);
        } finally {
            setActionLoading('');
        }
    };

    const handleDisburse = async () => {
        setActionLoading('disburse');
        setError('');
        setSuccess('');
        
        try {
            const agent = getAgent();
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
            }
            const manager = createManagerActor(canisterId, { agent });
            
            // Amount: null means disburse all
            const amountOpt = disburseAmount ? [BigInt(Math.floor(parseFloat(disburseAmount) * E8S))] : [];
            
            // Destination: null means send to controller (this canister)
            // If provided, convert hex string to Uint8Array
            let toAccountOpt = [];
            if (disburseToAccount && disburseToAccount.length === 64) {
                const bytes = [];
                for (let i = 0; i < 64; i += 2) {
                    bytes.push(parseInt(disburseToAccount.substr(i, 2), 16));
                }
                toAccountOpt = [bytes];
            }
            
            const result = await manager.disburse(amountOpt, toAccountOpt);
            
            if ('Ok' in result) {
                setSuccess(`✅ Disbursed! Block height: ${result.Ok.transfer_block_height.toString()}`);
                setDisburseAmount('');
                setDisburseToAccount('');
                fetchManagerData();
            } else {
                handleOperationError(result.Err);
            }
        } catch (err) {
            console.error('Error disbursing:', err);
            setError(`Error: ${err.message}`);
        } finally {
            setActionLoading('');
        }
    };

    const handleSetFollowing = async () => {
        setActionLoading('following');
        setError('');
        setSuccess('');
        
        try {
            const agent = getAgent();
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
            }
            const manager = createManagerActor(canisterId, { agent });
            
            // Parse followee IDs (comma-separated)
            const followees = followeeIds
                .split(',')
                .map(s => s.trim())
                .filter(s => s.length > 0)
                .map(id => ({ id: BigInt(id) }));
            
            const result = await manager.setFollowing(selectedTopic, followees);
            
            if ('Ok' in result) {
                const topicName = NNS_TOPICS.find(t => t.id === selectedTopic)?.name || `Topic ${selectedTopic}`;
                if (followees.length === 0) {
                    setSuccess(`✅ Cleared following for ${topicName}`);
                } else {
                    setSuccess(`✅ Now following ${followees.length} neuron(s) for ${topicName}`);
                }
                setFolloweeIds('');
                fetchManagerData();
            } else {
                handleOperationError(result.Err);
            }
        } catch (err) {
            console.error('Error setting following:', err);
            setError(`Error: ${err.message}`);
        } finally {
            setActionLoading('');
        }
    };

    const handleIncreaseStake = async () => {
        if (!increaseStakeAmount || parseFloat(increaseStakeAmount) <= 0) {
            setError('Please enter a valid amount');
            return;
        }
        
        setActionLoading('increaseStake');
        setError('');
        setSuccess('');
        
        try {
            const agent = getAgent();
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
            }
            const manager = createManagerActor(canisterId, { agent });
            
            const amountE8s = BigInt(Math.floor(parseFloat(increaseStakeAmount) * E8S));
            const result = await manager.increaseStake(amountE8s);
            
            if ('Ok' in result) {
                setSuccess(`✅ Added ${increaseStakeAmount} ICP to neuron stake`);
                setIncreaseStakeAmount('');
                fetchManagerData();
            } else {
                handleOperationError(result.Err);
            }
        } catch (err) {
            console.error('Error increasing stake:', err);
            setError(`Error: ${err.message}`);
        } finally {
            setActionLoading('');
        }
    };

    const handleToggleAutoStakeMaturity = async (newValue) => {
        setActionLoading('autoStake');
        setError('');
        setSuccess('');
        
        try {
            const agent = getAgent();
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
            }
            const manager = createManagerActor(canisterId, { agent });
            
            const result = await manager.setAutoStakeMaturity(newValue);
            
            if ('Ok' in result) {
                setSuccess(`✅ Auto-stake maturity ${newValue ? 'enabled' : 'disabled'}`);
                fetchManagerData();
            } else {
                handleOperationError(result.Err);
            }
        } catch (err) {
            console.error('Error toggling auto-stake maturity:', err);
            setError(`Error: ${err.message}`);
        } finally {
            setActionLoading('');
        }
    };

    const handleSpawnMaturity = async () => {
        const percentage = parseInt(maturityPercentage);
        if (!percentage || percentage < 1 || percentage > 100) {
            setError('Percentage must be between 1 and 100');
            return;
        }
        
        setActionLoading('spawnMaturity');
        setError('');
        setSuccess('');
        
        try {
            const agent = getAgent();
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
            }
            const manager = createManagerActor(canisterId, { agent });
            
            // Optional controller for the spawned neuron
            const controllerOpt = spawnController ? [Principal.fromText(spawnController)] : [];
            
            const result = await manager.spawnMaturity(percentage, controllerOpt);
            
            if ('Ok' in result) {
                setSuccess(`✅ Spawned new neuron! ID: ${result.Ok.id.toString()}`);
                setSpawnController('');
                fetchManagerData();
            } else {
                handleOperationError(result.Err);
            }
        } catch (err) {
            console.error('Error spawning maturity:', err);
            setError(`Error: ${err.message}`);
        } finally {
            setActionLoading('');
        }
    };

    const handleStakeMaturity = async () => {
        const percentage = parseInt(maturityPercentage);
        if (!percentage || percentage < 1 || percentage > 100) {
            setError('Percentage must be between 1 and 100');
            return;
        }
        
        setActionLoading('stakeMaturity');
        setError('');
        setSuccess('');
        
        try {
            const agent = getAgent();
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
            }
            const manager = createManagerActor(canisterId, { agent });
            
            const result = await manager.stakeMaturity(percentage);
            
            if ('Ok' in result) {
                setSuccess(`✅ Staked ${percentage}% of maturity`);
                fetchManagerData();
            } else {
                handleOperationError(result.Err);
            }
        } catch (err) {
            console.error('Error staking maturity:', err);
            setError(`Error: ${err.message}`);
        } finally {
            setActionLoading('');
        }
    };

    const handleMergeMaturity = async () => {
        const percentage = parseInt(maturityPercentage);
        if (!percentage || percentage < 1 || percentage > 100) {
            setError('Percentage must be between 1 and 100');
            return;
        }
        
        setActionLoading('mergeMaturity');
        setError('');
        setSuccess('');
        
        try {
            const agent = getAgent();
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
            }
            const manager = createManagerActor(canisterId, { agent });
            
            const result = await manager.mergeMaturity(percentage);
            
            if ('Ok' in result) {
                setSuccess(`✅ Merged ${percentage}% of maturity into stake`);
                fetchManagerData();
            } else {
                handleOperationError(result.Err);
            }
        } catch (err) {
            console.error('Error merging maturity:', err);
            setError(`Error: ${err.message}`);
        } finally {
            setActionLoading('');
        }
    };

    const handleDisburseMaturity = async () => {
        const percentage = parseInt(maturityPercentage);
        if (!percentage || percentage < 1 || percentage > 100) {
            setError('Percentage must be between 1 and 100');
            return;
        }
        
        setActionLoading('disburseMaturity');
        setError('');
        setSuccess('');
        
        try {
            const agent = getAgent();
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
            }
            const manager = createManagerActor(canisterId, { agent });
            
            // Optional destination account
            let destOpt = [];
            if (disburseMaturityDestination) {
                try {
                    destOpt = [{ 
                        owner: Principal.fromText(disburseMaturityDestination), 
                        subaccount: [] 
                    }];
                } catch {
                    setError('Invalid principal for destination');
                    setActionLoading('');
                    return;
                }
            }
            
            const result = await manager.disburseMaturity(percentage, destOpt);
            
            if ('Ok' in result) {
                setSuccess(`✅ Disbursed ${percentage}% of maturity`);
                setDisburseMaturityDestination('');
                fetchManagerData();
            } else {
                handleOperationError(result.Err);
            }
        } catch (err) {
            console.error('Error disbursing maturity:', err);
            setError(`Error: ${err.message}`);
        } finally {
            setActionLoading('');
        }
    };

    const handleOperationError = (err) => {
        if ('GovernanceError' in err) {
            setError(`Governance error: ${err.GovernanceError.error_message}`);
        } else if ('InvalidOperation' in err) {
            setError(`Invalid operation: ${err.InvalidOperation}`);
        } else if ('NotAuthorized' in err) {
            setError('Not authorized to perform this operation');
        } else if ('NeuronNotFound' in err) {
            setError('Neuron not found');
        } else {
            setError('Operation failed');
        }
    };

    const copyToClipboard = (text) => {
        navigator.clipboard.writeText(text);
    };

    const formatIcp = (e8s) => {
        if (e8s === null || e8s === undefined) return '...';
        const icp = e8s / E8S;
        return icp.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 8 });
    };

    const formatDuration = (seconds) => {
        const days = Math.floor(seconds / 86400);
        const years = Math.floor(days / 365);
        const remainingDays = days % 365;
        
        if (years > 0) {
            return `${years}y ${remainingDays}d`;
        }
        return `${days} days`;
    };

    const getNeuronState = (state) => {
        const states = {
            1: { label: 'Locked', color: theme.colors.success || '#22c55e' },
            2: { label: 'Dissolving', color: theme.colors.warning || '#f59e0b' },
            3: { label: 'Dissolved', color: theme.colors.error || '#ef4444' },
            4: { label: 'Spawning', color: theme.colors.accent },
        };
        return states[state] || { label: 'Unknown', color: theme.colors.mutedText };
    };

    // Styles
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
        padding: '10px 20px',
        fontSize: '14px',
        fontWeight: '600',
        cursor: 'pointer',
        transition: 'opacity 0.2s',
    };

    const secondaryButtonStyle = {
        ...buttonStyle,
        background: 'transparent',
        color: theme.colors.accent,
        border: `1px solid ${theme.colors.accent}`,
    };

    const inputStyle = {
        background: theme.colors.inputBackground || theme.colors.cardBackground,
        color: theme.colors.primaryText,
        border: `1px solid ${theme.colors.border}`,
        borderRadius: '8px',
        padding: '10px 14px',
        fontSize: '14px',
        width: '100%',
        boxSizing: 'border-box',
    };

    const tabStyle = (isActive) => ({
        padding: '10px 20px',
        cursor: 'pointer',
        borderBottom: isActive ? `2px solid ${theme.colors.accent}` : '2px solid transparent',
        color: isActive ? theme.colors.accent : theme.colors.mutedText,
        fontWeight: isActive ? '600' : '400',
        background: 'none',
        border: 'none',
        fontSize: '14px',
    });

    const statBoxStyle = {
        textAlign: 'center',
        padding: '15px',
        background: `${theme.colors.accent}10`,
        borderRadius: '8px',
        flex: 1,
        minWidth: '120px',
    };

    if (!isAuthenticated) {
        return (
            <div className='page-container' style={{ background: theme.colors.primaryGradient, minHeight: '100vh' }}>
                <Header />
                <main className="wallet-container">
                    <div style={{ ...cardStyle, textAlign: 'center' }}>
                        <p style={{ color: theme.colors.mutedText, marginBottom: '20px' }}>
                            Please log in to manage your neuron.
                        </p>
                        <button style={buttonStyle} onClick={login}>
                            Login with Internet Identity
                        </button>
                    </div>
                </main>
            </div>
        );
    }

    return (
        <div className='page-container' style={{ background: theme.colors.primaryGradient, minHeight: '100vh' }}>
            <Header />
            <main className="wallet-container">
                {/* Back link */}
                <Link 
                    to="/create_icp_neuron" 
                    style={{ color: theme.colors.accent, textDecoration: 'none', display: 'inline-block', marginBottom: '20px' }}
                >
                    ← Back to Managers
                </Link>

                <h1 style={{ color: theme.colors.primaryText, marginBottom: '10px' }}>
                    ICP Neuron Manager
                </h1>
                
                {loading ? (
                    <div style={{ textAlign: 'center', padding: '40px', color: theme.colors.primaryText }}>
                        Loading manager...
                    </div>
                ) : error && !managerInfo ? (
                    <div style={{ 
                        backgroundColor: `${theme.colors.error}20`, 
                        border: `1px solid ${theme.colors.error}`,
                        color: theme.colors.error,
                        padding: '15px',
                        borderRadius: '8px',
                    }}>
                        {error}
                    </div>
                ) : managerInfo && (
                    <>
                        {/* Manager Info Card */}
                        <div style={cardStyle}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '20px' }}>
                                <div>
                                    <div style={{ color: theme.colors.mutedText, fontSize: '12px' }}>Canister ID</div>
                                    <div style={{ color: theme.colors.primaryText, fontFamily: 'monospace', fontSize: '14px', marginTop: '4px' }}>
                                        {managerInfo.canisterId}
                                        <button 
                                            onClick={() => copyToClipboard(managerInfo.canisterId)}
                                            style={{ ...secondaryButtonStyle, padding: '2px 8px', fontSize: '11px', marginLeft: '8px' }}
                                        >
                                            Copy
                                        </button>
                                    </div>
                                </div>
                                <div style={{ textAlign: 'right' }}>
                                    <div style={{ color: theme.colors.mutedText, fontSize: '12px' }}>ICP Balance</div>
                                    <div style={{ 
                                        color: icpBalance > 0 ? (theme.colors.success || '#22c55e') : theme.colors.primaryText, 
                                        fontSize: '24px', 
                                        fontWeight: '700',
                                        marginTop: '4px',
                                    }}>
                                        {formatIcp(icpBalance)} ICP
                                    </div>
                                </div>
                            </div>
                            
                            <div style={{ marginTop: '15px' }}>
                                <div style={{ color: theme.colors.mutedText, fontSize: '12px' }}>Account ID (send ICP here)</div>
                                <div style={{ 
                                    color: theme.colors.accent, 
                                    fontFamily: 'monospace', 
                                    fontSize: '12px',
                                    marginTop: '4px',
                                    wordBreak: 'break-all',
                                    background: `${theme.colors.accent}10`,
                                    padding: '8px',
                                    borderRadius: '4px',
                                }}>
                                    {managerInfo.accountId}
                                    <button 
                                        onClick={() => copyToClipboard(managerInfo.accountId)}
                                        style={{ ...secondaryButtonStyle, padding: '2px 8px', fontSize: '11px', marginLeft: '8px' }}
                                    >
                                        Copy
                                    </button>
                                </div>
                            </div>

                            <div style={{ marginTop: '15px', display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
                                <div>
                                    <span style={{ color: theme.colors.mutedText, fontSize: '12px' }}>Owner: </span>
                                    <span style={{ color: theme.colors.primaryText, fontFamily: 'monospace', fontSize: '12px' }}>
                                        {managerInfo.owner.slice(0, 15)}...
                                    </span>
                                </div>
                                <div>
                                    <span style={{ color: theme.colors.mutedText, fontSize: '12px' }}>Version: </span>
                                    <span style={{ color: theme.colors.primaryText, fontSize: '12px' }}>
                                        {managerInfo.version}
                                    </span>
                                </div>
                            </div>
                        </div>

                        {/* Success/Error Messages */}
                        {success && (
                            <div style={{ 
                                backgroundColor: `${theme.colors.success || '#22c55e'}20`, 
                                border: `1px solid ${theme.colors.success || '#22c55e'}`,
                                color: theme.colors.success || '#22c55e',
                                padding: '15px',
                                borderRadius: '8px',
                                marginBottom: '20px',
                            }}>
                                {success}
                            </div>
                        )}
                        {error && (
                            <div style={{ 
                                backgroundColor: `${theme.colors.error}20`, 
                                border: `1px solid ${theme.colors.error}`,
                                color: theme.colors.error,
                                padding: '15px',
                                borderRadius: '8px',
                                marginBottom: '20px',
                            }}>
                                {error}
                            </div>
                        )}

                        {/* No Neuron - Create Section */}
                        {!neuronId && (
                            <div style={cardStyle}>
                                <h2 style={{ color: theme.colors.primaryText, marginBottom: '15px' }}>Create Neuron</h2>
                                <p style={{ color: theme.colors.mutedText, marginBottom: '20px' }}>
                                    No neuron has been created yet. Fund this canister with ICP, then stake to create a neuron.
                                </p>
                                
                                <div style={{ display: 'flex', gap: '15px', alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: '15px' }}>
                                    <div style={{ flex: 1, minWidth: '150px' }}>
                                        <label style={{ color: theme.colors.mutedText, fontSize: '12px', display: 'block', marginBottom: '6px' }}>
                                            Amount to Stake (ICP)
                                        </label>
                                        <input
                                            type="number"
                                            min="1"
                                            step="0.01"
                                            value={stakeAmount}
                                            onChange={(e) => setStakeAmount(e.target.value)}
                                            style={inputStyle}
                                            placeholder="1.0"
                                        />
                                    </div>
                                    <div style={{ flex: 1, minWidth: '150px' }}>
                                        <label style={{ color: theme.colors.mutedText, fontSize: '12px', display: 'block', marginBottom: '6px' }}>
                                            Dissolve Delay (days)
                                        </label>
                                        <input
                                            type="number"
                                            min="183"
                                            max="2922"
                                            value={stakeDissolveDelay}
                                            onChange={(e) => setStakeDissolveDelay(e.target.value)}
                                            style={inputStyle}
                                            placeholder="365"
                                        />
                                    </div>
                                </div>
                                
                                <p style={{ color: theme.colors.mutedText, fontSize: '12px', marginBottom: '15px' }}>
                                    💡 Min 183 days (~6 months) to vote. Max 8 years (2922 days). Higher delay = more voting power.
                                </p>
                                
                                <button
                                    onClick={handleStakeNeuron}
                                    disabled={actionLoading === 'stake' || icpBalance < E8S}
                                    style={{ 
                                        ...buttonStyle, 
                                        opacity: (actionLoading === 'stake' || icpBalance < E8S) ? 0.6 : 1,
                                        cursor: (actionLoading === 'stake' || icpBalance < E8S) ? 'not-allowed' : 'pointer',
                                    }}
                                >
                                    {actionLoading === 'stake' ? '⏳ Creating...' : '🚀 Stake & Create Neuron'}
                                </button>
                                
                                {icpBalance !== null && icpBalance < E8S && (
                                    <p style={{ color: theme.colors.warning || '#f59e0b', fontSize: '13px', marginTop: '10px' }}>
                                        ⚠️ Minimum 1 ICP required to create a neuron. Please fund this canister first.
                                    </p>
                                )}
                            </div>
                        )}

                        {/* Neuron exists - Show tabs */}
                        {neuronId && (
                            <>
                                {/* Neuron Summary */}
                                <div style={cardStyle}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '15px' }}>
                                        <h2 style={{ color: theme.colors.primaryText, margin: 0 }}>Neuron #{neuronId.id.toString()}</h2>
                                        {neuronInfo && (
                                            <span style={{
                                                background: getNeuronState(neuronInfo.state).color,
                                                color: '#fff',
                                                padding: '4px 12px',
                                                borderRadius: '20px',
                                                fontSize: '12px',
                                                fontWeight: '600',
                                            }}>
                                                {getNeuronState(neuronInfo.state).label}
                                            </span>
                                        )}
                                    </div>
                                    
                                    {neuronInfo && (
                                        <div style={{ display: 'flex', gap: '15px', flexWrap: 'wrap' }}>
                                            <div style={statBoxStyle}>
                                                <div style={{ color: theme.colors.mutedText, fontSize: '11px' }}>Stake</div>
                                                <div style={{ color: theme.colors.primaryText, fontSize: '18px', fontWeight: '700' }}>
                                                    {formatIcp(Number(neuronInfo.stake_e8s))} ICP
                                                </div>
                                            </div>
                                            <div style={statBoxStyle}>
                                                <div style={{ color: theme.colors.mutedText, fontSize: '11px' }}>Voting Power</div>
                                                <div style={{ color: theme.colors.primaryText, fontSize: '18px', fontWeight: '700' }}>
                                                    {formatIcp(Number(neuronInfo.voting_power))}
                                                </div>
                                            </div>
                                            <div style={statBoxStyle}>
                                                <div style={{ color: theme.colors.mutedText, fontSize: '11px' }}>Dissolve Delay</div>
                                                <div style={{ color: theme.colors.primaryText, fontSize: '18px', fontWeight: '700' }}>
                                                    {formatDuration(Number(neuronInfo.dissolve_delay_seconds))}
                                                </div>
                                            </div>
                                            <div style={statBoxStyle}>
                                                <div style={{ color: theme.colors.mutedText, fontSize: '11px' }}>Age</div>
                                                <div style={{ color: theme.colors.primaryText, fontSize: '18px', fontWeight: '700' }}>
                                                    {formatDuration(Number(neuronInfo.age_seconds))}
                                                </div>
                                            </div>
                                            {fullNeuron && (
                                                <div style={statBoxStyle}>
                                                    <div style={{ color: theme.colors.mutedText, fontSize: '11px' }}>Maturity</div>
                                                    <div style={{ color: theme.colors.primaryText, fontSize: '18px', fontWeight: '700' }}>
                                                        {formatIcp(Number(fullNeuron.maturity_e8s_equivalent))} ICP
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>

                                {/* Tabs */}
                                <div style={{ display: 'flex', borderBottom: `1px solid ${theme.colors.border}`, marginBottom: '20px', flexWrap: 'wrap' }}>
                                    <button style={tabStyle(activeTab === 'overview')} onClick={() => setActiveTab('overview')}>
                                        Overview
                                    </button>
                                    <button style={tabStyle(activeTab === 'stake')} onClick={() => setActiveTab('stake')}>
                                        Stake
                                    </button>
                                    <button style={tabStyle(activeTab === 'maturity')} onClick={() => setActiveTab('maturity')}>
                                        Maturity
                                    </button>
                                    <button style={tabStyle(activeTab === 'following')} onClick={() => setActiveTab('following')}>
                                        Following
                                    </button>
                                    <button style={tabStyle(activeTab === 'dissolve')} onClick={() => setActiveTab('dissolve')}>
                                        Dissolve
                                    </button>
                                    <button style={tabStyle(activeTab === 'disburse')} onClick={() => setActiveTab('disburse')}>
                                        Disburse
                                    </button>
                                    <button style={tabStyle(activeTab === 'hotkeys')} onClick={() => setActiveTab('hotkeys')}>
                                        Hot Keys
                                    </button>
                                </div>

                                {/* Tab Content */}
                                {activeTab === 'overview' && (
                                    <div style={cardStyle}>
                                        <h3 style={{ color: theme.colors.primaryText, marginBottom: '15px' }}>Neuron Details</h3>
                                        {fullNeuron && (
                                            <div style={{ display: 'grid', gap: '10px' }}>
                                                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                                    <span style={{ color: theme.colors.mutedText }}>Controller</span>
                                                    <span style={{ color: theme.colors.primaryText, fontFamily: 'monospace', fontSize: '12px' }}>
                                                        {fullNeuron.controller?.[0]?.toText() || 'N/A'}
                                                    </span>
                                                </div>
                                                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                                    <span style={{ color: theme.colors.mutedText }}>KYC Verified</span>
                                                    <span style={{ color: theme.colors.primaryText }}>{fullNeuron.kyc_verified ? 'Yes' : 'No'}</span>
                                                </div>
                                                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                                    <span style={{ color: theme.colors.mutedText }}>Not For Profit</span>
                                                    <span style={{ color: theme.colors.primaryText }}>{fullNeuron.not_for_profit ? 'Yes' : 'No'}</span>
                                                </div>
                                                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                                    <span style={{ color: theme.colors.mutedText }}>Staked Maturity</span>
                                                    <span style={{ color: theme.colors.primaryText }}>
                                                        {fullNeuron.staked_maturity_e8s_equivalent?.[0] 
                                                            ? formatIcp(Number(fullNeuron.staked_maturity_e8s_equivalent[0])) + ' ICP' 
                                                            : '0 ICP'}
                                                    </span>
                                                </div>
                                            </div>
                                        )}
                                        
                                        <div style={{ marginTop: '20px' }}>
                                            <button 
                                                onClick={fetchManagerData}
                                                style={secondaryButtonStyle}
                                            >
                                                🔄 Refresh Data
                                            </button>
                                        </div>
                                    </div>
                                )}

                                {activeTab === 'dissolve' && (
                                    <div style={cardStyle}>
                                        <h3 style={{ color: theme.colors.primaryText, marginBottom: '15px' }}>Dissolve Management</h3>
                                        
                                        {/* Current dissolve delay info */}
                                        {neuronInfo && (
                                            <div style={{ 
                                                background: `${theme.colors.accent}10`, 
                                                padding: '12px', 
                                                borderRadius: '8px', 
                                                marginBottom: '20px' 
                                            }}>
                                                <div style={{ color: theme.colors.mutedText, fontSize: '12px' }}>Current Dissolve Delay</div>
                                                <div style={{ color: theme.colors.primaryText, fontSize: '18px', fontWeight: '600' }}>
                                                    {formatDuration(Number(neuronInfo.dissolve_delay_seconds))}
                                                    <span style={{ color: theme.colors.mutedText, fontSize: '12px', marginLeft: '8px' }}>
                                                        ({Math.floor(Number(neuronInfo.dissolve_delay_seconds) / 86400)} days)
                                                    </span>
                                                </div>
                                            </div>
                                        )}
                                        
                                        {/* Increase Dissolve Delay */}
                                        <div style={{ marginBottom: '25px' }}>
                                            <h4 style={{ color: theme.colors.primaryText, fontSize: '14px', marginBottom: '10px' }}>Increase Dissolve Delay</h4>
                                            <p style={{ color: theme.colors.mutedText, fontSize: '13px', marginBottom: '10px' }}>
                                                <strong>Note:</strong> This <em>adds</em> to your current delay. Max total is 8 years (2922 days).
                                            </p>
                                            <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                                                <div style={{ flex: 1, minWidth: '150px' }}>
                                                    <label style={{ color: theme.colors.mutedText, fontSize: '12px', display: 'block', marginBottom: '4px' }}>
                                                        Days to Add
                                                    </label>
                                                    <input
                                                        type="number"
                                                        min="1"
                                                        max="2922"
                                                        value={dissolveDelay}
                                                        onChange={(e) => setDissolveDelay(e.target.value)}
                                                        style={inputStyle}
                                                        placeholder="e.g., 365"
                                                    />
                                                </div>
                                                <button
                                                    onClick={handleSetDissolveDelay}
                                                    disabled={actionLoading === 'dissolve'}
                                                    style={{ 
                                                        ...buttonStyle, 
                                                        opacity: actionLoading === 'dissolve' ? 0.6 : 1,
                                                    }}
                                                >
                                                    {actionLoading === 'dissolve' ? '⏳...' : '+ Add Days'}
                                                </button>
                                            </div>
                                            {dissolveDelay && neuronInfo && (
                                                <p style={{ color: theme.colors.accent, fontSize: '12px', marginTop: '8px' }}>
                                                    New total will be: {formatDuration(Number(neuronInfo.dissolve_delay_seconds) + parseInt(dissolveDelay) * 86400)}
                                                </p>
                                            )}
                                        </div>

                                        {/* Start/Stop Dissolving */}
                                        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                                            {/* State 1 = Locked, State 2 = Dissolving, State 3 = Dissolved */}
                                            <button
                                                onClick={handleStartDissolving}
                                                disabled={actionLoading === 'startDissolve' || !neuronInfo || neuronInfo.state !== 1}
                                                style={{ 
                                                    ...buttonStyle,
                                                    background: theme.colors.warning || '#f59e0b',
                                                    opacity: (actionLoading === 'startDissolve' || !neuronInfo || neuronInfo.state !== 1) ? 0.5 : 1,
                                                    cursor: (!neuronInfo || neuronInfo.state !== 1) ? 'not-allowed' : 'pointer',
                                                }}
                                            >
                                                {actionLoading === 'startDissolve' ? '⏳...' : '⏳ Start Dissolving'}
                                            </button>
                                            <button
                                                onClick={handleStopDissolving}
                                                disabled={actionLoading === 'stopDissolve' || !neuronInfo || neuronInfo.state !== 2}
                                                style={{ 
                                                    ...secondaryButtonStyle,
                                                    opacity: (actionLoading === 'stopDissolve' || !neuronInfo || neuronInfo.state !== 2) ? 0.5 : 1,
                                                    cursor: (!neuronInfo || neuronInfo.state !== 2) ? 'not-allowed' : 'pointer',
                                                }}
                                            >
                                                {actionLoading === 'stopDissolve' ? '⏳...' : '⏹️ Stop Dissolving'}
                                            </button>
                                        </div>
                                        {neuronInfo && neuronInfo.state === 3 && (
                                            <p style={{ color: theme.colors.success || '#22c55e', fontSize: '13px', marginTop: '10px' }}>
                                                ✅ Neuron is fully dissolved and ready to disburse.
                                            </p>
                                        )}
                                    </div>
                                )}

                                {activeTab === 'stake' && (
                                    <div style={cardStyle}>
                                        <h3 style={{ color: theme.colors.primaryText, marginBottom: '15px' }}>Stake Management</h3>
                                        
                                        {/* Current stake info */}
                                        {neuronInfo && (
                                            <div style={{ 
                                                background: `${theme.colors.accent}10`, 
                                                padding: '12px', 
                                                borderRadius: '8px', 
                                                marginBottom: '20px',
                                                display: 'flex',
                                                gap: '30px',
                                                flexWrap: 'wrap',
                                            }}>
                                                <div>
                                                    <div style={{ color: theme.colors.mutedText, fontSize: '12px' }}>Current Stake</div>
                                                    <div style={{ color: theme.colors.primaryText, fontSize: '18px', fontWeight: '600' }}>
                                                        {formatIcp(Number(neuronInfo.stake_e8s))} ICP
                                                    </div>
                                                </div>
                                                <div>
                                                    <div style={{ color: theme.colors.mutedText, fontSize: '12px' }}>Canister Balance</div>
                                                    <div style={{ color: theme.colors.primaryText, fontSize: '18px', fontWeight: '600' }}>
                                                        {formatIcp(icpBalance)} ICP
                                                    </div>
                                                </div>
                                            </div>
                                        )}
                                        
                                        {/* Increase Stake */}
                                        <div style={{ marginBottom: '30px' }}>
                                            <h4 style={{ color: theme.colors.primaryText, fontSize: '14px', marginBottom: '10px' }}>Increase Stake</h4>
                                            <p style={{ color: theme.colors.mutedText, fontSize: '13px', marginBottom: '15px' }}>
                                                Add more ICP to your neuron from this canister's balance. More stake = more voting power.
                                            </p>
                                            <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                                                <div style={{ flex: 1, minWidth: '150px' }}>
                                                    <label style={{ color: theme.colors.mutedText, fontSize: '12px', display: 'block', marginBottom: '6px' }}>
                                                        Amount (ICP)
                                                    </label>
                                                    <input
                                                        type="number"
                                                        min="0.0001"
                                                        step="0.01"
                                                        value={increaseStakeAmount}
                                                        onChange={(e) => setIncreaseStakeAmount(e.target.value)}
                                                        style={inputStyle}
                                                        placeholder="e.g., 1.0"
                                                    />
                                                </div>
                                                <button
                                                    onClick={handleIncreaseStake}
                                                    disabled={actionLoading === 'increaseStake' || !icpBalance || icpBalance < E8S * 0.01}
                                                    style={{ 
                                                        ...buttonStyle, 
                                                        opacity: (actionLoading === 'increaseStake' || !icpBalance || icpBalance < E8S * 0.01) ? 0.6 : 1,
                                                    }}
                                                >
                                                    {actionLoading === 'increaseStake' ? '⏳...' : '➕ Add to Stake'}
                                                </button>
                                            </div>
                                            {icpBalance !== null && icpBalance < E8S * 0.01 && (
                                                <p style={{ color: theme.colors.warning || '#f59e0b', fontSize: '12px', marginTop: '8px' }}>
                                                    ⚠️ Fund this canister with ICP first (send to the account ID shown above).
                                                </p>
                                            )}
                                        </div>

                                        {/* Auto-stake Maturity */}
                                        <div style={{ borderTop: `1px solid ${theme.colors.border}`, paddingTop: '20px' }}>
                                            <h4 style={{ color: theme.colors.primaryText, fontSize: '14px', marginBottom: '10px' }}>Auto-Stake Maturity</h4>
                                            <p style={{ color: theme.colors.mutedText, fontSize: '13px', marginBottom: '15px' }}>
                                                When enabled, maturity rewards are automatically staked to your neuron instead of accumulating.
                                            </p>
                                            
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                                                <div style={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '10px',
                                                    padding: '10px 15px',
                                                    background: `${theme.colors.accent}10`,
                                                    borderRadius: '8px',
                                                }}>
                                                    <span style={{ color: theme.colors.mutedText, fontSize: '13px' }}>Current:</span>
                                                    <span style={{ 
                                                        color: fullNeuron?.auto_stake_maturity?.[0] ? (theme.colors.success || '#22c55e') : theme.colors.mutedText,
                                                        fontWeight: '600',
                                                    }}>
                                                        {fullNeuron?.auto_stake_maturity?.[0] ? '✅ Enabled' : '❌ Disabled'}
                                                    </span>
                                                </div>
                                                
                                                {fullNeuron?.auto_stake_maturity?.[0] ? (
                                                    <button
                                                        onClick={() => handleToggleAutoStakeMaturity(false)}
                                                        disabled={actionLoading === 'autoStake'}
                                                        style={{ 
                                                            ...secondaryButtonStyle, 
                                                            opacity: actionLoading === 'autoStake' ? 0.6 : 1,
                                                        }}
                                                    >
                                                        {actionLoading === 'autoStake' ? '⏳...' : 'Disable'}
                                                    </button>
                                                ) : (
                                                    <button
                                                        onClick={() => handleToggleAutoStakeMaturity(true)}
                                                        disabled={actionLoading === 'autoStake'}
                                                        style={{ 
                                                            ...buttonStyle, 
                                                            opacity: actionLoading === 'autoStake' ? 0.6 : 1,
                                                        }}
                                                    >
                                                        {actionLoading === 'autoStake' ? '⏳...' : 'Enable'}
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {activeTab === 'maturity' && (
                                    <div style={cardStyle}>
                                        <h3 style={{ color: theme.colors.primaryText, marginBottom: '15px' }}>Maturity Management</h3>
                                        
                                        {/* Current maturity info */}
                                        <div style={{ 
                                            background: `${theme.colors.accent}10`, 
                                            padding: '15px', 
                                            borderRadius: '8px', 
                                            marginBottom: '25px',
                                            display: 'flex',
                                            gap: '30px',
                                            flexWrap: 'wrap',
                                        }}>
                                            <div>
                                                <div style={{ color: theme.colors.mutedText, fontSize: '12px' }}>Available Maturity</div>
                                                <div style={{ color: theme.colors.primaryText, fontSize: '20px', fontWeight: '700' }}>
                                                    {fullNeuron ? formatIcp(Number(fullNeuron.maturity_e8s_equivalent)) : '...'} ICP
                                                </div>
                                            </div>
                                            <div>
                                                <div style={{ color: theme.colors.mutedText, fontSize: '12px' }}>Staked Maturity</div>
                                                <div style={{ color: theme.colors.primaryText, fontSize: '20px', fontWeight: '700' }}>
                                                    {fullNeuron?.staked_maturity_e8s_equivalent?.[0] 
                                                        ? formatIcp(Number(fullNeuron.staked_maturity_e8s_equivalent[0])) 
                                                        : '0.00'} ICP
                                                </div>
                                            </div>
                                            <div>
                                                <div style={{ color: theme.colors.mutedText, fontSize: '12px' }}>Auto-Stake</div>
                                                <div style={{ 
                                                    color: fullNeuron?.auto_stake_maturity?.[0] ? (theme.colors.success || '#22c55e') : theme.colors.mutedText,
                                                    fontSize: '20px', 
                                                    fontWeight: '700' 
                                                }}>
                                                    {fullNeuron?.auto_stake_maturity?.[0] ? 'On' : 'Off'}
                                                </div>
                                            </div>
                                        </div>

                                        {/* Percentage input */}
                                        <div style={{ marginBottom: '20px' }}>
                                            <label style={{ color: theme.colors.mutedText, fontSize: '12px', display: 'block', marginBottom: '6px' }}>
                                                Percentage of Maturity
                                            </label>
                                            <input
                                                type="number"
                                                min="1"
                                                max="100"
                                                value={maturityPercentage}
                                                onChange={(e) => setMaturityPercentage(e.target.value)}
                                                style={{ ...inputStyle, maxWidth: '150px' }}
                                                placeholder="100"
                                            />
                                            <span style={{ color: theme.colors.mutedText, fontSize: '12px', marginLeft: '8px' }}>%</span>
                                        </div>

                                        {/* Maturity Actions */}
                                        <div style={{ display: 'grid', gap: '20px' }}>
                                            {/* Stake Maturity */}
                                            <div style={{ padding: '15px', border: `1px solid ${theme.colors.border}`, borderRadius: '8px' }}>
                                                <h4 style={{ color: theme.colors.primaryText, fontSize: '14px', marginBottom: '8px' }}>Stake Maturity</h4>
                                                <p style={{ color: theme.colors.mutedText, fontSize: '12px', marginBottom: '12px' }}>
                                                    Convert maturity to staked maturity. Staked maturity increases voting power but takes 7 days to become liquid.
                                                </p>
                                                <button
                                                    onClick={handleStakeMaturity}
                                                    disabled={actionLoading === 'stakeMaturity' || !fullNeuron || fullNeuron.maturity_e8s_equivalent === BigInt(0)}
                                                    style={{ 
                                                        ...buttonStyle, 
                                                        opacity: (actionLoading === 'stakeMaturity' || !fullNeuron || fullNeuron.maturity_e8s_equivalent === BigInt(0)) ? 0.6 : 1,
                                                    }}
                                                >
                                                    {actionLoading === 'stakeMaturity' ? '⏳...' : '📈 Stake Maturity'}
                                                </button>
                                            </div>

                                            {/* Merge Maturity */}
                                            <div style={{ padding: '15px', border: `1px solid ${theme.colors.border}`, borderRadius: '8px' }}>
                                                <h4 style={{ color: theme.colors.primaryText, fontSize: '14px', marginBottom: '8px' }}>Merge Maturity</h4>
                                                <p style={{ color: theme.colors.mutedText, fontSize: '12px', marginBottom: '12px' }}>
                                                    Merge maturity directly into your neuron's stake. Increases stake permanently.
                                                </p>
                                                <button
                                                    onClick={handleMergeMaturity}
                                                    disabled={actionLoading === 'mergeMaturity' || !fullNeuron || fullNeuron.maturity_e8s_equivalent === BigInt(0)}
                                                    style={{ 
                                                        ...buttonStyle, 
                                                        opacity: (actionLoading === 'mergeMaturity' || !fullNeuron || fullNeuron.maturity_e8s_equivalent === BigInt(0)) ? 0.6 : 1,
                                                    }}
                                                >
                                                    {actionLoading === 'mergeMaturity' ? '⏳...' : '🔄 Merge into Stake'}
                                                </button>
                                            </div>

                                            {/* Spawn Maturity */}
                                            <div style={{ padding: '15px', border: `1px solid ${theme.colors.border}`, borderRadius: '8px' }}>
                                                <h4 style={{ color: theme.colors.primaryText, fontSize: '14px', marginBottom: '8px' }}>Spawn New Neuron</h4>
                                                <p style={{ color: theme.colors.mutedText, fontSize: '12px', marginBottom: '12px' }}>
                                                    Create a new neuron from your maturity. Requires at least 1 ICP equivalent in maturity.
                                                </p>
                                                <div style={{ marginBottom: '12px' }}>
                                                    <label style={{ color: theme.colors.mutedText, fontSize: '11px', display: 'block', marginBottom: '4px' }}>
                                                        Controller (optional, defaults to this canister)
                                                    </label>
                                                    <input
                                                        type="text"
                                                        value={spawnController}
                                                        onChange={(e) => setSpawnController(e.target.value)}
                                                        style={inputStyle}
                                                        placeholder="Principal ID (optional)"
                                                    />
                                                </div>
                                                <button
                                                    onClick={handleSpawnMaturity}
                                                    disabled={actionLoading === 'spawnMaturity' || !fullNeuron || Number(fullNeuron.maturity_e8s_equivalent) < E8S}
                                                    style={{ 
                                                        ...buttonStyle, 
                                                        opacity: (actionLoading === 'spawnMaturity' || !fullNeuron || Number(fullNeuron.maturity_e8s_equivalent) < E8S) ? 0.6 : 1,
                                                    }}
                                                >
                                                    {actionLoading === 'spawnMaturity' ? '⏳...' : '🐣 Spawn Neuron'}
                                                </button>
                                                {fullNeuron && Number(fullNeuron.maturity_e8s_equivalent) < E8S && (
                                                    <p style={{ color: theme.colors.warning || '#f59e0b', fontSize: '11px', marginTop: '8px' }}>
                                                        Need at least 1 ICP equivalent in maturity to spawn.
                                                    </p>
                                                )}
                                            </div>

                                            {/* Disburse Maturity */}
                                            <div style={{ padding: '15px', border: `1px solid ${theme.colors.border}`, borderRadius: '8px' }}>
                                                <h4 style={{ color: theme.colors.primaryText, fontSize: '14px', marginBottom: '8px' }}>Disburse Maturity</h4>
                                                <p style={{ color: theme.colors.mutedText, fontSize: '12px', marginBottom: '12px' }}>
                                                    Convert maturity to ICP and withdraw it. Subject to a 7-day modulation period.
                                                </p>
                                                <div style={{ marginBottom: '12px' }}>
                                                    <label style={{ color: theme.colors.mutedText, fontSize: '11px', display: 'block', marginBottom: '4px' }}>
                                                        Destination (optional, defaults to this canister)
                                                    </label>
                                                    <input
                                                        type="text"
                                                        value={disburseMaturityDestination}
                                                        onChange={(e) => setDisburseMaturityDestination(e.target.value)}
                                                        style={inputStyle}
                                                        placeholder="Principal ID (optional)"
                                                    />
                                                </div>
                                                <button
                                                    onClick={handleDisburseMaturity}
                                                    disabled={actionLoading === 'disburseMaturity' || !fullNeuron || fullNeuron.maturity_e8s_equivalent === BigInt(0)}
                                                    style={{ 
                                                        ...buttonStyle, 
                                                        background: theme.colors.warning || '#f59e0b',
                                                        opacity: (actionLoading === 'disburseMaturity' || !fullNeuron || fullNeuron.maturity_e8s_equivalent === BigInt(0)) ? 0.6 : 1,
                                                    }}
                                                >
                                                    {actionLoading === 'disburseMaturity' ? '⏳...' : '💸 Disburse Maturity'}
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {activeTab === 'following' && (
                                    <div style={cardStyle}>
                                        <h3 style={{ color: theme.colors.primaryText, marginBottom: '15px' }}>Following Management</h3>
                                        <p style={{ color: theme.colors.mutedText, fontSize: '13px', marginBottom: '20px' }}>
                                            Set neurons to follow for automatic voting. Your neuron will vote the same way as your followees.
                                            Following the DFINITY Foundation neuron (27) is common for governance topics.
                                        </p>
                                        
                                        {/* Current followees */}
                                        {fullNeuron && fullNeuron.followees && fullNeuron.followees.length > 0 && (
                                            <div style={{ marginBottom: '25px' }}>
                                                <h4 style={{ color: theme.colors.primaryText, fontSize: '14px', marginBottom: '10px' }}>Current Following</h4>
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                                    {fullNeuron.followees.map(([topicId, followeesData]) => {
                                                        const topicInfo = NNS_TOPICS.find(t => t.id === topicId);
                                                        return (
                                                            <div key={topicId} style={{
                                                                background: `${theme.colors.accent}10`,
                                                                padding: '10px',
                                                                borderRadius: '6px',
                                                            }}>
                                                                <div style={{ color: theme.colors.primaryText, fontWeight: '500', fontSize: '13px' }}>
                                                                    {topicInfo?.name || `Topic ${topicId}`}
                                                                </div>
                                                                <div style={{ color: theme.colors.mutedText, fontSize: '12px', marginTop: '4px' }}>
                                                                    Following: {followeesData.followees.map(f => f.id.toString()).join(', ') || 'None'}
                                                                </div>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        )}

                                        {/* Set new following */}
                                        <h4 style={{ color: theme.colors.primaryText, fontSize: '14px', marginBottom: '10px' }}>Set Following</h4>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                                            <div>
                                                <label style={{ color: theme.colors.mutedText, fontSize: '12px', display: 'block', marginBottom: '6px' }}>
                                                    Topic
                                                </label>
                                                <select
                                                    value={selectedTopic}
                                                    onChange={(e) => setSelectedTopic(parseInt(e.target.value))}
                                                    style={{ 
                                                        ...inputStyle, 
                                                        cursor: 'pointer',
                                                    }}
                                                >
                                                    {NNS_TOPICS.map(topic => (
                                                        <option key={topic.id} value={topic.id}>
                                                            {topic.name}
                                                        </option>
                                                    ))}
                                                </select>
                                                <p style={{ color: theme.colors.mutedText, fontSize: '11px', marginTop: '4px' }}>
                                                    {NNS_TOPICS.find(t => t.id === selectedTopic)?.description}
                                                </p>
                                            </div>
                                            <div>
                                                <label style={{ color: theme.colors.mutedText, fontSize: '12px', display: 'block', marginBottom: '6px' }}>
                                                    Neuron IDs to Follow (comma-separated)
                                                </label>
                                                <input
                                                    type="text"
                                                    value={followeeIds}
                                                    onChange={(e) => setFolloweeIds(e.target.value)}
                                                    style={inputStyle}
                                                    placeholder="e.g., 27, 28 (leave empty to clear)"
                                                />
                                                <p style={{ color: theme.colors.mutedText, fontSize: '11px', marginTop: '4px' }}>
                                                    💡 Common: 27 (DFINITY Foundation), 28 (Internet Computer Association)
                                                </p>
                                            </div>
                                            <button
                                                onClick={handleSetFollowing}
                                                disabled={actionLoading === 'following'}
                                                style={{ 
                                                    ...buttonStyle, 
                                                    opacity: actionLoading === 'following' ? 0.6 : 1,
                                                    alignSelf: 'flex-start',
                                                }}
                                            >
                                                {actionLoading === 'following' ? '⏳...' : '✅ Set Following'}
                                            </button>
                                        </div>
                                    </div>
                                )}

                                {activeTab === 'disburse' && (
                                    <div style={cardStyle}>
                                        <h3 style={{ color: theme.colors.primaryText, marginBottom: '15px' }}>Disburse Neuron</h3>
                                        
                                        {neuronInfo && neuronInfo.state !== 3 ? (
                                            <div style={{
                                                background: `${theme.colors.warning || '#f59e0b'}20`,
                                                border: `1px solid ${theme.colors.warning || '#f59e0b'}`,
                                                padding: '15px',
                                                borderRadius: '8px',
                                                marginBottom: '20px',
                                            }}>
                                                <p style={{ color: theme.colors.warning || '#f59e0b', margin: 0 }}>
                                                    ⚠️ Neuron must be fully dissolved before disbursing.
                                                    Current state: <strong>{getNeuronState(neuronInfo.state).label}</strong>
                                                </p>
                                                {neuronInfo.state === 1 && (
                                                    <p style={{ color: theme.colors.mutedText, fontSize: '13px', marginTop: '8px', marginBottom: 0 }}>
                                                        Start dissolving first, then wait for the dissolve delay to complete.
                                                    </p>
                                                )}
                                                {neuronInfo.state === 2 && (
                                                    <p style={{ color: theme.colors.mutedText, fontSize: '13px', marginTop: '8px', marginBottom: 0 }}>
                                                        Dissolving... {formatDuration(Number(neuronInfo.dissolve_delay_seconds))} remaining.
                                                    </p>
                                                )}
                                            </div>
                                        ) : (
                                            <>
                                                <p style={{ color: theme.colors.mutedText, fontSize: '13px', marginBottom: '20px' }}>
                                                    Withdraw ICP from your dissolved neuron. Leave fields empty to disburse all to this canister.
                                                </p>
                                                
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                                                    <div>
                                                        <label style={{ color: theme.colors.mutedText, fontSize: '12px', display: 'block', marginBottom: '6px' }}>
                                                            Amount (ICP) - leave empty to disburse all
                                                        </label>
                                                        <input
                                                            type="number"
                                                            min="0"
                                                            step="0.01"
                                                            value={disburseAmount}
                                                            onChange={(e) => setDisburseAmount(e.target.value)}
                                                            style={inputStyle}
                                                            placeholder="All"
                                                        />
                                                    </div>
                                                    <div>
                                                        <label style={{ color: theme.colors.mutedText, fontSize: '12px', display: 'block', marginBottom: '6px' }}>
                                                            Destination Account ID (hex) - leave empty to send to this canister
                                                        </label>
                                                        <input
                                                            type="text"
                                                            value={disburseToAccount}
                                                            onChange={(e) => setDisburseToAccount(e.target.value)}
                                                            style={inputStyle}
                                                            placeholder="64-character hex (optional)"
                                                        />
                                                    </div>
                                                    <button
                                                        onClick={handleDisburse}
                                                        disabled={actionLoading === 'disburse'}
                                                        style={{ 
                                                            ...buttonStyle, 
                                                            background: theme.colors.error || '#ef4444',
                                                            opacity: actionLoading === 'disburse' ? 0.6 : 1,
                                                            alignSelf: 'flex-start',
                                                        }}
                                                    >
                                                        {actionLoading === 'disburse' ? '⏳...' : '💸 Disburse'}
                                                    </button>
                                                </div>
                                            </>
                                        )}
                                    </div>
                                )}

                                {activeTab === 'hotkeys' && (
                                    <div style={cardStyle}>
                                        <h3 style={{ color: theme.colors.primaryText, marginBottom: '15px' }}>Hot Key Management</h3>
                                        <p style={{ color: theme.colors.mutedText, fontSize: '13px', marginBottom: '20px' }}>
                                            Hot keys can vote and manage following on behalf of this neuron, but cannot disburse or change dissolve settings.
                                        </p>
                                        
                                        {/* Current Hot Keys */}
                                        {fullNeuron && fullNeuron.hot_keys && fullNeuron.hot_keys.length > 0 && (
                                            <div style={{ marginBottom: '20px' }}>
                                                <h4 style={{ color: theme.colors.primaryText, fontSize: '14px', marginBottom: '10px' }}>Current Hot Keys</h4>
                                                {fullNeuron.hot_keys.map((key, idx) => (
                                                    <div key={idx} style={{ 
                                                        display: 'flex', 
                                                        justifyContent: 'space-between', 
                                                        alignItems: 'center',
                                                        padding: '8px',
                                                        background: `${theme.colors.accent}10`,
                                                        borderRadius: '4px',
                                                        marginBottom: '8px',
                                                    }}>
                                                        <span style={{ color: theme.colors.primaryText, fontFamily: 'monospace', fontSize: '12px' }}>
                                                            {key.toText()}
                                                        </span>
                                                        <button
                                                            onClick={() => handleRemoveHotKey(key)}
                                                            disabled={actionLoading === 'removeHotKey'}
                                                            style={{ 
                                                                ...secondaryButtonStyle, 
                                                                padding: '4px 12px', 
                                                                fontSize: '12px',
                                                                color: theme.colors.error,
                                                                borderColor: theme.colors.error,
                                                            }}
                                                        >
                                                            Remove
                                                        </button>
                                                    </div>
                                                ))}
                                            </div>
                                        )}

                                        {/* Add Hot Key */}
                                        <h4 style={{ color: theme.colors.primaryText, fontSize: '14px', marginBottom: '10px' }}>Add Hot Key</h4>
                                        <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                                            <div style={{ flex: 1, minWidth: '250px' }}>
                                                <input
                                                    type="text"
                                                    value={hotKeyPrincipal}
                                                    onChange={(e) => setHotKeyPrincipal(e.target.value)}
                                                    style={inputStyle}
                                                    placeholder="Principal ID"
                                                />
                                            </div>
                                            <button
                                                onClick={handleAddHotKey}
                                                disabled={actionLoading === 'addHotKey'}
                                                style={{ 
                                                    ...buttonStyle, 
                                                    opacity: actionLoading === 'addHotKey' ? 0.6 : 1,
                                                }}
                                            >
                                                {actionLoading === 'addHotKey' ? '⏳...' : '➕ Add Hot Key'}
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </>
                        )}
                    </>
                )}
            </main>
        </div>
    );
}

export default IcpNeuronManager;

