import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Principal } from '@dfinity/principal';
import { HttpAgent, Actor } from '@dfinity/agent';
import { FaTimes, FaArrowUp, FaCheckCircle, FaExclamationTriangle, FaSpinner, FaBrain, FaChartLine, FaBox } from 'react-icons/fa';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../AuthContext';
import { useNaming } from '../NamingContext';
import { PrincipalDisplay } from '../utils/PrincipalUtils';
import { useWalletOptional } from '../contexts/WalletContext';

// Management canister IDL with install_code
const MANAGEMENT_CANISTER_ID = Principal.fromText('aaaaa-aa');
const managementCanisterIdlFactory = ({ IDL }) => {
    const install_code_mode = IDL.Variant({
        'install': IDL.Null,
        'reinstall': IDL.Null,
        'upgrade': IDL.Null,
    });
    return IDL.Service({
        'install_code': IDL.Func(
            [IDL.Record({
                'mode': install_code_mode,
                'canister_id': IDL.Principal,
                'wasm_module': IDL.Vec(IDL.Nat8),
                'arg': IDL.Vec(IDL.Nat8),
            })],
            [],
            []
        ),
    });
};

function versionStr(v) {
    if (!v) return '?';
    return `${Number(v.major)}.${Number(v.minor)}.${Number(v.patch)}`;
}

/**
 * Dialog for upgrading outdated app canisters from sneedapp.
 * Supports per-app version tracking — each canister upgrades to its own app's latest version.
 */
