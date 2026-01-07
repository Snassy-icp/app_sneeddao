import React, { useState, useEffect } from 'react';
import { formatAmount, getUSD, formatAmountWithConversion } from './utils/StringUtils';
import { dateToReadable, format_duration } from './utils/DateUtils'
import { rewardAmountOrZero, availableOrZero, get_available_backend } from './utils/TokenUtils';
import { PrincipalDisplay } from './utils/PrincipalUtils';
import { Principal } from '@dfinity/principal';
import { useTheme } from './contexts/ThemeContext';
import { useAuth } from './AuthContext';
import { getSnsById } from './utils/SnsUtils';
import { createActor as createSnsGovernanceActor } from 'external/sns_governance';
import { createActor as createLedgerActor } from 'external/icrc1_ledger';
import { NeuronDisplay } from './components/NeuronDisplay';
import { useNaming } from './NamingContext';
import { VotingPowerCalculator } from './utils/VotingPowerUtils';
import { getUserPermissionIcons, getStateIcon, PERM } from './utils/NeuronPermissionUtils';
import { Link } from 'react-router-dom';

// Constants for GLDT and sGLDT canister IDs
const GLDT_CANISTER_ID = '6c7su-kiaaa-aaaar-qaira-cai';
const SGLDT_CANISTER_ID = 'i2s4q-syaaa-aaaan-qz4sq-cai';

console.log('TokenCard constants:', { GLDT_CANISTER_ID, SGLDT_CANISTER_ID });

// Countdown timer component for locks expiring within 1 hour
const LockCountdown = ({ expiry }) => {
    const [timeLeft, setTimeLeft] = useState(null);
    const [isCountdown, setIsCountdown] = useState(false);

    useEffect(() => {
        const updateTimer = () => {
            const now = new Date();
            const expiryDate = new Date(expiry);
            const diff = expiryDate - now;
            
            // If expired
            if (diff <= 0) {
                setTimeLeft('Expired');
                setIsCountdown(false);
                return;
            }
            
            // If within 1 hour (3600000 ms), show countdown
            if (diff <= 3600000) {
                const minutes = Math.floor(diff / 60000);
                const seconds = Math.floor((diff % 60000) / 1000);
                setTimeLeft(`${minutes}:${seconds.toString().padStart(2, '0')}`);
                setIsCountdown(true);
            } else {
                // Otherwise show regular duration
                setTimeLeft(format_duration(diff));
                setIsCountdown(false);
            }
        };

        // Update immediately
        updateTimer();

        // Set up interval to update every second
        const interval = setInterval(updateTimer, 1000);

        // Cleanup on unmount
        return () => clearInterval(interval);
    }, [expiry]);

    if (timeLeft === null) {
        return format_duration(expiry - new Date());
    }

    return (
        <span style={{ 
            color: isCountdown ? '#e74c3c' : 'inherit',
            fontWeight: isCountdown ? 'bold' : 'inherit',
            fontFamily: isCountdown ? 'monospace' : 'inherit'
        }}>
            {timeLeft}
        </span>
    );
};

