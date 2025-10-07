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
import { NeuronDisplay } from './components/NeuronDisplay';
import { useNaming } from './NamingContext';
import { VotingPowerCalculator } from './utils/VotingPowerUtils';
import { getUserPermissionIcons, getStateIcon, PERM } from './utils/NeuronPermissionUtils';

// Constants for GLDT and sGLDT canister IDs
const GLDT_CANISTER_ID = '6c7su-kiaaa-aaaar-qaira-cai';
const SGLDT_CANISTER_ID = 'i2s4q-syaaa-aaaan-qz4sq-cai';

console.log('TokenCard constants:', { GLDT_CANISTER_ID, SGLDT_CANISTER_ID });

const TokenCard = ({ token, locks, lockDetailsLoading, principalDisplayInfo, showDebug, hideAvailable = false, hideButtons = false, defaultExpanded = false, defaultLocksExpanded = false, openSendModal, openLockModal, openWrapModal, openUnwrapModal, handleUnregisterToken, rewardDetailsLoading, handleClaimRewards, handleWithdrawFromBackend, isSnsToken = false }) => {

    const { theme } = useTheme();
    const { isAuthenticated, identity } = useAuth();
    const { getNeuronDisplayName } = useNaming();
    const [showBalanceBreakdown, setShowBalanceBreakdown] = useState(false);
    const [isExpanded, setIsExpanded] = useState(defaultExpanded);
    const [locksExpanded, setLocksExpanded] = useState(defaultLocksExpanded);
    
    // Neuron state
    const [neurons, setNeurons] = useState([]);
    const [neuronsLoading, setNeuronsLoading] = useState(false);
    const [neuronsExpanded, setNeuronsExpanded] = useState(false);
    const [expandedNeurons, setExpandedNeurons] = useState(new Set());
    const [snsRootCanisterId, setSnsRootCanisterId] = useState(null);
    const [nervousSystemParameters, setNervousSystemParameters] = useState(null);
    const [votingPowerCalc, setVotingPowerCalc] = useState(null);
    const [governanceCanisterId, setGovernanceCanisterId] = useState(null);
    
    // Neuron management state
    const [managingNeuronId, setManagingNeuronId] = useState(null);
    const [neuronActionBusy, setNeuronActionBusy] = useState(false);
    const [showDissolveDelayDialog, setShowDissolveDelayDialog] = useState(false);
    const [dissolveDelayInput, setDissolveDelayInput] = useState('');

    // Debug logging for wrap/unwrap buttons
    console.log('TokenCard Debug:', {
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
    });

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

    // Check if user has a specific permission on a neuron
    const userHasPermission = (neuron, permissionType) => {
        if (!identity || !neuron.permissions) return false;
        const userPrincipal = identity.getPrincipal().toString();
        const userPerms = neuron.permissions.find(p => 
            p.principal?.[0]?.toString() === userPrincipal
        );
        return userPerms?.permission_type?.includes(permissionType) || false;
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
        } else {
            alert(`Error disbursing neuron: ${result.err}`);
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
                    console.log(`[TokenCard] No SNS governance found for ${token.symbol}`);
                    setNeuronsLoading(false);
                    return;
                }

                const govCanisterId = snsData.canisters.governance;
                const rootId = snsData.rootCanisterId;
                setSnsRootCanisterId(rootId);
                setGovernanceCanisterId(govCanisterId);
                console.log(`[TokenCard] Fetching neurons for ${token.symbol} from governance:`, govCanisterId);

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

                console.log(`[TokenCard] Found ${neuronsResponse.neurons.length} neurons for ${token.symbol}`);
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
                <div className="header-logo-column">
                    <img src={token.logo} alt={token.symbol} className="token-logo" />
                </div>
                <div className="header-content-column">
                    <div className="header-row-1">
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span className="token-name">{token.name || token.symbol}</span>
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
                        </div>
                        <span className="token-usd-value">
                            {(token.available || 0n) > 0n && token.conversion_rate > 0 && 
                                `$${formatAmountWithConversion(token.available || 0n, token.decimals, token.conversion_rate)}`
                            }
                        </span>
                    </div>
                    <div className="header-row-2">
                        <div className="amount-symbol">
                            {!hideAvailable && (
                                <span className="token-amount">{formatAmount(token.available || 0n, token.decimals)}</span>
                            )}
                            <span className="token-symbol">{token.symbol}</span>
                        </div>
                        <span className="expand-indicator">{isExpanded ? '▼' : '▶'}</span>
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
                        <div className="balance-item">
                            <div className="balance-label">Total</div>
                            <div className="balance-value">${formatAmountWithConversion(availableOrZero(token.available) + token.locked + rewardAmountOrZero(token, rewardDetailsLoading, hideAvailable), token.decimals, token.conversion_rate, 2)}</div>
                        </div>
                        <div className="balance-item" style={{ cursor: 'pointer' }} onClick={() => setShowBalanceBreakdown(!showBalanceBreakdown)}>
                            <div className="balance-label">
                                Available {showBalanceBreakdown ? '▼' : '▶'}
                            </div>
                            <div className="balance-value">{formatAmount(token.available || 0n, token.decimals)}{getUSD(token.available || 0n, token.decimals, token.conversion_rate)}</div>
                        </div>
                        
                        {showBalanceBreakdown && (
                            <div className="balance-breakdown" style={{ 
                                marginLeft: '20px', 
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
                                        <div style={{ fontSize: '12px', color: '#bdc3c7' }}>Frontend Wallet</div>
                                        <div style={{ fontSize: '14px', fontWeight: 'bold', color: 'white' }}>
                                            {formatAmount(token.balance || 0n, token.decimals)} {token.symbol}
                                        </div>
                                    </div>
                                </div>
                                
                                <div className="balance-breakdown-item">
                                    <div style={{ fontSize: '12px', color: '#bdc3c7' }}>Backend Wallet</div>
                                    <div style={{ fontSize: '14px', fontWeight: 'bold', color: 'white' }}>
                                        {formatAmount(token.available_backend || 0n, token.decimals)} {token.symbol}
                                    </div>
                                    {(() => {
                                        const shouldShowButton = token.available_backend > 0n && !hideButtons;
                                        console.log('Withdraw button debug:', {
                                            symbol: token.symbol,
                                            available_backend: token.available_backend?.toString(),
                                            available_backend_bigint: typeof token.available_backend,
                                            is_greater_than_zero: token.available_backend > 0n,
                                            hideButtons,
                                            shouldShowButton,
                                            handleWithdrawFromBackend: typeof handleWithdrawFromBackend
                                        });
                                        
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
                    </>
                )}
                <div className="balance-item">
                    <div className="balance-label">Locked</div>
                    <div className="balance-value">{formatAmount(token.locked || 0n, token.decimals)}{getUSD(token.locked || 0n, token.decimals, token.conversion_rate)}</div>
                </div>    
                {(!hideAvailable && (
                    (rewardAmountOrZero(token, rewardDetailsLoading, hideAvailable) > 0) ? (
                        <div className="balance-item">
                            <div className="balance-label" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                Rewards:
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
                    )
                ))}
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
                        <span style={{ color: theme.colors.primaryText, fontWeight: '500' }}>
                            Locks
                        </span>
                        {lockDetailsLoading[token.ledger_canister_id] ? (
                            <span style={{ color: theme.colors.mutedText, fontSize: '0.9rem' }}>
                                (Loading...)
                            </span>
                        ) : (
                            <span style={{ color: theme.colors.mutedText, fontSize: '0.9rem' }}>
                                ({locks[token.ledger_canister_id]?.length || 0} {locks[token.ledger_canister_id]?.length === 1 ? 'lock' : 'locks'})
                            </span>
                        )}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
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
                                gap: '12px', 
                                marginBottom: '15px',
                                paddingBottom: '12px',
                                borderBottom: `1px solid ${theme.colors.border}`
                            }}>
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
                                                <span className="lock-label">Amount:</span>
                                                <span className="lock-value">{formatAmount(lock.amount || 0n, token.decimals)}{getUSD(lock.amount || 0n, token.decimals, token.conversion_rate)}</span>
                                            </div>
                                            <div className="lock-details">
                                                <span className="lock-label">Expires:</span>
                                                <span className="lock-value">{dateToReadable(lock.expiry)}</span>
                                            </div>
                                            <div className="lock-details">
                                                <span className="lock-label">Duration:</span>
                                                <span className="lock-value">{format_duration(lock.expiry - new Date())}</span>
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
                            <span style={{ color: theme.colors.primaryText, fontWeight: '500' }}>
                                🧠 Neurons
                            </span>
                            {neuronsLoading ? (
                                <span style={{ color: theme.colors.mutedText, fontSize: '0.9rem' }}>
                                    (Loading...)
                                </span>
                            ) : (
                                <>
                                    <span style={{ color: theme.colors.mutedText, fontSize: '0.9rem' }}>
                                        ({neurons.length} {neurons.length === 1 ? 'neuron' : 'neurons'})
                                    </span>
                                    {neurons.length > 0 && (
                                        <span style={{ color: theme.colors.accent, fontSize: '0.9rem', fontWeight: '600' }}>
                                            {formatAmount(getTotalNeuronStake(), token.decimals)} {token.symbol}
                                        </span>
                                    )}
                                </>
                            )}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
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
                                    {neurons.length > 0 ? (
                                        neurons.map((neuron, neuronIndex) => {
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
        </div>
    );
};

export default TokenCard;