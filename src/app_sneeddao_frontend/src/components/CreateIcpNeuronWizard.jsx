import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { HttpAgent, Actor } from '@dfinity/agent';
import { Principal } from '@dfinity/principal';
import { principalToSubAccount } from '@dfinity/utils';
import { FaCheck, FaSpinner, FaArrowRight, FaArrowLeft, FaWallet, FaGasPump, FaBrain, FaClock, FaRocket } from 'react-icons/fa';
import { createActor as createFactoryActor, canisterId as factoryCanisterId } from 'declarations/sneed_icp_neuron_manager_factory';
import { createActor as createManagerActor } from 'declarations/sneed_icp_neuron_manager';
import { createActor as createLedgerActor } from 'external/icrc1_ledger';
import { createActor as createCmcActor, CMC_CANISTER_ID } from 'external/cmc';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../AuthContext';
import { computeAccountId } from '../utils/PrincipalUtils';
import { formatCyclesCompact } from '../utils/NeuronManagerSettings';
import { usePremiumStatus } from '../hooks/usePremiumStatus';

const ICP_LEDGER_CANISTER_ID = 'ryjl3-tyaaa-aaaaa-aaaba-cai';
const E8S = 100_000_000;
const ICP_FEE = 10_000;
const CANISTER_CREATION_OVERHEAD = 500_000_000_000; // ~500B cycles used for canister creation

// CMC memo for top-up operation: "TPUP" = 0x50555054
const TOP_UP_MEMO = new Uint8Array([0x54, 0x50, 0x55, 0x50, 0x00, 0x00, 0x00, 0x00]);