export default function UpgradeBotsDialog({ isOpen, onClose, outdatedManagers = [], latestVersion, onUpgradeComplete }) {
    const { theme } = useTheme();
    const { identity } = useAuth();
    const { getPrincipalDisplayName } = useNaming();
    const walletContext = useWalletOptional();
    const appInfoMap = walletContext?.appInfoMap || {};
    const latestVersionByApp = walletContext?.latestVersionByApp || {};

    const getAppLabel = (resolvedAppId) => {
        if (!resolvedAppId) return 'Unknown App';
        const info = appInfoMap[resolvedAppId];
        if (info?.name) return info.name;
        return resolvedAppId;
    };

    const getAppIcon = (resolvedAppId) => {
        if (resolvedAppId === 'sneed-icp-staking-bot') return <FaBrain size={12} style={{ color: '#f59e0b', flexShrink: 0 }} />;
        if (resolvedAppId === 'sneed-trading-bot') return <FaChartLine size={12} style={{ color: '#10b981', flexShrink: 0 }} />;
        return <FaBox size={12} style={{ color: '#8b5cf6', flexShrink: 0 }} />;
    };

    const getTargetVersion = (manager) => {
        const resolvedApp = manager.resolvedAppId || '';
        return latestVersionByApp[resolvedApp] || latestVersion;
    };

    const [selected, setSelected] = useState({}); // canisterId -> boolean
    const [upgradeStatus, setUpgradeStatus] = useState({}); // canisterId -> 'pending' | 'upgrading' | 'success' | 'error'
    const [upgradeErrors, setUpgradeErrors] = useState({}); // canisterId -> error message
    const [isUpgrading, setIsUpgrading] = useState(false);
    const [wasmCache, setWasmCache] = useState({}); // wasmUrl -> Uint8Array, cached per URL
    const abortRef = useRef(false);

    // Count bots with unknown WASM hash (might not be staking bots)
    const unknownHashCount = outdatedManagers.filter(m => !m.hasKnownHash).length;
    const hasUnknownHash = unknownHashCount > 0;

    // Initialize selection when outdatedManagers change
    // Bots with unknown hash are NOT selected by default (safety precaution)
    useEffect(() => {
        if (isOpen && outdatedManagers.length > 0) {
            const newSelected = {};
            outdatedManagers.forEach(m => {
                const id = typeof m.canisterId === 'string' ? m.canisterId : m.canisterId?.toText?.() || m.canisterId?.toString?.() || '';
                newSelected[id] = m.hasKnownHash !== false; // Default OFF for unknown hash
            });
            setSelected(newSelected);
            setUpgradeStatus({});
            setUpgradeErrors({});
            setIsUpgrading(false);
            setWasmCache({});
            abortRef.current = false;
        }
    }, [isOpen, outdatedManagers]);

    const toggleSelect = (canisterId) => {
        if (isUpgrading) return;
        setSelected(prev => ({ ...prev, [canisterId]: !prev[canisterId] }));
    };

    const selectAll = () => {
        if (isUpgrading) return;
        const newSelected = {};
        outdatedManagers.forEach(m => {
            const id = typeof m.canisterId === 'string' ? m.canisterId : m.canisterId?.toText?.() || '';
            newSelected[id] = true;
        });
        setSelected(newSelected);
    };

    const deselectAll = () => {
        if (isUpgrading) return;
        setSelected({});
    };

    const selectedIds = Object.entries(selected).filter(([_, v]) => v).map(([k]) => k);
    const allSelected = outdatedManagers.length > 0 && selectedIds.length === outdatedManagers.length;

    const handleUpgradeAll = useCallback(async () => {
        if (!identity || selectedIds.length === 0) return;

        // Safety check: warn if any selected canisters have unknown WASM
        const unknownSelected = outdatedManagers.filter(m => {
            const id = typeof m.canisterId === 'string' ? m.canisterId : m.canisterId?.toText?.() || m.canisterId?.toString?.() || '';
            return selectedIds.includes(id) && m.hasKnownHash === false;
        });
        if (unknownSelected.length > 0) {
            const confirmed = window.confirm(
                `⚠️ WARNING: ${unknownSelected.length} selected canister${unknownSelected.length !== 1 ? 's have' : ' has'} an unknown WASM.\n\n` +
                `Upgrading ${unknownSelected.length !== 1 ? 'them' : 'it'} with a mismatched app version could break ${unknownSelected.length !== 1 ? 'those canisters' : 'that canister'}.\n\n` +
                `Are you sure you want to proceed?`
            );
            if (!confirmed) return;
        }

        setIsUpgrading(true);
        abortRef.current = false;

        const statusInit = {};
        selectedIds.forEach(id => { statusInit[id] = 'pending'; });
        setUpgradeStatus(statusInit);
        setUpgradeErrors({});

        try {
            const host = process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging'
                ? 'https://icp0.io'
                : 'http://localhost:4943';
            const agent = HttpAgent.createSync({ host, identity });
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
            }
            const emptyArgs = new Uint8Array([0x44, 0x49, 0x44, 0x4C, 0x00, 0x00]);

            // Per-app WASM cache: wasmUrl -> Uint8Array
            const wasmByUrl = { ...wasmCache };

            for (const canisterId of selectedIds) {
                if (abortRef.current) break;
                setUpgradeStatus(prev => ({ ...prev, [canisterId]: 'upgrading' }));

                try {
                    const manager = outdatedManagers.find(m => {
                        const id = typeof m.canisterId === 'string' ? m.canisterId : m.canisterId?.toText?.() || '';
                        return id === canisterId;
                    });
                    const targetVer = manager ? getTargetVersion(manager) : latestVersion;
                    const rawUrl = targetVer?.wasmUrl;
                    const wasmUrl = Array.isArray(rawUrl) ? (rawUrl[0] || '') : (rawUrl || '');
                    if (!wasmUrl) throw new Error('No WASM URL available for this app version');

                    let wasm = wasmByUrl[wasmUrl];
                    if (!wasm) {
                        const response = await fetch(wasmUrl);
                        if (!response.ok) throw new Error(`Failed to fetch WASM: ${response.status}`);
                        const arrayBuffer = await response.arrayBuffer();
                        wasm = new Uint8Array(arrayBuffer);
                        if (wasm.length === 0) throw new Error('Downloaded WASM file is empty');
                        const isWasmMagic = wasm[0] === 0x00 && wasm[1] === 0x61 && wasm[2] === 0x73 && wasm[3] === 0x6D;
                        const isGzip = wasm[0] === 0x1F && wasm[1] === 0x8B;
                        if (!isWasmMagic && !isGzip) throw new Error('Downloaded file is not a valid WASM module');
                        wasmByUrl[wasmUrl] = wasm;
                    }

                    const canisterPrincipal = Principal.fromText(canisterId);
                    const managementCanister = Actor.createActor(managementCanisterIdlFactory, {
                        agent,
                        canisterId: MANAGEMENT_CANISTER_ID,
                        callTransform: (methodName, args, callConfig) => ({
                            ...callConfig,
                            effectiveCanisterId: canisterPrincipal,
                        }),
                    });

                    await managementCanister.install_code({
                        mode: { upgrade: null },
                        canister_id: canisterPrincipal,
                        wasm_module: wasm,
                        arg: emptyArgs,
                    });

                    setUpgradeStatus(prev => ({ ...prev, [canisterId]: 'success' }));
                } catch (err) {
                    setUpgradeStatus(prev => ({ ...prev, [canisterId]: 'error' }));
                    setUpgradeErrors(prev => ({ ...prev, [canisterId]: err.message || 'Unknown error' }));
                }
            }
            setWasmCache(wasmByUrl);
        } catch (err) {
            const errStatus = {};
            selectedIds.forEach(id => { errStatus[id] = 'error'; });
            setUpgradeStatus(errStatus);
            const errMsgs = {};
            selectedIds.forEach(id => { errMsgs[id] = `Setup failed: ${err.message}`; });
            setUpgradeErrors(errMsgs);
        } finally {
            setIsUpgrading(false);
            if (onUpgradeComplete) onUpgradeComplete();
        }
    }, [identity, latestVersion, selectedIds, wasmCache, onUpgradeComplete, outdatedManagers, getTargetVersion]);

    const handleClose = () => {
        if (isUpgrading) {
            abortRef.current = true;
        }
        onClose();
    };

    const successCount = Object.values(upgradeStatus).filter(s => s === 'success').length;
    const errorCount = Object.values(upgradeStatus).filter(s => s === 'error').length;
    const hasResults = successCount > 0 || errorCount > 0;

    if (!isOpen) return null;

    return (
        <div
            style={{
                position: 'fixed',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                backgroundColor: 'rgba(0,0,0,0.6)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 10000,
                padding: '20px',
            }}
            onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}
        >
            <div
                style={{
                    backgroundColor: theme.colors.primaryBg,
                    borderRadius: '16px',
                    border: `1px solid ${theme.colors.border}`,
                    maxWidth: '520px',
                    width: '100%',
                    maxHeight: '80vh',
                    display: 'flex',
                    flexDirection: 'column',
                    boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
                }}
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '16px 20px',
                    borderBottom: `1px solid ${theme.colors.border}`,
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <FaArrowUp size={16} style={{ color: '#8b5cf6' }} />
                        <span style={{ fontSize: '16px', fontWeight: '700', color: theme.colors.primaryText }}>
                            Upgrade Apps
                        </span>
                    </div>
                    <button
                        onClick={handleClose}
                        style={{
                            background: 'none',
                            border: 'none',
                            cursor: 'pointer',
                            padding: '4px',
                            color: theme.colors.mutedText,
                            display: 'flex',
                        }}
                    >
                        <FaTimes size={16} />
                    </button>
                </div>

                {/* Body */}
                <div style={{ padding: '16px 20px', overflowY: 'auto', flex: 1 }}>
                    {outdatedManagers.length === 0 ? (
                        <div style={{ textAlign: 'center', color: theme.colors.mutedText, padding: '20px' }}>
                            All apps are up to date.
                        </div>
                    ) : (
                        <>
                            {/* Warning banner for bots with unknown WASM */}
                            {hasUnknownHash && (
                                <div style={{
                                    display: 'flex',
                                    alignItems: 'flex-start',
                                    gap: '8px',
                                    padding: '10px 12px',
                                    borderRadius: '10px',
                                    background: 'rgba(245, 158, 11, 0.1)',
                                    border: '1px solid rgba(245, 158, 11, 0.3)',
                                    marginBottom: '12px',
                                    fontSize: '12px',
                                    color: '#f59e0b',
                                    lineHeight: '1.4',
                                }}>
                                    <FaExclamationTriangle size={14} style={{ flexShrink: 0, marginTop: '1px' }} />
                                    <div>
                                        <strong>{unknownHashCount} canister{unknownHashCount !== 1 ? 's' : ''}</strong> {unknownHashCount !== 1 ? 'have' : 'has'} an unrecognized WASM.
                                        Upgrading with a mismatched app version could break {unknownHashCount !== 1 ? 'those canisters' : 'that canister'}.
                                        {unknownHashCount !== 1 ? ' They are' : ' It is'} deselected by default — only select if you are sure.
                                    </div>
                                </div>
                            )}

                            <div style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                marginBottom: '12px',
                            }}>
                                <span style={{ fontSize: '12px', color: theme.colors.mutedText }}>
                                    {outdatedManagers.length} app{outdatedManagers.length !== 1 ? 's' : ''} outdated
                                </span>
                                <button
                                    onClick={allSelected ? deselectAll : selectAll}
                                    disabled={isUpgrading}
                                    style={{
                                        background: 'none',
                                        border: 'none',
                                        cursor: isUpgrading ? 'not-allowed' : 'pointer',
                                        color: '#8b5cf6',
                                        fontSize: '12px',
                                        fontWeight: '500',
                                        padding: '2px 6px',
                                        opacity: isUpgrading ? 0.5 : 1,
                                    }}
                                >
                                    {allSelected ? 'Deselect all' : 'Select all'}
                                </button>
                            </div>

                            {outdatedManagers.map(manager => {
                                const canisterId = typeof manager.canisterId === 'string'
                                    ? manager.canisterId
                                    : manager.canisterId?.toText?.() || manager.canisterId?.toString?.() || '';
                                const isChecked = selected[canisterId] || false;
                                const status = upgradeStatus[canisterId];
                                const error = upgradeErrors[canisterId];
                                const displayInfo = getPrincipalDisplayName ? getPrincipalDisplayName(canisterId) : null;

                                return (
                                    <div
                                        key={canisterId}
                                        style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '10px',
                                            padding: '10px 12px',
                                            borderRadius: '10px',
                                            marginBottom: '6px',
                                            background: status === 'success' ? '#22c55e10'
                                                : status === 'error' ? '#ef444410'
                                                : theme.colors.secondaryBg,
                                            border: `1px solid ${
                                                status === 'success' ? '#22c55e30'
                                                : status === 'error' ? '#ef444430'
                                                : theme.colors.border
                                            }`,
                                            cursor: isUpgrading ? 'default' : 'pointer',
                                            transition: 'all 0.15s ease',
                                        }}
                                        onClick={() => toggleSelect(canisterId)}
                                    >
                                        {/* Checkbox */}
                                        <div style={{
                                            width: '18px',
                                            height: '18px',
                                            borderRadius: '4px',
                                            border: `2px solid ${isChecked ? '#8b5cf6' : theme.colors.border}`,
                                            backgroundColor: isChecked ? '#8b5cf6' : 'transparent',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            flexShrink: 0,
                                            transition: 'all 0.15s ease',
                                            opacity: isUpgrading ? 0.5 : 1,
                                        }}>
                                            {isChecked && (
                                                <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                                                    <path d="M1 4L3.5 6.5L9 1" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                                                </svg>
                                            )}
                                        </div>

                                        {/* App info */}
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                {getAppIcon(manager.resolvedAppId)}
                                                <PrincipalDisplay
                                                    principal={canisterId}
                                                    displayInfo={displayInfo}
                                                    showCopyButton={false}
                                                    isAuthenticated={true}
                                                    noLink={true}
                                                    style={{
                                                        fontSize: '13px',
                                                        fontWeight: '500',
                                                        overflow: 'hidden',
                                                        textOverflow: 'ellipsis',
                                                        whiteSpace: 'nowrap',
                                                    }}
                                                />
                                            </div>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '2px', flexWrap: 'wrap' }}>
                                                <span style={{
                                                    fontSize: '11px',
                                                    color: '#8b5cf6',
                                                    fontWeight: '500',
                                                    background: '#8b5cf610',
                                                    padding: '0 5px',
                                                    borderRadius: '4px',
                                                }}>
                                                    {getAppLabel(manager.resolvedAppId)}
                                                </span>
                                                <span style={{
                                                    fontSize: '11px',
                                                    color: '#f59e0b',
                                                    fontWeight: '500',
                                                }}>
                                                    v{versionStr(manager.version)}
                                                </span>
                                                <span style={{ fontSize: '10px', color: theme.colors.mutedText }}>→</span>
                                                <span style={{
                                                    fontSize: '11px',
                                                    color: '#22c55e',
                                                    fontWeight: '500',
                                                }}>
                                                    v{versionStr(getTargetVersion(manager))}
                                                </span>
                                                {manager.hasKnownHash === false && (
                                                    <span style={{
                                                        display: 'inline-flex',
                                                        alignItems: 'center',
                                                        gap: '3px',
                                                        fontSize: '10px',
                                                        color: '#f59e0b',
                                                        fontWeight: '600',
                                                        background: 'rgba(245, 158, 11, 0.1)',
                                                        border: '1px solid rgba(245, 158, 11, 0.25)',
                                                        borderRadius: '8px',
                                                        padding: '1px 6px',
                                                    }}>
                                                        <FaExclamationTriangle size={8} />
                                                        Unknown WASM
                                                    </span>
                                                )}
                                            </div>
                                            {error && (
                                                <div style={{
                                                    fontSize: '10px',
                                                    color: '#ef4444',
                                                    marginTop: '4px',
                                                    wordBreak: 'break-word',
                                                }}>
                                                    {error}
                                                </div>
                                            )}
                                        </div>

                                        {/* Status indicator */}
                                        <div style={{ flexShrink: 0 }}>
                                            {status === 'upgrading' && (
                                                <FaSpinner size={14} style={{ color: '#8b5cf6', animation: 'spin 1s linear infinite' }} />
                                            )}
                                            {status === 'success' && (
                                                <FaCheckCircle size={14} style={{ color: '#22c55e' }} />
                                            )}
                                            {status === 'error' && (
                                                <FaExclamationTriangle size={14} style={{ color: '#ef4444' }} />
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </>
                    )}
                </div>

                {/* Footer */}
                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '12px 20px',
                    borderTop: `1px solid ${theme.colors.border}`,
                }}>
                    {hasResults ? (
                        <span style={{ fontSize: '12px', color: theme.colors.mutedText }}>
                            {successCount > 0 && <span style={{ color: '#22c55e' }}>{successCount} upgraded</span>}
                            {successCount > 0 && errorCount > 0 && ', '}
                            {errorCount > 0 && <span style={{ color: '#ef4444' }}>{errorCount} failed</span>}
                        </span>
                    ) : (
                        <span style={{ fontSize: '12px', color: theme.colors.mutedText }}>
                            {selectedIds.length} of {outdatedManagers.length} selected
                        </span>
                    )}
                    <div style={{ display: 'flex', gap: '8px' }}>
                        <button
                            onClick={handleClose}
                            style={{
                                padding: '8px 16px',
                                borderRadius: '8px',
                                border: `1px solid ${theme.colors.border}`,
                                backgroundColor: 'transparent',
                                color: theme.colors.primaryText,
                                fontSize: '13px',
                                cursor: 'pointer',
                                fontWeight: '500',
                            }}
                        >
                            {hasResults ? 'Done' : 'Cancel'}
                        </button>
                        {!hasResults && (
                            <button
                                onClick={handleUpgradeAll}
                                disabled={isUpgrading || selectedIds.length === 0}
                                style={{
                                    padding: '8px 16px',
                                    borderRadius: '8px',
                                    border: 'none',
                                    backgroundColor: selectedIds.length === 0 || isUpgrading ? '#8b5cf640' : '#8b5cf6',
                                    color: '#fff',
                                    fontSize: '13px',
                                    cursor: selectedIds.length === 0 || isUpgrading ? 'not-allowed' : 'pointer',
                                    fontWeight: '600',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '6px',
                                }}
                            >
                                {isUpgrading ? (
                                    <><FaSpinner size={12} style={{ animation: 'spin 1s linear infinite' }} /> Upgrading...</>
                                ) : (
                                    <><FaArrowUp size={12} /> Upgrade {selectedIds.length > 1 ? `${selectedIds.length} apps` : 'app'}</>
                                )}
                            </button>
                        )}
                        {hasResults && errorCount > 0 && (
                            <button
                                onClick={handleUpgradeAll}
                                disabled={isUpgrading}
                                style={{
                                    padding: '8px 16px',
                                    borderRadius: '8px',
                                    border: 'none',
                                    backgroundColor: isUpgrading ? '#8b5cf640' : '#8b5cf6',
                                    color: '#fff',
                                    fontSize: '13px',
                                    cursor: isUpgrading ? 'not-allowed' : 'pointer',
                                    fontWeight: '600',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '6px',
                                }}
                            >
                                Retry failed
                            </button>
                        )}
                    </div>
                </div>
            </div>

            {/* Spin animation (in case not globally available) */}
            <style>{`
                @keyframes spin {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(360deg); }
                }
            `}</style>
        </div>
    );
}
