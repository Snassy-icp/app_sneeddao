import React, { useState, useEffect } from 'react';
import { useAuth } from '../AuthContext';
import { useSearchParams } from 'react-router-dom';
import Header from '../components/Header';
import { useTheme } from '../contexts/ThemeContext';
import { Principal } from '@dfinity/principal';
import { Actor, HttpAgent } from '@dfinity/agent';
import { getCanisterInfo } from '../utils/BackendUtils';
import { PrincipalDisplay, getPrincipalDisplayInfoFromContext } from '../utils/PrincipalUtils';
import { useNaming } from '../NamingContext';

// IDL factory for IC management canister canister_status call
const managementCanisterIdlFactory = ({ IDL }) => {
    const definite_canister_settings = IDL.Record({
        'controllers': IDL.Vec(IDL.Principal),
        'freezing_threshold': IDL.Nat,
        'memory_allocation': IDL.Nat,
        'compute_allocation': IDL.Nat,
        'reserved_cycles_limit': IDL.Nat,
        'log_visibility': IDL.Variant({
            'controllers': IDL.Null,
            'public': IDL.Null,
        }),
        'wasm_memory_limit': IDL.Nat,
    });
    const canister_status_result = IDL.Record({
        'status': IDL.Variant({
            'running': IDL.Null,
            'stopping': IDL.Null,
            'stopped': IDL.Null,
        }),
        'settings': definite_canister_settings,
        'module_hash': IDL.Opt(IDL.Vec(IDL.Nat8)),
        'memory_size': IDL.Nat,
        'cycles': IDL.Nat,
        'idle_cycles_burned_per_day': IDL.Nat,
        'query_stats': IDL.Record({
            'num_calls_total': IDL.Nat,
            'num_instructions_total': IDL.Nat,
            'request_payload_bytes_total': IDL.Nat,
            'response_payload_bytes_total': IDL.Nat,
        }),
        'reserved_cycles': IDL.Nat,
    });
    return IDL.Service({
        'canister_status': IDL.Func(
            [IDL.Record({ 'canister_id': IDL.Principal })],
            [canister_status_result],
            []
        ),
    });
};

// Helper to get the host URL based on environment
const getHost = () => process.env.DFX_NETWORK === 'ic' ? 'https://icp0.io' : 'http://localhost:4943';

// Helper function to convert Uint8Array to hex string
const uint8ArrayToHex = (arr) => {
    if (!arr) return null;
    return Array.from(arr)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
};

