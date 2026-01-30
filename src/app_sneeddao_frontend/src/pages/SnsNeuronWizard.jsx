import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Principal } from '@dfinity/principal';
import { HttpAgent } from '@dfinity/agent';
import { FaCoins, FaArrowRight, FaArrowLeft, FaCheck, FaSpinner, FaChevronDown, FaExternalLinkAlt, FaWallet, FaRocket } from 'react-icons/fa';
import { createActor as createBackendActor, canisterId as backendCanisterId } from 'declarations/app_sneeddao_backend';
import { createActor as createLedgerActor } from 'external/icrc1_ledger';
import { createActor as createSnsGovernanceActor } from 'external/sns_governance';
import Header from '../components/Header';
import { useTheme } from '../contexts/ThemeContext';
import { useSns } from '../contexts/SnsContext';
import { useAuth } from '../AuthContext';
import { fetchAndCacheSnsData, getSnsById, fetchSnsLogo } from '../utils/SnsUtils';
import { formatAmount } from '../utils/SneedexUtils';

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

@keyframes pulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.8; transform: scale(1.05); }
}

@keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
}

.stake-float {
    animation: float 3s ease-in-out infinite;
}

.stake-fade-in {
    animation: fadeInUp 0.5s ease-out forwards;
}

.stake-pulse {
    animation: pulse 2s ease-in-out infinite;
}

