import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { HttpAgent } from '@dfinity/agent';
import { Principal } from '@dfinity/principal';
import { sha224 } from '@dfinity/principal/lib/esm/utils/sha224';
import { createActor as createFactoryActor, canisterId as factoryCanisterId } from 'declarations/sneed_icp_neuron_manager_factory';
import { createActor as createLedgerActor } from 'external/icrc1_ledger';
import { createActor as createCmcActor, CMC_CANISTER_ID } from 'external/cmc';
import Header from '../components/Header';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../AuthContext';
import { FaCheckCircle, FaExclamationTriangle, FaArrowRight } from 'react-icons/fa';

const ICP_LEDGER_CANISTER_ID = 'ryjl3-tyaaa-aaaaa-aaaba-cai';
const E8S = 100_000_000;
const ICP_FEE = 10_000;

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
    
    // Payment state
    const [paymentConfig, setPaymentConfig] = useState(null);
    const [userIcpBalance, setUserIcpBalance] = useState(null);
    const [paymentBalance, setPaymentBalance] = useState(null);
    const [conversionRate, setConversionRate] = useState(null);
    const [sendingPayment, setSendingPayment] = useState(false);
    const [paymentSubaccount, setPaymentSubaccount] = useState(null);
    
    // Creation step: 'idle' | 'payment' | 'creating' | 'done'
    const [creationStep, setCreationStep] = useState('idle');

    const getAgent = useCallback(() => {
        const host = process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging' 
            ? 'https://ic0.app' 
            : 'http://localhost:4943';
        return new HttpAgent({ identity, host });
    }, [identity]);

    const fetchFactoryInfo = useCallback(async () => {
        try {
            const agent = getAgent();
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
            }
            const factory = createFactoryActor(factoryCanisterId, { agent });
            
            const [version, cyclesBalance, managerCount, config] = await Promise.all([
                factory.getCurrentVersion(),
                factory.getCyclesBalance(),
                factory.getManagerCount(),
                factory.getPaymentConfig(),
            ]);
            
            setFactoryInfo({
                version: `${version.major}.${version.minor}.${version.patch}`,
                cyclesBalance: Number(cyclesBalance),
                managerCount: Number(managerCount),
            });
            
            setPaymentConfig({
                creationFeeE8s: Number(config.creationFeeE8s),
                icpForCyclesE8s: Number(config.icpForCyclesE8s),
                minIcpForCyclesE8s: Number(config.minIcpForCyclesE8s),
                maxIcpForCyclesE8s: Number(config.maxIcpForCyclesE8s),
                feeDestination: config.feeDestination,
                paymentRequired: config.paymentRequired,
            });
            
            // Also get the user's payment subaccount
            if (identity) {
                const subaccount = await factory.getPaymentSubaccount(identity.getPrincipal());
                setPaymentSubaccount(Array.from(subaccount));
            }
        } catch (err) {
            console.error('Error fetching factory info:', err);
        }
    }, [getAgent, identity]);

    const fetchUserBalances = useCallback(async () => {
        if (!identity) return;
        
        try {
            const agent = getAgent();
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
            }
            
            const ledger = createLedgerActor(ICP_LEDGER_CANISTER_ID, { agent });
            const factory = createFactoryActor(factoryCanisterId, { agent });
            
            // Fetch user's wallet balance
            const walletBalance = await ledger.icrc1_balance_of({
                owner: identity.getPrincipal(),
                subaccount: [],
            });
            setUserIcpBalance(Number(walletBalance));
            
            // Fetch user's payment balance at factory
            const payBalance = await factory.getUserPaymentBalance(identity.getPrincipal());
            setPaymentBalance(Number(payBalance));
        } catch (err) {
            console.error('Error fetching user balances:', err);
        }
    }, [identity, getAgent]);

    const fetchConversionRate = useCallback(async () => {
        try {
            const host = 'https://ic0.app';
            const agent = HttpAgent.createSync({ host });
            
            const cmc = createCmcActor(CMC_CANISTER_ID, { agent });
            const response = await cmc.get_icp_xdr_conversion_rate();
            
            const xdrPerIcp = Number(response.data.xdr_permyriad_per_icp) / 10000;
            const cyclesPerIcp = xdrPerIcp * 1_000_000_000_000;
            
            setConversionRate({
                xdrPerIcp,
                cyclesPerIcp,
            });
        } catch (err) {
            console.error('Error fetching conversion rate:', err);
        }
    }, []);

    const fetchMyManagers = useCallback(async () => {
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
    }, [getAgent]);

    useEffect(() => {
        if (isAuthenticated && identity) {
            fetchMyManagers();
            fetchFactoryInfo();
            fetchUserBalances();
            fetchConversionRate();
        }
    }, [isAuthenticated, identity, fetchMyManagers, fetchFactoryInfo, fetchUserBalances, fetchConversionRate]);

    const fetchBalances = async (managerList, agent) => {
        try {
            const ledger = createLedgerActor(ICP_LEDGER_CANISTER_ID, { agent });
            const newBalances = {};
            
            const balancePromises = managerList.map(async (manager) => {
                try {
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

    // Calculate suggested ICP for cycles based on current rate
    const calculateSuggestedIcpForCycles = () => {
        if (!conversionRate || !paymentConfig) return null;
        
        // Target: ~2T cycles
        const targetCycles = 2_000_000_000_000;
        const suggestedIcp = targetCycles / conversionRate.cyclesPerIcp;
        const suggestedE8s = Math.ceil(suggestedIcp * E8S);
        
        // Clamp to min/max bounds
        const clamped = Math.max(
            paymentConfig.minIcpForCyclesE8s,
            Math.min(paymentConfig.maxIcpForCyclesE8s, suggestedE8s)
        );
        
        return clamped;
    };

    // Send payment to factory
    const handleSendPayment = async () => {
        if (!identity || !paymentConfig || !paymentSubaccount) return;
        
        setSendingPayment(true);
        setError('');
        
        try {
            const agent = getAgent();
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
            }
            
            const ledger = createLedgerActor(ICP_LEDGER_CANISTER_ID, { agent });
            
            // Transfer creation fee to factory's subaccount for this user
            const result = await ledger.icrc1_transfer({
                to: {
                    owner: Principal.fromText(factoryCanisterId),
                    subaccount: [new Uint8Array(paymentSubaccount)],
                },
                amount: BigInt(paymentConfig.creationFeeE8s),
                fee: [BigInt(ICP_FEE)],
                memo: [],
                from_subaccount: [],
                created_at_time: [],
            });
            
            if ('Ok' in result) {
                setSuccess('✅ Payment sent! You can now create your neuron manager.');
                await fetchUserBalances();
                setCreationStep('payment');
            } else {
                const err = result.Err;
                if ('InsufficientFunds' in err) {
                    setError(`Insufficient funds: ${formatIcp(Number(err.InsufficientFunds.balance))} ICP available`);
                } else {
                    setError(`Payment failed: ${JSON.stringify(err)}`);
                }
            }
        } catch (err) {
            console.error('Error sending payment:', err);
            setError(`Payment error: ${err.message}`);
        } finally {
            setSendingPayment(false);
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
        setCreationStep('creating');
        
        try {
            const agent = getAgent();
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
            }
            const factory = createFactoryActor(factoryCanisterId, { agent });
            
            // Calculate suggested ICP for cycles
            const suggestedIcpForCycles = calculateSuggestedIcpForCycles();
            
            const result = await factory.createNeuronManager(
                suggestedIcpForCycles ? [BigInt(suggestedIcpForCycles)] : []
            );
            
            if ('Ok' in result) {
                const { canisterId, accountId } = result.Ok;
                const accountIdHex = Array.from(accountId).map(b => b.toString(16).padStart(2, '0')).join('');
                setSuccess(`🎉 Neuron Manager Created!\n\nCanister ID: ${canisterId.toText()}\n\nAccount ID (for funding): ${accountIdHex}`);
                setCreationStep('done');
                fetchMyManagers();
                fetchFactoryInfo();
                fetchUserBalances();
            } else if ('Err' in result) {
                const err = result.Err;
                if ('InsufficientCycles' in err) {
                    setError('Factory has insufficient cycles to create a new canister. Please try again later.');
                } else if ('CanisterCreationFailed' in err) {
                    setError(`Canister creation failed: ${err.CanisterCreationFailed}`);
                } else if ('NotAuthorized' in err) {
                    setError('Not authorized to create a neuron manager.');
                } else if ('InsufficientPayment' in err) {
                    setError(`Insufficient payment: Required ${formatIcp(Number(err.InsufficientPayment.required))} ICP, provided ${formatIcp(Number(err.InsufficientPayment.provided))} ICP`);
                } else if ('TransferFailed' in err) {
                    setError(`Transfer failed: ${err.TransferFailed}`);
                } else if ('CyclesTopUpFailed' in err) {
                    setError(`Cycles top-up failed: ${err.CyclesTopUpFailed}`);
                } else {
                    setError('Failed to create neuron manager');
                }
                setCreationStep('payment');
            }
        } catch (err) {
            console.error('Error creating manager:', err);
            setError(`Error: ${err.message || 'Failed to create neuron manager'}`);
            setCreationStep('payment');
        } finally {
            setCreating(false);
        }
    };

    const formatIcp = (e8s) => {
        if (e8s === null || e8s === undefined) return '...';
        const icp = e8s / E8S;
        return icp.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 });
    };

    const formatCycles = (cycles) => {
        if (cycles >= 1_000_000_000_000) {
            return (cycles / 1_000_000_000_000).toFixed(2) + ' T';
        } else if (cycles >= 1_000_000_000) {
            return (cycles / 1_000_000_000).toFixed(2) + ' B';
        }
        return cycles.toLocaleString();
    };

    const copyToClipboard = (text) => {
        navigator.clipboard.writeText(text);
    };

    // Compute account ID from principal
    const computeAccountId = (principal) => {
        try {
            const principalBytes = principal.toUint8Array();
            const domainSeparator = new Uint8Array([0x0a, ...new TextEncoder().encode('account-id')]);
            const subaccount = new Uint8Array(32);
            const preimage = new Uint8Array(domainSeparator.length + principalBytes.length + subaccount.length);
            preimage.set(domainSeparator, 0);
            preimage.set(principalBytes, domainSeparator.length);
            preimage.set(subaccount, domainSeparator.length + principalBytes.length);
            const hash = sha224(preimage);
            const crc = crc32(hash);
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

    // Check if user has enough payment balance
    const hasEnoughPayment = paymentConfig && paymentBalance !== null && 
        paymentBalance >= paymentConfig.creationFeeE8s;
    
    // Check if user has enough in wallet to send payment
    const canSendPayment = paymentConfig && userIcpBalance !== null &&
        userIcpBalance >= paymentConfig.creationFeeE8s + ICP_FEE;

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

                {/* Create Manager Section with Payment Flow */}
                {isAuthenticated && paymentConfig && (
                    <div style={{ ...cardStyle, marginBottom: '30px' }}>
                        <h3 style={{ color: theme.colors.primaryText, marginBottom: '20px', textAlign: 'center' }}>
                            ➕ Create New Neuron Manager
                        </h3>
                        
                        {/* Payment Required Info */}
                        {paymentConfig.paymentRequired && (
                            <div style={{ 
                                background: `${theme.colors.accent}15`,
                                borderRadius: '8px',
                                padding: '16px',
                                marginBottom: '20px'
                            }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '15px' }}>
                                    <div>
                                        <div style={{ color: theme.colors.mutedText, fontSize: '12px' }}>Creation Fee</div>
                                        <div style={{ color: theme.colors.primaryText, fontSize: '24px', fontWeight: '700' }}>
                                            {formatIcp(paymentConfig.creationFeeE8s)} ICP
                                        </div>
                                    </div>
                                    <div style={{ textAlign: 'right' }}>
                                        <div style={{ color: theme.colors.mutedText, fontSize: '12px' }}>Your Wallet Balance</div>
                                        <div style={{ color: theme.colors.primaryText, fontSize: '18px', fontWeight: '600' }}>
                                            {formatIcp(userIcpBalance)} ICP
                                        </div>
                                    </div>
                                </div>
                                
                                {/* Conversion rate info */}
                                {conversionRate && (
                                    <div style={{ 
                                        marginTop: '12px', 
                                        paddingTop: '12px', 
                                        borderTop: `1px solid ${theme.colors.border}`,
                                        color: theme.colors.mutedText,
                                        fontSize: '12px'
                                    }}>
                                        Current rate: 1 ICP ≈ {formatCycles(conversionRate.cyclesPerIcp)} cycles
                                    </div>
                                )}
                            </div>
                        )}
                        
                        {/* Payment Status Steps */}
                        {paymentConfig.paymentRequired && (
                            <div style={{ 
                                display: 'flex', 
                                alignItems: 'center', 
                                justifyContent: 'center',
                                gap: '10px',
                                marginBottom: '20px',
                                flexWrap: 'wrap'
                            }}>
                                {/* Step 1: Payment */}
                                <div style={{ 
                                    display: 'flex', 
                                    alignItems: 'center', 
                                    gap: '8px',
                                    padding: '8px 16px',
                                    borderRadius: '20px',
                                    background: hasEnoughPayment ? `${theme.colors.success || '#22c55e'}20` : `${theme.colors.warning || '#f59e0b'}20`,
                                    border: `1px solid ${hasEnoughPayment ? (theme.colors.success || '#22c55e') : (theme.colors.warning || '#f59e0b')}`
                                }}>
                                    {hasEnoughPayment ? (
                                        <FaCheckCircle color={theme.colors.success || '#22c55e'} />
                                    ) : (
                                        <FaExclamationTriangle color={theme.colors.warning || '#f59e0b'} />
                                    )}
                                    <span style={{ 
                                        color: hasEnoughPayment ? (theme.colors.success || '#22c55e') : (theme.colors.warning || '#f59e0b'),
                                        fontSize: '13px',
                                        fontWeight: '500'
                                    }}>
                                        {hasEnoughPayment ? 'Payment Ready' : 'Payment Required'}
                                    </span>
                                </div>
                                
                                <FaArrowRight style={{ color: theme.colors.mutedText }} />
                                
                                {/* Step 2: Create */}
                                <div style={{ 
                                    display: 'flex', 
                                    alignItems: 'center', 
                                    gap: '8px',
                                    padding: '8px 16px',
                                    borderRadius: '20px',
                                    background: creationStep === 'done' ? `${theme.colors.success || '#22c55e'}20` : `${theme.colors.border}50`,
                                    border: `1px solid ${creationStep === 'done' ? (theme.colors.success || '#22c55e') : theme.colors.border}`
                                }}>
                                    {creationStep === 'done' ? (
                                        <FaCheckCircle color={theme.colors.success || '#22c55e'} />
                                    ) : (
                                        <span style={{ 
                                            width: '16px', 
                                            height: '16px', 
                                            borderRadius: '50%', 
                                            border: `2px solid ${theme.colors.mutedText}`,
                                            display: 'inline-block'
                                        }} />
                                    )}
                                    <span style={{ 
                                        color: creationStep === 'done' ? (theme.colors.success || '#22c55e') : theme.colors.mutedText,
                                        fontSize: '13px',
                                        fontWeight: '500'
                                    }}>
                                        Create Manager
                                    </span>
                                </div>
                            </div>
                        )}
                        
                        {/* Deposited Payment Balance */}
                        {paymentConfig.paymentRequired && (
                            <div style={{ 
                                background: theme.colors.tertiaryBg || theme.colors.secondaryBg,
                                borderRadius: '8px',
                                padding: '12px 16px',
                                marginBottom: '16px',
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center'
                            }}>
                                <span style={{ color: theme.colors.mutedText, fontSize: '13px' }}>
                                    Your Deposited Payment:
                                </span>
                                <span style={{ 
                                    color: hasEnoughPayment ? (theme.colors.success || '#22c55e') : theme.colors.primaryText,
                                    fontWeight: '600',
                                    fontSize: '14px'
                                }}>
                                    {formatIcp(paymentBalance)} ICP
                                    {hasEnoughPayment && ' ✓'}
                                </span>
                            </div>
                        )}
                        
                        {/* Action Buttons */}
                        <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', flexWrap: 'wrap' }}>
                            {/* Send Payment Button */}
                            {paymentConfig.paymentRequired && !hasEnoughPayment && (
                                <button
                                    style={{ 
                                        ...buttonStyle,
                                        opacity: (!canSendPayment || sendingPayment) ? 0.6 : 1,
                                        cursor: (!canSendPayment || sendingPayment) ? 'not-allowed' : 'pointer',
                                    }}
                                    onClick={handleSendPayment}
                                    disabled={!canSendPayment || sendingPayment}
                                >
                                    {sendingPayment ? '⏳ Sending Payment...' : `💰 Send ${formatIcp(paymentConfig.creationFeeE8s)} ICP`}
                                </button>
                            )}
                            
                            {/* Create Manager Button */}
                            {(!paymentConfig.paymentRequired || hasEnoughPayment) && (
                                <button 
                                    style={{ 
                                        ...buttonStyle, 
                                        opacity: creating ? 0.7 : 1,
                                        cursor: creating ? 'not-allowed' : 'pointer',
                                    }} 
                                    onClick={handleCreateManager}
                                    disabled={creating}
                                >
                                    {creating ? '⏳ Creating...' : '🚀 Create Neuron Manager'}
                                </button>
                            )}
                        </div>
                        
                        {/* Help text */}
                        <p style={{ color: theme.colors.mutedText, fontSize: '12px', marginTop: '15px', textAlign: 'center' }}>
                            {paymentConfig.paymentRequired ? (
                                hasEnoughPayment 
                                    ? 'Payment received! Click "Create Neuron Manager" to proceed.'
                                    : `Send ${formatIcp(paymentConfig.creationFeeE8s)} ICP to deposit your payment, then create your manager.`
                            ) : (
                                'Creating a neuron manager is currently free!'
                            )}
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
                                    Use the form above to create your first neuron manager!
                                </p>
                            </div>
                        ) : (
                            <div>
                                {managers.map((manager) => {
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
                        <li><strong>Pay the Creation Fee:</strong> Send ICP to cover the cost of creating your dedicated canister.</li>
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