export default function CanisterPage() {
    const { theme } = useTheme();
    const { identity, isAuthenticated } = useAuth();
    const { principalNames, principalNicknames } = useNaming();
    const [searchParams, setSearchParams] = useSearchParams();
    const [canisterInput, setCanisterInput] = useState('');
    const [canisterInfo, setCanisterInfo] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [fetchMethod, setFetchMethod] = useState(null); // 'canister_status' or 'canister_info'
    const [principalDisplayInfo, setPrincipalDisplayInfo] = useState(new Map());

    const canisterIdParam = searchParams.get('id');

    // Initialize input from URL parameter
    useEffect(() => {
        if (canisterIdParam) {
            setCanisterInput(canisterIdParam);
        }
    }, [canisterIdParam]);

    // Fetch canister info when URL parameter changes
    useEffect(() => {
        if (canisterIdParam) {
            fetchCanisterInfo(canisterIdParam);
        } else {
            setCanisterInfo(null);
            setFetchMethod(null);
            setError(null);
        }
    }, [canisterIdParam, identity]);

    // Update principal display info for controllers
    useEffect(() => {
        const updatePrincipalDisplayInfo = async () => {
            if (!canisterInfo?.controllers || !principalNames || !principalNicknames) return;

            const displayInfoMap = new Map();
            for (const controller of canisterInfo.controllers) {
                try {
                    const principal = typeof controller === 'string' 
                        ? Principal.fromText(controller) 
                        : controller;
                    const displayInfo = getPrincipalDisplayInfoFromContext(principal, principalNames, principalNicknames);
                    displayInfoMap.set(principal.toString(), displayInfo);
                } catch (e) {
                    console.error('Error getting principal display info:', e);
                }
            }
            setPrincipalDisplayInfo(displayInfoMap);
        };

        updatePrincipalDisplayInfo();
    }, [canisterInfo, principalNames, principalNicknames]);

    const fetchCanisterInfo = async (canisterId) => {
        setLoading(true);
        setError(null);
        setCanisterInfo(null);
        setFetchMethod(null);

        try {
            // Validate canister ID
            let canisterPrincipal;
            try {
                canisterPrincipal = Principal.fromText(canisterId);
            } catch (e) {
                setError('Invalid canister ID format');
                setLoading(false);
                return;
            }

            // First, try canister_status if user is authenticated (might be controller)
            if (identity) {
                try {
                    const host = getHost();
                    const agent = new HttpAgent({
                        host,
                        identity,
                    });

                    if (process.env.DFX_NETWORK !== 'ic') {
                        await agent.fetchRootKey();
                    }

                    const managementCanister = Actor.createActor(managementCanisterIdlFactory, {
                        agent,
                        canisterId: Principal.fromText('aaaaa-aa')
                    });

                    const status = await managementCanister.canister_status({
                        canister_id: canisterPrincipal
                    });

                    // Success! User is a controller
                    setCanisterInfo({
                        controllers: status.settings.controllers,
                        moduleHash: status.module_hash[0] ? uint8ArrayToHex(status.module_hash[0]) : null,
                        status: Object.keys(status.status)[0],
                        cycles: status.cycles,
                        memorySize: status.memory_size,
                        idleCyclesBurnedPerDay: status.idle_cycles_burned_per_day
                    });
                    setFetchMethod('canister_status');
                    setLoading(false);
                    return;
                } catch (statusError) {
                    console.log('canister_status failed (user is not controller), falling back to canister_info:', statusError.message);
                    // Fall through to canister_info
                }
            }

            // Fallback: use backend's canister_info call
            try {
                const result = await getCanisterInfo(identity, canisterId);
                
                if ('ok' in result) {
                    setCanisterInfo({
                        controllers: result.ok.controllers,
                        moduleHash: result.ok.module_hash[0] ? uint8ArrayToHex(result.ok.module_hash[0]) : null
                    });
                    setFetchMethod('canister_info');
                } else if ('err' in result) {
                    setError(result.err);
                } else {
                    setError('Unexpected response from backend');
                }
            } catch (infoError) {
                console.error('canister_info also failed:', infoError);
                setError('Failed to fetch canister info: ' + (infoError.message || 'Unknown error'));
            }
        } catch (e) {
            console.error('Error fetching canister info:', e);
            setError('Failed to fetch canister info: ' + (e.message || 'Unknown error'));
        } finally {
            setLoading(false);
        }
    };

    const handleInputChange = (e) => {
        setCanisterInput(e.target.value);
    };

    const handleSubmit = (e) => {
        e.preventDefault();
        if (canisterInput.trim()) {
            try {
                // Validate principal ID
                Principal.fromText(canisterInput.trim());
                setSearchParams({ id: canisterInput.trim() });
            } catch (err) {
                setError('Invalid canister ID format');
            }
        }
    };

    const handleKeyDown = (e) => {
        if (e.key === 'Enter') {
            handleSubmit(e);
        }
    };

    return (
        <div className='page-container' style={{ background: theme.colors.primaryGradient, minHeight: '100vh' }}>
            <Header showSnsDropdown={false} />
            <main className="wallet-container">
                {/* Search Section */}
                <div style={{ 
                    backgroundColor: theme.colors.secondaryBg,
                    borderRadius: '8px',
                    padding: '20px',
                    marginBottom: '20px',
                    border: `1px solid ${theme.colors.border}`
                }}>
                    <h2 style={{ 
                        color: theme.colors.primaryText,
                        margin: '0 0 15px 0',
                        fontSize: '18px',
                        fontWeight: '500'
                    }}>
                        Canister Info Lookup
                    </h2>
                    <form onSubmit={handleSubmit} style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                        <input
                            type="text"
                            value={canisterInput}
                            onChange={handleInputChange}
                            onKeyDown={handleKeyDown}
                            placeholder="Enter canister ID"
                            style={{
                                flex: '1',
                                minWidth: '300px',
                                padding: '10px 12px',
                                border: `1px solid ${theme.colors.border}`,
                                borderRadius: '4px',
                                backgroundColor: theme.colors.tertiaryBg,
                                color: theme.colors.primaryText,
                                fontSize: '14px',
                                outline: 'none'
                            }}
                        />
                        <button
                            type="submit"
                            disabled={loading}
                            style={{
                                backgroundColor: theme.colors.accent,
                                color: theme.colors.primaryText,
                                border: 'none',
                                borderRadius: '4px',
                                padding: '10px 20px',
                                cursor: loading ? 'not-allowed' : 'pointer',
                                opacity: loading ? 0.7 : 1,
                                fontSize: '14px',
                                fontWeight: '500'
                            }}
                        >
                            {loading ? 'Loading...' : 'Lookup'}
                        </button>
                    </form>
                    <p style={{ 
                        color: theme.colors.mutedText, 
                        fontSize: '12px', 
                        marginTop: '10px',
                        marginBottom: 0 
                    }}>
                        {isAuthenticated 
                            ? 'If you are a controller of the canister, full status will be shown. Otherwise, basic info will be retrieved from the IC.'
                            : 'Login to see full canister status if you are a controller.'}
                    </p>
                </div>

                {/* Error Display */}
                {error && (
                    <div style={{ 
                        backgroundColor: `${theme.colors.error}20`, 
                        border: `1px solid ${theme.colors.error}`,
                        color: theme.colors.error,
                        padding: '15px',
                        borderRadius: '6px',
                        marginBottom: '20px'
                    }}>
                        {error}
                    </div>
                )}

                {/* Loading State */}
                {loading && (
                    <div style={{ 
                        backgroundColor: theme.colors.secondaryBg,
                        borderRadius: '8px',
                        padding: '40px',
                        textAlign: 'center',
                        border: `1px solid ${theme.colors.border}`
                    }}>
                        <div style={{ color: theme.colors.mutedText, fontSize: '16px' }}>
                            Loading canister info...
                        </div>
                    </div>
                )}

                {/* Canister Info Display */}
                {!loading && canisterInfo && (
                    <div style={{ 
                        backgroundColor: theme.colors.secondaryBg,
                        borderRadius: '8px',
                        padding: '20px',
                        border: `1px solid ${theme.colors.border}`
                    }}>
                        <div style={{ 
                            display: 'flex', 
                            justifyContent: 'space-between', 
                            alignItems: 'center',
                            marginBottom: '20px',
                            flexWrap: 'wrap',
                            gap: '10px'
                        }}>
                            <h2 style={{ 
                                color: theme.colors.primaryText,
                                margin: '0',
                                fontSize: '18px',
                                fontWeight: '500'
                            }}>
                                Canister Details
                            </h2>
                            <span style={{
                                backgroundColor: fetchMethod === 'canister_status' ? `${theme.colors.success}30` : `${theme.colors.accent}30`,
                                color: fetchMethod === 'canister_status' ? theme.colors.success : theme.colors.accent,
                                padding: '4px 8px',
                                borderRadius: '4px',
                                fontSize: '12px'
                            }}>
                                {fetchMethod === 'canister_status' ? 'Controller Access' : 'Public Info'}
                            </span>
                        </div>

                        {/* Canister ID */}
                        <div style={{ marginBottom: '20px' }}>
                            <div style={{ 
                                color: theme.colors.mutedText, 
                                fontSize: '12px',
                                marginBottom: '4px'
                            }}>
                                Canister ID
                            </div>
                            <div style={{ 
                                color: theme.colors.primaryText, 
                                fontSize: '14px',
                                fontFamily: 'monospace',
                                backgroundColor: theme.colors.tertiaryBg,
                                padding: '8px 12px',
                                borderRadius: '4px',
                                wordBreak: 'break-all'
                            }}>
                                {canisterIdParam}
                            </div>
                        </div>

                        {/* Status (if available from canister_status) */}
                        {canisterInfo.status && (
                            <div style={{ marginBottom: '20px' }}>
                                <div style={{ 
                                    color: theme.colors.mutedText, 
                                    fontSize: '12px',
                                    marginBottom: '4px'
                                }}>
                                    Status
                                </div>
                                <div style={{ 
                                    display: 'inline-block',
                                    backgroundColor: canisterInfo.status === 'running' 
                                        ? `${theme.colors.success}30` 
                                        : canisterInfo.status === 'stopped' 
                                            ? `${theme.colors.error}30` 
                                            : `${theme.colors.warning}30`,
                                    color: canisterInfo.status === 'running' 
                                        ? theme.colors.success 
                                        : canisterInfo.status === 'stopped' 
                                            ? theme.colors.error 
                                            : theme.colors.warning,
                                    padding: '6px 12px',
                                    borderRadius: '4px',
                                    fontSize: '14px',
                                    fontWeight: '500',
                                    textTransform: 'capitalize'
                                }}>
                                    {canisterInfo.status}
                                </div>
                            </div>
                        )}

                        {/* Cycles (if available from canister_status) */}
                        {canisterInfo.cycles !== undefined && (
                            <div style={{ marginBottom: '20px' }}>
                                <div style={{ 
                                    color: theme.colors.mutedText, 
                                    fontSize: '12px',
                                    marginBottom: '4px'
                                }}>
                                    Cycles
                                </div>
                                <div style={{ 
                                    color: theme.colors.primaryText, 
                                    fontSize: '14px'
                                }}>
                                    {(Number(canisterInfo.cycles) / 1_000_000_000_000).toFixed(4)} T
                                </div>
                            </div>
                        )}

                        {/* Memory Size (if available from canister_status) */}
                        {canisterInfo.memorySize !== undefined && (
                            <div style={{ marginBottom: '20px' }}>
                                <div style={{ 
                                    color: theme.colors.mutedText, 
                                    fontSize: '12px',
                                    marginBottom: '4px'
                                }}>
                                    Memory Size
                                </div>
                                <div style={{ 
                                    color: theme.colors.primaryText, 
                                    fontSize: '14px'
                                }}>
                                    {(Number(canisterInfo.memorySize) / (1024 * 1024)).toFixed(2)} MB
                                </div>
                            </div>
                        )}

                        {/* Module Hash */}
                        <div style={{ marginBottom: '20px' }}>
                            <div style={{ 
                                color: theme.colors.mutedText, 
                                fontSize: '12px',
                                marginBottom: '4px'
                            }}>
                                Module Hash
                            </div>
                            <div style={{ 
                                color: theme.colors.primaryText, 
                                fontSize: '14px',
                                fontFamily: 'monospace',
                                backgroundColor: theme.colors.tertiaryBg,
                                padding: '8px 12px',
                                borderRadius: '4px',
                                wordBreak: 'break-all'
                            }}>
                                {canisterInfo.moduleHash || (
                                    <span style={{ color: theme.colors.mutedText, fontStyle: 'italic' }}>
                                        No module installed
                                    </span>
                                )}
                            </div>
                        </div>

                        {/* Controllers */}
                        <div>
                            <div style={{ 
                                color: theme.colors.mutedText, 
                                fontSize: '12px',
                                marginBottom: '8px'
                            }}>
                                Controllers ({canisterInfo.controllers?.length || 0})
                            </div>
                            <div style={{
                                backgroundColor: theme.colors.tertiaryBg,
                                borderRadius: '4px',
                                padding: '12px'
                            }}>
                                {canisterInfo.controllers && canisterInfo.controllers.length > 0 ? (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                        {canisterInfo.controllers.map((controller, index) => {
                                            const controllerStr = typeof controller === 'string' 
                                                ? controller 
                                                : controller.toString();
                                            const displayInfo = principalDisplayInfo.get(controllerStr);
                                            
                                            return (
                                                <div 
                                                    key={index}
                                                    style={{
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: '8px',
                                                        padding: '8px',
                                                        backgroundColor: theme.colors.secondaryBg,
                                                        borderRadius: '4px'
                                                    }}
                                                >
                                                    <PrincipalDisplay
                                                        principal={typeof controller === 'string' 
                                                            ? Principal.fromText(controller) 
                                                            : controller}
                                                        displayInfo={displayInfo}
                                                        showCopyButton={true}
                                                        isAuthenticated={isAuthenticated}
                                                        style={{ fontSize: '14px' }}
                                                    />
                                                </div>
                                            );
                                        })}
                                    </div>
                                ) : (
                                    <div style={{ 
                                        color: theme.colors.mutedText, 
                                        fontStyle: 'italic',
                                        padding: '8px'
                                    }}>
                                        No controllers
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                )}

                {/* No Canister Selected */}
                {!loading && !canisterInfo && !error && !canisterIdParam && (
                    <div style={{ 
                        backgroundColor: theme.colors.secondaryBg,
                        borderRadius: '8px',
                        padding: '40px',
                        textAlign: 'center',
                        border: `1px solid ${theme.colors.border}`
                    }}>
                        <h2 style={{ color: theme.colors.primaryText, marginBottom: '10px' }}>
                            No Canister Selected
                        </h2>
                        <p style={{ color: theme.colors.mutedText }}>
                            Enter a canister ID above to view its information.
                        </p>
                    </div>
                )}
            </main>
        </div>
    );
}

