import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../AuthContext';
import { useSearchParams } from 'react-router-dom';
import Header from '../components/Header';
import { useTheme } from '../contexts/ThemeContext';
import { Principal } from '@dfinity/principal';
import { Actor, HttpAgent } from '@dfinity/agent';
import { getCanisterInfo, setCanisterName, setPrincipalNickname } from '../utils/BackendUtils';
import { PrincipalDisplay, getPrincipalDisplayInfoFromContext } from '../utils/PrincipalUtils';
import { useNaming } from '../NamingContext';
import { FaEdit, FaSave, FaTimes } from 'react-icons/fa';

// Management canister ID
const MANAGEMENT_CANISTER_ID = Principal.fromText('aaaaa-aa');

// IDL factory for IC management canister
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
    // Settings for update_settings - all fields are optional
    const canister_settings = IDL.Record({
        'controllers': IDL.Opt(IDL.Vec(IDL.Principal)),
        'compute_allocation': IDL.Opt(IDL.Nat),
        'memory_allocation': IDL.Opt(IDL.Nat),
        'freezing_threshold': IDL.Opt(IDL.Nat),
        'reserved_cycles_limit': IDL.Opt(IDL.Nat),
        'log_visibility': IDL.Opt(IDL.Variant({
            'controllers': IDL.Null,
            'public': IDL.Null,
        })),
        'wasm_memory_limit': IDL.Opt(IDL.Nat),
    });
    return IDL.Service({
        'canister_status': IDL.Func(
            [IDL.Record({ 'canister_id': IDL.Principal })],
            [canister_status_result],
            []
        ),
        'update_settings': IDL.Func(
            [IDL.Record({
                'canister_id': IDL.Principal,
                'settings': canister_settings,
            })],
            [],
            []
        ),
    });
};

