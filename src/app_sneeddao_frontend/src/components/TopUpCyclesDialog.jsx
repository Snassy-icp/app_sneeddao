import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Principal } from '@dfinity/principal';
import { HttpAgent, Actor } from '@dfinity/agent';
import { principalToSubAccount } from '@dfinity/utils';
import { FaTimes, FaBolt, FaCheckCircle, FaExclamationTriangle, FaSpinner } from 'react-icons/fa';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../AuthContext';
import { useNaming } from '../NamingContext';
import { PrincipalDisplay } from '../utils/PrincipalUtils';
import { formatCyclesCompact, parseCyclesInput } from '../utils/NeuronManagerSettings';
import { createActor as createLedgerActor } from 'external/icrc1_ledger';
import { createActor as createCmcActor, CMC_CANISTER_ID } from 'external/cmc';

const ICP_LEDGER_CANISTER_ID = 'ryjl3-tyaaa-aaaaa-aaaba-cai';
const E8S_ICP = 100_000_000;
const ICP_FEE = 10_000;
const TOP_UP_MEMO = new Uint8Array([0x54, 0x50, 0x55, 0x50, 0x00, 0x00, 0x00, 0x00]);

const MANAGEMENT_CANISTER_ID_TEXT = 'aaaaa-aa';
const managementCanisterIdlFactory = ({ IDL }) => IDL.Service({});

const MODE_TO_LEVEL = 'to_level';
const MODE_SPLIT_EQUAL = 'split_equal';
const MODE_EACH = 'each';

/**
 * Reusable dialog for topping up canisters that are low on cycles.
 *
 * Props:
 *   isOpen: boolean
 *   onClose: () => void
 *   lowCyclesCanisters: Array<{ canisterId, cycles, criticalLevel, type, label, version? }>
 *   onTopUpComplete: () => void — called after top-ups finish (to refresh data)
 *   icpToCyclesRate: number|null — cycles per 1 ICP
 */