function CreateIcpNeuronWizard({ onComplete, onCancel }) {
    const { theme } = useTheme();
    const { identity, isAuthenticated } = useAuth();
    const navigate = useNavigate();
    
    // Premium status for discounted pricing
    const { isPremium, loading: loadingPremium } = usePremiumStatus(identity);
    
    // Wizard state
    const [currentStep, setCurrentStep] = useState(1);
    
    // Step 1: Wallet funding state
    const [userIcpBalance, setUserIcpBalance] = useState(null);
    const [loadingBalance, setLoadingBalance] = useState(true);
    const [copiedPid, setCopiedPid] = useState(false);
    const [copiedAccountId, setCopiedAccountId] = useState(false);
    
    // Step 2: Gas configuration
    const [paymentConfig, setPaymentConfig] = useState(null);
    const [premiumFeeE8s, setPremiumFeeE8s] = useState(null);
    const [conversionRate, setConversionRate] = useState(null);
    const [extraGasIcp, setExtraGasIcp] = useState('');
    
    // Step 3: Staking configuration
    const [stakingChoice, setStakingChoice] = useState('now'); // 'now' | 'later' - default to 'now'
    const [stakeAmount, setStakeAmount] = useState('1');
    const [dissolveDelayDays, setDissolveDelayDays] = useState('365');
    
    // Dissolve delay limits
    const MIN_DISSOLVE_DELAY_DAYS = 183; // ~6 months to vote
    const MAX_DISSOLVE_DELAY_DAYS = 2922; // 8 years
    
    // Payment subaccount
    const [paymentSubaccount, setPaymentSubaccount] = useState(null);
    
    // Creation process state
    const [isCreating, setIsCreating] = useState(false);
    const [creationProgress, setCreationProgress] = useState([]);
    const [creationError, setCreationError] = useState('');
    const [createdCanisterId, setCreatedCanisterId] = useState(null);
    const [createdNeuronId, setCreatedNeuronId] = useState(null);
    const [creationComplete, setCreationComplete] = useState(false);
    
    const myPrincipal = identity?.getPrincipal?.() || null;
    const myAccountId = useMemo(() => {
        if (!myPrincipal) return null;
        return computeAccountId(myPrincipal);
    }, [myPrincipal]);

    const getAgent = useCallback(() => {
        const host = process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging' 
            ? 'https://ic0.app' 
            : 'http://localhost:4943';
        return new HttpAgent({ identity, host });
    }, [identity]);

    // Fetch user balance and payment config
    const fetchData = useCallback(async () => {
        if (!identity) return;
        
        setLoadingBalance(true);
        try {
            const agent = getAgent();
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
            }
            
            const ledger = createLedgerActor(ICP_LEDGER_CANISTER_ID, { agent });
            const factory = createFactoryActor(factoryCanisterId, { agent });
            
            const [walletBalance, config, premiumFee, subaccount] = await Promise.all([
                ledger.icrc1_balance_of({
                    owner: identity.getPrincipal(),
                    subaccount: [],
                }),
                factory.getPaymentConfig(),
                factory.getPremiumCreationFee(),
                factory.getPaymentSubaccount(identity.getPrincipal()),
            ]);
            
            setUserIcpBalance(Number(walletBalance));
            setPaymentConfig({
                creationFeeE8s: Number(config.creationFeeE8s),
                targetCyclesAmount: Number(config.targetCyclesAmount),
                feeDestination: config.feeDestination,
                paymentRequired: config.paymentRequired,
            });
            setPremiumFeeE8s(Number(premiumFee));
            setPaymentSubaccount(Array.from(subaccount));
        } catch (err) {
            console.error('Error fetching data:', err);
        } finally {
            setLoadingBalance(false);
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

    useEffect(() => {
        if (isAuthenticated && identity) {
            fetchData();
            fetchConversionRate();
        }
    }, [isAuthenticated, identity, fetchData, fetchConversionRate]);

    // Refresh balance periodically when on step 1
    useEffect(() => {
        if (currentStep === 1 && isAuthenticated && identity) {
            const interval = setInterval(fetchData, 10000);
            return () => clearInterval(interval);
        }
    }, [currentStep, isAuthenticated, identity, fetchData]);

    // Calculate effective fee
    const effectiveFeeE8s = isPremium && premiumFeeE8s !== null 
        ? premiumFeeE8s 
        : (paymentConfig?.creationFeeE8s || 0);
    
    const discountPercent = paymentConfig && premiumFeeE8s !== null && paymentConfig.creationFeeE8s > 0
        ? Math.round((1 - premiumFeeE8s / paymentConfig.creationFeeE8s) * 100)
        : 0;
    
    // Calculate total ICP needed
    const extraGasE8s = extraGasIcp ? Math.floor(parseFloat(extraGasIcp) * E8S) : 0;
    const stakeE8s = stakingChoice === 'now' && stakeAmount ? Math.floor(parseFloat(stakeAmount) * E8S) : 0;
    
    const totalRequiredE8s = effectiveFeeE8s + ICP_FEE + extraGasE8s + (stakeE8s > 0 ? stakeE8s + ICP_FEE : 0);
    const hasEnoughBalance = userIcpBalance !== null && userIcpBalance >= totalRequiredE8s;
    
    // Calculate cycles from extra gas
    const extraGasCycles = conversionRate ? (extraGasE8s / E8S) * conversionRate.cyclesPerIcp : 0;
    
    // Step validation
    const canProceedStep1 = hasEnoughBalance && userIcpBalance >= effectiveFeeE8s + ICP_FEE;
    const canProceedStep2 = true; // Extra gas is optional
    const canProceedStep3 = stakingChoice !== null && (stakingChoice === 'later' || (stakingChoice === 'now' && parseFloat(stakeAmount) >= 1));
    
    // Final validation before creation
    const canCreate = canProceedStep3 && hasEnoughBalance;

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

    const addProgress = (message, status = 'pending') => {
        setCreationProgress(prev => [...prev, { message, status, time: Date.now() }]);
    };

    const updateLastProgress = (status) => {
        setCreationProgress(prev => {
            const updated = [...prev];
            if (updated.length > 0) {
                updated[updated.length - 1].status = status;
            }
            return updated;
        });
    };

    // Main creation flow
    const handleCreate = async () => {
        if (!identity || !paymentConfig || !paymentSubaccount) return;
        
        setIsCreating(true);
        setCreationError('');
        setCreationProgress([]);
        setCreatedCanisterId(null);
        setCreatedNeuronId(null);
        
        try {
            const agent = getAgent();
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
            }
            
            const ledger = createLedgerActor(ICP_LEDGER_CANISTER_ID, { agent });
            const factory = createFactoryActor(factoryCanisterId, { agent });
            
            // Step 1: Send payment
            addProgress('Sending payment to factory...', 'active');
            
            const transferResult = await ledger.icrc1_transfer({
                to: {
                    owner: Principal.fromText(factoryCanisterId),
                    subaccount: [new Uint8Array(paymentSubaccount)],
                },
                amount: BigInt(effectiveFeeE8s),
                fee: [BigInt(ICP_FEE)],
                memo: [],
                from_subaccount: [],
                created_at_time: [],
            });
            
            if ('Err' in transferResult) {
                throw new Error(`Payment failed: ${JSON.stringify(transferResult.Err)}`);
            }
            
            updateLastProgress('complete');
            
            // Step 2: Create neuron manager
            addProgress('Creating your neuron manager canister...', 'active');
            
            const createResult = await factory.createNeuronManager();
            
            if ('Err' in createResult) {
                const err = createResult.Err;
                if ('InsufficientPayment' in err) {
                    throw new Error(`Insufficient payment: needed ${formatIcp(Number(err.InsufficientPayment.required))} ICP`);
                }
                throw new Error(`Creation failed: ${JSON.stringify(err)}`);
            }
            
            const newCanisterId = createResult.Ok.canisterId;
            const newCanisterIdText = newCanisterId.toText();
            setCreatedCanisterId(newCanisterIdText);
            updateLastProgress('complete');
            
            // IMPORTANT: Immediately notify parent that manager was created
            // This ensures the manager shows up in the list even if subsequent steps fail
            if (onComplete) {
                onComplete(newCanisterIdText);
            }
            
            // Step 3: Top up with extra gas (if specified)
            if (extraGasE8s > 0) {
                addProgress(`Topping up canister with ${formatIcp(extraGasE8s)} ICP for gas...`, 'active');
                
                try {
                    // Use principalToSubAccount for correct subaccount computation
                    const subaccount = principalToSubAccount(newCanisterId);
                    
                    // Transfer to CMC
                    const topUpTransfer = await ledger.icrc1_transfer({
                        to: {
                            owner: Principal.fromText(CMC_CANISTER_ID),
                            subaccount: [subaccount],
                        },
                        amount: BigInt(extraGasE8s),
                        fee: [BigInt(ICP_FEE)],
                        memo: [TOP_UP_MEMO],
                        from_subaccount: [],
                        created_at_time: [],
                    });
                    
                    if ('Err' in topUpTransfer) {
                        console.error('Top-up transfer failed:', topUpTransfer.Err);
                        updateLastProgress('warning');
                        addProgress('⚠️ Gas top-up failed (canister was still created)', 'warning');
                    } else {
                        // Notify CMC to top up the canister
                        const cmc = createCmcActor(CMC_CANISTER_ID, { agent });
                        const notifyResult = await cmc.notify_top_up({
                            canister_id: newCanisterId,
                            block_index: topUpTransfer.Ok,
                        });
                        
                        if ('Err' in notifyResult) {
                            console.error('CMC notify failed:', notifyResult.Err);
                            updateLastProgress('warning');
                            addProgress(`⚠️ CMC notification failed: ${JSON.stringify(notifyResult.Err)}`, 'warning');
                        } else {
                            updateLastProgress('complete');
                        }
                    }
                } catch (topUpErr) {
                    console.error('Top-up error:', topUpErr);
                    updateLastProgress('warning');
                    addProgress(`⚠️ Gas top-up failed: ${topUpErr.message}`, 'warning');
                }
            }
            
            // Step 4: Stake ICP (if user chose to stake now)
            if (stakingChoice === 'now' && stakeE8s > 0) {
                addProgress(`Staking ${formatIcp(stakeE8s)} ICP in new neuron...`, 'active');
                
                try {
                    const manager = createManagerActor(newCanisterIdText, { agent });
                    
                    // Generate memo and get stake account
                    const memo = await manager.generateMemo();
                    const stakeInfo = await manager.getStakeAccount(memo);
                    
                    // Transfer ICP to governance canister's neuron subaccount
                    const stakeTransfer = await ledger.icrc1_transfer({
                        to: {
                            owner: stakeInfo.account.owner,
                            subaccount: stakeInfo.account.subaccount,
                        },
                        amount: BigInt(stakeE8s),
                        fee: [BigInt(ICP_FEE)],
                        memo: [],
                        from_subaccount: [],
                        created_at_time: [],
                    });
                    
                    if ('Err' in stakeTransfer) {
                        throw new Error(`Stake transfer failed: ${JSON.stringify(stakeTransfer.Err)}`);
                    }
                    
                    // Wait a moment for the transfer to settle
                    updateLastProgress('complete');
                    addProgress('Claiming neuron from deposit...', 'active');
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    
                    const dissolveDelaySeconds = BigInt(parseInt(dissolveDelayDays) * 24 * 60 * 60);
                    const claimResult = await manager.claimNeuronFromDeposit(memo, dissolveDelaySeconds);
                    
                    if ('Ok' in claimResult) {
                        setCreatedNeuronId(claimResult.Ok.id.toString());
                        updateLastProgress('complete');
                    } else {
                        throw new Error(`Claim failed: ${JSON.stringify(claimResult.Err)}`);
                    }
                } catch (stakeErr) {
                    console.error('Staking error:', stakeErr);
                    updateLastProgress('error');
                    addProgress(`⚠️ Staking failed: ${stakeErr.message}`, 'warning');
                    addProgress('You can stake ICP later from your neuron manager.', 'info');
                }
            }
            
            // Done!
            addProgress('✅ Neuron manager created successfully!', 'complete');
            setCreationComplete(true);
            
        } catch (err) {
            console.error('Creation error:', err);
            setCreationError(err.message || 'Failed to create neuron manager');
            updateLastProgress('error');
        } finally {
            setIsCreating(false);
        }
    };

    const goToStep = (step) => {
        if (step <= currentStep || step === currentStep + 1) {
            // Validate before moving forward
            if (step > currentStep) {
                if (currentStep === 1 && !canProceedStep1) return;
                if (currentStep === 2 && !canProceedStep2) return;
                if (currentStep === 3 && !canProceedStep3) return;
            }
            setCurrentStep(step);
        }
    };

    // Styles
    const styles = {
        container: {
            maxWidth: '700px',
            margin: '0 auto',
        },
        hero: {
            textAlign: 'center',
            marginBottom: '1.5rem',
        },
        title: {
            fontSize: '1.8rem',
            marginBottom: '0.5rem',
            color: theme.colors.primaryText,
            fontWeight: 'bold',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '12px',
        },
        subtitle: {
            fontSize: '1rem',
            color: theme.colors.mutedText,
            lineHeight: '1.5',
        },
        stepProgress: {
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'center',
            gap: '0',
            marginBottom: '2rem',
        },
        stepCircle: (stepNum, isActive, isCompleted) => ({
            width: '40px',
            height: '40px',
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: '600',
            fontSize: '1rem',
            background: isCompleted 
                ? theme.colors.success || '#22c55e'
                : isActive 
                    ? theme.colors.accent 
                    : theme.colors.tertiaryBg || theme.colors.secondaryBg,
            color: isCompleted || isActive ? '#fff' : theme.colors.mutedText,
            border: `2px solid ${isCompleted ? (theme.colors.success || '#22c55e') : isActive ? theme.colors.accent : theme.colors.border}`,
            cursor: (isCompleted || stepNum <= currentStep) ? 'pointer' : 'default',
            transition: 'all 0.3s ease',
        }),
        stepLine: (isCompleted) => ({
            width: '50px',
            height: '3px',
            background: isCompleted ? (theme.colors.success || '#22c55e') : theme.colors.border,
            transition: 'all 0.3s ease',
            marginTop: '18px',
        }),
        stepLabel: (isActive) => ({
            fontSize: '0.7rem',
            color: isActive ? theme.colors.primaryText : theme.colors.mutedText,
            marginTop: '6px',
            textAlign: 'center',
            maxWidth: '70px',
        }),
        card: {
            background: theme.colors.cardBackground || theme.colors.secondaryBg,
            borderRadius: '16px',
            padding: '1.5rem',
            marginBottom: '1.5rem',
            border: `1px solid ${theme.colors.border}`,
        },
        inputGroup: {
            marginBottom: '1.5rem',
        },
        label: {
            display: 'block',
            color: theme.colors.primaryText,
            marginBottom: '8px',
            fontWeight: '500',
            fontSize: '0.95rem',
        },
        input: {
            width: '100%',
            padding: '12px 14px',
            background: theme.colors.primaryBg || theme.colors.tertiaryBg,
            border: `1px solid ${theme.colors.border}`,
            borderRadius: '10px',
            color: theme.colors.primaryText,
            fontSize: '1rem',
            outline: 'none',
            boxSizing: 'border-box',
        },
        buttonRow: {
            display: 'flex',
            gap: '12px',
            marginTop: '1.5rem',
        },
        backButton: {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            flex: 1,
            padding: '14px 20px',
            background: theme.colors.secondaryBg,
            border: `1px solid ${theme.colors.border}`,
            borderRadius: '10px',
            color: theme.colors.primaryText,
            fontSize: '1rem',
            fontWeight: '500',
            cursor: 'pointer',
            transition: 'all 0.2s ease',
        },
        continueButton: (isEnabled) => ({
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            flex: 2,
            padding: '14px 20px',
            background: isEnabled 
                ? `linear-gradient(135deg, ${theme.colors.accent}, ${theme.colors.accent}dd)` 
                : (theme.colors.tertiaryBg || theme.colors.secondaryBg),
            border: 'none',
            borderRadius: '10px',
            color: isEnabled ? '#fff' : theme.colors.mutedText,
            fontSize: '1rem',
            fontWeight: '600',
            cursor: isEnabled ? 'pointer' : 'not-allowed',
            transition: 'all 0.2s ease',
            boxShadow: isEnabled ? `0 4px 20px ${theme.colors.accent}40` : 'none',
        }),
        optionCard: (isSelected) => ({
            display: 'flex',
            alignItems: 'center',
            gap: '16px',
            padding: '16px',
            background: isSelected ? `${theme.colors.accent}15` : (theme.colors.primaryBg || theme.colors.tertiaryBg),
            border: `2px solid ${isSelected ? theme.colors.accent : theme.colors.border}`,
            borderRadius: '12px',
            cursor: 'pointer',
            transition: 'all 0.2s ease',
            marginBottom: '12px',
        }),
        optionIcon: (isSelected) => ({
            fontSize: '1.5rem',
            color: isSelected ? theme.colors.accent : theme.colors.mutedText,
        }),
        infoBox: {
            background: `${theme.colors.accent}10`,
            borderRadius: '10px',
            padding: '14px',
            marginBottom: '1rem',
            border: `1px solid ${theme.colors.accent}30`,
        },
        warningBox: {
            background: `${(theme.colors.warning || '#f59e0b')}15`,
            borderRadius: '10px',
            padding: '14px',
            marginBottom: '1rem',
            border: `1px solid ${(theme.colors.warning || '#f59e0b')}30`,
            color: theme.colors.warning || '#f59e0b',
        },
        errorBox: {
            background: `${(theme.colors.error || '#ef4444')}15`,
            borderRadius: '10px',
            padding: '14px',
            marginBottom: '1rem',
            border: `1px solid ${(theme.colors.error || '#ef4444')}30`,
            color: theme.colors.error || '#ef4444',
        },
        progressOverlay: {
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0,0,0,0.85)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
        },
        progressCard: {
            background: theme.colors.cardBackground || theme.colors.secondaryBg,
            borderRadius: '16px',
            padding: '2rem',
            maxWidth: '500px',
            width: '90%',
            border: `1px solid ${theme.colors.border}`,
        },
        progressItem: (status) => ({
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            padding: '10px 0',
            color: status === 'complete' ? (theme.colors.success || '#22c55e') 
                : status === 'error' ? (theme.colors.error || '#ef4444')
                : status === 'warning' ? (theme.colors.warning || '#f59e0b')
                : status === 'active' ? theme.colors.accent
                : theme.colors.mutedText,
            fontSize: '0.95rem',
        }),
        spinner: {
            animation: 'spin 1s linear infinite',
        },
        successCard: {
            textAlign: 'center',
            padding: '2rem',
        },
        successIcon: {
            width: '80px',
            height: '80px',
            borderRadius: '50%',
            background: `${theme.colors.success || '#22c55e'}20`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 1.5rem',
        },
    };

    const spinnerKeyframes = `
        @keyframes spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
        }
    `;

    const stepLabels = ['Fund Wallet', 'Configure Gas', 'Stake ICP', 'Create'];

    const renderStepProgress = () => (
        <div style={styles.stepProgress}>
            <style>{spinnerKeyframes}</style>
            {[1, 2, 3, 4].map((stepNum, index) => (
                <React.Fragment key={stepNum}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                        <div 
                            style={styles.stepCircle(stepNum, stepNum === currentStep, stepNum < currentStep)}
                            onClick={() => goToStep(stepNum)}
                        >
                            {stepNum < currentStep ? <FaCheck size={16} /> : stepNum}
                        </div>
                        <div style={styles.stepLabel(stepNum === currentStep)}>
                            {stepLabels[stepNum - 1]}
                        </div>
                    </div>
                    {index < 3 && <div style={styles.stepLine(stepNum < currentStep)} />}
                </React.Fragment>
            ))}
        </div>
    );

    // Step 1: Fund Your Wallet
    const renderStep1 = () => (
        <>
            <div style={styles.hero}>
                <h2 style={styles.title}>
                    <FaWallet style={{ color: theme.colors.accent }} />
                    Fund Your Wallet
                </h2>
                <p style={styles.subtitle}>
                    Make sure you have enough ICP to create your neuron manager
                </p>
            </div>

            <div style={styles.card}>
                {/* Balance display */}
                <div style={{
                    background: hasEnoughBalance 
                        ? `${theme.colors.success || '#22c55e'}15`
                        : `${theme.colors.warning || '#f59e0b'}15`,
                    borderRadius: '12px',
                    padding: '20px',
                    marginBottom: '1.5rem',
                    border: `1px solid ${hasEnoughBalance ? (theme.colors.success || '#22c55e') : (theme.colors.warning || '#f59e0b')}30`,
                    textAlign: 'center',
                }}>
                    <div style={{ color: theme.colors.mutedText, fontSize: '0.85rem', marginBottom: '6px' }}>
                        Your ICP Balance
                    </div>
                    <div style={{ 
                        color: hasEnoughBalance ? (theme.colors.success || '#22c55e') : (theme.colors.warning || '#f59e0b'),
                        fontSize: '2rem',
                        fontWeight: '700',
                    }}>
                        {loadingBalance ? (
                            <FaSpinner style={styles.spinner} />
                        ) : (
                            `${formatIcp(userIcpBalance)} ICP`
                        )}
                    </div>
                    {!hasEnoughBalance && paymentConfig && (
                        <div style={{ color: theme.colors.mutedText, fontSize: '0.85rem', marginTop: '8px' }}>
                            Minimum required: {formatIcp(effectiveFeeE8s + ICP_FEE)} ICP
                        </div>
                    )}
                </div>

                {/* Deposit address */}
                <div style={{ marginBottom: '1rem' }}>
                    <div style={{ color: theme.colors.mutedText, fontSize: '0.85rem', marginBottom: '10px' }}>
                        💰 <strong>Deposit ICP to your wallet:</strong>
                    </div>
                    
                    {/* Principal ID */}
                    <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px',
                        padding: '12px',
                        background: theme.colors.primaryBg || theme.colors.tertiaryBg,
                        borderRadius: '8px',
                        marginBottom: '10px',
                    }}>
                        <div style={{ flex: 1, fontFamily: 'monospace', fontSize: '0.85rem', color: theme.colors.primaryText, wordBreak: 'break-all' }}>
                            {myPrincipal?.toString() || '...'}
                        </div>
                        <button
                            onClick={() => {
                                navigator.clipboard.writeText(myPrincipal?.toString() || '');
                                setCopiedPid(true);
                                setTimeout(() => setCopiedPid(false), 1200);
                            }}
                            style={{
                                padding: '8px 14px',
                                borderRadius: '6px',
                                border: 'none',
                                background: theme.colors.accent,
                                color: '#fff',
                                fontWeight: '600',
                                fontSize: '0.8rem',
                                cursor: 'pointer',
                                flexShrink: 0,
                            }}
                        >
                            {copiedPid ? '✓ Copied' : 'Copy'}
                        </button>
                    </div>

                    {/* Account ID (collapsible for CEX) */}
                    <details style={{ cursor: 'pointer' }}>
                        <summary style={{ 
                            color: theme.colors.mutedText, 
                            fontSize: '0.8rem', 
                            padding: '6px 0',
                        }}>
                            Sending from a CEX? Show Account ID
                        </summary>
                        <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '10px',
                            padding: '10px',
                            background: theme.colors.primaryBg || theme.colors.tertiaryBg,
                            borderRadius: '8px',
                            marginTop: '8px',
                        }}>
                            <div style={{ flex: 1, fontFamily: 'monospace', fontSize: '0.75rem', color: theme.colors.mutedText, wordBreak: 'break-all' }}>
                                {myAccountId || '...'}
                            </div>
                            <button
                                onClick={() => {
                                    navigator.clipboard.writeText(myAccountId || '');
                                    setCopiedAccountId(true);
                                    setTimeout(() => setCopiedAccountId(false), 1200);
                                }}
                                style={{
                                    padding: '6px 10px',
                                    borderRadius: '4px',
                                    border: `1px solid ${theme.colors.border}`,
                                    background: 'transparent',
                                    color: theme.colors.mutedText,
                                    fontSize: '0.75rem',
                                    cursor: 'pointer',
                                    flexShrink: 0,
                                }}
                            >
                                {copiedAccountId ? '✓' : 'Copy'}
                            </button>
                        </div>
                    </details>
                </div>

                {/* Creation fee info */}
                {paymentConfig && (
                    <div style={styles.infoBox}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                            <span style={{ color: theme.colors.mutedText, fontSize: '0.9rem' }}>Creation Fee:</span>
                            <span style={{ color: isPremium ? '#FFD700' : theme.colors.primaryText, fontWeight: '600' }}>
                                {formatIcp(effectiveFeeE8s)} ICP
                                {isPremium && discountPercent > 0 && (
                                    <span style={{ 
                                        marginLeft: '8px', 
                                        background: 'linear-gradient(135deg, #FFD700, #FFA500)',
                                        color: '#1a1a2e',
                                        padding: '2px 8px',
                                        borderRadius: '10px',
                                        fontSize: '0.7rem',
                                        fontWeight: '700',
                                    }}>
                                        👑 {discountPercent}% OFF
                                    </span>
                                )}
                            </span>
                        </div>
                        <div style={{ color: theme.colors.mutedText, fontSize: '0.8rem' }}>
                            Your canister will receive ~{formatCycles(Math.max(0, (paymentConfig.targetCyclesAmount || 0) - CANISTER_CREATION_OVERHEAD))} cycles
                        </div>
                    </div>
                )}

                <button
                    onClick={fetchData}
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '8px',
                        width: '100%',
                        padding: '10px',
                        background: 'transparent',
                        border: `1px solid ${theme.colors.border}`,
                        borderRadius: '8px',
                        color: theme.colors.mutedText,
                        fontSize: '0.85rem',
                        cursor: 'pointer',
                    }}
                >
                    🔄 Refresh Balance
                </button>
            </div>

            <div style={styles.buttonRow}>
                {onCancel && (
                    <button style={styles.backButton} onClick={onCancel}>
                        Cancel
                    </button>
                )}
                <button
                    style={styles.continueButton(canProceedStep1)}
                    onClick={() => canProceedStep1 && setCurrentStep(2)}
                    disabled={!canProceedStep1}
                >
                    Continue
                    <FaArrowRight />
                </button>
            </div>
        </>
    );

    // Step 2: Configure Gas
    const renderStep2 = () => (
        <>
            <div style={styles.hero}>
                <h2 style={styles.title}>
                    <FaGasPump style={{ color: theme.colors.accent }} />
                    Configure Gas
                </h2>
                <p style={styles.subtitle}>
                    Optionally add extra ICP for gas to top up your canister
                </p>
            </div>

            <div style={styles.card}>
                {/* Base gas info */}
                <div style={styles.infoBox}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                        <span style={{ color: theme.colors.mutedText }}>Base Gas (included):</span>
                        <span style={{ color: theme.colors.accent, fontWeight: '600' }}>
                            ~{formatCycles(Math.max(0, (paymentConfig?.targetCyclesAmount || 0) - CANISTER_CREATION_OVERHEAD))}
                        </span>
                    </div>
                    <div style={{ color: theme.colors.mutedText, fontSize: '0.8rem' }}>
                        This gas is included with the creation fee and should last for several months of normal use.
                    </div>
                </div>

                {/* Extra gas input */}
                <div style={styles.inputGroup}>
                    <label style={styles.label}>
                        Extra Gas (Optional)
                    </label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <input
                            type="text"
                            inputMode="decimal"
                            placeholder="0"
                            value={extraGasIcp}
                            onChange={(e) => setExtraGasIcp(e.target.value)}
                            style={{ ...styles.input, flex: 1 }}
                        />
                        <span style={{ color: theme.colors.primaryText, fontWeight: '600' }}>ICP</span>
                    </div>
                    {extraGasE8s > 0 && conversionRate && (
                        <div style={{ color: theme.colors.accent, fontSize: '0.85rem', marginTop: '8px' }}>
                            ≈ +{formatCycles(extraGasCycles)} cycles
                        </div>
                    )}
                </div>

                {/* Conversion rate info */}
                {conversionRate && (
                    <div style={{ color: theme.colors.mutedText, fontSize: '0.8rem', marginTop: '10px' }}>
                        Current rate: 1 ICP ≈ {formatCycles(conversionRate.cyclesPerIcp)} cycles
                    </div>
                )}
            </div>

            <div style={styles.buttonRow}>
                <button style={styles.backButton} onClick={() => setCurrentStep(1)}>
                    <FaArrowLeft />
                    Back
                </button>
                <button
                    style={styles.continueButton(true)}
                    onClick={() => setCurrentStep(3)}
                >
                    Continue
                    <FaArrowRight />
                </button>
            </div>
        </>
    );

    // Step 3: Staking Choice
    const renderStep3 = () => (
        <>
            <div style={styles.hero}>
                <h2 style={styles.title}>
                    <FaBrain style={{ color: theme.colors.accent }} />
                    Stake ICP
                </h2>
                <p style={styles.subtitle}>
                    Would you like to stake ICP and create a neuron right away?
                </p>
            </div>

            <div style={styles.card}>
                {/* Option: Stake Now */}
                <div 
                    style={styles.optionCard(stakingChoice === 'now')}
                    onClick={() => setStakingChoice('now')}
                >
                    <div style={styles.optionIcon(stakingChoice === 'now')}>
                        <FaRocket />
                    </div>
                    <div style={{ flex: 1 }}>
                        <div style={{ color: theme.colors.primaryText, fontWeight: '600', marginBottom: '4px' }}>
                            Stake Now
                        </div>
                        <div style={{ color: theme.colors.mutedText, fontSize: '0.85rem' }}>
                            Create a neuron and stake ICP immediately after your manager is created
                        </div>
                    </div>
                    {stakingChoice === 'now' && <FaCheck style={{ color: theme.colors.accent }} />}
                </div>

                {/* Staking configuration (if "now" selected) */}
                {stakingChoice === 'now' && (
                    <div style={{ 
                        marginTop: '1rem', 
                        padding: '1rem', 
                        background: theme.colors.primaryBg || theme.colors.tertiaryBg,
                        borderRadius: '10px',
                        border: `1px solid ${theme.colors.border}`,
                    }}>
                        <div style={styles.inputGroup}>
                            <label style={styles.label}>Amount to Stake (min 1 ICP)</label>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                <input
                                    type="text"
                                    inputMode="decimal"
                                    placeholder="1"
                                    value={stakeAmount}
                                    onChange={(e) => setStakeAmount(e.target.value)}
                                    style={{ ...styles.input, flex: 1 }}
                                />
                                <span style={{ color: theme.colors.primaryText, fontWeight: '600' }}>ICP</span>
                            </div>
                        </div>
                        
                        <div style={styles.inputGroup}>
                            <label style={styles.label}>Dissolve Delay (days)</label>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                <input
                                    type="text"
                                    inputMode="numeric"
                                    placeholder="365"
                                    value={dissolveDelayDays}
                                    onChange={(e) => setDissolveDelayDays(e.target.value)}
                                    style={{ ...styles.input, flex: 1 }}
                                />
                                <button
                                    onClick={() => setDissolveDelayDays(String(MIN_DISSOLVE_DELAY_DAYS))}
                                    style={{
                                        padding: '10px 14px',
                                        borderRadius: '8px',
                                        border: `1px solid ${theme.colors.border}`,
                                        background: theme.colors.primaryBg || theme.colors.tertiaryBg,
                                        color: theme.colors.primaryText,
                                        fontWeight: '600',
                                        fontSize: '0.85rem',
                                        cursor: 'pointer',
                                        flexShrink: 0,
                                    }}
                                >
                                    MIN
                                </button>
                                <button
                                    onClick={() => setDissolveDelayDays(String(MAX_DISSOLVE_DELAY_DAYS))}
                                    style={{
                                        padding: '10px 14px',
                                        borderRadius: '8px',
                                        border: 'none',
                                        background: theme.colors.accent,
                                        color: '#fff',
                                        fontWeight: '600',
                                        fontSize: '0.85rem',
                                        cursor: 'pointer',
                                        flexShrink: 0,
                                    }}
                                >
                                    MAX
                                </button>
                            </div>
                            <div style={{ color: theme.colors.mutedText, fontSize: '0.8rem', marginTop: '6px' }}>
                                Min {MIN_DISSOLVE_DELAY_DAYS} days to vote. Max {MAX_DISSOLVE_DELAY_DAYS} days (8 years) for maximum rewards.
                            </div>
                        </div>
                    </div>
                )}

                {/* Option: Later */}
                <div 
                    style={styles.optionCard(stakingChoice === 'later')}
                    onClick={() => setStakingChoice('later')}
                >
                    <div style={styles.optionIcon(stakingChoice === 'later')}>
                        <FaClock />
                    </div>
                    <div style={{ flex: 1 }}>
                        <div style={{ color: theme.colors.primaryText, fontWeight: '600', marginBottom: '4px' }}>
                            Stake Later
                        </div>
                        <div style={{ color: theme.colors.mutedText, fontSize: '0.85rem' }}>
                            Create only the neuron manager. You can stake ICP anytime later.
                        </div>
                    </div>
                    {stakingChoice === 'later' && <FaCheck style={{ color: theme.colors.accent }} />}
                </div>

                {/* Balance warning */}
                {stakingChoice === 'now' && stakeE8s > 0 && !hasEnoughBalance && (
                    <div style={styles.warningBox}>
                        ⚠️ Insufficient balance. You need {formatIcp(totalRequiredE8s)} ICP but only have {formatIcp(userIcpBalance)} ICP.
                        <br />
                        <Link to="#" onClick={() => setCurrentStep(1)} style={{ color: theme.colors.accent, fontWeight: '600' }}>
                            Go back to fund your wallet
                        </Link>
                    </div>
                )}
            </div>

            <div style={styles.buttonRow}>
                <button style={styles.backButton} onClick={() => setCurrentStep(2)}>
                    <FaArrowLeft />
                    Back
                </button>
                <button
                    style={styles.continueButton(canProceedStep3 && hasEnoughBalance)}
                    onClick={() => canProceedStep3 && hasEnoughBalance && setCurrentStep(4)}
                    disabled={!canProceedStep3 || !hasEnoughBalance}
                >
                    Continue
                    <FaArrowRight />
                </button>
            </div>
        </>
    );

    // Step 4: Confirm & Create
    const renderStep4 = () => (
        <>
            <div style={styles.hero}>
                <h2 style={styles.title}>
                    <FaCheck style={{ color: theme.colors.accent }} />
                    Confirm & Create
                </h2>
                <p style={styles.subtitle}>
                    Review your configuration and create your neuron manager
                </p>
            </div>

            <div style={styles.card}>
                {/* Summary */}
                <div style={{ marginBottom: '1.5rem' }}>
                    <div style={{ 
                        display: 'flex', 
                        justifyContent: 'space-between', 
                        padding: '12px 0',
                        borderBottom: `1px solid ${theme.colors.border}`,
                    }}>
                        <span style={{ color: theme.colors.mutedText }}>Creation Fee</span>
                        <span style={{ color: theme.colors.primaryText, fontWeight: '600' }}>
                            {formatIcp(effectiveFeeE8s)} ICP
                        </span>
                    </div>
                    
                    {extraGasE8s > 0 && (
                        <div style={{ 
                            display: 'flex', 
                            justifyContent: 'space-between', 
                            padding: '12px 0',
                            borderBottom: `1px solid ${theme.colors.border}`,
                        }}>
                            <span style={{ color: theme.colors.mutedText }}>Extra Gas</span>
                            <span style={{ color: theme.colors.primaryText, fontWeight: '600' }}>
                                {formatIcp(extraGasE8s)} ICP (~{formatCycles(extraGasCycles)})
                            </span>
                        </div>
                    )}
                    
                    {stakingChoice === 'now' && stakeE8s > 0 && (
                        <>
                            <div style={{ 
                                display: 'flex', 
                                justifyContent: 'space-between', 
                                padding: '12px 0',
                                borderBottom: `1px solid ${theme.colors.border}`,
                            }}>
                                <span style={{ color: theme.colors.mutedText }}>Initial Stake</span>
                                <span style={{ color: theme.colors.primaryText, fontWeight: '600' }}>
                                    {formatIcp(stakeE8s)} ICP
                                </span>
                            </div>
                            <div style={{ 
                                display: 'flex', 
                                justifyContent: 'space-between', 
                                padding: '12px 0',
                                borderBottom: `1px solid ${theme.colors.border}`,
                            }}>
                                <span style={{ color: theme.colors.mutedText }}>Dissolve Delay</span>
                                <span style={{ color: theme.colors.primaryText, fontWeight: '600' }}>
                                    {dissolveDelayDays} days
                                </span>
                            </div>
                        </>
                    )}
                    
                    {stakingChoice === 'later' && (
                        <div style={{ 
                            display: 'flex', 
                            justifyContent: 'space-between', 
                            padding: '12px 0',
                            borderBottom: `1px solid ${theme.colors.border}`,
                        }}>
                            <span style={{ color: theme.colors.mutedText }}>Initial Stake</span>
                            <span style={{ color: theme.colors.mutedText, fontStyle: 'italic' }}>
                                None (stake later)
                            </span>
                        </div>
                    )}
                    
                    <div style={{ 
                        display: 'flex', 
                        justifyContent: 'space-between', 
                        padding: '12px 0',
                        background: `${theme.colors.accent}10`,
                        borderRadius: '8px',
                        marginTop: '12px',
                        paddingLeft: '12px',
                        paddingRight: '12px',
                    }}>
                        <span style={{ color: theme.colors.primaryText, fontWeight: '600' }}>Total</span>
                        <span style={{ color: theme.colors.accent, fontWeight: '700', fontSize: '1.1rem' }}>
                            {formatIcp(totalRequiredE8s)} ICP
                        </span>
                    </div>
                </div>

                {/* Balance check */}
                {hasEnoughBalance ? (
                    <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px',
                        padding: '12px',
                        background: `${theme.colors.success || '#22c55e'}15`,
                        borderRadius: '8px',
                        color: theme.colors.success || '#22c55e',
                        fontSize: '0.9rem',
                    }}>
                        <FaCheck />
                        You have sufficient balance ({formatIcp(userIcpBalance)} ICP)
                    </div>
                ) : (
                    <div style={styles.errorBox}>
                        ⚠️ Insufficient balance. Need {formatIcp(totalRequiredE8s)} ICP, have {formatIcp(userIcpBalance)} ICP.
                    </div>
                )}
            </div>

            <div style={styles.buttonRow}>
                <button style={styles.backButton} onClick={() => setCurrentStep(3)}>
                    <FaArrowLeft />
                    Back
                </button>
                <button
                    style={styles.continueButton(canCreate)}
                    onClick={handleCreate}
                    disabled={!canCreate}
                >
                    <FaRocket />
                    Create Staking Bot
                </button>
            </div>
        </>
    );

    // Progress Overlay
    const renderProgressOverlay = () => (
        <div style={styles.progressOverlay}>
            <div style={styles.progressCard}>
                <h3 style={{ color: theme.colors.primaryText, marginBottom: '1.5rem', textAlign: 'center' }}>
                    {creationComplete ? '🎉 Success!' : '⏳ Creating Your Staking Bot...'}
                </h3>
                
                {/* Show canister ID as soon as we have it - even during progress */}
                {createdCanisterId && (
                    <div style={{ 
                        marginBottom: '1.5rem',
                        padding: '14px',
                        background: `${theme.colors.success || '#22c55e'}15`,
                        borderRadius: '10px',
                        border: `1px solid ${theme.colors.success || '#22c55e'}40`,
                    }}>
                        <div style={{ 
                            display: 'flex', 
                            alignItems: 'center', 
                            gap: '8px', 
                            marginBottom: '8px',
                            color: theme.colors.success || '#22c55e',
                            fontWeight: '600',
                            fontSize: '0.9rem',
                        }}>
                            <FaCheck />
                            Canister Created!
                        </div>
                        <div style={{ color: theme.colors.mutedText, fontSize: '0.8rem', marginBottom: '6px' }}>
                            Your new canister ID:
                        </div>
                        <div style={{ 
                            fontFamily: 'monospace', 
                            fontSize: '0.9rem', 
                            color: theme.colors.primaryText,
                            background: theme.colors.cardBackground || theme.colors.secondaryBg,
                            padding: '10px 12px',
                            borderRadius: '6px',
                            wordBreak: 'break-all',
                        }}>
                            {createdCanisterId}
                        </div>
                    </div>
                )}
                
                <div style={{ marginBottom: '1.5rem' }}>
                    {creationProgress.map((item, index) => (
                        <div key={index} style={styles.progressItem(item.status)}>
                            {item.status === 'active' ? (
                                <FaSpinner style={styles.spinner} />
                            ) : item.status === 'complete' ? (
                                <FaCheck />
                            ) : item.status === 'error' ? (
                                <span>❌</span>
                            ) : item.status === 'warning' ? (
                                <span>⚠️</span>
                            ) : item.status === 'info' ? (
                                <span>ℹ️</span>
                            ) : (
                                <span>○</span>
                            )}
                            <span>{item.message}</span>
                        </div>
                    ))}
                </div>
                
                {creationError && (
                    <div style={styles.errorBox}>
                        {creationError}
                    </div>
                )}
                
                {creationComplete && (
                    <div style={{ textAlign: 'center' }}>
                        {createdNeuronId && (
                            <div style={{ marginBottom: '1rem' }}>
                                <div style={{ color: theme.colors.mutedText, fontSize: '0.85rem', marginBottom: '6px' }}>
                                    Neuron ID:
                                </div>
                                <div style={{ 
                                    fontFamily: 'monospace', 
                                    fontSize: '0.9rem', 
                                    color: theme.colors.primaryText,
                                    background: theme.colors.primaryBg,
                                    padding: '8px 12px',
                                    borderRadius: '6px',
                                }}>
                                    {createdNeuronId}
                                </div>
                            </div>
                        )}
                        
                        <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', marginTop: '1.5rem', flexWrap: 'wrap' }}>
                            <button
                                style={{
                                    ...styles.backButton,
                                    flex: 'none',
                                    padding: '12px 20px',
                                }}
                                onClick={() => {
                                    if (onCancel) {
                                        onCancel();
                                    }
                                }}
                            >
                                Back to List
                            </button>
                            {createdCanisterId && (
                                <button
                                    style={{
                                        ...styles.continueButton(true),
                                        flex: 'none',
                                        padding: '12px 20px',
                                    }}
                                    onClick={() => navigate(`/icp_neuron_manager/${createdCanisterId}`)}
                                >
                                    Open Manager
                                    <FaArrowRight />
                                </button>
                            )}
                        </div>
                    </div>
                )}
                
                {/* Show close button if there's an error and no canister was created */}
                {creationError && !creationComplete && (
                    <div style={{ textAlign: 'center', marginTop: '1rem' }}>
                        <button
                            style={{
                                ...styles.backButton,
                                flex: 'none',
                                padding: '12px 20px',
                            }}
                            onClick={() => {
                                if (onCancel) {
                                    onCancel();
                                }
                            }}
                        >
                            Close
                        </button>
                    </div>
                )}
            </div>
        </div>
    );

    return (
        <div style={styles.container}>
            {!isCreating && !creationComplete && (
                <>
                    {renderStepProgress()}
                    {currentStep === 1 && renderStep1()}
                    {currentStep === 2 && renderStep2()}
                    {currentStep === 3 && renderStep3()}
                    {currentStep === 4 && renderStep4()}
                </>
            )}
            
            {(isCreating || creationComplete) && renderProgressOverlay()}
        </div>
    );
}

export default CreateIcpNeuronWizard;