// Helper to get the host URL based on environment
const getHost = () => process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging' ? 'https://icp0.io' : 'http://localhost:4943';

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
    const requestIdRef = useRef(0); // Track current request to prevent race conditions
    
    // Controller management state
    const [newControllerInput, setNewControllerInput] = useState('');
    const [updating, setUpdating] = useState(false);
    const [confirmRemove, setConfirmRemove] = useState(null); // Principal string to confirm removal
    const [successMessage, setSuccessMessage] = useState(null);
    
    // Canister naming state
    const [isEditingName, setIsEditingName] = useState(false);
    const [isEditingNickname, setIsEditingNickname] = useState(false);
    const [nameInput, setNameInput] = useState('');
    const [nicknameInput, setNicknameInput] = useState('');
    const [savingName, setSavingName] = useState(false);
    const [savingNickname, setSavingNickname] = useState(false);

    const canisterIdParam = searchParams.get('id');
    
    // Get current user's principal for self-removal warning
    const currentUserPrincipal = identity?.getPrincipal?.()?.toString?.();

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
        // Increment request ID to track this specific request
        const currentRequestId = ++requestIdRef.current;
        
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
                    const agent = HttpAgent.createSync({
                        host,
                        identity,
                    });

                    if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                        await agent.fetchRootKey();
                    }

                    // Create actor for management canister with callTransform to set effectiveCanisterId
                    const managementCanister = Actor.createActor(managementCanisterIdlFactory, {
                        agent,
                        canisterId: MANAGEMENT_CANISTER_ID,
                        // Use callTransform to inject effectiveCanisterId for proper routing
                        callTransform: (methodName, args, callConfig) => {
                            return {
                                ...callConfig,
                                effectiveCanisterId: canisterPrincipal,
                            };
                        },
                    });

                    console.log('Calling canister_status on management canister for:', canisterPrincipal.toString());
                    const status = await managementCanister.canister_status({
                        canister_id: canisterPrincipal
                    });

                    // Check if this request is still the current one (prevent race conditions)
                    if (currentRequestId !== requestIdRef.current) {
                        console.log('canister_status completed but request is stale, ignoring');
                        return;
                    }

                    console.log('canister_status SUCCESS! User is a controller. Status:', status);

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

            // Check if this request is still the current one before fallback
            if (currentRequestId !== requestIdRef.current) {
                console.log('Request is stale before fallback, ignoring');
                return;
            }

            // Fallback: use backend's canister_info call
            console.log('Using backend canister_info fallback...');
            try {
                const result = await getCanisterInfo(identity, canisterId);
                
                // Check again after async call
                if (currentRequestId !== requestIdRef.current) {
                    console.log('canister_info completed but request is stale, ignoring');
                    return;
                }
                
                console.log('canister_info result:', result);
                
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

    // Update controllers on the canister
    const updateControllers = async (newControllers) => {
        if (!identity || !canisterIdParam) return;
        
        setUpdating(true);
        setError(null);
        setSuccessMessage(null);
        
        try {
            const canisterPrincipal = Principal.fromText(canisterIdParam);
            const host = getHost();
            const agent = HttpAgent.createSync({
                host,
                identity,
            });

            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
            }

            const managementCanister = Actor.createActor(managementCanisterIdlFactory, {
                agent,
                canisterId: MANAGEMENT_CANISTER_ID,
                callTransform: (methodName, args, callConfig) => {
                    return {
                        ...callConfig,
                        effectiveCanisterId: canisterPrincipal,
                    };
                },
            });

            console.log('Updating controllers to:', newControllers.map(c => c.toString()));
            
            await managementCanister.update_settings({
                canister_id: canisterPrincipal,
                settings: {
                    controllers: [newControllers],
                    compute_allocation: [],
                    memory_allocation: [],
                    freezing_threshold: [],
                    reserved_cycles_limit: [],
                    log_visibility: [],
                    wasm_memory_limit: [],
                },
            });

            console.log('Controllers updated successfully!');
            setSuccessMessage('Controllers updated successfully!');
            
            // Refresh canister info
            await fetchCanisterInfo(canisterIdParam);
            
        } catch (e) {
            console.error('Failed to update controllers:', e);
            setError('Failed to update controllers: ' + (e.message || 'Unknown error'));
        } finally {
            setUpdating(false);
        }
    };

    // Add a new controller
    const handleAddController = async () => {
        if (!newControllerInput.trim()) return;
        
        try {
            const newControllerPrincipal = Principal.fromText(newControllerInput.trim());
            
            // Check if already a controller
            const currentControllers = canisterInfo.controllers || [];
            const isAlreadyController = currentControllers.some(c => {
                const cStr = typeof c === 'string' ? c : c.toString();
                return cStr === newControllerPrincipal.toString();
            });
            
            if (isAlreadyController) {
                setError('This principal is already a controller');
                return;
            }
            
            // Create new list with the added controller
            const newControllers = [
                ...currentControllers.map(c => typeof c === 'string' ? Principal.fromText(c) : c),
                newControllerPrincipal
            ];
            
            await updateControllers(newControllers);
            setNewControllerInput('');
            
        } catch (e) {
            setError('Invalid principal ID format');
        }
    };

    // Remove a controller
    const handleRemoveController = async (controllerToRemove) => {
        const controllerStr = typeof controllerToRemove === 'string' 
            ? controllerToRemove 
            : controllerToRemove.toString();
        
        // Check if this is the last controller
        if (canisterInfo.controllers?.length === 1) {
            setError('Cannot remove the last controller. The canister would become permanently uncontrollable.');
            setConfirmRemove(null);
            return;
        }
        
        // Create new list without the removed controller
        const newControllers = canisterInfo.controllers
            .filter(c => {
                const cStr = typeof c === 'string' ? c : c.toString();
                return cStr !== controllerStr;
            })
            .map(c => typeof c === 'string' ? Principal.fromText(c) : c);
        
        await updateControllers(newControllers);
        setConfirmRemove(null);
    };

    // Get current canister name and nickname from context
    const canisterIdStr = canisterIdParam || '';
    const canisterDisplayInfo = canisterIdStr 
        ? getPrincipalDisplayInfoFromContext(
            canisterIdStr,
            principalNames,
            principalNicknames
        )
        : null;
    const currentName = canisterDisplayInfo?.name || '';
    const currentNickname = canisterDisplayInfo?.nickname || '';
    const isVerified = canisterDisplayInfo?.verified || false;

    // Start editing canister name
    const handleStartEditName = () => {
        setNameInput(currentName);
        setIsEditingName(true);
    };

    // Start editing canister nickname
    const handleStartEditNickname = () => {
        setNicknameInput(currentNickname);
        setIsEditingNickname(true);
    };

    // Save canister public name (requires controller access)
    const handleSaveName = async () => {
        if (!identity || !canisterIdParam) return;
        
        setSavingName(true);
        setError(null);
        
        try {
            const result = await setCanisterName(identity, canisterIdParam, nameInput.trim());
            if ('ok' in result) {
                setSuccessMessage(result.ok);
                setIsEditingName(false);
                // Refresh naming context - the NamingContext should auto-refresh but we can force it
                // For now, the user will see the update on the next render cycle
            } else if ('err' in result) {
                setError(result.err);
            }
        } catch (e) {
            setError('Failed to save name: ' + (e.message || 'Unknown error'));
        } finally {
            setSavingName(false);
        }
    };

    // Save canister nickname (any user can do this)
    const handleSaveNickname = async () => {
        if (!identity || !canisterIdParam) return;
        
        setSavingNickname(true);
        setError(null);
        
        try {
            const result = await setPrincipalNickname(identity, canisterIdParam, nicknameInput.trim());
            if ('ok' in result) {
                setSuccessMessage('Successfully set canister nickname');
                setIsEditingNickname(false);
            } else if ('err' in result) {
                setError(result.err);
            }
        } catch (e) {
            setError('Failed to save nickname: ' + (e.message || 'Unknown error'));
        } finally {
            setSavingNickname(false);
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

                {/* Success Message */}
                {successMessage && (
                    <div style={{ 
                        backgroundColor: `${theme.colors.success}20`, 
                        border: `1px solid ${theme.colors.success}`,
                        color: theme.colors.success,
                        padding: '15px',
                        borderRadius: '6px',
                        marginBottom: '20px',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center'
                    }}>
                        {successMessage}
                        <button
                            onClick={() => setSuccessMessage(null)}
                            style={{
                                background: 'none',
                                border: 'none',
                                color: theme.colors.success,
                                cursor: 'pointer',
                                fontSize: '18px',
                                padding: '0 5px'
                            }}
                        >
                            ×
                        </button>
                    </div>
                )}

                {/* Error Display */}
                {error && (
                    <div style={{ 
                        backgroundColor: `${theme.colors.error}20`, 
                        border: `1px solid ${theme.colors.error}`,
                        color: theme.colors.error,
                        padding: '15px',
                        borderRadius: '6px',
                        marginBottom: '20px',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center'
                    }}>
                        {error}
                        <button
                            onClick={() => setError(null)}
                            style={{
                                background: 'none',
                                border: 'none',
                                color: theme.colors.error,
                                cursor: 'pointer',
                                fontSize: '18px',
                                padding: '0 5px'
                            }}
                        >
                            ×
                        </button>
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

                        {/* Public Name (editable by controllers) */}
                        <div style={{ marginBottom: '20px' }}>
                            <div style={{ 
                                color: theme.colors.mutedText, 
                                fontSize: '12px',
                                marginBottom: '4px',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px'
                            }}>
                                Public Name
                                {isVerified && (
                                    <span style={{
                                        backgroundColor: `${theme.colors.success}30`,
                                        color: theme.colors.success,
                                        padding: '2px 6px',
                                        borderRadius: '4px',
                                        fontSize: '10px'
                                    }}>
                                        ✓ Verified
                                    </span>
                                )}
                            </div>
                            {isEditingName ? (
                                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                    <input
                                        type="text"
                                        value={nameInput}
                                        onChange={(e) => setNameInput(e.target.value)}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') handleSaveName();
                                            if (e.key === 'Escape') setIsEditingName(false);
                                        }}
                                        placeholder="Enter public name"
                                        disabled={savingName}
                                        style={{
                                            flex: 1,
                                            padding: '8px 12px',
                                            border: `1px solid ${theme.colors.border}`,
                                            borderRadius: '4px',
                                            backgroundColor: theme.colors.tertiaryBg,
                                            color: theme.colors.primaryText,
                                            fontSize: '14px',
                                            outline: 'none'
                                        }}
                                        autoFocus
                                    />
                                    <button
                                        onClick={handleSaveName}
                                        disabled={savingName}
                                        style={{
                                            backgroundColor: theme.colors.success,
                                            color: '#fff',
                                            border: 'none',
                                            borderRadius: '4px',
                                            padding: '8px 12px',
                                            cursor: savingName ? 'not-allowed' : 'pointer',
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '4px'
                                        }}
                                    >
                                        <FaSave /> {savingName ? '...' : 'Save'}
                                    </button>
                                    <button
                                        onClick={() => setIsEditingName(false)}
                                        disabled={savingName}
                                        style={{
                                            backgroundColor: 'transparent',
                                            color: theme.colors.mutedText,
                                            border: `1px solid ${theme.colors.border}`,
                                            borderRadius: '4px',
                                            padding: '8px 12px',
                                            cursor: 'pointer',
                                            display: 'flex',
                                            alignItems: 'center'
                                        }}
                                    >
                                        <FaTimes />
                                    </button>
                                </div>
                            ) : (
                                <div style={{ 
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '8px',
                                    backgroundColor: theme.colors.tertiaryBg,
                                    padding: '8px 12px',
                                    borderRadius: '4px'
                                }}>
                                    <span style={{ 
                                        color: currentName ? theme.colors.primaryText : theme.colors.mutedText,
                                        fontSize: '14px',
                                        flex: 1,
                                        fontStyle: currentName ? 'normal' : 'italic'
                                    }}>
                                        {currentName || 'No public name set'}
                                    </span>
                                    {/* Only show edit button if user has controller access */}
                                    {fetchMethod === 'canister_status' && isAuthenticated && (
                                        <button
                                            onClick={handleStartEditName}
                                            style={{
                                                backgroundColor: 'transparent',
                                                color: theme.colors.accent,
                                                border: 'none',
                                                padding: '4px 8px',
                                                cursor: 'pointer',
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '4px',
                                                fontSize: '12px'
                                            }}
                                        >
                                            <FaEdit /> Edit
                                        </button>
                                    )}
                                </div>
                            )}
                            {fetchMethod === 'canister_status' && (
                                <p style={{ 
                                    color: theme.colors.mutedText, 
                                    fontSize: '11px', 
                                    marginTop: '4px',
                                    marginBottom: 0 
                                }}>
                                    As a controller, you can set a public name visible to all users.
                                </p>
                            )}
                        </div>

                        {/* Private Nickname (editable by any logged in user) */}
                        {isAuthenticated && (
                            <div style={{ marginBottom: '20px' }}>
                                <div style={{ 
                                    color: theme.colors.mutedText, 
                                    fontSize: '12px',
                                    marginBottom: '4px'
                                }}>
                                    Your Nickname <span style={{ opacity: 0.7 }}>(private to you)</span>
                                </div>
                                {isEditingNickname ? (
                                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                        <input
                                            type="text"
                                            value={nicknameInput}
                                            onChange={(e) => setNicknameInput(e.target.value)}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter') handleSaveNickname();
                                                if (e.key === 'Escape') setIsEditingNickname(false);
                                            }}
                                            placeholder="Enter your nickname for this canister"
                                            disabled={savingNickname}
                                            style={{
                                                flex: 1,
                                                padding: '8px 12px',
                                                border: `1px solid ${theme.colors.border}`,
                                                borderRadius: '4px',
                                                backgroundColor: theme.colors.tertiaryBg,
                                                color: theme.colors.primaryText,
                                                fontSize: '14px',
                                                outline: 'none'
                                            }}
                                            autoFocus
                                        />
                                        <button
                                            onClick={handleSaveNickname}
                                            disabled={savingNickname}
                                            style={{
                                                backgroundColor: theme.colors.success,
                                                color: '#fff',
                                                border: 'none',
                                                borderRadius: '4px',
                                                padding: '8px 12px',
                                                cursor: savingNickname ? 'not-allowed' : 'pointer',
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '4px'
                                            }}
                                        >
                                            <FaSave /> {savingNickname ? '...' : 'Save'}
                                        </button>
                                        <button
                                            onClick={() => setIsEditingNickname(false)}
                                            disabled={savingNickname}
                                            style={{
                                                backgroundColor: 'transparent',
                                                color: theme.colors.mutedText,
                                                border: `1px solid ${theme.colors.border}`,
                                                borderRadius: '4px',
                                                padding: '8px 12px',
                                                cursor: 'pointer',
                                                display: 'flex',
                                                alignItems: 'center'
                                            }}
                                        >
                                            <FaTimes />
                                        </button>
                                    </div>
                                ) : (
                                    <div style={{ 
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '8px',
                                        backgroundColor: theme.colors.tertiaryBg,
                                        padding: '8px 12px',
                                        borderRadius: '4px'
                                    }}>
                                        <span style={{ 
                                            color: currentNickname ? theme.colors.primaryText : theme.colors.mutedText,
                                            fontSize: '14px',
                                            flex: 1,
                                            fontStyle: currentNickname ? 'normal' : 'italic'
                                        }}>
                                            {currentNickname || 'No nickname set'}
                                        </span>
                                        <button
                                            onClick={handleStartEditNickname}
                                            style={{
                                                backgroundColor: 'transparent',
                                                color: theme.colors.accent,
                                                border: 'none',
                                                padding: '4px 8px',
                                                cursor: 'pointer',
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '4px',
                                                fontSize: '12px'
                                            }}
                                        >
                                            <FaEdit /> Edit
                                        </button>
                                    </div>
                                )}
                            </div>
                        )}

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
                                            const isSelf = controllerStr === currentUserPrincipal;
                                            const isConfirmingRemove = confirmRemove === controllerStr;
                                            
                                            return (
                                                <div 
                                                    key={index}
                                                    style={{
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        justifyContent: 'space-between',
                                                        gap: '8px',
                                                        padding: '8px',
                                                        backgroundColor: theme.colors.secondaryBg,
                                                        borderRadius: '4px'
                                                    }}
                                                >
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, minWidth: 0 }}>
                                                        <PrincipalDisplay
                                                            principal={typeof controller === 'string' 
                                                                ? Principal.fromText(controller) 
                                                                : controller}
                                                            displayInfo={displayInfo}
                                                            showCopyButton={true}
                                                            isAuthenticated={isAuthenticated}
                                                            style={{ fontSize: '14px' }}
                                                        />
                                                        {isSelf && (
                                                            <span style={{
                                                                backgroundColor: `${theme.colors.accent}30`,
                                                                color: theme.colors.accent,
                                                                padding: '2px 6px',
                                                                borderRadius: '4px',
                                                                fontSize: '10px',
                                                                fontWeight: '500',
                                                                whiteSpace: 'nowrap'
                                                            }}>
                                                                YOU
                                                            </span>
                                                        )}
                                                    </div>
                                                    
                                                    {/* Remove button - only show if user has controller access */}
                                                    {fetchMethod === 'canister_status' && (
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                            {isConfirmingRemove ? (
                                                                <>
                                                                    <span style={{ 
                                                                        color: isSelf ? theme.colors.warning : theme.colors.error, 
                                                                        fontSize: '12px',
                                                                        whiteSpace: 'nowrap'
                                                                    }}>
                                                                        {isSelf ? '⚠️ Remove yourself?' : 'Confirm?'}
                                                                    </span>
                                                                    <button
                                                                        onClick={() => handleRemoveController(controller)}
                                                                        disabled={updating}
                                                                        style={{
                                                                            backgroundColor: theme.colors.error,
                                                                            color: '#fff',
                                                                            border: 'none',
                                                                            borderRadius: '4px',
                                                                            padding: '4px 8px',
                                                                            cursor: updating ? 'not-allowed' : 'pointer',
                                                                            fontSize: '12px',
                                                                            opacity: updating ? 0.7 : 1
                                                                        }}
                                                                    >
                                                                        Yes
                                                                    </button>
                                                                    <button
                                                                        onClick={() => setConfirmRemove(null)}
                                                                        disabled={updating}
                                                                        style={{
                                                                            backgroundColor: theme.colors.tertiaryBg,
                                                                            color: theme.colors.primaryText,
                                                                            border: `1px solid ${theme.colors.border}`,
                                                                            borderRadius: '4px',
                                                                            padding: '4px 8px',
                                                                            cursor: updating ? 'not-allowed' : 'pointer',
                                                                            fontSize: '12px'
                                                                        }}
                                                                    >
                                                                        No
                                                                    </button>
                                                                </>
                                                            ) : (
                                                                <button
                                                                    onClick={() => setConfirmRemove(controllerStr)}
                                                                    disabled={updating}
                                                                    style={{
                                                                        backgroundColor: 'transparent',
                                                                        color: theme.colors.error,
                                                                        border: `1px solid ${theme.colors.error}`,
                                                                        borderRadius: '4px',
                                                                        padding: '4px 10px',
                                                                        cursor: updating ? 'not-allowed' : 'pointer',
                                                                        fontSize: '12px',
                                                                        opacity: updating ? 0.7 : 1
                                                                    }}
                                                                >
                                                                    Remove
                                                                </button>
                                                            )}
                                                        </div>
                                                    )}
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
                                
                                {/* Add Controller - only show if user has controller access */}
                                {fetchMethod === 'canister_status' && (
                                    <div style={{ 
                                        marginTop: '12px',
                                        paddingTop: '12px',
                                        borderTop: `1px solid ${theme.colors.border}`
                                    }}>
                                        <div style={{ 
                                            color: theme.colors.mutedText, 
                                            fontSize: '12px',
                                            marginBottom: '8px'
                                        }}>
                                            Add Controller
                                        </div>
                                        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                                            <input
                                                type="text"
                                                value={newControllerInput}
                                                onChange={(e) => setNewControllerInput(e.target.value)}
                                                onKeyDown={(e) => {
                                                    if (e.key === 'Enter') {
                                                        e.preventDefault();
                                                        handleAddController();
                                                    }
                                                }}
                                                placeholder="Enter principal ID"
                                                disabled={updating}
                                                style={{
                                                    flex: '1',
                                                    minWidth: '250px',
                                                    padding: '8px 12px',
                                                    border: `1px solid ${theme.colors.border}`,
                                                    borderRadius: '4px',
                                                    backgroundColor: theme.colors.secondaryBg,
                                                    color: theme.colors.primaryText,
                                                    fontSize: '14px',
                                                    outline: 'none'
                                                }}
                                            />
                                            <button
                                                onClick={handleAddController}
                                                disabled={updating || !newControllerInput.trim()}
                                                style={{
                                                    backgroundColor: theme.colors.success,
                                                    color: '#fff',
                                                    border: 'none',
                                                    borderRadius: '4px',
                                                    padding: '8px 16px',
                                                    cursor: (updating || !newControllerInput.trim()) ? 'not-allowed' : 'pointer',
                                                    fontSize: '14px',
                                                    fontWeight: '500',
                                                    opacity: (updating || !newControllerInput.trim()) ? 0.7 : 1
                                                }}
                                            >
                                                {updating ? 'Updating...' : 'Add'}
                                            </button>
                                        </div>
                                        <p style={{ 
                                            color: theme.colors.mutedText, 
                                            fontSize: '11px',
                                            marginTop: '8px',
                                            marginBottom: 0
                                        }}>
                                            ⚠️ Be careful when modifying controllers. Removing all controllers will make the canister permanently uncontrollable.
                                        </p>
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

