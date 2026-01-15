import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../AuthContext';
import { useSearchParams } from 'react-router-dom';
import Header from '../components/Header';
import { useTheme } from '../contexts/ThemeContext';
import { Principal } from '@dfinity/principal';
import { Actor, HttpAgent } from '@dfinity/agent';
import { getCanisterInfo, setCanisterName, setPrincipalNickname } from '../utils/BackendUtils';
import { PrincipalDisplay, getPrincipalDisplayInfoFromContext } from '../utils/PrincipalUtils';
import { useNaming } from '../NamingContext';
import { FaEdit, FaSave, FaTimes, FaExternalLinkAlt, FaGasPump, FaUpload, FaExclamationTriangle } from 'react-icons/fa';
import { createActor as createLedgerActor } from 'external/icrc1_ledger';
import { createActor as createCmcActor, CMC_CANISTER_ID } from 'external/cmc';

// ICP Ledger constants
const ICP_LEDGER_CANISTER_ID = 'ryjl3-tyaaa-aaaaa-aaaba-cai';
const E8S = 100_000_000;
const ICP_FEE = 10_000; // 0.0001 ICP

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
    // Install mode for install_code
    const install_code_mode = IDL.Variant({
        'install': IDL.Null,
        'reinstall': IDL.Null,
        'upgrade': IDL.Null,
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

// Helper to get the host URL based on environment
const getHost = () => process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging' ? 'https://icp0.io' : 'http://localhost:4943';

// Helper function to convert Uint8Array to hex string
const uint8ArrayToHex = (arr) => {
    if (!arr) return null;
    return Array.from(arr)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
};

// Helper function to convert hex string to Uint8Array
const hexToUint8Array = (hex) => {
    if (!hex || hex.length === 0) return null;
    // Remove any whitespace and 0x prefix
    const cleanHex = hex.replace(/\s/g, '').replace(/^0x/i, '');
    if (cleanHex.length % 2 !== 0) {
        throw new Error('Invalid hex string: odd length');
    }
    const bytes = new Uint8Array(cleanHex.length / 2);
    for (let i = 0; i < cleanHex.length; i += 2) {
        const byte = parseInt(cleanHex.substr(i, 2), 16);
        if (isNaN(byte)) {
            throw new Error(`Invalid hex character at position ${i}`);
        }
        bytes[i / 2] = byte;
    }
    return bytes;
};

// Parse DIDC blob format (output from `didc encode`)
// Accepts formats like:
//   blob "DIDL\00\01h..."
//   "DIDL\00\01h..."
//   DIDL\00\01h...
//   \00\01h... (prepends DIDL automatically)
const parseDidcBlob = (input) => {
    if (!input || input.trim().length === 0) {
        throw new Error('DIDC input is empty');
    }
    
    let str = input.trim();
    
    // Strip 'blob ' prefix if present
    if (str.toLowerCase().startsWith('blob ')) {
        str = str.slice(5).trim();
    }
    
    // Strip surrounding quotes if present
    if ((str.startsWith('"') && str.endsWith('"')) || 
        (str.startsWith("'") && str.endsWith("'"))) {
        str = str.slice(1, -1);
    }
    
    // Check if it starts with DIDL (as escaped or literal)
    const startsWithDidl = str.startsWith('DIDL') || 
                           str.startsWith('\\44\\49\\44\\4c') || 
                           str.startsWith('\\44\\49\\44\\4C');
    
    // Parse the escape sequences
    const bytes = [];
    let i = 0;
    while (i < str.length) {
        if (str[i] === '\\' && i + 2 < str.length) {
            // Escape sequence: \xx
            const hexPart = str.slice(i + 1, i + 3);
            const byte = parseInt(hexPart, 16);
            if (!isNaN(byte)) {
                bytes.push(byte);
                i += 3;
                continue;
            }
        }
        // Literal character
        bytes.push(str.charCodeAt(i));
        i++;
    }
    
    // Prepend DIDL magic bytes if not present
    if (!startsWithDidl && bytes.length > 0) {
        const withDidl = [0x44, 0x49, 0x44, 0x4C, ...bytes];
        return new Uint8Array(withDidl);
    }
    
    return new Uint8Array(bytes);
};

// Encode a Principal to Candid bytes: (principal "...")
const encodePrincipalArg = (principalText) => {
    const principal = Principal.fromText(principalText);
    const principalBytes = principal.toUint8Array();
    
    // Candid encoding for (principal "..."):
    // Magic: DIDL (4 bytes)
    // Type table count: 0 (1 byte)
    // Arg count: 1 (1 byte)  
    // Arg type: 0x68 = Principal type (-24 as sleb128) (1 byte)
    // Principal value: length (1 byte for <=127) + bytes
    const result = new Uint8Array(4 + 1 + 1 + 1 + 1 + principalBytes.length);
    result[0] = 0x44; // D
    result[1] = 0x49; // I
    result[2] = 0x44; // D
    result[3] = 0x4C; // L
    result[4] = 0x00; // 0 types
    result[5] = 0x01; // 1 arg
    result[6] = 0x68; // Principal type
    result[7] = principalBytes.length; // Length prefix
    result.set(principalBytes, 8);
    
    return result;
};

// Encode an optional Principal to Candid bytes: (opt principal "...") or (null)
const encodeOptPrincipalArg = (principalText) => {
    if (!principalText || principalText.trim() === '' || principalText.trim().toLowerCase() === 'null') {
        // Encode (null : ?Principal)
        // Type table: 1 entry (opt principal)
        // opt is type constructor 0x6e followed by the inner type
        return new Uint8Array([
            0x44, 0x49, 0x44, 0x4C, // DIDL
            0x01,                   // 1 type in type table
            0x6e, 0x68,            // Type 0: opt (0x6e) principal (0x68)
            0x01,                   // 1 argument
            0x00,                   // Arg 0 is type index 0
            0x00                    // Value: null (0 = None)
        ]);
    } else {
        // Encode (opt principal "...")
        const principal = Principal.fromText(principalText.trim());
        const principalBytes = principal.toUint8Array();
        
        const result = new Uint8Array(4 + 1 + 2 + 1 + 1 + 1 + 1 + principalBytes.length);
        let offset = 0;
        
        // Magic
        result[offset++] = 0x44; // D
        result[offset++] = 0x49; // I
        result[offset++] = 0x44; // D
        result[offset++] = 0x4C; // L
        
        // Type table: 1 entry
        result[offset++] = 0x01;
        result[offset++] = 0x6e; // opt
        result[offset++] = 0x68; // principal
        
        // Args
        result[offset++] = 0x01; // 1 arg
        result[offset++] = 0x00; // Type index 0
        
        // Value: Some(principal)
        result[offset++] = 0x01; // 1 = Some
        result[offset++] = principalBytes.length;
        result.set(principalBytes, offset);
        
        return result;
    }
};

export default function CanisterPage() {
    const { theme } = useTheme();
    const { identity, isAuthenticated } = useAuth();
    const { principalNames, principalNicknames, fetchAllNames } = useNaming();
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
    
    // Cycles top-up state
    const [topUpAmount, setTopUpAmount] = useState('');
    const [userIcpBalance, setUserIcpBalance] = useState(null);
    const [toppingUp, setToppingUp] = useState(false);
    const [conversionRate, setConversionRate] = useState(null);
    const [showTopUpSection, setShowTopUpSection] = useState(false);
    
    // WASM upgrade state
    const [showUpgradeSection, setShowUpgradeSection] = useState(false);
    const [wasmSourceMode, setWasmSourceMode] = useState('file'); // 'file' or 'url'
    const [wasmFile, setWasmFile] = useState(null);
    const [wasmUrl, setWasmUrl] = useState('');
    const [wasmFromUrl, setWasmFromUrl] = useState(null); // { data: Uint8Array, size: number, name: string }
    const [fetchingWasm, setFetchingWasm] = useState(false);
    const [upgradeMode, setUpgradeMode] = useState('upgrade'); // 'upgrade' or 'reinstall'
    const [upgrading, setUpgrading] = useState(false);
    const [confirmUpgrade, setConfirmUpgrade] = useState(false);
    const [initArgHex, setInitArgHex] = useState(''); // Hex-encoded Candid init arguments
    const [initArgMode, setInitArgMode] = useState('none'); // 'none', 'hex', 'principal', 'optPrincipal', 'didc'
    const [initArgPrincipal, setInitArgPrincipal] = useState(''); // Principal text input
    const [initArgDidc, setInitArgDidc] = useState(''); // DIDC blob format input
    const wasmInputRef = useRef(null);

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
                // Refresh naming context to show the updated name
                await fetchAllNames();
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
                // Refresh naming context to show the updated nickname
                await fetchAllNames();
            } else if ('err' in result) {
                setError(result.err);
            }
        } catch (e) {
            setError('Failed to save nickname: ' + (e.message || 'Unknown error'));
        } finally {
            setSavingNickname(false);
        }
    };

    // Fetch user's ICP balance
    const fetchUserIcpBalance = useCallback(async () => {
        if (!identity) return;
        
        try {
            const host = getHost();
            const agent = HttpAgent.createSync({ host, identity });
            
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
            }
            
            const ledger = createLedgerActor(ICP_LEDGER_CANISTER_ID, { agent });
            const balance = await ledger.icrc1_balance_of({
                owner: identity.getPrincipal(),
                subaccount: [],
            });
            setUserIcpBalance(Number(balance));
        } catch (err) {
            console.error('Error fetching user ICP balance:', err);
        }
    }, [identity]);

    // Fetch ICP to cycles conversion rate from CMC
    const fetchConversionRate = useCallback(async () => {
        try {
            // Always fetch from mainnet CMC
            const host = 'https://ic0.app';
            const agent = HttpAgent.createSync({ host });
            
            const cmc = createCmcActor(CMC_CANISTER_ID, { agent });
            const response = await cmc.get_icp_xdr_conversion_rate();
            
            // xdr_permyriad_per_icp is the rate in XDR per 10,000 ICP
            // 1 XDR = 1 trillion cycles
            const xdrPerIcp = Number(response.data.xdr_permyriad_per_icp) / 10000;
            const cyclesPerIcp = xdrPerIcp * 1_000_000_000_000; // 1T cycles per XDR
            
            setConversionRate({
                xdrPerIcp,
                cyclesPerIcp,
                timestamp: Number(response.data.timestamp_seconds),
            });
        } catch (err) {
            console.error('Error fetching conversion rate:', err);
        }
    }, []);

    // Fetch user balance and conversion rate when authenticated
    useEffect(() => {
        if (isAuthenticated && identity) {
            fetchUserIcpBalance();
            fetchConversionRate();
        }
    }, [isAuthenticated, identity, fetchUserIcpBalance, fetchConversionRate]);

    // Calculate CMC subaccount for a canister principal
    // The subaccount is the principal bytes padded to 32 bytes
    const principalToSubaccount = (principal) => {
        const bytes = principal.toUint8Array();
        const subaccount = new Uint8Array(32);
        subaccount[0] = bytes.length;
        subaccount.set(bytes, 1);
        return subaccount;
    };

    // CMC memo for top-up operation: "TPUP" = 0x50555054 in big-endian
    // As bytes: [0x54, 0x50, 0x55, 0x50, 0x00, 0x00, 0x00, 0x00] for little-endian Nat64
    const TOP_UP_MEMO = new Uint8Array([0x54, 0x50, 0x55, 0x50, 0x00, 0x00, 0x00, 0x00]);

    // Format ICP amount
    const formatIcp = (e8s) => {
        if (e8s === null || e8s === undefined) return '...';
        return (e8s / E8S).toLocaleString(undefined, { 
            minimumFractionDigits: 2, 
            maximumFractionDigits: 8 
        });
    };

    // Format cycles amount
    const formatCycles = (cycles) => {
        if (cycles >= 1_000_000_000_000) {
            return (cycles / 1_000_000_000_000).toFixed(4) + ' T';
        } else if (cycles >= 1_000_000_000) {
            return (cycles / 1_000_000_000).toFixed(4) + ' B';
        } else if (cycles >= 1_000_000) {
            return (cycles / 1_000_000).toFixed(4) + ' M';
        }
        return cycles.toLocaleString();
    };

    // Calculate estimated cycles from ICP amount
    const estimatedCycles = () => {
        if (!topUpAmount || !conversionRate) return null;
        const icpAmount = parseFloat(topUpAmount);
        if (isNaN(icpAmount) || icpAmount <= 0) return null;
        return icpAmount * conversionRate.cyclesPerIcp;
    };

    // Handle top-up with cycles
    const handleTopUp = async () => {
        if (!identity || !canisterIdParam || !topUpAmount) return;
        
        const icpAmount = parseFloat(topUpAmount);
        if (isNaN(icpAmount) || icpAmount <= 0) {
            setError('Please enter a valid ICP amount');
            return;
        }
        
        const amountE8s = BigInt(Math.floor(icpAmount * E8S));
        const totalNeeded = amountE8s + BigInt(ICP_FEE);
        
        if (userIcpBalance === null || BigInt(userIcpBalance) < totalNeeded) {
            setError(`Insufficient ICP balance. You have ${formatIcp(userIcpBalance)} ICP, need ${(Number(totalNeeded) / E8S).toFixed(4)} ICP (including fee)`);
            return;
        }
        
        setToppingUp(true);
        setError(null);
        setSuccessMessage(null);
        
        try {
            const host = getHost();
            const agent = HttpAgent.createSync({ host, identity });
            
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
            }
            
            const canisterPrincipal = Principal.fromText(canisterIdParam);
            const cmcPrincipal = Principal.fromText(CMC_CANISTER_ID);
            
            // Step 1: Transfer ICP to CMC with canister's subaccount and TPUP memo
            const ledger = createLedgerActor(ICP_LEDGER_CANISTER_ID, { agent });
            const subaccount = principalToSubaccount(canisterPrincipal);
            
            console.log('Transferring ICP to CMC...');
            console.log('Amount:', icpAmount, 'ICP');
            console.log('To CMC:', CMC_CANISTER_ID);
            console.log('Subaccount:', Array.from(subaccount).map(b => b.toString(16).padStart(2, '0')).join(''));
            console.log('Memo (TPUP):', Array.from(TOP_UP_MEMO).map(b => b.toString(16).padStart(2, '0')).join(''));
            
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
                if ('InsufficientFunds' in err) {
                    throw new Error(`Insufficient funds: ${formatIcp(Number(err.InsufficientFunds.balance))} ICP available`);
                }
                throw new Error(`Transfer failed: ${JSON.stringify(err)}`);
            }
            
            const blockIndex = transferResult.Ok;
            console.log('Transfer successful, block index:', blockIndex.toString());
            
            // Step 2: Notify CMC to mint cycles
            // For mainnet, use mainnet CMC; for local, this won't work
            const cmcHost = process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging' 
                ? 'https://ic0.app' 
                : host;
            const cmcAgent = HttpAgent.createSync({ host: cmcHost, identity });
            
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await cmcAgent.fetchRootKey();
            }
            
            const cmc = createCmcActor(CMC_CANISTER_ID, { agent: cmcAgent });
            
            console.log('Notifying CMC to mint cycles...');
            const notifyResult = await cmc.notify_top_up({
                block_index: blockIndex,
                canister_id: canisterPrincipal,
            });
            
            if ('Err' in notifyResult) {
                const err = notifyResult.Err;
                if ('Refunded' in err) {
                    throw new Error(`Top-up refunded: ${err.Refunded.reason}`);
                } else if ('InvalidTransaction' in err) {
                    throw new Error(`Invalid transaction: ${err.InvalidTransaction}`);
                } else if ('Other' in err) {
                    throw new Error(`CMC error: ${err.Other.error_message}`);
                } else if ('Processing' in err) {
                    throw new Error('Transaction is still being processed. Please try again in a moment.');
                } else if ('TransactionTooOld' in err) {
                    throw new Error('Transaction too old');
                }
                throw new Error(`Unknown CMC error: ${JSON.stringify(err)}`);
            }
            
            const cyclesAdded = Number(notifyResult.Ok);
            console.log('Cycles added:', cyclesAdded);
            
            setSuccessMessage(`✅ Successfully topped up ${formatCycles(cyclesAdded)} cycles to the canister!`);
            setTopUpAmount('');
            setShowTopUpSection(false);
            
            // Refresh user balance and canister info
            fetchUserIcpBalance();
            if (canisterIdParam) {
                fetchCanisterInfo(canisterIdParam);
            }
            
        } catch (err) {
            console.error('Top-up error:', err);
            setError(`Top-up failed: ${err.message || 'Unknown error'}`);
        } finally {
            setToppingUp(false);
        }
    };

    // Handle WASM file selection
    const handleWasmFileChange = (e) => {
        const file = e.target.files[0];
        if (file) {
            // Validate file extension
            if (!file.name.endsWith('.wasm') && !file.name.endsWith('.wasm.gz')) {
                setError('Please select a valid .wasm or .wasm.gz file');
                return;
            }
            setWasmFile(file);
            setConfirmUpgrade(false);
        }
    };

    // Fetch WASM from URL
    const handleFetchWasmFromUrl = async () => {
        if (!wasmUrl.trim()) {
            setError('Please enter a WASM URL');
            return;
        }
        
        setFetchingWasm(true);
        setError(null);
        setWasmFromUrl(null);
        setConfirmUpgrade(false);
        
        try {
            // Extract filename from URL
            const urlObj = new URL(wasmUrl.trim());
            let filename = urlObj.pathname.split('/').pop() || 'module.wasm';
            
            // Fetch the WASM file
            const response = await fetch(wasmUrl.trim());
            
            if (!response.ok) {
                throw new Error(`Failed to fetch: ${response.status} ${response.statusText}`);
            }
            
            const contentType = response.headers.get('content-type');
            const arrayBuffer = await response.arrayBuffer();
            const data = new Uint8Array(arrayBuffer);
            
            if (data.length === 0) {
                throw new Error('Downloaded file is empty');
            }
            
            // Basic validation: check for WASM magic bytes (0x00 0x61 0x73 0x6D = "\0asm")
            // or gzip magic bytes (0x1f 0x8b)
            const isWasm = data[0] === 0x00 && data[1] === 0x61 && data[2] === 0x73 && data[3] === 0x6D;
            const isGzip = data[0] === 0x1F && data[1] === 0x8B;
            
            if (!isWasm && !isGzip) {
                console.warn('File does not appear to be a valid WASM or gzipped WASM file');
            }
            
            // Update filename if it doesn't have extension
            if (!filename.endsWith('.wasm') && !filename.endsWith('.wasm.gz')) {
                filename = isGzip ? filename + '.wasm.gz' : filename + '.wasm';
            }
            
            setWasmFromUrl({
                data,
                size: data.length,
                name: filename
            });
            
            console.log(`WASM fetched from URL: ${filename} (${(data.length / 1024).toFixed(2)} KB)`);
            
        } catch (err) {
            console.error('Error fetching WASM from URL:', err);
            setError(`Failed to fetch WASM: ${err.message}`);
        } finally {
            setFetchingWasm(false);
        }
    };

    // Get the current WASM module (from file or URL)
    const getWasmModule = () => {
        if (wasmSourceMode === 'url') {
            return wasmFromUrl;
        }
        return wasmFile;
    };

    // Check if we have a valid WASM ready
    const hasValidWasm = () => {
        if (wasmSourceMode === 'url') {
            return wasmFromUrl !== null;
        }
        return wasmFile !== null;
    };

    // Handle canister upgrade
    const handleUpgradeCanister = async () => {
        if (!identity || !canisterIdParam || !hasValidWasm()) return;
        
        setUpgrading(true);
        setError(null);
        setSuccessMessage(null);
        
        try {
            const canisterPrincipal = Principal.fromText(canisterIdParam);
            const host = getHost();
            const agent = HttpAgent.createSync({ host, identity });
            
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
            
            // Get WASM module (from file or URL)
            let wasmModule;
            let wasmName;
            let wasmSize;
            
            if (wasmSourceMode === 'url' && wasmFromUrl) {
                wasmModule = wasmFromUrl.data;
                wasmName = wasmFromUrl.name;
                wasmSize = wasmFromUrl.size;
                console.log(`Using WASM from URL: ${wasmName} (${(wasmSize / 1024).toFixed(2)} KB)`);
            } else if (wasmFile) {
                console.log(`Reading WASM file: ${wasmFile.name} (${(wasmFile.size / 1024).toFixed(2)} KB)`);
                const wasmBuffer = await wasmFile.arrayBuffer();
                wasmModule = new Uint8Array(wasmBuffer);
                wasmName = wasmFile.name;
                wasmSize = wasmFile.size;
            } else {
                throw new Error('No WASM module available');
            }
            
            console.log(`Upgrading canister with mode: ${upgradeMode}`);
            console.log(`WASM module size: ${wasmModule.length} bytes`);
            
            // Call install_code with the selected mode
            const mode = upgradeMode === 'reinstall' ? { reinstall: null } : { upgrade: null };
            
            // Determine init arguments based on mode
            let initArg;
            try {
                switch (initArgMode) {
                    case 'principal':
                        if (!initArgPrincipal.trim()) {
                            throw new Error('Principal ID is required');
                        }
                        initArg = encodePrincipalArg(initArgPrincipal.trim());
                        console.log(`Using principal init arg: ${initArg.length} bytes`);
                        break;
                    case 'optPrincipal':
                        initArg = encodeOptPrincipalArg(initArgPrincipal.trim());
                        console.log(`Using optional principal init arg: ${initArg.length} bytes`);
                        break;
                    case 'hex':
                        if (!initArgHex.trim()) {
                            throw new Error('Hex-encoded arguments are required');
                        }
                        initArg = hexToUint8Array(initArgHex.trim());
                        console.log(`Using hex init args: ${initArg.length} bytes`);
                        break;
                    case 'didc':
                        if (!initArgDidc.trim()) {
                            throw new Error('DIDC blob input is required');
                        }
                        initArg = parseDidcBlob(initArgDidc.trim());
                        console.log(`Using DIDC blob init args: ${initArg.length} bytes`);
                        break;
                    case 'none':
                    default:
                        // Candid encoding for empty arguments: "DIDL" magic bytes + 0 types + 0 args
                        initArg = new Uint8Array([0x44, 0x49, 0x44, 0x4C, 0x00, 0x00]);
                        console.log('Using empty init args (DIDL encoding)');
                        break;
                }
            } catch (e) {
                throw new Error(`Invalid init arguments: ${e.message}`);
            }
            
            await managementCanister.install_code({
                mode,
                canister_id: canisterPrincipal,
                wasm_module: wasmModule,
                arg: initArg,
            });
            
            console.log('Canister upgrade successful!');
            setSuccessMessage(`✅ Canister ${upgradeMode === 'reinstall' ? 'reinstalled' : 'upgraded'} successfully!`);
            
            // Reset state
            setWasmFile(null);
            setWasmUrl('');
            setWasmFromUrl(null);
            setWasmSourceMode('file');
            setConfirmUpgrade(false);
            setShowUpgradeSection(false);
            setInitArgMode('none');
            setInitArgHex('');
            setInitArgPrincipal('');
            setInitArgDidc('');
            if (wasmInputRef.current) {
                wasmInputRef.current.value = '';
            }
            
            // Refresh canister info to show new module hash
            if (canisterIdParam) {
                fetchCanisterInfo(canisterIdParam);
            }
            
        } catch (err) {
            console.error('Upgrade error:', err);
            setError(`Upgrade failed: ${err.message || 'Unknown error'}`);
        } finally {
            setUpgrading(false);
        }
    };

    return (
        <div className='page-container' style={{ background: theme.colors.primaryGradient, minHeight: '100vh' }}>
            <style>{`
                @keyframes spin {
                    0% { transform: rotate(0deg); }
                    100% { transform: rotate(360deg); }
                }
            `}</style>
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

                        {/* External Links */}
                        <div style={{ marginBottom: '20px' }}>
                            <div style={{ 
                                color: theme.colors.mutedText, 
                                fontSize: '12px',
                                marginBottom: '8px'
                            }}>
                                View on External Sites
                            </div>
                            <div style={{ 
                                display: 'flex', 
                                gap: '12px', 
                                flexWrap: 'wrap' 
                            }}>
                                <a
                                    href={`https://dashboard.internetcomputer.org/canister/${canisterIdParam}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    style={{
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: '6px',
                                        padding: '8px 14px',
                                        backgroundColor: theme.colors.tertiaryBg,
                                        border: `1px solid ${theme.colors.border}`,
                                        borderRadius: '6px',
                                        color: theme.colors.accent,
                                        textDecoration: 'none',
                                        fontSize: '13px',
                                        fontWeight: '500',
                                        transition: 'all 0.2s'
                                    }}
                                >
                                    <FaExternalLinkAlt size={12} />
                                    ICP Dashboard
                                </a>
                                <a
                                    href={`https://a4gq6-oaaaa-aaaab-qaa4q-cai.raw.icp0.io/?id=${canisterIdParam}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    style={{
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: '6px',
                                        padding: '8px 14px',
                                        backgroundColor: theme.colors.tertiaryBg,
                                        border: `1px solid ${theme.colors.border}`,
                                        borderRadius: '6px',
                                        color: theme.colors.accent,
                                        textDecoration: 'none',
                                        fontSize: '13px',
                                        fontWeight: '500',
                                        transition: 'all 0.2s'
                                    }}
                                >
                                    <FaExternalLinkAlt size={12} />
                                    Candid UI
                                </a>
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

                        {/* Top Up with Cycles Section */}
                        {isAuthenticated && (
                            <div style={{ 
                                marginBottom: '20px',
                                backgroundColor: theme.colors.tertiaryBg,
                                borderRadius: '8px',
                                padding: '16px',
                                border: `1px solid ${theme.colors.border}`
                            }}>
                                <div style={{ 
                                    display: 'flex', 
                                    justifyContent: 'space-between', 
                                    alignItems: 'center',
                                    marginBottom: showTopUpSection ? '16px' : '0'
                                }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                        <FaGasPump style={{ color: theme.colors.accent }} />
                                        <span style={{ 
                                            color: theme.colors.primaryText, 
                                            fontWeight: '500',
                                            fontSize: '14px'
                                        }}>
                                            Top Up with Cycles
                                        </span>
                                    </div>
                                    <button
                                        onClick={() => setShowTopUpSection(!showTopUpSection)}
                                        style={{
                                            backgroundColor: showTopUpSection ? 'transparent' : theme.colors.accent,
                                            color: showTopUpSection ? theme.colors.mutedText : '#fff',
                                            border: showTopUpSection ? `1px solid ${theme.colors.border}` : 'none',
                                            borderRadius: '6px',
                                            padding: '8px 16px',
                                            cursor: 'pointer',
                                            fontSize: '13px',
                                            fontWeight: '500'
                                        }}
                                    >
                                        {showTopUpSection ? 'Cancel' : 'Add Cycles'}
                                    </button>
                                </div>
                                
                                {showTopUpSection && (
                                    <div>
                                        {/* User ICP Balance */}
                                        <div style={{ 
                                            display: 'flex', 
                                            justifyContent: 'space-between', 
                                            alignItems: 'center',
                                            marginBottom: '12px',
                                            padding: '10px 12px',
                                            backgroundColor: theme.colors.secondaryBg,
                                            borderRadius: '6px'
                                        }}>
                                            <span style={{ color: theme.colors.mutedText, fontSize: '13px' }}>
                                                Your ICP Balance:
                                            </span>
                                            <span style={{ 
                                                color: theme.colors.primaryText, 
                                                fontWeight: '600',
                                                fontSize: '14px'
                                            }}>
                                                {formatIcp(userIcpBalance)} ICP
                                            </span>
                                        </div>
                                        
                                        {/* Conversion Rate Info */}
                                        {conversionRate && (
                                            <div style={{ 
                                                marginBottom: '12px',
                                                padding: '10px 12px',
                                                backgroundColor: `${theme.colors.accent}10`,
                                                borderRadius: '6px',
                                                fontSize: '12px',
                                                color: theme.colors.mutedText
                                            }}>
                                                <strong style={{ color: theme.colors.primaryText }}>Current Rate:</strong> 1 ICP ≈ {formatCycles(conversionRate.cyclesPerIcp)} cycles
                                            </div>
                                        )}
                                        
                                        {/* Amount Input */}
                                        <div style={{ marginBottom: '12px' }}>
                                            <label style={{ 
                                                display: 'block',
                                                color: theme.colors.mutedText, 
                                                fontSize: '12px',
                                                marginBottom: '6px'
                                            }}>
                                                Amount (ICP)
                                            </label>
                                            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                                <input
                                                    type="number"
                                                    value={topUpAmount}
                                                    onChange={(e) => setTopUpAmount(e.target.value)}
                                                    placeholder="0.0"
                                                    step="0.01"
                                                    min="0"
                                                    disabled={toppingUp}
                                                    style={{
                                                        flex: 1,
                                                        padding: '10px 12px',
                                                        border: `1px solid ${theme.colors.border}`,
                                                        borderRadius: '6px',
                                                        backgroundColor: theme.colors.secondaryBg,
                                                        color: theme.colors.primaryText,
                                                        fontSize: '14px',
                                                        outline: 'none'
                                                    }}
                                                />
                                                <button
                                                    onClick={() => {
                                                        if (userIcpBalance) {
                                                            // Max is balance minus fee, with a small buffer
                                                            const maxAmount = Math.max(0, (userIcpBalance - ICP_FEE * 2) / E8S);
                                                            setTopUpAmount(maxAmount.toFixed(4));
                                                        }
                                                    }}
                                                    disabled={toppingUp || !userIcpBalance}
                                                    style={{
                                                        backgroundColor: 'transparent',
                                                        color: theme.colors.accent,
                                                        border: `1px solid ${theme.colors.accent}`,
                                                        borderRadius: '6px',
                                                        padding: '10px 12px',
                                                        cursor: 'pointer',
                                                        fontSize: '12px',
                                                        fontWeight: '500'
                                                    }}
                                                >
                                                    MAX
                                                </button>
                                            </div>
                                        </div>
                                        
                                        {/* Estimated Cycles */}
                                        {estimatedCycles() && (
                                            <div style={{ 
                                                marginBottom: '16px',
                                                padding: '12px',
                                                backgroundColor: `${theme.colors.success}15`,
                                                borderRadius: '6px',
                                                border: `1px solid ${theme.colors.success}30`,
                                                textAlign: 'center'
                                            }}>
                                                <div style={{ color: theme.colors.mutedText, fontSize: '12px', marginBottom: '4px' }}>
                                                    Estimated Cycles to Add
                                                </div>
                                                <div style={{ 
                                                    color: theme.colors.success, 
                                                    fontSize: '18px', 
                                                    fontWeight: '600' 
                                                }}>
                                                    ~{formatCycles(estimatedCycles())}
                                                </div>
                                            </div>
                                        )}
                                        
                                        {/* Top Up Button */}
                                        <button
                                            onClick={handleTopUp}
                                            disabled={toppingUp || !topUpAmount || parseFloat(topUpAmount) <= 0}
                                            style={{
                                                width: '100%',
                                                backgroundColor: theme.colors.accent,
                                                color: '#fff',
                                                border: 'none',
                                                borderRadius: '6px',
                                                padding: '12px 24px',
                                                cursor: (toppingUp || !topUpAmount || parseFloat(topUpAmount) <= 0) ? 'not-allowed' : 'pointer',
                                                opacity: (toppingUp || !topUpAmount || parseFloat(topUpAmount) <= 0) ? 0.6 : 1,
                                                fontSize: '14px',
                                                fontWeight: '600',
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                gap: '8px'
                                            }}
                                        >
                                            {toppingUp ? (
                                                <>
                                                    <span className="spinner" style={{
                                                        width: '16px',
                                                        height: '16px',
                                                        border: '2px solid transparent',
                                                        borderTopColor: '#fff',
                                                        borderRadius: '50%',
                                                        animation: 'spin 1s linear infinite'
                                                    }} />
                                                    Processing...
                                                </>
                                            ) : (
                                                <>
                                                    <FaGasPump />
                                                    Top Up Canister
                                                </>
                                            )}
                                        </button>
                                        
                                        <p style={{ 
                                            color: theme.colors.mutedText, 
                                            fontSize: '11px', 
                                            marginTop: '12px',
                                            marginBottom: 0,
                                            textAlign: 'center'
                                        }}>
                                            Converts ICP to cycles via the Cycles Minting Canister (CMC).
                                            <br />
                                            A small ICP fee (0.0001) applies to the transfer.
                                        </p>
                                    </div>
                                )}
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

                        {/* WASM Upgrade Section - Only for controllers */}
                        {fetchMethod === 'canister_status' && (
                            <div style={{ 
                                marginBottom: '20px',
                                backgroundColor: theme.colors.tertiaryBg,
                                borderRadius: '8px',
                                padding: '16px',
                                border: `1px solid ${theme.colors.border}`
                            }}>
                                <div style={{ 
                                    display: 'flex', 
                                    justifyContent: 'space-between', 
                                    alignItems: 'center',
                                    marginBottom: showUpgradeSection ? '16px' : '0'
                                }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                        <FaUpload style={{ color: theme.colors.accent }} />
                                        <span style={{ 
                                            color: theme.colors.primaryText, 
                                            fontWeight: '500',
                                            fontSize: '14px'
                                        }}>
                                            Upgrade Canister
                                        </span>
                                    </div>
                                    <button
                                        onClick={() => {
                                            setShowUpgradeSection(!showUpgradeSection);
                                            if (!showUpgradeSection) {
                                                setWasmFile(null);
                                                setWasmUrl('');
                                                setWasmFromUrl(null);
                                                setWasmSourceMode('file');
                                                setConfirmUpgrade(false);
                                                setUpgradeMode('upgrade');
                                                setInitArgMode('none');
                                                setInitArgHex('');
                                                setInitArgPrincipal('');
                                                setInitArgDidc('');
                                            }
                                        }}
                                        style={{
                                            backgroundColor: showUpgradeSection ? 'transparent' : theme.colors.accent,
                                            color: showUpgradeSection ? theme.colors.mutedText : '#fff',
                                            border: showUpgradeSection ? `1px solid ${theme.colors.border}` : 'none',
                                            borderRadius: '6px',
                                            padding: '8px 16px',
                                            cursor: 'pointer',
                                            fontSize: '13px',
                                            fontWeight: '500'
                                        }}
                                    >
                                        {showUpgradeSection ? 'Cancel' : 'Upload WASM'}
                                    </button>
                                </div>
                                
                                {showUpgradeSection && (
                                    <div>
                                        {/* Upgrade Mode Selection */}
                                        <div style={{ marginBottom: '16px' }}>
                                            <label style={{ 
                                                display: 'block',
                                                color: theme.colors.mutedText, 
                                                fontSize: '12px',
                                                marginBottom: '8px'
                                            }}>
                                                Upgrade Mode
                                            </label>
                                            <div style={{ display: 'flex', gap: '12px' }}>
                                                <label style={{ 
                                                    display: 'flex', 
                                                    alignItems: 'center', 
                                                    gap: '6px',
                                                    cursor: 'pointer',
                                                    padding: '10px 14px',
                                                    backgroundColor: upgradeMode === 'upgrade' ? `${theme.colors.accent}20` : theme.colors.secondaryBg,
                                                    border: `1px solid ${upgradeMode === 'upgrade' ? theme.colors.accent : theme.colors.border}`,
                                                    borderRadius: '6px',
                                                    transition: 'all 0.2s'
                                                }}>
                                                    <input
                                                        type="radio"
                                                        name="upgradeMode"
                                                        value="upgrade"
                                                        checked={upgradeMode === 'upgrade'}
                                                        onChange={(e) => {
                                                            setUpgradeMode(e.target.value);
                                                            setConfirmUpgrade(false);
                                                        }}
                                                        style={{ accentColor: theme.colors.accent }}
                                                    />
                                                    <span style={{ color: theme.colors.primaryText, fontSize: '13px' }}>
                                                        Upgrade
                                                    </span>
                                                </label>
                                                <label style={{ 
                                                    display: 'flex', 
                                                    alignItems: 'center', 
                                                    gap: '6px',
                                                    cursor: 'pointer',
                                                    padding: '10px 14px',
                                                    backgroundColor: upgradeMode === 'reinstall' ? `${theme.colors.warning}20` : theme.colors.secondaryBg,
                                                    border: `1px solid ${upgradeMode === 'reinstall' ? theme.colors.warning : theme.colors.border}`,
                                                    borderRadius: '6px',
                                                    transition: 'all 0.2s'
                                                }}>
                                                    <input
                                                        type="radio"
                                                        name="upgradeMode"
                                                        value="reinstall"
                                                        checked={upgradeMode === 'reinstall'}
                                                        onChange={(e) => {
                                                            setUpgradeMode(e.target.value);
                                                            setConfirmUpgrade(false);
                                                        }}
                                                        style={{ accentColor: theme.colors.warning }}
                                                    />
                                                    <span style={{ color: theme.colors.primaryText, fontSize: '13px' }}>
                                                        Reinstall
                                                    </span>
                                                </label>
                                            </div>
                                            <p style={{ 
                                                color: theme.colors.mutedText, 
                                                fontSize: '11px', 
                                                marginTop: '8px',
                                                marginBottom: 0
                                            }}>
                                                {upgradeMode === 'upgrade' 
                                                    ? '✓ Preserves stable memory and heap data. Safe for production upgrades.'
                                                    : '⚠️ Clears ALL canister state including stable memory. Use with caution!'}
                                            </p>
                                        </div>
                                        
                                        {/* WASM Source */}
                                        <div style={{ marginBottom: '16px' }}>
                                            <label style={{ 
                                                display: 'block',
                                                color: theme.colors.mutedText, 
                                                fontSize: '12px',
                                                marginBottom: '8px'
                                            }}>
                                                WASM Source
                                            </label>
                                            
                                            {/* Source Mode Tabs */}
                                            <div style={{ 
                                                display: 'flex', 
                                                gap: '0',
                                                marginBottom: '12px',
                                                borderRadius: '6px',
                                                overflow: 'hidden',
                                                border: `1px solid ${theme.colors.border}`
                                            }}>
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        setWasmSourceMode('file');
                                                        setConfirmUpgrade(false);
                                                    }}
                                                    style={{
                                                        flex: 1,
                                                        padding: '10px 16px',
                                                        backgroundColor: wasmSourceMode === 'file' 
                                                            ? theme.colors.accent 
                                                            : theme.colors.secondaryBg,
                                                        color: wasmSourceMode === 'file' 
                                                            ? '#fff' 
                                                            : theme.colors.mutedText,
                                                        border: 'none',
                                                        cursor: 'pointer',
                                                        fontSize: '13px',
                                                        fontWeight: wasmSourceMode === 'file' ? '600' : '400',
                                                        transition: 'all 0.2s'
                                                    }}
                                                >
                                                    📁 Upload File
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        setWasmSourceMode('url');
                                                        setConfirmUpgrade(false);
                                                    }}
                                                    style={{
                                                        flex: 1,
                                                        padding: '10px 16px',
                                                        backgroundColor: wasmSourceMode === 'url' 
                                                            ? theme.colors.accent 
                                                            : theme.colors.secondaryBg,
                                                        color: wasmSourceMode === 'url' 
                                                            ? '#fff' 
                                                            : theme.colors.mutedText,
                                                        border: 'none',
                                                        borderLeft: `1px solid ${theme.colors.border}`,
                                                        cursor: 'pointer',
                                                        fontSize: '13px',
                                                        fontWeight: wasmSourceMode === 'url' ? '600' : '400',
                                                        transition: 'all 0.2s'
                                                    }}
                                                >
                                                    🔗 From URL
                                                </button>
                                            </div>
                                            
                                            {/* File Upload Mode */}
                                            {wasmSourceMode === 'file' && (
                                                <div style={{
                                                    border: `2px dashed ${theme.colors.border}`,
                                                    borderRadius: '8px',
                                                    padding: '20px',
                                                    textAlign: 'center',
                                                    backgroundColor: theme.colors.secondaryBg,
                                                    cursor: 'pointer',
                                                    transition: 'all 0.2s'
                                                }}
                                                onClick={() => wasmInputRef.current?.click()}
                                                onDragOver={(e) => {
                                                    e.preventDefault();
                                                    e.currentTarget.style.borderColor = theme.colors.accent;
                                                }}
                                                onDragLeave={(e) => {
                                                    e.preventDefault();
                                                    e.currentTarget.style.borderColor = theme.colors.border;
                                                }}
                                                onDrop={(e) => {
                                                    e.preventDefault();
                                                    e.currentTarget.style.borderColor = theme.colors.border;
                                                    const file = e.dataTransfer.files[0];
                                                    if (file && (file.name.endsWith('.wasm') || file.name.endsWith('.wasm.gz'))) {
                                                        setWasmFile(file);
                                                        setConfirmUpgrade(false);
                                                    } else {
                                                        setError('Please drop a valid .wasm or .wasm.gz file');
                                                    }
                                                }}
                                                >
                                                    <input
                                                        ref={wasmInputRef}
                                                        type="file"
                                                        accept=".wasm,.wasm.gz"
                                                        onChange={handleWasmFileChange}
                                                        style={{ display: 'none' }}
                                                    />
                                                    {wasmFile ? (
                                                        <div>
                                                            <div style={{ 
                                                                color: theme.colors.success, 
                                                                fontSize: '14px',
                                                                fontWeight: '500',
                                                                marginBottom: '4px'
                                                            }}>
                                                                ✓ {wasmFile.name}
                                                            </div>
                                                            <div style={{ color: theme.colors.mutedText, fontSize: '12px' }}>
                                                                {(wasmFile.size / 1024).toFixed(2)} KB
                                                            </div>
                                                        </div>
                                                    ) : (
                                                        <div>
                                                            <FaUpload style={{ 
                                                                color: theme.colors.mutedText, 
                                                                fontSize: '24px',
                                                                marginBottom: '8px'
                                                            }} />
                                                            <div style={{ color: theme.colors.primaryText, fontSize: '13px' }}>
                                                                Click to select or drag & drop
                                                            </div>
                                                            <div style={{ color: theme.colors.mutedText, fontSize: '11px', marginTop: '4px' }}>
                                                                .wasm or .wasm.gz files
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                            
                                            {/* URL Mode */}
                                            {wasmSourceMode === 'url' && (
                                                <div>
                                                    <div style={{ display: 'flex', gap: '8px' }}>
                                                        <input
                                                            type="text"
                                                            value={wasmUrl}
                                                            onChange={(e) => {
                                                                setWasmUrl(e.target.value);
                                                                setWasmFromUrl(null);
                                                                setConfirmUpgrade(false);
                                                            }}
                                                            placeholder="https://raw.githubusercontent.com/org/repo/main/path/module.wasm"
                                                            style={{
                                                                flex: 1,
                                                                padding: '10px 12px',
                                                                border: `1px solid ${theme.colors.border}`,
                                                                borderRadius: '6px',
                                                                backgroundColor: theme.colors.secondaryBg,
                                                                color: theme.colors.primaryText,
                                                                fontSize: '13px',
                                                                outline: 'none'
                                                            }}
                                                        />
                                                        <button
                                                            type="button"
                                                            onClick={handleFetchWasmFromUrl}
                                                            disabled={fetchingWasm || !wasmUrl.trim()}
                                                            style={{
                                                                padding: '10px 16px',
                                                                backgroundColor: theme.colors.accent,
                                                                color: '#fff',
                                                                border: 'none',
                                                                borderRadius: '6px',
                                                                cursor: (fetchingWasm || !wasmUrl.trim()) ? 'not-allowed' : 'pointer',
                                                                opacity: (fetchingWasm || !wasmUrl.trim()) ? 0.6 : 1,
                                                                fontSize: '13px',
                                                                fontWeight: '500',
                                                                whiteSpace: 'nowrap'
                                                            }}
                                                        >
                                                            {fetchingWasm ? 'Fetching...' : 'Fetch WASM'}
                                                        </button>
                                                    </div>
                                                    
                                                    {/* Fetched WASM Info */}
                                                    {wasmFromUrl && (
                                                        <div style={{
                                                            marginTop: '12px',
                                                            padding: '12px',
                                                            backgroundColor: `${theme.colors.success}15`,
                                                            border: `1px solid ${theme.colors.success}30`,
                                                            borderRadius: '6px'
                                                        }}>
                                                            <div style={{ 
                                                                color: theme.colors.success, 
                                                                fontSize: '14px',
                                                                fontWeight: '500',
                                                                marginBottom: '4px'
                                                            }}>
                                                                ✓ {wasmFromUrl.name}
                                                            </div>
                                                            <div style={{ color: theme.colors.mutedText, fontSize: '12px' }}>
                                                                {(wasmFromUrl.size / 1024).toFixed(2)} KB downloaded
                                                            </div>
                                                        </div>
                                                    )}
                                                    
                                                    <p style={{ 
                                                        color: theme.colors.mutedText, 
                                                        fontSize: '11px', 
                                                        marginTop: '8px',
                                                        marginBottom: 0
                                                    }}>
                                                        Enter a direct URL to a .wasm or .wasm.gz file. For GitHub repos, use <code style={{ 
                                                            backgroundColor: theme.colors.tertiaryBg, 
                                                            padding: '1px 4px', 
                                                            borderRadius: '3px',
                                                            fontSize: '10px'
                                                        }}>raw.githubusercontent.com</code> (not github.com/tree/).
                                                    </p>
                                                </div>
                                            )}
                                        </div>
                                        
                                        {/* Init Arguments */}
                                        <div style={{ marginBottom: '16px' }}>
                                            <label style={{ 
                                                display: 'block',
                                                color: theme.colors.mutedText, 
                                                fontSize: '12px',
                                                marginBottom: '8px'
                                            }}>
                                                Init Arguments
                                            </label>
                                            
                                            {/* Mode selector */}
                                            <div style={{ 
                                                display: 'flex', 
                                                gap: '8px', 
                                                marginBottom: '12px',
                                                flexWrap: 'wrap'
                                            }}>
                                                {[
                                                    { value: 'none', label: 'None (empty)' },
                                                    { value: 'principal', label: 'Principal' },
                                                    { value: 'optPrincipal', label: 'Optional Principal' },
                                                    { value: 'didc', label: 'DIDC Blob' },
                                                    { value: 'hex', label: 'Raw Hex' },
                                                ].map(option => (
                                                    <label 
                                                        key={option.value}
                                                        style={{ 
                                                            display: 'flex', 
                                                            alignItems: 'center', 
                                                            gap: '6px',
                                                            cursor: 'pointer',
                                                            padding: '8px 12px',
                                                            backgroundColor: initArgMode === option.value 
                                                                ? `${theme.colors.accent}20` 
                                                                : theme.colors.secondaryBg,
                                                            border: `1px solid ${initArgMode === option.value 
                                                                ? theme.colors.accent 
                                                                : theme.colors.border}`,
                                                            borderRadius: '6px',
                                                            fontSize: '12px',
                                                            transition: 'all 0.2s'
                                                        }}
                                                    >
                                                        <input
                                                            type="radio"
                                                            name="initArgMode"
                                                            value={option.value}
                                                            checked={initArgMode === option.value}
                                                            onChange={(e) => setInitArgMode(e.target.value)}
                                                            style={{ accentColor: theme.colors.accent }}
                                                        />
                                                        <span style={{ color: theme.colors.primaryText }}>
                                                            {option.label}
                                                        </span>
                                                    </label>
                                                ))}
                                            </div>
                                            
                                            {/* Principal input */}
                                            {(initArgMode === 'principal' || initArgMode === 'optPrincipal') && (
                                                <div style={{ marginBottom: '8px' }}>
                                                    <input
                                                        type="text"
                                                        value={initArgPrincipal}
                                                        onChange={(e) => setInitArgPrincipal(e.target.value)}
                                                        placeholder={initArgMode === 'optPrincipal' 
                                                            ? "Principal ID (leave empty for null)" 
                                                            : "Principal ID (e.g., aaaaa-aa)"}
                                                        style={{
                                                            width: '100%',
                                                            padding: '10px 12px',
                                                            border: `1px solid ${theme.colors.border}`,
                                                            borderRadius: '6px',
                                                            backgroundColor: theme.colors.secondaryBg,
                                                            color: theme.colors.primaryText,
                                                            fontSize: '13px',
                                                            fontFamily: 'monospace',
                                                            outline: 'none',
                                                            boxSizing: 'border-box'
                                                        }}
                                                    />
                                                    {initArgMode === 'optPrincipal' && (
                                                        <p style={{ 
                                                            color: theme.colors.mutedText, 
                                                            fontSize: '11px', 
                                                            marginTop: '6px',
                                                            marginBottom: 0
                                                        }}>
                                                            Leave empty to pass <code style={{ 
                                                                backgroundColor: theme.colors.tertiaryBg, 
                                                                padding: '2px 4px', 
                                                                borderRadius: '3px',
                                                                fontSize: '10px'
                                                            }}>null</code> for optional principal.
                                                        </p>
                                                    )}
                                                </div>
                                            )}
                                            
                                            {/* DIDC Blob input */}
                                            {initArgMode === 'didc' && (
                                                <div>
                                                    <textarea
                                                        value={initArgDidc}
                                                        onChange={(e) => setInitArgDidc(e.target.value)}
                                                        placeholder={'blob "DIDL\\00\\01h\\02\\03..."'}
                                                        style={{
                                                            width: '100%',
                                                            minHeight: '60px',
                                                            padding: '10px 12px',
                                                            border: `1px solid ${theme.colors.border}`,
                                                            borderRadius: '6px',
                                                            backgroundColor: theme.colors.secondaryBg,
                                                            color: theme.colors.primaryText,
                                                            fontSize: '13px',
                                                            fontFamily: 'monospace',
                                                            outline: 'none',
                                                            resize: 'vertical',
                                                            boxSizing: 'border-box'
                                                        }}
                                                    />
                                                    <p style={{ 
                                                        color: theme.colors.mutedText, 
                                                        fontSize: '11px', 
                                                        marginTop: '6px',
                                                        marginBottom: 0
                                                    }}>
                                                        Paste the output from <code style={{ 
                                                            backgroundColor: theme.colors.tertiaryBg, 
                                                            padding: '2px 4px', 
                                                            borderRadius: '3px',
                                                            fontSize: '10px'
                                                        }}>didc encode '(args)'</code> directly. Accepts formats like:{' '}
                                                        <code style={{ 
                                                            backgroundColor: theme.colors.tertiaryBg, 
                                                            padding: '2px 4px', 
                                                            borderRadius: '3px',
                                                            fontSize: '10px'
                                                        }}>blob "DIDL\00..."</code>,{' '}
                                                        <code style={{ 
                                                            backgroundColor: theme.colors.tertiaryBg, 
                                                            padding: '2px 4px', 
                                                            borderRadius: '3px',
                                                            fontSize: '10px'
                                                        }}>DIDL\00...</code>, or just{' '}
                                                        <code style={{ 
                                                            backgroundColor: theme.colors.tertiaryBg, 
                                                            padding: '2px 4px', 
                                                            borderRadius: '3px',
                                                            fontSize: '10px'
                                                        }}>\00\01...</code> (DIDL added automatically).
                                                    </p>
                                                </div>
                                            )}
                                            
                                            {/* Hex input */}
                                            {initArgMode === 'hex' && (
                                                <div>
                                                    <textarea
                                                        value={initArgHex}
                                                        onChange={(e) => setInitArgHex(e.target.value)}
                                                        placeholder="Hex-encoded Candid (e.g., 4449444c0001710568656c6c6f)"
                                                        style={{
                                                            width: '100%',
                                                            minHeight: '60px',
                                                            padding: '10px 12px',
                                                            border: `1px solid ${theme.colors.border}`,
                                                            borderRadius: '6px',
                                                            backgroundColor: theme.colors.secondaryBg,
                                                            color: theme.colors.primaryText,
                                                            fontSize: '13px',
                                                            fontFamily: 'monospace',
                                                            outline: 'none',
                                                            resize: 'vertical',
                                                            boxSizing: 'border-box'
                                                        }}
                                                    />
                                                    <p style={{ 
                                                        color: theme.colors.mutedText, 
                                                        fontSize: '11px', 
                                                        marginTop: '6px',
                                                        marginBottom: 0
                                                    }}>
                                                        Raw hex bytes. Use <code style={{ 
                                                            backgroundColor: theme.colors.tertiaryBg, 
                                                            padding: '2px 4px', 
                                                            borderRadius: '3px',
                                                            fontSize: '10px'
                                                        }}>didc encode '(args)' | xxd -p</code> to generate.
                                                    </p>
                                                </div>
                                            )}
                                            
                                            {initArgMode === 'none' && (
                                                <p style={{ 
                                                    color: theme.colors.mutedText, 
                                                    fontSize: '11px', 
                                                    marginTop: '0',
                                                    marginBottom: 0
                                                }}>
                                                    No init arguments will be passed (empty Candid encoding).
                                                </p>
                                            )}
                                        </div>
                                        
                                        {/* Reinstall Warning */}
                                        {upgradeMode === 'reinstall' && hasValidWasm() && (
                                            <div style={{
                                                backgroundColor: `${theme.colors.warning}15`,
                                                border: `1px solid ${theme.colors.warning}`,
                                                borderRadius: '6px',
                                                padding: '12px',
                                                marginBottom: '16px',
                                                display: 'flex',
                                                alignItems: 'flex-start',
                                                gap: '10px'
                                            }}>
                                                <FaExclamationTriangle style={{ 
                                                    color: theme.colors.warning,
                                                    flexShrink: 0,
                                                    marginTop: '2px'
                                                }} />
                                                <div>
                                                    <div style={{ 
                                                        color: theme.colors.warning, 
                                                        fontWeight: '600',
                                                        fontSize: '13px',
                                                        marginBottom: '4px'
                                                    }}>
                                                        Warning: Reinstall will clear all data!
                                                    </div>
                                                    <div style={{ color: theme.colors.mutedText, fontSize: '12px' }}>
                                                        All canister state, including stable memory, will be permanently deleted.
                                                        This action cannot be undone.
                                                    </div>
                                                </div>
                                            </div>
                                        )}
                                        
                                        {/* Confirmation Checkbox */}
                                        {hasValidWasm() && (
                                            <div style={{ marginBottom: '16px' }}>
                                                <label style={{ 
                                                    display: 'flex', 
                                                    alignItems: 'center', 
                                                    gap: '8px',
                                                    cursor: 'pointer',
                                                    padding: '10px 12px',
                                                    backgroundColor: confirmUpgrade ? `${theme.colors.accent}10` : theme.colors.secondaryBg,
                                                    borderRadius: '6px',
                                                    border: `1px solid ${confirmUpgrade ? theme.colors.accent : theme.colors.border}`
                                                }}>
                                                    <input
                                                        type="checkbox"
                                                        checked={confirmUpgrade}
                                                        onChange={(e) => setConfirmUpgrade(e.target.checked)}
                                                        style={{ 
                                                            accentColor: theme.colors.accent,
                                                            width: '16px',
                                                            height: '16px'
                                                        }}
                                                    />
                                                    <span style={{ color: theme.colors.primaryText, fontSize: '13px' }}>
                                                        I understand this will {upgradeMode === 'reinstall' ? 'clear all canister data and reinstall' : 'upgrade'} the canister
                                                    </span>
                                                </label>
                                            </div>
                                        )}
                                        
                                        {/* Upgrade Button */}
                                        <button
                                            onClick={handleUpgradeCanister}
                                            disabled={upgrading || !hasValidWasm() || !confirmUpgrade}
                                            style={{
                                                width: '100%',
                                                backgroundColor: upgradeMode === 'reinstall' ? theme.colors.warning : theme.colors.accent,
                                                color: '#fff',
                                                border: 'none',
                                                borderRadius: '6px',
                                                padding: '12px 24px',
                                                cursor: (upgrading || !hasValidWasm() || !confirmUpgrade) ? 'not-allowed' : 'pointer',
                                                opacity: (upgrading || !hasValidWasm() || !confirmUpgrade) ? 0.6 : 1,
                                                fontSize: '14px',
                                                fontWeight: '600',
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                gap: '8px'
                                            }}
                                        >
                                            {upgrading ? (
                                                <>
                                                    <span style={{
                                                        width: '16px',
                                                        height: '16px',
                                                        border: '2px solid transparent',
                                                        borderTopColor: '#fff',
                                                        borderRadius: '50%',
                                                        animation: 'spin 1s linear infinite'
                                                    }} />
                                                    {upgradeMode === 'reinstall' ? 'Reinstalling...' : 'Upgrading...'}
                                                </>
                                            ) : (
                                                <>
                                                    <FaUpload />
                                                    {upgradeMode === 'reinstall' ? 'Reinstall Canister' : 'Upgrade Canister'}
                                                </>
                                            )}
                                        </button>
                                        
                                        <p style={{ 
                                            color: theme.colors.mutedText, 
                                            fontSize: '11px', 
                                            marginTop: '12px',
                                            marginBottom: 0,
                                            textAlign: 'center'
                                        }}>
                                            The WASM module will be installed on the canister via the IC management canister.
                                        </p>
                                    </div>
                                )}
                            </div>
                        )}

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