.spin {
    animation: spin 1s linear infinite;
}
`;

// Page accent colors - amber/gold theme for staking/coins
const stakePrimary = '#f59e0b';
const stakeSecondary = '#fbbf24';
const stakeAccent = '#fcd34d';

export default function SnsNeuronWizard() {
    const navigate = useNavigate();
  const { theme } = useTheme();
  const { identity, isAuthenticated, login } = useAuth();
  const { selectedSnsRoot, updateSelectedSns, SNEED_SNS_ROOT } = useSns();

    // Step state (1-indexed for display: 1=Select SNS, 2=Configure, 3=Confirm & Stake)
    const [currentStep, setCurrentStep] = useState(1);
    
    // SNS list and loading
  const [snsList, setSnsList] = useState([]);
    const [snsLogos, setSnsLogos] = useState(new Map()); // governanceId -> logo URL
  const [loadingSns, setLoadingSns] = useState(false);
  const [snsLoadError, setSnsLoadError] = useState('');
    const [loadingLogos, setLoadingLogos] = useState(new Set());
    
    // SNS dropdown state
    const [dropdownOpen, setDropdownOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    
    // Token balance state
    const [tokenBalance, setTokenBalance] = useState(null);
    const [tokenDecimals, setTokenDecimals] = useState(8);
    const [tokenSymbol, setTokenSymbol] = useState('');
    const [tokenFee, setTokenFee] = useState(0n);
    const [loadingBalance, setLoadingBalance] = useState(false);
    
    // SNS parameters state
    const [minStakeE8s, setMinStakeE8s] = useState(null);
    const [minDissolveDelaySeconds, setMinDissolveDelaySeconds] = useState(null);
    const [maxDissolveDelaySeconds, setMaxDissolveDelaySeconds] = useState(null);
    const [loadingParams, setLoadingParams] = useState(false);
    
    // Staking configuration
    const [stakeAmount, setStakeAmount] = useState('');
    const [dissolveDelayDays, setDissolveDelayDays] = useState('');
    
    // Staking process state
    const [isStaking, setIsStaking] = useState(false);
    const [stakingProgress, setStakingProgress] = useState('');
    const [stakingError, setStakingError] = useState('');
    const [stakingSuccess, setStakingSuccess] = useState(false);
    const [createdNeuronId, setCreatedNeuronId] = useState(null);
    const [stakingStepIndex, setStakingStepIndex] = useState(0); // For progress overlay
    
    // Staking steps for the progress overlay
    const stakingSteps = [
        { id: 1, label: 'Registering token', icon: '📝' },
        { id: 2, label: 'Finding neuron slot', icon: '🔍' },
        { id: 3, label: 'Transferring tokens', icon: '💸' },
        { id: 4, label: 'Confirming transfer', icon: '⏳' },
        { id: 5, label: 'Claiming neuron', icon: '🧠' },
        { id: 6, label: 'Setting dissolve delay', icon: '⚙️' },
    ];

    // Computed values
  const selectedSns = useMemo(() => {
    if (!selectedSnsRoot) return null;
    return getSnsById(selectedSnsRoot);
  }, [selectedSnsRoot]);

  const selectedLedgerId = selectedSns?.canisters?.ledger || null;
    const selectedGovernanceId = selectedSns?.canisters?.governance || null;
    const isSelectedSnsValid = Boolean(selectedSnsRoot && selectedLedgerId && selectedGovernanceId);

    const selectedSnsLogo = useMemo(() => {
        if (!selectedGovernanceId) return null;
        return snsLogos.get(selectedGovernanceId);
    }, [selectedGovernanceId, snsLogos]);

    const filteredSnsList = useMemo(() => {
        if (!searchQuery.trim()) return snsList;
        const query = searchQuery.toLowerCase();
        return snsList.filter(s => s.name.toLowerCase().includes(query));
    }, [snsList, searchQuery]);

    // Load SNS list
  useEffect(() => {
        const loadSnses = async () => {
      setLoadingSns(true);
      setSnsLoadError('');
      try {
        const data = await fetchAndCacheSnsData(identity);
        setSnsList(data || []);
    } catch (e) {
        console.error('Failed to load SNS list:', e);
        setSnsLoadError('Failed to load SNS list');
    } finally {
        setLoadingSns(false);
      }
    };
        loadSnses();
  }, [identity]);

    // Load SNS logo
    const loadSnsLogo = useCallback(async (governanceId) => {
        if (snsLogos.has(governanceId) || loadingLogos.has(governanceId)) return;
        
        setLoadingLogos(prev => new Set(prev).add(governanceId));
        try {
            const host = process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging' 
                ? 'https://ic0.app' 
                : 'http://localhost:4943';
            const agent = new HttpAgent({ host, identity });
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey().catch(() => {});
            }
            const logo = await fetchSnsLogo(governanceId, agent);
            setSnsLogos(prev => new Map(prev).set(governanceId, logo));
    } catch (e) {
            console.warn('Failed to load SNS logo:', e);
    } finally {
            setLoadingLogos(prev => {
                const newSet = new Set(prev);
                newSet.delete(governanceId);
                return newSet;
            });
        }
    }, [identity, snsLogos, loadingLogos]);

    // Load logos for visible SNSes
  useEffect(() => {
        filteredSnsList.slice(0, 20).forEach(sns => {
            if (sns.canisters?.governance) {
                loadSnsLogo(sns.canisters.governance);
            }
        });
    }, [filteredSnsList, loadSnsLogo]);

    // Load selected SNS logo
    useEffect(() => {
        if (selectedGovernanceId && !snsLogos.has(selectedGovernanceId)) {
            loadSnsLogo(selectedGovernanceId);
        }
    }, [selectedGovernanceId, loadSnsLogo, snsLogos]);

    // Load token balance when SNS is selected
    useEffect(() => {
        const loadTokenInfo = async () => {
            if (!selectedLedgerId || !identity || !isAuthenticated) {
                setTokenBalance(null);
                return;
            }
            
            setLoadingBalance(true);
            try {
                const ledgerActor = createLedgerActor(selectedLedgerId, {
                    agentOptions: { identity }
                });
                
                const [balance, decimals, symbol, fee] = await Promise.all([
                    ledgerActor.icrc1_balance_of({ owner: identity.getPrincipal(), subaccount: [] }),
                    ledgerActor.icrc1_decimals(),
                    ledgerActor.icrc1_symbol(),
                    ledgerActor.icrc1_fee()
                ]);
                
                setTokenBalance(BigInt(balance));
                setTokenDecimals(Number(decimals));
                setTokenSymbol(symbol);
                setTokenFee(BigInt(fee));
      } catch (e) {
                console.error('Failed to load token info:', e);
                setTokenBalance(0n);
      } finally {
                setLoadingBalance(false);
      }
    };

        loadTokenInfo();
    }, [selectedLedgerId, identity, isAuthenticated]);

    // Load SNS parameters (min stake, dissolve delay range) when SNS is selected
  useEffect(() => {
        const loadSnsParams = async () => {
            if (!selectedGovernanceId || !identity || !isAuthenticated) {
                setMinStakeE8s(null);
                setMinDissolveDelaySeconds(null);
                setMaxDissolveDelaySeconds(null);
                return;
            }
            
            setLoadingParams(true);
            try {
                const governanceActor = createSnsGovernanceActor(selectedGovernanceId, {
                    agentOptions: { identity }
                });
                
                const params = await governanceActor.get_nervous_system_parameters(null);
                
                if (params) {
                    // Min stake
                    const minStake = params.neuron_minimum_stake_e8s?.[0];
                    setMinStakeE8s(minStake !== undefined ? BigInt(minStake) : null);
                    
                    // Min dissolve delay to vote
                    const minDelay = params.neuron_minimum_dissolve_delay_to_vote_seconds?.[0];
                    setMinDissolveDelaySeconds(minDelay !== undefined ? Number(minDelay) : null);
                    
                    // Max dissolve delay
                    const maxDelay = params.max_dissolve_delay_seconds?.[0];
                    setMaxDissolveDelaySeconds(maxDelay !== undefined ? Number(maxDelay) : null);
                }
            } catch (e) {
                console.error('Failed to load SNS parameters:', e);
            } finally {
                setLoadingParams(false);
            }
        };
        
        loadSnsParams();
    }, [selectedGovernanceId, identity, isAuthenticated]);

    // Track if we need to auto-fill (when SNS changes)
    const [needsAutoFill, setNeedsAutoFill] = useState(true);
    
    // Reset and set defaults when SNS changes
  useEffect(() => {
        setStakeAmount('');
        setDissolveDelayDays('');
        setStakingError('');
        setStakingSuccess(false);
        setCreatedNeuronId(null);
        // Clear params so they get re-fetched
        setMinStakeE8s(null);
        setMinDissolveDelaySeconds(null);
        setMaxDissolveDelaySeconds(null);
        // Mark that we need to auto-fill when params load
        setNeedsAutoFill(true);
  }, [selectedSnsRoot]);

    // Auto-fill minimum stake and dissolve delay when params are loaded
    useEffect(() => {
        if (!needsAutoFill) return;
        if (minStakeE8s === null || minDissolveDelaySeconds === null) return;
        if (tokenDecimals === null) return;
        
        // Auto-fill minimum stake amount
        const minStakeFormatted = formatAmount(minStakeE8s, tokenDecimals);
        setStakeAmount(minStakeFormatted);
        
        // Auto-fill minimum dissolve delay
        const minDays = Math.ceil(minDissolveDelaySeconds / (24 * 60 * 60));
        setDissolveDelayDays(String(minDays));
        
        // Mark auto-fill as done
        setNeedsAutoFill(false);
    }, [needsAutoFill, minStakeE8s, minDissolveDelaySeconds, tokenDecimals]);

    // Register token silently
    const registerTokenSilently = async () => {
        if (!identity || !selectedLedgerId) return;
        try {
            const backendActor = createBackendActor(backendCanisterId, { agentOptions: { identity } });
            const ledgers = await backendActor.get_ledger_canister_ids();
            const isRegistered = ledgers.some(p => p?.toString?.() === selectedLedgerId.toString());
            if (!isRegistered) {
                await backendActor.register_ledger_canister_id(Principal.fromText(selectedLedgerId.toString()));
            }
        } catch (e) {
            console.warn('Token registration check failed:', e);
        }
    };

    // Find unused nonce
    const findUnusedNonce = async (governanceActor, principal) => {
        for (let nonce = 0; nonce < 100; nonce++) {
            const subaccount = await computeNeuronSubaccount(principal, nonce);
            const result = await governanceActor.get_neuron({
                neuron_id: [{ id: Array.from(subaccount) }]
            });
            
            if (result && result.result) {
                if (result.result.length === 0) {
                    return { nonce, subaccount };
                }
                const innerResult = result.result[0];
                if ('Error' in innerResult) {
                    return { nonce, subaccount };
                }
            }
        }
        throw new Error('Could not find unused nonce (tried 0-99)');
    };

    // Compute neuron subaccount
    const computeNeuronSubaccount = async (principal, nonce) => {
        const nonceBytes = new Uint8Array(8);
        new DataView(nonceBytes.buffer).setBigUint64(0, BigInt(nonce), false);
        
        const chunks = [
            Uint8Array.from([0x0c]),
            new TextEncoder().encode("neuron-stake"),
            principal.toUint8Array(),
            nonceBytes,
        ];
        
        const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
        const data = new Uint8Array(totalLength);
        let offset = 0;
        for (const chunk of chunks) {
            data.set(chunk, offset);
            offset += chunk.length;
        }
        
        const digest = await crypto.subtle.digest('SHA-256', data);
        return new Uint8Array(digest);
    };

    // Execute staking
    const executeStake = async () => {
        if (!identity || !selectedLedgerId || !selectedGovernanceId) return;
        
        setIsStaking(true);
        setStakingError('');
        setStakingStepIndex(1);
        setStakingProgress('Registering token...');
        
        try {
            const amountFloat = parseFloat(stakeAmount);
            const amountE8s = BigInt(Math.floor(amountFloat * (10 ** tokenDecimals)));
            const dissolveDelaySeconds = dissolveDelayDays ? Number(dissolveDelayDays) * 24 * 60 * 60 : 0;
            
            // Step 1: Register token silently
            await registerTokenSilently();
            
            // Step 2: Find unused nonce
            setStakingStepIndex(2);
            setStakingProgress('Finding available neuron slot...');
            const governanceActor = createSnsGovernanceActor(selectedGovernanceId, {
                agentOptions: { identity }
            });
            
            const principal = identity.getPrincipal();
            const { nonce, subaccount } = await findUnusedNonce(governanceActor, principal);
            
            // Step 3: Transfer tokens
            setStakingStepIndex(3);
            setStakingProgress('Transferring tokens to neuron...');
            const ledgerActor = createLedgerActor(selectedLedgerId, {
                agentOptions: { identity }
            });
            
            const subaccount32 = new Uint8Array(32);
            subaccount32.set(subaccount, 0);
            
            const memoBytes = (() => {
                const buffer = new ArrayBuffer(8);
                new DataView(buffer).setBigUint64(0, BigInt(nonce), false);
                return Array.from(new Uint8Array(buffer));
            })();
            
            const transferResult = await ledgerActor.icrc1_transfer({
                to: {
                    owner: Principal.fromText(selectedGovernanceId),
                    subaccount: [Array.from(subaccount32)]
                },
                amount: amountE8s,
                fee: [],
                memo: [memoBytes],
                from_subaccount: [],
                created_at_time: []
            });
            
            if ('Err' in transferResult) {
                const error = transferResult.Err;
                let errorMsg = 'Transfer failed';
                if (error.InsufficientFunds) {
                    errorMsg = `Insufficient funds. Available: ${formatAmount(error.InsufficientFunds.balance, tokenDecimals)} ${tokenSymbol}`;
                } else if (error.BadFee) {
                    errorMsg = `Bad fee. Expected: ${formatAmount(error.BadFee.expected_fee, tokenDecimals)} ${tokenSymbol}`;
                } else if (error.GenericError) {
                    errorMsg = error.GenericError.message;
                }
                throw new Error(errorMsg);
            }
            
            // Step 4: Wait for transfer
            setStakingStepIndex(4);
            setStakingProgress('Waiting for transfer confirmation...');
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            // Step 5: Claim neuron
            setStakingStepIndex(5);
            setStakingProgress('Claiming neuron stake...');
            const claimSubaccount = new Uint8Array(32);
            claimSubaccount.set(subaccount, 0);
            
            const claimResult = await governanceActor.manage_neuron({
                subaccount: Array.from(claimSubaccount),
                command: [{
                    ClaimOrRefresh: {
                        by: [{ MemoAndController: { 
                            memo: nonce,
                            controller: [principal]
                        }}]
                    }
                }]
            });
            
            if (claimResult?.command?.[0]?.Error) {
                throw new Error(`Failed to create neuron: ${claimResult.command[0].Error.error_message}`);
            }
            
            // Step 6: Set dissolve delay if specified
            if (dissolveDelaySeconds > 0) {
                setStakingStepIndex(6);
                setStakingProgress('Setting dissolve delay...');
                await governanceActor.manage_neuron({
                    subaccount: Array.from(claimSubaccount),
                    command: [{
                        Configure: { operation: [{ 
                            IncreaseDissolveDelay: { 
                                additional_dissolve_delay_seconds: dissolveDelaySeconds 
                            } 
                        }] }
                    }]
                });
            }
            
            // Success!
            const neuronIdHex = Array.from(subaccount).map(b => b.toString(16).padStart(2, '0')).join('');
            setCreatedNeuronId(neuronIdHex);
            setStakingSuccess(true);
            setStakingProgress('');
            setStakingStepIndex(0);
        } catch (error) {
            console.error('Staking error:', error);
            setStakingError(error.message || 'Failed to stake neuron');
            setStakingProgress('');
            setStakingStepIndex(0);
        } finally {
            setIsStaking(false);
        }
    };

    // Validation
    const canProceedStep1 = isSelectedSnsValid;
    
    // Detailed validation with reasons
    const step2Validation = useMemo(() => {
        const errors = [];
        
        // Must have stake amount
        if (!stakeAmount) {
            errors.push('Enter stake amount');
            return { valid: false, errors };
        }
        const amount = parseFloat(stakeAmount);
        if (isNaN(amount) || amount <= 0) {
            errors.push('Stake amount must be greater than 0');
            return { valid: false, errors };
        }
        
        // Calculate amount in e8s
        const amountE8s = BigInt(Math.floor(amount * (10 ** tokenDecimals)));
        
        // Must have sufficient balance
        if (tokenBalance === null) {
            errors.push('Loading balance...');
            return { valid: false, errors };
        }
        if (amountE8s > tokenBalance) {
            errors.push('Insufficient balance');
            return { valid: false, errors };
        }
        
        // Check minimum stake requirement (if we know it)
        if (minStakeE8s !== null && amountE8s < minStakeE8s) {
            errors.push(`Below minimum stake of ${formatAmount(minStakeE8s, tokenDecimals)} ${tokenSymbol}`);
            return { valid: false, errors };
        }
        
        // Must have dissolve delay set
        if (!dissolveDelayDays) {
            errors.push('Enter dissolve delay');
            return { valid: false, errors };
        }
        const delayDays = Number(dissolveDelayDays);
        if (isNaN(delayDays) || delayDays < 0) {
            errors.push('Dissolve delay must be a positive number');
            return { valid: false, errors };
        }
        
        // Check dissolve delay bounds
        const delaySeconds = delayDays * 24 * 60 * 60;
        if (minDissolveDelaySeconds !== null && delaySeconds < minDissolveDelaySeconds) {
            const minDays = Math.ceil(minDissolveDelaySeconds / (24 * 60 * 60));
            errors.push(`Dissolve delay below minimum of ${minDays} days`);
            return { valid: false, errors };
        }
        if (maxDissolveDelaySeconds !== null && delaySeconds > maxDissolveDelaySeconds) {
            const maxDays = Math.floor(maxDissolveDelaySeconds / (24 * 60 * 60));
            errors.push(`Dissolve delay above maximum of ${maxDays} days`);
            return { valid: false, errors };
        }
        
        return { valid: true, errors: [] };
    }, [stakeAmount, tokenDecimals, tokenBalance, minStakeE8s, dissolveDelayDays, minDissolveDelaySeconds, maxDissolveDelaySeconds, tokenSymbol]);
    
    const canProceedStep2 = step2Validation.valid;

    const handleSetMax = () => {
        if (tokenBalance === null) return;
        if (tokenBalance <= 0n) {
            setStakeAmount('0');
        } else {
            setStakeAmount(formatAmount(tokenBalance, tokenDecimals));
        }
    };

    const handleSnsSelect = (sns) => {
        updateSelectedSns(sns.rootCanisterId);
        setDropdownOpen(false);
        setSearchQuery('');
    };

    // Styles with new design
    const styles = {
        container: {
            maxWidth: '800px',
            margin: '0 auto',
            padding: '1.5rem 1rem',
            color: theme.colors.primaryText,
        },
        hero: {
            textAlign: 'center',
            marginBottom: '1.5rem',
        },
        title: {
            fontSize: '1.75rem',
            marginTop: 0,
            marginBottom: '0.5rem',
            color: theme.colors.primaryText,
            fontWeight: '700',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '12px',
            lineHeight: 1,
        },
        subtitle: {
            fontSize: '1rem',
            color: theme.colors.secondaryText,
            marginBottom: '0.5rem',
            lineHeight: '1.6',
        },
        stepProgress: {
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'center',
            gap: '0',
            marginBottom: '1.5rem',
            padding: '1.25rem',
            background: theme.colors.cardGradient,
            borderRadius: '16px',
            border: `1px solid ${theme.colors.border}`,
            boxShadow: theme.colors.cardShadow,
        },
        stepCircle: (stepNum, isActive, isCompleted) => ({
            width: '44px',
            height: '44px',
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: '600',
            fontSize: '1rem',
            background: isCompleted 
                ? `linear-gradient(135deg, ${theme.colors.success}, ${theme.colors.success}dd)` 
                : isActive 
                    ? `linear-gradient(135deg, ${stakePrimary}, ${stakeSecondary})` 
                    : theme.colors.tertiaryBg,
            color: isCompleted || isActive ? '#fff' : theme.colors.mutedText,
            border: 'none',
            cursor: isCompleted ? 'pointer' : 'default',
            transition: 'all 0.3s ease',
            boxShadow: isActive ? `0 4px 16px ${stakePrimary}50` : isCompleted ? `0 4px 12px ${theme.colors.success}40` : 'none',
        }),
        stepLine: (isCompleted) => ({
            width: '50px',
            height: '3px',
            background: isCompleted 
                ? `linear-gradient(90deg, ${theme.colors.success}, ${theme.colors.success}dd)` 
                : theme.colors.border,
            transition: 'all 0.3s ease',
            marginTop: '20px',
            borderRadius: '2px',
        }),
        stepLabel: (isActive) => ({
            fontSize: '0.7rem',
            fontWeight: isActive ? '600' : '500',
            color: isActive ? theme.colors.primaryText : theme.colors.mutedText,
            marginTop: '8px',
            textAlign: 'center',
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
        }),
        configCard: {
            background: theme.colors.cardGradient,
            border: `1px solid ${theme.colors.border}`,
            borderRadius: '16px',
            padding: '1.5rem',
            marginBottom: '1.25rem',
            boxShadow: theme.colors.cardShadow,
        },
        dropdownContainer: {
            position: 'relative',
            marginBottom: '1.25rem',
            maxWidth: '100%',
        },
        dropdownButton: (isOpen) => ({
            width: '100%',
            padding: '14px 16px',
            background: theme.colors.primaryBg,
            border: `2px solid ${isOpen ? stakePrimary : theme.colors.border}`,
            borderRadius: '12px',
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            cursor: 'pointer',
            transition: 'all 0.2s ease',
            boxSizing: 'border-box',
        }),
        dropdownList: {
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            marginTop: '8px',
            background: theme.colors.cardGradient || theme.colors.secondaryBg,
            border: `1px solid ${theme.colors.border}`,
            borderRadius: '14px',
            boxShadow: '0 12px 40px rgba(0,0,0,0.4)',
            zIndex: 100,
            maxHeight: '320px',
            overflowY: 'auto',
            boxSizing: 'border-box',
        },
        dropdownSearch: {
            width: '100%',
            padding: '14px 16px',
            background: 'transparent',
            border: 'none',
            borderBottom: `1px solid ${theme.colors.border}`,
            color: theme.colors.primaryText,
            fontSize: '0.95rem',
            outline: 'none',
            boxSizing: 'border-box',
        },
        dropdownItem: (isSelected) => ({
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            padding: '12px 16px',
            cursor: 'pointer',
            background: isSelected ? `${stakePrimary}15` : 'transparent',
            transition: 'background 0.15s ease',
        }),
        snsLogo: {
            width: '36px',
            height: '36px',
            borderRadius: '50%',
            objectFit: 'cover',
            background: theme.colors.tertiaryBg,
            flexShrink: 0,
            border: `2px solid ${theme.colors.border}`,
        },
        inputGroup: {
            marginBottom: '1.25rem',
        },
        label: {
            display: 'block',
            color: theme.colors.primaryText,
            marginBottom: '8px',
            fontWeight: '600',
            fontSize: '0.9rem',
        },
        inputRow: {
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            flexWrap: 'wrap',
        },
        input: {
            flex: 1,
            minWidth: '150px',
            padding: '12px 14px',
            background: theme.colors.primaryBg,
            border: `1px solid ${theme.colors.border}`,
            borderRadius: '10px',
            color: theme.colors.primaryText,
            fontSize: '1rem',
            outline: 'none',
        },
        maxButton: {
            background: `linear-gradient(135deg, ${stakePrimary}, ${stakeSecondary})`,
            color: '#fff',
            border: 'none',
            borderRadius: '10px',
            padding: '12px 16px',
            cursor: 'pointer',
            fontWeight: '600',
            fontSize: '0.85rem',
            boxShadow: `0 4px 12px ${stakePrimary}30`,
        },
        buttonRow: {
            display: 'flex',
            gap: '12px',
            marginTop: '1.5rem',
            flexWrap: 'wrap',
        },
        backButton: {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            flex: 1,
            minWidth: '120px',
            padding: '14px 20px',
            background: theme.colors.cardGradient || theme.colors.secondaryBg,
            border: `1px solid ${theme.colors.border}`,
            borderRadius: '12px',
            color: theme.colors.primaryText,
            fontSize: '0.95rem',
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
            minWidth: '180px',
            padding: '14px 24px',
            background: isEnabled 
                ? `linear-gradient(135deg, ${stakePrimary}, ${stakeSecondary})` 
                : theme.colors.tertiaryBg,
            border: 'none',
            borderRadius: '12px',
            color: isEnabled ? '#fff' : theme.colors.mutedText,
            fontSize: '0.95rem',
            fontWeight: '600',
            cursor: isEnabled ? 'pointer' : 'not-allowed',
            transition: 'all 0.2s ease',
            boxShadow: isEnabled ? `0 4px 20px ${stakePrimary}40` : 'none',
        }),
        errorBox: {
            color: theme.colors.error,
            padding: '14px',
            background: `${theme.colors.error}15`,
            border: `1px solid ${theme.colors.error}30`,
            borderRadius: '12px',
            marginBottom: '1rem',
            fontSize: '0.9rem',
        },
        successCard: {
            textAlign: 'center',
            padding: '2.5rem 1.5rem',
            background: `linear-gradient(135deg, ${theme.colors.success}10 0%, ${theme.colors.cardGradient || theme.colors.cardBackground} 100%)`,
            border: `2px solid ${theme.colors.success}40`,
            borderRadius: '20px',
            boxShadow: `0 8px 32px ${theme.colors.success}20`,
        },
        successIcon: {
            width: '80px',
            height: '80px',
            borderRadius: '50%',
            background: `linear-gradient(135deg, ${theme.colors.success}30, ${theme.colors.success}10)`,
            border: `2px solid ${theme.colors.success}40`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 1.5rem',
        },
        spinner: {
            animation: 'spin 1s linear infinite',
        },
        loginPrompt: {
            textAlign: 'center',
            padding: '2.5rem 1.5rem',
            background: theme.colors.cardGradient,
            border: `1px solid ${theme.colors.border}`,
            borderRadius: '20px',
            boxShadow: theme.colors.cardShadow,
        },
        summaryRow: {
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '14px 0',
            borderBottom: `1px solid ${theme.colors.border}`,
        },
        summaryLabel: {
            color: theme.colors.secondaryText,
            fontSize: '0.9rem',
        },
        summaryValue: {
            color: theme.colors.primaryText,
            fontWeight: '600',
            fontSize: '1rem',
        },
    };

    if (!isAuthenticated) {
        return (
            <div className='page-container' style={{ background: theme.colors.primaryGradient, minHeight: '100vh' }}>
                <style>{customStyles}</style>
                <Header />
                <main style={styles.container}>
                    <div className="stake-fade-in" style={styles.loginPrompt}>
                        <div className="stake-float" style={{
                            width: '72px',
                            height: '72px',
                            borderRadius: '18px',
                            background: `linear-gradient(135deg, ${stakePrimary}, ${stakeSecondary})`,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            margin: '0 auto 1.5rem',
                            boxShadow: `0 8px 32px ${stakePrimary}50`,
                            fontSize: '2rem'
                        }}>
                            🪙
                        </div>
                        <h2 style={{ color: theme.colors.primaryText, marginBottom: '0.75rem', fontSize: '1.5rem', fontWeight: '700' }}>
                            Liquid SNS Staking Wizard
                        </h2>
                        <p style={{ fontSize: '1rem', color: theme.colors.secondaryText, marginBottom: '1.5rem', lineHeight: '1.6' }}>
                            Please log in to stake your SNS tokens
                        </p>
                        <button
                            onClick={login}
                            style={{
                                ...styles.continueButton(true),
                                flex: 'none',
                                padding: '14px 32px',
                            }}
                        >
                            <FaWallet /> Connect Wallet
                        </button>
                    </div>
                </main>
            </div>
        );
    }

    const stepLabels = ['Select SNS', 'Configure', 'Stake'];

    const renderStepProgress = () => (
        <div className="stake-fade-in" style={styles.stepProgress}>
            {[1, 2, 3].map((stepNum, index) => (
                <React.Fragment key={stepNum}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                        <div 
                            style={styles.stepCircle(stepNum, stepNum === currentStep, stepNum < currentStep)}
                            onClick={() => stepNum < currentStep && !isStaking && setCurrentStep(stepNum)}
                        >
                            {stepNum < currentStep ? <FaCheck size={16} /> : stepNum}
                        </div>
                        <div style={styles.stepLabel(stepNum === currentStep)}>
                            {stepLabels[stepNum - 1]}
                        </div>
                    </div>
                    {index < 2 && <div style={styles.stepLine(stepNum < currentStep)} />}
                </React.Fragment>
            ))}
        </div>
    );

    // Step 1: Select SNS
    const renderStep1 = () => (
        <>
            <div className="stake-fade-in" style={styles.hero}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '14px', marginBottom: '0.75rem' }}>
                    {selectedSnsLogo ? (
                        <img src={selectedSnsLogo} alt={selectedSns?.name} style={{ 
                            width: '48px', 
                            height: '48px', 
                            borderRadius: '14px', 
                            flexShrink: 0, 
                            border: `2px solid ${stakePrimary}40`,
                            boxShadow: `0 4px 16px ${stakePrimary}30`
                        }} />
                    ) : (
                        <div className="stake-float" style={{
                            width: '48px',
                            height: '48px',
                            borderRadius: '14px',
                            background: `linear-gradient(135deg, ${stakePrimary}, ${stakeSecondary})`,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            boxShadow: `0 4px 16px ${stakePrimary}40`,
                            fontSize: '1.5rem'
                        }}>
                            🪙
                        </div>
                    )}
                    <h1 style={{ ...styles.title, margin: 0, justifyContent: 'flex-start' }}>
                        Liquid SNS Staking
                    </h1>
                </div>
                <p style={styles.subtitle}>
                    Stake tokens in any SNS DAO to earn rewards and participate in governance.
                    <br />
                    <span style={{ fontSize: '0.9rem', color: stakePrimary }}>
                        ✨ Neurons created here are <strong>transferrable</strong> and <strong>tradable on Sneedex</strong>.
                    </span>
                </p>
            </div>

            <div className="stake-fade-in" style={styles.configCard}>
                <div style={styles.inputGroup}>
                    <label style={styles.label}>Select an SNS to stake in:</label>
                    
                    {snsLoadError && (
                        <div style={styles.errorBox}>{snsLoadError}</div>
                    )}
                    
                    <div style={styles.dropdownContainer}>
                        <div 
                            style={styles.dropdownButton(dropdownOpen)}
                            onClick={() => setDropdownOpen(!dropdownOpen)}
                        >
                            {selectedSns ? (
                                <>
                                    {selectedSnsLogo ? (
                                        <img 
                                            src={selectedSnsLogo} 
                                            alt={selectedSns.name} 
                                            style={styles.snsLogo}
                                            onError={(e) => { e.target.style.display = 'none'; }}
                                        />
                                    ) : (
                                        <div style={{ ...styles.snsLogo, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                            <FaCoins style={{ color: theme.colors.mutedText }} />
              </div>
            )}
                                    <div style={{ flex: 1, textAlign: 'left' }}>
                                        <div style={{ color: theme.colors.primaryText, fontWeight: '600' }}>
                                            {selectedSns.name}
                                        </div>
                                        <div style={{ color: theme.colors.mutedText, fontSize: '0.8rem' }}>
                                            {selectedSns.rootCanisterId.slice(0, 10)}...
                                        </div>
                                    </div>
                                </>
                            ) : (
                                <div style={{ flex: 1, textAlign: 'left', color: theme.colors.mutedText }}>
                                    {loadingSns ? 'Loading SNSes...' : 'Select an SNS...'}
          </div>
        )}
                            <FaChevronDown style={{ 
                                color: theme.colors.mutedText, 
                                transform: dropdownOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                                transition: 'transform 0.2s ease'
                            }} />
            </div>

                        {dropdownOpen && (
                            <div style={styles.dropdownList}>
                                <input
                                    type="text"
                                    placeholder="Search SNSes..."
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    style={styles.dropdownSearch}
                                    autoFocus
                                    onClick={(e) => e.stopPropagation()}
                                />
                                {filteredSnsList.length === 0 ? (
                                    <div style={{ padding: '20px', textAlign: 'center', color: theme.colors.mutedText }}>
                                        {loadingSns ? 'Loading...' : 'No SNSes found'}
              </div>
            ) : (
                                    filteredSnsList.map((sns) => {
                                        const logo = snsLogos.get(sns.canisters?.governance);
                                        const isSelected = selectedSnsRoot === sns.rootCanisterId;
                                        return (
                                            <div
                                                key={sns.rootCanisterId}
                                                style={styles.dropdownItem(isSelected)}
                                                onClick={() => handleSnsSelect(sns)}
                                                onMouseEnter={(e) => e.currentTarget.style.background = `${theme.colors.accent}10`}
                                                onMouseLeave={(e) => e.currentTarget.style.background = isSelected ? `${theme.colors.accent}15` : 'transparent'}
                                            >
                                                {logo ? (
                                                    <img 
                                                        src={logo} 
                                                        alt={sns.name} 
                                                        style={styles.snsLogo}
                                                        onError={(e) => { e.target.style.display = 'none'; }}
                                                    />
                                                ) : (
                                                    <div style={{ ...styles.snsLogo, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                        <FaCoins style={{ color: theme.colors.mutedText, fontSize: '14px' }} />
                                                    </div>
                                                )}
                                                <div style={{ flex: 1 }}>
                                                    <div style={{ color: theme.colors.primaryText, fontWeight: '500' }}>
                                                        {sns.name}
            </div>
                                                </div>
                                                {isSelected && <FaCheck style={{ color: theme.colors.accent }} />}
                                            </div>
                                        );
                                    })
                                )}
                            </div>
                        )}
          </div>
                </div>

                {selectedSns && (
                    <div style={{
                        background: theme.colors.secondaryBg,
                        borderRadius: '10px',
                        padding: '14px',
                        marginTop: '1rem'
                    }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ color: theme.colors.mutedText, fontSize: '0.9rem' }}>Your Balance:</span>
                            <span style={{ color: theme.colors.primaryText, fontWeight: '600' }}>
                                {loadingBalance ? (
                                    <FaSpinner style={styles.spinner} />
                                ) : tokenBalance !== null ? (
                                    `${formatAmount(tokenBalance, tokenDecimals)} ${tokenSymbol}`
                                ) : (
                                    '—'
                                )}
                            </span>
                        </div>
                    </div>
                )}
            </div>

            <div style={styles.buttonRow}>
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

    // Helper functions for dissolve delay
    const minDelayDays = minDissolveDelaySeconds !== null ? Math.ceil(minDissolveDelaySeconds / (24 * 60 * 60)) : null;
    const maxDelayDays = maxDissolveDelaySeconds !== null ? Math.floor(maxDissolveDelaySeconds / (24 * 60 * 60)) : null;
    
    const handleSetMinDelay = () => {
        if (minDelayDays !== null) {
            setDissolveDelayDays(String(minDelayDays));
        }
    };
    
    const handleSetMaxDelay = () => {
        if (maxDelayDays !== null) {
            setDissolveDelayDays(String(maxDelayDays));
        }
    };
    
    const handleSetMinStake = () => {
        if (minStakeE8s !== null) {
            setStakeAmount(formatAmount(minStakeE8s, tokenDecimals));
        }
    };

    // Step 2: Configure Stake
    const renderStep2 = () => (
        <>
            <div className="stake-fade-in" style={styles.hero}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '14px', marginBottom: '0.75rem' }}>
                    {selectedSnsLogo && (
                        <img src={selectedSnsLogo} alt={selectedSns?.name} style={{ 
                            width: '48px', 
                            height: '48px', 
                            borderRadius: '14px', 
                            flexShrink: 0, 
                            border: `2px solid ${stakePrimary}40`,
                            boxShadow: `0 4px 16px ${stakePrimary}30`
                        }} />
                    )}
                    <h1 style={{ ...styles.title, margin: 0, justifyContent: 'flex-start' }}>
                        Configure Stake
                    </h1>
                </div>
                <p style={styles.subtitle}>
                    Set your stake amount and dissolve delay for <strong style={{ color: stakePrimary }}>{selectedSns?.name}</strong>
                </p>
            </div>

            <div className="stake-fade-in" style={styles.configCard}>
                {/* Balance display */}
                <div style={{
                    background: theme.colors.secondaryBg,
                    borderRadius: '10px',
                    padding: '14px',
                    marginBottom: '1.5rem',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                }}>
                    <span style={{ color: theme.colors.mutedText, fontSize: '0.95rem' }}>Your {tokenSymbol} Balance:</span>
                    <span style={{ color: theme.colors.primaryText, fontWeight: '600', fontSize: '1.1rem' }}>
                        {loadingBalance ? (
                            <FaSpinner style={styles.spinner} size={14} />
                        ) : tokenBalance !== null ? (
                            `${formatAmount(tokenBalance, tokenDecimals)} ${tokenSymbol}`
                        ) : (
                            '—'
                        )}
                    </span>
                </div>

                {/* SNS Parameters Info */}
                {(loadingParams || minStakeE8s !== null || minDissolveDelaySeconds !== null) && (
                    <div style={{
                        background: `${theme.colors.accent}10`,
                        borderRadius: '10px',
                        padding: '14px',
                        marginBottom: '1.5rem',
                        border: `1px solid ${theme.colors.accent}20`,
                    }}>
                        <div style={{ fontSize: '0.85rem', color: theme.colors.mutedText, marginBottom: '8px', fontWeight: '500' }}>
                            {selectedSns?.name} Requirements:
                        </div>
                        {loadingParams ? (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: theme.colors.mutedText }}>
                                <FaSpinner style={styles.spinner} size={12} />
                                Loading parameters...
                            </div>
                        ) : (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', fontSize: '0.9rem' }}>
                                {minStakeE8s !== null && (
                                    <div>
                                        <span style={{ color: theme.colors.mutedText }}>Min stake: </span>
                                        <span style={{ color: theme.colors.primaryText, fontWeight: '600' }}>
                                            {formatAmount(minStakeE8s, tokenDecimals)} {tokenSymbol}
                                        </span>
                                    </div>
                                )}
                                {minDissolveDelaySeconds !== null && (
                                    <div>
                                        <span style={{ color: theme.colors.mutedText }}>Min dissolve: </span>
                                        <span style={{ color: theme.colors.primaryText, fontWeight: '600' }}>
                                            {minDelayDays} days
                                        </span>
          </div>
        )}
                                {maxDissolveDelaySeconds !== null && (
                                    <div>
                                        <span style={{ color: theme.colors.mutedText }}>Max dissolve: </span>
                                        <span style={{ color: theme.colors.primaryText, fontWeight: '600' }}>
                                            {maxDelayDays} days
                                        </span>
            </div>
                                )}
                            </div>
                        )}
                    </div>
                )}

                <div style={styles.inputGroup}>
                    <label style={styles.label}>Stake Amount ({tokenSymbol}):</label>
                    <div style={styles.inputRow}>
                        <input
                            type="number"
                            placeholder={minStakeE8s !== null ? `Min: ${formatAmount(minStakeE8s, tokenDecimals)}` : 'Enter amount'}
                            value={stakeAmount}
                            onChange={(e) => setStakeAmount(e.target.value)}
                            style={styles.input}
                        />
                        {minStakeE8s !== null && (
                            <button 
                                onClick={handleSetMinStake} 
                                style={{ ...styles.maxButton, background: theme.colors.secondaryBg, color: theme.colors.primaryText, border: `1px solid ${theme.colors.border}` }}
                            >
                                MIN
                            </button>
                        )}
                        <button onClick={handleSetMax} style={styles.maxButton}>
                            MAX
                        </button>
                    </div>
                    <div style={{ marginTop: '8px', fontSize: '0.85rem', color: theme.colors.mutedText }}>
                        Balance: {loadingBalance ? '...' : `${formatAmount(tokenBalance || 0n, tokenDecimals)} ${tokenSymbol}`}
            </div>
                    {stakeAmount && minStakeE8s !== null && (
                        (() => {
                            const amountE8s = BigInt(Math.floor(parseFloat(stakeAmount) * (10 ** tokenDecimals)));
                            if (amountE8s < minStakeE8s) {
                                return (
                                    <div style={{ marginTop: '6px', fontSize: '0.85rem', color: theme.colors.error }}>
                                        ⚠️ Below minimum stake of {formatAmount(minStakeE8s, tokenDecimals)} {tokenSymbol}
              </div>
                                );
                            }
                            return null;
                        })()
                    )}
            </div>

                <div style={styles.inputGroup}>
                    <label style={styles.label}>Dissolve Delay (days):</label>
                    <div style={styles.inputRow}>
              <input
                            type="number"
                            placeholder={minDelayDays !== null ? `Min: ${minDelayDays} days` : 'Enter days'}
                            value={dissolveDelayDays}
                            onChange={(e) => setDissolveDelayDays(e.target.value)}
                            style={styles.input}
                            min="0"
                        />
                        {minDelayDays !== null && (
                  <button
                                onClick={handleSetMinDelay} 
                                style={{ ...styles.maxButton, background: theme.colors.secondaryBg, color: theme.colors.primaryText, border: `1px solid ${theme.colors.border}` }}
                            >
                                MIN
                  </button>
                        )}
                        {maxDelayDays !== null && (
                            <button onClick={handleSetMaxDelay} style={styles.maxButton}>
                                MAX
                    </button>
                        )}
                    </div>
                    <div style={{ marginTop: '8px', fontSize: '0.85rem', color: theme.colors.mutedText }}>
                        {minDelayDays !== null && maxDelayDays !== null 
                            ? `Range: ${minDelayDays} - ${maxDelayDays} days. Longer delays = more voting power.`
                            : 'Longer dissolve delays earn more voting power.'
                        }
                    </div>
                    {dissolveDelayDays && (
                        (() => {
                            const days = Number(dissolveDelayDays);
                            if (minDelayDays !== null && days < minDelayDays) {
                                return (
                                    <div style={{ marginTop: '6px', fontSize: '0.85rem', color: theme.colors.error }}>
                                        ⚠️ Below minimum of {minDelayDays} days
                                    </div>
                                );
                            }
                            if (maxDelayDays !== null && days > maxDelayDays) {
                                return (
                                    <div style={{ marginTop: '6px', fontSize: '0.85rem', color: theme.colors.error }}>
                                        ⚠️ Above maximum of {maxDelayDays} days
                                    </div>
                                );
                            }
                            return null;
                        })()
                  )}
                </div>
            </div>

            {/* Validation status */}
            {!canProceedStep2 && step2Validation.errors.length > 0 && (
                <div style={{
                    background: `${theme.colors.warning || '#f59e0b'}15`,
                    border: `1px solid ${theme.colors.warning || '#f59e0b'}30`,
                    borderRadius: '10px',
                    padding: '12px 16px',
                    marginBottom: '1rem',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    fontSize: '0.9rem',
                    color: theme.colors.warning || '#f59e0b',
                }}>
                    ⚠️ {step2Validation.errors[0]}
            </div>
            )}

            <div style={styles.buttonRow}>
                <button
                    style={styles.backButton}
                    onClick={() => setCurrentStep(1)}
                >
                    <FaArrowLeft />
                    Back
                </button>
                <button
                    style={styles.continueButton(canProceedStep2)}
                    onClick={() => canProceedStep2 && setCurrentStep(3)}
                    disabled={!canProceedStep2}
                >
                    Continue
                    <FaArrowRight />
                </button>
            </div>
        </>
    );

    // Step 3: Confirm & Stake
    const renderStep3 = () => {
        if (stakingSuccess) {
            return (
                <div className="stake-fade-in" style={styles.successCard}>
                    <div className="stake-pulse" style={styles.successIcon}>
                        <FaCheck size={40} style={{ color: theme.colors.success }} />
                    </div>
                    <h2 style={{ color: theme.colors.primaryText, marginBottom: '0.75rem', fontSize: '1.5rem', fontWeight: '700' }}>
                        🎉 Neuron Created Successfully!
                    </h2>
                    <p style={{ color: theme.colors.secondaryText, marginBottom: '1.5rem', fontSize: '1rem', lineHeight: '1.6' }}>
                        You've staked <strong style={{ color: stakePrimary }}>{stakeAmount} {tokenSymbol}</strong> in <strong>{selectedSns?.name}</strong>
                        {dissolveDelayDays && <> with a <strong style={{ color: theme.colors.primaryText }}>{dissolveDelayDays}-day</strong> dissolve delay</>}.
                    </p>
                    <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', flexWrap: 'wrap' }}>
                        <button
                            style={{
                                ...styles.backButton,
                                flex: 'none',
                                padding: '12px 20px',
                            }}
                            onClick={() => {
                                setCurrentStep(1);
                                setStakeAmount('');
                                setDissolveDelayDays('');
                                setStakingSuccess(false);
                                setCreatedNeuronId(null);
                                setNeedsAutoFill(true);
                            }}
                        >
                            <FaRocket size={14} /> Stake Another
                        </button>
                        <button
                            style={{
                                ...styles.backButton,
                                flex: 'none',
                                padding: '12px 20px',
                            }}
                            onClick={() => navigate('/wallet')}
                        >
                            <FaWallet size={14} /> Go to Wallet
                        </button>
                        {createdNeuronId && (
                            <button
                                style={{
                                    ...styles.continueButton(true),
                                    flex: 'none',
                                    padding: '12px 20px',
                                    background: `linear-gradient(135deg, ${theme.colors.success}, ${theme.colors.success}dd)`,
                                    boxShadow: `0 4px 16px ${theme.colors.success}40`,
                                }}
                                onClick={() => navigate(`/neuron?neuronid=${createdNeuronId}&sns=${selectedSnsRoot}`)}
                            >
                                View Neuron <FaExternalLinkAlt size={12} />
                            </button>
                        )}
                    </div>
                </div>
            );
        }

        return (
            <>
                <div className="stake-fade-in" style={styles.hero}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '14px', marginBottom: '0.75rem' }}>
                        {selectedSnsLogo && (
                            <img src={selectedSnsLogo} alt={selectedSns?.name} style={{ 
                                width: '48px', 
                                height: '48px', 
                                borderRadius: '14px', 
                                flexShrink: 0, 
                                border: `2px solid ${stakePrimary}40`,
                                boxShadow: `0 4px 16px ${stakePrimary}30`
                            }} />
                        )}
                        <h1 style={{ ...styles.title, margin: 0, justifyContent: 'flex-start' }}>
                            Confirm & Stake
                        </h1>
                    </div>
                    <p style={styles.subtitle}>
                        Review your staking details before confirming
                    </p>
                </div>

                <div className="stake-fade-in" style={styles.configCard}>
                    <div style={styles.summaryRow}>
                        <span style={styles.summaryLabel}>SNS</span>
                        <span style={styles.summaryValue}>{selectedSns?.name}</span>
            </div>
                    <div style={styles.summaryRow}>
                        <span style={styles.summaryLabel}>Stake Amount</span>
                        <span style={{ ...styles.summaryValue, color: theme.colors.accent }}>
                            {stakeAmount} {tokenSymbol}
                        </span>
            </div>
                    <div style={{ ...styles.summaryRow, borderBottom: 'none' }}>
                        <span style={styles.summaryLabel}>Dissolve Delay</span>
                        <span style={styles.summaryValue}>
                            {dissolveDelayDays ? `${dissolveDelayDays} days` : 'Not set (can configure later)'}
                        </span>
            </div>

                    {stakingProgress && (
                        <div style={{
                            marginTop: '1.5rem',
                            padding: '16px',
                            background: `${theme.colors.accent}10`,
                            borderRadius: '10px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '12px'
                        }}>
                            <FaSpinner style={{ ...styles.spinner, color: theme.colors.accent }} />
                            <span style={{ color: theme.colors.primaryText }}>{stakingProgress}</span>
          </div>
        )}

                    {stakingError && (
                        <div style={{ ...styles.errorBox, marginTop: '1.5rem' }}>
                            {stakingError}
          </div>
        )}
                </div>

                <div style={styles.buttonRow}>
                    <button
                        style={styles.backButton}
                        onClick={() => setCurrentStep(2)}
                        disabled={isStaking}
                    >
                        <FaArrowLeft />
                        Back
                    </button>
                    <button
                        style={styles.continueButton(!isStaking)}
                        onClick={executeStake}
                        disabled={isStaking}
                    >
                        {isStaking ? (
                            <>
                                <FaSpinner style={styles.spinner} />
                                Staking...
                            </>
                        ) : (
                            <>
                                <FaCoins />
                                Stake {stakeAmount} {tokenSymbol}
                            </>
                        )}
                    </button>
                </div>
            </>
        );
    };

    return (
        <div className='page-container' style={{ background: theme.colors.primaryGradient, minHeight: '100vh' }}>
            <style>{customStyles}</style>
            
            {/* Staking Progress Overlay */}
            {isStaking && (
                <div style={{
                    position: 'fixed',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: '100%',
                    background: 'rgba(0, 0, 0, 0.7)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    zIndex: 10002,
                    backdropFilter: 'blur(6px)',
                }}>
                    <div className="stake-fade-in" style={{
                        background: theme.colors.cardGradient || theme.colors.cardBackground,
                        border: `1px solid ${theme.colors.border}`,
                        borderRadius: '20px',
                        padding: '2rem',
                        boxShadow: '0 16px 64px rgba(0, 0, 0, 0.5)',
                        maxWidth: '420px',
                        width: '90%',
                    }}>
                        {/* Header */}
                        <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
                            <div className="stake-pulse" style={{
                                width: '64px',
                                height: '64px',
                                borderRadius: '50%',
                                background: `linear-gradient(135deg, ${stakePrimary}30, ${stakePrimary}10)`,
                                border: `2px solid ${stakePrimary}40`,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                margin: '0 auto 1rem',
                                fontSize: '1.75rem'
                            }}>
                                🪙
                            </div>
                            <h3 style={{
                                color: theme.colors.primaryText,
                                fontSize: '1.25rem',
                                fontWeight: '700',
                                margin: '0 0 0.5rem 0'
                            }}>
                                Creating Your Neuron
                            </h3>
                            <p style={{
                                color: theme.colors.secondaryText,
                                fontSize: '0.9rem',
                                margin: 0
                            }}>
                                Please wait while we stake your tokens
                            </p>
                        </div>
                        
                        {/* Steps List */}
                        <div style={{
                            background: theme.colors.primaryBg,
                            borderRadius: '14px',
                            padding: '1rem',
                            marginBottom: '1rem'
                        }}>
                            {stakingSteps.map((step, index) => {
                                const isCompleted = step.id < stakingStepIndex;
                                const isCurrent = step.id === stakingStepIndex;
                                const isPending = step.id > stakingStepIndex;
                                
                                // Skip step 6 if no dissolve delay
                                if (step.id === 6 && !dissolveDelayDays) return null;
                                
                                return (
                                    <div 
                                        key={step.id}
                                        style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '12px',
                                            padding: '10px 0',
                                            borderBottom: index < stakingSteps.length - 1 && !(step.id === 5 && !dissolveDelayDays) 
                                                ? `1px solid ${theme.colors.border}` 
                                                : 'none',
                                            opacity: isPending ? 0.5 : 1,
                                            transition: 'all 0.3s ease'
                                        }}
                                    >
                                        {/* Step Icon */}
                                        <div style={{
                                            width: '32px',
                                            height: '32px',
                                            borderRadius: '50%',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            flexShrink: 0,
                                            background: isCompleted 
                                                ? `linear-gradient(135deg, ${theme.colors.success}, ${theme.colors.success}dd)`
                                                : isCurrent
                                                    ? `linear-gradient(135deg, ${stakePrimary}, ${stakeSecondary})`
                                                    : theme.colors.tertiaryBg,
                                            boxShadow: isCurrent ? `0 4px 12px ${stakePrimary}50` : 'none',
                                            fontSize: isCompleted || isCurrent ? '14px' : '12px',
                                        }}>
                                            {isCompleted ? (
                                                <FaCheck size={14} style={{ color: '#fff' }} />
                                            ) : isCurrent ? (
                                                <FaSpinner className="spin" size={14} style={{ color: '#fff' }} />
                                            ) : (
                                                <span style={{ color: theme.colors.mutedText }}>{step.icon}</span>
                                            )}
                                        </div>
                                        
                                        {/* Step Label */}
                                        <span style={{
                                            color: isCompleted 
                                                ? theme.colors.success 
                                                : isCurrent 
                                                    ? theme.colors.primaryText 
                                                    : theme.colors.mutedText,
                                            fontSize: '0.9rem',
                                            fontWeight: isCurrent ? '600' : '500',
                                        }}>
                                            {step.label}
                                        </span>
                                        
                                        {/* Status */}
                                        {isCompleted && (
                                            <span style={{
                                                marginLeft: 'auto',
                                                color: theme.colors.success,
                                                fontSize: '0.75rem',
                                                fontWeight: '600'
                                            }}>
                                                Done
                                            </span>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                        
                        {/* Current Step Progress */}
                        <div style={{
                            textAlign: 'center',
                            color: theme.colors.secondaryText,
                            fontSize: '0.85rem'
                        }}>
                            Step {stakingStepIndex} of {dissolveDelayDays ? 6 : 5}
                        </div>
                    </div>
                </div>
            )}
            
            <Header />
            
            {/* Hero Banner */}
            <div style={{
                background: `linear-gradient(135deg, ${theme.colors.primaryBg} 0%, ${stakePrimary}12 50%, ${stakeSecondary}08 100%)`,
                borderBottom: `1px solid ${theme.colors.border}`,
                padding: '1.5rem 1rem',
                position: 'relative',
                overflow: 'hidden'
            }}>
                {/* Background decorations */}
                <div style={{
                    position: 'absolute',
                    top: '-50%',
                    right: '-5%',
                    width: '300px',
                    height: '300px',
                    background: `radial-gradient(circle, ${stakePrimary}15 0%, transparent 70%)`,
                    pointerEvents: 'none'
                }} />
                <div style={{
                    position: 'absolute',
                    bottom: '-40%',
                    left: '10%',
                    width: '200px',
                    height: '200px',
                    background: `radial-gradient(circle, ${stakeSecondary}10 0%, transparent 70%)`,
                    pointerEvents: 'none'
                }} />
                
                <div style={{ maxWidth: '800px', margin: '0 auto', textAlign: 'center', position: 'relative', zIndex: 1 }}>
                    <div style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '8px',
                        background: `${stakePrimary}20`,
                        color: stakePrimary,
                        padding: '6px 14px',
                        borderRadius: '20px',
                        fontSize: '0.8rem',
                        fontWeight: '600',
                        marginBottom: '0.5rem'
                    }}>
                        🪙 Liquid Staking
                    </div>
                    <h1 style={{
                        fontSize: '1.75rem',
                        fontWeight: '700',
                        color: theme.colors.primaryText,
                        margin: '0.5rem 0',
                        letterSpacing: '-0.5px'
                    }}>
                        SNS Neuron Wizard
                    </h1>
                    <p style={{
                        color: theme.colors.secondaryText,
                        fontSize: '0.95rem',
                        margin: 0
                    }}>
                        Create transferable neurons in any SNS DAO
                    </p>
                </div>
            </div>
            
            <main style={styles.container}>
                {renderStepProgress()}
                {currentStep === 1 && renderStep1()}
                {currentStep === 2 && renderStep2()}
                {currentStep === 3 && renderStep3()}
            </main>
        </div>
    );
}