export default function TopUpCyclesDialog({ isOpen, onClose, lowCyclesCanisters = [], onTopUpComplete, icpToCyclesRate }) {
    const { theme } = useTheme();
    const { identity } = useAuth();
    const { getPrincipalDisplayName } = useNaming();

    const [selected, setSelected] = useState({}); // canisterId -> boolean
    const [mode, setMode] = useState(MODE_TO_LEVEL);
    const [icpAmount, setIcpAmount] = useState('');
    const [targetCycleLevel, setTargetCycleLevel] = useState(''); // cycles target for MODE_TO_LEVEL
    const [icpBalance, setIcpBalance] = useState(null);
    const [balanceLoading, setBalanceLoading] = useState(false);
    const [topUpStatus, setTopUpStatus] = useState({}); // canisterId -> 'pending' | 'topping_up' | 'success' | 'error'
    const [topUpErrors, setTopUpErrors] = useState({}); // canisterId -> error message
    const [topUpResults, setTopUpResults] = useState({}); // canisterId -> cycles added
    const [isProcessing, setIsProcessing] = useState(false);
    const [rateLoading, setRateLoading] = useState(false);
    const [localRate, setLocalRate] = useState(null);
    const abortRef = useRef(false);

    const effectiveRate = icpToCyclesRate || localRate;

    const hasSmartPrefilledRef = useRef(false);

    // Initialize selection when dialog opens
    useEffect(() => {
        if (isOpen && lowCyclesCanisters.length > 0) {
            const newSelected = {};
            lowCyclesCanisters.forEach(c => {
                newSelected[c.canisterId] = true;
            });
            setSelected(newSelected);
            setTopUpStatus({});
            setTopUpErrors({});
            setTopUpResults({});
            setIsProcessing(false);
            setIcpAmount('');
            setMode(MODE_TO_LEVEL);
            // Default target: the max healthy level (will be adjusted by smart prefill below)
            const maxHealthy = Math.max(...lowCyclesCanisters.map(c => c.healthyLevel || c.criticalLevel));
            setTargetCycleLevel(formatCyclesCompact(maxHealthy));
            hasSmartPrefilledRef.current = false;
            abortRef.current = false;
        }
    }, [isOpen, lowCyclesCanisters]);

    // Smart prefill: once we know the balance and rate, pick the best affordable target
    useEffect(() => {
        if (!isOpen || hasSmartPrefilledRef.current || !effectiveRate || effectiveRate <= 0 || icpBalance === null) return;
        if (lowCyclesCanisters.length === 0) return;
        hasSmartPrefilledRef.current = true;

        const canisters = lowCyclesCanisters;
        const fees = canisters.length * ICP_FEE / E8S_ICP;

        // Helper: ICP needed to bring all canisters to a given cycle level
        const icpNeededForLevel = (level) => {
            let total = 0;
            for (const c of canisters) {
                const deficit = level - (c.cycles || 0);
                if (deficit > 0) total += (deficit * 1.1) / effectiveRate;
            }
            return total + fees;
        };

        const maxHealthy = Math.max(...canisters.map(c => c.healthyLevel || c.criticalLevel));
        const maxCritical = Math.max(...canisters.map(c => c.criticalLevel || 0));

        const icpForHealthy = icpNeededForLevel(maxHealthy);
        const icpForCritical = icpNeededForLevel(maxCritical);

        if (icpBalance >= icpForHealthy) {
            // Can afford healthy — set to healthy
            setTargetCycleLevel(formatCyclesCompact(maxHealthy));
        } else if (icpBalance >= icpForCritical) {
            // Can afford critical but not healthy — set to critical
            setTargetCycleLevel(formatCyclesCompact(maxCritical));
        } else {
            // Can't even afford critical — compute the max affordable level
            const availableIcp = Math.max(0, icpBalance - fees);
            if (availableIcp > 0) {
                const totalCyclesAffordable = availableIcp * effectiveRate / 1.1; // account for the 10% buffer
                // Distribute proportionally — in the simplest case, the max level we can top them all to
                // is: current_min + totalCyclesAffordable / N
                const minCycles = Math.min(...canisters.map(c => c.cycles || 0));
                const levelWeCanAfford = minCycles + totalCyclesAffordable / canisters.length;
                setTargetCycleLevel(formatCyclesCompact(Math.floor(levelWeCanAfford)));
            }
        }
    }, [isOpen, effectiveRate, icpBalance, lowCyclesCanisters]);

    // Fetch ICP balance when dialog opens
    useEffect(() => {
        if (!isOpen || !identity) return;
        let cancelled = false;

        const fetchBalance = async () => {
            setBalanceLoading(true);
            try {
                const host = process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging'
                    ? 'https://ic0.app' : 'http://localhost:4943';
                const agent = new HttpAgent({ identity, host });
                if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                    await agent.fetchRootKey();
                }
                const ledger = createLedgerActor(ICP_LEDGER_CANISTER_ID, { agent });
                const bal = await ledger.icrc1_balance_of({
                    owner: identity.getPrincipal(),
                    subaccount: [],
                });
                if (!cancelled) setIcpBalance(Number(bal) / E8S_ICP);
            } catch (err) {
                console.error('[TopUpDialog] Error fetching ICP balance:', err);
                if (!cancelled) setIcpBalance(null);
            } finally {
                if (!cancelled) setBalanceLoading(false);
            }
        };
        fetchBalance();
        return () => { cancelled = true; };
    }, [isOpen, identity]);

    // Fetch ICP-to-cycles rate if not provided
    useEffect(() => {
        if (!isOpen || effectiveRate) return;
        let cancelled = false;

        const fetchRate = async () => {
            setRateLoading(true);
            try {
                const host = process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging'
                    ? 'https://ic0.app' : 'http://localhost:4943';
                const agent = new HttpAgent({ host });
                if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                    await agent.fetchRootKey();
                }
                const cmc = createCmcActor(CMC_CANISTER_ID, { agent });
                const response = await cmc.get_icp_xdr_conversion_rate();
                const xdrPerIcp = Number(response.data.xdr_permyriad_per_icp) / 10000;
                const cyclesPerIcp = xdrPerIcp * 1_000_000_000_000;
                if (!cancelled) setLocalRate(cyclesPerIcp);
            } catch (err) {
                console.error('[TopUpDialog] Error fetching conversion rate:', err);
            } finally {
                if (!cancelled) setRateLoading(false);
            }
        };
        fetchRate();
        return () => { cancelled = true; };
    }, [isOpen, effectiveRate]);

    const toggleSelect = (canisterId) => {
        if (isProcessing) return;
        setSelected(prev => ({ ...prev, [canisterId]: !prev[canisterId] }));
    };

    const selectAll = () => {
        if (isProcessing) return;
        const newSel = {};
        lowCyclesCanisters.forEach(c => { newSel[c.canisterId] = true; });
        setSelected(newSel);
    };

    const deselectAll = () => {
        if (isProcessing) return;
        setSelected({});
    };

    const selectedCanisters = lowCyclesCanisters.filter(c => selected[c.canisterId]);
    const selectedCount = selectedCanisters.length;

    // Parse the user-specified target cycle level
    const parsedTargetLevel = parseCyclesInput(targetCycleLevel) || 0;

    // Compute ICP needed per canister for "to level" mode
    const computeToLevelAmounts = useCallback(() => {
        if (!effectiveRate || effectiveRate <= 0 || !parsedTargetLevel) return {};
        const amounts = {};
        for (const c of selectedCanisters) {
            const deficit = parsedTargetLevel - (c.cycles || 0);
            if (deficit > 0) {
                // Add 10% buffer to ensure we reach the target level
                const icpNeeded = (deficit * 1.1) / effectiveRate;
                amounts[c.canisterId] = Math.max(icpNeeded, 0.001); // minimum 0.001 ICP
            } else {
                amounts[c.canisterId] = 0;
            }
        }
        return amounts;
    }, [selectedCanisters, effectiveRate, parsedTargetLevel]);

    const toLevelAmounts = mode === MODE_TO_LEVEL ? computeToLevelAmounts() : {};
    const totalToLevel = Object.values(toLevelAmounts).reduce((sum, v) => sum + v, 0);
    const totalToLevelWithFees = totalToLevel + (selectedCount * ICP_FEE / E8S_ICP);

    // Compute total ICP needed based on mode
    const computeTotalIcp = () => {
        if (mode === MODE_TO_LEVEL) {
            return totalToLevelWithFees;
        }
        const amt = parseFloat(icpAmount) || 0;
        if (mode === MODE_EACH) {
            return (amt * selectedCount) + (selectedCount * ICP_FEE / E8S_ICP);
        }
        if (mode === MODE_SPLIT_EQUAL) {
            return amt + (selectedCount * ICP_FEE / E8S_ICP);
        }
        return 0;
    };
    const totalIcpNeeded = computeTotalIcp();
    const hasEnoughBalance = icpBalance !== null && icpBalance >= totalIcpNeeded;

    // Handle top-up
    const handleTopUp = async () => {
        if (!identity || selectedCount === 0 || isProcessing) return;
        if (mode !== MODE_TO_LEVEL && (!icpAmount || parseFloat(icpAmount) <= 0)) return;
        if (mode === MODE_TO_LEVEL && (!parsedTargetLevel || parsedTargetLevel <= 0)) return;

        setIsProcessing(true);
        abortRef.current = false;

        const initStatus = {};
        selectedCanisters.forEach(c => { initStatus[c.canisterId] = 'pending'; });
        setTopUpStatus(initStatus);
        setTopUpErrors({});
        setTopUpResults({});

        try {
            const host = process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging'
                ? 'https://ic0.app' : 'http://localhost:4943';
            const agent = new HttpAgent({ identity, host });
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
            }
            const ledger = createLedgerActor(ICP_LEDGER_CANISTER_ID, { agent });
            const cmc = createCmcActor(CMC_CANISTER_ID, { agent });
            const cmcPrincipal = Principal.fromText(CMC_CANISTER_ID);

            // Calculate ICP amount for each canister
            const perCanisterIcp = {};
            const amt = parseFloat(icpAmount) || 0;

            for (const c of selectedCanisters) {
                if (mode === MODE_TO_LEVEL) {
                    perCanisterIcp[c.canisterId] = toLevelAmounts[c.canisterId] || 0;
                } else if (mode === MODE_SPLIT_EQUAL) {
                    perCanisterIcp[c.canisterId] = amt / selectedCount;
                } else {
                    perCanisterIcp[c.canisterId] = amt;
                }
            }

            // Process sequentially
            for (const c of selectedCanisters) {
                if (abortRef.current) break;

                const icpForThis = perCanisterIcp[c.canisterId];
                if (!icpForThis || icpForThis <= 0) {
                    setTopUpStatus(prev => ({ ...prev, [c.canisterId]: 'success' }));
                    setTopUpResults(prev => ({ ...prev, [c.canisterId]: 0 }));
                    continue;
                }

                setTopUpStatus(prev => ({ ...prev, [c.canisterId]: 'topping_up' }));

                try {
                    const amountE8s = BigInt(Math.floor(icpForThis * E8S_ICP));
                    const canisterPrincipal = Principal.fromText(c.canisterId);
                    const subaccount = principalToSubAccount(canisterPrincipal);

                    // Step 1: Transfer ICP to CMC
                    const transferResult = await ledger.icrc1_transfer({
                        to: {
                            owner: cmcPrincipal,
                            subaccount: [subaccount],
                        },
                        amount: amountE8s,
                        fee: [BigInt(ICP_FEE)],
                        memo: [TOP_UP_MEMO],
                        from_subaccount: [],
                        created_at_time: [],
                    });

                    if ('Err' in transferResult) {
                        const err = transferResult.Err;
                        throw new Error('InsufficientFunds' in err
                            ? `Insufficient funds: ${(Number(err.InsufficientFunds.balance) / E8S_ICP).toFixed(4)} ICP`
                            : `Transfer failed: ${JSON.stringify(err)}`);
                    }

                    const blockIndex = transferResult.Ok;

                    // Step 2: Notify CMC
                    const notifyResult = await cmc.notify_top_up({
                        block_index: blockIndex,
                        canister_id: canisterPrincipal,
                    });

                    if ('Err' in notifyResult) {
                        const err = notifyResult.Err;
                        if ('Refunded' in err) throw new Error(`Refunded: ${err.Refunded.reason}`);
                        if ('InvalidTransaction' in err) throw new Error(`Invalid: ${err.InvalidTransaction}`);
                        if ('Other' in err) throw new Error(`CMC: ${err.Other.error_message}`);
                        if ('Processing' in err) throw new Error('Still processing, try again');
                        throw new Error(`CMC error: ${JSON.stringify(err)}`);
                    }

                    const cyclesAdded = Number(notifyResult.Ok);
                    setTopUpStatus(prev => ({ ...prev, [c.canisterId]: 'success' }));
                    setTopUpResults(prev => ({ ...prev, [c.canisterId]: cyclesAdded }));
                } catch (err) {
                    console.error(`Top-up error for ${c.canisterId}:`, err);
                    setTopUpStatus(prev => ({ ...prev, [c.canisterId]: 'error' }));
                    setTopUpErrors(prev => ({ ...prev, [c.canisterId]: err.message || 'Unknown error' }));
                }
            }

            // Refresh balance
            try {
                const bal = await ledger.icrc1_balance_of({
                    owner: identity.getPrincipal(),
                    subaccount: [],
                });
                setIcpBalance(Number(bal) / E8S_ICP);
            } catch (_) {}

        } catch (err) {
            console.error('Top-up process error:', err);
        } finally {
            setIsProcessing(false);
            if (onTopUpComplete) {
                window.dispatchEvent(new Event('neuronManagersRefresh'));
                onTopUpComplete();
            }
        }
    };

    const handleClose = () => {
        if (isProcessing) {
            abortRef.current = true;
        }
        onClose();
    };

    // Handle escape key
    useEffect(() => {
        if (!isOpen) return;
        const handler = (e) => { if (e.key === 'Escape') handleClose(); };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, [isOpen]);

    if (!isOpen) return null;

    const hasFinished = Object.values(topUpStatus).some(s => s === 'success' || s === 'error');
    const allDone = selectedCount > 0 && Object.values(topUpStatus).filter(s => s === 'success' || s === 'error').length === selectedCount;
    const successCount = Object.values(topUpStatus).filter(s => s === 'success').length;

    const canStart = selectedCount > 0 && !isProcessing &&
        (mode === MODE_TO_LEVEL ? (effectiveRate && parsedTargetLevel > 0 && totalToLevel > 0) : (parseFloat(icpAmount) > 0)) &&
        hasEnoughBalance;

    return (
        <div
            onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}
            style={{
                position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                backgroundColor: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                zIndex: 10001, padding: '16px',
            }}
        >
            <div
                onClick={(e) => e.stopPropagation()}
                style={{
                    width: '100%', maxWidth: '520px', maxHeight: '90vh', overflowY: 'auto',
                    backgroundColor: theme.colors.primaryBg, borderRadius: '16px',
                    border: `1px solid ${theme.colors.border}`,
                    boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)',
                }}
            >
                {/* Header */}
                <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '16px 20px', borderBottom: `1px solid ${theme.colors.border}`,
                    position: 'sticky', top: 0, backgroundColor: theme.colors.primaryBg, zIndex: 1,
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <div style={{
                            width: '40px', height: '40px', borderRadius: '50%',
                            backgroundColor: '#ef444420', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}>
                            <FaBolt size={18} style={{ color: '#ef4444' }} />
                        </div>
                        <div>
                            <div style={{ color: theme.colors.primaryText, fontWeight: '600', fontSize: '15px' }}>
                                Top Up Cycles
                            </div>
                            <div style={{ color: theme.colors.mutedText, fontSize: '12px' }}>
                                {lowCyclesCanisters.length} canister{lowCyclesCanisters.length !== 1 ? 's' : ''} below critical level
                            </div>
                        </div>
                    </div>
                    <button
                        onClick={handleClose}
                        style={{
                            background: 'none', border: 'none', cursor: 'pointer', padding: '8px',
                            color: theme.colors.mutedText, display: 'flex', alignItems: 'center',
                        }}
                    >
                        <FaTimes size={18} />
                    </button>
                </div>

                <div style={{ padding: '20px' }}>
                    {/* ICP Balance */}
                    <div style={{
                        padding: '12px 16px', borderRadius: '10px',
                        backgroundColor: theme.colors.secondaryBg, marginBottom: '16px',
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    }}>
                        <span style={{ color: theme.colors.mutedText, fontSize: '13px' }}>Your ICP Balance</span>
                        <span style={{ color: theme.colors.primaryText, fontWeight: '600', fontSize: '14px' }}>
                            {balanceLoading ? '...' : icpBalance !== null ? `${icpBalance.toFixed(4)} ICP` : 'N/A'}
                        </span>
                    </div>

                    {/* Mode Selection */}
                    <div style={{ marginBottom: '16px' }}>
                        <div style={{ color: theme.colors.mutedText, fontSize: '11px', textTransform: 'uppercase', marginBottom: '8px', letterSpacing: '0.5px' }}>
                            Top-Up Mode
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                            {[
                                { id: MODE_TO_LEVEL, label: 'Top up each to a target cycle level', desc: 'Auto-calculates the ICP needed to bring each canister to the specified cycle level' },
                                { id: MODE_SPLIT_EQUAL, label: 'Split ICP equally', desc: 'Divide a total ICP amount equally among selected canisters' },
                                { id: MODE_EACH, label: 'Same amount for each', desc: 'Send the same ICP amount to each selected canister' },
                            ].map(m => (
                                <label
                                    key={m.id}
                                    style={{
                                        display: 'flex', alignItems: 'flex-start', gap: '10px',
                                        padding: '10px 12px', borderRadius: '8px', cursor: isProcessing ? 'default' : 'pointer',
                                        backgroundColor: mode === m.id ? `${theme.colors.accent}10` : 'transparent',
                                        border: `1px solid ${mode === m.id ? theme.colors.accent + '40' : theme.colors.border}`,
                                        transition: 'all 0.15s ease',
                                    }}
                                >
                                    <input
                                        type="radio"
                                        name="topup_mode"
                                        checked={mode === m.id}
                                        onChange={() => !isProcessing && setMode(m.id)}
                                        disabled={isProcessing}
                                        style={{ marginTop: '2px', accentColor: theme.colors.accent }}
                                    />
                                    <div>
                                        <div style={{ color: theme.colors.primaryText, fontSize: '13px', fontWeight: '500' }}>{m.label}</div>
                                        <div style={{ color: theme.colors.mutedText, fontSize: '11px', marginTop: '2px' }}>{m.desc}</div>
                                    </div>
                                </label>
                            ))}
                        </div>
                    </div>

                    {/* Target Cycle Level Input (for to_level mode) */}
                    {mode === MODE_TO_LEVEL && (
                        <div style={{ marginBottom: '16px' }}>
                            <div style={{ color: theme.colors.mutedText, fontSize: '11px', textTransform: 'uppercase', marginBottom: '6px', letterSpacing: '0.5px' }}>
                                Target Cycle Level
                            </div>
                            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                                <input
                                    type="text"
                                    placeholder="e.g. 5T, 1T, 500B"
                                    value={targetCycleLevel}
                                    onChange={(e) => setTargetCycleLevel(e.target.value)}
                                    disabled={isProcessing}
                                    style={{
                                        flex: 1, minWidth: '120px', padding: '10px 12px', borderRadius: '8px',
                                        border: `1px solid ${theme.colors.border}`,
                                        backgroundColor: theme.colors.primaryBg, color: theme.colors.primaryText,
                                        fontSize: '14px', boxSizing: 'border-box',
                                    }}
                                />
                                {(() => {
                                    // Compute the critical and healthy levels
                                    const maxCritical = selectedCanisters.length > 0
                                        ? Math.max(...selectedCanisters.map(c => c.criticalLevel || 0))
                                        : 0;
                                    const maxHealthy = selectedCanisters.length > 0
                                        ? Math.max(...selectedCanisters.map(c => c.healthyLevel || c.criticalLevel || 0))
                                        : 0;

                                    // Compute ICP needed for each level to check affordability
                                    const computeIcpForLevel = (level) => {
                                        if (!effectiveRate || effectiveRate <= 0 || !level) return Infinity;
                                        let total = 0;
                                        for (const c of selectedCanisters) {
                                            const deficit = level - (c.cycles || 0);
                                            if (deficit > 0) {
                                                total += (deficit * 1.1) / effectiveRate;
                                            }
                                        }
                                        return total + (selectedCanisters.length * ICP_FEE / E8S_ICP);
                                    };

                                    const icpForCritical = computeIcpForLevel(maxCritical);
                                    const icpForHealthy = computeIcpForLevel(maxHealthy);
                                    const canAffordCritical = icpBalance !== null && icpBalance >= icpForCritical;
                                    const canAffordHealthy = icpBalance !== null && icpBalance >= icpForHealthy;

                                    const btnStyle = (active) => ({
                                        padding: '7px 12px', borderRadius: '8px', border: 'none',
                                        fontSize: '11px', fontWeight: '600', whiteSpace: 'nowrap',
                                        cursor: isProcessing ? 'not-allowed' : 'pointer',
                                        opacity: isProcessing ? 0.5 : 1,
                                        transition: 'all 0.15s ease',
                                    });

                                    return (<>
                                        <button
                                            onClick={() => !isProcessing && setTargetCycleLevel(formatCyclesCompact(maxCritical))}
                                            disabled={isProcessing}
                                            title={`Set target to just above critical (${formatCyclesCompact(maxCritical)}) — ${canAffordCritical ? `needs ~${icpForCritical.toFixed(4)} ICP` : 'insufficient balance'}`}
                                            style={{
                                                ...btnStyle(),
                                                backgroundColor: canAffordCritical ? '#f59e0b20' : '#ef444415',
                                                color: canAffordCritical ? '#f59e0b' : '#ef444480',
                                            }}
                                        >
                                            Critical
                                        </button>
                                        <button
                                            onClick={() => !isProcessing && setTargetCycleLevel(formatCyclesCompact(maxHealthy))}
                                            disabled={isProcessing}
                                            title={`Set target to healthy (${formatCyclesCompact(maxHealthy)}) — ${canAffordHealthy ? `needs ~${icpForHealthy.toFixed(4)} ICP` : 'insufficient balance'}`}
                                            style={{
                                                ...btnStyle(),
                                                backgroundColor: canAffordHealthy ? '#22c55e20' : '#ef444415',
                                                color: canAffordHealthy ? '#22c55e' : '#ef444480',
                                            }}
                                        >
                                            Healthy
                                        </button>
                                    </>);
                                })()}
                            </div>
                            {parsedTargetLevel > 0 && (
                                <div style={{ marginTop: '6px', fontSize: '11px', color: theme.colors.mutedText }}>
                                    Target: {parsedTargetLevel.toLocaleString()} cycles ({formatCyclesCompact(parsedTargetLevel)})
                                </div>
                            )}
                        </div>
                    )}

                    {/* ICP Amount Input (hidden for to_level mode) */}
                    {mode !== MODE_TO_LEVEL && (
                        <div style={{ marginBottom: '16px' }}>
                            <div style={{ color: theme.colors.mutedText, fontSize: '11px', textTransform: 'uppercase', marginBottom: '6px', letterSpacing: '0.5px' }}>
                                {mode === MODE_SPLIT_EQUAL ? 'Total ICP to Split' : 'ICP per Canister'}
                            </div>
                            <div style={{ display: 'flex', gap: '8px' }}>
                                <input
                                    type="text"
                                    inputMode="decimal"
                                    placeholder="0.00"
                                    value={icpAmount}
                                    onChange={(e) => setIcpAmount(e.target.value)}
                                    disabled={isProcessing}
                                    style={{
                                        flex: 1, padding: '10px 12px', borderRadius: '8px',
                                        border: `1px solid ${theme.colors.border}`,
                                        backgroundColor: theme.colors.primaryBg, color: theme.colors.primaryText,
                                        fontSize: '14px', boxSizing: 'border-box',
                                    }}
                                />
                                <button
                                    onClick={() => {
                                        if (icpBalance && !isProcessing) {
                                            const fees = selectedCount * ICP_FEE / E8S_ICP;
                                            if (mode === MODE_EACH) {
                                                const maxPerCanister = (icpBalance - fees) / selectedCount;
                                                setIcpAmount(Math.max(0, maxPerCanister).toFixed(4));
                                            } else {
                                                setIcpAmount(Math.max(0, icpBalance - fees).toFixed(4));
                                            }
                                        }
                                    }}
                                    disabled={isProcessing || !icpBalance}
                                    style={{
                                        padding: '10px 16px', borderRadius: '8px', border: 'none',
                                        backgroundColor: theme.colors.accent, color: '#fff',
                                        fontSize: '12px', fontWeight: '600',
                                        cursor: isProcessing ? 'not-allowed' : 'pointer',
                                        opacity: isProcessing ? 0.6 : 1,
                                    }}
                                >
                                    MAX
                                </button>
                            </div>
                            {effectiveRate && parseFloat(icpAmount) > 0 && (
                                <div style={{ marginTop: '6px', fontSize: '11px', color: theme.colors.mutedText }}>
                                    ≈ {formatCyclesCompact(parseFloat(icpAmount) * effectiveRate)} cycles
                                    {mode === MODE_SPLIT_EQUAL && selectedCount > 0 && (
                                        <> ({formatCyclesCompact(parseFloat(icpAmount) * effectiveRate / selectedCount)} each)</>
                                    )}
                                </div>
                            )}
                        </div>
                    )}

                    {/* To-level summary */}
                    {mode === MODE_TO_LEVEL && effectiveRate && selectedCount > 0 && parsedTargetLevel > 0 && (
                        <div style={{
                            padding: '12px 16px', borderRadius: '10px', marginBottom: '16px',
                            backgroundColor: `${theme.colors.accent}08`,
                            border: `1px solid ${theme.colors.accent}20`,
                        }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <span style={{ color: theme.colors.mutedText, fontSize: '12px' }}>
                                    Total ICP needed (incl. fees)
                                </span>
                                <span style={{ color: theme.colors.primaryText, fontWeight: '600', fontSize: '14px' }}>
                                    {totalToLevelWithFees.toFixed(4)} ICP
                                </span>
                            </div>
                            {totalToLevel <= 0 && (
                                <div style={{ marginTop: '6px', color: '#22c55e', fontSize: '11px' }}>
                                    All selected canisters are already at or above this level
                                </div>
                            )}
                            {totalToLevel > 0 && !hasEnoughBalance && icpBalance !== null && (
                                <div style={{ marginTop: '6px', color: '#ef4444', fontSize: '11px' }}>
                                    Insufficient balance ({icpBalance.toFixed(4)} ICP available)
                                </div>
                            )}
                        </div>
                    )}

                    {/* Rate loading indicator */}
                    {mode === MODE_TO_LEVEL && !effectiveRate && (
                        <div style={{
                            padding: '12px', borderRadius: '10px', marginBottom: '16px',
                            backgroundColor: theme.colors.secondaryBg, textAlign: 'center',
                            fontSize: '12px', color: theme.colors.mutedText,
                        }}>
                            {rateLoading ? 'Loading conversion rate...' : 'Unable to fetch conversion rate'}
                        </div>
                    )}

                    {/* Total needed (for non-to-level modes) */}
                    {mode !== MODE_TO_LEVEL && parseFloat(icpAmount) > 0 && (
                        <div style={{
                            padding: '10px 14px', borderRadius: '8px', marginBottom: '16px',
                            backgroundColor: theme.colors.secondaryBg,
                            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        }}>
                            <span style={{ color: theme.colors.mutedText, fontSize: '12px' }}>Total ICP needed (incl. fees)</span>
                            <span style={{
                                color: hasEnoughBalance ? theme.colors.primaryText : '#ef4444',
                                fontWeight: '600', fontSize: '13px',
                            }}>
                                {totalIcpNeeded.toFixed(4)} ICP
                            </span>
                        </div>
                    )}

                    {/* Select All / Deselect All */}
                    <div style={{
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        marginBottom: '8px',
                    }}>
                        <span style={{ color: theme.colors.mutedText, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                            Canisters ({selectedCount}/{lowCyclesCanisters.length})
                        </span>
                        <div style={{ display: 'flex', gap: '8px' }}>
                            <button
                                onClick={selectAll}
                                disabled={isProcessing}
                                style={{
                                    background: 'none', border: 'none', color: theme.colors.accent,
                                    fontSize: '11px', cursor: isProcessing ? 'default' : 'pointer', padding: 0,
                                }}
                            >Select all</button>
                            <button
                                onClick={deselectAll}
                                disabled={isProcessing}
                                style={{
                                    background: 'none', border: 'none', color: theme.colors.mutedText,
                                    fontSize: '11px', cursor: isProcessing ? 'default' : 'pointer', padding: 0,
                                }}
                            >Deselect</button>
                        </div>
                    </div>

                    {/* Canister List */}
                    <div style={{
                        maxHeight: '250px', overflowY: 'auto',
                        borderRadius: '10px', border: `1px solid ${theme.colors.border}`,
                        backgroundColor: theme.colors.secondaryBg,
                    }}>
                        {lowCyclesCanisters.map((c, idx) => {
                            const displayInfo = getPrincipalDisplayName(c.canisterId);
                            const isSelected = selected[c.canisterId];
                            const status = topUpStatus[c.canisterId];
                            const error = topUpErrors[c.canisterId];
                            const cyclesAdded = topUpResults[c.canisterId];
                            const deficit = c.criticalLevel - (c.cycles || 0);
                            const icpForThis = mode === MODE_TO_LEVEL
                                ? (toLevelAmounts[c.canisterId] || 0)
                                : mode === MODE_SPLIT_EQUAL
                                    ? ((parseFloat(icpAmount) || 0) / Math.max(selectedCount, 1))
                                    : (parseFloat(icpAmount) || 0);

                            return (
                                <div
                                    key={c.canisterId}
                                    style={{
                                        padding: '10px 14px',
                                        borderBottom: idx < lowCyclesCanisters.length - 1 ? `1px solid ${theme.colors.border}` : 'none',
                                        display: 'flex', alignItems: 'center', gap: '10px',
                                        opacity: (!isSelected && !status) ? 0.5 : 1,
                                        cursor: isProcessing ? 'default' : 'pointer',
                                    }}
                                    onClick={() => toggleSelect(c.canisterId)}
                                >
                                    {/* Checkbox */}
                                    <input
                                        type="checkbox"
                                        checked={isSelected || false}
                                        onChange={() => toggleSelect(c.canisterId)}
                                        disabled={isProcessing}
                                        style={{ accentColor: theme.colors.accent, flexShrink: 0 }}
                                        onClick={(e) => e.stopPropagation()}
                                    />

                                    {/* Info */}
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '2px' }}>
                                            <PrincipalDisplay
                                                principal={c.canisterId}
                                                displayInfo={displayInfo}
                                                showCopyButton={false}
                                                isAuthenticated={true}
                                                noLink={true}
                                                style={{ fontSize: '13px', fontWeight: '500' }}
                                            />
                                            <span style={{
                                                fontSize: '10px', padding: '1px 6px', borderRadius: '8px',
                                                backgroundColor: c.type === 'neuron_manager' ? '#8b5cf620' : `${theme.colors.accent}20`,
                                                color: c.type === 'neuron_manager' ? '#8b5cf6' : theme.colors.accent,
                                            }}>
                                                {c.label}
                                            </span>
                                        </div>
                                        <div style={{ display: 'flex', gap: '12px', fontSize: '11px', color: theme.colors.mutedText }}>
                                            <span style={{ color: '#ef4444' }}>
                                                {formatCyclesCompact(c.cycles)} cycles
                                            </span>
                                            <span>
                                                critical: {formatCyclesCompact(c.criticalLevel)}
                                            </span>
                                            {effectiveRate && isSelected && icpForThis > 0 && (
                                                <span style={{ color: theme.colors.accent }}>
                                                    +{icpForThis.toFixed(4)} ICP
                                                </span>
                                            )}
                                        </div>
                                    </div>

                                    {/* Status */}
                                    {status === 'topping_up' && (
                                        <FaSpinner size={14} style={{ color: theme.colors.accent, animation: 'spin 1s linear infinite', flexShrink: 0 }} />
                                    )}
                                    {status === 'success' && (
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
                                            <FaCheckCircle size={14} style={{ color: '#22c55e' }} />
                                            {cyclesAdded > 0 && (
                                                <span style={{ fontSize: '10px', color: '#22c55e' }}>+{formatCyclesCompact(cyclesAdded)}</span>
                                            )}
                                        </div>
                                    )}
                                    {status === 'error' && (
                                        <div title={error} style={{ flexShrink: 0 }}>
                                            <FaExclamationTriangle size={14} style={{ color: '#ef4444' }} />
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>

                    {/* Action Button */}
                    <div style={{ marginTop: '16px' }}>
                        {allDone ? (
                            <button
                                onClick={handleClose}
                                style={{
                                    width: '100%', padding: '12px', borderRadius: '10px', border: 'none',
                                    backgroundColor: '#22c55e', color: '#fff',
                                    fontSize: '14px', fontWeight: '600', cursor: 'pointer',
                                }}
                            >
                                {successCount === selectedCount ? 'All Done!' : `Done (${successCount}/${selectedCount} succeeded)`}
                            </button>
                        ) : (
                            <button
                                onClick={handleTopUp}
                                disabled={!canStart}
                                style={{
                                    width: '100%', padding: '12px', borderRadius: '10px', border: 'none',
                                    backgroundColor: canStart ? '#ef4444' : theme.colors.secondaryBg,
                                    color: canStart ? '#fff' : theme.colors.mutedText,
                                    fontSize: '14px', fontWeight: '600',
                                    cursor: canStart ? 'pointer' : 'not-allowed',
                                    opacity: canStart ? 1 : 0.6,
                                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                                }}
                            >
                                {isProcessing ? (
                                    <>
                                        <FaSpinner size={14} style={{ animation: 'spin 1s linear infinite' }} />
                                        Processing...
                                    </>
                                ) : (
                                    <>
                                        <FaBolt size={14} />
                                        Top Up {selectedCount} Canister{selectedCount !== 1 ? 's' : ''}
                                    </>
                                )}
                            </button>
                        )}
                    </div>
                </div>
            </div>

            <style>{`
                @keyframes spin {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(360deg); }
                }
            `}</style>
        </div>
    );
}