const TokenCard = ({ token, locks, lockDetailsLoading, principalDisplayInfo, showDebug, hideAvailable = false, hideButtons = false, defaultExpanded = false, defaultLocksExpanded = false, openSendModal, openLockModal, openWrapModal, openUnwrapModal, handleUnregisterToken, rewardDetailsLoading, handleClaimRewards, handleWithdrawFromBackend, handleDepositToBackend, handleRefreshToken, isRefreshing = false, isSnsToken = false, onNeuronTotalsChange, openTransferTokenLockModal }) => {

    const { theme } = useTheme();
    const { isAuthenticated, identity } = useAuth();
    const { getNeuronDisplayName } = useNaming();
    const [showBalanceBreakdown, setShowBalanceBreakdown] = useState(() => {
        // Auto-expand if there's a backend balance
        return (token.available_backend || 0n) > 0n;
    });
    const [isExpanded, setIsExpanded] = useState(defaultExpanded);
    const [locksExpanded, setLocksExpanded] = useState(defaultLocksExpanded);
    const [infoExpanded, setInfoExpanded] = useState(false);
    const [balanceSectionExpanded, setBalanceSectionExpanded] = useState(true);
    
    // Image loading state
    const [logoLoaded, setLogoLoaded] = useState(false);
    
    // Preload logo
    useEffect(() => {
        if (token.logo) {
            const img = new Image();
            img.onload = () => setLogoLoaded(true);
            img.onerror = () => setLogoLoaded(true);
            img.src = token.logo;
        }
    }, [token.logo]);
    
    // Neuron state
    const [neurons, setNeurons] = useState([]);
    const [neuronsLoading, setNeuronsLoading] = useState(false);
    const [neuronsExpanded, setNeuronsExpanded] = useState(false);
    const [expandedNeurons, setExpandedNeurons] = useState(new Set());
    const [hideEmptyNeurons, setHideEmptyNeurons] = useState(() => {
        try {
            const saved = localStorage.getItem('hideEmptyNeurons_Wallet');
            return saved !== null ? JSON.parse(saved) : false;
        } catch (error) {
            return false;
        }
    });
    const [snsRootCanisterId, setSnsRootCanisterId] = useState(null);
    const [nervousSystemParameters, setNervousSystemParameters] = useState(null);
    const [votingPowerCalc, setVotingPowerCalc] = useState(null);
    const [governanceCanisterId, setGovernanceCanisterId] = useState(null);
    
    // Neuron management state
    const [managingNeuronId, setManagingNeuronId] = useState(null);
    const [neuronActionBusy, setNeuronActionBusy] = useState(false);
    const [showDissolveDelayDialog, setShowDissolveDelayDialog] = useState(false);
    const [dissolveDelayInput, setDissolveDelayInput] = useState('');
    const [showIncreaseStakeDialog, setShowIncreaseStakeDialog] = useState(false);
    const [increaseStakeAmount, setIncreaseStakeAmount] = useState('');
    const [showCreateNeuronDialog, setShowCreateNeuronDialog] = useState(false);
    const [createNeuronAmount, setCreateNeuronAmount] = useState('');
    const [createNeuronDissolveDelay, setCreateNeuronDissolveDelay] = useState('');
    const [createNeuronSetDissolveDelay, setCreateNeuronSetDissolveDelay] = useState(true); // Whether to set dissolve delay
    const [createNeuronProgress, setCreateNeuronProgress] = useState('');
    const [createNeuronNonce, setCreateNeuronNonce] = useState('');
    const [createNeuronNonceChecking, setCreateNeuronNonceChecking] = useState(false);
    const [createNeuronNonceFree, setCreateNeuronNonceFree] = useState(null); // null = not checked, true = free, false = taken
    const [createNeuronSubaccountBalance, setCreateNeuronSubaccountBalance] = useState(null);
    const [createNeuronAdvancedExpanded, setCreateNeuronAdvancedExpanded] = useState(false);
    const [showSendNeuronDialog, setShowSendNeuronDialog] = useState(false);
    const [sendNeuronRecipient, setSendNeuronRecipient] = useState('');
    const [sendNeuronProgress, setSendNeuronProgress] = useState('');
    const [showSplitNeuronDialog, setShowSplitNeuronDialog] = useState(false);
    const [splitNeuronAmount, setSplitNeuronAmount] = useState('');

    // Debug logging for wrap/unwrap buttons
    /*console.log('TokenCard Debug:', {
        symbol: token.symbol,
        ledger_canister_id: token.ledger_canister_id,
        available: token.available?.toString(),
        GLDT_CANISTER_ID,
        SGLDT_CANISTER_ID,
        isGLDT: token.ledger_canister_id === GLDT_CANISTER_ID,
        isSGLDT: token.ledger_canister_id === SGLDT_CANISTER_ID,
        hasAvailable: token.available > 0n,
        hideButtons,
        openWrapModal: typeof openWrapModal,
        openUnwrapModal: typeof openUnwrapModal
    });*/

    function getTokenLockUrl(ledger, locks) {
        const baseUrl = '/tokenlock';
        const lockIds = !locks || locks.length < 1 ? "" : locks.map(lock => lock.lock_id).join(',');
        const locksParam = lockIds.length < 1 ? "" : `&locks=${lockIds}`;
        const url = `${baseUrl}?ledger=${ledger}${locksParam}`;
        return url;
    }

    const handleHeaderClick = () => {
        setIsExpanded(!isExpanded);
    };

    const toggleNeuronExpanded = (neuronIdHex) => {
        setExpandedNeurons(prev => {
            const newSet = new Set(prev);
            if (newSet.has(neuronIdHex)) {
                newSet.delete(neuronIdHex);
            } else {
                newSet.add(neuronIdHex);
            }
            return newSet;
        });
    };

    // Helper functions for neurons
    const getNeuronIdHex = (neuron) => {
        if (!neuron.id || !neuron.id[0] || !neuron.id[0].id) return '';
        const idBytes = neuron.id[0].id;
        return Array.from(idBytes).map(b => b.toString(16).padStart(2, '0')).join('');
    };

    const getNeuronStake = (neuron) => {
        return neuron.cached_neuron_stake_e8s || 0n;
    };

    const getTotalNeuronStake = () => {
        return neurons.reduce((total, neuron) => {
            return total + BigInt(getNeuronStake(neuron));
        }, 0n);
    };

    const getTotalNeuronMaturity = () => {
        return neurons.reduce((total, neuron) => {
            return total + BigInt(neuron.maturity_e8s_equivalent || 0n);
        }, 0n);
    };

    // Get total maturity currently being disbursed (7-day vesting period)
    const getTotalDisbursingMaturity = () => {
        return neurons.reduce((total, neuron) => {
            const disbursing = neuron.disburse_maturity_in_progress || [];
            return total + disbursing.reduce((sum, d) => sum + BigInt(d.amount_e8s || 0n), 0n);
        }, 0n);
    };

    const getTotalLockedAmount = () => {
        const tokenLocks = locks[token.ledger_canister_id] || [];
        return tokenLocks.reduce((total, lock) => {
            return total + BigInt(lock.amount || 0n);
        }, 0n);
    };

    // Report neuron totals (stake + maturity) in USD to parent component
    useEffect(() => {
        if (onNeuronTotalsChange && isSnsToken && token.conversion_rate) {
            const totalStake = getTotalNeuronStake();
            const totalMaturity = getTotalNeuronMaturity();
            
            // Convert to USD (do raw calculation without formatting)
            const divisor = 10n ** BigInt(token.decimals);
            const stakedValue = Number(totalStake) / Number(divisor) * token.conversion_rate;
            const maturityValue = Number(totalMaturity) / Number(divisor) * token.conversion_rate;
            const totalUsdValue = stakedValue + maturityValue;
            
            onNeuronTotalsChange({
                total: totalUsdValue,
                staked: stakedValue,
                maturity: maturityValue
            });
        } else if (onNeuronTotalsChange && !isSnsToken) {
            // If not an SNS token, report 0
            onNeuronTotalsChange({
                total: 0,
                staked: 0,
                maturity: 0
            });
        }
    }, [neurons, token.conversion_rate, token.decimals, isSnsToken, onNeuronTotalsChange]);

    // Auto-expand Liquid section when deposited balance comes in (if currently collapsed)
    useEffect(() => {
        if ((token.available_backend || 0n) > 0n && !showBalanceBreakdown) {
            setShowBalanceBreakdown(true);
        }
    }, [token.available_backend]);

    const getDissolveDelaySeconds = (neuron) => {
        const dissolveState = neuron.dissolve_state?.[0];
        if (!dissolveState) return 0;
        
        if ('DissolveDelaySeconds' in dissolveState) {
            return Number(dissolveState.DissolveDelaySeconds);
        } else if ('WhenDissolvedTimestampSeconds' in dissolveState) {
            const dissolveTime = Number(dissolveState.WhenDissolvedTimestampSeconds);
            const now = Date.now() / 1000;
            if (dissolveTime > now) {
                return dissolveTime - now;
            }
        }
        return 0;
    };

    const getNeuronState = (neuron) => {
        const dissolveState = neuron.dissolve_state?.[0];
        if (!dissolveState) return 'Locked';
        
        if ('DissolveDelaySeconds' in dissolveState) {
            return 'Locked';
        } else if ('WhenDissolvedTimestampSeconds' in dissolveState) {
            const dissolveTime = Number(dissolveState.WhenDissolvedTimestampSeconds);
            const now = Date.now() / 1000;
            if (dissolveTime <= now) {
                return 'Dissolved';
            } else {
                return 'Dissolving';
            }
        }
        return 'Unknown';
    };

    // Helper to check if a neuron is empty (0 stake and 0 maturity)
    const isNeuronEmpty = (neuron) => {
        const stake = BigInt(getNeuronStake(neuron));
        const maturity = BigInt(neuron.maturity_e8s_equivalent || 0);
        return stake === 0n && maturity === 0n;
    };

    // Save hideEmptyNeurons preference to localStorage
    useEffect(() => {
        try {
            localStorage.setItem('hideEmptyNeurons_Wallet', JSON.stringify(hideEmptyNeurons));
        } catch (error) {
            console.warn('Could not save hideEmptyNeurons preference:', error);
        }
    }, [hideEmptyNeurons]);

    // Check if user has a specific permission on a neuron
    const userHasPermission = (neuron, permissionType) => {
        if (!identity || !neuron.permissions) return false;
        const userPrincipal = identity.getPrincipal().toString();
        const userPerms = neuron.permissions.find(p => 
            p.principal?.[0]?.toString() === userPrincipal
        );
        return userPerms?.permission_type?.includes(permissionType) || false;
    };

    // Check if SNS allows granting MANAGE_PRINCIPALS permission (needed to add/remove hotkeys)
    // If this permission can't be granted, neurons created in this wallet will be stuck here
    const canManageNeuronPrincipals = () => {
        if (!nervousSystemParameters) return true; // Assume allowed if we haven't loaded params yet
        const grantablePerms = nervousSystemParameters.neuron_grantable_permissions?.[0]?.permissions || 
                               nervousSystemParameters.neuron_grantable_permissions?.permissions || [];
        return grantablePerms.includes(PERM.MANAGE_PRINCIPALS);
    };

    // Neuron management functions
    const manageNeuron = async (neuronIdHex, command) => {
        if (!governanceCanisterId || !identity) {
            return { ok: false, err: 'Missing governance context' };
        }
        
        try {
            const governanceActor = createSnsGovernanceActor(governanceCanisterId, {
                agentOptions: { identity }
            });
            const neuronIdBytes = new Uint8Array(neuronIdHex.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
            const req = { subaccount: Array.from(neuronIdBytes), command: [command] };
            const resp = await governanceActor.manage_neuron(req);
            if (resp?.command?.[0]?.Error) {
                return { ok: false, err: resp.command[0].Error.error_message };
            }
            return { ok: true, response: resp };
        } catch (e) {
            return { ok: false, err: e.message || String(e) };
        }
    };

    const startDissolving = async (neuronIdHex) => {
        setNeuronActionBusy(true);
        setManagingNeuronId(neuronIdHex);
        const result = await manageNeuron(neuronIdHex, { 
            Configure: { operation: [{ StartDissolving: {} }] } 
        });
        if (result.ok) {
            // Refetch neurons to update UI
            await refetchNeurons();
        } else {
            alert(`Error starting dissolve: ${result.err}`);
        }
        setNeuronActionBusy(false);
        setManagingNeuronId(null);
    };

    const stopDissolving = async (neuronIdHex) => {
        setNeuronActionBusy(true);
        setManagingNeuronId(neuronIdHex);
        const result = await manageNeuron(neuronIdHex, { 
            Configure: { operation: [{ StopDissolving: {} }] } 
        });
        if (result.ok) {
            await refetchNeurons();
        } else {
            alert(`Error stopping dissolve: ${result.err}`);
        }
        setNeuronActionBusy(false);
        setManagingNeuronId(null);
    };

    const increaseDissolveDelay = async (neuronIdHex, secondsToAdd) => {
        setNeuronActionBusy(true);
        setManagingNeuronId(neuronIdHex);
        const result = await manageNeuron(neuronIdHex, { 
            Configure: { operation: [{ 
                IncreaseDissolveDelay: { 
                    additional_dissolve_delay_seconds: Number(secondsToAdd) 
                } 
            }] } 
        });
        if (result.ok) {
            await refetchNeurons();
        } else {
            alert(`Error increasing dissolve delay: ${result.err}`);
        }
        setNeuronActionBusy(false);
        setManagingNeuronId(null);
        setShowDissolveDelayDialog(false);
        setDissolveDelayInput('');
    };

    const disburseNeuron = async (neuronIdHex) => {
        setNeuronActionBusy(true);
        setManagingNeuronId(neuronIdHex);
        
        // Disburse to the user's default account (no to_account means default)
        const result = await manageNeuron(neuronIdHex, { 
            Disburse: { 
                to_account: [], 
                amount: [] 
            } 
        });
        
        if (result.ok) {
            alert('Neuron disbursed successfully! The tokens will appear in your wallet shortly.');
            await refetchNeurons();
            // Refresh token balance to show the disbursed tokens
            if (handleRefreshToken) {
                await handleRefreshToken(token);
            }
        } else {
            alert(`Error disbursing neuron: ${result.err}`);
        }
        setNeuronActionBusy(false);
        setManagingNeuronId(null);
    };

    const disburseMaturity = async (neuronIdHex) => {
        setNeuronActionBusy(true);
        setManagingNeuronId(neuronIdHex);
        
        // Disburse 100% of maturity to the user's default account
        const result = await manageNeuron(neuronIdHex, { 
            DisburseMaturity: { 
                to_account: [], 
                percentage_to_disburse: 100 
            } 
        });
        
        if (result.ok) {
            alert('Maturity disbursed successfully! The tokens will appear in your wallet shortly.');
            await refetchNeurons();
            // Refresh token balance to show the disbursed tokens
            if (handleRefreshToken) {
                await handleRefreshToken(token);
            }
        } else {
            alert(`Error disbursing maturity: ${result.err}`);
        }
        setNeuronActionBusy(false);
        setManagingNeuronId(null);
    };

    const toggleAutoStakeMaturity = async (neuronIdHex, currentSetting) => {
        setNeuronActionBusy(true);
        setManagingNeuronId(neuronIdHex);
        
        const newSetting = !currentSetting;
        const result = await manageNeuron(neuronIdHex, { 
            Configure: { 
                operation: [{ 
                    ChangeAutoStakeMaturity: { 
                        requested_setting_for_auto_stake_maturity: newSetting 
                    } 
                }] 
            } 
        });
        
        if (result.ok) {
            await refetchNeurons();
        } else {
            alert(`Error changing auto-stake maturity setting: ${result.err}`);
        }
        setNeuronActionBusy(false);
        setManagingNeuronId(null);
    };

    const splitNeuron = async (neuronIdHex) => {
        if (!splitNeuronAmount || parseFloat(splitNeuronAmount) <= 0) {
            alert('Please enter a valid amount to split');
            return;
        }
        
        const amountE8s = BigInt(Math.floor(parseFloat(splitNeuronAmount) * Math.pow(10, token.decimals)));
        
        setNeuronActionBusy(true);
        setManagingNeuronId(neuronIdHex);
        
        // Generate a random memo for tracking
        const memo = BigInt(Math.floor(Math.random() * Number.MAX_SAFE_INTEGER));
        
        const result = await manageNeuron(neuronIdHex, { 
            Split: { 
                amount_e8s: Number(amountE8s),
                memo: Number(memo)
            } 
        });
        
        if (result.ok) {
            alert('Neuron split successfully! A new neuron has been created.');
            await refetchNeurons();
            setShowSplitNeuronDialog(false);
            setSplitNeuronAmount('');
        } else {
            alert(`Error splitting neuron: ${result.err}`);
        }
        setNeuronActionBusy(false);
        setManagingNeuronId(null);
    };

    const refetchNeurons = async () => {
        if (!governanceCanisterId || !identity) return;
        
        try {
            const governanceActor = createSnsGovernanceActor(governanceCanisterId, {
                agentOptions: { identity }
            });
            const principal = identity.getPrincipal();
            const response = await governanceActor.list_neurons({
                of_principal: [principal],
                limit: 100,
                start_page_at: []
            });
            setNeurons(response.neurons || []);
        } catch (error) {
            console.error('[TokenCard] Error refetching neurons:', error);
        }
    };

    // Check if a specific nonce is free
    const checkNonceIsFree = async (nonce) => {
        if (!governanceCanisterId || !identity) return false;
        
        try {
            const governanceActor = createSnsGovernanceActor(governanceCanisterId, {
                agentOptions: { identity }
            });
            const principal = identity.getPrincipal();
            
            // Compute subaccount from principal and nonce
            const subaccount = await computeNeuronSubaccount(principal, nonce);
            const neuronId = { id: Array.from(subaccount) };
            
            //console.log(`[TokenCard] Checking nonce ${nonce}, neuronId:`, neuronId);
            
            const result = await governanceActor.get_neuron({
                neuron_id: [neuronId]
            });
            //console.log(`[TokenCard] get_neuron result for nonce ${nonce}:`, result);
            
            // get_neuron returns { result: [{ Neuron: ... }] } if found, { result: [{ Error: ... }] } if not found, or { result: [] } if not found
            if (result && result.result) {
                // Empty result array means neuron doesn't exist - nonce is free
                if (result.result.length === 0) {
                    //console.log(`[TokenCard] Nonce ${nonce} is free (empty result)`);
                    return true;
                }
                
                const innerResult = result.result[0];
                if ('Neuron' in innerResult) {
                    // Neuron exists - nonce is taken
                    //console.log(`[TokenCard] Nonce ${nonce} is taken (found neuron)`);
                    return false;
                } else if ('Error' in innerResult) {
                    // Neuron not found - nonce is free
                    //console.log(`[TokenCard] Nonce ${nonce} is free (Error result):`, innerResult.Error);
                    return true;
                }
            }
            
            // Fallback: if result structure is unexpected, assume taken to be safe
            //console.log(`[TokenCard] Nonce ${nonce} - unexpected result structure, assuming taken`);
            return false;
        } catch (error) {
            console.error('[TokenCard] Error checking nonce:', error);
            // On error, assume taken to be safe
            return false;
        }
    };

    // Find an unused neuron nonce by checking get_neuron
    const findUnusedNonce = async () => {
        if (!governanceCanisterId || !identity) return null;
        
        try {
            const governanceActor = createSnsGovernanceActor(governanceCanisterId, {
                agentOptions: { identity }
            });
            const principal = identity.getPrincipal();
            
            // Try nonces starting from 0
            for (let nonce = 0; nonce < 100; nonce++) {
                // Compute subaccount from principal and nonce
                const subaccount = await computeNeuronSubaccount(principal, nonce);
                const neuronId = { id: Array.from(subaccount) };
                
                const result = await governanceActor.get_neuron({
                    neuron_id: [neuronId]
                });
                
                // get_neuron returns { result: [{ Neuron: ... }] } if found, { result: [{ Error: ... }] } if not found, or { result: [] } if not found
                if (result && result.result) {
                    // Empty result array means neuron doesn't exist - nonce is free
                    if (result.result.length === 0) {
                        //console.log(`[TokenCard] Found unused nonce: ${nonce}`);
                        return { nonce, subaccount };
                    }
                    
                    const innerResult = result.result[0];
                    if ('Error' in innerResult) {
                        // Neuron not found - nonce is free
                        //console.log(`[TokenCard] Found unused nonce: ${nonce}`);
                        return { nonce, subaccount };
                    }
                    // If 'Neuron' in innerResult, neuron exists, continue to next nonce
                }
            }
            
            throw new Error('Could not find unused nonce (tried 0-99)');
        } catch (error) {
            console.error('[TokenCard] Error finding unused nonce:', error);
            return null;
        }
    };

    // Generate neuron subaccount using the correct SNS formula
    // SHA256(0x0c, "neuron-stake", principal-bytes, nonce-u64-be)
    const computeNeuronSubaccount = async (principal, nonce) => {
        // Convert nonce to u64 big-endian bytes
        const nonceBytes = new Uint8Array(8);
        new DataView(nonceBytes.buffer).setBigUint64(0, BigInt(nonce), false); // false = big-endian
        
        // Build the data to hash according to SNS spec
        const chunks = [
            Uint8Array.from([0x0c]),                          // len("neuron-stake") = 12 = 0x0c
            new TextEncoder().encode("neuron-stake"),         // "neuron-stake"
            principal.toUint8Array(),                         // controller principal bytes
            nonceBytes,                                       // nonce as u64 big-endian
        ];
        
        // Concatenate all chunks
        const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
        const data = new Uint8Array(totalLength);
        let offset = 0;
        for (const chunk of chunks) {
            data.set(chunk, offset);
            offset += chunk.length;
        }
        
        // Hash with SHA-256
        const digest = await crypto.subtle.digest('SHA-256', data);
        return new Uint8Array(digest);
    };

    const createNeuron = async (amountE8s, dissolveDelaySeconds, nonce, shouldSetDissolveDelay = true) => {
        setNeuronActionBusy(true);
        
        try {
            // Step 1: Use the provided nonce and compute subaccount
            setCreateNeuronProgress('Computing neuron subaccount...');
            const principal = identity.getPrincipal();
            const subaccount = await computeNeuronSubaccount(principal, nonce);
            
            console.log(`[TokenCard] Creating neuron with nonce ${nonce}`);
            console.log(`[TokenCard] Subaccount (hex):`, Array.from(subaccount).map(b => b.toString(16).padStart(2, '0')).join(''));
            console.log(`[TokenCard] Controller principal:`, principal.toString());
            console.log(`[TokenCard] Will set dissolve delay:`, shouldSetDissolveDelay);

            // Step 2: Transfer tokens to the neuron's subaccount
            setCreateNeuronProgress('Transferring tokens to neuron subaccount...');
            const ledgerIdString = typeof token.ledger_canister_id === 'string' 
                ? token.ledger_canister_id 
                : token.ledger_canister_id?.toString();
            
            const ledgerActor = createLedgerActor(ledgerIdString, {
                agentOptions: { identity }
            });
            
            // Ensure subaccount is exactly 32 bytes (it should already be from SHA-256)
            const subaccount32 = new Uint8Array(32);
            subaccount32.set(subaccount, 0);
            
            // Convert nonce to memo bytes (8 bytes, big-endian)
            const memoBytes = (() => {
                const buffer = new ArrayBuffer(8);
                new DataView(buffer).setBigUint64(0, BigInt(nonce), false); // false = big-endian
                return Array.from(new Uint8Array(buffer));
            })();
            
            const transferArgs = {
                to: {
                    owner: Principal.fromText(governanceCanisterId),
                    subaccount: [Array.from(subaccount32)]
                },
                amount: BigInt(amountE8s),
                fee: [],
                memo: [memoBytes],
                from_subaccount: [],
                created_at_time: []
            };
            
            const transferResult = await ledgerActor.icrc1_transfer(transferArgs);
            
            if ('Err' in transferResult) {
                const error = transferResult.Err;
                let errorMsg = 'Transfer failed';
                if (error.InsufficientFunds) {
                    errorMsg = `Insufficient funds. Available: ${formatAmount(error.InsufficientFunds.balance, token.decimals)} ${token.symbol}`;
                } else if (error.BadFee) {
                    errorMsg = `Bad fee. Expected: ${formatAmount(error.BadFee.expected_fee, token.decimals)} ${token.symbol}`;
                } else if (error.GenericError) {
                    errorMsg = error.GenericError.message;
                }
                alert(`Error transferring tokens: ${errorMsg}`);
                setNeuronActionBusy(false);
                setCreateNeuronProgress('');
                return;
            }
            
            // Step 3: Wait a moment for the transfer to be processed
            setCreateNeuronProgress('Waiting for transfer to be processed...');
            await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds
            
            // Step 4: Call ClaimOrRefresh with the specific subaccount to create the neuron
            setCreateNeuronProgress('Claiming neuron stake...');
            const governanceActor = createSnsGovernanceActor(governanceCanisterId, {
                agentOptions: { identity }
            });
            
            const userPrincipal = identity.getPrincipal();
            
            // Ensure subaccount is exactly 32 bytes for ClaimOrRefresh
            const claimSubaccount = new Uint8Array(32);
            claimSubaccount.set(subaccount, 0);
            
            //console.log(`[TokenCard] ClaimOrRefresh details:`);
            //console.log(`- Subaccount (hex):`, Array.from(claimSubaccount).map(b => b.toString(16).padStart(2, '0')).join(''));
            //console.log(`- Memo:`, nonce);
            //console.log(`- Controller:`, userPrincipal.toString());
            
            const claimResult = await governanceActor.manage_neuron({
                subaccount: Array.from(claimSubaccount),
                command: [{
                    ClaimOrRefresh: {
                        by: [{ MemoAndController: { 
                            memo: nonce, // Use Number, not BigInt
                            controller: [userPrincipal] // Provide the controller principal
                        }}]
                    }
                }]
            });
            
            if (claimResult?.command?.[0]?.Error) {
                alert(`Tokens transferred but failed to create neuron: ${claimResult.command[0].Error.error_message}`);
                setNeuronActionBusy(false);
                setCreateNeuronProgress('');
                return;
            }
            
            // Step 5: Set dissolve delay (if requested)
            if (shouldSetDissolveDelay && dissolveDelaySeconds > 0) {
                setCreateNeuronProgress('Setting dissolve delay...');
                const neuronIdHex = Array.from(subaccount).map(b => b.toString(16).padStart(2, '0')).join('');
                await manageNeuron(neuronIdHex, {
                    Configure: { operation: [{ 
                        IncreaseDissolveDelay: { 
                            additional_dissolve_delay_seconds: Number(dissolveDelaySeconds) 
                        } 
                    }] }
                });
            }
            
            setCreateNeuronProgress('Refreshing neuron list...');
            await refetchNeurons();
            
            alert(`Successfully created neuron with ${formatAmount(amountE8s, token.decimals)} ${token.symbol}!`);
        } catch (error) {
            console.error('[TokenCard] Error creating neuron:', error);
            alert(`Error: ${error.message || String(error)}`);
        }
        
        setNeuronActionBusy(false);
        setCreateNeuronProgress('');
        setShowCreateNeuronDialog(false);
        setCreateNeuronAmount('');
        setCreateNeuronDissolveDelay('');
        setCreateNeuronSetDissolveDelay(true);
        setCreateNeuronNonce('');
        setCreateNeuronNonceFree(null);
        setCreateNeuronSubaccountBalance(null);
        setCreateNeuronAdvancedExpanded(false);
    };

    const increaseNeuronStake = async (neuronIdHex, amountE8s) => {
        setNeuronActionBusy(true);
        setManagingNeuronId(neuronIdHex);
        
        try {
            // Step 1: Transfer tokens to the neuron's subaccount
            const ledgerIdString = typeof token.ledger_canister_id === 'string' 
                ? token.ledger_canister_id 
                : token.ledger_canister_id?.toString();
            
            const ledgerActor = createLedgerActor(ledgerIdString, {
                agentOptions: { identity }
            });
            
            // The neuron's subaccount is the neuron ID itself (as bytes)
            const neuronIdBytes = new Uint8Array(neuronIdHex.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
            
            // Transfer to the governance canister with the neuron ID as subaccount
            const transferArgs = {
                to: {
                    owner: Principal.fromText(governanceCanisterId),
                    subaccount: [Array.from(neuronIdBytes)]
                },
                amount: BigInt(amountE8s),
                fee: [],
                memo: [],
                from_subaccount: [],
                created_at_time: []
            };
            
            const transferResult = await ledgerActor.icrc1_transfer(transferArgs);
            
            if ('Err' in transferResult) {
                const error = transferResult.Err;
                let errorMsg = 'Transfer failed';
                if (error.InsufficientFunds) {
                    errorMsg = `Insufficient funds. Available: ${formatAmount(error.InsufficientFunds.balance, token.decimals)} ${token.symbol}`;
                } else if (error.BadFee) {
                    errorMsg = `Bad fee. Expected: ${formatAmount(error.BadFee.expected_fee, token.decimals)} ${token.symbol}`;
                } else if (error.GenericError) {
                    errorMsg = error.GenericError.message;
                }
                alert(`Error transferring tokens: ${errorMsg}`);
                setNeuronActionBusy(false);
                setManagingNeuronId(null);
                return;
            }
            
            // Step 2: Call ClaimOrRefresh to update the neuron
            // For existing neurons, use NeuronId variant (not MemoAndController)
            const result = await manageNeuron(neuronIdHex, {
                ClaimOrRefresh: {
                    by: [{ NeuronId: {} }]
                }
            });
            
            if (result.ok) {
                alert(`Successfully increased stake by ${formatAmount(amountE8s, token.decimals)} ${token.symbol}!`);
                await refetchNeurons();
            } else {
                alert(`Tokens transferred but failed to refresh neuron: ${result.err}. The tokens are in the neuron but voting power may not be updated yet.`);
            }
        } catch (error) {
            console.error('[TokenCard] Error increasing neuron stake:', error);
            alert(`Error: ${error.message || String(error)}`);
        }
        
        setNeuronActionBusy(false);
        setManagingNeuronId(null);
        setShowIncreaseStakeDialog(false);
        setIncreaseStakeAmount('');
    };

    const sendNeuron = async (neuronIdHex, recipientPrincipalText) => {
        setNeuronActionBusy(true);
        setSendNeuronProgress('Validating recipient principal...');
        
        try {
            // Validate the recipient principal
            let recipientPrincipal;
            try {
                recipientPrincipal = Principal.fromText(recipientPrincipalText);
            } catch (error) {
                alert('Invalid principal format. Please enter a valid Internet Computer principal.');
                setNeuronActionBusy(false);
                setSendNeuronProgress('');
                return;
            }
            
            // Check if trying to send to self
            const userPrincipal = identity.getPrincipal();
            if (recipientPrincipal.toString() === userPrincipal.toString()) {
                alert('You cannot send a neuron to yourself.');
                setNeuronActionBusy(false);
                setSendNeuronProgress('');
                return;
            }
            
            const governanceActor = createSnsGovernanceActor(governanceCanisterId, {
                agentOptions: { identity }
            });
            
            // Step 1: Check current neuron state and recipient's existing permissions
            setSendNeuronProgress('Checking neuron permissions...');
            
            const neuronIdBytes = new Uint8Array(neuronIdHex.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
            const currentNeuronResult = await governanceActor.get_neuron({
                neuron_id: [{ id: Array.from(neuronIdBytes) }]
            });
            
            if (!currentNeuronResult.result || currentNeuronResult.result.length === 0) {
                alert('Failed to fetch neuron data');
                setNeuronActionBusy(false);
                setSendNeuronProgress('');
                return;
            }
            
            const currentNeuron = currentNeuronResult.result[0].Neuron || currentNeuronResult.result[0];
            const recipientPerms = currentNeuron.permissions.find(p => 
                p.principal?.[0]?.toString() === recipientPrincipal.toString()
            );
            
            // All 11 permissions (including UNSPECIFIED which is 0)
            const fullPermissions = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
            
            // Step 2: Add recipient with full permissions if they don't already have them
            const hasFullPermissions = recipientPerms && recipientPerms.permission_type.length === 11;
            
            if (!hasFullPermissions) {
                setSendNeuronProgress('Adding recipient with full permissions...');
                
                const addResult = await manageNeuron(neuronIdHex, {
                    AddNeuronPermissions: {
                        principal_id: [recipientPrincipal],
                        permissions_to_add: [{ permissions: fullPermissions }]
                    }
                });
                
                if (!addResult.ok) {
                    alert(`Failed to add recipient: ${addResult.err}`);
                    setNeuronActionBusy(false);
                    setSendNeuronProgress('');
                    return;
                }
                
                // Verify recipient was added
                setSendNeuronProgress('Verifying recipient was added...');
                
                const verifyResult = await governanceActor.get_neuron({
                    neuron_id: [{ id: Array.from(neuronIdBytes) }]
                });
                
                if (!verifyResult.result || verifyResult.result.length === 0) {
                    alert('Failed to verify neuron after adding recipient');
                    setNeuronActionBusy(false);
                    setSendNeuronProgress('');
                    return;
                }
                
                const verifiedNeuron = verifyResult.result[0].Neuron || verifyResult.result[0];
                const verifiedRecipientPerms = verifiedNeuron.permissions.find(p => 
                    p.principal?.[0]?.toString() === recipientPrincipal.toString()
                );
                
                if (!verifiedRecipientPerms || verifiedRecipientPerms.permission_type.length !== 11) {
                    alert('Failed to verify recipient has full permissions');
                    setNeuronActionBusy(false);
                    setSendNeuronProgress('');
                    return;
                }
            } else {
                //console.log('[TokenCard] Recipient already has full permissions, skipping add step');
            }
            
            // Step 3: Remove all other principals
            setSendNeuronProgress('Removing all other principals...');
            
            // Re-fetch neuron to get current state
            const finalNeuronResult = await governanceActor.get_neuron({
                neuron_id: [{ id: Array.from(neuronIdBytes) }]
            });
            
            if (!finalNeuronResult.result || finalNeuronResult.result.length === 0) {
                alert('Failed to fetch neuron for cleanup');
                setNeuronActionBusy(false);
                setSendNeuronProgress('');
                return;
            }
            
            const updatedNeuron = finalNeuronResult.result[0].Neuron || finalNeuronResult.result[0];
            const principalsToRemove = updatedNeuron.permissions
                .filter(p => p.principal?.[0]?.toString() !== recipientPrincipal.toString());
            
            if (principalsToRemove.length > 0) {
                // Remove each principal individually, using their actual permissions
                for (const permEntry of principalsToRemove) {
                    const principal = permEntry.principal[0];
                    const theirPermissions = permEntry.permission_type || [];
                    
                    if (theirPermissions.length === 0) {
                        //console.log(`[TokenCard] Skipping principal ${principal.toString()} - no permissions to remove`);
                        continue;
                    }
                    
                    const removeResult = await manageNeuron(neuronIdHex, {
                        RemoveNeuronPermissions: {
                            principal_id: [principal],
                            permissions_to_remove: [{ permissions: theirPermissions }]
                        }
                    });
                    
                    if (!removeResult.ok) {
                        alert(`Warning: Recipient was added but failed to remove principal ${principal.toString()}: ${removeResult.err}. The neuron may have multiple owners.`);
                        break; // Stop on first error
                    }
                }
            }
            
            setSendNeuronProgress('Refreshing neuron list...');
            await refetchNeurons();
            
            alert(`Successfully sent neuron to ${recipientPrincipalText}!`);
        } catch (error) {
            console.error('[TokenCard] Error sending neuron:', error);
            alert(`Error: ${error.message || String(error)}`);
        }
        
        setNeuronActionBusy(false);
        setSendNeuronProgress('');
        setShowSendNeuronDialog(false);
        setSendNeuronRecipient('');
        setManagingNeuronId(null);
    };

    // Fetch neurons and parameters for SNS tokens
    useEffect(() => {
        if (!isSnsToken || !isAuthenticated || !identity || !token.ledger_canister_id) {
            return;
        }

        async function fetchNeurons() {
            try {
                setNeuronsLoading(true);
                
                // Find the SNS by ledger canister ID
                const ledgerIdString = typeof token.ledger_canister_id === 'string' 
                    ? token.ledger_canister_id 
                    : token.ledger_canister_id?.toString();
                
                // We need to find the SNS root from the ledger ID
                // For now, we'll need to pass the governance canister ID
                // Let's get it from the SNS data
                const { getAllSnses } = await import('./utils/SnsUtils');
                const allSnses = getAllSnses();
                const snsData = allSnses.find(sns => sns.canisters?.ledger === ledgerIdString);
                
                if (!snsData || !snsData.canisters?.governance) {
                    //console.log(`[TokenCard] No SNS governance found for ${token.symbol}`);
                    setNeuronsLoading(false);
                    return;
                }

                const govCanisterId = snsData.canisters.governance;
                const rootId = snsData.rootCanisterId;
                setSnsRootCanisterId(rootId);
                setGovernanceCanisterId(govCanisterId);
                //console.log(`[TokenCard] Fetching neurons for ${token.symbol} from governance:`, govCanisterId);

                const governanceActor = createSnsGovernanceActor(govCanisterId, { agentOptions: { identity } });
                
                // Fetch both neurons and nervous system parameters
                const principal = identity.getPrincipal();
                const [neuronsResponse, paramsResponse] = await Promise.all([
                    governanceActor.list_neurons({
                        of_principal: [principal],
                        limit: 100,
                        start_page_at: []
                    }),
                    governanceActor.get_nervous_system_parameters(null)
                ]);
                setNeurons(neuronsResponse.neurons || []);
                setNervousSystemParameters(paramsResponse);
                
                // Initialize voting power calculator
                const calc = new VotingPowerCalculator();
                calc.setParams(paramsResponse);
                setVotingPowerCalc(calc);
            } catch (error) {
                console.error(`[TokenCard] Error fetching neurons for ${token.symbol}:`, error);
            } finally {
                setNeuronsLoading(false);
            }
        }

        fetchNeurons();
    }, [isSnsToken, isAuthenticated, identity, token.ledger_canister_id, token.symbol]);

    return (
        <div className="card">
            <div className="card-header" onClick={handleHeaderClick}>
                <div className="header-logo-column" style={{ alignSelf: 'flex-start', minWidth: '48px', minHeight: '48px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {!logoLoaded ? (
                        <div className="spinner" style={{ width: '24px', height: '24px' }}></div>
                    ) : (
                        <img 
                            src={token.logo} 
                            alt={token.symbol} 
                            className="token-logo-card"
                            style={{ height: '48px', width: 'auto' }}
                        />
                    )}
                </div>
                <div className="header-content-column">
                    {/* Row 1: Token name (left) and USD total (right) */}
                    <div className="header-row-1" style={{ minWidth: 0 }}>
                        <span className="token-name">{token.name || token.symbol}</span>
                        <span className="token-usd-value">
                            {((token.available || 0n) + (token.locked || 0n) + (isSnsToken ? (getTotalNeuronStake() + getTotalNeuronMaturity()) : 0n) + rewardAmountOrZero(token, rewardDetailsLoading, hideAvailable)) > 0n && token.conversion_rate > 0 && 
                                `$${formatAmountWithConversion((token.available || 0n) + (token.locked || 0n) + (isSnsToken ? (getTotalNeuronStake() + getTotalNeuronMaturity()) : 0n) + rewardAmountOrZero(token, rewardDetailsLoading, hideAvailable), token.decimals, token.conversion_rate)}`
                            }
                        </span>
                    </div>
                    {/* Row 2: Amount and symbol (left) and Refresh button (right) */}
                    <div className="header-row-2">
                        <div className="amount-symbol">
                            {!hideAvailable && (
                                <span className="token-amount">{formatAmount((token.available || 0n) + (token.locked || 0n) + (isSnsToken ? (getTotalNeuronStake() + getTotalNeuronMaturity()) : 0n) + rewardAmountOrZero(token, rewardDetailsLoading, hideAvailable), token.decimals)} {token.symbol}</span>
                            )}
                        </div>
                        {handleRefreshToken && (
                            <button
                                onClick={async (e) => {
                                    e.stopPropagation();
                                    await handleRefreshToken(token);
                                    // Also refresh neurons if it's an SNS token
                                    if (isSnsToken && refetchNeurons) {
                                        await refetchNeurons();
                                    }
                                }}
                                disabled={isRefreshing}
                                style={{
                                    background: 'none',
                                    border: 'none',
                                    cursor: isRefreshing ? 'default' : 'pointer',
                                    padding: '4px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    color: theme.colors.mutedText,
                                    fontSize: '1.2rem',
                                    transition: 'color 0.2s ease',
                                    opacity: isRefreshing ? 0.6 : 1
                                }}
                                onMouseEnter={(e) => !isRefreshing && (e.target.style.color = theme.colors.primaryText)}
                                onMouseLeave={(e) => !isRefreshing && (e.target.style.color = theme.colors.mutedText)}
                                title="Refresh token data"
                            >
                                {isRefreshing ? '⏳' : '🔄'}
                            </button>
                        )}
                    </div>
                    {/* Row 3: SNS pill and status icons (left) */}
                    <div className="header-row-3" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        {isSnsToken && (
                            <span style={{
                                background: theme.colors.accent,
                                color: theme.colors.primaryBg,
                                padding: '2px 8px',
                                borderRadius: '12px',
                                fontSize: '0.7rem',
                                fontWeight: '600',
                                textTransform: 'uppercase',
                                letterSpacing: '0.5px'
                            }}>
                                SNS
                            </span>
                        )}
                        {/* Locks icon */}
                        {token.locked > 0n && (
                            <span 
                                style={{ fontSize: '14px', cursor: 'help' }} 
                                title={`${formatAmount(token.locked, token.decimals)} ${token.symbol} locked`}
                            >
                                🔒
                            </span>
                        )}
                        {/* Neurons icon */}
                        {neurons.length > 0 && (
                            <span 
                                style={{ fontSize: '14px', cursor: 'help' }} 
                                title={`${neurons.length} neuron${neurons.length > 1 ? 's' : ''}`}
                            >
                                🧠
                            </span>
                        )}
                        {/* Maturity icon */}
                        {getTotalNeuronMaturity() > 0n && (() => {
                            const maturityUSD = token.conversion_rate 
                                ? Number(getTotalNeuronMaturity()) / Number(10n ** BigInt(token.decimals)) * token.conversion_rate
                                : 0;
                            
                            return (
                                <span 
                                    style={{ 
                                        fontSize: '14px', 
                                        cursor: 'help',
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: '4px'
                                    }} 
                                    title={`${formatAmount(getTotalNeuronMaturity(), token.decimals)} ${token.symbol} maturity`}
                                >
                                    🌱
                                    <span style={{ fontSize: '12px', color: theme.colors.secondaryText }}>
                                        ${maturityUSD.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                    </span>
                                </span>
                            );
                        })()}
                        {/* Disbursing maturity icon */}
                        {getTotalDisbursingMaturity() > 0n && (() => {
                            const disbursingUSD = token.conversion_rate 
                                ? Number(getTotalDisbursingMaturity()) / Number(10n ** BigInt(token.decimals)) * token.conversion_rate
                                : 0;
                            
                            return (
                                <span 
                                    style={{ 
                                        fontSize: '14px', 
                                        cursor: 'help',
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: '4px'
                                    }} 
                                    title={`${formatAmount(getTotalDisbursingMaturity(), token.decimals)} ${token.symbol} disbursing (7-day vesting)`}
                                >
                                    ⏳
                                    <span style={{ fontSize: '12px', color: theme.colors.accent }}>
                                        ${disbursingUSD.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                    </span>
                                </span>
                            );
                        })()}
                        {/* Rewards icon */}
                        {rewardAmountOrZero(token, rewardDetailsLoading, hideAvailable) > 0n && (() => {
                            const rewardsUSD = token.conversion_rate 
                                ? Number(rewardAmountOrZero(token, rewardDetailsLoading, hideAvailable)) / Number(10n ** BigInt(token.decimals)) * token.conversion_rate
                                : 0;
                            
                            return (
                                <span 
                                    style={{ 
                                        fontSize: '14px', 
                                        cursor: 'help',
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: '4px'
                                    }} 
                                    title={`${formatAmount(rewardAmountOrZero(token, rewardDetailsLoading, hideAvailable), token.decimals)} ${token.symbol} rewards`}
                                >
                                    🎁
                                    <span style={{ fontSize: '12px', color: theme.colors.secondaryText }}>
                                        ${rewardsUSD.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                    </span>
                                </span>
                            );
                        })()}
                    </div>
                </div>
            </div>
            {isExpanded && (
                <>
                    {!hideButtons && (
                <div className="action-buttons">


                    {token.available > 0n && (
                        <button 
                            onClick={() => openSendModal(token)}
                            style={{
                                background: theme.colors.accent,
                                color: theme.colors.primaryBg,
                                border: 'none',
                                borderRadius: '6px',
                                padding: '6px 12px',
                                cursor: 'pointer',
                                fontSize: '0.85rem',
                                fontWeight: '500',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '6px',
                                transition: 'all 0.2s ease'
                            }}
                            onMouseEnter={(e) => {
                                e.target.style.background = theme.colors.accentHover;
                            }}
                            onMouseLeave={(e) => {
                                e.target.style.background = theme.colors.accent;
                            }}
                        >
                            <img 
                                src="send-inverted.png" 
                                alt="Send" 
                                style={{ width: '14px', height: '14px' }}
                            />
                            Send
                        </button>
                    )}


                    {token.available + BigInt(token.locked) + rewardAmountOrZero(token) === 0n && (
                        <button 
                            onClick={() => handleUnregisterToken(token.ledger_canister_id)}
                            style={{
                                background: theme.colors.error,
                                color: theme.colors.primaryBg,
                                border: 'none',
                                borderRadius: '6px',
                                padding: '6px 12px',
                                cursor: 'pointer',
                                fontSize: '0.85rem',
                                fontWeight: '500',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '6px',
                                transition: 'all 0.2s ease'
                            }}
                            onMouseEnter={(e) => {
                                e.target.style.background = theme.colors.errorHover || `${theme.colors.error}dd`;
                            }}
                            onMouseLeave={(e) => {
                                e.target.style.background = theme.colors.error;
                            }}
                        >
                            <img 
                                src="red-x-black.png" 
                                alt="Remove" 
                                style={{ width: '14px', height: '14px' }}
                            />
                            Remove
                        </button>
                    )}
                </div>
            )}
            <div className="balance-section">
                {!hideAvailable && (
                    <>
                        <div 
                            className="balance-item" 
                            style={{ position: 'relative', cursor: 'pointer' }}
                            onClick={() => setBalanceSectionExpanded(!balanceSectionExpanded)}
                        >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <div className="balance-label">Total</div>
                                <span 
                                    style={{ 
                                        fontSize: '0.9rem',
                                        color: theme.colors.secondaryText,
                                        transition: 'transform 0.2s ease',
                                        userSelect: 'none'
                                    }}
                                >
                                    {balanceSectionExpanded ? '▼' : '▶'}
                                </span>
                            </div>
                            <div className="balance-value">{formatAmount(availableOrZero(token.available) + token.locked + getTotalNeuronStake() + getTotalNeuronMaturity() + rewardAmountOrZero(token, rewardDetailsLoading, hideAvailable), token.decimals)}{getUSD(availableOrZero(token.available) + token.locked + getTotalNeuronStake() + getTotalNeuronMaturity() + rewardAmountOrZero(token, rewardDetailsLoading, hideAvailable), token.decimals, token.conversion_rate)}</div>
                        </div>
                        {balanceSectionExpanded && (
                            <>
                        <div className="balance-item" style={{ cursor: 'pointer' }} onClick={() => setShowBalanceBreakdown(!showBalanceBreakdown)}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <div className="balance-label" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                    <span style={{ fontSize: '14px' }}>💧</span>
                                    Liquid
                                </div>
                                <span style={{ 
                                    fontSize: '0.9rem',
                                    color: theme.colors.secondaryText,
                                    userSelect: 'none'
                                }}>
                                    {showBalanceBreakdown ? '▼' : '▶'}
                                </span>
                            </div>
                            <div className="balance-value">{formatAmount(token.available || 0n, token.decimals)}{getUSD(token.available || 0n, token.decimals, token.conversion_rate)}</div>
                        </div>
                        
                        {showBalanceBreakdown && (
                            <div className="balance-breakdown" style={{ 
                                padding: '10px', 
                                background: theme.colors.tertiaryBg, 
                                borderRadius: '4px',
                                border: `1px solid ${theme.colors.border}`
                            }}>
                                <div className="balance-breakdown-item" style={{ 
                                    display: 'flex', 
                                    justifyContent: 'space-between', 
                                    alignItems: 'center',
                                    marginBottom: '8px'
                                }}>
                                    <div>
                                        <div style={{ fontSize: '12px', color: '#bdc3c7' }}>Wallet</div>
                                        <div style={{ fontSize: '14px', fontWeight: 'bold', color: theme.colors.primaryText }}>
                                            {formatAmount(token.balance || 0n, token.decimals)} {token.symbol}
                                        </div>
                                        {(() => {
                                            const shouldShowButton = token.balance > BigInt(token.fee) && !hideButtons;
                                            
                                            return shouldShowButton ? (
                                                <div
                                                    onClick={(e) => {
                                                        console.log('Deposit button clicked!');
                                                        e.stopPropagation();
                                                        handleDepositToBackend(token);
                                                    }}
                                                    style={{
                                                        padding: '6px 10px',
                                                        fontSize: '12px',
                                                        background: theme.colors.success || theme.colors.accent,
                                                        color: theme.colors.primaryBg,
                                                        border: `1px solid ${theme.colors.success || theme.colors.accentHover}`,
                                                        borderRadius: '3px',
                                                        cursor: 'pointer',
                                                        marginTop: '4px',
                                                        display: 'inline-block',
                                                        textAlign: 'center',
                                                        userSelect: 'none'
                                                    }}
                                                    onMouseEnter={(e) => {
                                                        e.target.style.opacity = '0.8';
                                                    }}
                                                    onMouseLeave={(e) => {
                                                        e.target.style.opacity = '1';
                                                    }}
                                                >
                                                    Deposit
                                                </div>
                                            ) : null;
                                        })()}
                                    </div>
                                </div>
                                
                                <div className="balance-breakdown-item">
                                    <div style={{ fontSize: '12px', color: '#bdc3c7' }}>Deposited</div>
                                    <div style={{ fontSize: '14px', fontWeight: 'bold', color: theme.colors.primaryText }}>
                                        {formatAmount(token.available_backend || 0n, token.decimals)} {token.symbol}
                                    </div>
                                    {(() => {
                                        const shouldShowButton = token.available_backend > 0n && !hideButtons;
                                        
                                        return shouldShowButton ? (
                                            <div
                                                onClick={(e) => {
                                                    console.log('Withdraw button clicked!');
                                                    e.stopPropagation();
                                                    handleWithdrawFromBackend(token);
                                                }}
                                                style={{
                                                    padding: '6px 10px',
                                                    fontSize: '12px',
                                                    background: theme.colors.accent,
                                                    color: theme.colors.primaryBg,
                                                    border: `1px solid ${theme.colors.accentHover}`,
                                                    borderRadius: '3px',
                                                    cursor: 'pointer',
                                                    marginTop: '4px',
                                                    display: 'inline-block',
                                                    textAlign: 'center',
                                                    userSelect: 'none'
                                                }}
                                                onMouseEnter={(e) => {
                                                    e.target.style.background = theme.colors.accentHover;
                                                }}
                                                onMouseLeave={(e) => {
                                                    e.target.style.background = theme.colors.accent;
                                                }}
                                            >
                                                Withdraw
                                            </div>
                                        ) : null;
                                    })()}
                                </div>
                            </div>
                        )}
                        {(token.locked || 0n) > 0n && (
                            <div className="balance-item">
                                <div className="balance-label" style={{ display: 'flex', alignItems: 'center', gap: '6px', justifyContent: 'flex-start' }}>
                                    <span style={{ fontSize: '14px' }}>🔐</span>
                                    Locked
                                </div>
                                <div className="balance-value">{formatAmount(token.locked || 0n, token.decimals)}{getUSD(token.locked || 0n, token.decimals, token.conversion_rate)}</div>
                            </div>
                        )}
                        {isSnsToken && neurons.length > 0 && (
                            <>
                                <div className="balance-item">
                                    <div className="balance-label" style={{ display: 'flex', alignItems: 'center', gap: '6px', justifyContent: 'flex-start' }}>
                                        <span style={{ fontSize: '14px' }}>🧠</span>
                                        Staked
                                    </div>
                                    <div className="balance-value">{formatAmount(getTotalNeuronStake(), token.decimals)}{getUSD(getTotalNeuronStake(), token.decimals, token.conversion_rate)}</div>
                                </div>
                                {getTotalNeuronMaturity() > 0n && (
                                    <div className="balance-item">
                                        <div className="balance-label" style={{ display: 'flex', alignItems: 'center', gap: '6px', justifyContent: 'flex-start' }}>
                                            <span style={{ fontSize: '14px' }}>🌱</span>
                                            Maturity
                                        </div>
                                        <div className="balance-value">{formatAmount(getTotalNeuronMaturity(), token.decimals)}{getUSD(getTotalNeuronMaturity(), token.decimals, token.conversion_rate)}</div>
                                    </div>
                                )}
                                {getTotalDisbursingMaturity() > 0n && (
                                    <div className="balance-item">
                                        <div className="balance-label" style={{ display: 'flex', alignItems: 'center', gap: '6px', justifyContent: 'flex-start' }}>
                                            <span style={{ fontSize: '14px' }}>⏳</span>
                                            Disbursing
                                        </div>
                                        <div className="balance-value" style={{ color: theme.colors.accent }}>{formatAmount(getTotalDisbursingMaturity(), token.decimals)}{getUSD(getTotalDisbursingMaturity(), token.decimals, token.conversion_rate)}</div>
                                    </div>
                                )}
                            </>
                        )}
                        {(rewardAmountOrZero(token, rewardDetailsLoading, hideAvailable) > 0) ? (
                            <div className="balance-item">
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                                    <div className="balance-label" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                        <span style={{ fontSize: '14px' }}>🎁</span>
                                        Rewards
                                    </div>
                                    <button 
                                        onClick={() => handleClaimRewards(token)}
                                        style={{
                                            background: theme.colors.success || theme.colors.accent,
                                            color: theme.colors.primaryBg,
                                            border: 'none',
                                            borderRadius: '6px',
                                            padding: '4px 8px',
                                            cursor: 'pointer',
                                            fontSize: '0.75rem',
                                            fontWeight: '500',
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '4px',
                                            transition: 'all 0.2s ease'
                                        }}
                                        onMouseEnter={(e) => {
                                            e.target.style.background = theme.colors.successHover || theme.colors.accentHover;
                                        }}
                                        onMouseLeave={(e) => {
                                            e.target.style.background = theme.colors.success || theme.colors.accent;
                                        }}
                                    >
                                        <img 
                                            src="grasp-white.png" 
                                            alt="Claim" 
                                            style={{ width: '12px', height: '12px' }}
                                        />
                                        Claim
                                    </button>
                                </div>
                                <div className="balance-value">{formatAmount(rewardAmountOrZero(token, rewardDetailsLoading, hideAvailable), token.decimals)}{getUSD(rewardAmountOrZero(token, rewardDetailsLoading, hideAvailable), token.decimals, token.conversion_rate)}</div>
                            </div>
                        ) : (
                            ((Object.keys(rewardDetailsLoading).length === 0 || (rewardDetailsLoading[token.ledger_canister_id] != null && rewardDetailsLoading[token.ledger_canister_id] < 0))) && (
                                <div className="spinner-container">
                                    <div className="spinner"></div>
                                </div>
                            )
                        )}
                            </>
                        )}
                    </>
                )}
            </div>
            {showDebug && (
                <div className="debug-section">
                    <p>Frontend: {formatAmount(token.balance || 0n, token.decimals)}</p>
                    <p>Backend: {formatAmount(token.balance_backend || 0n, token.decimals)}</p>
                </div>
            )}
            <div className="locks-section">
                {/* Collapsible Locks Header */}
                <div 
                    className="locks-header" 
                    onClick={() => setLocksExpanded(!locksExpanded)}
                    style={{
                        cursor: 'pointer',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '12px 0',
                        borderBottom: `1px solid ${theme.colors.border}`,
                        marginBottom: locksExpanded ? '15px' : '0'
                    }}
                >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontSize: '1rem' }}>🔐</span>
                        {lockDetailsLoading[token.ledger_canister_id] ? (
                            <span style={{ color: theme.colors.mutedText, fontSize: '0.9rem' }}>
                                (Loading...)
                            </span>
                        ) : (
                            <span style={{ color: theme.colors.primaryText, fontWeight: '500' }}>
                                {locks[token.ledger_canister_id]?.length || 0} {locks[token.ledger_canister_id]?.length === 1 ? 'Lock' : 'Locks'} {getTotalLockedAmount() > 0n && (
                                    <span style={{ fontSize: '0.9rem', fontWeight: '600', whiteSpace: 'nowrap' }}>
                                        ({formatAmount(getTotalLockedAmount(), token.decimals)} {token.symbol})
                                    </span>
                                )}
                            </span>
                        )}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <Link 
                            to="/help/sneedlock"
                            onClick={(e) => e.stopPropagation()}
                            style={{
                                color: theme.colors.mutedText,
                                textDecoration: 'none',
                                fontSize: '0.85rem',
                                display: 'flex',
                                alignItems: 'center',
                                padding: '2px 4px',
                                borderRadius: '4px',
                                transition: 'all 0.2s ease'
                            }}
                            onMouseEnter={(e) => {
                                e.target.style.color = theme.colors.accent;
                                e.target.style.background = `${theme.colors.accent}15`;
                            }}
                            onMouseLeave={(e) => {
                                e.target.style.color = theme.colors.mutedText;
                                e.target.style.background = 'transparent';
                            }}
                            title="Learn about Sneed Lock"
                        >
                            ❓
                        </Link>
                        {/* Expand/Collapse Indicator */}
                        <span 
                            style={{ 
                                color: theme.colors.mutedText, 
                                fontSize: '1.2rem',
                                transform: locksExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                                transition: 'transform 0.2s ease'
                            }}
                        >
                            ▼
                        </span>
                    </div>
                </div>

                {/* Collapsible Locks Content */}
                {locksExpanded && (
                    <div>
                        {/* Lock Actions Row */}
                        {!hideButtons && (
                            <div style={{ 
                                display: 'flex', 
                                justifyContent: 'flex-end',
                                gap: '12px', 
                                marginBottom: '15px',
                                paddingBottom: '12px',
                                borderBottom: `1px solid ${theme.colors.border}`
                            }}>
                                {/* Link Button */}
                                <a 
                                    href={getTokenLockUrl(token.ledger_canister_id, locks[token.ledger_canister_id])} 
                                    target="_blank"
                                    style={{
                                        background: theme.colors.accent,
                                        color: theme.colors.primaryBg,
                                        border: 'none',
                                        borderRadius: '6px',
                                        padding: '6px 12px',
                                        cursor: 'pointer',
                                        fontSize: '0.85rem',
                                        fontWeight: '500',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '6px',
                                        transition: 'all 0.2s ease',
                                        textDecoration: 'none'
                                    }}
                                    onMouseEnter={(e) => {
                                        e.target.style.background = theme.colors.accentHover;
                                    }}
                                    onMouseLeave={(e) => {
                                        e.target.style.background = theme.colors.accent;
                                    }}
                                >
                                    <img 
                                        src="link-chain.png" 
                                        alt="Link" 
                                        style={{ width: '14px', height: '14px' }}
                                    />
                                    Link
                                </a>
                                
                                {/* Lock Button */}
                                {token.available > 0n && (
                                    <button
                                        onClick={() => openLockModal(token)}
                                        style={{
                                            background: theme.colors.accent,
                                            color: theme.colors.primaryBg,
                                            border: 'none',
                                            borderRadius: '6px',
                                            padding: '6px 12px',
                                            cursor: 'pointer',
                                            fontSize: '0.85rem',
                                            fontWeight: '500',
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '6px',
                                            transition: 'all 0.2s ease'
                                        }}
                                        onMouseEnter={(e) => {
                                            e.target.style.background = theme.colors.accentHover;
                                        }}
                                        onMouseLeave={(e) => {
                                            e.target.style.background = theme.colors.accent;
                                        }}
                                    >
                                        <img 
                                            src="sneedlock-logo-cropped.png" 
                                            alt="Lock" 
                                            style={{ width: '14px', height: '14px' }}
                                        />
                                        Lock
                                    </button>
                                )}
                            </div>
                        )}
                        {lockDetailsLoading[token.ledger_canister_id] ? (
                            <div className="spinner-container">
                                <div className="spinner"></div>
                            </div>
                        ) : (
                            <>
                                {locks[token.ledger_canister_id] && locks[token.ledger_canister_id].length > 0 ? (
                                    locks[token.ledger_canister_id].map((lock, lockIndex) => (
                                        <div key={lockIndex} className="lock-item">
                                            <div className="lock-details">
                                                <span className="lock-label">Lock ID:</span>
                                                <span className="lock-value">
                                                    {lock.lock_id?.toString()}
                                                    {lock.lock_id && (
                                                        <a 
                                                            href={`/lock/${lock.lock_id.toString()}`}
                                                            style={{
                                                                marginLeft: '8px',
                                                                color: theme.colors.accent,
                                                                textDecoration: 'none',
                                                                fontSize: '12px'
                                                            }}
                                                            onMouseEnter={(e) => e.target.style.textDecoration = 'underline'}
                                                            onMouseLeave={(e) => e.target.style.textDecoration = 'none'}
                                                        >
                                                            🔗 View
                                                        </a>
                                                    )}
                                                </span>
                                            </div>
                                            <div className="lock-details">
                                                <span className="lock-label">Amount:</span>
                                                <span className="lock-value">{formatAmount(lock.amount || 0n, token.decimals)}{getUSD(lock.amount || 0n, token.decimals, token.conversion_rate)}</span>
                                            </div>
                                            <div className="lock-details">
                                                <span className="lock-label">Expires:</span>
                                                <span className="lock-value">{dateToReadable(lock.expiry)}</span>
                                            </div>
                                            <div className="lock-details">
                                                <span className="lock-label">Duration:</span>
                                                <span className="lock-value">
                                                    <LockCountdown expiry={lock.expiry} />
                                                </span>
                                            </div>
                                            {lock.owner && (
                                                <div className="lock-details">
                                                    <span className="lock-label">Owner:</span>
                                                    <span className="lock-value">
                                                        <PrincipalDisplay 
                                                            principal={Principal.fromText(lock.owner)}
                                                            displayInfo={principalDisplayInfo?.get(lock.owner)}
                                                            showCopyButton={true}
                                                            short={true}
                                                            enableContextMenu={true}
                                                            isAuthenticated={isAuthenticated}
                                                            style={{ display: 'inline-flex' }}
                                                        />
                                                    </span>
                                                </div>
                                            )}
                                            {!hideButtons && openTransferTokenLockModal && (
                                                <div style={{
                                                    marginTop: '12px',
                                                    paddingTop: '12px',
                                                    borderTop: `1px solid ${theme.colors.border}`,
                                                    display: 'flex',
                                                    justifyContent: 'center'
                                                }}>
                                                    <button
                                                        onClick={() => openTransferTokenLockModal(lock, token)}
                                                        style={{
                                                            background: theme.colors.accent,
                                                            color: theme.colors.primaryBg,
                                                            border: 'none',
                                                            borderRadius: '6px',
                                                            padding: '8px 16px',
                                                            cursor: 'pointer',
                                                            fontSize: '0.85rem',
                                                            fontWeight: '500',
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            gap: '6px',
                                                            transition: 'all 0.2s ease'
                                                        }}
                                                        onMouseEnter={(e) => {
                                                            e.target.style.background = theme.colors.accentHover;
                                                        }}
                                                        onMouseLeave={(e) => {
                                                            e.target.style.background = theme.colors.accent;
                                                        }}
                                                    >
                                                        <img 
                                                            src="send-inverted.png" 
                                                            alt="Transfer" 
                                                            style={{ width: '14px', height: '14px' }}
                                                        />
                                                        Transfer Ownership
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    ))
                                ) : (
                                    <p style={{ color: theme.colors.mutedText, fontStyle: 'italic', margin: '10px 0' }}>
                                        No locks found
                                    </p>
                                )}
                            </>
                        )}
                    </div>
                )}
            </div>

            {/* Neurons Section - Only for SNS tokens */}
            {isSnsToken && (
                <div className="neurons-section">
                    {/* Collapsible Neurons Header */}
                    <div 
                        className="neurons-header" 
                        onClick={() => setNeuronsExpanded(!neuronsExpanded)}
                        style={{
                            cursor: 'pointer',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            padding: '12px 0',
                            borderBottom: `1px solid ${theme.colors.border}`,
                            marginBottom: neuronsExpanded ? '15px' : '0'
                        }}
                    >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span style={{ fontSize: '1rem' }}>🧠</span>
                            {neuronsLoading ? (
                                <span style={{ color: theme.colors.mutedText, fontSize: '0.9rem' }}>
                                    (Loading...)
                                </span>
                            ) : (
                                <span style={{ color: theme.colors.primaryText, fontWeight: '500' }}>
                                    {neurons.length} {neurons.length === 1 ? 'Neuron' : 'Neurons'} {getTotalNeuronStake() > 0n && (
                                        <span style={{ fontSize: '0.9rem', fontWeight: '600', whiteSpace: 'nowrap' }}>
                                            ({formatAmount(getTotalNeuronStake(), token.decimals)} {token.symbol})
                                        </span>
                                    )}
                                </span>
                            )}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                            <Link 
                                to="/help/neurons"
                                onClick={(e) => e.stopPropagation()}
                                style={{
                                    color: theme.colors.mutedText,
                                    textDecoration: 'none',
                                    fontSize: '0.85rem',
                                    display: 'flex',
                                    alignItems: 'center',
                                    padding: '2px 4px',
                                    borderRadius: '4px',
                                    transition: 'all 0.2s ease'
                                }}
                                onMouseEnter={(e) => {
                                    e.target.style.color = theme.colors.accent;
                                    e.target.style.background = `${theme.colors.accent}15`;
                                }}
                                onMouseLeave={(e) => {
                                    e.target.style.color = theme.colors.mutedText;
                                    e.target.style.background = 'transparent';
                                }}
                                title="Learn about SNS Neurons"
                            >
                                ❓
                            </Link>
                            {/* Expand/Collapse Indicator */}
                            <span 
                                style={{ 
                                    color: theme.colors.mutedText, 
                                    fontSize: '1.2rem',
                                    transform: neuronsExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                                    transition: 'transform 0.2s ease'
                                }}
                            >
                                ▼
                            </span>
                        </div>
                    </div>

                    {/* Collapsible Neurons Content */}
                    {neuronsExpanded && (
                        <div>
                            {neuronsLoading ? (
                                <div className="spinner-container">
                                    <div className="spinner"></div>
                                </div>
                            ) : (
                                <>
                                    {/* Create Neuron Button */}
                                    {(() => {
                                        const canManage = canManageNeuronPrincipals();
                                        const hasBalance = token.available > 0n;
                                        const isDisabled = !hasBalance || !canManage;
                                        const getTitle = () => {
                                            if (!canManage) return `This SNS doesn't allow managing neuron permissions. Neurons created here would be stuck in this wallet.`;
                                            if (!hasBalance) return `You need ${token.symbol} tokens to create a neuron`;
                                            return 'Create a new neuron';
                                        };
                                        
                                        return (
                                            <button
                                                onClick={async () => {
                                                    if (isDisabled) return;
                                                    setShowCreateNeuronDialog(true);
                                                    setCreateNeuronNonce('');
                                                    setCreateNeuronNonceFree(null);
                                                    setCreateNeuronNonceChecking(true);
                                                    const result = await findUnusedNonce();
                                                    if (result) {
                                                        setCreateNeuronNonce(result.nonce.toString());
                                                        setCreateNeuronNonceFree(true);
                                                    }
                                                    setCreateNeuronNonceChecking(false);
                                                }}
                                                disabled={isDisabled}
                                                title={getTitle()}
                                                style={{
                                                    background: !isDisabled ? theme.colors.accent : theme.colors.mutedText,
                                                    color: theme.colors.primaryBg,
                                                    border: 'none',
                                                    borderRadius: '8px',
                                                    padding: '12px 16px',
                                                    cursor: !isDisabled ? 'pointer' : 'not-allowed',
                                                    fontSize: '0.9rem',
                                                    fontWeight: '600',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'center',
                                                    gap: '6px',
                                                    width: '100%',
                                                    marginBottom: !canManage ? '8px' : '16px',
                                                    opacity: !isDisabled ? 1 : 0.6,
                                                    transition: 'opacity 0.2s ease'
                                                }}
                                                onMouseEnter={(e) => { if (!isDisabled) e.target.style.opacity = '0.9' }}
                                                onMouseLeave={(e) => { if (!isDisabled) e.target.style.opacity = '1' }}
                                            >
                                                {!canManage ? '🚫' : '➕'} Create New Neuron
                                            </button>
                                        );
                                    })()}
                                    {/* Warning message when SNS doesn't allow managing neuron permissions */}
                                    {!canManageNeuronPrincipals() && (
                                        <div style={{
                                            background: `${theme.colors.warning}20`,
                                            border: `1px solid ${theme.colors.warning}`,
                                            borderRadius: '6px',
                                            padding: '10px 12px',
                                            marginBottom: '16px',
                                            fontSize: '0.85rem',
                                            color: theme.colors.warning,
                                            display: 'flex',
                                            alignItems: 'flex-start',
                                            gap: '8px'
                                        }}>
                                            <span style={{ fontSize: '1rem' }}>⚠️</span>
                                            <span>
                                                This SNS doesn't allow managing neuron permissions. 
                                                Neurons created here cannot be transferred to other wallets.
                                            </span>
                                        </div>
                                    )}
                                    
                                    {/* Hide empty neurons checkbox */}
                                    {neurons.length > 0 && (
                                        <label style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '8px',
                                            cursor: 'pointer',
                                            color: theme.colors.secondaryText,
                                            fontSize: '0.85rem',
                                            marginBottom: '12px',
                                            userSelect: 'none'
                                        }}>
                                            <input
                                                type="checkbox"
                                                checked={hideEmptyNeurons}
                                                onChange={(e) => setHideEmptyNeurons(e.target.checked)}
                                                style={{ cursor: 'pointer' }}
                                            />
                                            Hide empty neurons
                                        </label>
                                    )}
                                    
                                    {neurons.length > 0 ? (
                                        neurons
                                            .filter(neuron => !hideEmptyNeurons || !isNeuronEmpty(neuron))
                                            .map((neuron, neuronIndex) => {
                                            const neuronIdHex = getNeuronIdHex(neuron);
                                            const isExpanded = expandedNeurons.has(neuronIdHex);
                                            const stake = getNeuronStake(neuron);
                                            const dissolveDelay = getDissolveDelaySeconds(neuron);
                                            const state = getNeuronState(neuron);
                                            
                                            return (
                                                <div 
                                                    key={neuronIdHex || neuronIndex}
                                                    style={{
                                                        marginBottom: '12px',
                                                        border: `1px solid ${theme.colors.border}`,
                                                        borderRadius: '8px',
                                                        overflow: 'hidden'
                                                    }}
                                                >
                                                    {/* Neuron Header */}
                                                    <div
                                                        onClick={() => toggleNeuronExpanded(neuronIdHex)}
                                                        style={{
                                                            cursor: 'pointer',
                                                            padding: '10px 12px',
                                                            background: theme.colors.cardBg,
                                                            display: 'flex',
                                                            justifyContent: 'space-between',
                                                            alignItems: 'center',
                                                            transition: 'background 0.2s ease'
                                                        }}
                                                        onMouseEnter={(e) => {
                                                            e.currentTarget.style.background = theme.colors.hoverBg || theme.colors.secondaryBg;
                                                        }}
                                                        onMouseLeave={(e) => {
                                                            e.currentTarget.style.background = theme.colors.cardBg;
                                                        }}
                                                    >
                                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: 1 }}>
                                                            <div style={{ 
                                                                color: theme.colors.primaryText, 
                                                                fontWeight: '500',
                                                                fontSize: '0.9rem'
                                                            }}>
                                                                Neuron #{neuronIdHex.slice(0, 8)}...
                                                            </div>
                                                            <div style={{ 
                                                                color: theme.colors.accent, 
                                                                fontWeight: '600',
                                                                fontSize: '0.95rem'
                                                            }}>
                                                                {formatAmount(stake, token.decimals)} {token.symbol}
                                                            </div>
                                                        </div>
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                            {/* Permission icons */}
                                                            {identity && getUserPermissionIcons(neuron, identity.getPrincipal().toString()).map((permIcon, idx) => (
                                                                <span 
                                                                    key={idx}
                                                                    style={{ fontSize: '1.2rem', cursor: 'help' }} 
                                                                    title={permIcon.title}
                                                                >
                                                                    {permIcon.icon}
                                                                </span>
                                                            ))}
                                                            
                                                            {/* State icon */}
                                                            <span 
                                                                style={{
                                                                    fontSize: '1.2rem',
                                                                    cursor: 'help'
                                                                }}
                                                                title={state}
                                                            >
                                                                {getStateIcon(state).icon}
                                                            </span>
                                                            
                                                            {/* Expand/collapse indicator */}
                                                            <span 
                                                                style={{ 
                                                                    color: theme.colors.mutedText, 
                                                                    fontSize: '1.2rem',
                                                                    transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                                                                    transition: 'transform 0.2s ease'
                                                                }}
                                                            >
                                                                ▼
                                                            </span>
                                                        </div>
                                                    </div>

                                                    {/* Neuron Details */}
                                                    {isExpanded && (
                                                        <div style={{
                                                            padding: '12px',
                                                            background: theme.colors.primaryBg,
                                                            borderTop: `1px solid ${theme.colors.border}`
                                                        }}>
                                                            {/* Top buttons row - Manage and Send */}
                                                            <div style={{ 
                                                                display: 'flex',
                                                                justifyContent: 'flex-end',
                                                                gap: '8px',
                                                                marginBottom: '12px',
                                                                paddingBottom: '12px',
                                                                borderBottom: `1px solid ${theme.colors.border}`
                                                            }}>
                                                                {/* Manage button - link to detailed neuron page */}
                                                                <a
                                                                    href={`/neuron?neuronid=${neuronIdHex}&sns=${snsRootCanisterId}`}
                                                                    style={{
                                                                        background: theme.colors.secondaryBg,
                                                                        color: theme.colors.primaryText,
                                                                        border: `1px solid ${theme.colors.border}`,
                                                                        borderRadius: '6px',
                                                                        padding: '8px 12px',
                                                                        cursor: 'pointer',
                                                                        fontSize: '0.85rem',
                                                                        fontWeight: '500',
                                                                        textDecoration: 'none',
                                                                        display: 'inline-flex',
                                                                        alignItems: 'center',
                                                                        gap: '6px',
                                                                        transition: 'background 0.2s ease'
                                                                    }}
                                                                    onMouseEnter={(e) => e.target.style.background = theme.colors.border}
                                                                    onMouseLeave={(e) => e.target.style.background = theme.colors.secondaryBg}
                                                                >
                                                                    ⚙️ Manage
                                                                </a>
                                                                
                                                                {/* Send button - transfer neuron to another principal */}
                                                                {userHasPermission(neuron, PERM.MANAGE_PRINCIPALS) && (
                                                                    <button
                                                                        onClick={(e) => {
                                                                            e.stopPropagation();
                                                                            setManagingNeuronId(neuronIdHex);
                                                                            setShowSendNeuronDialog(true);
                                                                        }}
                                                                        disabled={neuronActionBusy && managingNeuronId === neuronIdHex}
                                                                        style={{
                                                                            background: theme.colors.accent,
                                                                            color: theme.colors.primaryBg,
                                                                            border: 'none',
                                                                            borderRadius: '6px',
                                                                            padding: '8px 12px',
                                                                            cursor: neuronActionBusy && managingNeuronId === neuronIdHex ? 'wait' : 'pointer',
                                                                            fontSize: '0.85rem',
                                                                            fontWeight: '500',
                                                                            opacity: neuronActionBusy && managingNeuronId === neuronIdHex ? 0.6 : 1,
                                                                            display: 'flex',
                                                                            alignItems: 'center',
                                                                            gap: '6px'
                                                                        }}
                                                                    >
                                                                        <img 
                                                                            src="send-inverted.png" 
                                                                            alt="Send" 
                                                                            style={{ width: '14px', height: '14px' }}
                                                                        />
                                                                        Send
                                                                    </button>
                                                                )}
                                                            </div>
                                                            
                                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                                                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                                                    <span style={{ color: theme.colors.secondaryText }}>Neuron ID:</span>
                                                                    {snsRootCanisterId && (
                                                                        <NeuronDisplay
                                                                            neuronId={neuronIdHex}
                                                                            snsRoot={snsRootCanisterId}
                                                                            displayInfo={getNeuronDisplayName(neuronIdHex, snsRootCanisterId)}
                                                                            showCopyButton={true}
                                                                            enableContextMenu={true}
                                                                            isAuthenticated={isAuthenticated}
                                                                            style={{ wordBreak: 'break-all' }}
                                                                        />
                                                                    )}
                                                                </div>
                                                                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                                                    <span style={{ color: theme.colors.secondaryText }}>Stake:</span>
                                                                    <span style={{ color: theme.colors.primaryText, fontWeight: '600' }}>
                                                                        {formatAmount(stake, token.decimals)} {token.symbol}
                                                                    </span>
                                                                </div>
                                                                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                                                    <span style={{ color: theme.colors.secondaryText }}>Dissolve Delay:</span>
                                                                    <span style={{ color: theme.colors.primaryText }}>
                                                                        {format_duration(dissolveDelay * 1000)}
                                                                    </span>
                                                                </div>
                                                                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                                                    <span style={{ color: theme.colors.secondaryText }}>State:</span>
                                                                    <span style={{ color: theme.colors.primaryText }}>{state}</span>
                                                                </div>
                                                                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                                                    <span style={{ color: theme.colors.secondaryText }}>Voting Power:</span>
                                                                    <span style={{ color: theme.colors.primaryText }}>
                                                                        {votingPowerCalc ? formatAmount(votingPowerCalc.getVotingPower(neuron), token.decimals) : 'Calculating...'}
                                                                    </span>
                                                                </div>
                                                                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                                                    <span style={{ color: theme.colors.secondaryText }}>Created:</span>
                                                                    <span style={{ color: theme.colors.primaryText }}>
                                                                        {dateToReadable(new Date(Number(neuron.created_timestamp_seconds || 0n) * 1000))}
                                                                    </span>
                                                                </div>
                                                                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                                                    <span style={{ color: theme.colors.secondaryText }}>Age:</span>
                                                                    <span style={{ color: theme.colors.primaryText }}>
                                                                        {format_duration(Date.now() - Number(neuron.aging_since_timestamp_seconds || 0n) * 1000)}
                                                                    </span>
                                                                </div>
                                                                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                                                    <span style={{ color: theme.colors.secondaryText }}>Maturity:</span>
                                                                    <span style={{ color: theme.colors.primaryText, fontWeight: '600' }}>
                                                                        {formatAmount(neuron.maturity_e8s_equivalent || 0n, token.decimals)} {token.symbol}
                                                                    </span>
                                                                </div>
                                                                
                                                                {/* Disbursing Maturity - show if there's maturity in the 7-day vesting period */}
                                                                {neuron.disburse_maturity_in_progress && neuron.disburse_maturity_in_progress.length > 0 && (
                                                                    <div style={{ 
                                                                        marginTop: '8px',
                                                                        padding: '10px',
                                                                        backgroundColor: theme.colors.tertiaryBg,
                                                                        borderRadius: '6px',
                                                                        border: `1px solid ${theme.colors.accent}40`
                                                                    }}>
                                                                        <div style={{ 
                                                                            display: 'flex', 
                                                                            alignItems: 'center', 
                                                                            gap: '6px',
                                                                            marginBottom: '8px',
                                                                            color: theme.colors.accent,
                                                                            fontWeight: '600',
                                                                            fontSize: '0.9rem'
                                                                        }}>
                                                                            <span>⏳</span>
                                                                            <span>Disbursing Maturity</span>
                                                                        </div>
                                                                        {neuron.disburse_maturity_in_progress.map((disbursement, idx) => {
                                                                            const amount = BigInt(disbursement.amount_e8s || 0n);
                                                                            const finalizeTimestamp = disbursement.finalize_disbursement_timestamp_seconds?.[0] || disbursement.finalize_disbursement_timestamp_seconds;
                                                                            const finalizeDate = finalizeTimestamp ? new Date(Number(finalizeTimestamp) * 1000) : null;
                                                                            const now = new Date();
                                                                            const timeRemaining = finalizeDate ? finalizeDate - now : 0;
                                                                            
                                                                            return (
                                                                                <div key={idx} style={{ 
                                                                                    display: 'flex', 
                                                                                    flexDirection: 'column',
                                                                                    gap: '4px',
                                                                                    paddingTop: idx > 0 ? '8px' : '0',
                                                                                    borderTop: idx > 0 ? `1px solid ${theme.colors.border}` : 'none'
                                                                                }}>
                                                                                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                                                                        <span style={{ color: theme.colors.secondaryText, fontSize: '0.85rem' }}>Amount:</span>
                                                                                        <span style={{ color: theme.colors.primaryText, fontWeight: '600', fontSize: '0.85rem' }}>
                                                                                            {formatAmount(amount, token.decimals)} {token.symbol}
                                                                                        </span>
                                                                                    </div>
                                                                                    {finalizeDate && (
                                                                                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                                                                            <span style={{ color: theme.colors.secondaryText, fontSize: '0.85rem' }}>
                                                                                                {timeRemaining > 0 ? 'Arrives in:' : 'Available:'}
                                                                                            </span>
                                                                                            <span style={{ 
                                                                                                color: timeRemaining > 0 ? theme.colors.accent : theme.colors.success, 
                                                                                                fontWeight: '500',
                                                                                                fontSize: '0.85rem'
                                                                                            }}>
                                                                                                {timeRemaining > 0 
                                                                                                    ? format_duration(timeRemaining)
                                                                                                    : 'Ready to claim'
                                                                                                }
                                                                                            </span>
                                                                                        </div>
                                                                                    )}
                                                                                </div>
                                                                            );
                                                                        })}
                                                                    </div>
                                                                )}
                                                                
                                                                {/* Auto-stake Maturity Checkbox */}
                                                                {userHasPermission(neuron, PERM.MANAGE_VOTING_PERMISSION) && (
                                                                    <div style={{ 
                                                                        display: 'flex', 
                                                                        alignItems: 'center',
                                                                        gap: '8px',
                                                                        marginTop: '12px',
                                                                        padding: '12px',
                                                                        backgroundColor: theme.colors.tertiaryBg,
                                                                        borderRadius: '6px'
                                                                    }}>
                                                                        <input
                                                                            type="checkbox"
                                                                            id={`auto-stake-${neuronIdHex}`}
                                                                            checked={neuron.auto_stake_maturity?.[0] || false}
                                                                            onChange={() => toggleAutoStakeMaturity(neuronIdHex, neuron.auto_stake_maturity?.[0] || false)}
                                                                            disabled={neuronActionBusy && managingNeuronId === neuronIdHex}
                                                                            style={{
                                                                                cursor: neuronActionBusy && managingNeuronId === neuronIdHex ? 'wait' : 'pointer',
                                                                                width: '18px',
                                                                                height: '18px'
                                                                            }}
                                                                        />
                                                                        <label 
                                                                            htmlFor={`auto-stake-${neuronIdHex}`}
                                                                            style={{ 
                                                                                color: theme.colors.primaryText,
                                                                                cursor: neuronActionBusy && managingNeuronId === neuronIdHex ? 'wait' : 'pointer',
                                                                                userSelect: 'none',
                                                                                fontSize: '0.95rem'
                                                                            }}
                                                                        >
                                                                            Automatically stake new maturity
                                                                        </label>
                                                                    </div>
                                                                )}
                                                                            </div>

                                                                            {/* Action Buttons */}
                                                                            {identity && (
                                                                                <div style={{ 
                                                                                    marginTop: '16px', 
                                                                                    paddingTop: '12px',
                                                                                    borderTop: `1px solid ${theme.colors.border}`,
                                                                                    display: 'flex',
                                                                                    gap: '8px',
                                                                                    flexWrap: 'wrap'
                                                                                }}>
                                                                                    {/* Dissolve state buttons */}
                                                                                    {userHasPermission(neuron, PERM.CONFIGURE_DISSOLVE_STATE) && (
                                                                                        <>
                                                                                            {state === 'Locked' && (
                                                                                                <button
                                                                                                    onClick={() => startDissolving(neuronIdHex)}
                                                                                                    disabled={neuronActionBusy && managingNeuronId === neuronIdHex}
                                                                                                    style={{
                                                                                                        background: theme.colors.warning,
                                                                                                        color: theme.colors.primaryBg,
                                                                                                        border: 'none',
                                                                                                        borderRadius: '6px',
                                                                                                        padding: '8px 12px',
                                                                                                        cursor: neuronActionBusy && managingNeuronId === neuronIdHex ? 'wait' : 'pointer',
                                                                                                        fontSize: '0.85rem',
                                                                                                        fontWeight: '500',
                                                                                                        opacity: neuronActionBusy && managingNeuronId === neuronIdHex ? 0.6 : 1
                                                                                                    }}
                                                                                                >
                                                                                                    ⏳ Start Dissolving
                                                                                                </button>
                                                                                            )}
                                                                                            {state === 'Dissolving' && (
                                                                                                <button
                                                                                                    onClick={() => stopDissolving(neuronIdHex)}
                                                                                                    disabled={neuronActionBusy && managingNeuronId === neuronIdHex}
                                                                                                    style={{
                                                                                                        background: theme.colors.success,
                                                                                                        color: theme.colors.primaryBg,
                                                                                                        border: 'none',
                                                                                                        borderRadius: '6px',
                                                                                                        padding: '8px 12px',
                                                                                                        cursor: neuronActionBusy && managingNeuronId === neuronIdHex ? 'wait' : 'pointer',
                                                                                                        fontSize: '0.85rem',
                                                                                                        fontWeight: '500',
                                                                                                        opacity: neuronActionBusy && managingNeuronId === neuronIdHex ? 0.6 : 1
                                                                                                    }}
                                                                                                >
                                                                                                    🔒 Stop Dissolving
                                                                                                </button>
                                                                                            )}
                                                                                            {state !== 'Dissolved' && (
                                                                                                <button
                                                                                                    onClick={() => {
                                                                                                        setManagingNeuronId(neuronIdHex);
                                                                                                        setShowDissolveDelayDialog(true);
                                                                                                    }}
                                                                                                    disabled={neuronActionBusy && managingNeuronId === neuronIdHex}
                                                                                                    style={{
                                                                                                        background: theme.colors.accent,
                                                                                                        color: theme.colors.primaryBg,
                                                                                                        border: 'none',
                                                                                                        borderRadius: '6px',
                                                                                                        padding: '8px 12px',
                                                                                                        cursor: neuronActionBusy && managingNeuronId === neuronIdHex ? 'wait' : 'pointer',
                                                                                                        fontSize: '0.85rem',
                                                                                                        fontWeight: '500',
                                                                                                        opacity: neuronActionBusy && managingNeuronId === neuronIdHex ? 0.6 : 1
                                                                                                    }}
                                                                                                >
                                                                                                    ⏱️ {dissolveDelay > 0 ? 'Increase' : 'Set'} Dissolve Delay
                                                                                                </button>
                                                                                            )}
                                                                                        </>
                                                                                    )}

                                                                                    {/* Disburse button */}
                                                                                    {state === 'Dissolved' && userHasPermission(neuron, PERM.DISBURSE) && (
                                                                                        <button
                                                                                            onClick={() => {
                                                                                                if (window.confirm('Are you sure you want to disburse this neuron? The tokens will be transferred to your wallet.')) {
                                                                                                    disburseNeuron(neuronIdHex);
                                                                                                }
                                                                                            }}
                                                                                            disabled={neuronActionBusy && managingNeuronId === neuronIdHex}
                                                                                            style={{
                                                                                                background: theme.colors.error,
                                                                                                color: theme.colors.primaryBg,
                                                                                                border: 'none',
                                                                                                borderRadius: '6px',
                                                                                                padding: '8px 12px',
                                                                                                cursor: neuronActionBusy && managingNeuronId === neuronIdHex ? 'wait' : 'pointer',
                                                                                                fontSize: '0.85rem',
                                                                                                fontWeight: '500',
                                                                                                opacity: neuronActionBusy && managingNeuronId === neuronIdHex ? 0.6 : 1
                                                                                            }}
                                                                                        >
                                                                                            💰 Disburse to Wallet
                                                                                        </button>
                                                                                    )}

                                                                                    {/* Disburse Maturity button - when neuron has maturity */}
                                                                                    {(neuron.maturity_e8s_equivalent || 0n) > 0n && userHasPermission(neuron, PERM.DISBURSE_MATURITY) && (
                                                                                        <button
                                                                                            onClick={() => {
                                                                                                if (window.confirm(`Disburse ${formatAmount(neuron.maturity_e8s_equivalent, token.decimals)} ${token.symbol} maturity to your wallet?`)) {
                                                                                                    disburseMaturity(neuronIdHex);
                                                                                                }
                                                                                            }}
                                                                                            disabled={neuronActionBusy && managingNeuronId === neuronIdHex}
                                                                                            style={{
                                                                                                background: theme.colors.accent,
                                                                                                color: theme.colors.primaryBg,
                                                                                                border: 'none',
                                                                                                borderRadius: '6px',
                                                                                                padding: '8px 12px',
                                                                                                cursor: neuronActionBusy && managingNeuronId === neuronIdHex ? 'wait' : 'pointer',
                                                                                                fontSize: '0.85rem',
                                                                                                fontWeight: '500',
                                                                                                opacity: neuronActionBusy && managingNeuronId === neuronIdHex ? 0.6 : 1
                                                                                            }}
                                                                                        >
                                                                                            ✨ Disburse Maturity
                                                                                        </button>
                                                                                    )}

                                                                                    {/* Increase Stake button - available to everyone */}
                                                                                    {token.available > 0n && (
                                                                                        <button
                                                                                            onClick={() => {
                                                                                                setManagingNeuronId(neuronIdHex);
                                                                                                setShowIncreaseStakeDialog(true);
                                                                                            }}
                                                                                            disabled={neuronActionBusy && managingNeuronId === neuronIdHex}
                                                                                            style={{
                                                                                                background: theme.colors.success,
                                                                                                color: theme.colors.primaryBg,
                                                                                                border: 'none',
                                                                                                borderRadius: '6px',
                                                                                                padding: '8px 12px',
                                                                                                cursor: neuronActionBusy && managingNeuronId === neuronIdHex ? 'wait' : 'pointer',
                                                                                                fontSize: '0.85rem',
                                                                                                fontWeight: '500',
                                                                                                opacity: neuronActionBusy && managingNeuronId === neuronIdHex ? 0.6 : 1
                                                                                            }}
                                                                                        >
                                                                                            ➕ Increase Stake
                                                                                        </button>
                                                                                    )}
                                                                                    
                                                                                    {/* Split button - requires MANAGE_PRINCIPALS permission and stake > minimum */}
                                                                                    {stake > 0n && userHasPermission(neuron, PERM.MANAGE_PRINCIPALS) && (
                                                                                        <button
                                                                                            onClick={() => {
                                                                                                setManagingNeuronId(neuronIdHex);
                                                                                                setShowSplitNeuronDialog(true);
                                                                                            }}
                                                                                            disabled={neuronActionBusy && managingNeuronId === neuronIdHex}
                                                                                            style={{
                                                                                                background: theme.colors.accent,
                                                                                                color: theme.colors.primaryBg,
                                                                                                border: 'none',
                                                                                                borderRadius: '6px',
                                                                                                padding: '8px 12px',
                                                                                                cursor: neuronActionBusy && managingNeuronId === neuronIdHex ? 'wait' : 'pointer',
                                                                                                fontSize: '0.85rem',
                                                                                                fontWeight: '500',
                                                                                                opacity: neuronActionBusy && managingNeuronId === neuronIdHex ? 0.6 : 1
                                                                                            }}
                                                                                        >
                                                                                            ✂️ Split Neuron
                                                                                        </button>
                                                                                    )}
                                                                                </div>
                                                                            )}
                                                                        </div>
                                                                    )}
                                                </div>
                                            );
                                        })
                                    ) : (
                                        <p style={{ color: theme.colors.mutedText, fontStyle: 'italic', margin: '10px 0' }}>
                                            No neurons found
                                        </p>
                                    )}
                                </>
                            )}
                        </div>
                    )}
                </div>
            )}

            {/* Token Info Section */}
            <div className="info-section">
                {/* Collapsible Info Header */}
                <div 
                    className="info-header" 
                    onClick={() => setInfoExpanded(!infoExpanded)}
                    style={{
                        cursor: 'pointer',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '12px 0',
                        borderBottom: `1px solid ${theme.colors.border}`,
                        marginBottom: infoExpanded ? '15px' : '0'
                    }}
                >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ color: theme.colors.primaryText, fontWeight: '500' }}>
                            ℹ️ Token Info
                        </span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        {/* Expand/Collapse Indicator */}
                        <span 
                            style={{ 
                                color: theme.colors.mutedText, 
                                fontSize: '1.2rem',
                                transform: infoExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                                transition: 'transform 0.2s ease'
                            }}
                        >
                            ▼
                        </span>
                    </div>
                </div>

                {/* Collapsible Info Content */}
                {infoExpanded && (
                    <div style={{ paddingBottom: '15px' }}>
                        {/* Ledger Canister ID */}
                        <div style={{
                            padding: '10px 0',
                            borderBottom: `1px solid ${theme.colors.border}`
                        }}>
                            <div style={{ 
                                color: theme.colors.mutedText, 
                                fontSize: '0.9rem',
                                marginBottom: '6px'
                            }}>
                                Ledger Canister:
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <span style={{ 
                                    color: theme.colors.primaryText, 
                                    fontSize: '0.9rem',
                                    fontFamily: 'monospace',
                                    wordBreak: 'break-all'
                                }}>
                                    {token.ledger_canister_id?.toString?.() || token.ledger_canister_id || 'N/A'}
                                </span>
                                {token.ledger_canister_id && (
                                    <button
                                        onClick={() => {
                                            navigator.clipboard.writeText(
                                                token.ledger_canister_id?.toString?.() || token.ledger_canister_id
                                            );
                                        }}
                                        style={{
                                            background: 'transparent',
                                            border: 'none',
                                            cursor: 'pointer',
                                            padding: '4px',
                                            color: theme.colors.accent,
                                            fontSize: '0.9rem',
                                            flexShrink: 0
                                        }}
                                        title="Copy to clipboard"
                                    >
                                        📋
                                    </button>
                                )}
                            </div>
                        </div>

                        {/* Decimals */}
                        <div style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            padding: '10px 0',
                            borderBottom: `1px solid ${theme.colors.border}`
                        }}>
                            <span style={{ color: theme.colors.mutedText, fontSize: '0.9rem' }}>
                                Decimals:
                            </span>
                            <span style={{ color: theme.colors.primaryText, fontSize: '0.9rem' }}>
                                {token.decimals ?? 'N/A'}
                            </span>
                        </div>

                        {/* Fee */}
                        <div style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            padding: '10px 0',
                            borderBottom: `1px solid ${theme.colors.border}`
                        }}>
                            <span style={{ color: theme.colors.mutedText, fontSize: '0.9rem' }}>
                                Transfer Fee:
                            </span>
                            <span style={{ color: theme.colors.primaryText, fontSize: '0.9rem' }}>
                                {token.fee !== undefined ? formatAmount(token.fee, token.decimals) + ' ' + token.symbol : 'N/A'}
                            </span>
                        </div>

                        {/* Name */}
                        <div style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            padding: '10px 0',
                            borderBottom: `1px solid ${theme.colors.border}`
                        }}>
                            <span style={{ color: theme.colors.mutedText, fontSize: '0.9rem' }}>
                                Name:
                            </span>
                            <span style={{ color: theme.colors.primaryText, fontSize: '0.9rem' }}>
                                {token.name || token.symbol || 'N/A'}
                            </span>
                        </div>

                        {/* Symbol */}
                        <div style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            padding: '10px 0',
                            borderBottom: `1px solid ${theme.colors.border}`
                        }}>
                            <span style={{ color: theme.colors.mutedText, fontSize: '0.9rem' }}>
                                Symbol:
                            </span>
                            <span style={{ color: theme.colors.primaryText, fontSize: '0.9rem' }}>
                                {token.symbol || 'N/A'}
                            </span>
                        </div>

                        {/* Conversion Rate */}
                        {token.conversion_rate > 0 && (
                            <>
                                <div style={{
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'center',
                                    padding: '10px 0',
                                    borderBottom: `1px solid ${theme.colors.border}`
                                }}>
                                    <span style={{ color: theme.colors.mutedText, fontSize: '0.9rem' }}>
                                        USD Price:
                                    </span>
                                    <span style={{ color: theme.colors.primaryText, fontSize: '0.9rem' }}>
                                        ${token.conversion_rate.toFixed(6)}
                                    </span>
                                </div>
                                {token.icp_rate > 0 && (
                                    <div style={{
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center',
                                        padding: '10px 0',
                                        borderBottom: `1px solid ${theme.colors.border}`
                                    }}>
                                        <span style={{ color: theme.colors.mutedText, fontSize: '0.9rem' }}>
                                            ICP Price:
                                        </span>
                                        <span style={{ color: theme.colors.primaryText, fontSize: '0.9rem' }}>
                                            {token.icp_rate.toFixed(6)} ICP
                                        </span>
                                    </div>
                                )}
                            </>
                        )}

                        {/* Standard */}
                        {token.standard && (
                            <div style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                padding: '10px 0',
                                borderBottom: `1px solid ${theme.colors.border}`
                            }}>
                                <span style={{ color: theme.colors.mutedText, fontSize: '0.9rem' }}>
                                    Standard:
                                </span>
                                <span style={{ color: theme.colors.primaryText, fontSize: '0.9rem' }}>
                                    {token.standard}
                                </span>
                            </div>
                        )}
                    </div>
                )}
            </div>
            
            {/* Wrap/Unwrap buttons at bottom of card */}
            {(() => {
                const ledgerIdText = token.ledger_canister_id?.toText?.() || token.ledger_canister_id;
                const isGLDT = ledgerIdText === GLDT_CANISTER_ID;
                const isSGLDT = ledgerIdText === SGLDT_CANISTER_ID;
                
                /*console.log(`Wrap/Unwrap button check for ${token.symbol}:`, {
                    ledger_id_text: ledgerIdText,
                    isGLDT,
                    isSGLDT,
                    available: token.available?.toString(),
                    hasAvailable: token.available > 0n
                });*/
                
                if ((isGLDT || isSGLDT) && token.available > 0n && !hideButtons) {
                    return (
                        <div className="wrap-unwrap-section" style={{ marginTop: '10px', padding: '10px 0', borderTop: `1px solid ${theme.colors.border}` }}>
                            {isGLDT && (
                                <button 
                                    className="wrap-button-full" 
                                    onClick={() => openWrapModal(token)}
                                    style={{
                                        width: '100%',
                                        padding: '8px 16px',
                                        background: theme.colors.success,
                                        color: theme.colors.primaryBg,
                                        border: 'none',
                                        borderRadius: '4px',
                                        cursor: 'pointer',
                                        fontSize: '14px',
                                        fontWeight: 'bold'
                                    }}
                                >
                                    Wrap to sGLDT
                                </button>
                            )}
                            {isSGLDT && (
                                <button 
                                    className="unwrap-button-full" 
                                    onClick={() => openUnwrapModal(token)}
                                    style={{
                                        width: '100%',
                                        padding: '8px 16px',
                                        background: theme.colors.warning,
                                        color: theme.colors.primaryBg,
                                        border: 'none',
                                        borderRadius: '4px',
                                        cursor: 'pointer',
                                        fontSize: '14px',
                                        fontWeight: 'bold'
                                    }}
                                >
                                    Unwrap to GLDT
                                </button>
                            )}
                        </div>
                    );
                }
                return null;
            })()}
                </>
            )}

            {/* Dissolve Delay Dialog */}
            {showDissolveDelayDialog && (() => {
                const currentNeuron = neurons.find(n => getNeuronIdHex(n) === managingNeuronId);
                const currentDelaySeconds = currentNeuron ? getDissolveDelaySeconds(currentNeuron) : 0;
                const isIncreasing = currentDelaySeconds > 0;
                
                // Get min and max from nervous system parameters
                const minDelaySeconds = nervousSystemParameters?.neuron_minimum_dissolve_delay_to_vote_seconds?.[0] 
                    ? Number(nervousSystemParameters.neuron_minimum_dissolve_delay_to_vote_seconds[0]) 
                    : 0;
                const maxDelaySeconds = nervousSystemParameters?.max_dissolve_delay_seconds?.[0]
                    ? Number(nervousSystemParameters.max_dissolve_delay_seconds[0])
                    : 0;
                
                const minDelayDays = Math.ceil(minDelaySeconds / (24 * 60 * 60));
                const maxDelayDays = Math.floor(maxDelaySeconds / (24 * 60 * 60));
                const currentDelayDays = Math.floor(currentDelaySeconds / (24 * 60 * 60));
                const maxAdditionalDays = isIncreasing ? maxDelayDays - currentDelayDays : maxDelayDays;
                
                return (
                    <div style={{
                        position: 'fixed',
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        background: 'rgba(0, 0, 0, 0.7)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        zIndex: 1000
                    }}
                    onClick={() => {
                        if (!neuronActionBusy) {
                            setShowDissolveDelayDialog(false);
                            setDissolveDelayInput('');
                            setManagingNeuronId(null);
                        }
                    }}
                    >
                        <div style={{
                            background: theme.colors.primaryBg,
                            borderRadius: '12px',
                            padding: '24px',
                            maxWidth: '500px',
                            width: '90%',
                            boxShadow: '0 4px 20px rgba(0,0,0,0.3)'
                        }}
                        onClick={(e) => e.stopPropagation()}
                        >
                            <h3 style={{ color: theme.colors.primaryText, marginTop: 0 }}>
                                ⏱️ {isIncreasing ? 'Increase' : 'Set'} Dissolve Delay
                            </h3>
                            
                            {isIncreasing && (
                                <p style={{ color: theme.colors.secondaryText, fontSize: '0.9rem', marginBottom: '8px' }}>
                                    Current delay: <strong>{currentDelayDays} days</strong>
                                </p>
                            )}
                            
                            <p style={{ color: theme.colors.secondaryText, marginBottom: '8px' }}>
                                Enter the number of days to {isIncreasing ? 'increase' : 'set'} the dissolve delay:
                            </p>
                            
                            {maxDelayDays > 0 && (
                                <p style={{ color: theme.colors.mutedText, fontSize: '0.85rem', marginBottom: '16px' }}>
                                    {isIncreasing ? (
                                        <>Min: <strong>0 days</strong> • Max additional: <strong>{maxAdditionalDays} days</strong></>
                                    ) : (
                                        <>Min for voting power: <strong>{minDelayDays} days</strong> • Max: <strong>{maxDelayDays} days</strong></>
                                    )}
                                </p>
                            )}
                            
                            <input
                                type="number"
                                value={dissolveDelayInput}
                                onChange={(e) => setDissolveDelayInput(e.target.value)}
                                placeholder={`Days (e.g., ${isIncreasing ? Math.min(180, maxAdditionalDays) : Math.min(180, maxDelayDays)})`}
                                min="0"
                                max={maxAdditionalDays > 0 ? maxAdditionalDays : undefined}
                                disabled={neuronActionBusy}
                                style={{
                                    width: '100%',
                                    padding: '12px',
                                    borderRadius: '6px',
                                    border: `1px solid ${theme.colors.border}`,
                                    background: theme.colors.secondaryBg,
                                    color: theme.colors.primaryText,
                                    fontSize: '1rem',
                                    marginBottom: '20px'
                                }}
                            />
                            
                            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
                                <button
                                    onClick={() => {
                                        setShowDissolveDelayDialog(false);
                                        setDissolveDelayInput('');
                                        setManagingNeuronId(null);
                                    }}
                                    disabled={neuronActionBusy}
                                    style={{
                                        background: theme.colors.secondaryBg,
                                        color: theme.colors.primaryText,
                                        border: 'none',
                                        borderRadius: '6px',
                                        padding: '10px 20px',
                                        cursor: neuronActionBusy ? 'wait' : 'pointer',
                                        fontSize: '0.9rem',
                                        fontWeight: '500'
                                    }}
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={() => {
                                        const days = parseInt(dissolveDelayInput);
                                        if (isNaN(days) || days < 0) {
                                            alert('Please enter a valid number of days');
                                            return;
                                        }
                                        if (maxAdditionalDays > 0 && days > maxAdditionalDays) {
                                            alert(`Maximum ${isIncreasing ? 'additional' : ''} dissolve delay is ${maxAdditionalDays} days`);
                                            return;
                                        }
                                        const seconds = days * 24 * 60 * 60;
                                        increaseDissolveDelay(managingNeuronId, seconds);
                                    }}
                                    disabled={neuronActionBusy || !dissolveDelayInput}
                                    style={{
                                        background: theme.colors.accent,
                                        color: theme.colors.primaryBg,
                                        border: 'none',
                                        borderRadius: '6px',
                                        padding: '10px 20px',
                                        cursor: (neuronActionBusy || !dissolveDelayInput) ? 'not-allowed' : 'pointer',
                                        fontSize: '0.9rem',
                                        fontWeight: '500',
                                        opacity: (neuronActionBusy || !dissolveDelayInput) ? 0.6 : 1
                                    }}
                                >
                                    {neuronActionBusy ? 'Processing...' : 'Confirm'}
                                </button>
                            </div>
                        </div>
                    </div>
                );
            })()}

            {/* Increase Stake Dialog */}
            {showIncreaseStakeDialog && (() => {
                // Get frontend balance (not including backend tokens)
                const maxAvailable = token.balance || 0n;
                const tokenFee = token.fee || 10000n; // Default 0.0001 for 8 decimals
                const maxStakeAmount = maxAvailable > tokenFee ? maxAvailable - tokenFee : 0n;
                
                return (
                    <div style={{
                        position: 'fixed',
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        background: 'rgba(0, 0, 0, 0.7)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        zIndex: 1000
                    }}
                    onClick={() => {
                        if (!neuronActionBusy) {
                            setShowIncreaseStakeDialog(false);
                            setIncreaseStakeAmount('');
                            setManagingNeuronId(null);
                        }
                    }}
                    >
                        <div style={{
                            background: theme.colors.primaryBg,
                            borderRadius: '12px',
                            padding: '24px',
                            maxWidth: '500px',
                            width: '90%',
                            boxShadow: '0 4px 20px rgba(0,0,0,0.3)'
                        }}
                        onClick={(e) => e.stopPropagation()}
                        >
                            <h3 style={{ color: theme.colors.primaryText, marginTop: 0 }}>
                                ➕ Increase Neuron Stake
                            </h3>
                            
                            <p style={{ color: theme.colors.secondaryText, marginBottom: '8px' }}>
                                Enter the amount of {token.symbol} to add to this neuron:
                            </p>
                            
                            <p style={{ color: theme.colors.mutedText, fontSize: '0.85rem', marginBottom: '16px' }}>
                                Available in wallet: <strong>{formatAmount(maxAvailable, token.decimals)} {token.symbol}</strong>
                            </p>
                            
                            <div style={{ position: 'relative', marginBottom: '8px', display: 'flex', alignItems: 'center' }}>
                                <input
                                    type="text"
                                    value={increaseStakeAmount}
                                    onChange={(e) => {
                                        const value = e.target.value;
                                        // Allow numbers and one decimal point
                                        if (value === '' || /^\d*\.?\d*$/.test(value)) {
                                            setIncreaseStakeAmount(value);
                                        }
                                    }}
                                    placeholder={`Amount (e.g., ${formatAmount(maxStakeAmount / 2n, token.decimals)})`}
                                    disabled={neuronActionBusy}
                                    style={{
                                        flex: 1,
                                        minWidth: 0,
                                        padding: '12px',
                                        borderRadius: '6px',
                                        border: `1px solid ${theme.colors.border}`,
                                        background: theme.colors.secondaryBg,
                                        color: theme.colors.primaryText,
                                        fontSize: '1rem',
                                        boxSizing: 'border-box'
                                    }}
                                />
                                <button
                                    onClick={() => {
                                        setIncreaseStakeAmount(formatAmount(maxStakeAmount, token.decimals));
                                    }}
                                    disabled={neuronActionBusy}
                                    style={{
                                        marginLeft: '8px',
                                        background: theme.colors.accent,
                                        color: theme.colors.primaryBg,
                                        border: 'none',
                                        borderRadius: '4px',
                                        padding: '8px 16px',
                                        cursor: neuronActionBusy ? 'wait' : 'pointer',
                                        fontSize: '0.8rem',
                                        fontWeight: '600',
                                        flexShrink: 0,
                                        whiteSpace: 'nowrap'
                                    }}
                                >
                                    MAX
                                </button>
                            </div>
                            
                            <div style={{ 
                                background: theme.colors.secondaryBg,
                                borderRadius: '6px',
                                padding: '12px',
                                marginBottom: '20px'
                            }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                                    <span style={{ color: theme.colors.secondaryText, fontSize: '0.9rem' }}>Transaction Fee:</span>
                                    <span style={{ color: theme.colors.primaryText, fontSize: '0.9rem' }}>
                                        {formatAmount(tokenFee, token.decimals)} {token.symbol}
                                    </span>
                                </div>
                                <div style={{ 
                                    display: 'flex', 
                                    justifyContent: 'space-between', 
                                    paddingTop: '8px',
                                    borderTop: `1px solid ${theme.colors.border}`
                                }}>
                                    <span style={{ color: theme.colors.primaryText, fontSize: '1rem', fontWeight: '600' }}>Total:</span>
                                    <span style={{ color: theme.colors.accent, fontSize: '1rem', fontWeight: '600' }}>
                                        {increaseStakeAmount ? 
                                            (() => {
                                                try {
                                                    const stakeFloat = parseFloat(increaseStakeAmount);
                                                    const stakeE8s = BigInt(Math.floor(stakeFloat * Math.pow(10, token.decimals)));
                                                    const total = stakeE8s + tokenFee;
                                                    return `${formatAmount(total, token.decimals)} ${token.symbol}`;
                                                } catch {
                                                    return '—';
                                                }
                                            })()
                                            : '—'
                                        }
                                    </span>
                                </div>
                            </div>
                            
                            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
                                <button
                                    onClick={() => {
                                        setShowIncreaseStakeDialog(false);
                                        setIncreaseStakeAmount('');
                                        setManagingNeuronId(null);
                                    }}
                                    disabled={neuronActionBusy}
                                    style={{
                                        background: theme.colors.secondaryBg,
                                        color: theme.colors.primaryText,
                                        border: 'none',
                                        borderRadius: '6px',
                                        padding: '10px 20px',
                                        cursor: neuronActionBusy ? 'wait' : 'pointer',
                                        fontSize: '0.9rem',
                                        fontWeight: '500'
                                    }}
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={() => {
                                        try {
                                            const stakeFloat = parseFloat(increaseStakeAmount);
                                            if (isNaN(stakeFloat) || stakeFloat <= 0) {
                                                alert('Please enter a valid amount');
                                                return;
                                            }
                                            const stakeE8s = BigInt(Math.floor(stakeFloat * Math.pow(10, token.decimals)));
                                            const total = stakeE8s + tokenFee;
                                            if (total > maxAvailable) {
                                                alert(`Insufficient balance. You need ${formatAmount(total, token.decimals)} ${token.symbol} (including fee) but only have ${formatAmount(maxAvailable, token.decimals)} ${token.symbol}`);
                                                return;
                                            }
                                            increaseNeuronStake(managingNeuronId, stakeE8s);
                                        } catch (error) {
                                            alert('Invalid amount entered');
                                        }
                                    }}
                                    disabled={neuronActionBusy || !increaseStakeAmount}
                                    style={{
                                        background: theme.colors.success,
                                        color: theme.colors.primaryBg,
                                        border: 'none',
                                        borderRadius: '6px',
                                        padding: '10px 20px',
                                        cursor: (neuronActionBusy || !increaseStakeAmount) ? 'not-allowed' : 'pointer',
                                        fontSize: '0.9rem',
                                        fontWeight: '500',
                                        opacity: (neuronActionBusy || !increaseStakeAmount) ? 0.6 : 1
                                    }}
                                >
                                    {neuronActionBusy ? 'Processing...' : 'Confirm'}
                                </button>
                            </div>
                        </div>
                    </div>
                );
            })()}

            {/* Split Neuron Dialog */}
            {showSplitNeuronDialog && (() => {
                // Get the neuron being managed
                const neuron = neurons.find(n => {
                    const neuronIdBytes = n.id?.[0]?.id;
                    if (!neuronIdBytes) return false;
                    const neuronIdHex = Array.from(new Uint8Array(neuronIdBytes))
                        .map(b => b.toString(16).padStart(2, '0'))
                        .join('');
                    return neuronIdHex === managingNeuronId;
                });

                if (!neuron) return null;

                const stake = BigInt(neuron.cached_neuron_stake_e8s || 0n);
                const minStakeE8s = nervousSystemParameters?.neuron_minimum_stake_e8s?.[0] || 0n;
                const transactionFeeE8s = nervousSystemParameters?.transaction_fee_e8s?.[0] || 0n;
                
                // Minimum split = minimum stake + transaction fee
                const minSplitAmount = minStakeE8s + transactionFeeE8s;
                
                // The new neuron needs minimum stake + fee, and the original must retain at least minimum stake + fee
                const maxSplitAmount = stake > (minStakeE8s + minSplitAmount) ? stake - minStakeE8s : 0n;
                
                return (
                    <div style={{
                        position: 'fixed',
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        background: 'rgba(0, 0, 0, 0.7)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        zIndex: 1000
                    }}
                    onClick={() => {
                        if (!neuronActionBusy) {
                            setShowSplitNeuronDialog(false);
                            setSplitNeuronAmount('');
                            setManagingNeuronId(null);
                        }
                    }}
                    >
                        <div style={{
                            background: theme.colors.primaryBg,
                            borderRadius: '12px',
                            padding: '24px',
                            maxWidth: '500px',
                            width: '90%',
                            boxShadow: '0 4px 20px rgba(0,0,0,0.3)'
                        }}
                        onClick={(e) => e.stopPropagation()}
                        >
                            <h3 style={{ color: theme.colors.primaryText, marginTop: 0 }}>
                                ✂️ Split Neuron
                            </h3>
                            
                            <p style={{ color: theme.colors.secondaryText, marginBottom: '8px' }}>
                                Enter the amount of {token.symbol} to split into a new neuron:
                            </p>
                            
                            <div style={{ 
                                background: theme.colors.secondaryBg,
                                borderRadius: '6px',
                                padding: '12px',
                                marginBottom: '16px'
                            }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                                    <span style={{ color: theme.colors.secondaryText, fontSize: '0.85rem' }}>Current Stake:</span>
                                    <span style={{ color: theme.colors.primaryText, fontSize: '0.85rem', fontWeight: '600' }}>
                                        {formatAmount(stake, token.decimals)} {token.symbol}
                                    </span>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                                    <span style={{ color: theme.colors.secondaryText, fontSize: '0.85rem' }}>Minimum Stake Required:</span>
                                    <span style={{ color: theme.colors.primaryText, fontSize: '0.85rem' }}>
                                        {formatAmount(minStakeE8s, token.decimals)} {token.symbol}
                                    </span>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                                    <span style={{ color: theme.colors.secondaryText, fontSize: '0.85rem' }}>Transaction Fee:</span>
                                    <span style={{ color: theme.colors.primaryText, fontSize: '0.85rem' }}>
                                        {formatAmount(transactionFeeE8s, token.decimals)} {token.symbol}
                                    </span>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                                    <span style={{ color: theme.colors.secondaryText, fontSize: '0.85rem' }}>Minimum Split Amount:</span>
                                    <span style={{ color: theme.colors.primaryText, fontSize: '0.85rem', fontWeight: '600' }}>
                                        {formatAmount(minSplitAmount, token.decimals)} {token.symbol}
                                    </span>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                    <span style={{ color: theme.colors.secondaryText, fontSize: '0.85rem' }}>Maximum Split Amount:</span>
                                    <span style={{ color: theme.colors.accent, fontSize: '0.85rem', fontWeight: '600' }}>
                                        {formatAmount(maxSplitAmount, token.decimals)} {token.symbol}
                                    </span>
                                </div>
                            </div>
                            
                            <p style={{ color: theme.colors.mutedText, fontSize: '0.85rem', marginBottom: '16px' }}>
                                The split amount will be moved to a new neuron. The split amount must include the transaction fee. Both the original and new neuron must retain at least the minimum stake.
                            </p>
                            
                            <div style={{ position: 'relative', marginBottom: '20px', display: 'flex', alignItems: 'center' }}>
                                <input
                                    type="text"
                                    value={splitNeuronAmount}
                                    onChange={(e) => {
                                        const value = e.target.value;
                                        // Allow numbers and one decimal point
                                        if (value === '' || /^\d*\.?\d*$/.test(value)) {
                                            setSplitNeuronAmount(value);
                                        }
                                    }}
                                    placeholder={`Amount (e.g., ${formatAmount(maxSplitAmount / 2n, token.decimals)})`}
                                    disabled={neuronActionBusy || maxSplitAmount === 0n}
                                    style={{
                                        flex: 1,
                                        minWidth: 0,
                                        padding: '12px',
                                        borderRadius: '6px',
                                        border: `1px solid ${theme.colors.border}`,
                                        background: theme.colors.secondaryBg,
                                        color: theme.colors.primaryText,
                                        fontSize: '1rem',
                                        boxSizing: 'border-box'
                                    }}
                                />
                                <button
                                    onClick={() => {
                                        setSplitNeuronAmount(formatAmount(maxSplitAmount, token.decimals));
                                    }}
                                    disabled={neuronActionBusy || maxSplitAmount === 0n}
                                    style={{
                                        marginLeft: '8px',
                                        background: theme.colors.accent,
                                        color: theme.colors.primaryBg,
                                        border: 'none',
                                        borderRadius: '4px',
                                        padding: '8px 16px',
                                        cursor: (neuronActionBusy || maxSplitAmount === 0n) ? 'not-allowed' : 'pointer',
                                        fontSize: '0.8rem',
                                        fontWeight: '600',
                                        flexShrink: 0,
                                        whiteSpace: 'nowrap',
                                        opacity: maxSplitAmount === 0n ? 0.5 : 1
                                    }}
                                >
                                    MAX
                                </button>
                            </div>
                            
                            {maxSplitAmount === 0n && (
                                <p style={{ 
                                    color: theme.colors.error, 
                                    fontSize: '0.85rem', 
                                    marginBottom: '16px',
                                    padding: '8px',
                                    background: theme.colors.errorBg || theme.colors.secondaryBg,
                                    borderRadius: '6px'
                                }}>
                                    ⚠️ This neuron doesn't have enough stake to split. You need at least {formatAmount(minStakeE8s + minSplitAmount, token.decimals)} {token.symbol} total (minimum stake for original + minimum split amount for new neuron).
                                </p>
                            )}
                            
                            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
                                <button
                                    onClick={() => {
                                        setShowSplitNeuronDialog(false);
                                        setSplitNeuronAmount('');
                                        setManagingNeuronId(null);
                                    }}
                                    disabled={neuronActionBusy}
                                    style={{
                                        background: theme.colors.secondaryBg,
                                        color: theme.colors.primaryText,
                                        border: 'none',
                                        borderRadius: '6px',
                                        padding: '10px 20px',
                                        cursor: neuronActionBusy ? 'wait' : 'pointer',
                                        fontSize: '0.9rem',
                                        fontWeight: '500'
                                    }}
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={() => {
                                        try {
                                            const splitFloat = parseFloat(splitNeuronAmount);
                                            if (isNaN(splitFloat) || splitFloat <= 0) {
                                                alert('Please enter a valid amount');
                                                return;
                                            }
                                            const splitE8s = BigInt(Math.floor(splitFloat * Math.pow(10, token.decimals)));
                                            if (splitE8s < minSplitAmount) {
                                                alert(`The split amount must be at least ${formatAmount(minSplitAmount, token.decimals)} ${token.symbol} (minimum stake + transaction fee)`);
                                                return;
                                            }
                                            if (splitE8s > maxSplitAmount) {
                                                alert(`The split amount cannot exceed ${formatAmount(maxSplitAmount, token.decimals)} ${token.symbol}`);
                                                return;
                                            }
                                            if (stake - splitE8s < minStakeE8s) {
                                                alert(`The remaining stake must be at least ${formatAmount(minStakeE8s, token.decimals)} ${token.symbol}`);
                                                return;
                                            }
                                            splitNeuron(managingNeuronId);
                                        } catch (error) {
                                            alert('Invalid amount entered');
                                        }
                                    }}
                                    disabled={neuronActionBusy || !splitNeuronAmount || maxSplitAmount === 0n}
                                    style={{
                                        background: theme.colors.accent,
                                        color: theme.colors.primaryBg,
                                        border: 'none',
                                        borderRadius: '6px',
                                        padding: '10px 20px',
                                        cursor: (neuronActionBusy || !splitNeuronAmount || maxSplitAmount === 0n) ? 'not-allowed' : 'pointer',
                                        fontSize: '0.9rem',
                                        fontWeight: '500',
                                        opacity: (neuronActionBusy || !splitNeuronAmount || maxSplitAmount === 0n) ? 0.6 : 1
                                    }}
                                >
                                    {neuronActionBusy ? 'Processing...' : 'Split Neuron'}
                                </button>
                            </div>
                        </div>
                    </div>
                );
            })()}

            {/* Create Neuron Dialog */}
            {showCreateNeuronDialog && (() => {
                const tokenFee = token.fee || 0n;
                const maxAvailable = token.available || 0n;
                const maxStakeAmount = maxAvailable > tokenFee ? maxAvailable - tokenFee : 0n;
                
                // Get min and max stake from SNS parameters
                const minStakeE8s = nervousSystemParameters?.neuron_minimum_stake_e8s?.[0] || 0n;
                const minDissolveDelaySeconds = nervousSystemParameters?.neuron_minimum_dissolve_delay_to_vote_seconds?.[0] 
                    ? Number(nervousSystemParameters.neuron_minimum_dissolve_delay_to_vote_seconds[0]) 
                    : 0;
                const maxDissolveDelaySeconds = nervousSystemParameters?.max_dissolve_delay_seconds?.[0]
                    ? Number(nervousSystemParameters.max_dissolve_delay_seconds[0])
                    : 0;
                                
                return (
                    <div
                        style={{
                            position: 'fixed',
                            top: 0,
                            left: 0,
                            right: 0,
                            bottom: 0,
                            background: 'rgba(0, 0, 0, 0.5)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            zIndex: 1000,
                            padding: '20px'
                        }}
                        onClick={() => {
                            if (!neuronActionBusy && !createNeuronProgress) {
                                setShowCreateNeuronDialog(false);
                                setCreateNeuronAmount('');
                                setCreateNeuronDissolveDelay('');
                                setCreateNeuronSetDissolveDelay(true);
                                setCreateNeuronNonce('');
                                setCreateNeuronNonceFree(null);
                                setCreateNeuronSubaccountBalance(null);
                                setCreateNeuronAdvancedExpanded(false);
                            }
                        }}
                    >
                        <div style={{
                            background: theme.colors.primaryBg,
                            borderRadius: '12px',
                            padding: '24px',
                            maxWidth: '500px',
                            width: '100%',
                            maxHeight: '90vh',
                            overflow: 'auto',
                            border: `1px solid ${theme.colors.border}`,
                            pointerEvents: 'auto'
                        }}
                        onClick={(e) => e.stopPropagation()}
                        >
                            <h3 style={{ color: theme.colors.primaryText, marginTop: 0 }}>
                                ➕ Create New Neuron
                            </h3>
                            
                            {/* Progress Indicator */}
                            {createNeuronProgress && (
                                <div style={{
                                    background: theme.colors.accent + '20',
                                    border: `2px solid ${theme.colors.accent}`,
                                    borderRadius: '8px',
                                    padding: '16px',
                                    marginBottom: '20px'
                                }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
                                        <div className="spinner" style={{ width: '20px', height: '20px' }}></div>
                                        <span style={{ color: theme.colors.primaryText, fontWeight: '600' }}>
                                            {createNeuronProgress}
                                        </span>
                                    </div>
                                    <p style={{ 
                                        color: theme.colors.warning || '#f59e0b', 
                                        fontSize: '0.85rem', 
                                        margin: 0,
                                        fontWeight: '500'
                                    }}>
                                        ⚠️ Do not close this window until the process completes!
                                    </p>
                                </div>
                            )}
                            
                            {/* Stake Amount Section */}
                            <div style={{ marginBottom: '24px' }}>
                                <h4 style={{ color: theme.colors.primaryText, marginTop: 0, marginBottom: '8px' }}>
                                    Stake Amount
                                </h4>
                                
                                <p style={{ color: theme.colors.mutedText, fontSize: '0.85rem', marginBottom: '8px' }}>
                                    Available in wallet: <strong>{formatAmount(maxAvailable, token.decimals)} {token.symbol}</strong>
                                </p>
                                
                                <p style={{ color: theme.colors.mutedText, fontSize: '0.85rem', marginBottom: '12px' }}>
                                    Minimum stake: <strong>{formatAmount(minStakeE8s, token.decimals)} {token.symbol}</strong>
                                </p>
                                
                                <div style={{ position: 'relative', marginBottom: '8px', display: 'flex', alignItems: 'center' }}>
                                    <input
                                        type="text"
                                        value={createNeuronAmount}
                                        onChange={(e) => {
                                            const value = e.target.value;
                                            if (value === '' || /^\d*\.?\d*$/.test(value)) {
                                                setCreateNeuronAmount(value);
                                            }
                                        }}
                                        placeholder={`Amount (e.g., ${formatAmount(minStakeE8s, token.decimals)})`}
                                        disabled={neuronActionBusy}
                                        style={{
                                            flex: 1,
                                            minWidth: 0,
                                            padding: '12px',
                                            borderRadius: '6px',
                                            border: `1px solid ${theme.colors.border}`,
                                            background: theme.colors.secondaryBg,
                                            color: theme.colors.primaryText,
                                            fontSize: '1rem',
                                            boxSizing: 'border-box'
                                        }}
                                    />
                                    <button
                                        onClick={() => {
                                            setCreateNeuronAmount(formatAmount(maxStakeAmount, token.decimals));
                                        }}
                                        disabled={neuronActionBusy}
                                        style={{
                                            marginLeft: '8px',
                                            background: theme.colors.accent,
                                            color: theme.colors.primaryBg,
                                            border: 'none',
                                            borderRadius: '4px',
                                            padding: '8px 16px',
                                            cursor: neuronActionBusy ? 'wait' : 'pointer',
                                            fontSize: '0.8rem',
                                            fontWeight: '600',
                                            flexShrink: 0,
                                            whiteSpace: 'nowrap'
                                        }}
                                    >
                                        MAX
                                    </button>
                                </div>
                                
                                <div style={{ 
                                    background: theme.colors.secondaryBg,
                                    borderRadius: '6px',
                                    padding: '12px',
                                    marginTop: '12px',
                                    fontSize: '0.9rem'
                                }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                                        <span style={{ color: theme.colors.mutedText }}>Transaction Fee:</span>
                                        <span style={{ color: theme.colors.primaryText }}>{formatAmount(tokenFee, token.decimals)} {token.symbol}</span>
                                    </div>
                                    <div style={{ 
                                        display: 'flex', 
                                        justifyContent: 'space-between', 
                                        paddingTop: '8px',
                                        borderTop: `1px solid ${theme.colors.border}`
                                    }}>
                                        <span style={{ color: theme.colors.primaryText, fontSize: '1rem', fontWeight: '600' }}>Total:</span>
                                        <span style={{ color: theme.colors.accent, fontSize: '1rem', fontWeight: '600' }}>
                                            {createNeuronAmount ? 
                                                (() => {
                                                    try {
                                                        const stakeFloat = parseFloat(createNeuronAmount);
                                                        const stakeE8s = BigInt(Math.floor(stakeFloat * Math.pow(10, token.decimals)));
                                                        const total = stakeE8s + tokenFee;
                                                        return `${formatAmount(total, token.decimals)} ${token.symbol}`;
                                                    } catch {
                                                        return '—';
                                                    }
                                                })()
                                                : '—'
                                            }
                                        </span>
                                    </div>
                                </div>
                            </div>
                            
                            {/* Dissolve Delay Section */}
                            <div style={{ marginBottom: '24px' }}>
                                <div style={{ 
                                    display: 'flex', 
                                    alignItems: 'center', 
                                    gap: '8px',
                                    marginBottom: '12px'
                                }}>
                                    <input
                                        type="checkbox"
                                        id="setDissolveDelay"
                                        checked={createNeuronSetDissolveDelay}
                                        onChange={(e) => setCreateNeuronSetDissolveDelay(e.target.checked)}
                                        disabled={neuronActionBusy}
                                        style={{ cursor: neuronActionBusy ? 'not-allowed' : 'pointer' }}
                                    />
                                    <label 
                                        htmlFor="setDissolveDelay" 
                                        style={{ 
                                            color: theme.colors.primaryText, 
                                            fontSize: '1rem',
                                            fontWeight: '600',
                                            cursor: neuronActionBusy ? 'not-allowed' : 'pointer',
                                            userSelect: 'none'
                                        }}
                                    >
                                        Set Dissolve Delay
                                    </label>
                                </div>
                                
                                <p style={{ color: theme.colors.mutedText, fontSize: '0.85rem', marginBottom: '12px' }}>
                                    {createNeuronSetDissolveDelay 
                                        ? 'Set an initial dissolve delay for your neuron. You can increase it later.'
                                        : 'Skip setting dissolve delay now. You can set or increase it from 0 later.'}
                                </p>
                                
                                {createNeuronSetDissolveDelay && (
                                    <>
                                        <p style={{ color: theme.colors.mutedText, fontSize: '0.85rem', marginBottom: '8px' }}>
                                            Minimum: <strong>{format_duration(minDissolveDelaySeconds * 1000)}</strong>
                                        </p>
                                        
                                        <p style={{ color: theme.colors.mutedText, fontSize: '0.85rem', marginBottom: '12px' }}>
                                            Maximum: <strong>{format_duration(maxDissolveDelaySeconds * 1000)}</strong>
                                        </p>
                                        
                                        <input
                                            type="text"
                                            value={createNeuronDissolveDelay}
                                            onChange={(e) => {
                                                const value = e.target.value;
                                                if (value === '' || /^\d*\.?\d*$/.test(value)) {
                                                    setCreateNeuronDissolveDelay(value);
                                                }
                                            }}
                                            placeholder="Days (e.g., 180)"
                                            disabled={neuronActionBusy}
                                            style={{
                                                width: '100%',
                                                padding: '12px',
                                                borderRadius: '6px',
                                                border: `1px solid ${theme.colors.border}`,
                                                background: theme.colors.secondaryBg,
                                                color: theme.colors.primaryText,
                                                fontSize: '1rem',
                                                boxSizing: 'border-box'
                                            }}
                                        />
                                    </>
                                )}
                            </div>
                            
                            {/* Advanced Section (Collapsible) */}
                            <div style={{ marginBottom: '24px' }}>
                                <div
                                    onClick={() => setCreateNeuronAdvancedExpanded(!createNeuronAdvancedExpanded)}
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '8px',
                                        cursor: 'pointer',
                                        padding: '8px',
                                        borderRadius: '6px',
                                        background: theme.colors.secondaryBg,
                                        marginBottom: createNeuronAdvancedExpanded ? '12px' : '0'
                                    }}
                                >
                                    <span style={{
                                        fontSize: '14px',
                                        transform: createNeuronAdvancedExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
                                        transition: 'transform 0.2s ease'
                                    }}>
                                        ▶
                                    </span>
                                    <h4 style={{ color: theme.colors.primaryText, margin: 0, fontSize: '0.95rem' }}>
                                        Advanced
                                    </h4>
                                </div>
                                
                                {createNeuronAdvancedExpanded && (
                                    <div style={{
                                        background: theme.colors.secondaryBg,
                                        borderRadius: '6px',
                                        padding: '16px',
                                        border: `1px solid ${theme.colors.border}`
                                    }}>
                                        <h5 style={{ color: theme.colors.primaryText, marginTop: 0, marginBottom: '8px', fontSize: '0.9rem' }}>
                                            Neuron Nonce
                                        </h5>
                                        
                                        <p style={{ color: theme.colors.mutedText, fontSize: '0.85rem', marginBottom: '12px' }}>
                                            {createNeuronNonceChecking ? (
                                                <span>🔍 Searching for free nonce...</span>
                                            ) : createNeuronNonceFree === true ? (
                                                <span style={{ color: theme.colors.accent }}>✓ Nonce {createNeuronNonce} is available</span>
                                            ) : createNeuronNonceFree === false ? (
                                                <span style={{ color: theme.colors.error }}>✗ Nonce {createNeuronNonce} is already in use</span>
                                            ) : (
                                                <span>A free nonce was automatically found. You can change it if needed.</span>
                                            )}
                                        </p>
                                        
                                        {createNeuronSubaccountBalance !== null && (
                                            <p style={{ 
                                                color: theme.colors.mutedText, 
                                                fontSize: '0.85rem', 
                                                marginBottom: '12px',
                                                padding: '8px 12px',
                                                background: theme.colors.tertiaryBg || theme.colors.primaryBg,
                                                borderRadius: '6px',
                                                border: `1px solid ${theme.colors.border}`
                                            }}>
                                                <span style={{ fontWeight: '600', color: theme.colors.primaryText }}>Subaccount Balance:</span>{' '}
                                                {formatAmount(createNeuronSubaccountBalance, token.decimals)} {token.symbol}
                                            </p>
                                        )}
                                        
                                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                            <input
                                                type="text"
                                                value={createNeuronNonce}
                                                onChange={(e) => {
                                                    const value = e.target.value;
                                                    if (value === '' || /^\d+$/.test(value)) {
                                                        setCreateNeuronNonce(value);
                                                        setCreateNeuronNonceFree(null); // Reset check status when user changes nonce
                                                        setCreateNeuronSubaccountBalance(null); // Reset balance when user changes nonce
                                                    }
                                                }}
                                                placeholder="Nonce (e.g., 0, 1, 2...)"
                                                disabled={neuronActionBusy || createNeuronNonceChecking}
                                                style={{
                                                    flex: 1,
                                                    minWidth: 0,
                                                    padding: '12px',
                                                    borderRadius: '6px',
                                                    border: `1px solid ${
                                                        createNeuronNonceFree === true ? theme.colors.accent :
                                                        createNeuronNonceFree === false ? theme.colors.error :
                                                        theme.colors.border
                                                    }`,
                                                    background: theme.colors.tertiaryBg || theme.colors.primaryBg,
                                                    color: theme.colors.primaryText,
                                                    fontSize: '1rem',
                                                    boxSizing: 'border-box'
                                                }}
                                            />
                                            <button
                                                onClick={async () => {
                                                    if (!createNeuronNonce) return;
                                                    setCreateNeuronNonceChecking(true);
                                                    
                                                    try {
                                                        const nonce = parseInt(createNeuronNonce);
                                                        
                                                        // Check if nonce is free
                                                        const isFree = await checkNonceIsFree(nonce);
                                                        setCreateNeuronNonceFree(isFree);
                                                        
                                                        // Check subaccount balance
                                                        const principal = identity.getPrincipal();
                                                        const subaccount = await computeNeuronSubaccount(principal, nonce);
                                                        
                                                        const ledgerIdString = typeof token.ledger_canister_id === 'string' 
                                                            ? token.ledger_canister_id 
                                                            : token.ledger_canister_id?.toString();
                                                        
                                                        const ledgerActor = createLedgerActor(ledgerIdString, {
                                                            agentOptions: { identity }
                                                        });
                                                        
                                                        const balance = await ledgerActor.icrc1_balance_of({
                                                            owner: principal,
                                                            subaccount: [Array.from(subaccount)]
                                                        });
                                                        
                                                        setCreateNeuronSubaccountBalance(balance);
                                                    } catch (error) {
                                                        console.error('[TokenCard] Error checking nonce/balance:', error);
                                                        setCreateNeuronSubaccountBalance(null);
                                                    }
                                                    
                                                    setCreateNeuronNonceChecking(false);
                                                }}
                                                disabled={neuronActionBusy || createNeuronNonceChecking || !createNeuronNonce}
                                                style={{
                                                    background: theme.colors.accent,
                                                    color: theme.colors.primaryBg,
                                                    border: 'none',
                                                    borderRadius: '6px',
                                                    padding: '12px 16px',
                                                    cursor: (neuronActionBusy || createNeuronNonceChecking || !createNeuronNonce) ? 'not-allowed' : 'pointer',
                                                    fontSize: '0.9rem',
                                                    fontWeight: '600',
                                                    flexShrink: 0,
                                                    whiteSpace: 'nowrap',
                                                    opacity: (neuronActionBusy || createNeuronNonceChecking || !createNeuronNonce) ? 0.5 : 1
                                                }}
                                            >
                                                {createNeuronNonceChecking ? '...' : 'Check Free'}
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                            
                            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
                                <button
                                    onClick={() => {
                                        setShowCreateNeuronDialog(false);
                                        setCreateNeuronAmount('');
                                        setCreateNeuronDissolveDelay('');
                                        setCreateNeuronSetDissolveDelay(true);
                                        setCreateNeuronNonce('');
                                        setCreateNeuronNonceFree(null);
                                        setCreateNeuronSubaccountBalance(null);
                                        setCreateNeuronAdvancedExpanded(false);
                                    }}
                                    disabled={neuronActionBusy || createNeuronProgress}
                                    style={{
                                        background: theme.colors.secondaryBg,
                                        color: theme.colors.primaryText,
                                        border: 'none',
                                        borderRadius: '6px',
                                        padding: '10px 20px',
                                        cursor: (neuronActionBusy || createNeuronProgress) ? 'not-allowed' : 'pointer',
                                        fontSize: '0.9rem',
                                        fontWeight: '500',
                                        opacity: (neuronActionBusy || createNeuronProgress) ? 0.5 : 1
                                    }}
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={() => {
                                        try {
                                            // Validate stake amount
                                            const stakeFloat = parseFloat(createNeuronAmount);
                                            if (isNaN(stakeFloat) || stakeFloat <= 0) {
                                                alert('Please enter a valid stake amount');
                                                return;
                                            }
                                            const stakeE8s = BigInt(Math.floor(stakeFloat * Math.pow(10, token.decimals)));
                                            
                                            // Check minimum stake
                                            if (stakeE8s < minStakeE8s) {
                                                alert(`Stake amount must be at least ${formatAmount(minStakeE8s, token.decimals)} ${token.symbol}`);
                                                return;
                                            }
                                            
                                            // Check available balance
                                            const total = stakeE8s + tokenFee;
                                            if (total > maxAvailable) {
                                                alert(`Insufficient balance. You need ${formatAmount(total, token.decimals)} ${token.symbol} (including fee) but only have ${formatAmount(maxAvailable, token.decimals)} ${token.symbol}`);
                                                return;
                                            }
                                            
                                            // Validate dissolve delay (if user chose to set it)
                                            let delaySeconds = 0;
                                            if (createNeuronSetDissolveDelay) {
                                                const delayDays = parseFloat(createNeuronDissolveDelay);
                                                if (isNaN(delayDays) || delayDays < 0) {
                                                    alert('Please enter a valid dissolve delay in days');
                                                    return;
                                                }
                                                delaySeconds = Math.floor(delayDays * 24 * 60 * 60);
                                                
                                                // Check min/max dissolve delay
                                                if (delaySeconds < minDissolveDelaySeconds) {
                                                    alert(`Dissolve delay must be at least ${format_duration(minDissolveDelaySeconds * 1000)}`);
                                                    return;
                                                }
                                                if (delaySeconds > maxDissolveDelaySeconds) {
                                                    alert(`Dissolve delay cannot exceed ${format_duration(maxDissolveDelaySeconds * 1000)}`);
                                                    return;
                                                }
                                            }
                                            
                                            // Validate nonce
                                            if (!createNeuronNonce) {
                                                alert('Please enter a nonce');
                                                return;
                                            }
                                            if (createNeuronNonceFree !== true) {
                                                alert('Please verify that the nonce is free by clicking "Check Free"');
                                                return;
                                            }
                                            const nonce = parseInt(createNeuronNonce);
                                            if (isNaN(nonce) || nonce < 0) {
                                                alert('Please enter a valid nonce (non-negative integer)');
                                                return;
                                            }
                                            
                                            createNeuron(stakeE8s, delaySeconds, nonce, createNeuronSetDissolveDelay);
                                        } catch (error) {
                                            alert('Invalid input values');
                                        }
                                    }}
                                    disabled={(() => {
                                        if (neuronActionBusy || !createNeuronAmount || !createNeuronNonce || createNeuronNonceFree !== true) return true;
                                        
                                        // If user chose to set dissolve delay, validate it
                                        if (createNeuronSetDissolveDelay) {
                                            if (!createNeuronDissolveDelay) return true;
                                            try {
                                                const delayDays = parseFloat(createNeuronDissolveDelay);
                                                if (isNaN(delayDays) || delayDays < 0) return true;
                                                const delaySeconds = Math.floor(delayDays * 24 * 60 * 60);
                                                if (delaySeconds < minDissolveDelaySeconds || delaySeconds > maxDissolveDelaySeconds) return true;
                                            } catch {
                                                return true;
                                            }
                                        }
                                        
                                        return false;
                                    })()}
                                    style={(() => {
                                        let isDisabled = neuronActionBusy || !createNeuronAmount || !createNeuronNonce || createNeuronNonceFree !== true;
                                        
                                        // If user chose to set dissolve delay, validate it
                                        if (createNeuronSetDissolveDelay) {
                                            if (!createNeuronDissolveDelay) {
                                                isDisabled = true;
                                            } else {
                                                try {
                                                    const delayDays = parseFloat(createNeuronDissolveDelay);
                                                    if (isNaN(delayDays) || delayDays < 0) {
                                                        isDisabled = true;
                                                    } else {
                                                        const delaySeconds = Math.floor(delayDays * 24 * 60 * 60);
                                                        if (delaySeconds < minDissolveDelaySeconds || delaySeconds > maxDissolveDelaySeconds) {
                                                            isDisabled = true;
                                                        }
                                                    }
                                                } catch {
                                                    isDisabled = true;
                                                }
                                            }
                                        }
                                        
                                        return {
                                            background: theme.colors.success,
                                            color: theme.colors.primaryBg,
                                            border: 'none',
                                            borderRadius: '6px',
                                            padding: '10px 20px',
                                            cursor: isDisabled ? 'not-allowed' : 'pointer',
                                            fontSize: '0.9rem',
                                            fontWeight: '500',
                                            opacity: isDisabled ? 0.6 : 1
                                        };
                                    })()}
                                >
                                    {neuronActionBusy ? 'Creating...' : 'Create Neuron'}
                                </button>
                            </div>
                        </div>
                    </div>
                );
            })()}

            {/* Send Neuron Dialog */}
            {showSendNeuronDialog && (
                <div
                    style={{
                        position: 'fixed',
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        background: 'rgba(0, 0, 0, 0.5)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        zIndex: 1000,
                        padding: '20px'
                    }}
                    onClick={() => {
                        if (!neuronActionBusy && !sendNeuronProgress) {
                            setShowSendNeuronDialog(false);
                            setSendNeuronRecipient('');
                            setManagingNeuronId(null);
                        }
                    }}
                >
                    <div style={{
                        background: theme.colors.primaryBg,
                        borderRadius: '12px',
                        padding: '24px',
                        maxWidth: '600px',
                        width: '100%',
                        maxHeight: '90vh',
                        overflow: 'auto',
                        border: `1px solid ${theme.colors.border}`,
                        pointerEvents: 'auto'
                    }}
                    onClick={(e) => e.stopPropagation()}
                    >
                        <h3 style={{ color: theme.colors.primaryText, marginTop: 0 }}>
                            📤 Send Neuron
                        </h3>
                        
                        {/* Progress Indicator */}
                        {sendNeuronProgress && (
                            <div style={{
                                background: theme.colors.accent + '20',
                                border: `2px solid ${theme.colors.accent}`,
                                borderRadius: '8px',
                                padding: '16px',
                                marginBottom: '20px'
                            }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
                                    <div className="spinner" style={{ width: '20px', height: '20px' }}></div>
                                    <span style={{ color: theme.colors.primaryText, fontWeight: '600' }}>
                                        {sendNeuronProgress}
                                    </span>
                                </div>
                                <p style={{ 
                                    color: theme.colors.warning || '#f59e0b', 
                                    fontSize: '0.85rem', 
                                    margin: 0,
                                    fontWeight: '500'
                                }}>
                                    ⚠️ Do not close this window until the process completes!
                                </p>
                            </div>
                        )}
                        
                        {/* Warning Box */}
                        <div style={{
                            background: theme.colors.warning + '20' || '#f59e0b20',
                            border: `2px solid ${theme.colors.warning || '#f59e0b'}`,
                            borderRadius: '8px',
                            padding: '16px',
                            marginBottom: '20px'
                        }}>
                            <h4 style={{ color: theme.colors.primaryText, marginTop: 0, marginBottom: '12px' }}>
                                ⚠️ Important Information
                            </h4>
                            <div style={{ color: theme.colors.secondaryText, fontSize: '0.9rem', lineHeight: '1.5' }}>
                                <p style={{ marginTop: 0 }}>
                                    <strong>Sending a neuron will:</strong>
                                </p>
                                <ol style={{ marginLeft: '20px', paddingLeft: 0 }}>
                                    <li>Add the recipient principal with full permissions</li>
                                    <li>Verify the recipient was added successfully</li>
                                    <li>Remove all other principals (including you)</li>
                                </ol>
                                <p>
                                    <strong>⚠️ After sending, you will lose all access to this neuron.</strong>
                                </p>
                                <p>
                                    Only send to a principal that belongs to a recipient who can accept it, such as:
                                </p>
                                <ul style={{ marginLeft: '20px', paddingLeft: 0 }}>
                                    <li>Another user using Sneed Wallet</li>
                                    <li>The NNS wallet (note: NNS wallet can receive but cannot transfer neurons onwards)</li>
                                </ul>
                                <p style={{ marginBottom: 0 }}>
                                    <strong>Need more control?</strong> Use the <strong>"Manage"</strong> button to access the "Principals & Permissions" section where you can add/remove principals and set custom permissions.
                                </p>
                            </div>
                        </div>
                        
                        {/* Recipient Input */}
                        <div style={{ marginBottom: '24px' }}>
                            <label style={{ 
                                display: 'block', 
                                color: theme.colors.primaryText, 
                                fontWeight: '600',
                                marginBottom: '8px'
                            }}>
                                Recipient Principal:
                            </label>
                            <input
                                type="text"
                                value={sendNeuronRecipient}
                                onChange={(e) => setSendNeuronRecipient(e.target.value)}
                                placeholder="Enter recipient's Internet Computer principal"
                                disabled={neuronActionBusy || sendNeuronProgress}
                                style={{
                                    width: '100%',
                                    padding: '12px',
                                    borderRadius: '6px',
                                    border: `1px solid ${theme.colors.border}`,
                                    background: theme.colors.secondaryBg,
                                    color: theme.colors.primaryText,
                                    fontSize: '0.9rem',
                                    boxSizing: 'border-box',
                                    fontFamily: 'monospace'
                                }}
                            />
                        </div>
                        
                        <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
                            <button
                                onClick={() => {
                                    setShowSendNeuronDialog(false);
                                    setSendNeuronRecipient('');
                                    setManagingNeuronId(null);
                                }}
                                disabled={neuronActionBusy || sendNeuronProgress}
                                style={{
                                    background: theme.colors.secondaryBg,
                                    color: theme.colors.primaryText,
                                    border: 'none',
                                    borderRadius: '6px',
                                    padding: '10px 20px',
                                    cursor: (neuronActionBusy || sendNeuronProgress) ? 'not-allowed' : 'pointer',
                                    fontSize: '0.9rem',
                                    fontWeight: '500',
                                    opacity: (neuronActionBusy || sendNeuronProgress) ? 0.5 : 1
                                }}
                            >
                                Cancel
                            </button>
                            <button
                                onClick={() => {
                                    if (!sendNeuronRecipient.trim()) {
                                        alert('Please enter a recipient principal');
                                        return;
                                    }
                                    if (!confirm('Are you sure you want to send this neuron? You will lose all access to it.')) {
                                        return;
                                    }
                                    sendNeuron(managingNeuronId, sendNeuronRecipient.trim());
                                }}
                                disabled={neuronActionBusy || sendNeuronProgress || !sendNeuronRecipient.trim()}
                                style={{
                                    background: theme.colors.warning || '#f59e0b',
                                    color: theme.colors.primaryBg,
                                    border: 'none',
                                    borderRadius: '6px',
                                    padding: '10px 20px',
                                    cursor: (neuronActionBusy || sendNeuronProgress || !sendNeuronRecipient.trim()) ? 'not-allowed' : 'pointer',
                                    fontSize: '0.9rem',
                                    fontWeight: '500',
                                    opacity: (neuronActionBusy || sendNeuronProgress || !sendNeuronRecipient.trim()) ? 0.6 : 1
                                }}
                            >
                                {neuronActionBusy || sendNeuronProgress ? 'Sending...' : 'Send Neuron'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default TokenCard;