import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { HttpAgent, Actor } from '@dfinity/agent';
import { Principal } from '@dfinity/principal';
import { sha224 } from '@dfinity/principal/lib/esm/utils/sha224';
import { createActor as createManagerActor } from 'declarations/sneed_icp_neuron_manager';
import { createActor as createFactoryActor, canisterId as factoryCanisterId } from 'declarations/sneed_icp_neuron_manager_factory';
import { createActor as createLedgerActor } from 'external/icrc1_ledger';
import { createActor as createCmcActor, CMC_CANISTER_ID } from 'external/cmc';
import Header from '../components/Header';
import TokenSelector from '../components/TokenSelector';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../AuthContext';
import { useNaming } from '../NamingContext';
import { PrincipalDisplay, getPrincipalDisplayInfoFromContext } from '../utils/PrincipalUtils';
import { setPrincipalNickname, setPrincipalNameFor } from '../utils/BackendUtils';
import { FaGasPump, FaRobot, FaBrain, FaArrowRight, FaSync, FaChevronDown, FaChevronUp, FaShieldAlt, FaWallet } from 'react-icons/fa';
import PrincipalInput from '../components/PrincipalInput';
import { uint8ArrayToHex } from '../utils/NeuronUtils';
import { encodeIcrcAccount, decodeIcrcAccount } from '@dfinity/ledger-icrc';
import { getCyclesColor, getNeuronManagerSettings } from '../utils/NeuronManagerSettings';
import TokenIcon from '../components/TokenIcon';
import { getLogoSync } from '../hooks/useLogoCache';
import { useWhitelistTokens } from '../contexts/WhitelistTokensContext';
import { formatUsd, calculateUsdValue } from '../utils/SneedexUtils';
import priceService from '../services/PriceService';
import StatusLamp, {
    LAMP_OFF, LAMP_OK, LAMP_ACTIVE, LAMP_WARN, LAMP_ERROR,
    LAMP_COLORS, LAMP_LABELS, CHORE_DEADLINES,
    getSchedulerLampState, getConductorLampState, getTaskLampState,
    summarizeLampStates, getChoreSummaryLamp, getAllChoresSummaryLamp, getSummaryLabel
} from '../components/ChoreStatusLamp';

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
    0%, 100% { opacity: 1; }
    50% { opacity: 0.7; }
}

@keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
}

.neuron-mgr-float {
    animation: float 3s ease-in-out infinite;
}

.neuron-mgr-fade-in {
    animation: fadeInUp 0.5s ease-out forwards;
}

.spin {
    animation: spin 1s linear infinite;
}

@keyframes lampPulse {
    0%, 100% { box-shadow: 0 0 4px var(--lamp-color, #22c55e), 0 0 8px var(--lamp-color, #22c55e)40; }
    50% { box-shadow: 0 0 8px var(--lamp-color, #22c55e), 0 0 16px var(--lamp-color, #22c55e)60; }
}
`;

// Chore status lamp system — imported from shared component (ChoreStatusLamp.jsx)

// Page accent colors - purple/violet theme for neurons/brain
const neuronPrimary = '#8b5cf6';
const neuronSecondary = '#a78bfa';
const neuronAccent = '#c4b5fd';

const ICP_LEDGER_CANISTER_ID = 'ryjl3-tyaaa-aaaaa-aaaba-cai';
const NNS_GOVERNANCE_CANISTER_ID = 'rrkah-fqaaa-aaaaa-aaaaq-cai';
const MANAGEMENT_CANISTER_ID = Principal.fromText('aaaaa-aa');
const E8S = 100_000_000;
const ICP_FEE = 10_000; // 0.0001 ICP

// CMC memo for top-up operation: "TPUP" = 0x50555054
const TOP_UP_MEMO = new Uint8Array([0x54, 0x50, 0x55, 0x50, 0x00, 0x00, 0x00, 0x00]);

// Management canister IDL factory
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
    // install_code mode for upgrades
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

// NNS Governance Topics - Official IDs from NNS Governance Canister
// Source: https://github.com/dfinity/ic/blob/master/rs/nns/governance/proto/ic_nns_governance/pb/v1/governance.proto
// IMPORTANT: These IDs MUST match the governance canister exactly!
// Critical topics (4 and 14) require explicit followee settings - they don't inherit from "All Topics"
const NNS_TOPICS = [
    { id: 0, name: 'All Topics (Catch-all)', description: 'Default following for all topics without specific followees set', isCritical: false },
    { id: 1, name: 'Neuron Management', description: 'Proposals about neuron-related changes', isCritical: false },
    { id: 2, name: 'Exchange Rate', description: 'Exchange rate oracle updates', isCritical: false },
    { id: 3, name: 'Network Economics', description: 'ICP tokenomics, rewards, etc.', isCritical: false },
    { id: 4, name: 'Governance', description: 'Changes to the governance system itself (critical topic)', isCritical: true },
    { id: 5, name: 'Node Admin', description: 'Node operator management', isCritical: false },
    { id: 6, name: 'Participant Management', description: 'Managing participants in the network', isCritical: false },
    { id: 7, name: 'Subnet Management', description: 'Creating/managing subnets', isCritical: false },
    { id: 8, name: 'Network Canister Management', description: 'NNS canister upgrades', isCritical: false },
    { id: 9, name: 'KYC', description: 'Know Your Customer related', isCritical: false },
    { id: 10, name: 'Node Provider Rewards', description: 'Rewards for node providers', isCritical: false },
    { id: 11, name: 'SNS Decentralization Sale', description: 'SNS token sale proposals (legacy)', isCritical: false },
    { id: 12, name: 'Subnet Replica Version Management', description: 'Managing replica versions for subnets (IC OS deployment)', isCritical: false },
    { id: 13, name: 'Replica Version Management', description: 'Managing IC replica versions (IC OS election)', isCritical: false },
    { id: 14, name: 'SNS & Community Fund', description: 'SNS launches and Neurons\' Fund management (critical topic)', isCritical: true },
    { id: 15, name: 'API Boundary Node Management', description: 'Managing API boundary nodes', isCritical: false },
    { id: 16, name: 'Subnet Rental', description: 'Subnet rental requests', isCritical: false },
    { id: 17, name: 'Protocol Canister Management', description: 'Protocol-level canister management', isCritical: false },
    { id: 18, name: 'Service Nervous System Management', description: 'SNS governance system management', isCritical: false },
];

// Fallback known neurons (used if governance fetch fails)
const KNOWN_NEURONS_FALLBACK = {
    '27': 'DFINITY Foundation',
    '28': 'Internet Computer Association',
};

function IcpNeuronManager() {
    const { canisterId } = useParams();
    const navigate = useNavigate();
    const { theme } = useTheme();
    const { identity, isAuthenticated, login } = useAuth();
    const { principalNames, principalNicknames, fetchAllNames } = useNaming();
    const { whitelistedTokens } = useWhitelistTokens();
    
    // Get display info for the canister
    const displayInfo = getPrincipalDisplayInfoFromContext(canisterId, principalNames, principalNicknames);
    
    // Naming state
    const [showNamingSection, setShowNamingSection] = useState(false);
    const [nicknameInput, setNicknameInput] = useState('');
    const [publicNameInput, setPublicNameInput] = useState('');
    const [savingNickname, setSavingNickname] = useState(false);
    const [savingPublicName, setSavingPublicName] = useState(false);
    const [namingError, setNamingError] = useState('');
    const [namingSuccess, setNamingSuccess] = useState('');
    
    // Manager state
    const [managerInfo, setManagerInfo] = useState(null);
    const [neuronIds, setNeuronIds] = useState([]); // Array of neuron IDs
    const [selectedNeuronId, setSelectedNeuronId] = useState(null); // Currently selected neuron
    const [neuronInfo, setNeuronInfo] = useState(null);
    const [fullNeuron, setFullNeuron] = useState(null);
    
    
    // UI state
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [actionLoading, setActionLoading] = useState('');
    
    // Form state
    const [stakeAmount, setStakeAmount] = useState('1');
    const [stakeDissolveDelay, setStakeDissolveDelay] = useState('365'); // Default 1 year for new neurons
    const [dissolveDelay, setDissolveDelay] = useState('');
    const [hotKeyPrincipal, setHotKeyPrincipal] = useState('');
    const [disburseAmount, setDisburseAmount] = useState('');
    const [disburseToAccount, setDisburseToAccount] = useState('');
    const [selectedTopics, setSelectedTopics] = useState([0]);
    const [followeeIds, setFolloweeIds] = useState('');
    const [increaseStakeAmount, setIncreaseStakeAmount] = useState('');
    const [maturityPercentage, setMaturityPercentage] = useState('100');
    const [spawnController, setSpawnController] = useState('');
    const [disburseMaturityDestination, setDisburseMaturityDestination] = useState('');
    const [splitAmount, setSplitAmount] = useState('');
    const [mergeSourceNeuronId, setMergeSourceNeuronId] = useState('');
    const [withdrawAmount, setWithdrawAmount] = useState('');
    const [withdrawDestination, setWithdrawDestination] = useState('');
    const [withdrawTokenLedger, setWithdrawTokenLedger] = useState(ICP_LEDGER_CANISTER_ID);
    const [withdrawTokenBalance, setWithdrawTokenBalance] = useState(null);
    const [withdrawTokenSymbol, setWithdrawTokenSymbol] = useState('ICP');
    const [withdrawTokenDecimals, setWithdrawTokenDecimals] = useState(8);
    const [withdrawTokenFee, setWithdrawTokenFee] = useState(10000);
    const [customLedgerInput, setCustomLedgerInput] = useState('');
    const [useCustomLedger, setUseCustomLedger] = useState(false);
    const [withdrawSectionExpanded, setWithdrawSectionExpanded] = useState(false);
    const [userIcpBalance, setUserIcpBalance] = useState(null);
    
    // Canister status state
    const [canisterStatus, setCanisterStatus] = useState(null);
    const [controllers, setControllers] = useState([]);
    const [isInvalidManager, setIsInvalidManager] = useState(false); // True if canister doesn't have expected methods
    const [invalidManagerReason, setInvalidManagerReason] = useState(''); // Why it's invalid
    
    // Official version verification
    const [officialVersions, setOfficialVersions] = useState([]);
    const [matchedOfficialVersion, setMatchedOfficialVersion] = useState(null);
    
    // Upgrade state
    const [nextAvailableVersion, setNextAvailableVersion] = useState(null);
    const [latestOfficialVersion, setLatestOfficialVersion] = useState(null);
    const [upgrading, setUpgrading] = useState(false);
    const [upgradeMode, setUpgradeMode] = useState('upgrade'); // 'upgrade' or 'reinstall'
    const [upgradeError, setUpgradeError] = useState(null);
    const [upgradeSuccess, setUpgradeSuccess] = useState(null);
    
    // Controller management state
    const [newControllerInput, setNewControllerInput] = useState('');
    const [updatingControllers, setUpdatingControllers] = useState(false);
    const [confirmRemoveController, setConfirmRemoveController] = useState(null);
    const [controllerSuccess, setControllerSuccess] = useState(null);
    
    // Cycles top-up state
    const [topUpAmount, setTopUpAmount] = useState('');
    const [conversionRate, setConversionRate] = useState(null);
    const [cycleSettings] = useState(() => getNeuronManagerSettings());
    const [showTopUpSection, setShowTopUpSection] = useState(false);
    const [toppingUp, setToppingUp] = useState(false);
    const [topUpSuccessDialog, setTopUpSuccessDialog] = useState(null); // { cyclesAdded, icpSpent }
    
    // Tabs
    const [activeTab, setActiveTab] = useState('overview');
    
    // Known neurons (fetched from governance)
    const [knownNeurons, setKnownNeurons] = useState(KNOWN_NEURONS_FALLBACK);
    
    // Collapsible section states
    const [canisterSectionExpanded, setCanisterSectionExpanded] = useState(true);
    const [neuronSectionExpanded, setNeuronSectionExpanded] = useState(true);
    const [createNeuronExpanded, setCreateNeuronExpanded] = useState(false); // Default collapsed, but auto-expand if no neurons

    // Canister section tabs
    const [canisterActiveTab, setCanisterActiveTab] = useState('info');

    // Botkey permissions state
    const [botkeysSupported, setBotkeysSupported] = useState(null); // null=unknown, true/false
    const [hotkeyPrincipals, setHotkeyPrincipals] = useState([]);
    const [permissionTypes, setPermissionTypes] = useState([]);
    const [loadingPermissions, setLoadingPermissions] = useState(false);
    const [permissionError, setPermissionError] = useState('');
    const [permissionSuccess, setPermissionSuccess] = useState('');
    const [savingPermissions, setSavingPermissions] = useState(false);
    const [newHotkeyPrincipal, setNewHotkeyPrincipal] = useState('');
    const [newHotkeyPermissions, setNewHotkeyPermissions] = useState({});
    const [editingPrincipal, setEditingPrincipal] = useState(null);
    const [editPermissions, setEditPermissions] = useState({});
    const [confirmRemoveHotkey, setConfirmRemoveHotkey] = useState(null);

    // Bot Chores state
    const [choreStatuses, setChoreStatuses] = useState([]);
    const [choreConfigs, setChoreConfigs] = useState([]);
    const [loadingChores, setLoadingChores] = useState(false);
    const [choreError, setChoreError] = useState('');
    const [choreSuccess, setChoreSuccess] = useState('');
    const [savingChore, setSavingChore] = useState(false);
    const [choreActiveTab, setChoreActiveTab] = useState('confirm-following'); // typeId tab
    const [choreActiveInstance, setChoreActiveInstance] = useState(null); // instanceId sub-tab (null = first/only)
    const [creatingInstance, setCreatingInstance] = useState(false);
    const [newInstanceLabel, setNewInstanceLabel] = useState('');
    const [renamingInstance, setRenamingInstance] = useState(null); // instanceId being renamed
    const [renameLabel, setRenameLabel] = useState('');
    // Per-instance chore-specific settings (keyed by instanceId)
    const [cmSettingsMap, setCmSettingsMap] = useState({}); // { instanceId: { thresholdE8s, destination, principalInput, subaccount } }
    const [distListsMap, setDistListsMap] = useState({}); // { instanceId: [DistributionList] }
    const [editingDistList, setEditingDistList] = useState(null); // working copy being edited
    const [editingDistListId, setEditingDistListId] = useState(null); // null = adding new, number = editing existing
    const [distTokenPrices, setDistTokenPrices] = useState({}); // { canisterId: usdPrice }
    const [distTokenMeta, setDistTokenMeta] = useState({}); // { canisterId: { symbol, logo, decimals } }

    // Helper: look up token info from whitelist or cache
    const getTokenInfo = useCallback((canisterId) => {
        const cidStr = typeof canisterId === 'string' ? canisterId : canisterId?.toString?.() || '';
        // Check our local meta cache first
        if (distTokenMeta[cidStr]) return distTokenMeta[cidStr];
        // Try whitelist
        if (whitelistedTokens) {
            const wt = whitelistedTokens.find(t => t.ledger_id?.toString?.() === cidStr || t.ledger_id === cidStr);
            if (wt) return { symbol: wt.symbol, logo: wt.logo || getLogoSync(cidStr), decimals: wt.decimals ?? 8, name: wt.name };
        }
        // ICP default
        if (cidStr === 'ryjl3-tyaaa-aaaaa-aaaba-cai') return { symbol: 'ICP', logo: getLogoSync(cidStr), decimals: 8, name: 'Internet Computer' };
        return { symbol: '?', logo: getLogoSync(cidStr), decimals: 8, name: cidStr };
    }, [whitelistedTokens, distTokenMeta]);

    // Check if current user is a controller
    const isController = identity && controllers.length > 0 && 
        controllers.some(c => c.toString() === identity.getPrincipal().toString());

    // User's botkey permissions (fetched from canister)
    const [userPermissions, setUserPermissions] = useState(null); // null=not loaded, Set of permission keys
    const [userPermissionsLoading, setUserPermissionsLoading] = useState(false);

    // Check if the user has a specific permission (controllers always have all permissions)
    const hasPermission = useCallback((permKey) => {
        if (isController) return true;
        if (!userPermissions) return false;
        if (userPermissions.has('FullPermissions')) return true;
        return userPermissions.has(permKey);
    }, [isController, userPermissions]);

    // Map choreId to its per-chore manage permission key
    const choreManagePerm = useCallback((choreIdOrTypeId) => {
        // For multi-instance chores, the choreId may be like "distribute-funds-m1abc",
        // so we also check if it starts with a known type prefix.
        const id = choreIdOrTypeId || '';
        if (id === 'confirm-following' || id.startsWith('confirm-following-')) return 'ManageConfirmFollowing';
        if (id === 'refresh-stake' || id.startsWith('refresh-stake-')) return 'ManageRefreshStake';
        if (id === 'collect-maturity' || id.startsWith('collect-maturity-')) return 'ManageCollectMaturity';
        if (id === 'distribute-funds' || id.startsWith('distribute-funds-')) return 'ManageDistributeFunds';
        return null;
    }, []);

    // Check if user can manage a specific chore
    const canManageChore = useCallback((choreId) => {
        const perm = choreManagePerm(choreId);
        return perm ? hasPermission(perm) : false;
    }, [choreManagePerm, hasPermission]);

    // Check if user can manage ANY chore (for showing chores tab)
    const canManageAnyChore = hasPermission('ManageConfirmFollowing') ||
        hasPermission('ManageRefreshStake') ||
        hasPermission('ManageCollectMaturity') ||
        hasPermission('ManageDistributeFunds') ||
        hasPermission('ConfigureCollectMaturity') ||
        hasPermission('ConfigureDistribution');

    // Check if user has ANY permission at all (controller or any botkey)
    const hasAnyPermission = isController || (userPermissions && userPermissions.size > 0);

    // Permission keys for each neuron tab
    // ViewNeuron grants read-only access to all tabs (can see data but actions are gated individually)
    const TAB_PERMISSIONS = {
        'stake': ['StakeNeuron', 'AutoStakeMaturity', 'ViewNeuron'],
        'maturity': ['StakeMaturity', 'MergeMaturity', 'DisburseMaturity', 'Spawn', 'ViewNeuron'],
        'following': ['ManageFollowees', 'ViewNeuron'],
        'dissolve': ['ConfigureDissolveState', 'ViewNeuron'],
        'disburse': ['Disburse', 'ViewNeuron'],
        'hotkeys': ['ManageNeuronHotkeys', 'ViewNeuron'],
        'advanced': ['Split', 'MergeNeurons', 'ManageVisibility', 'ViewNeuron'],
    };

    // Check if user has access to a given tab (has at least one of the tab's permissions)
    const hasTabAccess = useCallback((tabKey) => {
        if (isController) return true;
        const perms = TAB_PERMISSIONS[tabKey];
        if (!perms) return true; // overview etc.
        return perms.some(p => hasPermission(p));
    }, [isController, hasPermission]);

    // Wrapper for action sections that require a specific permission.
    // Shows content but disabled/dimmed with a label when the user lacks access.
    const PermissionGate = useCallback(({ permKey, children }) => {
        const allowed = hasPermission(permKey);
        if (allowed) return children;
        return (
            <div style={{ position: 'relative', opacity: 0.45, pointerEvents: 'none', userSelect: 'none' }}>
                <div style={{
                    position: 'absolute',
                    top: '6px',
                    right: '6px',
                    background: `${theme.colors.warning}20`,
                    color: theme.colors.warning,
                    padding: '2px 8px',
                    borderRadius: '4px',
                    fontSize: '10px',
                    fontWeight: '600',
                    zIndex: 1,
                    pointerEvents: 'auto',
                }}>
                    🔒 No permission
                </div>
                {children}
            </div>
        );
    }, [hasPermission, theme]);

    // Reset to overview tab if user doesn't have access to current neuron tab
    useEffect(() => {
        if (!hasAnyPermission && activeTab !== 'overview') {
            setActiveTab('overview');
        } else if (hasAnyPermission && !isController && activeTab !== 'overview' && !hasTabAccess(activeTab)) {
            setActiveTab('overview');
        }
    }, [isController, hasAnyPermission, hasTabAccess, activeTab]);

    const getAgent = useCallback(() => {
        const host = process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging' 
            ? 'https://ic0.app' 
            : 'http://localhost:4943';
        return new HttpAgent({ identity, host });
    }, [identity]);

    // Fetch known neurons from NNS governance (always from mainnet)
    const fetchKnownNeurons = useCallback(async () => {
        try {
            // Always use mainnet for known neurons (they don't exist on local replica)
            const mainnetAgent = new HttpAgent({ host: 'https://ic0.app' });
            
            // Dynamic import for Actor
            const { Actor } = await import('@dfinity/agent');
            const { IDL } = await import('@dfinity/candid');
            
            // Minimal IDL for list_known_neurons
            const idlFactory = ({ IDL }) => {
                const NeuronId = IDL.Record({ id: IDL.Nat64 });
                const KnownNeuronData = IDL.Record({
                    name: IDL.Text,
                    description: IDL.Opt(IDL.Text),
                });
                const KnownNeuron = IDL.Record({
                    id: IDL.Opt(NeuronId),
                    known_neuron_data: IDL.Opt(KnownNeuronData),
                });
                const ListKnownNeuronsResponse = IDL.Record({
                    known_neurons: IDL.Vec(KnownNeuron),
                });
                return IDL.Service({
                    list_known_neurons: IDL.Func([], [ListKnownNeuronsResponse], ['query']),
                });
            };
            
            const governance = Actor.createActor(idlFactory, {
                agent: mainnetAgent,
                canisterId: NNS_GOVERNANCE_CANISTER_ID,
            });
            
            const result = await governance.list_known_neurons();
            
            // Build lookup map
            const neuronsMap = {};
            for (const neuron of result.known_neurons) {
                // Handle optional fields (Candid optionals are arrays in JS)
                const neuronId = Array.isArray(neuron.id) ? neuron.id[0] : neuron.id;
                const neuronData = Array.isArray(neuron.known_neuron_data) ? neuron.known_neuron_data[0] : neuron.known_neuron_data;
                
                if (neuronId && neuronData && neuronData.name) {
                    const id = neuronId.id.toString();
                    neuronsMap[id] = neuronData.name;
                }
            }
            
            // Merge with fallback
            setKnownNeurons({ ...KNOWN_NEURONS_FALLBACK, ...neuronsMap });
            console.log(`Loaded ${Object.keys(neuronsMap).length} known neurons from NNS governance`);
        } catch (err) {
            console.error('Failed to fetch known neurons, using fallback:', err);
            // Keep fallback values
        }
    }, []);

    // Helper to get neuron name
    const getNeuronName = useCallback((neuronId) => {
        const idStr = neuronId.toString();
        return knownNeurons[idStr] || null;
    }, [knownNeurons]);

    // Format neuron ID with name if known
    const formatNeuronId = useCallback((neuronId) => {
        const name = getNeuronName(neuronId);
        return name ? `${name} (${neuronId})` : neuronId.toString();
    }, [getNeuronName]);

    const fetchManagerData = useCallback(async () => {
        if (!canisterId) return;
        
        setLoading(true);
        setError('');
        setIsInvalidManager(false);
        setInvalidManagerReason('');
        
        try {
            const agent = getAgent();
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
            }
            
            const manager = createManagerActor(canisterId, { agent });
            
            // Try to fetch basic info - handle failures gracefully
            let version = null;
            let neuronIdsResult = [];
            let managerMethodsFailed = false;
            let failureReason = '';
            
            try {
                version = await manager.getVersion();
            } catch (versionErr) {
                console.warn('getVersion failed:', versionErr.message);
                managerMethodsFailed = true;
                if (versionErr.message?.includes('has no query method')) {
                    failureReason = 'This app canister does not appear to be an ICP Staking Bot (missing getVersion method).';
                } else {
                    failureReason = `Could not get version: ${versionErr.message || 'Unknown error'}`;
                }
            }
            
            let neuronPermissionDenied = false;
            try {
                neuronIdsResult = await manager.getNeuronIds();
            } catch (neuronsErr) {
                console.warn('getNeuronIds failed:', neuronsErr.message);
                // Check if this is a permission denial (assertion failure from ViewNeuron gate)
                if (neuronsErr.message?.includes('assertion') || neuronsErr.message?.includes('Canister trapped')) {
                    // Permission denied - user doesn't have ViewNeuron permission
                    // This is fine - they can still use Bot section and permissionless features
                    neuronPermissionDenied = true;
                } else if (!managerMethodsFailed) {
                    managerMethodsFailed = true;
                    if (neuronsErr.message?.includes('has no query method')) {
                        failureReason = 'This app canister does not appear to be an ICP Staking Bot (missing getNeuronIds method).';
                    } else {
                        failureReason = `Could not get neurons: ${neuronsErr.message || 'Unknown error'}`;
                    }
                }
            }
            
            if (managerMethodsFailed) {
                setIsInvalidManager(true);
                setInvalidManagerReason(failureReason);
                // Still set basic manager info so we can show the canister section
                setManagerInfo({
                    canisterId,
                    version: version ? `${Number(version.major)}.${Number(version.minor)}.${Number(version.patch)}` : null,
                });
                setNeuronIds([]);
                setSelectedNeuronId(null);
                setNeuronInfo(null);
                setFullNeuron(null);
            } else {
                setManagerInfo({
                    canisterId,
                    version: `${Number(version.major)}.${Number(version.minor)}.${Number(version.patch)}`,
                });
                
                if (neuronPermissionDenied) {
                    // User doesn't have ViewNeuron permission - show page but no neuron data
                    setNeuronIds([]);
                    setSelectedNeuronId(null);
                    setNeuronInfo(null);
                    setFullNeuron(null);
                } else {
                    // Set neuron IDs
                    const neurons = neuronIdsResult || [];
                    setNeuronIds(neurons);
                    
                    // Select first neuron if exists and none selected
                    if (neurons.length > 0) {
                        const firstNeuron = neurons[0];
                        setSelectedNeuronId(prev => prev || firstNeuron);
                        // Fetch info for selected neuron
                        fetchNeuronInfo(manager, firstNeuron);
                    } else {
                        setSelectedNeuronId(null);
                        setNeuronInfo(null);
                        setFullNeuron(null);
                    }
                }
            }
            
            // Fetch user ICP balance
            fetchUserBalance(agent);
            
        } catch (err) {
            console.error('Error fetching manager data:', err);
            setError(`Failed to load manager: ${err.message || 'Unknown error'}`);
            // Still set basic info so canister section can be shown
            setManagerInfo({ canisterId, version: null });
            setIsInvalidManager(true);
            setInvalidManagerReason(err.message || 'Unknown error');
        } finally {
            setLoading(false);
        }
    }, [canisterId, getAgent, identity]);

    const fetchUserBalance = async (agent) => {
        if (!identity) return;
        try {
            const ledger = createLedgerActor(ICP_LEDGER_CANISTER_ID, { agent });
            const balance = await ledger.icrc1_balance_of({
                owner: identity.getPrincipal(),
                subaccount: [],
            });
            setUserIcpBalance(Number(balance));
        } catch (err) {
            console.error('Error fetching user ICP balance:', err);
        }
    };

    // Fetch canister status (cycles and controllers)
    const fetchCanisterStatus = useCallback(async () => {
        if (!canisterId || !identity) return;
        
        try {
            const host = process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging' 
                ? 'https://icp0.io' 
                : 'http://localhost:4943';
            const agent = HttpAgent.createSync({ host, identity });
            
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
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
            
            const status = await managementCanister.canister_status({
                canister_id: canisterPrincipal
            });
            
            setCanisterStatus({
                cycles: Number(status.cycles),
                memorySize: Number(status.memory_size),
                status: Object.keys(status.status)[0],
                moduleHash: status.module_hash[0] ? uint8ArrayToHex(status.module_hash[0]) : null,
            });
            setControllers(status.settings.controllers);
            
        } catch (err) {
            console.error('Error fetching canister status:', err);
            // User might not be a controller - that's ok, just don't show the info
            setCanisterStatus(null);
            setControllers([]);
        }
    }, [canisterId, identity]);

    // Fetch official versions from factory
    const fetchOfficialVersions = useCallback(async () => {
        try {
            const host = process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging' 
                ? 'https://icp0.io' 
                : 'http://localhost:4943';
            const agent = HttpAgent.createSync({ host });
            
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
            }
            
            const factory = createFactoryActor(factoryCanisterId, { agent });
            const versions = await factory.getOfficialVersions();
            setOfficialVersions(versions);
        } catch (err) {
            console.error('Error fetching official versions:', err);
            setOfficialVersions([]);
        }
    }, []);

    // Match canister's module hash against official versions
    useEffect(() => {
        if (!canisterStatus?.moduleHash || officialVersions.length === 0) {
            setMatchedOfficialVersion(null);
            return;
        }
        
        const moduleHashLower = canisterStatus.moduleHash.toLowerCase();
        const matched = officialVersions.find(v => 
            v.wasmHash.toLowerCase() === moduleHashLower
        );
        setMatchedOfficialVersion(matched || null);
    }, [canisterStatus?.moduleHash, officialVersions]);

    // Helper to compare versions
    const compareVersions = (a, b) => {
        const aMajor = Number(a.major), aMinor = Number(a.minor), aPatch = Number(a.patch);
        const bMajor = Number(b.major), bMinor = Number(b.minor), bPatch = Number(b.patch);
        if (aMajor !== bMajor) return aMajor - bMajor;
        if (aMinor !== bMinor) return aMinor - bMinor;
        return aPatch - bPatch;
    };

    // Find the latest official version with a WASM URL
    useEffect(() => {
        if (officialVersions.length === 0) {
            setLatestOfficialVersion(null);
            return;
        }
        
        const versionsWithWasm = officialVersions.filter(v => v.wasmUrl && v.wasmUrl.trim().length > 0);
        if (versionsWithWasm.length === 0) {
            setLatestOfficialVersion(null);
            return;
        }
        
        // Sort descending and get the highest version
        versionsWithWasm.sort((a, b) => compareVersions(b, a));
        setLatestOfficialVersion(versionsWithWasm[0]);
    }, [officialVersions]);

    // Find next available version (higher than current, with a WASM URL)
    useEffect(() => {
        if (!matchedOfficialVersion || officialVersions.length === 0) {
            setNextAvailableVersion(null);
            return;
        }
        
        const currentMajor = Number(matchedOfficialVersion.major);
        const currentMinor = Number(matchedOfficialVersion.minor);
        const currentPatch = Number(matchedOfficialVersion.patch);
        
        // Filter versions that are higher than current and have a wasmUrl
        const higherVersions = officialVersions.filter(v => {
            const vMajor = Number(v.major), vMinor = Number(v.minor), vPatch = Number(v.patch);
            const isHigher = vMajor > currentMajor || 
                (vMajor === currentMajor && vMinor > currentMinor) ||
                (vMajor === currentMajor && vMinor === currentMinor && vPatch > currentPatch);
            return isHigher && v.wasmUrl && v.wasmUrl.trim().length > 0;
        });
        
        if (higherVersions.length === 0) {
            setNextAvailableVersion(null);
            return;
        }
        
        // Sort and get the closest higher version
        higherVersions.sort(compareVersions);
        setNextAvailableVersion(higherVersions[0]);
    }, [matchedOfficialVersion, officialVersions]);

    // Fetch ICP to cycles conversion rate from CMC
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
                timestamp: Number(response.data.timestamp_seconds),
            });
        } catch (err) {
            console.error('Error fetching conversion rate:', err);
        }
    }, []);

    // Calculate CMC subaccount for a canister principal
    const principalToSubaccount = (principal) => {
        const bytes = principal.toUint8Array();
        const subaccount = new Uint8Array(32);
        subaccount[0] = bytes.length;
        subaccount.set(bytes, 1);
        return subaccount;
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

    // Update controllers on the canister
    const updateControllers = async (newControllers) => {
        if (!identity || !canisterId) return;
        
        setUpdatingControllers(true);
        setError('');
        setControllerSuccess(null);
        
        try {
            const canisterPrincipal = Principal.fromText(canisterId);
            const host = process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging' 
                ? 'https://icp0.io' 
                : 'http://localhost:4943';
            const agent = HttpAgent.createSync({ host, identity });

            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
            }

            const managementCanister = Actor.createActor(managementCanisterIdlFactory, {
                agent,
                canisterId: MANAGEMENT_CANISTER_ID,
                callTransform: (methodName, args, callConfig) => ({
                    ...callConfig,
                    effectiveCanisterId: canisterPrincipal,
                }),
            });

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

            setControllerSuccess('Controllers updated successfully');
            
            // Refresh canister status
            await fetchCanisterStatus();
            
        } catch (e) {
            console.error('Failed to update controllers:', e);
            setError('Failed to update controllers: ' + (e.message || 'Unknown error'));
        } finally {
            setUpdatingControllers(false);
        }
    };

    // Add a new controller
    const handleAddController = async () => {
        if (!newControllerInput.trim()) return;
        
        try {
            const newControllerPrincipal = Principal.fromText(newControllerInput.trim());
            
            // Check if already a controller
            const isAlreadyController = controllers.some(c => c.toString() === newControllerPrincipal.toString());
            
            if (isAlreadyController) {
                setError('This principal is already a controller');
                return;
            }
            
            // Create new list with the added controller
            const newControllers = [...controllers, newControllerPrincipal];
            
            await updateControllers(newControllers);
            setNewControllerInput('');
            
        } catch (e) {
            setError('Invalid principal ID format');
        }
    };

    // Remove a controller
    const handleRemoveController = async (controllerToRemove) => {
        const controllerStr = controllerToRemove.toString();
        
        // Check if this is the last controller
        if (controllers.length === 1) {
            setError('Cannot remove the last controller - the canister would become permanently uncontrollable');
            setConfirmRemoveController(null);
            return;
        }
        
        // Filter out the controller to remove
        const newControllers = controllers.filter(c => c.toString() !== controllerStr);
        
        await updateControllers(newControllers);
        setConfirmRemoveController(null);
    };

    // Handle one-click upgrade/reinstall to a version
    const handleUpgrade = async (targetVersion, mode = 'upgrade') => {
        if (!identity || !canisterId || !targetVersion || !targetVersion.wasmUrl) {
            return;
        }
        
        setUpgrading(true);
        setUpgradeMode(mode);
        setUpgradeError(null);
        setUpgradeSuccess(null);
        
        try {
            const versionStr = `${Number(targetVersion.major)}.${Number(targetVersion.minor)}.${Number(targetVersion.patch)}`;
            console.log(`Starting ${mode} to v${versionStr}...`);
            
            // Step 1: Fetch the WASM from URL
            console.log(`Fetching WASM from: ${targetVersion.wasmUrl}`);
            const response = await fetch(targetVersion.wasmUrl);
            
            if (!response.ok) {
                throw new Error(`Failed to fetch WASM: ${response.status} ${response.statusText}`);
            }
            
            const arrayBuffer = await response.arrayBuffer();
            const wasmModule = new Uint8Array(arrayBuffer);
            
            if (wasmModule.length === 0) {
                throw new Error('Downloaded WASM file is empty');
            }
            
            // Validate WASM magic bytes (0x00 0x61 0x73 0x6D = "\0asm") or gzip (0x1f 0x8b)
            const isWasm = wasmModule[0] === 0x00 && wasmModule[1] === 0x61 && wasmModule[2] === 0x73 && wasmModule[3] === 0x6D;
            const isGzip = wasmModule[0] === 0x1F && wasmModule[1] === 0x8B;
            
            if (!isWasm && !isGzip) {
                throw new Error('Downloaded file does not appear to be a valid WASM module');
            }
            
            console.log(`WASM downloaded: ${(wasmModule.length / 1024).toFixed(2)} KB`);
            
            // Step 2: Call install_code to upgrade
            const canisterPrincipal = Principal.fromText(canisterId);
            const host = process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging' 
                ? 'https://icp0.io' 
                : 'http://localhost:4943';
            const agent = HttpAgent.createSync({ host, identity });
            
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
            }
            
            const managementCanister = Actor.createActor(managementCanisterIdlFactory, {
                agent,
                canisterId: MANAGEMENT_CANISTER_ID,
                callTransform: (methodName, args, callConfig) => ({
                    ...callConfig,
                    effectiveCanisterId: canisterPrincipal,
                }),
            });
            
            // Empty Candid args (DIDL header for no arguments)
            const emptyArgs = new Uint8Array([0x44, 0x49, 0x44, 0x4C, 0x00, 0x00]);
            
            console.log(`Calling install_code with mode: ${mode}...`);
            
            // Set the mode based on parameter
            const installMode = mode === 'reinstall' ? { reinstall: null } : { upgrade: null };
            
            await managementCanister.install_code({
                mode: installMode,
                canister_id: canisterPrincipal,
                wasm_module: wasmModule,
                arg: emptyArgs,
            });
            
            console.log(`${mode === 'reinstall' ? 'Reinstall' : 'Upgrade'} successful!`);
            setUpgradeSuccess(`✅ Successfully ${mode === 'reinstall' ? 'reinstalled' : 'upgraded'} to v${versionStr}`);
            
            // Refresh canister status and manager data to show the new version
            await Promise.all([
                fetchCanisterStatus(),
                fetchManagerData(),
            ]);
            
        } catch (err) {
            console.error('Upgrade failed:', err);
            setUpgradeError(`Upgrade failed: ${err.message || 'Unknown error'}`);
        } finally {
            setUpgrading(false);
        }
    };

    // Handle cycles top-up
    const handleCyclesTopUp = async () => {
        if (!identity || !canisterId || !topUpAmount) return;
        
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
        setError('');
        setSuccess('');
        
        try {
            const host = process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging' 
                ? 'https://ic0.app' 
                : 'http://localhost:4943';
            const agent = new HttpAgent({ identity, host });
            
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
            }
            
            const canisterPrincipal = Principal.fromText(canisterId);
            const cmcPrincipal = Principal.fromText(CMC_CANISTER_ID);
            
            // Step 1: Transfer ICP to CMC with canister's subaccount and TPUP memo
            const ledger = createLedgerActor(ICP_LEDGER_CANISTER_ID, { agent });
            const subaccount = principalToSubaccount(canisterPrincipal);
            
            console.log('Transferring ICP to CMC for cycles top-up...');
            
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
                }
                throw new Error(`Unknown CMC error: ${JSON.stringify(err)}`);
            }
            
            const cyclesAdded = Number(notifyResult.Ok);
            
            // Show success dialog
            setTopUpSuccessDialog({
                cyclesAdded,
                icpSpent: icpAmount
            });
            
            setTopUpAmount('');
            setShowTopUpSection(false);
            
            // Refresh data
            fetchCanisterStatus();
            fetchUserBalance(agent);
            
        } catch (err) {
            console.error('Cycles top-up error:', err);
            setError(`Top-up failed: ${err.message || 'Unknown error'}`);
        } finally {
            setToppingUp(false);
        }
    };

    const fetchNeuronInfo = async (manager, neuronId) => {
        if (!neuronId) return;
        
        try {
            const [infoResult, fullResult] = await Promise.all([
                manager.getNeuronInfo(neuronId),
                manager.getFullNeuron(neuronId),
            ]);
            
            // These return optional types directly, not Results
            if (infoResult && infoResult.length > 0) {
                setNeuronInfo(infoResult[0]);
            } else {
                setNeuronInfo(null);
            }
            if (fullResult && fullResult.length > 0) {
                setFullNeuron(fullResult[0]);
            } else {
                setFullNeuron(null);
            }
        } catch (err) {
            console.error('Error fetching neuron info:', err);
        }
    };
    
    // Handle neuron selection change
    const handleNeuronSelect = async (neuronId) => {
        setSelectedNeuronId(neuronId);
        setNeuronInfo(null);
        setFullNeuron(null);
        
        if (neuronId) {
            try {
                const agent = getAgent();
                if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                    await agent.fetchRootKey();
                }
                const manager = createManagerActor(canisterId, { agent });
                await fetchNeuronInfo(manager, neuronId);
            } catch (err) {
                console.error('Error fetching selected neuron:', err);
            }
        }
    };

    // Load bot chore statuses and configs
    // silent=true skips the loading indicator (for background auto-refresh)
    const loadChoreData = useCallback(async (silent = false) => {
        if (!canisterId) return;
        if (!silent) {
            setLoadingChores(true);
            setChoreError('');
        }
        try {
            const agent = getAgent();
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
            }
            const manager = createManagerActor(canisterId, { agent });
            const [statuses, configs] = await Promise.all([
                manager.getChoreStatuses(),
                manager.getChoreConfigs(),
            ]);
            setChoreStatuses(statuses);
            setChoreConfigs(configs);

            // Load per-instance chore-specific settings (best-effort)
            const newCmMap = {};
            const newDistMap = {};
            for (const s of statuses) {
                const tid = s.choreTypeId || s.choreId;
                const iid = s.choreId;
                try {
                    if (tid === 'collect-maturity') {
                        const cmSettings = await manager.getCollectMaturitySettings(iid);
                        const dest = cmSettings.destination.length > 0 ? cmSettings.destination[0] : null;
                        newCmMap[iid] = {
                            thresholdE8s: cmSettings.thresholdE8s.length > 0 ? cmSettings.thresholdE8s[0] : null,
                            destination: dest,
                            principalInput: dest ? dest.owner.toString() : '',
                            subaccount: dest?.subaccount?.length > 0 ? (new Uint8Array(dest.subaccount[0]).every(b => b === 0) ? null : new Uint8Array(dest.subaccount[0])) : null,
                        };
                    } else if (tid === 'distribute-funds') {
                        const lists = await manager.getDistributionLists(iid);
                        newDistMap[iid] = lists;
                    }
                } catch (e) {
                    console.warn(`Could not load settings for ${iid}:`, e);
                }
            }
            setCmSettingsMap(newCmMap);
            setDistListsMap(newDistMap);
        } catch (err) {
            console.error('Error loading chore data:', err);
            if (!silent) {
                setChoreStatuses([]);
                setChoreConfigs([]);
            }
        } finally {
            if (!silent) setLoadingChores(false);
        }
    }, [canisterId, getAgent]);

    useEffect(() => {
        if (isAuthenticated && identity && canisterId) {
            fetchManagerData();
            fetchKnownNeurons(); // Fetch known neurons for displaying names
            fetchCanisterStatus(); // Fetch cycles and controllers
            fetchConversionRate(); // Fetch ICP to cycles conversion rate
            loadChoreData(); // Fetch chore statuses eagerly (for header/banner lamps)
        }
        // Fetch official versions regardless of auth (public data)
        fetchOfficialVersions();
    }, [isAuthenticated, identity, canisterId, fetchManagerData, fetchKnownNeurons, fetchCanisterStatus, fetchConversionRate, fetchOfficialVersions, loadChoreData]);

    // Fetch USD prices for distribution list tokens (across all instances)
    useEffect(() => {
        const allLists = Object.values(distListsMap).flat();
        if (allLists.length === 0) return;
        const uniqueTokens = [...new Set(allLists.map(l => l.tokenLedgerCanisterId?.toString?.() || l.tokenLedgerCanisterId))];
        uniqueTokens.forEach(async (cid) => {
            if (distTokenPrices[cid] !== undefined) return; // Already fetched or fetching
            try {
                const info = getTokenInfo(cid);
                const price = await priceService.getTokenUSDPrice(cid, info.decimals);
                setDistTokenPrices(prev => ({ ...prev, [cid]: price }));
            } catch (e) {
                setDistTokenPrices(prev => ({ ...prev, [cid]: null }));
            }
        });
    }, [distListsMap, getTokenInfo]);

    // Fetch chore data when switching to the chores tab
    useEffect(() => {
        if (canisterActiveTab === 'chores' && canisterSectionExpanded) {
            loadChoreData();
        }
    }, [canisterActiveTab, canisterSectionExpanded, loadChoreData]);

    // --- Smart auto-refresh for chore statuses ---
    // Each time choreStatuses changes, this effect decides when to fetch next.
    // loadChoreData(true) updates choreStatuses, which re-triggers this effect,
    // creating a self-sustaining refresh loop with adaptive intervals.
    const choreRefreshTimerRef = useRef(null);

    useEffect(() => {
        const clearTimer = () => {
            if (choreRefreshTimerRef.current) {
                clearTimeout(choreRefreshTimerRef.current);
                choreRefreshTimerRef.current = null;
            }
        };

        if (!canisterId || !isAuthenticated || choreStatuses.length === 0) {
            clearTimer();
            return clearTimer;
        }

        // Determine if any conductor is currently active
        const anyActive = choreStatuses.some(
            chore => !('Idle' in chore.conductorStatus)
        );

        let delayMs;

        if (anyActive) {
            // A chore is actively running — poll every 5 seconds
            delayMs = 5_000;
        } else {
            // No conductor active — find the soonest nextScheduledRunAt
            let soonestMs = Infinity;
            for (const chore of choreStatuses) {
                if (chore.nextScheduledRunAt && chore.nextScheduledRunAt.length > 0) {
                    const nextMs = Number(chore.nextScheduledRunAt[0]) / 1_000_000;
                    if (nextMs > 0 && nextMs < soonestMs) {
                        soonestMs = nextMs;
                    }
                }
            }

            const nowMs = Date.now();
            if (soonestMs !== Infinity && soonestMs > nowMs) {
                // Wake up shortly after the next chore is due to fire
                // Cap at 60 seconds so we don't sleep for days
                delayMs = Math.min(soonestMs - nowMs + 3_000, 60_000);
            } else {
                // Fallback: lazy background check every 60 seconds
                delayMs = 60_000;
            }
        }

        clearTimer();
        choreRefreshTimerRef.current = setTimeout(() => {
            loadChoreData(true); // silent refresh — updates choreStatuses, re-triggers this effect
        }, delayMs);

        return clearTimer;
    }, [canisterId, isAuthenticated, choreStatuses, loadChoreData]);

    // Auto-expand canister section when manager is invalid (for easy access to upgrade/reinstall)
    useEffect(() => {
        if (isInvalidManager) {
            setCanisterSectionExpanded(true);
        }
    }, [isInvalidManager]);

    // Load botkey permissions data (robust: detects older bots without botkey APIs)
    const loadHotkeyPermissions = useCallback(async () => {
        if (!canisterId) return;
        setLoadingPermissions(true);
        setPermissionError('');
        try {
            const agent = getAgent();
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
            }
            const manager = createManagerActor(canisterId, { agent });
            const [principals, types] = await Promise.all([
                manager.listHotkeyPrincipals(),
                manager.listPermissionTypes(),
            ]);
            setHotkeyPrincipals(principals);
            setPermissionTypes(types);
            setBotkeysSupported(true);
        } catch (err) {
            console.error('Error loading botkey permissions:', err);
            // Detect older bots that don't have the botkey API
            const msg = err.message || '';
            if (msg.includes('has no query method') || msg.includes('is not exported') || msg.includes('Canister has no query')) {
                setBotkeysSupported(false);
            } else {
                setBotkeysSupported(true); // APIs exist but some other error occurred
                setPermissionError('Failed to load permissions: ' + (msg || 'Unknown error'));
            }
        } finally {
            setLoadingPermissions(false);
        }
    }, [canisterId, getAgent]);

    // Fetch permissions when switching to the permissions tab
    useEffect(() => {
        if (canisterActiveTab === 'permissions' && canisterSectionExpanded) {
            loadHotkeyPermissions();
        }
    }, [canisterActiveTab, canisterSectionExpanded, loadHotkeyPermissions]);

    // Fetch the current user's botkey permissions from the canister
    const fetchUserPermissions = useCallback(async () => {
        if (!canisterId || !identity) return;
        // Controllers already have full access, but we still fetch so botkey users get their permissions
        setUserPermissionsLoading(true);
        try {
            const agent = getAgent();
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
            }
            const manager = createManagerActor(canisterId, { agent });
            const perms = await manager.callerPermissions();
            const permSet = new Set(perms.map(p => Object.keys(p)[0]));
            setUserPermissions(permSet);
        } catch (err) {
            console.warn('callerPermissions not available (older bot?):', err.message);
            // Older bots don't have this method — botkey users get no permissions
            setUserPermissions(new Set());
        } finally {
            setUserPermissionsLoading(false);
        }
    }, [canisterId, identity, getAgent]);

    // Fetch user permissions on load (alongside other data)
    useEffect(() => {
        if (isAuthenticated && identity && canisterId) {
            fetchUserPermissions();
        }
    }, [isAuthenticated, identity, canisterId, fetchUserPermissions]);

    // Get permission variant key (e.g. { Vote: null } -> "Vote")
    const getPermissionKey = (perm) => {
        return Object.keys(perm)[0];
    };

    // Known display labels for permission keys (falls back to readable version of enum key for unknown permissions)
    const KNOWN_PERMISSION_LABELS = {
        'FullPermissions': 'Full Permissions',
        'ManagePermissions': 'Manage Permissions',
        'ConfigureDissolveState': 'Configure Dissolve State',
        'Vote': 'Vote',
        'Disburse': 'Disburse',
        'Split': 'Split',
        'MergeMaturity': 'Merge Maturity',
        'DisburseMaturity': 'Disburse Maturity',
        'StakeMaturity': 'Stake Maturity',
        'ManageFollowees': 'Manage Followees',
        'Spawn': 'Spawn',
        'ManageNeuronHotkeys': 'Manage NNS Hotkeys',
        'StakeNeuron': 'Stake Neuron',
        'MergeNeurons': 'Merge Neurons',
        'AutoStakeMaturity': 'Auto-Stake Maturity',
        'ManageVisibility': 'Manage Visibility',
        'WithdrawFunds': 'Withdraw Funds',
        'ViewNeuron': 'View Neuron',
        'MakeProposal': 'Make Proposal',
        'ManageConfirmFollowing': 'Manage Confirm Following',
        'ManageRefreshStake': 'Manage Refresh Stake',
        'ManageCollectMaturity': 'Manage Collect Maturity',
        'ManageDistributeFunds': 'Manage Distribute Funds',
        'ConfigureCollectMaturity': 'Configure Collect Maturity',
        'ConfigureDistribution': 'Configure Distribution',
        'ViewChores': 'View Chores',
    };

    // Known descriptions for permission keys (empty string for unknown permissions)
    const KNOWN_PERMISSION_DESCRIPTIONS = {
        'FullPermissions': 'Grants all permissions, including any future permissions added in later versions',
        'ManagePermissions': 'Add/remove botkey principals and manage their permissions',
        'ConfigureDissolveState': 'Start/stop dissolving, set dissolve delay',
        'Vote': 'Vote on proposals, refresh voting power',
        'MakeProposal': 'Submit NNS proposals using a neuron',
        'Disburse': 'Disburse neuron stake',
        'Split': 'Split neuron into multiple neurons',
        'MergeMaturity': 'Merge maturity into stake',
        'DisburseMaturity': 'Disburse maturity rewards',
        'StakeMaturity': 'Stake maturity rewards',
        'ManageFollowees': 'Set followees and confirm following',
        'Spawn': 'Spawn maturity to create new neuron',
        'ManageNeuronHotkeys': 'Add/remove NNS hotkeys on the neuron',
        'StakeNeuron': 'Create neurons, increase/refresh stake',
        'MergeNeurons': 'Merge neurons together',
        'AutoStakeMaturity': 'Set auto-stake maturity setting',
        'ManageVisibility': 'Set neuron visibility',
        'WithdrawFunds': 'Withdraw ICP or tokens from the canister',
        'ViewNeuron': 'View neuron info, list neurons, and check balances',
        'ManageConfirmFollowing': 'Start, stop, pause, resume, and configure the Confirm Following chore',
        'ManageRefreshStake': 'Start, stop, pause, resume, and configure the Refresh Stake chore',
        'ManageCollectMaturity': 'Start, stop, pause, resume, and configure the Collect Maturity chore',
        'ManageDistributeFunds': 'Start, stop, pause, resume, and configure the Distribute Funds chore',
        'ConfigureCollectMaturity': 'Set the maturity collection threshold and destination account',
        'ConfigureDistribution': 'Add, edit, and remove distribution lists (controls where funds are sent)',
        'ViewChores': 'View bot chore statuses, configurations, and settings',
    };

    // Get human-readable label for a permission key (dynamic: falls back to splitting CamelCase)
    const getPermissionLabel = (key) => {
        if (KNOWN_PERMISSION_LABELS[key]) return KNOWN_PERMISSION_LABELS[key];
        // Fall back: split CamelCase into spaced words (e.g. "SomeNewPerm" -> "Some New Perm")
        return key.replace(/([a-z])([A-Z])/g, '$1 $2');
    };

    // Get description for a permission key (dynamic: empty for unknown permissions)
    const getPermissionDescription = (key) => {
        return KNOWN_PERMISSION_DESCRIPTIONS[key] || '';
    };

    const handleAddHotkeyPrincipal = async () => {
        if (!newHotkeyPrincipal.trim()) return;
        
        const selectedPerms = Object.entries(newHotkeyPermissions)
            .filter(([_, checked]) => checked)
            .map(([key, _]) => ({ [key]: null }));
        
        if (selectedPerms.length === 0) {
            setPermissionError('Please select at least one permission');
            return;
        }
        
        setSavingPermissions(true);
        setPermissionError('');
        setPermissionSuccess('');
        try {
            const agent = getAgent();
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
            }
            const manager = createManagerActor(canisterId, { agent });
            const principal = Principal.fromText(newHotkeyPrincipal.trim());
            const result = await manager.addHotkeyPermissions(principal, selectedPerms);
            if ('Ok' in result) {
                setPermissionSuccess('Botkey principal added successfully');
                setNewHotkeyPrincipal('');
                setNewHotkeyPermissions({});
                await loadHotkeyPermissions();
            } else {
                const err = result.Err;
                setPermissionError('Failed: ' + (err.InvalidOperation || err.GovernanceError?.error_message || 'Unknown error'));
            }
        } catch (err) {
            setPermissionError('Error: ' + (err.message || 'Unknown error'));
        } finally {
            setSavingPermissions(false);
        }
    };

    const handleUpdateHotkeyPermissions = async (principalText) => {
        const currentPerms = hotkeyPrincipals.find(h => h.principal.toString() === principalText);
        if (!currentPerms) return;
        
        const currentKeys = new Set(currentPerms.permissions.map(p => getPermissionKey(p)));
        const editKeys = new Set(Object.entries(editPermissions).filter(([_, v]) => v).map(([k, _]) => k));
        
        // Permissions to add (in edit but not in current)
        const toAdd = [...editKeys].filter(k => !currentKeys.has(k)).map(k => ({ [k]: null }));
        // Permissions to remove (in current but not in edit)
        const toRemove = [...currentKeys].filter(k => !editKeys.has(k)).map(k => ({ [k]: null }));
        
        if (toAdd.length === 0 && toRemove.length === 0) {
            setEditingPrincipal(null);
            return;
        }
        
        setSavingPermissions(true);
        setPermissionError('');
        setPermissionSuccess('');
        try {
            const agent = getAgent();
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
            }
            const manager = createManagerActor(canisterId, { agent });
            const principal = Principal.fromText(principalText);
            
            if (toAdd.length > 0) {
                const addResult = await manager.addHotkeyPermissions(principal, toAdd);
                if ('Err' in addResult) {
                    const err = addResult.Err;
                    setPermissionError('Failed to add permissions: ' + (err.InvalidOperation || err.GovernanceError?.error_message || 'Unknown error'));
                    setSavingPermissions(false);
                    return;
                }
            }
            if (toRemove.length > 0) {
                const removeResult = await manager.removeHotkeyPermissions(principal, toRemove);
                if ('Err' in removeResult) {
                    const err = removeResult.Err;
                    setPermissionError('Failed to remove permissions: ' + (err.InvalidOperation || err.GovernanceError?.error_message || 'Unknown error'));
                    setSavingPermissions(false);
                    return;
                }
            }
            
            setPermissionSuccess('Permissions updated successfully');
            setEditingPrincipal(null);
            await loadHotkeyPermissions();
        } catch (err) {
            setPermissionError('Error: ' + (err.message || 'Unknown error'));
        } finally {
            setSavingPermissions(false);
        }
    };

    const handleRemoveHotkeyPrincipal = async (principalText) => {
        setSavingPermissions(true);
        setPermissionError('');
        setPermissionSuccess('');
        try {
            const agent = getAgent();
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
            }
            const manager = createManagerActor(canisterId, { agent });
            const principal = Principal.fromText(principalText);
            const result = await manager.removeHotkeyPrincipal(principal);
            if ('Ok' in result) {
                setPermissionSuccess('Botkey principal removed');
                setConfirmRemoveHotkey(null);
                await loadHotkeyPermissions();
            } else {
                const err = result.Err;
                setPermissionError('Failed: ' + (err.InvalidOperation || err.GovernanceError?.error_message || 'Unknown error'));
            }
        } catch (err) {
            setPermissionError('Error: ' + (err.message || 'Unknown error'));
        } finally {
            setSavingPermissions(false);
        }
    };

    // Action handlers
    const handleStakeNeuron = async () => {
        if (!stakeAmount || parseFloat(stakeAmount) < 1) {
            setError('Minimum stake is 1 ICP');
            return;
        }
        
        const delayDays = parseInt(stakeDissolveDelay);
        //if (!delayDays || delayDays < 183) {
        //    setError('Minimum dissolve delay is 183 days (~6 months) to vote');
        //    return;
        //}
        //if (delayDays > 2922) {
        //    setError('Maximum dissolve delay is 2922 days (8 years)');
        //    return;
        //}
        
        setActionLoading('stake');
        setError('');
        setSuccess('');
        
        const amountE8s = BigInt(Math.floor(parseFloat(stakeAmount) * E8S));
        const fee = BigInt(10000); // 0.0001 ICP fee
        
        // Check user has enough balance
        if (userIcpBalance === null || BigInt(userIcpBalance) < amountE8s + fee) {
            setError(`Insufficient balance. You have ${formatIcp(userIcpBalance)} ICP, need ${parseFloat(stakeAmount) + 0.0001} ICP (including fee)`);
            setActionLoading('');
            return;
        }
        
        try {
            const agent = getAgent();
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
            }
            const manager = createManagerActor(canisterId, { agent });
            const ledger = createLedgerActor(ICP_LEDGER_CANISTER_ID, { agent });
            
            // Step 1: Generate memo and get stake account
            const memo = await manager.generateMemo();
            const stakeInfo = await manager.getStakeAccount(memo);
            
            // Step 2: Transfer ICP directly to governance canister's neuron subaccount
            setSuccess('📤 Sending ICP to NNS Governance...');
            const transferResult = await ledger.icrc1_transfer({
                to: {
                    owner: stakeInfo.account.owner,
                    subaccount: stakeInfo.account.subaccount,
                },
                amount: amountE8s,
                fee: [fee],
                memo: [],
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
            
            // Step 3: Claim the neuron from the deposit
            setSuccess('🧠 Claiming neuron from deposit...');
            const dissolveDelaySeconds = BigInt(delayDays * 24 * 60 * 60);
            const result = await manager.claimNeuronFromDeposit(memo, dissolveDelaySeconds);
            
            if ('Ok' in result) {
                setSuccess(`🎉 Neuron created! ID: ${result.Ok.id.toString()}`);
                setSelectedNeuronId(result.Ok);
                fetchManagerData();
                fetchUserBalance(agent); // Refresh user balance
            } else {
                const err = result.Err;
                if ('GovernanceError' in err) {
                    setError(`Governance error: ${err.GovernanceError.error_message}`);
                } else if ('InvalidDissolveDelay' in err) {
                    const d = err.InvalidDissolveDelay;
                    setError(`Invalid dissolve delay: min ${Math.floor(Number(d.min) / 86400)} days, max ${Math.floor(Number(d.max) / 86400)} days`);
                } else {
                    setError('Failed to claim neuron');
                }
            }
        } catch (err) {
            console.error('Error staking neuron:', err);
            setError(`Error: ${err.message || 'Failed to stake neuron'}`);
        } finally {
            setActionLoading('');
        }
    };

    const handleSetDissolveDelay = async () => {
        if (!selectedNeuronId) {
            setError('No neuron selected');
            return;
        }
        if (!dissolveDelay || parseInt(dissolveDelay) < 1) {
            setError('Please enter a valid dissolve delay in days');
            return;
        }
        
        setActionLoading('dissolve');
        setError('');
        setSuccess('');
        
        try {
            const agent = getAgent();
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
            }
            const manager = createManagerActor(canisterId, { agent });
            
            // setDissolveDelay takes Nat32 (additional seconds to add)
            const delaySeconds = parseInt(dissolveDelay) * 24 * 60 * 60;
            const result = await manager.setDissolveDelay(selectedNeuronId, delaySeconds);
            
            if ('Ok' in result) {
                setSuccess(`✅ Added ${dissolveDelay} days to dissolve delay`);
                setDissolveDelay('');
                fetchManagerData();
            } else {
                handleOperationError(result.Err);
            }
        } catch (err) {
            console.error('Error setting dissolve delay:', err);
            setError(`Error: ${err.message}`);
        } finally {
            setActionLoading('');
        }
    };

    const handleStartDissolving = async () => {
        if (!selectedNeuronId) {
            setError('No neuron selected');
            return;
        }
        
        setActionLoading('startDissolve');
        setError('');
        setSuccess('');
        
        try {
            const agent = getAgent();
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
            }
            const manager = createManagerActor(canisterId, { agent });
            const result = await manager.startDissolving(selectedNeuronId);
            
            if ('Ok' in result) {
                setSuccess('✅ Neuron is now dissolving');
                fetchManagerData();
            } else {
                handleOperationError(result.Err);
            }
        } catch (err) {
            console.error('Error starting dissolve:', err);
            setError(`Error: ${err.message}`);
        } finally {
            setActionLoading('');
        }
    };

    const handleStopDissolving = async () => {
        if (!selectedNeuronId) {
            setError('No neuron selected');
            return;
        }
        
        setActionLoading('stopDissolve');
        setError('');
        setSuccess('');
        
        try {
            const agent = getAgent();
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
            }
            const manager = createManagerActor(canisterId, { agent });
            const result = await manager.stopDissolving(selectedNeuronId);
            
            if ('Ok' in result) {
                setSuccess('✅ Neuron stopped dissolving');
                fetchManagerData();
            } else {
                handleOperationError(result.Err);
            }
        } catch (err) {
            console.error('Error stopping dissolve:', err);
            setError(`Error: ${err.message}`);
        } finally {
            setActionLoading('');
        }
    };

    const handleAddHotKey = async () => {
        if (!selectedNeuronId) {
            setError('No neuron selected');
            return;
        }
        if (!hotKeyPrincipal) {
            setError('Please enter a principal ID');
            return;
        }
        
        setActionLoading('addHotKey');
        setError('');
        setSuccess('');
        
        try {
            const principal = Principal.fromText(hotKeyPrincipal);
            const agent = getAgent();
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
            }
            const manager = createManagerActor(canisterId, { agent });
            const result = await manager.addHotKey(selectedNeuronId, principal);
            
            if ('Ok' in result) {
                setSuccess(`✅ Hot key added: ${hotKeyPrincipal}`);
                setHotKeyPrincipal('');
                fetchManagerData();
            } else {
                handleOperationError(result.Err);
            }
        } catch (err) {
            console.error('Error adding hot key:', err);
            setError(`Error: ${err.message}`);
        } finally {
            setActionLoading('');
        }
    };

    const handleRemoveHotKey = async (principal) => {
        if (!selectedNeuronId) {
            setError('No neuron selected');
            return;
        }
        
        setActionLoading('removeHotKey');
        setError('');
        setSuccess('');
        
        try {
            const agent = getAgent();
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
            }
            const manager = createManagerActor(canisterId, { agent });
            const result = await manager.removeHotKey(selectedNeuronId, principal);
            
            if ('Ok' in result) {
                setSuccess(`✅ Hot key removed`);
                fetchManagerData();
            } else {
                handleOperationError(result.Err);
            }
        } catch (err) {
            console.error('Error removing hot key:', err);
            setError(`Error: ${err.message}`);
        } finally {
            setActionLoading('');
        }
    };

    const handleDisburse = async () => {
        if (!selectedNeuronId) {
            setError('No neuron selected');
            return;
        }
        
        setActionLoading('disburse');
        setError('');
        setSuccess('');
        
        try {
            const agent = getAgent();
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
            }
            const manager = createManagerActor(canisterId, { agent });
            
            // Amount: null means disburse all
            const amountOpt = disburseAmount ? [BigInt(Math.floor(parseFloat(disburseAmount) * E8S))] : [];
            
            // Destination: null means send to controller (this canister)
            // If provided, convert hex string to Uint8Array
            let toAccountOpt = [];
            if (disburseToAccount && disburseToAccount.length === 64) {
                const bytes = [];
                for (let i = 0; i < 64; i += 2) {
                    bytes.push(parseInt(disburseToAccount.substr(i, 2), 16));
                }
                toAccountOpt = [bytes];
            }
            
            const result = await manager.disburse(selectedNeuronId, amountOpt, toAccountOpt);
            
            if ('Ok' in result) {
                setSuccess(`✅ Disbursed! Block height: ${result.Ok.transfer_block_height.toString()}`);
                setDisburseAmount('');
                setDisburseToAccount('');
                fetchManagerData();
            } else {
                handleOperationError(result.Err);
            }
        } catch (err) {
            console.error('Error disbursing:', err);
            setError(`Error: ${err.message}`);
        } finally {
            setActionLoading('');
        }
    };

    const handleSetFollowing = async () => {
        if (!selectedNeuronId) {
            setError('No neuron selected');
            return;
        }
        
        if (selectedTopics.length === 0) {
            setError('No topics selected');
            return;
        }
        
        setActionLoading('following');
        setError('');
        setSuccess('');
        
        try {
            const agent = getAgent();
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
            }
            const manager = createManagerActor(canisterId, { agent });
            
            // Parse followee IDs (comma-separated)
            const followees = followeeIds
                .split(',')
                .map(s => s.trim())
                .filter(s => s.length > 0)
                .map(id => ({ id: BigInt(id) }));
            
            // Set following for all selected topics
            const results = [];
            const errors = [];
            
            for (const topic of selectedTopics) {
                try {
                    const result = await manager.setFollowing(selectedNeuronId, topic, followees);
                    if ('Ok' in result) {
                        results.push(topic);
                    } else {
                        const topicName = NNS_TOPICS.find(t => t.id === topic)?.name || `Topic ${topic}`;
                        errors.push(`${topicName}: ${result.Err?.GovernanceError?.error_message || 'Unknown error'}`);
                    }
                } catch (err) {
                    const topicName = NNS_TOPICS.find(t => t.id === topic)?.name || `Topic ${topic}`;
                    errors.push(`${topicName}: ${err.message}`);
                }
            }
            
            if (results.length > 0) {
                const topicNames = results.map(id => NNS_TOPICS.find(t => t.id === id)?.name || `Topic ${id}`);
                if (followees.length === 0) {
                    setSuccess(`✅ Cleared following for ${results.length} topic(s): ${topicNames.join(', ')}`);
                } else {
                    setSuccess(`✅ Now following ${followees.length} neuron(s) for ${results.length} topic(s): ${topicNames.join(', ')}`);
                }
                setFolloweeIds('');
                setSelectedTopics([0]); // Reset to default
                fetchManagerData();
            }
            
            if (errors.length > 0) {
                setError(`Errors: ${errors.join('; ')}`);
            }
        } catch (err) {
            console.error('Error setting following:', err);
            setError(`Error: ${err.message}`);
        } finally {
            setActionLoading('');
        }
    };

    const handleConfirmFollowing = async () => {
        if (!selectedNeuronId) {
            setError('No neuron selected');
            return;
        }
        
        setActionLoading('confirmFollowing');
        setError('');
        setSuccess('');
        
        try {
            const agent = getAgent();
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
            }
            const manager = createManagerActor(canisterId, { agent });
            
            const result = await manager.confirmFollowing(selectedNeuronId);
            
            if ('Ok' in result) {
                setSuccess('✅ Following confirmed! Your neuron is now active for automatic voting.');
                fetchManagerData();
            } else {
                handleOperationError(result.Err);
            }
        } catch (err) {
            console.error('Error confirming following:', err);
            setError(`Error: ${err.message}`);
        } finally {
            setActionLoading('');
        }
    };

    const handleIncreaseStake = async () => {
        if (!selectedNeuronId) {
            setError('No neuron selected');
            return;
        }
        if (!increaseStakeAmount || parseFloat(increaseStakeAmount) <= 0) {
            setError('Please enter a valid amount');
            return;
        }
        
        const amountE8s = BigInt(Math.floor(parseFloat(increaseStakeAmount) * E8S));
        const fee = BigInt(10000); // 0.0001 ICP fee
        
        // Check user has enough balance
        if (userIcpBalance === null || BigInt(userIcpBalance) < amountE8s + fee) {
            setError(`Insufficient balance. You have ${formatIcp(userIcpBalance)} ICP, need ${parseFloat(increaseStakeAmount) + 0.0001} ICP (including fee)`);
            return;
        }
        
        setActionLoading('increaseStake');
        setError('');
        setSuccess('');
        
        try {
            const agent = getAgent();
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
            }
            const manager = createManagerActor(canisterId, { agent });
            const ledger = createLedgerActor(ICP_LEDGER_CANISTER_ID, { agent });
            
            // Step 1: Get the neuron's account
            const neuronAccount = await manager.getNeuronAccount(selectedNeuronId);
            if (!neuronAccount || neuronAccount.length === 0) {
                throw new Error('Could not get neuron account');
            }
            const account = neuronAccount[0];
            
            // Step 2: Transfer ICP directly to the neuron's account
            setSuccess('📤 Sending ICP to neuron...');
            const transferResult = await ledger.icrc1_transfer({
                to: {
                    owner: account.owner,
                    subaccount: account.subaccount,
                },
                amount: amountE8s,
                fee: [fee],
                memo: [],
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
            
            // Step 3: Refresh the neuron stake
            setSuccess('🔄 Refreshing neuron stake... (this may take a moment)');
            console.log('Calling refreshStakeFromDeposit for neuron:', selectedNeuronId);
            const result = await manager.refreshStakeFromDeposit(selectedNeuronId);
            console.log('refreshStakeFromDeposit result:', result);
            
            if ('Ok' in result) {
                setSuccess(`✅ Added ${increaseStakeAmount} ICP to neuron stake! Refreshing data...`);
                setIncreaseStakeAmount('');
                // Give NNS a moment to update, then refresh
                await new Promise(resolve => setTimeout(resolve, 2000));
                await fetchManagerData();
                fetchUserBalance(agent); // Refresh user balance
                setSuccess(`✅ Successfully added ${increaseStakeAmount} ICP to neuron stake`);
            } else {
                console.error('refreshStakeFromDeposit error:', result.Err);
                handleOperationError(result.Err);
            }
        } catch (err) {
            console.error('Error increasing stake:', err);
            setError(`Error: ${err.message}`);
        } finally {
            setActionLoading('');
        }
    };

    // Manual refresh stake - useful if user sent ICP externally or automatic refresh didn't work
    const handleManualRefreshStake = async () => {
        if (!selectedNeuronId) {
            setError('No neuron selected');
            return;
        }
        
        setActionLoading('refreshStake');
        setError('');
        setSuccess('');
        
        try {
            const agent = getAgent();
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
            }
            const manager = createManagerActor(canisterId, { agent });
            
            setSuccess('🔄 Refreshing neuron stake from NNS...');
            console.log('Calling refreshStake for neuron:', selectedNeuronId);
            const result = await manager.refreshStake(selectedNeuronId);
            console.log('refreshStake result:', result);
            
            if ('Ok' in result) {
                setSuccess('✅ Neuron stake refreshed! Fetching updated data...');
                await new Promise(resolve => setTimeout(resolve, 2000));
                await fetchManagerData();
                setSuccess('✅ Neuron data refreshed successfully');
            } else {
                console.error('refreshStake error:', result.Err);
                handleOperationError(result.Err);
            }
        } catch (err) {
            console.error('Error refreshing stake:', err);
            setError(`Error: ${err.message}`);
        } finally {
            setActionLoading('');
        }
    };

    const handleToggleAutoStakeMaturity = async (newValue) => {
        if (!selectedNeuronId) {
            setError('No neuron selected');
            return;
        }
        
        setActionLoading('autoStake');
        setError('');
        setSuccess('');
        
        try {
            const agent = getAgent();
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
            }
            const manager = createManagerActor(canisterId, { agent });
            
            const result = await manager.setAutoStakeMaturity(selectedNeuronId, newValue);
            
            if ('Ok' in result) {
                setSuccess(`✅ Auto-stake maturity ${newValue ? 'enabled' : 'disabled'}`);
                fetchManagerData();
            } else {
                handleOperationError(result.Err);
            }
        } catch (err) {
            console.error('Error toggling auto-stake maturity:', err);
            setError(`Error: ${err.message}`);
        } finally {
            setActionLoading('');
        }
    };

    const handleSpawnMaturity = async () => {
        if (!selectedNeuronId) {
            setError('No neuron selected');
            return;
        }
        const percentage = parseInt(maturityPercentage);
        if (!percentage || percentage < 1 || percentage > 100) {
            setError('Percentage must be between 1 and 100');
            return;
        }
        
        setActionLoading('spawnMaturity');
        setError('');
        setSuccess('');
        
        try {
            const agent = getAgent();
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
            }
            const manager = createManagerActor(canisterId, { agent });
            
            // Optional controller for the spawned neuron
            const controllerOpt = spawnController ? [Principal.fromText(spawnController)] : [];
            
            const result = await manager.spawnMaturity(selectedNeuronId, percentage, controllerOpt);
            
            if ('Ok' in result) {
                setSuccess(`✅ Spawned new neuron! ID: ${result.Ok.id.toString()}`);
                setSpawnController('');
                fetchManagerData();
            } else {
                handleOperationError(result.Err);
            }
        } catch (err) {
            console.error('Error spawning maturity:', err);
            setError(`Error: ${err.message}`);
        } finally {
            setActionLoading('');
        }
    };

    const handleStakeMaturity = async () => {
        if (!selectedNeuronId) {
            setError('No neuron selected');
            return;
        }
        const percentage = parseInt(maturityPercentage);
        if (!percentage || percentage < 1 || percentage > 100) {
            setError('Percentage must be between 1 and 100');
            return;
        }
        
        setActionLoading('stakeMaturity');
        setError('');
        setSuccess('');
        
        try {
            const agent = getAgent();
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
            }
            const manager = createManagerActor(canisterId, { agent });
            
            const result = await manager.stakeMaturity(selectedNeuronId, percentage);
            
            if ('Ok' in result) {
                setSuccess(`✅ Staked ${percentage}% of maturity`);
                fetchManagerData();
            } else {
                handleOperationError(result.Err);
            }
        } catch (err) {
            console.error('Error staking maturity:', err);
            setError(`Error: ${err.message}`);
        } finally {
            setActionLoading('');
        }
    };

    const handleMergeMaturity = async () => {
        if (!selectedNeuronId) {
            setError('No neuron selected');
            return;
        }
        const percentage = parseInt(maturityPercentage);
        if (!percentage || percentage < 1 || percentage > 100) {
            setError('Percentage must be between 1 and 100');
            return;
        }
        
        setActionLoading('mergeMaturity');
        setError('');
        setSuccess('');
        
        try {
            const agent = getAgent();
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
            }
            const manager = createManagerActor(canisterId, { agent });
            
            const result = await manager.mergeMaturity(selectedNeuronId, percentage);
            
            if ('Ok' in result) {
                setSuccess(`✅ Merged ${percentage}% of maturity into stake`);
                fetchManagerData();
            } else {
                handleOperationError(result.Err);
            }
        } catch (err) {
            console.error('Error merging maturity:', err);
            setError(`Error: ${err.message}`);
        } finally {
            setActionLoading('');
        }
    };

    const handleDisburseMaturity = async () => {
        if (!selectedNeuronId) {
            setError('No neuron selected');
            return;
        }
        const percentage = parseInt(maturityPercentage);
        if (!percentage || percentage < 1 || percentage > 100) {
            setError('Percentage must be between 1 and 100');
            return;
        }
        
        setActionLoading('disburseMaturity');
        setError('');
        setSuccess('');
        
        try {
            const agent = getAgent();
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
            }
            const manager = createManagerActor(canisterId, { agent });
            
            // Optional destination account
            let destOpt = [];
            if (disburseMaturityDestination) {
                try {
                    destOpt = [{ 
                        owner: Principal.fromText(disburseMaturityDestination), 
                        subaccount: [] 
                    }];
                } catch {
                    setError('Invalid principal for destination');
                    setActionLoading('');
                    return;
                }
            }
            
            const result = await manager.disburseMaturity(selectedNeuronId, percentage, destOpt);
            
            if ('Ok' in result) {
                setSuccess(`✅ Disbursed ${percentage}% of maturity`);
                setDisburseMaturityDestination('');
                fetchManagerData();
            } else {
                handleOperationError(result.Err);
            }
        } catch (err) {
            console.error('Error disbursing maturity:', err);
            setError(`Error: ${err.message}`);
        } finally {
            setActionLoading('');
        }
    };

    const handleSplitNeuron = async () => {
        if (!selectedNeuronId) {
            setError('No neuron selected');
            return;
        }
        if (!splitAmount || parseFloat(splitAmount) < 1) {
            setError('Minimum split amount is 1 ICP');
            return;
        }
        
        setActionLoading('split');
        setError('');
        setSuccess('');
        
        try {
            const agent = getAgent();
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
            }
            const manager = createManagerActor(canisterId, { agent });
            
            const amountE8s = BigInt(Math.floor(parseFloat(splitAmount) * E8S));
            const result = await manager.splitNeuron(selectedNeuronId, amountE8s);
            
            if ('Ok' in result) {
                setSuccess(`✅ Neuron split! New neuron ID: ${result.Ok.id.toString()}`);
                setSplitAmount('');
                fetchManagerData();
            } else {
                handleOperationError(result.Err);
            }
        } catch (err) {
            console.error('Error splitting neuron:', err);
            setError(`Error: ${err.message}`);
        } finally {
            setActionLoading('');
        }
    };

    const handleMergeNeurons = async () => {
        if (!selectedNeuronId) {
            setError('No neuron selected');
            return;
        }
        if (!mergeSourceNeuronId) {
            setError('Please enter the source neuron ID');
            return;
        }
        
        setActionLoading('merge');
        setError('');
        setSuccess('');
        
        try {
            const agent = getAgent();
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
            }
            const manager = createManagerActor(canisterId, { agent });
            
            const sourceNeuronId = { id: BigInt(mergeSourceNeuronId) };
            const result = await manager.mergeNeurons(selectedNeuronId, sourceNeuronId);
            
            if ('Ok' in result) {
                setSuccess(`✅ Neurons merged! Source neuron ${mergeSourceNeuronId} merged into selected neuron.`);
                setMergeSourceNeuronId('');
                fetchManagerData();
            } else {
                handleOperationError(result.Err);
            }
        } catch (err) {
            console.error('Error merging neurons:', err);
            setError(`Error: ${err.message}`);
        } finally {
            setActionLoading('');
        }
    };

    const handleSetVisibility = async (makePublic) => {
        if (!selectedNeuronId) {
            setError('No neuron selected');
            return;
        }
        
        setActionLoading('visibility');
        setError('');
        setSuccess('');
        
        try {
            const agent = getAgent();
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
            }
            const manager = createManagerActor(canisterId, { agent });
            
            // NNS visibility values: 0 = unspecified, 1 = private, 2 = public
            const visibility = makePublic ? 2 : 1;
            const result = await manager.setVisibility(selectedNeuronId, visibility);
            
            if ('Ok' in result) {
                setSuccess(`✅ Neuron visibility set to ${makePublic ? 'public' : 'private'}.`);
                fetchManagerData();
            } else {
                handleOperationError(result.Err);
            }
        } catch (err) {
            console.error('Error setting visibility:', err);
            setError(`Error: ${err.message}`);
        } finally {
            setActionLoading('');
        }
    };

    // Fetch token balance directly from the ledger (balances are public)
    const fetchWithdrawTokenBalance = useCallback(async (ledgerId) => {
        if (!ledgerId || !canisterId) return;
        
        try {
            // Call the ledger directly - no need to go through the manager canister
            const ledgerActor = createLedgerActor(ledgerId, { agentOptions: { identity } });
            
            // Fetch balance and metadata in parallel
            const [balance, symbol, decimals, fee] = await Promise.all([
                ledgerActor.icrc1_balance_of({
                    owner: Principal.fromText(canisterId),
                    subaccount: [],
                }),
                ledgerActor.icrc1_symbol(),
                ledgerActor.icrc1_decimals(),
                ledgerActor.icrc1_fee(),
            ]);
            
            setWithdrawTokenBalance(balance);
            setWithdrawTokenSymbol(symbol);
            setWithdrawTokenDecimals(decimals);
            setWithdrawTokenFee(Number(fee));
        } catch (err) {
            console.error('Error fetching token balance:', err);
            setWithdrawTokenBalance(null);
            setWithdrawTokenSymbol('Unknown');
            setWithdrawTokenDecimals(8);
            setWithdrawTokenFee(0);
        }
    }, [canisterId, identity]);
    
    // Fetch token balance when selected token changes
    // Only fetch withdraw token balance when section is expanded
    useEffect(() => {
        if (!withdrawSectionExpanded) return;
        const ledgerId = useCustomLedger ? customLedgerInput : withdrawTokenLedger;
        if (ledgerId) {
            fetchWithdrawTokenBalance(ledgerId);
        }
    }, [withdrawTokenLedger, customLedgerInput, useCustomLedger, fetchWithdrawTokenBalance, withdrawSectionExpanded]);

    const handleWithdrawToken = async () => {
        if (!withdrawAmount || parseFloat(withdrawAmount) <= 0) {
            setError('Please enter a valid amount');
            return;
        }
        if (!withdrawDestination) {
            setError('Please enter a destination principal');
            return;
        }
        
        const ledgerId = useCustomLedger ? customLedgerInput : withdrawTokenLedger;
        if (!ledgerId) {
            setError('Please select a token or enter a ledger principal');
            return;
        }
        
        // Validate custom ledger principal if used
        if (useCustomLedger) {
            try {
                Principal.fromText(customLedgerInput);
            } catch {
                setError('Invalid ledger principal');
                return;
            }
        }
        
        setActionLoading('withdraw');
        setError('');
        setSuccess('');
        
        try {
            const agent = getAgent();
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
            }
            const manager = createManagerActor(canisterId, { agent });
            
            const amount = BigInt(Math.floor(parseFloat(withdrawAmount) * Math.pow(10, withdrawTokenDecimals)));
            const destination = {
                owner: Principal.fromText(withdrawDestination),
                subaccount: [],
            };
            
            let result;
            if (ledgerId === ICP_LEDGER_CANISTER_ID) {
                // Use withdrawIcp for ICP
                result = await manager.withdrawIcp(amount, destination);
            } else {
                // Use withdrawToken for other tokens
                result = await manager.withdrawToken(Principal.fromText(ledgerId), amount, destination);
            }
            
            if ('Ok' in result) {
                setSuccess(`✅ Withdrew ${withdrawAmount} ${withdrawTokenSymbol}! Block height: ${result.Ok.transfer_block_height.toString()}`);
                setWithdrawAmount('');
                fetchManagerData();
                fetchWithdrawTokenBalance(ledgerId);
            } else {
                handleOperationError(result.Err);
            }
        } catch (err) {
            console.error('Error withdrawing token:', err);
            setError(`Error: ${err.message}`);
        } finally {
            setActionLoading('');
        }
    };

    const handleOperationError = (err) => {
        if ('GovernanceError' in err) {
            setError(`Governance error: ${err.GovernanceError.error_message}`);
        } else if ('InvalidOperation' in err) {
            setError(`Invalid operation: ${err.InvalidOperation}`);
        } else if ('NotAuthorized' in err) {
            setError('Not authorized to perform this operation');
        } else if ('NeuronNotFound' in err) {
            setError('Neuron not found');
        } else {
            setError('Operation failed');
        }
    };

    const copyToClipboard = (text) => {
        navigator.clipboard.writeText(text);
    };

    const formatIcp = (e8s) => {
        if (e8s === null || e8s === undefined) return '...';
        const icp = e8s / E8S;
        return icp.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 8 });
    };

    const formatDuration = (seconds) => {
        const days = Math.floor(seconds / 86400);
        const years = Math.floor(days / 365);
        const remainingDays = days % 365;
        
        if (years > 0) {
            return `${years}y ${remainingDays}d`;
        }
        return `${days} days`;
    };

    const getNeuronState = (state) => {
        const states = {
            1: { label: 'Locked', color: theme.colors.success || '#22c55e' },
            2: { label: 'Dissolving', color: theme.colors.warning || '#f59e0b' },
            3: { label: 'Dissolved', color: theme.colors.error || '#ef4444' },
            4: { label: 'Spawning', color: theme.colors.accent },
        };
        return states[state] || { label: 'Unknown', color: theme.colors.mutedText };
    };

    // Calculate time remaining to confirm following (6 months from last refresh)
    const FOLLOWING_CONFIRMATION_PERIOD_SECONDS = 15_778_800; // ~6 months
    const getFollowingConfirmationStatus = (neuron) => {
        if (!neuron?.voting_power_refreshed_timestamp_seconds?.[0]) {
            return { text: 'Unknown', isUrgent: false, secondsRemaining: null };
        }
        
        const lastRefreshSeconds = Number(neuron.voting_power_refreshed_timestamp_seconds[0]);
        const nowSeconds = Math.floor(Date.now() / 1000);
        const deadlineSeconds = lastRefreshSeconds + FOLLOWING_CONFIRMATION_PERIOD_SECONDS;
        const secondsRemaining = deadlineSeconds - nowSeconds;
        
        if (secondsRemaining <= 0) {
            return { text: 'Inactive - confirmation needed!', isUrgent: true, secondsRemaining: 0 };
        }
        
        const days = Math.floor(secondsRemaining / 86400);
        const hours = Math.floor((secondsRemaining % 86400) / 3600);
        
        const isUrgent = days < 30; // Less than 30 days is urgent
        const text = days > 0 ? `${days} days, ${hours} hours to confirm` : `${hours} hours to confirm`;
        
        return { text, isUrgent, secondsRemaining };
    };

    // Styles
    const cardStyle = {
        background: theme.colors.cardGradient || theme.colors.cardBackground,
        borderRadius: '14px',
        padding: '1.25rem',
        marginBottom: '1rem',
        border: `1px solid ${theme.colors.border}`,
        boxShadow: theme.colors.cardShadow || 'none',
    };

    const buttonStyle = {
        background: `linear-gradient(135deg, ${neuronPrimary}, ${neuronSecondary})`,
        color: '#fff',
        border: 'none',
        borderRadius: '10px',
        padding: '0.65rem 1.25rem',
        fontSize: '0.9rem',
        fontWeight: '600',
        cursor: 'pointer',
        transition: 'all 0.2s',
        boxShadow: `0 4px 12px ${neuronPrimary}30`,
    };

    const secondaryButtonStyle = {
        ...buttonStyle,
        background: 'transparent',
        color: neuronPrimary,
        border: `1px solid ${neuronPrimary}50`,
        boxShadow: 'none',
    };

    const inputStyle = {
        background: theme.colors.inputBackground || theme.colors.primaryBg,
        color: theme.colors.primaryText,
        border: `1px solid ${theme.colors.border}`,
        borderRadius: '10px',
        padding: '0.65rem 0.9rem',
        fontSize: '0.9rem',
        width: '100%',
        boxSizing: 'border-box',
        outline: 'none',
    };

    const tabStyle = (isActive) => ({
        padding: '0.6rem 1rem',
        cursor: 'pointer',
        borderBottom: 'none',
        borderRadius: isActive ? '8px' : '8px',
        color: isActive ? '#fff' : theme.colors.secondaryText,
        fontWeight: isActive ? '600' : '500',
        background: isActive ? `linear-gradient(135deg, ${neuronPrimary}, ${neuronSecondary})` : 'transparent',
        border: isActive ? 'none' : `1px solid ${theme.colors.border}`,
        fontSize: '0.85rem',
        transition: 'all 0.2s',
        marginRight: '0.5rem',
        marginBottom: '0.5rem',
    });

    const statBoxStyle = {
        textAlign: 'center',
        padding: '1rem',
        background: `linear-gradient(135deg, ${neuronPrimary}15, ${neuronPrimary}05)`,
        borderRadius: '12px',
        flex: 1,
        minWidth: '100px',
        border: `1px solid ${neuronPrimary}20`,
    };

    if (!isAuthenticated) {
        return (
            <div className='page-container' style={{ background: theme.colors.primaryGradient, minHeight: '100vh' }}>
                <style>{customStyles}</style>
                <Header />
                <main style={{ maxWidth: '900px', margin: '0 auto', padding: '2rem 1rem' }}>
                    <div className="neuron-mgr-fade-in" style={{ 
                        ...cardStyle, 
                        textAlign: 'center',
                        padding: '2.5rem 1.5rem'
                    }}>
                        <div className="neuron-mgr-float" style={{
                            width: '64px',
                            height: '64px',
                            borderRadius: '16px',
                            background: `linear-gradient(135deg, ${neuronPrimary}, ${neuronSecondary})`,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            margin: '0 auto 1.5rem',
                            boxShadow: `0 8px 32px ${neuronPrimary}40`,
                            position: 'relative',
                        }}>
                            <FaRobot style={{ color: '#fff', fontSize: '1.6rem' }} />
                            <FaBrain style={{ 
                                color: '#fff', 
                                fontSize: '0.8rem', 
                                position: 'absolute', 
                                top: '10px', 
                                right: '10px',
                                opacity: 0.85,
                            }} />
                        </div>
                        <h2 style={{ color: theme.colors.primaryText, marginBottom: '0.75rem', fontSize: '1.5rem' }}>
                            ICP Staking Bot
                        </h2>
                        <p style={{ color: theme.colors.secondaryText, marginBottom: '1.5rem', fontSize: '1rem' }}>
                            Please log in to manage your neuron.
                        </p>
                        <button style={buttonStyle} onClick={login}>
                            Login with Internet Identity
                        </button>
                    </div>
                </main>
            </div>
        );
    }

    return (
        <div className='page-container' style={{ background: theme.colors.primaryGradient, minHeight: '100vh' }}>
            <style>{customStyles}</style>
            
            {/* Top-Up Success Dialog */}
            {topUpSuccessDialog && (
                <div style={{
                    position: 'fixed',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: '100%',
                    background: 'rgba(0, 0, 0, 0.6)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    zIndex: 10002,
                    backdropFilter: 'blur(4px)',
                }}>
                    <div className="neuron-mgr-fade-in" style={{
                        background: theme.colors.cardGradient || theme.colors.cardBackground,
                        border: `1px solid ${theme.colors.border}`,
                        borderRadius: '20px',
                        padding: '2rem',
                        textAlign: 'center',
                        boxShadow: '0 12px 48px rgba(0, 0, 0, 0.4)',
                        maxWidth: '380px',
                        width: '90%',
                    }}>
                        {/* Success Icon */}
                        <div style={{
                            width: '72px',
                            height: '72px',
                            borderRadius: '50%',
                            background: `linear-gradient(135deg, ${theme.colors.success}30, ${theme.colors.success}10)`,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            margin: '0 auto 1.25rem',
                            border: `2px solid ${theme.colors.success}40`,
                            fontSize: '2rem'
                        }}>
                            ⛽
                        </div>
                        
                        <h3 style={{
                            color: theme.colors.primaryText,
                            fontSize: '1.25rem',
                            fontWeight: '700',
                            marginBottom: '0.5rem'
                        }}>
                            Top-Up Successful!
                        </h3>
                        
                        <p style={{
                            color: theme.colors.secondaryText,
                            fontSize: '0.9rem',
                            marginBottom: '1.25rem'
                        }}>
                            Your canister has been topped up with cycles
                        </p>
                        
                        {/* Stats */}
                        <div style={{
                            background: `linear-gradient(135deg, ${theme.colors.success}15, ${theme.colors.success}05)`,
                            borderRadius: '12px',
                            padding: '1rem',
                            marginBottom: '1.5rem',
                            border: `1px solid ${theme.colors.success}25`
                        }}>
                            <div style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                marginBottom: '0.75rem',
                                paddingBottom: '0.75rem',
                                borderBottom: `1px solid ${theme.colors.border}`
                            }}>
                                <span style={{ color: theme.colors.secondaryText, fontSize: '0.85rem' }}>
                                    Cycles Added
                                </span>
                                <span style={{ 
                                    color: theme.colors.success, 
                                    fontWeight: '700',
                                    fontSize: '0.95rem'
                                }}>
                                    +{formatCycles(topUpSuccessDialog.cyclesAdded)}
                                </span>
                            </div>
                            <div style={{
                                display: 'flex',
                                justifyContent: 'space-between'
                            }}>
                                <span style={{ color: theme.colors.secondaryText, fontSize: '0.85rem' }}>
                                    ICP Spent
                                </span>
                                <span style={{ 
                                    color: theme.colors.primaryText, 
                                    fontWeight: '600',
                                    fontSize: '0.95rem'
                                }}>
                                    {topUpSuccessDialog.icpSpent.toFixed(4)} ICP
                                </span>
                            </div>
                        </div>
                        
                        <button
                            onClick={() => setTopUpSuccessDialog(null)}
                            style={{
                                ...buttonStyle,
                                width: '100%',
                                background: `linear-gradient(135deg, ${theme.colors.success}, ${theme.colors.success}dd)`,
                                boxShadow: `0 4px 16px ${theme.colors.success}40`
                            }}
                        >
                            Done
                        </button>
                    </div>
                </div>
            )}
            
            <Header />
            
            {/* Hero Section */}
            <div style={{
                background: `linear-gradient(135deg, ${theme.colors.primaryBg} 0%, ${neuronPrimary}15 50%, ${neuronSecondary}10 100%)`,
                borderBottom: `1px solid ${theme.colors.border}`,
                padding: '2rem 1.5rem',
                position: 'relative',
                overflow: 'hidden'
            }}>
                {/* Background decorations */}
                <div style={{
                    position: 'absolute',
                    top: '-50%',
                    right: '-10%',
                    width: '400px',
                    height: '400px',
                    background: `radial-gradient(circle, ${neuronPrimary}20 0%, transparent 70%)`,
                    pointerEvents: 'none'
                }} />
                <div style={{
                    position: 'absolute',
                    bottom: '-30%',
                    left: '5%',
                    width: '300px',
                    height: '300px',
                    background: `radial-gradient(circle, ${neuronSecondary}15 0%, transparent 70%)`,
                    pointerEvents: 'none'
                }} />
                
                <div style={{ maxWidth: '900px', margin: '0 auto', position: 'relative', zIndex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
                        <div className="neuron-mgr-float" style={{
                            width: '56px',
                            height: '56px',
                            borderRadius: '16px',
                            background: `linear-gradient(135deg, ${neuronPrimary}, ${neuronSecondary})`,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            boxShadow: `0 8px 32px ${neuronPrimary}50`,
                            flexShrink: 0,
                            position: 'relative',
                        }}>
                            <FaRobot style={{ color: '#fff', fontSize: '1.6rem' }} />
                            <FaBrain style={{ 
                                color: '#fff', 
                                fontSize: '0.8rem', 
                                position: 'absolute', 
                                top: '8px', 
                                right: '8px',
                                opacity: 0.85,
                            }} />
                        </div>
                        <div style={{ minWidth: 0, flex: 1 }}>
                            <div style={{ 
                                display: 'flex', 
                                alignItems: 'center', 
                                gap: '8px',
                                marginBottom: '4px'
                            }}>
                                <h1 style={{
                                    fontSize: '1.5rem',
                                    fontWeight: '700',
                                    color: theme.colors.primaryText,
                                    margin: 0,
                                    letterSpacing: '-0.5px'
                                }}>
                                    ICP Staking Bot
                                </h1>
                                {managerInfo?.version && (
                                    <span style={{
                                        background: matchedOfficialVersion ? `${theme.colors.success}20` : `${neuronPrimary}20`,
                                        color: matchedOfficialVersion ? theme.colors.success : neuronPrimary,
                                        padding: '2px 8px',
                                        borderRadius: '6px',
                                        fontSize: '0.7rem',
                                        fontWeight: '600'
                                    }}>
                                        v{managerInfo.version} {matchedOfficialVersion && '✓'}
                                    </span>
                                )}
                                {/* All-chores summary in page banner */}
                                {choreStatuses.length > 0 && (() => {
                                    const allSummary = getAllChoresSummaryLamp(choreStatuses);
                                    const summaryColor = LAMP_COLORS[allSummary];
                                    const summaryText = allSummary === LAMP_ERROR ? 'Chores: Error'
                                        : allSummary === LAMP_WARN ? 'Chores: Attention'
                                        : allSummary === LAMP_ACTIVE ? 'Chores: Active'
                                        : allSummary === LAMP_OK ? 'Chores: OK'
                                        : 'Chores: Idle';
                                    return (
                                        <span style={{
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            gap: '5px',
                                            padding: '2px 8px',
                                            borderRadius: '6px',
                                            fontSize: '0.7rem',
                                            fontWeight: '600',
                                            background: `${summaryColor}15`,
                                            color: summaryColor,
                                        }}
                                        title={getSummaryLabel(allSummary, 'All Chores')}
                                        >
                                            <StatusLamp state={allSummary} size={7} label={summaryText} />
                                            {summaryText}
                                        </span>
                                    );
                                })()}
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                                <PrincipalDisplay
                                    principal={canisterId}
                                    displayInfo={displayInfo}
                                    showCopyButton={true}
                                    isAuthenticated={isAuthenticated}
                                    noLink={true}
                                />
                            </div>
                        </div>
                    </div>
                    
                    <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap', marginTop: '0.75rem' }}>
                        <Link 
                            to="/help/icp-neuron-manager" 
                            style={{ 
                                color: neuronPrimary, 
                                fontSize: '0.85rem', 
                                textDecoration: 'none',
                                fontWeight: '500',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '4px'
                            }}
                        >
                            Learn how it works <FaArrowRight size={10} />
                        </Link>
                        <span style={{ color: theme.colors.border }}>|</span>
                        <button
                            onClick={() => setShowNamingSection(!showNamingSection)}
                            style={{
                                background: 'none',
                                border: 'none',
                                color: neuronPrimary,
                                fontSize: '0.85rem',
                                cursor: 'pointer',
                                padding: 0,
                                fontWeight: '500',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '4px'
                            }}
                        >
                            {showNamingSection ? (
                                <>Hide naming options <FaChevronUp size={10} /></>
                            ) : (
                                <>{isController ? 'Set name or nickname' : 'Set nickname'} <FaChevronDown size={10} /></>
                            )}
                        </button>
                    </div>
                </div>
            </div>
            
            <main style={{ maxWidth: '900px', margin: '0 auto', padding: '1.5rem 1rem' }}>
                
                {/* Naming Section */}
                {showNamingSection && (
                    <div className="neuron-mgr-fade-in" style={{ 
                        ...cardStyle, 
                        marginBottom: '1.25rem',
                        background: `linear-gradient(135deg, ${neuronPrimary}08 0%, ${theme.colors.cardGradient || theme.colors.secondaryBg} 100%)`,
                        border: `1px solid ${neuronPrimary}20`,
                    }}>
                        <h3 style={{ 
                            color: theme.colors.primaryText, 
                            marginBottom: '1rem', 
                            fontSize: '1rem',
                            fontWeight: '600',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px'
                        }}>
                            <span style={{
                                width: '28px',
                                height: '28px',
                                borderRadius: '8px',
                                background: `${neuronPrimary}20`,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: '14px'
                            }}>🏷️</span>
                            Name This Staking Bot
                        </h3>
                        
                        {namingError && (
                            <div style={{ 
                                color: theme.colors.error || '#ef4444', 
                                fontSize: '13px', 
                                marginBottom: '12px',
                                padding: '8px 12px',
                                backgroundColor: `${theme.colors.error || '#ef4444'}20`,
                                borderRadius: '6px',
                            }}>
                                {namingError}
                            </div>
                        )}
                        
                        {namingSuccess && (
                            <div style={{ 
                                color: theme.colors.success || '#22c55e', 
                                fontSize: '13px', 
                                marginBottom: '12px',
                                padding: '8px 12px',
                                backgroundColor: `${theme.colors.success || '#22c55e'}20`,
                                borderRadius: '6px',
                            }}>
                                {namingSuccess}
                            </div>
                        )}
                        
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                            {/* Nickname (private, only you see it) */}
                            <div>
                                <label style={{ color: theme.colors.secondaryText, fontSize: '13px', display: 'block', marginBottom: '6px' }}>
                                    Private Nickname <span style={{ color: theme.colors.mutedText }}>(only you can see this)</span>
                                </label>
                                <div style={{ display: 'flex', gap: '8px' }}>
                                    <input
                                        type="text"
                                        value={nicknameInput}
                                        onChange={(e) => setNicknameInput(e.target.value)}
                                        placeholder={displayInfo?.nickname || 'e.g., My Staking Bot'}
                                        style={{
                                            flex: 1,
                                            padding: '10px 12px',
                                            borderRadius: '6px',
                                            border: `1px solid ${theme.colors.border}`,
                                            backgroundColor: theme.colors.primaryBg,
                                            color: theme.colors.primaryText,
                                            fontSize: '14px',
                                        }}
                                    />
                                    <button
                                        onClick={async () => {
                                            if (!nicknameInput.trim()) return;
                                            setSavingNickname(true);
                                            setNamingError('');
                                            setNamingSuccess('');
                                            try {
                                                await setPrincipalNickname(identity, canisterId, nicknameInput.trim());
                                                setNamingSuccess('Nickname saved!');
                                                setNicknameInput('');
                                                if (fetchAllNames) fetchAllNames();
                                            } catch (err) {
                                                setNamingError(`Failed to save nickname: ${err.message}`);
                                            } finally {
                                                setSavingNickname(false);
                                            }
                                        }}
                                        disabled={savingNickname || !nicknameInput.trim()}
                                        style={{
                                            ...buttonStyle,
                                            opacity: (savingNickname || !nicknameInput.trim()) ? 0.6 : 1,
                                        }}
                                    >
                                        {savingNickname ? '...' : 'Save'}
                                    </button>
                                </div>
                                {displayInfo?.nickname && (
                                    <div style={{ color: theme.colors.mutedText, fontSize: '12px', marginTop: '4px' }}>
                                        Current: "{displayInfo.nickname}"
                                    </div>
                                )}
                            </div>
                            
                            {/* Public Name (everyone sees it) - only controllers can set */}
                            {isController && (
                            <div>
                                <label style={{ color: theme.colors.secondaryText, fontSize: '13px', display: 'block', marginBottom: '6px' }}>
                                    Public Name <span style={{ color: theme.colors.mutedText }}>(visible to everyone)</span>
                                </label>
                                <div style={{ display: 'flex', gap: '8px' }}>
                                    <input
                                        type="text"
                                        value={publicNameInput}
                                        onChange={(e) => setPublicNameInput(e.target.value)}
                                        placeholder={displayInfo?.name || 'e.g., Alice\'s Staking Bot'}
                                        style={{
                                            flex: 1,
                                            padding: '10px 12px',
                                            borderRadius: '6px',
                                            border: `1px solid ${theme.colors.border}`,
                                            backgroundColor: theme.colors.primaryBg,
                                            color: theme.colors.primaryText,
                                            fontSize: '14px',
                                        }}
                                    />
                                    <button
                                        onClick={async () => {
                                            if (!publicNameInput.trim()) return;
                                            setSavingPublicName(true);
                                            setNamingError('');
                                            setNamingSuccess('');
                                            try {
                                                await setPrincipalNameFor(identity, canisterId, publicNameInput.trim());
                                                setNamingSuccess('Public name saved!');
                                                setPublicNameInput('');
                                                if (fetchAllNames) fetchAllNames();
                                            } catch (err) {
                                                setNamingError(`Failed to save public name: ${err.message}`);
                                            } finally {
                                                setSavingPublicName(false);
                                            }
                                        }}
                                        disabled={savingPublicName || !publicNameInput.trim()}
                                        style={{
                                            ...buttonStyle,
                                            opacity: (savingPublicName || !publicNameInput.trim()) ? 0.6 : 1,
                                        }}
                                    >
                                        {savingPublicName ? '...' : 'Save'}
                                    </button>
                                </div>
                                {displayInfo?.name && (
                                    <div style={{ color: theme.colors.mutedText, fontSize: '12px', marginTop: '4px' }}>
                                        Current: "{displayInfo.name}"
                                    </div>
                                )}
                            </div>
                            )}
                        </div>
                    </div>
                )}
                
                {loading ? (
                    <div className="neuron-mgr-fade-in" style={{ 
                        textAlign: 'center', 
                        padding: '3rem', 
                        color: theme.colors.primaryText,
                        background: theme.colors.cardGradient,
                        borderRadius: '16px',
                        border: `1px solid ${theme.colors.border}`
                    }}>
                        <FaSync className="spin" style={{ fontSize: '2rem', color: neuronPrimary, marginBottom: '1rem' }} />
                        <div style={{ color: theme.colors.secondaryText }}>Loading manager...</div>
                    </div>
                ) : error && !managerInfo ? (
                    <div style={{ 
                        backgroundColor: `${theme.colors.error}20`, 
                        border: `1px solid ${theme.colors.error}`,
                        color: theme.colors.error,
                        padding: '15px',
                        borderRadius: '8px',
                    }}>
                        {error}
                    </div>
                ) : managerInfo && (
                    <>
                        {/* Invalid Manager Warning */}
                        {isInvalidManager && (
                            <div style={{ 
                                backgroundColor: `${theme.colors.warning || '#f59e0b'}20`, 
                                border: `1px solid ${theme.colors.warning || '#f59e0b'}`,
                                color: theme.colors.warning || '#f59e0b',
                                padding: '16px 20px',
                                borderRadius: '12px',
                                marginBottom: '20px',
                            }}>
                                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                                    <span style={{ fontSize: '24px' }}>⚠️</span>
                                    <div>
                                        <div style={{ fontWeight: '600', marginBottom: '8px', color: theme.colors.primaryText }}>
                                            App Canister Not Recognized as ICP Staking Bot
                                        </div>
                                        <div style={{ fontSize: '13px', marginBottom: '12px' }}>
                                            {invalidManagerReason || 'This app canister does not respond to expected Staking Bot methods.'}
                                        </div>
                                        <div style={{ fontSize: '12px', color: theme.colors.mutedText }}>
                                            💡 If you are a controller of this canister, you can try to <strong style={{ color: theme.colors.primaryText }}>reinstall</strong> it 
                                            with the latest official Staking Bot WASM using the Canister section below. 
                                            This will overwrite the existing code but preserve data (if compatible).
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}
                        
                        {/* ============================================ */}
                        {/* CANISTER SECTION */}
                        {/* ============================================ */}
                        <div className="neuron-mgr-fade-in" style={{ marginBottom: '1.25rem' }}>
                            {/* Section Header */}
                            <button
                                onClick={() => setCanisterSectionExpanded(!canisterSectionExpanded)}
                                style={{
                                    width: '100%',
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'center',
                                    padding: '1rem 1.25rem',
                                    background: canisterSectionExpanded 
                                        ? `linear-gradient(90deg, ${neuronPrimary}15 0%, transparent 100%)`
                                        : theme.colors.cardGradient,
                                    border: `1px solid ${theme.colors.border}`,
                                    borderRadius: canisterSectionExpanded ? '14px 14px 0 0' : '14px',
                                    cursor: 'pointer',
                                    color: theme.colors.primaryText,
                                    transition: 'all 0.2s',
                                    boxShadow: theme.colors.cardShadow,
                                }}
                            >
                                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                    <div style={{
                                        width: '36px',
                                        height: '36px',
                                        borderRadius: '10px',
                                        background: `linear-gradient(135deg, ${neuronPrimary}30, ${neuronPrimary}10)`,
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                    }}>
                                        <FaRobot style={{ color: neuronPrimary, fontSize: '16px' }} />
                                    </div>
                                    <span style={{ fontSize: '1.05rem', fontWeight: '600' }}>Bot</span>
                                    {canisterStatus && (
                                        <span style={{ 
                                            fontSize: '0.75rem', 
                                            color: getCyclesColor(canisterStatus.cycles, cycleSettings),
                                            backgroundColor: `${getCyclesColor(canisterStatus.cycles, cycleSettings)}15`,
                                            padding: '4px 10px',
                                            borderRadius: '8px',
                                            fontWeight: '600',
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '4px'
                                        }}>
                                            ⚡ {formatCycles(canisterStatus.cycles)}
                                        </span>
                                    )}
                                    {/* Per-chore summary lamps in Bot header */}
                                    {choreStatuses.length > 0 && (
                                        <span style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '6px',
                                            padding: '4px 10px',
                                            borderRadius: '8px',
                                            background: `${theme.colors.border}30`,
                                            fontSize: '0.7rem',
                                            color: theme.colors.secondaryText,
                                        }}>
                                            {choreStatuses.map(chore => {
                                                const summary = getChoreSummaryLamp(chore);
                                                return (
                                                    <StatusLamp
                                                        key={chore.choreId}
                                                        state={summary}
                                                        size={8}
                                                        label={getSummaryLabel(summary, chore.choreName)}
                                                    />
                                                );
                                            })}
                                            <span style={{ marginLeft: '2px' }}>Chores</span>
                                        </span>
                                    )}
                                </div>
                                <span style={{ 
                                    fontSize: '14px',
                                    transform: canisterSectionExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                                    transition: 'transform 0.2s ease',
                                    color: theme.colors.mutedText,
                                }}>
                                    {canisterSectionExpanded ? <FaChevronUp /> : <FaChevronDown />}
                                </span>
                            </button>
                            
                            {/* Section Content */}
                            {canisterSectionExpanded && (
                                <div style={{ 
                                    border: `1px solid ${theme.colors.border}`,
                                    borderTop: 'none',
                                    borderRadius: '0 0 12px 12px',
                                    overflow: 'hidden',
                                    padding: '20px',
                                }}>

                                {/* Canister Section Tabs */}
                                <div style={{ 
                                    display: 'flex', 
                                    flexWrap: 'wrap', 
                                    marginBottom: '16px',
                                    gap: '0'
                                }}>
                                    <button style={tabStyle(canisterActiveTab === 'info')} onClick={() => setCanisterActiveTab('info')}>
                                        Info
                                    </button>
                                    <button style={tabStyle(canisterActiveTab === 'permissions')} onClick={() => setCanisterActiveTab('permissions')}>
                                        Botkeys
                                    </button>
                                    {(hasPermission('ViewChores') || canManageAnyChore) && (
                                    <button style={{...tabStyle(canisterActiveTab === 'chores'), display: 'inline-flex', alignItems: 'center', gap: '6px'}} onClick={() => setCanisterActiveTab('chores')}>
                                        {choreStatuses.length > 0 && (
                                            <StatusLamp
                                                state={getAllChoresSummaryLamp(choreStatuses)}
                                                size={8}
                                                label={getSummaryLabel(getAllChoresSummaryLamp(choreStatuses), 'Chores')}
                                            />
                                        )}
                                        Chores
                                    </button>
                                    )}
                                </div>

                        {canisterActiveTab === 'info' && (
                        <>
                        {/* Manager Info Card */}
                        <div style={cardStyle}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '20px' }}>
                                <div>
                                    <div style={{ color: theme.colors.mutedText, fontSize: '12px' }}>
                                        Canister ID
                                    </div>
                                    <div style={{ color: theme.colors.primaryText, fontSize: '14px', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                        <PrincipalDisplay
                                            principal={managerInfo.canisterId}
                                            displayInfo={displayInfo}
                                            showCopyButton={true}
                                            isAuthenticated={isAuthenticated}
                                            noLink={true}
                                        />
                                    </div>
                                </div>
                                {canisterStatus && (
                                    <div style={{ textAlign: 'right' }}>
                                        <div style={{ color: theme.colors.mutedText, fontSize: '12px' }}>Cycles</div>
                                        <div style={{ 
                                            color: getCyclesColor(canisterStatus.cycles, cycleSettings), 
                                            fontSize: '24px', 
                                            fontWeight: '700',
                                            marginTop: '4px',
                                        }}>
                                            {formatCycles(canisterStatus.cycles)}
                                        </div>
                                    </div>
                                )}
                            </div>

                            <div style={{ marginTop: '15px', display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                    <span style={{ color: theme.colors.mutedText, fontSize: '12px' }}>Version: </span>
                                    <span style={{ color: theme.colors.primaryText, fontSize: '12px' }}>
                                        {managerInfo.version}
                                    </span>
                                    {matchedOfficialVersion && 
                                     `${Number(matchedOfficialVersion.major)}.${Number(matchedOfficialVersion.minor)}.${Number(matchedOfficialVersion.patch)}` === managerInfo.version && (
                                        <span title="Version verified against official registry" style={{ 
                                            color: theme.colors.success || '#22c55e',
                                            fontSize: '14px'
                                        }}>
                                            ✓
                                        </span>
                                    )}
                                </div>
                                {canisterStatus && (
                                    <div>
                                        <span style={{ color: theme.colors.mutedText, fontSize: '12px' }}>Status: </span>
                                        <span style={{ 
                                            color: canisterStatus.status === 'running' ? (theme.colors.success || '#22c55e') : theme.colors.warning || '#f59e0b',
                                            fontSize: '12px',
                                            textTransform: 'capitalize'
                                        }}>
                                            {canisterStatus.status}
                                        </span>
                                    </div>
                                )}
                                {canisterStatus && canisterStatus.memorySize !== undefined && (
                                    <div>
                                        <span style={{ color: theme.colors.mutedText, fontSize: '12px' }}>Memory: </span>
                                        <span style={{ color: theme.colors.primaryText, fontSize: '12px' }}>
                                            {(canisterStatus.memorySize / (1024 * 1024)).toFixed(2)} MB
                                        </span>
                                    </div>
                                )}
                            </div>

                            {/* Module Hash */}
                            {canisterStatus && (
                                <div style={{ marginTop: '15px' }}>
                                    <div style={{ 
                                        display: 'flex', 
                                        alignItems: 'center', 
                                        justifyContent: 'space-between',
                                        marginBottom: '4px'
                                    }}>
                                        <span style={{ color: theme.colors.mutedText, fontSize: '12px' }}>
                                            Module Hash
                                        </span>
                                        {matchedOfficialVersion && (
                                            <span style={{ 
                                                color: theme.colors.success || '#22c55e',
                                                fontSize: '11px',
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '4px'
                                            }}>
                                                ✓ Official v{Number(matchedOfficialVersion.major)}.{Number(matchedOfficialVersion.minor)}.{Number(matchedOfficialVersion.patch)}
                                            </span>
                                        )}
                                        {canisterStatus.moduleHash && !matchedOfficialVersion && officialVersions.length > 0 && (
                                            <span style={{ 
                                                color: theme.colors.warning || '#f59e0b',
                                                fontSize: '11px'
                                            }}>
                                                ⚠ Unverified
                                            </span>
                                        )}
                                    </div>
                                    <div style={{ 
                                        color: matchedOfficialVersion 
                                            ? (theme.colors.success || '#22c55e') 
                                            : theme.colors.primaryText, 
                                        fontFamily: 'monospace',
                                        fontSize: '11px',
                                        background: theme.colors.tertiaryBg || theme.colors.secondaryBg,
                                        padding: '8px 10px',
                                        borderRadius: '4px',
                                        wordBreak: 'break-all',
                                        border: matchedOfficialVersion 
                                            ? `1px solid ${theme.colors.success || '#22c55e'}30` 
                                            : 'none'
                                    }}>
                                        {canisterStatus.moduleHash || (
                                            <span style={{ color: theme.colors.mutedText, fontStyle: 'italic' }}>
                                                No module installed
                                            </span>
                                        )}
                                    </div>
                                    {/* Show links if matched official version has them */}
                                    {matchedOfficialVersion && (matchedOfficialVersion.wasmUrl || matchedOfficialVersion.sourceUrl) && (
                                        <div style={{ 
                                            display: 'flex', 
                                            gap: '15px', 
                                            marginTop: '8px',
                                            fontSize: '11px'
                                        }}>
                                            {matchedOfficialVersion.sourceUrl && (
                                                <a 
                                                    href={matchedOfficialVersion.sourceUrl}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    style={{ color: theme.colors.accent }}
                                                >
                                                    View Source →
                                                </a>
                                            )}
                                            {matchedOfficialVersion.wasmUrl && (
                                                <a 
                                                    href={matchedOfficialVersion.wasmUrl}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    style={{ color: theme.colors.accent }}
                                                >
                                                    Download WASM →
                                                </a>
                                            )}
                                        </div>
                                    )}
                                    
                                    {/* Upgrade Available Section */}
                                    {nextAvailableVersion && isController && (
                                        <div style={{
                                            marginTop: '12px',
                                            padding: '12px',
                                            background: `${theme.colors.accent}15`,
                                            borderRadius: '6px',
                                            border: `1px solid ${theme.colors.accent}40`,
                                        }}>
                                            <div style={{ 
                                                display: 'flex', 
                                                alignItems: 'flex-start', 
                                                justifyContent: 'space-between',
                                                flexWrap: 'wrap',
                                                gap: '10px'
                                            }}>
                                                <div>
                                                    <div style={{ 
                                                        color: theme.colors.accent, 
                                                        fontWeight: '600',
                                                        fontSize: '13px',
                                                        marginBottom: '2px'
                                                    }}>
                                                        🚀 Upgrade Available
                                                    </div>
                                                    <div style={{ 
                                                        color: theme.colors.mutedText, 
                                                        fontSize: '12px'
                                                    }}>
                                                        v{Number(nextAvailableVersion.major)}.{Number(nextAvailableVersion.minor)}.{Number(nextAvailableVersion.patch)} is available
                                                    </div>
                                                </div>
                                                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                                                    <button
                                                        onClick={() => handleUpgrade(nextAvailableVersion, 'upgrade')}
                                                        disabled={upgrading}
                                                        style={{
                                                            background: theme.colors.accent,
                                                            color: '#fff',
                                                            border: 'none',
                                                            borderRadius: '6px',
                                                            padding: '8px 16px',
                                                            fontSize: '13px',
                                                            fontWeight: '600',
                                                            cursor: upgrading ? 'wait' : 'pointer',
                                                            opacity: upgrading ? 0.7 : 1,
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            gap: '6px',
                                                        }}
                                                        title="Upgrade keeps canister state"
                                                    >
                                                        {upgrading && upgradeMode === 'upgrade' ? (
                                                            <>
                                                                <span style={{
                                                                    animation: 'spin 1s linear infinite',
                                                                    display: 'inline-block',
                                                                }}>⏳</span>
                                                                Upgrading...
                                                            </>
                                                        ) : (
                                                            <>⬆️ Upgrade</>
                                                        )}
                                                    </button>
                                                    <button
                                                        onClick={() => {
                                                            if (window.confirm('⚠️ Reinstall will WIPE ALL CANISTER STATE including creation time. This cannot be undone. Are you sure?')) {
                                                                handleUpgrade(nextAvailableVersion, 'reinstall');
                                                            }
                                                        }}
                                                        disabled={upgrading}
                                                        style={{
                                                            background: 'transparent',
                                                            color: theme.colors.mutedText,
                                                            border: `1px solid ${theme.colors.border || '#3a3a3a'}`,
                                                            borderRadius: '6px',
                                                            padding: '8px 12px',
                                                            fontSize: '12px',
                                                            cursor: upgrading ? 'wait' : 'pointer',
                                                            opacity: upgrading ? 0.7 : 1,
                                                        }}
                                                        title="⚠️ Reinstall DELETES all canister state!"
                                                    >
                                                        {upgrading && upgradeMode === 'reinstall' ? '⏳...' : '🔄 Reinstall'}
                                                    </button>
                                                </div>
                                            </div>
                                            {nextAvailableVersion.sourceUrl && (
                                                <div style={{ marginTop: '8px', fontSize: '11px' }}>
                                                    <a 
                                                        href={nextAvailableVersion.sourceUrl}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        style={{ color: theme.colors.accent }}
                                                    >
                                                        View release notes →
                                                    </a>
                                                </div>
                                            )}
                                            {upgradeError && (
                                                <div style={{
                                                    marginTop: '10px',
                                                    padding: '8px 10px',
                                                    background: `${theme.colors.error || '#ef4444'}20`,
                                                    borderRadius: '4px',
                                                    color: theme.colors.error || '#ef4444',
                                                    fontSize: '12px',
                                                }}>
                                                    {upgradeError}
                                                </div>
                                            )}
                                            {upgradeSuccess && (
                                                <div style={{
                                                    marginTop: '10px',
                                                    padding: '8px 10px',
                                                    background: `${theme.colors.success || '#22c55e'}20`,
                                                    borderRadius: '4px',
                                                    color: theme.colors.success || '#22c55e',
                                                    fontSize: '12px',
                                                }}>
                                                    {upgradeSuccess}
                                                </div>
                                            )}
                                        </div>
                                    )}
                                    
                                    {/* Install Official Version Section - shown when WASM is unverified OR version mismatch */}
                                    {(() => {
                                        // Check for version mismatch (hash matches official but version doesn't match what canister claims)
                                        const hasVersionMismatch = matchedOfficialVersion && managerInfo?.version && 
                                            `${Number(matchedOfficialVersion.major)}.${Number(matchedOfficialVersion.minor)}.${Number(matchedOfficialVersion.patch)}` !== managerInfo.version;
                                        const isUnverifiedWasm = canisterStatus?.moduleHash && !matchedOfficialVersion;
                                        const shouldShowWarning = (isUnverifiedWasm || hasVersionMismatch) && latestOfficialVersion && isController;
                                        
                                        if (!shouldShowWarning) return null;
                                        
                                        return (
                                        <div style={{
                                            marginTop: '12px',
                                            padding: '12px',
                                            background: `${theme.colors.warning || '#f59e0b'}15`,
                                            borderRadius: '6px',
                                            border: `1px solid ${theme.colors.warning || '#f59e0b'}40`,
                                        }}>
                                            <div style={{ 
                                                color: isUnverifiedWasm ? (theme.colors.error || '#ef4444') : (theme.colors.warning || '#f59e0b'), 
                                                fontWeight: '600',
                                                fontSize: '13px',
                                                marginBottom: '6px'
                                            }}>
                                                {hasVersionMismatch ? '⚠️ Version Mismatch' : '⚠️ Unknown WASM — Proceed With Care'}
                                            </div>
                                            <div style={{ 
                                                color: theme.colors.mutedText, 
                                                fontSize: '12px',
                                                marginBottom: isUnverifiedWasm ? '8px' : '12px'
                                            }}>
                                                {hasVersionMismatch 
                                                    ? `The WASM hash matches official v${Number(matchedOfficialVersion.major)}.${Number(matchedOfficialVersion.minor)}.${Number(matchedOfficialVersion.patch)}, but the canister reports v${managerInfo.version}. You can install the latest official version (v${Number(latestOfficialVersion.major)}.${Number(latestOfficialVersion.minor)}.${Number(latestOfficialVersion.patch)}).`
                                                    : `This canister is running an unverified WASM module that does not match any known ICP Staking Bot version. This canister may not be an ICP Staking Bot. Upgrading it with the staking bot WASM could break or destroy the canister. Only proceed if you are sure this canister is an ICP Staking Bot.`
                                                }
                                            </div>
                                            {isUnverifiedWasm && (
                                                <div style={{
                                                    padding: '8px 10px',
                                                    background: `${theme.colors.error || '#ef4444'}15`,
                                                    borderRadius: '4px',
                                                    border: `1px solid ${theme.colors.error || '#ef4444'}30`,
                                                    color: theme.colors.error || '#ef4444',
                                                    fontSize: '11px',
                                                    fontWeight: '500',
                                                    marginBottom: '12px',
                                                    lineHeight: '1.4',
                                                }}>
                                                    Module hash: {canisterStatus.moduleHash}
                                                    <br />
                                                    This hash does not match any known official ICP Staking Bot WASM. If this canister is not a staking bot, upgrading it will replace its code.
                                                </div>
                                            )}
                                            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                                                <button
                                                    onClick={() => {
                                                        if (isUnverifiedWasm) {
                                                            if (window.confirm('⚠️ This canister has an unknown WASM and may not be an ICP Staking Bot. Upgrading it with the staking bot WASM could break or destroy this canister. Are you sure you want to proceed?')) {
                                                                handleUpgrade(latestOfficialVersion, 'upgrade');
                                                            }
                                                        } else {
                                                            handleUpgrade(latestOfficialVersion, 'upgrade');
                                                        }
                                                    }}
                                                    disabled={upgrading}
                                                    style={{
                                                        background: isUnverifiedWasm ? (theme.colors.warning || '#f59e0b') : theme.colors.accent,
                                                        color: '#fff',
                                                        border: 'none',
                                                        borderRadius: '6px',
                                                        padding: '8px 16px',
                                                        fontSize: '13px',
                                                        fontWeight: '600',
                                                        cursor: upgrading ? 'wait' : 'pointer',
                                                        opacity: upgrading ? 0.7 : 1,
                                                    }}
                                                    title={isUnverifiedWasm ? "⚠️ Unknown WASM — upgrade with caution" : "Upgrade keeps canister state"}
                                                >
                                                    {upgrading && upgradeMode === 'upgrade' ? '⏳ Upgrading...' : '⬆️ Upgrade'}
                                                </button>
                                                <button
                                                    onClick={() => {
                                                        if (window.confirm('⚠️ Reinstall will WIPE ALL CANISTER STATE. This cannot be undone. Are you sure?')) {
                                                            handleUpgrade(latestOfficialVersion, 'reinstall');
                                                        }
                                                    }}
                                                    disabled={upgrading}
                                                    style={{
                                                        background: 'transparent',
                                                        color: theme.colors.error || '#ef4444',
                                                        border: `1px solid ${theme.colors.error || '#ef4444'}`,
                                                        borderRadius: '6px',
                                                        padding: '8px 16px',
                                                        fontSize: '13px',
                                                        fontWeight: '600',
                                                        cursor: upgrading ? 'wait' : 'pointer',
                                                        opacity: upgrading ? 0.7 : 1,
                                                    }}
                                                    title="⚠️ Reinstall DELETES all canister state!"
                                                >
                                                    {upgrading && upgradeMode === 'reinstall' ? '⏳ Reinstalling...' : '🔄 Reinstall'}
                                                </button>
                                            </div>
                                            {latestOfficialVersion && (
                                                <div style={{ marginTop: '10px', fontSize: '11px', color: theme.colors.mutedText }}>
                                                    Target: ICP Staking Bot v{Number(latestOfficialVersion.major)}.{Number(latestOfficialVersion.minor)}.{Number(latestOfficialVersion.patch)}
                                                    {latestOfficialVersion.sourceUrl && (
                                                        <>
                                                            {' — '}
                                                            <a 
                                                                href={latestOfficialVersion.sourceUrl}
                                                                target="_blank"
                                                                rel="noopener noreferrer"
                                                                style={{ color: theme.colors.accent }}
                                                            >
                                                                View source code →
                                                            </a>
                                                        </>
                                                    )}
                                                </div>
                                            )}
                                            {upgradeError && (
                                                <div style={{
                                                    marginTop: '10px',
                                                    padding: '8px 10px',
                                                    background: `${theme.colors.error || '#ef4444'}20`,
                                                    borderRadius: '4px',
                                                    color: theme.colors.error || '#ef4444',
                                                    fontSize: '12px',
                                                }}>
                                                    {upgradeError}
                                                </div>
                                            )}
                                            {upgradeSuccess && (
                                                <div style={{
                                                    marginTop: '10px',
                                                    padding: '8px 10px',
                                                    background: `${theme.colors.success || '#22c55e'}20`,
                                                    borderRadius: '4px',
                                                    color: theme.colors.success || '#22c55e',
                                                    fontSize: '12px',
                                                }}>
                                                    {upgradeSuccess}
                                                </div>
                                            )}
                                        </div>
                                        );
                                    })()}
                                    
                                </div>
                            )}
                            
                            {/* Non-Controller Upgrade Notice - shown when user is not a controller but there's an issue that could be fixed by upgrading */}
                            {(() => {
                                // For invalid managers, we show this even if canisterStatus failed to load
                                // Since non-controllers can't fetch canister_status, we can't check moduleHash
                                const isUnverifiedWasm = canisterStatus?.moduleHash && !matchedOfficialVersion;
                                const hasVersionMismatch = matchedOfficialVersion && managerInfo?.version && 
                                    `${Number(matchedOfficialVersion.major)}.${Number(matchedOfficialVersion.minor)}.${Number(matchedOfficialVersion.patch)}` !== managerInfo.version;
                                const hasIssue = isInvalidManager || isUnverifiedWasm || hasVersionMismatch;
                                
                                // Show if user is not a controller AND there's an issue (or we're an invalid manager)
                                // Note: isController might be false simply because we couldn't fetch controllers (not a controller)
                                const userIsNotController = !isController;
                                
                                if (!userIsNotController || !hasIssue) return null;
                                
                                return (
                                    <div style={{
                                        marginTop: '15px',
                                        padding: '12px',
                                        background: `${theme.colors.mutedText}10`,
                                        borderRadius: '6px',
                                        border: `1px solid ${theme.colors.border}`,
                                    }}>
                                        <div style={{ 
                                            color: theme.colors.mutedText, 
                                            fontWeight: '600',
                                            fontSize: '13px',
                                            marginBottom: '6px',
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '8px',
                                        }}>
                                            <span>🔒</span>
                                            <span>Upgrade/Reinstall Not Available</span>
                                        </div>
                                        <div style={{ 
                                            color: theme.colors.mutedText, 
                                            fontSize: '12px',
                                            lineHeight: '1.5',
                                        }}>
                                            You are not a controller of this canister. Only controllers can upgrade or reinstall the canister.
                                            {latestOfficialVersion && (
                                                <span style={{ display: 'block', marginTop: '8px' }}>
                                                    Latest official version: <strong style={{ color: theme.colors.primaryText }}>v{Number(latestOfficialVersion.major)}.{Number(latestOfficialVersion.minor)}.{Number(latestOfficialVersion.patch)}</strong>
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                );
                            })()}

                            {/* Controllers Section */}
                            {controllers.length > 0 && (
                                <div style={{ marginTop: '15px' }}>
                                    <div style={{ color: theme.colors.mutedText, fontSize: '12px', marginBottom: '8px' }}>
                                        Controllers ({controllers.length})
                                    </div>
                                    <div style={{ 
                                        background: `${theme.colors.tertiaryBg || theme.colors.secondaryBg}`,
                                        padding: '10px',
                                        borderRadius: '6px',
                                    }}>
                                        {controllers.map((controller, index) => {
                                            const controllerStr = controller.toString();
                                            const isCurrentUser = identity && controllerStr === identity.getPrincipal().toString();
                                            const isConfirmingRemove = confirmRemoveController === controllerStr;
                                            return (
                                                <div 
                                                    key={index}
                                                    style={{ 
                                                        display: 'flex', 
                                                        alignItems: 'center', 
                                                        gap: '8px',
                                                        padding: '6px 0',
                                                        borderBottom: index < controllers.length - 1 ? `1px solid ${theme.colors.border}` : 'none',
                                                    }}
                                                >
                                                    <div style={{ flex: 1, overflow: 'hidden', minWidth: 0 }}>
                                                        <PrincipalDisplay
                                                            principal={controllerStr}
                                                            displayInfo={getPrincipalDisplayInfoFromContext(controllerStr, principalNames, principalNicknames)}
                                                            showCopyButton={true}
                                                            isAuthenticated={isAuthenticated}
                                                            short={false}
                                                            noLink={false}
                                                        />
                                                    </div>
                                                    {isCurrentUser && (
                                                        <span style={{
                                                            backgroundColor: `${theme.colors.accent}30`,
                                                            color: theme.colors.accent,
                                                            padding: '2px 6px',
                                                            borderRadius: '4px',
                                                            fontSize: '10px',
                                                            fontWeight: '500',
                                                            flexShrink: 0,
                                                        }}>
                                                            YOU
                                                        </span>
                                                    )}
                                                    {/* Remove button */}
                                                    {isConfirmingRemove ? (
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                            <span style={{ 
                                                                color: isCurrentUser ? theme.colors.warning : theme.colors.error, 
                                                                fontSize: '10px',
                                                                whiteSpace: 'nowrap'
                                                            }}>
                                                                {isCurrentUser ? '⚠️ Remove yourself?' : 'Confirm?'}
                                                            </span>
                                                            <button
                                                                onClick={() => handleRemoveController(controller)}
                                                                disabled={updatingControllers}
                                                                style={{
                                                                    backgroundColor: theme.colors.error || '#ef4444',
                                                                    color: '#fff',
                                                                    border: 'none',
                                                                    borderRadius: '4px',
                                                                    padding: '2px 6px',
                                                                    cursor: updatingControllers ? 'not-allowed' : 'pointer',
                                                                    fontSize: '10px',
                                                                    fontWeight: '500',
                                                                    opacity: updatingControllers ? 0.7 : 1,
                                                                }}
                                                            >
                                                                {updatingControllers ? '...' : 'Yes'}
                                                            </button>
                                                            <button
                                                                onClick={() => setConfirmRemoveController(null)}
                                                                style={{
                                                                    backgroundColor: theme.colors.secondaryBg,
                                                                    color: theme.colors.primaryText,
                                                                    border: `1px solid ${theme.colors.border}`,
                                                                    borderRadius: '4px',
                                                                    padding: '2px 6px',
                                                                    cursor: 'pointer',
                                                                    fontSize: '10px',
                                                                }}
                                                            >
                                                                No
                                                            </button>
                                                        </div>
                                                    ) : (
                                                        <button
                                                            onClick={() => setConfirmRemoveController(controllerStr)}
                                                            disabled={updatingControllers}
                                                            style={{
                                                                backgroundColor: 'transparent',
                                                                color: theme.colors.error || '#ef4444',
                                                                border: `1px solid ${theme.colors.error || '#ef4444'}`,
                                                                borderRadius: '4px',
                                                                padding: '2px 6px',
                                                                cursor: updatingControllers ? 'not-allowed' : 'pointer',
                                                                fontSize: '10px',
                                                                fontWeight: '500',
                                                                opacity: updatingControllers ? 0.7 : 1,
                                                            }}
                                                        >
                                                            Remove
                                                        </button>
                                                    )}
                                                </div>
                                            );
                                        })}
                                        
                                        {/* Add Controller */}
                                        <div style={{ 
                                            marginTop: '12px',
                                            paddingTop: '12px',
                                            borderTop: `1px solid ${theme.colors.border}`
                                        }}>
                                            <div style={{ 
                                                color: theme.colors.mutedText, 
                                                fontSize: '11px',
                                                marginBottom: '6px'
                                            }}>
                                                Add Controller
                                            </div>
                                            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'flex-start' }}>
                                                <div style={{ flex: '1', minWidth: '180px' }}>
                                                    <PrincipalInput
                                                        value={newControllerInput}
                                                        onChange={setNewControllerInput}
                                                        placeholder="Enter principal ID or search by name"
                                                        defaultTab="private"
                                                        defaultPrincipalType="both"
                                                        disabled={updatingControllers}
                                                    />
                                                </div>
                                                <button
                                                    onClick={handleAddController}
                                                    disabled={updatingControllers || !newControllerInput.trim()}
                                                    style={{
                                                        backgroundColor: theme.colors.success || '#22c55e',
                                                        color: '#fff',
                                                        border: 'none',
                                                        borderRadius: '4px',
                                                        padding: '6px 12px',
                                                        cursor: (updatingControllers || !newControllerInput.trim()) ? 'not-allowed' : 'pointer',
                                                        fontSize: '12px',
                                                        fontWeight: '500',
                                                        opacity: (updatingControllers || !newControllerInput.trim()) ? 0.7 : 1
                                                    }}
                                                >
                                                    {updatingControllers ? 'Updating...' : 'Add'}
                                                </button>
                                            </div>
                                            <p style={{ 
                                                color: theme.colors.mutedText, 
                                                fontSize: '10px',
                                                marginTop: '6px',
                                                marginBottom: 0
                                            }}>
                                                ⚠️ Be careful when modifying controllers. Removing all controllers will make the canister permanently uncontrollable.
                                            </p>
                                        </div>
                                        
                                        {/* Controller Success Message */}
                                        {controllerSuccess && (
                                            <div style={{
                                                marginTop: '10px',
                                                padding: '8px',
                                                backgroundColor: `${theme.colors.success || '#22c55e'}20`,
                                                borderRadius: '4px',
                                                color: theme.colors.success || '#22c55e',
                                                fontSize: '12px',
                                            }}>
                                                ✅ {controllerSuccess}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Cycles Top-Up Card */}
                        <div style={cardStyle}>
                            <div style={{ 
                                display: 'flex', 
                                justifyContent: 'space-between', 
                                alignItems: 'center',
                                marginBottom: showTopUpSection ? '1rem' : '0',
                                flexWrap: 'wrap',
                                gap: '0.75rem'
                            }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                    <div style={{
                                        width: '40px',
                                        height: '40px',
                                        borderRadius: '10px',
                                        background: `linear-gradient(135deg, ${neuronPrimary}25, ${neuronPrimary}10)`,
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        flexShrink: 0
                                    }}>
                                        <FaGasPump style={{ color: neuronPrimary, fontSize: '16px' }} />
                                    </div>
                                    <div>
                                        <h3 style={{ color: theme.colors.primaryText, margin: '0 0 2px 0', fontSize: '1rem', fontWeight: '600' }}>
                                            Top Up Cycles
                                        </h3>
                                        <p style={{ color: theme.colors.mutedText, fontSize: '0.8rem', margin: 0 }}>
                                            Convert ICP to cycles for this canister
                                        </p>
                                    </div>
                                </div>
                                <button
                                    onClick={() => setShowTopUpSection(!showTopUpSection)}
                                    style={{
                                        ...showTopUpSection ? secondaryButtonStyle : buttonStyle,
                                        padding: '0.5rem 1rem',
                                        fontSize: '0.85rem'
                                    }}
                                >
                                    {showTopUpSection ? 'Cancel' : '⛽ Add Cycles'}
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
                                        backgroundColor: theme.colors.tertiaryBg || theme.colors.secondaryBg,
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
                                                type="text"
                                                inputMode="decimal"
                                                value={topUpAmount}
                                                onChange={(e) => setTopUpAmount(e.target.value)}
                                                placeholder="0.0"
                                                disabled={toppingUp}
                                                style={inputStyle}
                                            />
                                            <button
                                                onClick={() => {
                                                    if (userIcpBalance) {
                                                        const maxAmount = Math.max(0, (userIcpBalance - ICP_FEE * 2) / E8S);
                                                        setTopUpAmount(maxAmount.toFixed(4));
                                                    }
                                                }}
                                                disabled={toppingUp || !userIcpBalance}
                                                style={{ ...secondaryButtonStyle, padding: '10px 12px' }}
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
                                            backgroundColor: `${theme.colors.success || '#22c55e'}15`,
                                            borderRadius: '6px',
                                            border: `1px solid ${theme.colors.success || '#22c55e'}30`,
                                            textAlign: 'center'
                                        }}>
                                            <div style={{ color: theme.colors.mutedText, fontSize: '12px', marginBottom: '4px' }}>
                                                Estimated Cycles to Add
                                            </div>
                                            <div style={{ 
                                                color: theme.colors.success || '#22c55e', 
                                                fontSize: '20px', 
                                                fontWeight: '700' 
                                            }}>
                                                ~{formatCycles(estimatedCycles())}
                                            </div>
                                        </div>
                                    )}
                                    
                                    {/* Top Up Button */}
                                    <button
                                        onClick={handleCyclesTopUp}
                                        disabled={toppingUp || !topUpAmount || parseFloat(topUpAmount) <= 0}
                                        style={{
                                            ...buttonStyle,
                                            width: '100%',
                                            opacity: (toppingUp || !topUpAmount || parseFloat(topUpAmount) <= 0) ? 0.6 : 1,
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            gap: '8px'
                                        }}
                                    >
                                        {toppingUp ? (
                                            '⏳ Processing...'
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
                                        marginTop: '10px',
                                        marginBottom: 0,
                                        textAlign: 'center'
                                    }}>
                                        Converts ICP to cycles via the Cycles Minting Canister (CMC).
                                        A small ICP fee (0.0001) applies.
                                    </p>
                                </div>
                            )}
                        </div>

                        {/* Withdraw Tokens from Canister - Collapsible (only for principals with WithdrawFunds permission) */}
                        {hasPermission('WithdrawFunds') && (
                        <div style={cardStyle}>
                            <button
                                onClick={() => setWithdrawSectionExpanded(!withdrawSectionExpanded)}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    width: '100%',
                                    background: 'transparent',
                                    border: 'none',
                                    padding: 0,
                                    cursor: 'pointer',
                                    textAlign: 'left',
                                }}
                            >
                                <div>
                                    <h3 style={{ color: theme.colors.primaryText, margin: '0 0 5px 0' }}>💸 Withdraw Tokens</h3>
                                    <p style={{ color: theme.colors.mutedText, fontSize: '12px', margin: 0 }}>
                                        Withdraw ICP or any ICRC1 token from this canister
                                    </p>
                                </div>
                                <span style={{ 
                                    color: theme.colors.mutedText, 
                                    fontSize: '18px',
                                    transform: withdrawSectionExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                                    transition: 'transform 0.2s ease',
                                }}>
                                    ▼
                                </span>
                            </button>
                            
                            {withdrawSectionExpanded && (
                                <div style={{ marginTop: '15px' }}>
                                    {/* Token Selection */}
                                    <div style={{ marginBottom: '15px' }}>
                                        <label style={{ color: theme.colors.mutedText, fontSize: '11px', display: 'block', marginBottom: '6px' }}>
                                            Select Token
                                        </label>
                                        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '10px' }}>
                                            <label style={{ 
                                                display: 'flex', 
                                                alignItems: 'center', 
                                                gap: '6px',
                                                color: theme.colors.primaryText,
                                                fontSize: '13px',
                                                cursor: 'pointer',
                                            }}>
                                                <input 
                                                    type="radio" 
                                                    checked={!useCustomLedger} 
                                                    onChange={() => {
                                                        setUseCustomLedger(false);
                                                        setWithdrawTokenLedger(ICP_LEDGER_CANISTER_ID);
                                                    }}
                                                    style={{ margin: 0 }}
                                                />
                                                From list
                                            </label>
                                            <label style={{ 
                                                display: 'flex', 
                                                alignItems: 'center', 
                                                gap: '6px',
                                                color: theme.colors.primaryText,
                                                fontSize: '13px',
                                                cursor: 'pointer',
                                            }}>
                                                <input 
                                                    type="radio" 
                                                    checked={useCustomLedger} 
                                                    onChange={() => setUseCustomLedger(true)}
                                                    style={{ margin: 0 }}
                                                />
                                                Custom ledger
                                            </label>
                                        </div>
                                        
                                        {!useCustomLedger ? (
                                            <TokenSelector
                                                value={withdrawTokenLedger}
                                                onChange={(ledgerId) => setWithdrawTokenLedger(ledgerId)}
                                                placeholder="Select a token..."
                                            />
                                        ) : (
                                            <input
                                                type="text"
                                                value={customLedgerInput}
                                                onChange={(e) => setCustomLedgerInput(e.target.value)}
                                                style={inputStyle}
                                                placeholder="Enter ledger canister principal"
                                            />
                                        )}
                                    </div>
                                    
                                    {/* Token Balance */}
                                    <div style={{ 
                                        background: `${theme.colors.accent}10`, 
                                        padding: '10px', 
                                        borderRadius: '6px', 
                                        marginBottom: '12px',
                                        fontSize: '12px',
                                        color: theme.colors.mutedText,
                                    }}>
                                        Available: <strong style={{ color: theme.colors.primaryText }}>
                                            {withdrawTokenBalance !== null 
                                                ? `${(Number(withdrawTokenBalance) / Math.pow(10, withdrawTokenDecimals)).toFixed(withdrawTokenDecimals > 4 ? 4 : withdrawTokenDecimals)} ${withdrawTokenSymbol}`
                                                : 'Loading...'
                                            }
                                        </strong>
                                    </div>
                                    
                                    {/* Amount and Destination */}
                                    <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                                        <div style={{ flex: 1, minWidth: '120px' }}>
                                            <label style={{ color: theme.colors.mutedText, fontSize: '11px', display: 'block', marginBottom: '4px' }}>
                                                Amount ({withdrawTokenSymbol})
                                            </label>
                                            <input
                                                type="text"
                                                inputMode="decimal"
                                                value={withdrawAmount}
                                                onChange={(e) => setWithdrawAmount(e.target.value)}
                                                style={inputStyle}
                                                placeholder="Amount to withdraw"
                                            />
                                        </div>
                                        <div style={{ flex: 2, minWidth: '200px' }}>
                                            <label style={{ color: theme.colors.mutedText, fontSize: '11px', display: 'block', marginBottom: '4px' }}>
                                                Destination Principal
                                            </label>
                                            <input
                                                type="text"
                                                value={withdrawDestination}
                                                onChange={(e) => setWithdrawDestination(e.target.value)}
                                                style={inputStyle}
                                                placeholder="Principal ID"
                                            />
                                        </div>
                                        <button
                                            onClick={handleWithdrawToken}
                                            disabled={actionLoading === 'withdraw' || withdrawTokenBalance === null || withdrawTokenBalance === BigInt(0)}
                                            style={{ 
                                                ...buttonStyle, 
                                                opacity: (actionLoading === 'withdraw' || withdrawTokenBalance === null || withdrawTokenBalance === BigInt(0)) ? 0.6 : 1,
                                            }}
                                        >
                                            {actionLoading === 'withdraw' ? '⏳...' : '💸 Withdraw'}
                                        </button>
                                    </div>
                                    <p style={{ color: theme.colors.mutedText, fontSize: '11px', marginTop: '8px', marginBottom: 0 }}>
                                        Fee: {(withdrawTokenFee / Math.pow(10, withdrawTokenDecimals)).toFixed(withdrawTokenDecimals > 4 ? 4 : withdrawTokenDecimals)} {withdrawTokenSymbol}
                                    </p>
                                </div>
                            )}
                        </div>
                        )}
                        </>
                        )}

                        {/* Botkeys Tab - viewable by everyone, editable by ManagePermissions holders */}
                        {canisterActiveTab === 'permissions' && (
                        <div>
                            {/* Botkeys explanation */}
                            <div style={{
                                padding: '12px 14px',
                                backgroundColor: `${neuronPrimary}08`,
                                border: `1px solid ${neuronPrimary}20`,
                                borderRadius: '8px',
                                marginBottom: '16px',
                            }}>
                                <p style={{ color: theme.colors.secondaryText, fontSize: '13px', margin: '0 0 8px 0', lineHeight: '1.5' }}>
                                    <strong style={{ color: theme.colors.primaryText }}>Botkeys</strong> grant specific principals granular permissions to operate this Staking Bot canister without being a controller.
                                    Controllers always have full permissions implicitly.
                                </p>
                                <p style={{ color: theme.colors.mutedText, fontSize: '12px', margin: 0, lineHeight: '1.5' }}>
                                    <strong>Botkeys vs Neuron Hotkeys:</strong> Botkeys control who can <em>tell the bot what to do</em> — they are permissions on the bot canister itself. 
                                    Neuron hotkeys (managed per-neuron in the Neuron section below) are NNS-level keys added directly to the neuron on-chain. 
                                    Botkeys are more flexible because the bot defines its own fine-grained permission system.
                                </p>
                            </div>

                            {/* Loading state */}
                            {loadingPermissions && botkeysSupported === null && (
                                <div style={{ textAlign: 'center', padding: '2rem', color: theme.colors.mutedText }}>
                                    Loading botkeys...
                                </div>
                            )}

                            {/* Unsupported bot version */}
                            {botkeysSupported === false && (
                                <div style={{
                                    ...cardStyle,
                                    background: `linear-gradient(135deg, ${theme.colors.warning}10, ${theme.colors.warning}05)`,
                                    border: `1px solid ${theme.colors.warning || '#f59e0b'}30`,
                                    textAlign: 'center',
                                    padding: '2rem 1.5rem',
                                }}>
                                    <div style={{ fontSize: '2rem', marginBottom: '12px' }}>🔑</div>
                                    <h3 style={{ color: theme.colors.primaryText, margin: '0 0 8px 0', fontSize: '1rem', fontWeight: '600' }}>
                                        Botkeys Not Available
                                    </h3>
                                    <p style={{ color: theme.colors.secondaryText, fontSize: '13px', margin: '0 0 16px 0', lineHeight: '1.5' }}>
                                        This Staking Bot does not support botkeys. Botkeys require <strong>v0.9.1</strong> or newer.
                                        {managerInfo?.version && (
                                            <span> Your bot is currently running <strong>v{managerInfo.version}</strong>.</span>
                                        )}
                                    </p>
                                    {latestOfficialVersion && isController && (
                                        <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', flexWrap: 'wrap' }}>
                                            <button
                                                onClick={() => handleUpgrade(latestOfficialVersion, 'upgrade')}
                                                disabled={upgrading}
                                                style={{
                                                    background: theme.colors.accent,
                                                    color: '#fff',
                                                    border: 'none',
                                                    borderRadius: '8px',
                                                    padding: '10px 20px',
                                                    fontSize: '14px',
                                                    fontWeight: '600',
                                                    cursor: upgrading ? 'wait' : 'pointer',
                                                    opacity: upgrading ? 0.7 : 1,
                                                }}
                                            >
                                                {upgrading && upgradeMode === 'upgrade' 
                                                    ? '⏳ Upgrading...' 
                                                    : `⬆️ Upgrade to v${Number(latestOfficialVersion.major)}.${Number(latestOfficialVersion.minor)}.${Number(latestOfficialVersion.patch)}`}
                                            </button>
                                        </div>
                                    )}
                                    {upgradeError && (
                                        <div style={{ color: theme.colors.error, fontSize: '12px', marginTop: '10px' }}>
                                            {upgradeError}
                                        </div>
                                    )}
                                    {upgradeSuccess && (
                                        <div style={{ color: theme.colors.success, fontSize: '12px', marginTop: '10px' }}>
                                            {upgradeSuccess}
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Botkeys supported — show management UI */}
                            {botkeysSupported === true && (
                            <>
                            {/* Error/Success */}
                            {permissionError && (
                                <div style={{
                                    padding: '10px 14px',
                                    backgroundColor: `${theme.colors.error || '#ef4444'}15`,
                                    border: `1px solid ${theme.colors.error || '#ef4444'}40`,
                                    borderRadius: '8px',
                                    color: theme.colors.error || '#ef4444',
                                    fontSize: '13px',
                                    marginBottom: '16px',
                                }}>
                                    {permissionError}
                                </div>
                            )}
                            {permissionSuccess && (
                                <div style={{
                                    padding: '10px 14px',
                                    backgroundColor: `${theme.colors.success || '#22c55e'}15`,
                                    border: `1px solid ${theme.colors.success || '#22c55e'}40`,
                                    borderRadius: '8px',
                                    color: theme.colors.success || '#22c55e',
                                    fontSize: '13px',
                                    marginBottom: '16px',
                                }}>
                                    {permissionSuccess}
                                </div>
                            )}

                            {/* Current Botkey Principals */}
                            <div style={cardStyle}>
                                <h3 style={{ color: theme.colors.primaryText, margin: '0 0 12px 0', fontSize: '0.95rem', fontWeight: '600' }}>
                                    Botkey Principals ({hotkeyPrincipals.length})
                                </h3>
                                
                                {hotkeyPrincipals.length === 0 ? (
                                    <div style={{ 
                                        color: theme.colors.mutedText, 
                                        fontSize: '13px', 
                                        padding: '1.5rem',
                                        textAlign: 'center',
                                        background: theme.colors.tertiaryBg || theme.colors.secondaryBg,
                                        borderRadius: '8px',
                                    }}>
                                        No botkey principals configured.{hasPermission('ManagePermissions') ? ' Add one below.' : ''}
                                    </div>
                                ) : (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                        {hotkeyPrincipals.map((entry, idx) => {
                                            const principalStr = entry.principal.toString();
                                            const permKeys = entry.permissions.map(p => getPermissionKey(p));
                                            const isEditing = editingPrincipal === principalStr;
                                            const isConfirming = confirmRemoveHotkey === principalStr;
                                            
                                            return (
                                                <div key={idx} style={{
                                                    background: theme.colors.tertiaryBg || theme.colors.secondaryBg,
                                                    borderRadius: '8px',
                                                    padding: '12px',
                                                    border: `1px solid ${theme.colors.border}`,
                                                }}>
                                                    <div style={{ 
                                                        display: 'flex', 
                                                        justifyContent: 'space-between', 
                                                        alignItems: 'center',
                                                        marginBottom: isEditing ? '12px' : '6px',
                                                        flexWrap: 'wrap',
                                                        gap: '8px',
                                                    }}>
                                                        <div style={{ flex: 1, minWidth: '150px', overflow: 'hidden' }}>
                                                            <PrincipalDisplay
                                                                principal={principalStr}
                                                                displayInfo={getPrincipalDisplayInfoFromContext(principalStr, principalNames, principalNicknames)}
                                                                showCopyButton={true}
                                                                isAuthenticated={isAuthenticated}
                                                                short={false}
                                                                noLink={false}
                                                            />
                                                        </div>
                                                        {hasPermission('ManagePermissions') && (
                                                        <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                                                            {!isEditing && (
                                                                <button
                                                                    onClick={() => {
                                                                        setEditingPrincipal(principalStr);
                                                                        const perms = {};
                                                                        permKeys.forEach(k => { perms[k] = true; });
                                                                        setEditPermissions(perms);
                                                                        setPermissionError('');
                                                                        setPermissionSuccess('');
                                                                    }}
                                                                    style={{ ...secondaryButtonStyle, padding: '4px 10px', fontSize: '11px' }}
                                                                >
                                                                    Edit
                                                                </button>
                                                            )}
                                                            {isConfirming ? (
                                                                <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                                                                    <span style={{ color: theme.colors.error, fontSize: '11px' }}>Remove?</span>
                                                                    <button
                                                                        onClick={() => handleRemoveHotkeyPrincipal(principalStr)}
                                                                        disabled={savingPermissions}
                                                                        style={{
                                                                            backgroundColor: theme.colors.error || '#ef4444',
                                                                            color: '#fff',
                                                                            border: 'none',
                                                                            borderRadius: '4px',
                                                                            padding: '3px 8px',
                                                                            fontSize: '11px',
                                                                            cursor: savingPermissions ? 'wait' : 'pointer',
                                                                            opacity: savingPermissions ? 0.7 : 1,
                                                                        }}
                                                                    >
                                                                        {savingPermissions ? '...' : 'Yes'}
                                                                    </button>
                                                                    <button
                                                                        onClick={() => setConfirmRemoveHotkey(null)}
                                                                        style={{ ...secondaryButtonStyle, padding: '3px 8px', fontSize: '11px' }}
                                                                    >
                                                                        No
                                                                    </button>
                                                                </div>
                                                            ) : (
                                                                <button
                                                                    onClick={() => { setConfirmRemoveHotkey(principalStr); setPermissionError(''); setPermissionSuccess(''); }}
                                                                    style={{
                                                                        backgroundColor: 'transparent',
                                                                        color: theme.colors.error || '#ef4444',
                                                                        border: `1px solid ${theme.colors.error || '#ef4444'}`,
                                                                        borderRadius: '4px',
                                                                        padding: '4px 10px',
                                                                        fontSize: '11px',
                                                                        cursor: 'pointer',
                                                                    }}
                                                                >
                                                                    Remove
                                                                </button>
                                                            )}
                                                        </div>
                                                        )}
                                                    </div>
                                                    
                                                    {isEditing ? (
                                                        /* Edit mode: show checkboxes */
                                                        <div>
                                                            <div style={{ 
                                                                display: 'grid', 
                                                                gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
                                                                gap: '6px',
                                                                marginBottom: '12px',
                                                            }}>
                                                                {permissionTypes.map(([id, perm]) => {
                                                                    const key = getPermissionKey(perm);
                                                                    return (
                                                                        <label key={Number(id)} style={{
                                                                            display: 'flex',
                                                                            alignItems: 'flex-start',
                                                                            gap: '6px',
                                                                            cursor: 'pointer',
                                                                            padding: '4px 6px',
                                                                            borderRadius: '4px',
                                                                            fontSize: '12px',
                                                                            color: theme.colors.primaryText,
                                                                            background: editPermissions[key] ? `${neuronPrimary}10` : 'transparent',
                                                                        }}>
                                                                            <input
                                                                                type="checkbox"
                                                                                checked={!!editPermissions[key]}
                                                                                onChange={(e) => setEditPermissions(prev => ({ ...prev, [key]: e.target.checked }))}
                                                                                style={{ margin: '2px 0 0 0', flexShrink: 0 }}
                                                                            />
                                                                            <span>
                                                                                <span style={{ fontWeight: '500' }}>{getPermissionLabel(key)}</span>
                                                                            </span>
                                                                        </label>
                                                                    );
                                                                })}
                                                            </div>
                                                            <div style={{ display: 'flex', gap: '8px' }}>
                                                                <button
                                                                    onClick={() => handleUpdateHotkeyPermissions(principalStr)}
                                                                    disabled={savingPermissions}
                                                                    style={{
                                                                        ...buttonStyle,
                                                                        padding: '6px 16px',
                                                                        fontSize: '12px',
                                                                        opacity: savingPermissions ? 0.7 : 1,
                                                                    }}
                                                                >
                                                                    {savingPermissions ? 'Saving...' : 'Save'}
                                                                </button>
                                                                <button
                                                                    onClick={() => setEditingPrincipal(null)}
                                                                    style={{ ...secondaryButtonStyle, padding: '6px 16px', fontSize: '12px' }}
                                                                >
                                                                    Cancel
                                                                </button>
                                                            </div>
                                                        </div>
                                                    ) : (
                                                        /* View mode: show permission badges */
                                                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                                                            {permKeys.map(key => (
                                                                <span key={key} title={getPermissionDescription(key)} style={{
                                                                    padding: '2px 8px',
                                                                    borderRadius: '4px',
                                                                    fontSize: '11px',
                                                                    fontWeight: '500',
                                                                    backgroundColor: `${neuronPrimary}15`,
                                                                    color: neuronPrimary,
                                                                    border: `1px solid ${neuronPrimary}25`,
                                                                }}>
                                                                    {getPermissionLabel(key)}
                                                                </span>
                                                            ))}
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>

                            {/* Add New Botkey Principal - only for ManagePermissions holders */}
                            {hasPermission('ManagePermissions') && (
                            <div style={cardStyle}>
                                <h3 style={{ color: theme.colors.primaryText, margin: '0 0 12px 0', fontSize: '0.95rem', fontWeight: '600' }}>
                                    Add Botkey Principal
                                </h3>
                                <div style={{ marginBottom: '12px' }}>
                                    <label style={{ color: theme.colors.mutedText, fontSize: '11px', display: 'block', marginBottom: '4px' }}>
                                        Principal ID
                                    </label>
                                    <PrincipalInput
                                        value={newHotkeyPrincipal}
                                        onChange={setNewHotkeyPrincipal}
                                        placeholder="Enter principal ID or search by name"
                                        defaultTab="private"
                                        defaultPrincipalType="both"
                                        disabled={savingPermissions}
                                    />
                                </div>
                                <div style={{ marginBottom: '12px' }}>
                                    <label style={{ color: theme.colors.mutedText, fontSize: '11px', display: 'block', marginBottom: '8px' }}>
                                        Permissions
                                    </label>
                                    <div style={{ 
                                        display: 'grid', 
                                        gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
                                        gap: '6px',
                                    }}>
                                        {permissionTypes.map(([id, perm]) => {
                                            const key = getPermissionKey(perm);
                                            return (
                                                <label key={Number(id)} style={{
                                                    display: 'flex',
                                                    alignItems: 'flex-start',
                                                    gap: '6px',
                                                    cursor: 'pointer',
                                                    padding: '6px 8px',
                                                    borderRadius: '6px',
                                                    fontSize: '12px',
                                                    color: theme.colors.primaryText,
                                                    background: newHotkeyPermissions[key] ? `${neuronPrimary}10` : theme.colors.tertiaryBg || theme.colors.secondaryBg,
                                                    border: `1px solid ${newHotkeyPermissions[key] ? neuronPrimary + '30' : theme.colors.border}`,
                                                    transition: 'all 0.15s',
                                                }}>
                                                    <input
                                                        type="checkbox"
                                                        checked={!!newHotkeyPermissions[key]}
                                                        onChange={(e) => setNewHotkeyPermissions(prev => ({ ...prev, [key]: e.target.checked }))}
                                                        style={{ margin: '2px 0 0 0', flexShrink: 0 }}
                                                    />
                                                    <span>
                                                        <span style={{ fontWeight: '500', display: 'block' }}>{getPermissionLabel(key)}</span>
                                                        <span style={{ color: theme.colors.mutedText, fontSize: '11px' }}>{getPermissionDescription(key)}</span>
                                                    </span>
                                                </label>
                                            );
                                        })}
                                    </div>
                                </div>
                                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                                    <button
                                        onClick={handleAddHotkeyPrincipal}
                                        disabled={savingPermissions || !newHotkeyPrincipal.trim()}
                                        style={{
                                            ...buttonStyle,
                                            opacity: (savingPermissions || !newHotkeyPrincipal.trim()) ? 0.6 : 1,
                                        }}
                                    >
                                        {savingPermissions ? '⏳ Adding...' : 'Add Botkey Principal'}
                                    </button>
                                    <button
                                        onClick={() => {
                                            const allPerms = {};
                                            permissionTypes.forEach(([_, perm]) => { allPerms[getPermissionKey(perm)] = true; });
                                            setNewHotkeyPermissions(allPerms);
                                        }}
                                        style={{ ...secondaryButtonStyle, padding: '0.5rem 1rem', fontSize: '0.85rem' }}
                                    >
                                        Select All
                                    </button>
                                    <button
                                        onClick={() => setNewHotkeyPermissions({})}
                                        style={{ ...secondaryButtonStyle, padding: '0.5rem 1rem', fontSize: '0.85rem' }}
                                    >
                                        Clear All
                                    </button>
                                </div>
                                <p style={{ 
                                    color: theme.colors.mutedText, 
                                    fontSize: '11px',
                                    marginTop: '10px',
                                    marginBottom: 0,
                                    lineHeight: '1.5',
                                }}>
                                    Botkey principals can perform the selected operations without being a canister controller. 
                                    The "Manage Permissions" permission allows a principal to manage other principals' permissions.
                                </p>
                            </div>
                            )}
                            </>
                            )}
                        </div>
                        )}

                        {/* Chores Tab */}
                        {canisterActiveTab === 'chores' && (
                        <div>
                            {loadingChores ? (
                                <div style={{ textAlign: 'center', padding: '2rem', color: theme.colors.secondaryText }}>
                                    Loading chore data...
                                </div>
                            ) : (
                            <>
                            {/* Chore explanation */}
                            <div style={{
                                ...cardStyle,
                                background: `linear-gradient(135deg, ${neuronPrimary}08, ${neuronSecondary}05)`,
                                border: `1px solid ${neuronPrimary}20`,
                            }}>
                                <p style={{ margin: 0, fontSize: '0.85rem', color: theme.colors.secondaryText, lineHeight: '1.5' }}>
                                    Bot Chores are automated tasks that run on a schedule. Enable a chore and set its interval — the bot handles the rest.
                                </p>
                            </div>

                            {choreError && (
                                <div style={{ ...cardStyle, background: `${theme.colors.error}15`, border: `1px solid ${theme.colors.error}30`, color: theme.colors.error, fontSize: '0.85rem' }}>
                                    {choreError}
                                </div>
                            )}
                            {choreSuccess && (
                                <div style={{ ...cardStyle, background: `${theme.colors.success || '#22c55e'}15`, border: `1px solid ${theme.colors.success || '#22c55e'}30`, color: theme.colors.success || '#22c55e', fontSize: '0.85rem' }}>
                                    {choreSuccess}
                                </div>
                            )}

                            {/* Upcoming chore schedule overview */}
                            {choreStatuses.length > 0 && (() => {
                                // Collect all scheduled chores with a future nextScheduledRunAt
                                const nowMs = Date.now();
                                const upcoming = choreStatuses
                                    .filter(c => c.enabled && c.nextScheduledRunAt?.length > 0)
                                    .map(c => {
                                        const ns = Number(c.nextScheduledRunAt[0]);
                                        const ms = ns / 1_000_000;
                                        const isRunning = !('Idle' in c.conductorStatus);
                                        return { ...c, _ms: ms, _isRunning: isRunning };
                                    })
                                    .sort((a, b) => {
                                        // Running chores first, then by time
                                        if (a._isRunning !== b._isRunning) return a._isRunning ? -1 : 1;
                                        return a._ms - b._ms;
                                    });
                                if (upcoming.length === 0) return null;

                                const formatRelative = (ms) => {
                                    const diff = ms - nowMs;
                                    if (diff < 0) return 'overdue';
                                    if (diff < 60_000) return 'in <1 min';
                                    if (diff < 3600_000) return `in ${Math.round(diff / 60_000)} min`;
                                    if (diff < 86400_000) {
                                        const hrs = Math.floor(diff / 3600_000);
                                        const mins = Math.round((diff % 3600_000) / 60_000);
                                        return mins > 0 ? `in ${hrs}h ${mins}m` : `in ${hrs}h`;
                                    }
                                    const days = Math.floor(diff / 86400_000);
                                    const hrs = Math.round((diff % 86400_000) / 3600_000);
                                    return hrs > 0 ? `in ${days}d ${hrs}h` : `in ${days}d`;
                                };

                                const label = (c) => {
                                    // Use instanceLabel if it differs from choreName, otherwise just choreName
                                    if (c.instanceLabel && c.instanceLabel !== c.choreName && c.instanceLabel !== c.choreId) {
                                        return `${c.choreName} — ${c.instanceLabel}`;
                                    }
                                    return c.choreName;
                                };

                                return (
                                    <div style={{
                                        display: 'flex',
                                        flexWrap: 'wrap',
                                        gap: '8px 16px',
                                        padding: '10px 14px',
                                        marginBottom: '12px',
                                        background: theme.colors.primaryBg,
                                        borderRadius: '8px',
                                        border: `1px solid ${theme.colors.border}`,
                                        fontSize: '0.75rem',
                                        color: theme.colors.secondaryText,
                                        alignItems: 'center',
                                    }}>
                                        <span style={{ fontWeight: '600', color: theme.colors.primaryText, fontSize: '0.75rem', marginRight: '2px' }}>
                                            Schedule
                                        </span>
                                        {upcoming.map(c => {
                                            const isPast = c._ms <= nowMs;
                                            const relTime = c._isRunning ? 'running' : formatRelative(c._ms);
                                            const dotColor = c._isRunning
                                                ? (theme.colors.success || '#22c55e')
                                                : c.paused
                                                    ? (theme.colors.warning || '#f59e0b')
                                                    : isPast
                                                        ? (theme.colors.error || '#ef4444')
                                                        : (theme.colors.accent || '#3b82f6');
                                            return (
                                                <span
                                                    key={c.choreId}
                                                    style={{
                                                        display: 'inline-flex',
                                                        alignItems: 'center',
                                                        gap: '5px',
                                                        cursor: 'pointer',
                                                        padding: '2px 0',
                                                    }}
                                                    title={`${label(c)}\n${c._isRunning ? 'Currently running' : new Date(c._ms).toLocaleString()}${c.paused ? ' (paused)' : ''}`}
                                                    onClick={() => {
                                                        setChoreActiveTab(c.choreTypeId || c.choreId);
                                                        setChoreActiveInstance(c.choreId);
                                                    }}
                                                >
                                                    <span style={{
                                                        width: '6px', height: '6px', borderRadius: '50%',
                                                        background: dotColor,
                                                        flexShrink: 0,
                                                        ...(c._isRunning ? { animation: 'pulse 1.5s ease-in-out infinite' } : {}),
                                                    }} />
                                                    <span style={{ color: theme.colors.primaryText, fontWeight: '500' }}>
                                                        {label(c)}
                                                    </span>
                                                    <span style={{
                                                        color: c._isRunning
                                                            ? (theme.colors.success || '#22c55e')
                                                            : isPast
                                                                ? (theme.colors.error || '#ef4444')
                                                                : theme.colors.mutedText,
                                                        fontStyle: c._isRunning ? 'italic' : 'normal',
                                                    }}>
                                                        {relTime}
                                                    </span>
                                                </span>
                                            );
                                        })}
                                    </div>
                                );
                            })()}

                            {/* Sub-tabs for each chore type (grouped by typeId) */}
                            {choreStatuses.length > 0 && (() => {
                                // Group chore instances by type
                                const choreTypeMap = {};
                                const choreTypeOrder = [];
                                choreStatuses.forEach(chore => {
                                    const tid = chore.choreTypeId || chore.choreId;
                                    if (!choreTypeMap[tid]) {
                                        choreTypeMap[tid] = { typeId: tid, typeName: chore.choreName, typeDesc: chore.choreDescription, instances: [] };
                                        choreTypeOrder.push(tid);
                                    }
                                    choreTypeMap[tid].instances.push(chore);
                                });
                                // Ensure active tab is valid
                                const activeTypeId = choreTypeMap[choreActiveTab] ? choreActiveTab : choreTypeOrder[0];
                                const activeType = choreTypeMap[activeTypeId];
                                const instances = activeType?.instances || [];
                                // Determine active instance
                                const activeInstanceId = choreActiveInstance && instances.find(i => i.choreId === choreActiveInstance)
                                    ? choreActiveInstance
                                    : instances[0]?.choreId;
                                const activeChore = instances.find(i => i.choreId === activeInstanceId);
                                const hasMultiple = instances.length > 1;

                                return (
                            <>
                            {/* Type-level tabs */}
                            <div style={{ display: 'flex', flexWrap: 'wrap', marginBottom: hasMultiple ? '0' : '12px', gap: '0' }}>
                                {choreTypeOrder.map(tid => {
                                    const type = choreTypeMap[tid];
                                    // Summary lamp: worst of all instances of this type
                                    const typeWorstLamp = type.instances.reduce((worst, inst) => {
                                        const lamp = getChoreSummaryLamp(inst);
                                        const priority = { error: 4, warning: 3, running: 2, ok: 1, off: 0 };
                                        return (priority[lamp] || 0) > (priority[worst] || 0) ? lamp : worst;
                                    }, 'off');
                                    const count = type.instances.length;
                                    return (
                                        <button
                                            key={tid}
                                            style={{
                                                ...tabStyle(activeTypeId === tid),
                                                fontSize: '0.8rem',
                                                padding: '0.45rem 0.8rem',
                                                display: 'inline-flex',
                                                alignItems: 'center',
                                                gap: '6px',
                                            }}
                                            onClick={() => { setChoreActiveTab(tid); setChoreActiveInstance(null); }}
                                        >
                                            <StatusLamp state={typeWorstLamp} size={8} label={getSummaryLabel(typeWorstLamp, type.typeName)} />
                                            {type.typeName}{count > 1 ? ` (${count})` : ''}
                                        </button>
                                    );
                                })}
                            </div>

                            {/* Instance sub-tabs (only when type has multiple instances) */}
                            {hasMultiple && (
                            <div style={{ display: 'flex', flexWrap: 'wrap', marginBottom: '12px', gap: '0', paddingLeft: '8px', borderLeft: `2px solid ${neuronPrimary}30` }}>
                                {instances.map(inst => {
                                    const instLamp = getChoreSummaryLamp(inst);
                                    return (
                                        <button
                                            key={inst.choreId}
                                            style={{
                                                ...tabStyle(activeInstanceId === inst.choreId),
                                                fontSize: '0.75rem',
                                                padding: '0.35rem 0.7rem',
                                                display: 'inline-flex',
                                                alignItems: 'center',
                                                gap: '5px',
                                            }}
                                            onClick={() => setChoreActiveInstance(inst.choreId)}
                                        >
                                            <StatusLamp state={instLamp} size={7} />
                                            {inst.instanceLabel || inst.choreName}
                                        </button>
                                    );
                                })}
                                {/* + button to add instance */}
                                <button
                                    style={{
                                        ...tabStyle(false),
                                        fontSize: '0.75rem',
                                        padding: '0.35rem 0.7rem',
                                        color: neuronPrimary,
                                        fontWeight: '700',
                                    }}
                                    onClick={() => { setCreatingInstance(true); setNewInstanceLabel(''); }}
                                    title="Add another instance of this chore"
                                >
                                    +
                                </button>
                            </div>
                            )}

                            {/* Single-instance type: show + button inline if it's a multi-capable type */}
                            {!hasMultiple && ['distribute-funds', 'collect-maturity'].includes(activeTypeId) && (
                            <div style={{ marginBottom: '8px' }}>
                                <button
                                    style={{
                                        ...buttonStyle,
                                        fontSize: '0.75rem',
                                        background: `${neuronPrimary}10`,
                                        color: neuronPrimary,
                                        border: `1px solid ${neuronPrimary}25`,
                                        padding: '4px 10px',
                                    }}
                                    onClick={() => { setCreatingInstance(true); setNewInstanceLabel(''); }}
                                >
                                    + Add another {activeType?.typeName}
                                </button>
                            </div>
                            )}

                            {/* Create instance dialog */}
                            {creatingInstance && (
                            <div style={{ ...cardStyle, background: `${neuronPrimary}08`, border: `1px solid ${neuronPrimary}25`, marginBottom: '12px' }}>
                                <div style={{ fontSize: '0.85rem', fontWeight: '600', color: theme.colors.primaryText, marginBottom: '8px' }}>
                                    New {activeType?.typeName} Instance
                                </div>
                                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                                    <input
                                        type="text"
                                        value={newInstanceLabel}
                                        onChange={e => setNewInstanceLabel(e.target.value)}
                                        placeholder="Instance name (e.g., ETH Distribution)"
                                        style={{ ...inputStyle, flex: 1, minWidth: '180px' }}
                                        autoFocus
                                    />
                                    <button
                                        style={{ ...buttonStyle, background: neuronPrimary, color: '#fff', border: 'none', opacity: !newInstanceLabel.trim() || savingChore ? 0.5 : 1 }}
                                        disabled={!newInstanceLabel.trim() || savingChore}
                                        onClick={async () => {
                                            setSavingChore(true);
                                            setChoreError('');
                                            try {
                                                const agent = getAgent();
                                                if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                                                    await agent.fetchRootKey();
                                                }
                                                const manager = createManagerActor(canisterId, { agent });
                                                const instId = activeTypeId + '-' + Date.now().toString(36);
                                                const ok = await manager.createChoreInstance(activeTypeId, instId, newInstanceLabel.trim());
                                                if (ok) {
                                                    setChoreSuccess(`Created "${newInstanceLabel.trim()}"`);
                                                    setCreatingInstance(false);
                                                    setChoreActiveInstance(instId);
                                                    await loadChoreData();
                                                } else {
                                                    setChoreError('Failed to create instance.');
                                                }
                                            } catch (err) {
                                                setChoreError('Error creating instance: ' + err.message);
                                            } finally { setSavingChore(false); }
                                        }}
                                    >
                                        Create
                                    </button>
                                    <button
                                        style={{ ...buttonStyle, background: 'transparent', color: theme.colors.mutedText, border: `1px solid ${theme.colors.border}` }}
                                        onClick={() => setCreatingInstance(false)}
                                    >
                                        Cancel
                                    </button>
                                </div>
                            </div>
                            )}

                            {/* Render the active chore instance's panel */}
                            {activeChore && (() => {
                                const chore = activeChore;
                                const configEntry = choreConfigs.find(([id]) => id === chore.choreId);
                                const config = configEntry ? configEntry[1] : null;

                                // Format interval for display — supports minutes, hours, and days
                                const intervalSeconds = config ? Number(config.intervalSeconds) : 0;
                                const maxIntervalSeconds = config?.maxIntervalSeconds?.[0] != null ? Number(config.maxIntervalSeconds[0]) : null;
                                const formatIntervalDisplay = (secs) => {
                                    if (secs <= 0) return '0';
                                    if (secs < 3600) return `${Math.round(secs / 60)} min`;
                                    if (secs < 86400) {
                                        const h = secs / 3600;
                                        return Number.isInteger(h) ? `${h} hr` : `${h.toFixed(1)} hr`;
                                    }
                                    const d = secs / 86400;
                                    return Number.isInteger(d) ? `${d} days` : `${d.toFixed(1)} days`;
                                };
                                // (intervalDays/maxIntervalDays removed — interval section now works in seconds with unit selection)

                                // Lamp states for each timer level
                                const schedulerLamp = getSchedulerLampState(chore);
                                const conductorLamp = getConductorLampState(chore);
                                const taskLamp = getTaskLampState(chore);

                                // Text labels (derived from lamp data)
                                const schedulerLabel = schedulerLamp.label;
                                const conductorLabel = conductorLamp.label;
                                const taskLabel = taskLamp.label;

                                // Format timestamp
                                const formatTime = (nsOpt) => {
                                    if (!nsOpt || nsOpt.length === 0) return '—';
                                    const ns = nsOpt[0];
                                    const ms = Number(ns) / 1_000_000;
                                    if (ms <= 0) return '—';
                                    return new Date(ms).toLocaleString();
                                };

                                const isRunning = !('Idle' in chore.conductorStatus);
                                const isEnabled = chore.enabled;
                                const isPaused = chore.paused;
                                const isStopped = !isEnabled;

                                return (
                                    <div key={chore.choreId}>
                                        {/* Description */}
                                        <div style={{
                                            ...cardStyle,
                                            background: `linear-gradient(135deg, ${neuronPrimary}06, ${neuronSecondary}04)`,
                                            border: `1px solid ${neuronPrimary}15`,
                                        }}>
                                            <p style={{ margin: 0, fontSize: '0.85rem', color: theme.colors.secondaryText, lineHeight: '1.5' }}>
                                                {chore.choreDescription}
                                            </p>
                                        </div>

                                        {/* Status Card */}
                                        <div style={cardStyle}>
                                            <h3 style={{ color: theme.colors.primaryText, margin: '0 0 12px 0', fontSize: '0.95rem', fontWeight: '600' }}>
                                                Status
                                            </h3>
                                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '10px' }}>
                                                <div style={{ padding: '10px', background: theme.colors.primaryBg, borderRadius: '8px', border: `1px solid ${theme.colors.border}` }}>
                                                    <div style={{ fontSize: '0.75rem', color: theme.colors.secondaryText, marginBottom: '4px' }}>State</div>
                                                    <div style={{ fontSize: '0.9rem', fontWeight: '600', color: isStopped ? theme.colors.secondaryText : isPaused ? '#f59e0b' : (theme.colors.success || '#22c55e') }}>
                                                        {isStopped ? 'Stopped' : isPaused ? 'Paused' : 'Running'}
                                                    </div>
                                                </div>
                                                <div style={{ padding: '10px', background: theme.colors.primaryBg, borderRadius: '8px', border: `1px solid ${theme.colors.border}` }}>
                                                    <div style={{ fontSize: '0.75rem', color: theme.colors.secondaryText, marginBottom: '4px' }}>Scheduler</div>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                        <StatusLamp state={schedulerLamp.state} size={10} label={schedulerLamp.label} />
                                                        <span style={{ fontSize: '0.9rem', color: LAMP_COLORS[schedulerLamp.state], fontWeight: '500' }}>{schedulerLabel}</span>
                                                    </div>
                                                </div>
                                                <div style={{ padding: '10px', background: theme.colors.primaryBg, borderRadius: '8px', border: `1px solid ${theme.colors.border}` }}>
                                                    <div style={{ fontSize: '0.75rem', color: theme.colors.secondaryText, marginBottom: '4px' }}>Conductor</div>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                        <StatusLamp state={conductorLamp.state} size={10} label={conductorLamp.label} />
                                                        <span style={{ fontSize: '0.9rem', color: LAMP_COLORS[conductorLamp.state], fontWeight: '500' }}>{conductorLabel}</span>
                                                    </div>
                                                </div>
                                                <div style={{ padding: '10px', background: theme.colors.primaryBg, borderRadius: '8px', border: `1px solid ${theme.colors.border}` }}>
                                                    <div style={{ fontSize: '0.75rem', color: theme.colors.secondaryText, marginBottom: '4px' }}>Task</div>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                        <StatusLamp state={taskLamp.state} size={10} label={taskLamp.label} />
                                                        <span style={{ fontSize: '0.9rem', color: LAMP_COLORS[taskLamp.state], fontWeight: '500' }}>{taskLabel}</span>
                                                    </div>
                                                </div>
                                                <div style={{ padding: '10px', background: theme.colors.primaryBg, borderRadius: '8px', border: `1px solid ${theme.colors.border}` }}>
                                                    <div style={{ fontSize: '0.75rem', color: theme.colors.secondaryText, marginBottom: '4px' }}>Interval</div>
                                                    <div style={{ fontSize: '0.9rem', color: theme.colors.primaryText, fontWeight: '500' }}>
                                                        {maxIntervalSeconds && maxIntervalSeconds > intervalSeconds
                                                            ? `${formatIntervalDisplay(intervalSeconds)}–${formatIntervalDisplay(maxIntervalSeconds)}`
                                                            : formatIntervalDisplay(intervalSeconds)}
                                                    </div>
                                                </div>
                                                <div style={{ padding: '10px', background: theme.colors.primaryBg, borderRadius: '8px', border: `1px solid ${theme.colors.border}` }}>
                                                    <div style={{ fontSize: '0.75rem', color: theme.colors.secondaryText, marginBottom: '4px' }}>Next Scheduled Run</div>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                                                        <div style={{ fontSize: '0.85rem', color: theme.colors.primaryText, fontWeight: '500' }}>{formatTime(chore.nextScheduledRunAt)}</div>
                                                        {chore.enabled && (
                                                            <button
                                                                style={{ background: 'none', border: `1px solid ${theme.colors.border}`, borderRadius: '4px', fontSize: '0.65rem', color: theme.colors.secondaryText, cursor: 'pointer', padding: '2px 6px' }}
                                                                title="Set next scheduled run time"
                                                                onClick={() => {
                                                                    const el = document.getElementById(`next-run-picker-${chore.choreId}`);
                                                                    if (el) { el.style.display = el.style.display === 'none' ? 'flex' : 'none'; }
                                                                }}
                                                            >Set</button>
                                                        )}
                                                    </div>
                                                    {chore.enabled && (
                                                        <div id={`next-run-picker-${chore.choreId}`} style={{ display: 'none', marginTop: '6px', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
                                                            <input
                                                                type="datetime-local"
                                                                id={`next-run-input-${chore.choreId}`}
                                                                style={{ ...inputStyle, fontSize: '0.75rem', width: '200px' }}
                                                                defaultValue={(() => {
                                                                    const ns = chore.nextScheduledRunAt?.length > 0 ? Number(chore.nextScheduledRunAt[0]) : Date.now() * 1_000_000;
                                                                    const d = new Date(ns / 1_000_000);
                                                                    // Use local time components (datetime-local inputs are timezone-unaware)
                                                                    const pad = (n) => String(n).padStart(2, '0');
                                                                    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
                                                                })()}
                                                            />
                                                            <button
                                                                style={{ ...buttonStyle, fontSize: '0.7rem', padding: '4px 10px', background: `${neuronPrimary}10`, color: neuronPrimary, border: `1px solid ${neuronPrimary}25` }}
                                                                disabled={savingChore}
                                                                onClick={async () => {
                                                                    const input = document.getElementById(`next-run-input-${chore.choreId}`);
                                                                    if (!input?.value) return;
                                                                    const tsNanos = BigInt(new Date(input.value).getTime()) * 1_000_000n;
                                                                    setSavingChore(true);
                                                                    setChoreError('');
                                                                    try {
                                                                        const agent = getAgent();
                                                                        if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') await agent.fetchRootKey();
                                                                        const manager = createManagerActor(canisterId, { agent });
                                                                        await manager.setChoreNextRun(chore.choreId, tsNanos);
                                                                        // Optimistically update the displayed time immediately,
                                                                        // then verify with a background refresh.
                                                                        setChoreStatuses(prev => prev.map(s =>
                                                                            s.choreId === chore.choreId
                                                                                ? { ...s, nextScheduledRunAt: [tsNanos] }
                                                                                : s
                                                                        ));
                                                                        setChoreSuccess('Next run time updated.');
                                                                        const el = document.getElementById(`next-run-picker-${chore.choreId}`);
                                                                        if (el) el.style.display = 'none';
                                                                        // Verify: re-fetch after a short delay and warn if mismatch
                                                                        setTimeout(async () => {
                                                                            try {
                                                                                const vAgent = getAgent();
                                                                                if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') await vAgent.fetchRootKey();
                                                                                const vManager = createManagerActor(canisterId, { agent: vAgent });
                                                                                const statuses = await vManager.getChoreStatuses();
                                                                                const saved = statuses.find(s => s.choreId === chore.choreId);
                                                                                if (saved) {
                                                                                    const savedNs = saved.nextScheduledRunAt?.length > 0 ? saved.nextScheduledRunAt[0] : null;
                                                                                    if (savedNs == null || (savedNs !== tsNanos && BigInt(savedNs) !== tsNanos)) {
                                                                                        console.warn('setChoreNextRun verification: expected', tsNanos.toString(), 'got', savedNs?.toString());
                                                                                        setChoreError('Warning: the backend may not have saved the new time (expected ' + tsNanos.toString() + ', got ' + (savedNs?.toString() || 'null') + '). Try upgrading the canister to the latest version.');
                                                                                    }
                                                                                }
                                                                                setChoreStatuses(statuses);
                                                                            } catch (e) {
                                                                                console.warn('Verification fetch failed:', e);
                                                                            }
                                                                        }, 2500);
                                                                    } catch (err) {
                                                                        setChoreError('Failed to set next run: ' + err.message);
                                                                    } finally {
                                                                        setSavingChore(false);
                                                                    }
                                                                }}
                                                            >Save</button>
                                                        </div>
                                                    )}
                                                </div>
                                                <div style={{ padding: '10px', background: theme.colors.primaryBg, borderRadius: '8px', border: `1px solid ${theme.colors.border}` }}>
                                                    <div style={{ fontSize: '0.75rem', color: theme.colors.secondaryText, marginBottom: '4px' }}>Last Completed</div>
                                                    <div style={{ fontSize: '0.85rem', color: theme.colors.primaryText, fontWeight: '500' }}>{formatTime(chore.lastCompletedRunAt)}</div>
                                                </div>
                                                <div style={{ padding: '10px', background: theme.colors.primaryBg, borderRadius: '8px', border: `1px solid ${theme.colors.border}` }}>
                                                    <div style={{ fontSize: '0.75rem', color: theme.colors.secondaryText, marginBottom: '4px' }}>Runs (Success / Fail)</div>
                                                    <div style={{ fontSize: '0.9rem', color: theme.colors.primaryText, fontWeight: '500' }}>
                                                        {Number(chore.totalSuccessCount)} / {Number(chore.totalFailureCount)}
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Last error display */}
                                            {chore.lastError && chore.lastError.length > 0 && (
                                                <div style={{
                                                    marginTop: '10px',
                                                    padding: '10px',
                                                    background: `${theme.colors.error}10`,
                                                    border: `1px solid ${theme.colors.error}25`,
                                                    borderRadius: '8px',
                                                    fontSize: '0.8rem',
                                                    color: theme.colors.error,
                                                }}>
                                                    <strong>Last error:</strong> {chore.lastError[0]}
                                                    {chore.lastErrorAt && chore.lastErrorAt.length > 0 && (
                                                        <span style={{ opacity: 0.7 }}> ({formatTime(chore.lastErrorAt)})</span>
                                                    )}
                                                </div>
                                            )}

                                            {/* Current task info (when running) */}
                                            {chore.currentTaskId && chore.currentTaskId.length > 0 && (
                                                <div style={{
                                                    marginTop: '10px',
                                                    padding: '10px',
                                                    background: `${neuronPrimary}10`,
                                                    border: `1px solid ${neuronPrimary}25`,
                                                    borderRadius: '8px',
                                                    fontSize: '0.8rem',
                                                    color: theme.colors.primaryText,
                                                }}>
                                                    <strong>Current task:</strong> {chore.currentTaskId[0]}
                                                    {chore.taskStartedAt && chore.taskStartedAt.length > 0 && (
                                                        <span style={{ opacity: 0.7 }}> (started {formatTime(chore.taskStartedAt)})</span>
                                                    )}
                                                </div>
                                            )}
                                        </div>

                                        {/* Controls Card */}
                                        {(canManageChore(chore.choreId) || ((chore.choreTypeId || chore.choreId) === 'collect-maturity' && hasPermission('ConfigureCollectMaturity')) || ((chore.choreTypeId || chore.choreId) === 'distribute-funds' && hasPermission('ConfigureDistribution'))) && (
                                        <div style={cardStyle}>
                                            <h3 style={{ color: theme.colors.primaryText, margin: '0 0 12px 0', fontSize: '0.95rem', fontWeight: '600' }}>
                                                Controls
                                            </h3>
                                            {canManageChore(chore.choreId) && (
                                            <>
                                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '16px' }}>
                                                {/* Start (split button) — shown when Stopped */}
                                                {isStopped && (
                                                <div style={{ display: 'inline-flex', position: 'relative' }}>
                                                    <button
                                                        style={{
                                                            ...buttonStyle,
                                                            background: `linear-gradient(135deg, ${neuronPrimary}, ${neuronSecondary})`,
                                                            color: '#fff',
                                                            border: 'none',
                                                            borderRadius: '8px 0 0 8px',
                                                            opacity: savingChore ? 0.6 : 1,
                                                        }}
                                                        disabled={savingChore}
                                                        onClick={async () => {
                                                            setSavingChore(true);
                                                            setChoreError('');
                                                            setChoreSuccess('');
                                                            try {
                                                                const agent = getAgent();
                                                                if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                                                                    await agent.fetchRootKey();
                                                                }
                                                                const manager = createManagerActor(canisterId, { agent });
                                                                await manager.startChore(chore.choreId);
                                                                setChoreSuccess('Chore started! Running now and scheduled for next interval.');
                                                                setTimeout(() => loadChoreData(), 2000);
                                                            } catch (err) {
                                                                setChoreError('Failed to start: ' + err.message);
                                                            } finally {
                                                                setSavingChore(false);
                                                            }
                                                        }}
                                                    >
                                                        Start
                                                    </button>
                                                    <button
                                                        style={{
                                                            ...buttonStyle,
                                                            background: `linear-gradient(135deg, ${neuronPrimary}, ${neuronSecondary})`,
                                                            color: '#fff',
                                                            border: 'none',
                                                            borderLeft: '1px solid rgba(255,255,255,0.3)',
                                                            borderRadius: '0 8px 8px 0',
                                                            padding: '0.4rem 0.45rem',
                                                            minWidth: 'unset',
                                                            opacity: savingChore ? 0.6 : 1,
                                                        }}
                                                        disabled={savingChore}
                                                        title="Schedule start at a specific time"
                                                        onClick={() => {
                                                            const el = document.getElementById(`schedule-start-panel-${chore.choreId}`);
                                                            if (el) el.style.display = el.style.display === 'none' ? 'flex' : 'none';
                                                        }}
                                                    >
                                                        <span style={{ fontSize: '0.6rem' }}>&#9660;</span>
                                                    </button>
                                                </div>
                                                )}

                                                {/* Pause — shown when Running (enabled, not paused) */}
                                                {isEnabled && !isPaused && (
                                                <button
                                                    style={{
                                                        ...buttonStyle,
                                                        background: '#f59e0b15',
                                                        color: '#f59e0b',
                                                        border: '1px solid #f59e0b40',
                                                        opacity: savingChore ? 0.6 : 1,
                                                    }}
                                                    disabled={savingChore}
                                                    onClick={async () => {
                                                        setSavingChore(true);
                                                        setChoreError('');
                                                        setChoreSuccess('');
                                                        try {
                                                            const agent = getAgent();
                                                            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                                                                await agent.fetchRootKey();
                                                            }
                                                            const manager = createManagerActor(canisterId, { agent });
                                                            await manager.pauseChore(chore.choreId);
                                                            setChoreSuccess('Chore paused. Schedule preserved — resume to continue.');
                                                            await loadChoreData();
                                                        } catch (err) {
                                                            setChoreError('Failed to pause: ' + err.message);
                                                        } finally {
                                                            setSavingChore(false);
                                                        }
                                                    }}
                                                >
                                                    Pause
                                                </button>
                                                )}

                                                {/* Resume — shown when Paused */}
                                                {isPaused && (
                                                <button
                                                    style={{
                                                        ...buttonStyle,
                                                        background: `linear-gradient(135deg, ${neuronPrimary}, ${neuronSecondary})`,
                                                        color: '#fff',
                                                        border: 'none',
                                                        opacity: savingChore ? 0.6 : 1,
                                                    }}
                                                    disabled={savingChore}
                                                    onClick={async () => {
                                                        setSavingChore(true);
                                                        setChoreError('');
                                                        setChoreSuccess('');
                                                        try {
                                                            const agent = getAgent();
                                                            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                                                                await agent.fetchRootKey();
                                                            }
                                                            const manager = createManagerActor(canisterId, { agent });
                                                            await manager.resumeChore(chore.choreId);
                                                            setChoreSuccess('Chore resumed! Schedule re-activated.');
                                                            setTimeout(() => loadChoreData(), 2000);
                                                        } catch (err) {
                                                            setChoreError('Failed to resume: ' + err.message);
                                                        } finally {
                                                            setSavingChore(false);
                                                        }
                                                    }}
                                                >
                                                    Resume
                                                </button>
                                                )}

                                                {/* Stop — shown when Running or Paused */}
                                                {isEnabled && (
                                                <button
                                                    style={{
                                                        ...buttonStyle,
                                                        background: `${theme.colors.error}15`,
                                                        color: theme.colors.error,
                                                        border: `1px solid ${theme.colors.error}30`,
                                                        opacity: savingChore ? 0.6 : 1,
                                                    }}
                                                    disabled={savingChore}
                                                    onClick={async () => {
                                                        setSavingChore(true);
                                                        setChoreError('');
                                                        setChoreSuccess('');
                                                        try {
                                                            const agent = getAgent();
                                                            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                                                                await agent.fetchRootKey();
                                                            }
                                                            const manager = createManagerActor(canisterId, { agent });
                                                            await manager.stopChore(chore.choreId);
                                                            setChoreSuccess('Chore stopped. Schedule cleared.');
                                                            await loadChoreData();
                                                        } catch (err) {
                                                            setChoreError('Failed to stop: ' + err.message);
                                                        } finally {
                                                            setSavingChore(false);
                                                        }
                                                    }}
                                                >
                                                    Stop
                                                </button>
                                                )}

                                                {/* Run Once (when stopped) / Run Now (when enabled+idle) — available when conductor not active */}
                                                {!isRunning && (
                                                <button
                                                    style={{
                                                        ...buttonStyle,
                                                        background: `${neuronPrimary}15`,
                                                        color: neuronPrimary,
                                                        border: `1px solid ${neuronPrimary}30`,
                                                        opacity: savingChore ? 0.6 : 1,
                                                    }}
                                                    disabled={savingChore}
                                                    onClick={async () => {
                                                        setSavingChore(true);
                                                        setChoreError('');
                                                        setChoreSuccess('');
                                                        try {
                                                            const agent = getAgent();
                                                            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                                                                await agent.fetchRootKey();
                                                            }
                                                            const manager = createManagerActor(canisterId, { agent });
                                                            await manager.triggerChore(chore.choreId);
                                                            setChoreSuccess(isStopped
                                                                ? 'Chore triggered once. It will run without enabling the schedule.'
                                                                : 'Chore triggered manually. It will start running shortly.');
                                                            setTimeout(() => loadChoreData(), 2000);
                                                        } catch (err) {
                                                            setChoreError('Failed to trigger: ' + err.message);
                                                        } finally {
                                                            setSavingChore(false);
                                                        }
                                                    }}
                                                >
                                                    {isStopped ? 'Run Once' : 'Run Now'}
                                                </button>
                                                )}

                                                {/* Refresh button removed — auto-refresh handles status updates */}
                                            </div>

                                            {/* Schedule Start panel — shown when user clicks dropdown arrow on Start button */}
                                            {isStopped && (
                                            <div id={`schedule-start-panel-${chore.choreId}`} style={{ display: 'none', marginTop: '8px', padding: '10px', background: `${neuronPrimary}06`, border: `1px solid ${neuronPrimary}20`, borderRadius: '8px', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                                                <span style={{ fontSize: '0.8rem', color: theme.colors.secondaryText, marginRight: '4px' }}>Schedule first run at:</span>
                                                <input
                                                    type="datetime-local"
                                                    id={`schedule-start-input-${chore.choreId}`}
                                                    style={{
                                                        ...inputStyle,
                                                        fontSize: '0.8rem',
                                                        padding: '0.35rem 0.5rem',
                                                        width: 'auto',
                                                    }}
                                                />
                                                <button
                                                    style={{
                                                        ...buttonStyle,
                                                        background: `linear-gradient(135deg, ${neuronPrimary}, ${neuronSecondary})`,
                                                        color: '#fff',
                                                        border: 'none',
                                                        fontSize: '0.8rem',
                                                        opacity: savingChore ? 0.6 : 1,
                                                    }}
                                                    disabled={savingChore}
                                                    onClick={async () => {
                                                        const input = document.getElementById(`schedule-start-input-${chore.choreId}`);
                                                        if (!input?.value) { setChoreError('Please select a date and time.'); return; }
                                                        const selectedTime = new Date(input.value).getTime();
                                                        if (selectedTime <= Date.now()) { setChoreError('Scheduled time must be in the future.'); return; }
                                                        const tsNanos = BigInt(selectedTime) * 1_000_000n;
                                                        setSavingChore(true);
                                                        setChoreError('');
                                                        setChoreSuccess('');
                                                        try {
                                                            const agent = getAgent();
                                                            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                                                                await agent.fetchRootKey();
                                                            }
                                                            const manager = createManagerActor(canisterId, { agent });
                                                            await manager.scheduleStartChore(chore.choreId, tsNanos);
                                                            setChoreSuccess('Chore scheduled! First run at ' + new Date(selectedTime).toLocaleString());
                                                            const el = document.getElementById(`schedule-start-panel-${chore.choreId}`);
                                                            if (el) el.style.display = 'none';
                                                            setTimeout(() => loadChoreData(), 2000);
                                                        } catch (err) {
                                                            setChoreError('Failed to schedule start: ' + err.message);
                                                        } finally {
                                                            setSavingChore(false);
                                                        }
                                                    }}
                                                >
                                                    Confirm
                                                </button>
                                                <button
                                                    style={{
                                                        ...buttonStyle,
                                                        background: 'transparent',
                                                        color: theme.colors.secondaryText,
                                                        border: `1px solid ${theme.colors.border}`,
                                                        fontSize: '0.8rem',
                                                    }}
                                                    onClick={() => {
                                                        const el = document.getElementById(`schedule-start-panel-${chore.choreId}`);
                                                        if (el) el.style.display = 'none';
                                                    }}
                                                >
                                                    Cancel
                                                </button>
                                            </div>
                                            )}

                                            {/* Interval Setting */}
                                            {(() => {
                                                // Determine the best unit for the current interval
                                                const bestUnit = (secs) => {
                                                    if (secs <= 0) return { value: 0, unit: 'minutes' };
                                                    if (secs % 86400 === 0 && secs >= 86400) return { value: secs / 86400, unit: 'days' };
                                                    if (secs % 3600 === 0 && secs >= 3600) return { value: secs / 3600, unit: 'hours' };
                                                    return { value: Math.round(secs / 60), unit: 'minutes' };
                                                };
                                                const currentBest = bestUnit(intervalSeconds);
                                                const unitMultipliers = { minutes: 60, hours: 3600, days: 86400 };
                                                const hasRange = maxIntervalSeconds != null && maxIntervalSeconds > intervalSeconds;

                                                return (
                                            <div style={{ marginTop: '8px' }}>
                                                <label style={{ fontSize: '0.8rem', color: theme.colors.secondaryText, display: 'block', marginBottom: '6px' }}>
                                                    Frequency:
                                                </label>
                                                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                                                    <span style={{ fontSize: '0.8rem', color: theme.colors.secondaryText }}>Every</span>
                                                    <input
                                                        type="text"
                                                        inputMode="numeric"
                                                        defaultValue={currentBest.value}
                                                        style={{ ...inputStyle, width: '70px' }}
                                                        id={`chore-interval-${chore.choreId}`}
                                                    />
                                                    <select
                                                        id={`chore-interval-unit-${chore.choreId}`}
                                                        defaultValue={currentBest.unit}
                                                        style={{
                                                            ...inputStyle,
                                                            width: 'auto',
                                                            padding: '4px 8px',
                                                            cursor: 'pointer',
                                                            appearance: 'auto',
                                                        }}
                                                    >
                                                        <option value="minutes">minutes</option>
                                                        <option value="hours">hours</option>
                                                        <option value="days">days</option>
                                                    </select>
                                                    <button
                                                        style={{
                                                            ...buttonStyle,
                                                            background: `${neuronPrimary}10`,
                                                            color: neuronPrimary,
                                                            border: `1px solid ${neuronPrimary}25`,
                                                            opacity: savingChore ? 0.6 : 1,
                                                        }}
                                                        disabled={savingChore}
                                                        onClick={async () => {
                                                            const valInput = document.getElementById(`chore-interval-${chore.choreId}`);
                                                            const unitSelect = document.getElementById(`chore-interval-unit-${chore.choreId}`);
                                                            const val = parseFloat(valInput?.value);
                                                            const unit = unitSelect?.value || 'days';
                                                            const multiplier = unitMultipliers[unit] || 86400;
                                                            const totalSeconds = Math.round(val * multiplier);
                                                            if (!val || val <= 0 || totalSeconds < 60) {
                                                                setChoreError('Interval must be at least 1 minute.');
                                                                return;
                                                            }
                                                            if (totalSeconds > 365 * 86400) {
                                                                setChoreError('Interval cannot exceed 365 days.');
                                                                return;
                                                            }
                                                            // Also handle the optional max interval if the range section is open
                                                            const maxInput = document.getElementById(`chore-max-interval-${chore.choreId}`);
                                                            const maxUnitSelect = document.getElementById(`chore-max-interval-unit-${chore.choreId}`);
                                                            let maxSeconds = null;
                                                            if (maxInput && maxUnitSelect) {
                                                                const maxVal = parseFloat(maxInput.value?.trim());
                                                                if (maxVal && maxVal > 0) {
                                                                    const maxMult = unitMultipliers[maxUnitSelect.value] || 86400;
                                                                    maxSeconds = Math.round(maxVal * maxMult);
                                                                    if (maxSeconds <= totalSeconds) {
                                                                        setChoreError('Max interval must be greater than the base interval.');
                                                                        return;
                                                                    }
                                                                    if (maxSeconds > 365 * 86400) {
                                                                        setChoreError('Max interval cannot exceed 365 days.');
                                                                        return;
                                                                    }
                                                                }
                                                            }
                                                            setSavingChore(true);
                                                            setChoreError('');
                                                            setChoreSuccess('');
                                                            try {
                                                                const agent = getAgent();
                                                                if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                                                                    await agent.fetchRootKey();
                                                                }
                                                                const manager = createManagerActor(canisterId, { agent });
                                                                await manager.setChoreInterval(chore.choreId, BigInt(totalSeconds));
                                                                await manager.setChoreMaxInterval(chore.choreId, maxSeconds !== null ? [BigInt(maxSeconds)] : []);
                                                                const msg = maxSeconds !== null
                                                                    ? `Interval updated to ${formatIntervalDisplay(totalSeconds)}–${formatIntervalDisplay(maxSeconds)} (randomized).`
                                                                    : `Interval updated to ${formatIntervalDisplay(totalSeconds)}.`;
                                                                setChoreSuccess(msg);
                                                                await loadChoreData();
                                                            } catch (err) {
                                                                setChoreError('Failed to update interval: ' + err.message);
                                                            } finally {
                                                                setSavingChore(false);
                                                            }
                                                        }}
                                                    >
                                                        Save
                                                    </button>
                                                </div>

                                                {/* Randomized range — collapsed by default, toggle to expand */}
                                                <div style={{ marginTop: '6px' }}>
                                                    <button
                                                        style={{
                                                            background: 'none',
                                                            border: 'none',
                                                            padding: 0,
                                                            fontSize: '0.7rem',
                                                            color: theme.colors.mutedText,
                                                            cursor: 'pointer',
                                                            textDecoration: 'underline',
                                                            textDecorationStyle: 'dotted',
                                                        }}
                                                        onClick={() => {
                                                            const el = document.getElementById(`chore-range-panel-${chore.choreId}`);
                                                            if (el) el.style.display = el.style.display === 'none' ? 'flex' : 'none';
                                                        }}
                                                    >
                                                        {hasRange ? `Randomized range active (up to ${formatIntervalDisplay(maxIntervalSeconds)}) — edit` : 'Randomize interval...'}
                                                    </button>
                                                    <div
                                                        id={`chore-range-panel-${chore.choreId}`}
                                                        style={{ display: hasRange ? 'flex' : 'none', marginTop: '6px', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}
                                                    >
                                                        <span style={{ fontSize: '0.75rem', color: theme.colors.secondaryText }}>Max:</span>
                                                        <input
                                                            type="text"
                                                            inputMode="numeric"
                                                            defaultValue={maxIntervalSeconds != null ? bestUnit(maxIntervalSeconds).value : ''}
                                                            placeholder="none"
                                                            style={{ ...inputStyle, width: '70px', fontSize: '0.8rem' }}
                                                            id={`chore-max-interval-${chore.choreId}`}
                                                            title="Optional max interval for randomized scheduling. Clear to use exact interval."
                                                        />
                                                        <select
                                                            id={`chore-max-interval-unit-${chore.choreId}`}
                                                            defaultValue={maxIntervalSeconds != null ? bestUnit(maxIntervalSeconds).unit : currentBest.unit}
                                                            style={{
                                                                ...inputStyle,
                                                                width: 'auto',
                                                                padding: '4px 8px',
                                                                fontSize: '0.8rem',
                                                                cursor: 'pointer',
                                                                appearance: 'auto',
                                                            }}
                                                        >
                                                            <option value="minutes">minutes</option>
                                                            <option value="hours">hours</option>
                                                            <option value="days">days</option>
                                                        </select>
                                                        <span style={{ fontSize: '0.65rem', color: theme.colors.mutedText }}>
                                                            (clear to disable)
                                                        </span>
                                                    </div>
                                                </div>

                                                {(chore.choreTypeId || chore.choreId) === 'confirm-following' && (
                                                <p style={{ margin: '6px 0 0', fontSize: '0.75rem', color: theme.colors.secondaryText }}>
                                                    NNS requires following confirmation at least every 6 months. We recommend 30 days or less.
                                                </p>
                                                )}
                                                {(chore.choreTypeId || chore.choreId) === 'collect-maturity' && (
                                                <p style={{ margin: '6px 0 0', fontSize: '0.75rem', color: theme.colors.secondaryText }}>
                                                    How often to check and collect maturity from all managed neurons.
                                                </p>
                                                )}
                                                {(chore.choreTypeId || chore.choreId) === 'refresh-stake' && (
                                                <p style={{ margin: '6px 0 0', fontSize: '0.75rem', color: theme.colors.secondaryText }}>
                                                    How often to refresh stake on all managed neurons to pick up any deposited ICP.
                                                </p>
                                                )}
                                                {(chore.choreTypeId || chore.choreId) === 'distribute-funds' && (
                                                <p style={{ margin: '6px 0 0', fontSize: '0.75rem', color: theme.colors.secondaryText }}>
                                                    How often to check distribution lists and distribute funds when thresholds are met.
                                                </p>
                                                )}
                                            </div>
                                                );
                                            })()}
                                            </>
                                            )}

                                            {/* Collect-Maturity specific settings (per-instance) */}
                                            {(chore.choreTypeId || chore.choreId) === 'collect-maturity' && hasPermission('ConfigureCollectMaturity') && (() => {
                                                const cmS = cmSettingsMap[chore.choreId] || {};
                                                const cmThreshold = cmS.thresholdE8s;
                                                const cmDest = cmS.destination;
                                                const cmPrincipal = cmS.principalInput || '';
                                                const cmSub = cmS.subaccount;
                                                return (
                                            <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: `1px solid ${theme.colors.border}` }}>
                                                <h4 style={{ color: theme.colors.primaryText, margin: '0 0 12px 0', fontSize: '0.9rem', fontWeight: '600' }}>
                                                    Collection Settings
                                                </h4>

                                                {/* Threshold */}
                                                <div style={{ marginBottom: '14px' }}>
                                                    <label style={{ fontSize: '0.8rem', color: theme.colors.secondaryText, display: 'block', marginBottom: '6px' }}>
                                                        Minimum maturity to collect (ICP):
                                                    </label>
                                                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                                        <input
                                                            type="text"
                                                            inputMode="decimal"
                                                            placeholder="No minimum"
                                                            defaultValue={cmThreshold != null ? Number(cmThreshold) / 1e8 : ''}
                                                            style={{ ...inputStyle, width: '140px' }}
                                                            id={`cm-threshold-input-${chore.choreId}`}
                                                        />
                                                        <button
                                                            style={{
                                                                ...buttonStyle,
                                                                background: `${neuronPrimary}10`,
                                                                color: neuronPrimary,
                                                                border: `1px solid ${neuronPrimary}25`,
                                                                opacity: savingChore ? 0.6 : 1,
                                                            }}
                                                            disabled={savingChore}
                                                            onClick={async () => {
                                                                const input = document.getElementById(`cm-threshold-input-${chore.choreId}`);
                                                                const val = input?.value?.trim();
                                                                const thresholdOpt = (!val || val === '' || parseFloat(val) <= 0)
                                                                    ? []
                                                                    : [BigInt(Math.round(parseFloat(val) * 1e8))];
                                                                setSavingChore(true);
                                                                setChoreError('');
                                                                setChoreSuccess('');
                                                                try {
                                                                    const agent = getAgent();
                                                                    if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                                                                        await agent.fetchRootKey();
                                                                    }
                                                                    const manager = createManagerActor(canisterId, { agent });
                                                                    await manager.setCollectMaturityThreshold(chore.choreId, thresholdOpt);
                                                                    setChoreSuccess(thresholdOpt.length > 0
                                                                        ? `Threshold set to ${parseFloat(val)} ICP.`
                                                                        : 'Threshold removed — will collect any amount.');
                                                                    await loadChoreData();
                                                                } catch (err) {
                                                                    setChoreError('Failed to update threshold: ' + err.message);
                                                                } finally {
                                                                    setSavingChore(false);
                                                                }
                                                            }}
                                                        >
                                                            Save
                                                        </button>
                                                    </div>
                                                    <p style={{ margin: '4px 0 0', fontSize: '0.75rem', color: theme.colors.secondaryText }}>
                                                        {cmThreshold != null
                                                            ? `Current: ${(Number(cmThreshold) / 1e8).toFixed(4)} ICP`
                                                            : 'No minimum set — will collect any available maturity.'
                                                        }
                                                        {' '}Leave empty or 0 to collect whenever maturity is available.
                                                    </p>
                                                </div>

                                                {/* Destination */}
                                                <div>
                                                    <label style={{ fontSize: '0.8rem', color: theme.colors.secondaryText, display: 'block', marginBottom: '6px' }}>
                                                        Send collected maturity to:
                                                    </label>
                                                    <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
                                                        <div style={{ flex: 1, minWidth: '220px', maxWidth: '360px' }}>
                                                            <PrincipalInput
                                                                value={cmPrincipal}
                                                                onChange={(val) => {
                                                                    // Check if user entered a long account string
                                                                    let newPrincipal = val;
                                                                    let newSub = cmSub;
                                                                    if (val && val.includes('-') && val.length > 30) {
                                                                        try {
                                                                            const decoded = decodeIcrcAccount(val);
                                                                            if (decoded && decoded.owner) {
                                                                                newPrincipal = decoded.owner.toString();
                                                                                const sub = decoded.subaccount ? new Uint8Array(decoded.subaccount) : null;
                                                                                newSub = sub && !sub.every(b => b === 0) ? sub : null;
                                                                            }
                                                                        } catch (_) { /* not a valid encoded account, treat as principal */ }
                                                                    }
                                                                    setCmSettingsMap(prev => ({ ...prev, [chore.choreId]: { ...prev[chore.choreId], principalInput: newPrincipal, subaccount: newSub } }));
                                                                }}
                                                                placeholder="Bot's own account (default)"
                                                                inputStyle={{ fontFamily: 'monospace', fontSize: '0.75rem' }}
                                                            />
                                                            {cmSub && (
                                                                <div style={{ marginTop: '4px', display: 'flex', gap: '4px', alignItems: 'center', flexWrap: 'wrap' }}>
                                                                    <span style={{ fontSize: '0.7rem', color: theme.colors.mutedText }}>Subaccount:</span>
                                                                    <code style={{ fontSize: '0.65rem', color: theme.colors.secondaryText, background: `${theme.colors.border}40`, padding: '2px 6px', borderRadius: '4px', wordBreak: 'break-all' }}>
                                                                        {Array.from(cmSub).map(b => b.toString(16).padStart(2, '0')).join('')}
                                                                    </code>
                                                                    <button
                                                                        onClick={() => setCmSettingsMap(prev => ({ ...prev, [chore.choreId]: { ...prev[chore.choreId], subaccount: null } }))}
                                                                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: theme.colors.mutedText, fontSize: '0.7rem', padding: '0 4px' }}
                                                                        title="Clear subaccount"
                                                                    >✕</button>
                                                                </div>
                                                            )}
                                                        </div>
                                                        <button
                                                            style={{
                                                                ...buttonStyle,
                                                                background: `${neuronPrimary}10`,
                                                                color: neuronPrimary,
                                                                border: `1px solid ${neuronPrimary}25`,
                                                                opacity: savingChore ? 0.6 : 1,
                                                                marginTop: '1px',
                                                            }}
                                                            disabled={savingChore}
                                                            onClick={async () => {
                                                                const principalStr = cmPrincipal?.trim();
                                                                setSavingChore(true);
                                                                setChoreError('');
                                                                setChoreSuccess('');
                                                                try {
                                                                    let destOpt = [];
                                                                    if (principalStr && principalStr !== '') {
                                                                        const { Principal } = await import('@dfinity/principal');
                                                                        const owner = Principal.fromText(principalStr);
                                                                        let subaccount = [];
                                                                        if (cmSub && !cmSub.every(b => b === 0)) {
                                                                            subaccount = [cmSub];
                                                                        }
                                                                        destOpt = [{ owner, subaccount }];
                                                                    }
                                                                    const agent = getAgent();
                                                                    if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                                                                        await agent.fetchRootKey();
                                                                    }
                                                                    const manager = createManagerActor(canisterId, { agent });
                                                                    await manager.setCollectMaturityDestination(chore.choreId, destOpt);
                                                                    setChoreSuccess(destOpt.length > 0
                                                                        ? `Destination set to ${principalStr}.`
                                                                        : "Destination reset — maturity will be sent to the bot's own account.");
                                                                    await loadChoreData();
                                                                } catch (err) {
                                                                    setChoreError('Failed to update destination: ' + err.message);
                                                                } finally {
                                                                    setSavingChore(false);
                                                                }
                                                            }}
                                                        >
                                                            Save
                                                        </button>
                                                    </div>
                                                    <p style={{ margin: '4px 0 0', fontSize: '0.75rem', color: theme.colors.secondaryText }}>
                                                        {cmDest
                                                            ? (() => {
                                                                const ownerStr = cmDest.owner.toString();
                                                                const hasSub = cmDest.subaccount && cmDest.subaccount.length > 0 && !new Uint8Array(cmDest.subaccount[0]).every(b => b === 0);
                                                                return `Current: ${ownerStr}${hasSub ? ' (with subaccount)' : ''}`;
                                                            })()
                                                            : "Default: Bot's own account (canister principal, no subaccount)."
                                                        }
                                                        {' '}Enter a principal ID or paste a full account string. Leave empty for default.
                                                    </p>
                                                </div>
                                            </div>
                                            );
                                            })()}

                                            {/* Distribute-Funds specific settings: Distribution Lists (per-instance) */}
                                            {(chore.choreTypeId || chore.choreId) === 'distribute-funds' && hasPermission('ConfigureDistribution') && (() => {
                                                const distLists = distListsMap[chore.choreId] || [];
                                                return (
                                            <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: `1px solid ${theme.colors.border}` }}>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                                                    <h4 style={{ color: theme.colors.primaryText, margin: 0, fontSize: '0.9rem', fontWeight: '600' }}>
                                                        Distribution Lists ({distLists.length})
                                                    </h4>
                                                    <button
                                                        style={{
                                                            ...buttonStyle,
                                                            background: `linear-gradient(135deg, ${neuronPrimary}, ${neuronSecondary})`,
                                                            color: '#fff',
                                                            border: 'none',
                                                            fontSize: '0.75rem',
                                                            padding: '6px 12px',
                                                        }}
                                                        onClick={() => {
                                                            setEditingDistListId(null);
                                                            setEditingDistList({
                                                                name: '',
                                                                sourceSubaccount: '',
                                                                tokenLedgerCanisterId: 'ryjl3-tyaaa-aaaaa-aaaba-cai',
                                                                tokenMeta: null,
                                                                thresholdAmount: '',
                                                                maxDistributionAmount: '',
                                                                targets: [{ accountOwner: '', accountSubaccount: '', basisPoints: '' }],
                                                            });
                                                        }}
                                                    >
                                                        + Add List
                                                    </button>
                                                </div>

                                                {distLists.length === 0 && editingDistList === null && (
                                                    <p style={{ fontSize: '0.8rem', color: theme.colors.secondaryText, fontStyle: 'italic' }}>
                                                        No distribution lists configured. Add one to start distributing funds.
                                                    </p>
                                                )}

                                                {/* Existing lists */}
                                                {distLists.map((list) => {
                                                    const isEditing = editingDistListId === Number(list.id) && editingDistList !== null;
                                                    if (isEditing) return null;

                                                    const cid = list.tokenLedgerCanisterId?.toString?.() || '';
                                                    const tkInfo = getTokenInfo(cid);
                                                    const tkPrice = distTokenPrices[cid];
                                                    const tkDecimals = tkInfo.decimals || 8;
                                                    const totalBp = list.targets.reduce((sum, t) => sum + (t.basisPoints.length > 0 ? Number(t.basisPoints[0]) : 0), 0);
                                                    const overHundred = totalBp > 10000;
                                                    const thresholdHuman = Number(list.thresholdAmount) / (10 ** tkDecimals);
                                                    const maxHuman = Number(list.maxDistributionAmount) / (10 ** tkDecimals);
                                                    const thresholdUsd = tkPrice ? formatUsd(thresholdHuman * tkPrice) : null;
                                                    const maxUsd = tkPrice ? formatUsd(maxHuman * tkPrice) : null;

                                                    return (
                                                        <div key={Number(list.id)} style={{
                                                            marginBottom: '12px',
                                                            padding: '12px',
                                                            background: theme.colors.primaryBg,
                                                            borderRadius: '10px',
                                                            border: `1px solid ${theme.colors.border}`,
                                                        }}>
                                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                                                                <div>
                                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                                                                        <span style={{ fontSize: '0.9rem', fontWeight: '600', color: theme.colors.primaryText }}>{list.name || `List #${Number(list.id)}`}</span>
                                                                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '2px 8px', borderRadius: '12px', background: `${neuronPrimary}10`, fontSize: '0.7rem', color: neuronPrimary }}>
                                                                            <TokenIcon logo={tkInfo.logo} canisterId={cid} alt={tkInfo.symbol} size={14} />
                                                                            {tkInfo.symbol}
                                                                        </span>
                                                                    </div>
                                                                    {list.sourceSubaccount.length > 0 && (
                                                                        <div style={{ fontSize: '0.7rem', color: theme.colors.secondaryText }}>
                                                                            Source subaccount: <span style={{ fontFamily: 'monospace' }}>{Array.from(new Uint8Array(list.sourceSubaccount[0])).map(b => b.toString(16).padStart(2, '0')).join('')}</span>
                                                                        </div>
                                                                    )}
                                                                </div>
                                                                <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                                                                    <button
                                                                        style={{ ...buttonStyle, fontSize: '0.7rem', padding: '4px 10px', background: `${neuronPrimary}10`, color: neuronPrimary, border: `1px solid ${neuronPrimary}25` }}
                                                                        onClick={() => {
                                                                            setEditingDistListId(Number(list.id));
                                                                            setEditingDistList({
                                                                                name: list.name,
                                                                                sourceSubaccount: list.sourceSubaccount.length > 0 ? Array.from(new Uint8Array(list.sourceSubaccount[0])).map(b => b.toString(16).padStart(2, '0')).join('') : '',
                                                                                tokenLedgerCanisterId: cid,
                                                                                tokenMeta: tkInfo,
                                                                                thresholdAmount: thresholdHuman.toString(),
                                                                                maxDistributionAmount: maxHuman.toString(),
                                                                                targets: list.targets.map(t => ({
                                                                                    accountOwner: t.account.owner.toString(),
                                                                                    accountSubaccount: t.account.subaccount.length > 0 ? Array.from(new Uint8Array(t.account.subaccount[0])).map(b => b.toString(16).padStart(2, '0')).join('') : '',
                                                                                    basisPoints: t.basisPoints.length > 0 ? (Number(t.basisPoints[0]) / 100).toString() : '',
                                                                                })),
                                                                            });
                                                                        }}
                                                                    >Edit</button>
                                                                    <button
                                                                        style={{ ...buttonStyle, fontSize: '0.7rem', padding: '4px 10px', background: `${theme.colors.error}10`, color: theme.colors.error, border: `1px solid ${theme.colors.error}25` }}
                                                                        disabled={savingChore}
                                                                        onClick={async () => {
                                                                            if (!window.confirm(`Remove distribution list "${list.name || 'List #' + Number(list.id)}"?`)) return;
                                                                            setSavingChore(true);
                                                                            try {
                                                                                const agent = getAgent();
                                                                                if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') await agent.fetchRootKey();
                                                                                const manager = createManagerActor(canisterId, { agent });
                                                                                await manager.removeDistributionList(chore.choreId, BigInt(list.id));
                                                                                setChoreSuccess('Distribution list removed.');
                                                                                await loadChoreData();
                                                                            } catch (err) {
                                                                                setChoreError('Failed to remove list: ' + err.message);
                                                                            } finally { setSavingChore(false); }
                                                                        }}
                                                                    >Remove</button>
                                                                </div>
                                                            </div>

                                                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '8px', marginBottom: '8px' }}>
                                                                <div style={{ fontSize: '0.75rem' }}>
                                                                    <span style={{ color: theme.colors.secondaryText }}>Threshold:</span>{' '}
                                                                    <span style={{ color: theme.colors.primaryText, fontWeight: '500' }}>{thresholdHuman} {tkInfo.symbol}</span>
                                                                    {thresholdUsd && <span style={{ color: theme.colors.secondaryText, fontSize: '0.7rem' }}> ({thresholdUsd})</span>}
                                                                </div>
                                                                <div style={{ fontSize: '0.75rem' }}>
                                                                    <span style={{ color: theme.colors.secondaryText }}>Max/round:</span>{' '}
                                                                    <span style={{ color: theme.colors.primaryText, fontWeight: '500' }}>{maxHuman} {tkInfo.symbol}</span>
                                                                    {maxUsd && <span style={{ color: theme.colors.secondaryText, fontSize: '0.7rem' }}> ({maxUsd})</span>}
                                                                </div>
                                                                <div style={{ fontSize: '0.75rem' }}>
                                                                    <span style={{ color: theme.colors.secondaryText }}>Targets:</span>{' '}
                                                                    <span style={{ color: theme.colors.primaryText, fontWeight: '500' }}>{list.targets.length}</span>
                                                                </div>
                                                            </div>

                                                            {overHundred && (
                                                                <div style={{ fontSize: '0.75rem', color: '#f59e0b', marginBottom: '6px' }}>
                                                                    Warning: Assigned percentages total {(totalBp / 100).toFixed(2)}% (over 100%). Will be renormalized.
                                                                </div>
                                                            )}

                                                            {/* Targets list with effective % calculation */}
                                                            {(() => {
                                                                // Calculate effective percentages (mirrors backend logic)
                                                                const tgts = list.targets;
                                                                let totalAssignedBp = 0;
                                                                let numUnassigned = 0;
                                                                tgts.forEach(t => {
                                                                    if (t.basisPoints.length > 0) totalAssignedBp += Number(t.basisPoints[0]);
                                                                    else numUnassigned++;
                                                                });
                                                                const effectivePcts = tgts.map(t => {
                                                                    if (totalAssignedBp > 10000) {
                                                                        // Renormalize
                                                                        return t.basisPoints.length > 0 ? (Number(t.basisPoints[0]) * 10000 / totalAssignedBp) / 100 : 0;
                                                                    } else {
                                                                        const remainderBp = 10000 - totalAssignedBp;
                                                                        const eachUnassignedBp = numUnassigned > 0 ? remainderBp / numUnassigned : 0;
                                                                        return t.basisPoints.length > 0 ? Number(t.basisPoints[0]) / 100 : eachUnassignedBp / 100;
                                                                    }
                                                                });
                                                                const totalEffective = effectivePcts.reduce((s, p) => s + p, 0);
                                                                const undistributed = 100 - totalEffective;

                                                                return (
                                                            <div style={{ fontSize: '0.75rem' }}>
                                                                {tgts.map((t, ti) => {
                                                                    const ownerStr = t.account.owner.toString();
                                                                    const hasSub = t.account.subaccount.length > 0;
                                                                    const subHex = hasSub ? Array.from(new Uint8Array(t.account.subaccount[0])).map(b => b.toString(16).padStart(2, '0')).join('') : '';
                                                                    let longAccount = ownerStr;
                                                                    if (hasSub) {
                                                                        try {
                                                                            longAccount = encodeIcrcAccount({ owner: t.account.owner, subaccount: t.account.subaccount[0] });
                                                                        } catch (_) { longAccount = ownerStr + '.' + subHex; }
                                                                    }
                                                                    const configuredLabel = t.basisPoints.length > 0 ? `${(Number(t.basisPoints[0]) / 100).toFixed(2)}%` : 'auto';
                                                                    const effectiveLabel = `${effectivePcts[ti].toFixed(2)}%`;
                                                                    const showEffective = configuredLabel !== effectiveLabel;
                                                                    return (
                                                                        <div key={ti} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '6px 0', borderBottom: ti < tgts.length - 1 ? `1px solid ${theme.colors.border}20` : 'none' }}>
                                                                            <div style={{ flex: 1, minWidth: 0 }}>
                                                                                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                                                    <PrincipalDisplay
                                                                                        principal={ownerStr}
                                                                                        displayInfo={getPrincipalDisplayInfoFromContext(ownerStr, principalNames, principalNicknames)}
                                                                                        showCopyButton={true}
                                                                                        isAuthenticated={isAuthenticated}
                                                                                        short={true}
                                                                                        enableContextMenu={true}
                                                                                    />
                                                                                </div>
                                                                                {hasSub && (
                                                                                    <>
                                                                                    <div style={{ fontSize: '0.65rem', color: theme.colors.secondaryText, marginTop: '2px', fontFamily: 'monospace', wordBreak: 'break-all' }}>
                                                                                        Sub: {subHex}
                                                                                    </div>
                                                                                    <div style={{ fontSize: '0.6rem', color: theme.colors.secondaryText, marginTop: '1px', fontFamily: 'monospace', wordBreak: 'break-all', opacity: 0.7 }}>
                                                                                        {longAccount}
                                                                                    </div>
                                                                                    </>
                                                                                )}
                                                                            </div>
                                                                            <div style={{ textAlign: 'right', flexShrink: 0, paddingLeft: '8px' }}>
                                                                                <div style={{ fontWeight: '500', color: theme.colors.primaryText }}>{effectiveLabel}</div>
                                                                                {showEffective && (
                                                                                    <div style={{ fontSize: '0.6rem', color: theme.colors.secondaryText }}>
                                                                                        ({t.basisPoints.length > 0 ? configuredLabel : <span style={{ fontStyle: 'italic' }}>auto</span>})
                                                                                    </div>
                                                                                )}
                                                                            </div>
                                                                        </div>
                                                                    );
                                                                })}
                                                                {undistributed > 0.01 && (
                                                                    <div style={{ padding: '4px 0', textAlign: 'right', fontSize: '0.7rem', color: theme.colors.warning || '#e6a700', fontStyle: 'italic' }}>
                                                                        {undistributed.toFixed(2)}% undistributed
                                                                    </div>
                                                                )}
                                                                {totalAssignedBp > 10000 && (
                                                                    <div style={{ padding: '4px 0', textAlign: 'right', fontSize: '0.7rem', color: theme.colors.error || '#e74c3c', fontStyle: 'italic' }}>
                                                                        Assigned total exceeds 100% — percentages are renormalized
                                                                    </div>
                                                                )}
                                                            </div>
                                                                );
                                                            })()}
                                                        </div>
                                                    );
                                                })}

                                                {/* Edit / Add form */}
                                                {editingDistList !== null && (
                                                    <div style={{
                                                        marginBottom: '12px',
                                                        padding: '14px',
                                                        background: `${neuronPrimary}06`,
                                                        borderRadius: '10px',
                                                        border: `1px solid ${neuronPrimary}30`,
                                                    }}>
                                                        <h5 style={{ margin: '0 0 10px 0', fontSize: '0.85rem', fontWeight: '600', color: theme.colors.primaryText }}>
                                                            {editingDistListId !== null ? 'Edit Distribution List' : 'New Distribution List'}
                                                        </h5>

                                                        {/* Name */}
                                                        <div style={{ marginBottom: '10px' }}>
                                                            <label style={{ fontSize: '0.75rem', color: theme.colors.secondaryText, display: 'block', marginBottom: '4px' }}>Name</label>
                                                            <input type="text" value={editingDistList.name} style={{ ...inputStyle, width: '100%' }}
                                                                onChange={e => setEditingDistList({ ...editingDistList, name: e.target.value })} />
                                                        </div>

                                                        {/* Token Selector */}
                                                        <div style={{ marginBottom: '10px' }}>
                                                            <label style={{ fontSize: '0.75rem', color: theme.colors.secondaryText, display: 'block', marginBottom: '4px' }}>Token</label>
                                                            <TokenSelector
                                                                value={editingDistList.tokenLedgerCanisterId}
                                                                onChange={(ledgerId) => setEditingDistList({ ...editingDistList, tokenLedgerCanisterId: ledgerId })}
                                                                onSelectToken={(token) => {
                                                                    setEditingDistList(prev => ({ ...prev, tokenMeta: token }));
                                                                    setDistTokenMeta(prev => ({ ...prev, [token.ledger_id]: { symbol: token.symbol, logo: token.logo, decimals: token.decimals, name: token.name } }));
                                                                    // Fetch USD price for this token
                                                                    priceService.getTokenUSDPrice(token.ledger_id, token.decimals)
                                                                        .then(price => setDistTokenPrices(prev => ({ ...prev, [token.ledger_id]: price })))
                                                                        .catch(() => {});
                                                                }}
                                                                allowCustom={true}
                                                                placeholder="Select token to distribute..."
                                                            />
                                                        </div>

                                                        {/* Source Subaccount */}
                                                        <div style={{ marginBottom: '10px' }}>
                                                            <label style={{ fontSize: '0.75rem', color: theme.colors.secondaryText, display: 'block', marginBottom: '4px' }}>Source Subaccount (hex, leave empty for default)</label>
                                                            <input type="text" value={editingDistList.sourceSubaccount} placeholder="default (no subaccount)" style={{ ...inputStyle, width: '100%', fontFamily: 'monospace', fontSize: '0.75rem' }}
                                                                onChange={e => setEditingDistList({ ...editingDistList, sourceSubaccount: e.target.value })} />
                                                        </div>

                                                        {(() => {
                                                            const editCid = editingDistList.tokenLedgerCanisterId;
                                                            const editTkInfo = editingDistList.tokenMeta || getTokenInfo(editCid);
                                                            const editDecimals = editTkInfo.decimals || 8;
                                                            const editSymbol = editTkInfo.symbol || '?';
                                                            const editPrice = distTokenPrices[editCid];
                                                            const threshVal = parseFloat(editingDistList.thresholdAmount) || 0;
                                                            const maxVal = parseFloat(editingDistList.maxDistributionAmount) || 0;
                                                            const threshUsd = editPrice ? formatUsd(threshVal * editPrice) : null;
                                                            const maxUsd = editPrice ? formatUsd(maxVal * editPrice) : null;
                                                            return (
                                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '10px' }}>
                                                            <div>
                                                                <label style={{ fontSize: '0.75rem', color: theme.colors.secondaryText, display: 'block', marginBottom: '4px' }}>Threshold ({editSymbol})</label>
                                                                <input type="text" inputMode="decimal" value={editingDistList.thresholdAmount} placeholder="0" style={{ ...inputStyle, width: '100%' }}
                                                                    onChange={e => setEditingDistList({ ...editingDistList, thresholdAmount: e.target.value })} />
                                                                {threshUsd && <div style={{ fontSize: '0.7rem', color: theme.colors.secondaryText, marginTop: '2px' }}>{threshUsd}</div>}
                                                            </div>
                                                            <div>
                                                                <label style={{ fontSize: '0.75rem', color: theme.colors.secondaryText, display: 'block', marginBottom: '4px' }}>Max per round ({editSymbol})</label>
                                                                <input type="text" inputMode="decimal" value={editingDistList.maxDistributionAmount} placeholder="0" style={{ ...inputStyle, width: '100%' }}
                                                                    onChange={e => setEditingDistList({ ...editingDistList, maxDistributionAmount: e.target.value })} />
                                                                {maxUsd && <div style={{ fontSize: '0.7rem', color: theme.colors.secondaryText, marginTop: '2px' }}>{maxUsd}</div>}
                                                            </div>
                                                        </div>
                                                            );
                                                        })()}

                                                        {/* Targets */}
                                                        <div style={{ marginBottom: '10px' }}>
                                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                                                                <label style={{ fontSize: '0.75rem', color: theme.colors.secondaryText }}>Targets</label>
                                                                <button
                                                                    style={{ ...buttonStyle, fontSize: '0.7rem', padding: '3px 8px', background: `${neuronPrimary}10`, color: neuronPrimary, border: `1px solid ${neuronPrimary}25` }}
                                                                    onClick={() => setEditingDistList({
                                                                        ...editingDistList,
                                                                        targets: [...editingDistList.targets, { accountOwner: '', accountSubaccount: '', basisPoints: '' }],
                                                                    })}
                                                                >+ Add Target</button>
                                                            </div>

                                                            {(() => {
                                                                const totalPct = editingDistList.targets.reduce((s, t) => s + (t.basisPoints ? parseFloat(t.basisPoints) || 0 : 0), 0);
                                                                const overHundred = totalPct > 100;
                                                                // Calculate effective percentages (mirrors backend logic)
                                                                const totalAssignedBpEdit = totalPct * 100; // user enters %, convert to bp
                                                                const numUnassignedEdit = editingDistList.targets.filter(t => !t.basisPoints || t.basisPoints === '').length;
                                                                const editEffectivePcts = editingDistList.targets.map(t => {
                                                                    const bp = t.basisPoints ? (parseFloat(t.basisPoints) || 0) * 100 : 0;
                                                                    const isAssigned = t.basisPoints && t.basisPoints !== '';
                                                                    if (totalAssignedBpEdit > 10000) {
                                                                        return isAssigned ? (bp * 10000 / totalAssignedBpEdit) / 100 : 0;
                                                                    } else {
                                                                        const remainderBp = 10000 - totalAssignedBpEdit;
                                                                        const eachUnassignedBp = numUnassignedEdit > 0 ? remainderBp / numUnassignedEdit : 0;
                                                                        return isAssigned ? bp / 100 : eachUnassignedBp / 100;
                                                                    }
                                                                });
                                                                const editTotalEffective = editEffectivePcts.reduce((s, p) => s + p, 0);
                                                                const editUndistributed = 100 - editTotalEffective;
                                                                return (
                                                                    <>
                                                                    {overHundred && (
                                                                        <div style={{ fontSize: '0.75rem', color: '#f59e0b', marginBottom: '6px' }}>
                                                                            Warning: Assigned percentages total {totalPct.toFixed(2)}% (over 100%). Will be renormalized at distribution time.
                                                                        </div>
                                                                    )}
                                                                    {editingDistList.targets.map((target, ti) => {
                                                                        // Build long account string for display
                                                                        let longAcctStr = '';
                                                                        if (target.accountOwner && target.accountSubaccount) {
                                                                            try {
                                                                                const hexStr = target.accountSubaccount.trim().replace(/^0x/, '');
                                                                                if (hexStr) {
                                                                                    const bytes = new Uint8Array(32);
                                                                                    const hexBytes = hexStr.match(/.{1,2}/g) || [];
                                                                                    for (let j = 0; j < Math.min(hexBytes.length, 32); j++) bytes[32 - hexBytes.length + j] = parseInt(hexBytes[j], 16);
                                                                                    longAcctStr = encodeIcrcAccount({ owner: Principal.fromText(target.accountOwner.trim()), subaccount: bytes });
                                                                                }
                                                                            } catch (_) {}
                                                                        }
                                                                        return (
                                                                        <div key={ti} style={{
                                                                            marginBottom: '6px', padding: '8px', background: theme.colors.primaryBg, borderRadius: '6px', border: `1px solid ${theme.colors.border}`,
                                                                        }}>
                                                                            <div style={{ display: 'flex', gap: '6px', alignItems: 'flex-end' }}>
                                                                                <div style={{ flex: 1 }}>
                                                                                    <label style={{ fontSize: '0.65rem', color: theme.colors.secondaryText, display: 'block', marginBottom: '2px' }}>Recipient</label>
                                                                                    <PrincipalInput
                                                                                        value={target.accountOwner}
                                                                                        onChange={(val) => {
                                                                                            const newTargets = [...editingDistList.targets];
                                                                                            // Check if pasted value is a long ICRC-1 account (contains '.')
                                                                                            if (val.includes('.')) {
                                                                                                try {
                                                                                                    const { decodeIcrcAccount } = require('@dfinity/ledger-icrc');
                                                                                                    const decoded = decodeIcrcAccount(val);
                                                                                                    if (decoded && decoded.owner) {
                                                                                                        const subBytes = decoded.subaccount;
                                                                                                        const subHex = subBytes ? Array.from(new Uint8Array(subBytes)).map(b => b.toString(16).padStart(2, '0')).join('') : '';
                                                                                                        newTargets[ti] = { ...newTargets[ti], accountOwner: decoded.owner.toText(), accountSubaccount: subHex };
                                                                                                        setEditingDistList({ ...editingDistList, targets: newTargets });
                                                                                                        return;
                                                                                                    }
                                                                                                } catch (_) {}
                                                                                            }
                                                                                            newTargets[ti] = { ...newTargets[ti], accountOwner: val };
                                                                                            setEditingDistList({ ...editingDistList, targets: newTargets });
                                                                                        }}
                                                                                        onSelect={(principalStr) => {
                                                                                            const newTargets = [...editingDistList.targets];
                                                                                            newTargets[ti] = { ...newTargets[ti], accountOwner: principalStr };
                                                                                            setEditingDistList({ ...editingDistList, targets: newTargets });
                                                                                        }}
                                                                                        placeholder="Principal ID or ICRC-1 account"
                                                                                        isAuthenticated={isAuthenticated}
                                                                                        defaultTab="all"
                                                                                        defaultPrincipalType="both"
                                                                                        inputStyle={{ fontSize: '0.75rem' }}
                                                                                    />
                                                                                </div>
                                                                                <div style={{ width: '80px', flexShrink: 0 }}>
                                                                                    <label style={{ fontSize: '0.65rem', color: theme.colors.secondaryText, display: 'block', marginBottom: '2px' }}>% Share</label>
                                                                                    <input type="text" inputMode="decimal" value={target.basisPoints} placeholder="auto" style={{ ...inputStyle, width: '100%', textAlign: 'right', fontSize: '0.75rem' }}
                                                                                        onChange={e => {
                                                                                            const newTargets = [...editingDistList.targets];
                                                                                            newTargets[ti] = { ...newTargets[ti], basisPoints: e.target.value };
                                                                                            setEditingDistList({ ...editingDistList, targets: newTargets });
                                                                                        }} />
                                                                                    <div style={{ fontSize: '0.6rem', color: theme.colors.secondaryText, textAlign: 'right', marginTop: '2px' }}>
                                                                                        Effective: {editEffectivePcts[ti].toFixed(2)}%
                                                                                    </div>
                                                                                </div>
                                                                                <button
                                                                                    style={{ ...buttonStyle, fontSize: '0.65rem', padding: '4px 8px', background: `${theme.colors.error}10`, color: theme.colors.error, border: `1px solid ${theme.colors.error}25`, flexShrink: 0 }}
                                                                                    onClick={() => {
                                                                                        const newTargets = editingDistList.targets.filter((_, i) => i !== ti);
                                                                                        setEditingDistList({ ...editingDistList, targets: newTargets });
                                                                                    }}
                                                                                    disabled={editingDistList.targets.length <= 1}
                                                                                >Remove</button>
                                                                            </div>
                                                                            {/* Subaccount field */}
                                                                            <div style={{ marginTop: '4px' }}>
                                                                                <label style={{ fontSize: '0.6rem', color: theme.colors.secondaryText, display: 'block', marginBottom: '2px' }}>Subaccount (hex, optional)</label>
                                                                                <input type="text" value={target.accountSubaccount} placeholder="optional" style={{ ...inputStyle, width: '100%', fontFamily: 'monospace', fontSize: '0.7rem' }}
                                                                                    onChange={e => {
                                                                                        const newTargets = [...editingDistList.targets];
                                                                                        newTargets[ti] = { ...newTargets[ti], accountSubaccount: e.target.value };
                                                                                        setEditingDistList({ ...editingDistList, targets: newTargets });
                                                                                    }} />
                                                                            </div>
                                                                            {/* Long account string display */}
                                                                            {longAcctStr && (
                                                                                <div style={{ fontSize: '0.6rem', color: theme.colors.secondaryText, marginTop: '3px', fontFamily: 'monospace', wordBreak: 'break-all', opacity: 0.7 }}>
                                                                                    Account: {longAcctStr}
                                                                                </div>
                                                                            )}
                                                                        </div>
                                                                        );
                                                                    })}
                                                                    {editUndistributed > 0.01 && (
                                                                        <div style={{ padding: '6px 0 2px', textAlign: 'right', fontSize: '0.7rem', color: theme.colors.warning || '#e6a700', fontStyle: 'italic' }}>
                                                                            {editUndistributed.toFixed(2)}% will remain undistributed
                                                                        </div>
                                                                    )}
                                                                    </>
                                                                );
                                                            })()}
                                                        </div>

                                                        {/* Save / Cancel */}
                                                        <div style={{ display: 'flex', gap: '8px' }}>
                                                            <button
                                                                style={{
                                                                    ...buttonStyle,
                                                                    background: `linear-gradient(135deg, ${neuronPrimary}, ${neuronSecondary})`,
                                                                    color: '#fff',
                                                                    border: 'none',
                                                                    opacity: savingChore ? 0.6 : 1,
                                                                }}
                                                                disabled={savingChore}
                                                                onClick={async () => {
                                                                    // Validate
                                                                    if (!editingDistList.name.trim()) { setChoreError('Distribution list name is required.'); return; }
                                                                    if (!editingDistList.tokenLedgerCanisterId || !editingDistList.tokenLedgerCanisterId.trim()) { setChoreError('Please select a token.'); return; }
                                                                    if (editingDistList.targets.length === 0) { setChoreError('At least one target is required.'); return; }
                                                                    for (let i = 0; i < editingDistList.targets.length; i++) {
                                                                        if (!editingDistList.targets[i].accountOwner.trim()) { setChoreError(`Target ${i + 1}: Principal ID is required.`); return; }
                                                                    }

                                                                    setSavingChore(true);
                                                                    setChoreError('');
                                                                    setChoreSuccess('');
                                                                    try {
                                                                        // Resolve decimals from token meta
                                                                        const editTkInfo = editingDistList.tokenMeta || getTokenInfo(editingDistList.tokenLedgerCanisterId);
                                                                        const editDecimals = editTkInfo.decimals || 8;
                                                                        const divisor = 10 ** editDecimals;

                                                                        // Build targets
                                                                        const targets = editingDistList.targets.map(t => {
                                                                            const owner = Principal.fromText(t.accountOwner.trim());
                                                                            let subaccount = [];
                                                                            if (t.accountSubaccount && t.accountSubaccount.trim()) {
                                                                                const hexStr = t.accountSubaccount.trim().replace(/^0x/, '');
                                                                                const bytes = new Uint8Array(32);
                                                                                const hexBytes = hexStr.match(/.{1,2}/g) || [];
                                                                                for (let j = 0; j < Math.min(hexBytes.length, 32); j++) {
                                                                                    bytes[32 - hexBytes.length + j] = parseInt(hexBytes[j], 16);
                                                                                }
                                                                                subaccount = [bytes];
                                                                            }
                                                                            const pctStr = t.basisPoints;
                                                                            const basisPoints = (pctStr && pctStr !== '' && parseFloat(pctStr) > 0)
                                                                                ? [BigInt(Math.round(parseFloat(pctStr) * 100))]
                                                                                : [];
                                                                            return {
                                                                                account: { owner, subaccount },
                                                                                basisPoints,
                                                                            };
                                                                        });

                                                                        // Build source subaccount
                                                                        let sourceSubaccount = [];
                                                                        if (editingDistList.sourceSubaccount && editingDistList.sourceSubaccount.trim()) {
                                                                            const hexStr = editingDistList.sourceSubaccount.trim().replace(/^0x/, '');
                                                                            const bytes = new Uint8Array(32);
                                                                            const hexBytes = hexStr.match(/.{1,2}/g) || [];
                                                                            for (let j = 0; j < Math.min(hexBytes.length, 32); j++) {
                                                                                bytes[32 - hexBytes.length + j] = parseInt(hexBytes[j], 16);
                                                                            }
                                                                            sourceSubaccount = [bytes];
                                                                        }

                                                                        const input = {
                                                                            name: editingDistList.name.trim(),
                                                                            sourceSubaccount,
                                                                            tokenLedgerCanisterId: Principal.fromText(editingDistList.tokenLedgerCanisterId.trim()),
                                                                            thresholdAmount: BigInt(Math.round(parseFloat(editingDistList.thresholdAmount || '0') * divisor)),
                                                                            maxDistributionAmount: BigInt(Math.round(parseFloat(editingDistList.maxDistributionAmount || '0') * divisor)),
                                                                            targets,
                                                                        };

                                                                        const agent = getAgent();
                                                                        if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') await agent.fetchRootKey();
                                                                        const manager = createManagerActor(canisterId, { agent });

                                                                        if (editingDistListId !== null) {
                                                                            await manager.updateDistributionList(chore.choreId, BigInt(editingDistListId), input);
                                                                            setChoreSuccess(`Distribution list "${input.name}" updated.`);
                                                                        } else {
                                                                            const newId = await manager.addDistributionList(chore.choreId, input);
                                                                            setChoreSuccess(`Distribution list "${input.name}" created (ID: ${Number(newId)}).`);
                                                                        }
                                                                        setEditingDistList(null);
                                                                        setEditingDistListId(null);
                                                                        await loadChoreData();
                                                                    } catch (err) {
                                                                        setChoreError('Failed to save distribution list: ' + err.message);
                                                                    } finally { setSavingChore(false); }
                                                                }}
                                                            >
                                                                {editingDistListId !== null ? 'Save Changes' : 'Create List'}
                                                            </button>
                                                            <button
                                                                style={{ ...buttonStyle, background: 'transparent', color: theme.colors.secondaryText, border: `1px solid ${theme.colors.border}` }}
                                                                onClick={() => { setEditingDistList(null); setEditingDistListId(null); }}
                                                            >Cancel</button>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                            );
                                            })()}
                                        </div>
                                        )}

                                        {/* Instance management: rename / delete (for multi-instance types or non-default instances) */}
                                        {hasMultiple && chore.choreId !== (chore.choreTypeId || chore.choreId) && (
                                        <div style={{ marginTop: '16px', paddingTop: '12px', borderTop: `1px solid ${theme.colors.border}`, display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                                            {renamingInstance === chore.choreId ? (
                                                <>
                                                <input
                                                    type="text"
                                                    value={renameLabel}
                                                    onChange={e => setRenameLabel(e.target.value)}
                                                    style={{ ...inputStyle, flex: 1, minWidth: '140px', fontSize: '0.8rem' }}
                                                    autoFocus
                                                />
                                                <button
                                                    style={{ ...buttonStyle, fontSize: '0.75rem', background: `${neuronPrimary}10`, color: neuronPrimary, border: `1px solid ${neuronPrimary}25`, opacity: !renameLabel.trim() || savingChore ? 0.5 : 1 }}
                                                    disabled={!renameLabel.trim() || savingChore}
                                                    onClick={async () => {
                                                        setSavingChore(true);
                                                        try {
                                                            const agent = getAgent();
                                                            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') await agent.fetchRootKey();
                                                            const manager = createManagerActor(canisterId, { agent });
                                                            await manager.renameChoreInstance(chore.choreId, renameLabel.trim());
                                                            setRenamingInstance(null);
                                                            setChoreSuccess('Instance renamed.');
                                                            await loadChoreData();
                                                        } catch (err) { setChoreError('Rename failed: ' + err.message); }
                                                        finally { setSavingChore(false); }
                                                    }}
                                                >Save</button>
                                                <button
                                                    style={{ ...buttonStyle, fontSize: '0.75rem', background: 'transparent', color: theme.colors.mutedText, border: `1px solid ${theme.colors.border}` }}
                                                    onClick={() => setRenamingInstance(null)}
                                                >Cancel</button>
                                                </>
                                            ) : (
                                                <>
                                                <button
                                                    style={{ ...buttonStyle, fontSize: '0.75rem', background: 'transparent', color: theme.colors.secondaryText, border: `1px solid ${theme.colors.border}` }}
                                                    onClick={() => { setRenamingInstance(chore.choreId); setRenameLabel(chore.instanceLabel || chore.choreName); }}
                                                >Rename</button>
                                                {!chore.enabled && (
                                                <button
                                                    style={{ ...buttonStyle, fontSize: '0.75rem', background: `${theme.colors.error || '#ef4444'}10`, color: theme.colors.error || '#ef4444', border: `1px solid ${theme.colors.error || '#ef4444'}25` }}
                                                    disabled={savingChore}
                                                    onClick={async () => {
                                                        if (!window.confirm(`Delete instance "${chore.instanceLabel || chore.choreName}"?`)) return;
                                                        setSavingChore(true);
                                                        try {
                                                            const agent = getAgent();
                                                            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') await agent.fetchRootKey();
                                                            const manager = createManagerActor(canisterId, { agent });
                                                            const ok = await manager.deleteChoreInstance(chore.choreId);
                                                            if (ok) {
                                                                setChoreSuccess('Instance deleted.');
                                                                setChoreActiveInstance(null);
                                                                await loadChoreData();
                                                            } else { setChoreError('Failed to delete instance. Make sure it is stopped first.'); }
                                                        } catch (err) { setChoreError('Delete failed: ' + err.message); }
                                                        finally { setSavingChore(false); }
                                                    }}
                                                >Delete</button>
                                                )}
                                                </>
                                            )}
                                        </div>
                                        )}
                                    </div>
                                );
                            })()}
                            </>
                            );
                            })()}

                            {choreStatuses.length === 0 && !loadingChores && (
                                <div style={{
                                    ...cardStyle,
                                    textAlign: 'center',
                                    color: theme.colors.secondaryText,
                                    fontSize: '0.85rem',
                                }}>
                                    No chores available. This bot version may not support automated chores yet.
                                </div>
                            )}
                            </>
                            )}
                        </div>
                        )}

                                </div>
                            )}
                        </div>

                        {/* Message for users with no access at all (not controller, no botkey permissions) */}
                        {!isInvalidManager && !hasAnyPermission && !userPermissionsLoading && (
                            <div className="neuron-mgr-fade-in" style={{
                                ...cardStyle,
                                background: `linear-gradient(135deg, ${theme.colors.warning}10, ${theme.colors.warning}05)`,
                                border: `1px solid ${theme.colors.warning || '#f59e0b'}30`,
                                textAlign: 'center',
                                padding: '2rem 1.5rem',
                            }}>
                                <div style={{ 
                                    width: '56px',
                                    height: '56px',
                                    borderRadius: '14px',
                                    background: `${theme.colors.warning}20`,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    margin: '0 auto 1rem',
                                    fontSize: '24px'
                                }}>
                                    🔒
                                </div>
                                <h3 style={{ color: theme.colors.primaryText, margin: '0 0 0.5rem 0', fontSize: '1.1rem', fontWeight: '600' }}>
                                    No Access
                                </h3>
                                <p style={{ color: theme.colors.secondaryText, margin: 0, fontSize: '0.9rem', lineHeight: '1.6' }}>
                                    You are not a controller of this Staking Bot and have no botkey permissions.
                                    <br />
                                    Controllers or principals with botkey access can manage neurons and perform operations.
                                </p>
                            </div>
                        )}

                        {/* Show neuron management sections if canister is a valid manager AND user has any access (controller or botkey) */}
                        {!isInvalidManager && hasAnyPermission && (
                        <>
                        {/* ============================================ */}
                        {/* NEURONS SECTION */}
                        {/* ============================================ */}
                        <div className="neuron-mgr-fade-in" style={{ marginBottom: '1.25rem' }}>
                            {/* Section Header */}
                            <button
                                onClick={() => setNeuronSectionExpanded(!neuronSectionExpanded)}
                                style={{
                                    width: '100%',
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'center',
                                    padding: '1rem 1.25rem',
                                    background: neuronSectionExpanded 
                                        ? `linear-gradient(90deg, ${neuronPrimary}15 0%, transparent 100%)`
                                        : theme.colors.cardGradient,
                                    border: `1px solid ${theme.colors.border}`,
                                    borderRadius: neuronSectionExpanded ? '14px 14px 0 0' : '14px',
                                    cursor: 'pointer',
                                    color: theme.colors.primaryText,
                                    transition: 'all 0.2s',
                                    boxShadow: theme.colors.cardShadow,
                                }}
                            >
                                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                    <div style={{
                                        width: '36px',
                                        height: '36px',
                                        borderRadius: '10px',
                                        background: `linear-gradient(135deg, ${neuronPrimary}30, ${neuronPrimary}10)`,
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        fontSize: '18px'
                                    }}>
                                        🧠
                                    </div>
                                    <span style={{ fontSize: '1.05rem', fontWeight: '600' }}>Neurons</span>
                                    <span style={{ 
                                        fontSize: '0.75rem', 
                                        color: neuronIds.length > 0 ? theme.colors.success : theme.colors.warning,
                                        backgroundColor: neuronIds.length > 0 ? `${theme.colors.success}15` : `${theme.colors.warning}15`,
                                        padding: '4px 10px',
                                        borderRadius: '8px',
                                        fontWeight: '600'
                                    }}>
                                        {neuronIds.length} neuron{neuronIds.length !== 1 ? 's' : ''}
                                    </span>
                                </div>
                                <span style={{ 
                                    fontSize: '14px',
                                    transform: neuronSectionExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                                    transition: 'transform 0.2s ease',
                                    color: theme.colors.mutedText,
                                }}>
                                    {neuronSectionExpanded ? <FaChevronUp /> : <FaChevronDown />}
                                </span>
                            </button>
                            
                            {/* Section Content */}
                            {neuronSectionExpanded && (
                                <div style={{ 
                                    border: `1px solid ${theme.colors.border}`,
                                    borderTop: 'none',
                                    borderRadius: '0 0 12px 12px',
                                    overflow: 'hidden',
                                    padding: '20px',
                                }}>

                        {/* Success/Error Messages */}
                        {success && (
                            <div style={{ 
                                backgroundColor: `${theme.colors.success || '#22c55e'}20`, 
                                border: `1px solid ${theme.colors.success || '#22c55e'}`,
                                color: theme.colors.success || '#22c55e',
                                padding: '15px',
                                borderRadius: '8px',
                                marginBottom: '20px',
                            }}>
                                {success}
                            </div>
                        )}
                        {error && (
                            <div style={{ 
                                backgroundColor: `${theme.colors.error}20`, 
                                border: `1px solid ${theme.colors.error}`,
                                color: theme.colors.error,
                                padding: '15px',
                                borderRadius: '8px',
                                marginBottom: '20px',
                            }}>
                                {error}
                            </div>
                        )}

                        {/* Neuron Selector - when there are multiple neurons */}
                        {neuronIds.length > 0 && (
                            <div style={cardStyle}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
                                    <div>
                                        <h3 style={{ color: theme.colors.primaryText, margin: '0 0 5px 0' }}>
                                            {neuronIds.length} Neuron{neuronIds.length > 1 ? 's' : ''} Managed
                                        </h3>
                                        <p style={{ color: theme.colors.mutedText, fontSize: '12px', margin: 0 }}>
                                            Select a neuron to manage
                                        </p>
                                    </div>
                                    <select
                                        value={selectedNeuronId ? selectedNeuronId.id.toString() : ''}
                                        onChange={(e) => {
                                            const found = neuronIds.find(n => n.id.toString() === e.target.value);
                                            handleNeuronSelect(found);
                                        }}
                                        style={{
                                            ...inputStyle,
                                            width: 'auto',
                                            minWidth: '200px',
                                        }}
                                    >
                                        {neuronIds.map((n) => (
                                            <option key={n.id.toString()} value={n.id.toString()}>
                                                Neuron #{n.id.toString()}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                                
                                {/* Neuron list */}
                                <div style={{ marginTop: '15px', maxHeight: '200px', overflowY: 'auto' }}>
                                    {neuronIds.map((n) => (
                                        <div 
                                            key={n.id.toString()} 
                                            style={{ 
                                                display: 'flex', 
                                                justifyContent: 'space-between', 
                                                alignItems: 'center',
                                                padding: '8px 12px',
                                                background: selectedNeuronId && selectedNeuronId.id === n.id ? `${theme.colors.accent}20` : 'transparent',
                                                borderRadius: '6px',
                                                marginBottom: '4px',
                                                cursor: 'pointer',
                                            }}
                                            onClick={() => handleNeuronSelect(n)}
                                        >
                                            <span style={{ color: theme.colors.primaryText, fontFamily: 'monospace' }}>
                                                Neuron #{n.id.toString()}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Create Neuron Section - Only for principals with StakeNeuron permission */}
                        {hasPermission('StakeNeuron') && (
                        <div style={{ marginBottom: '1rem' }}>
                            {/* Section Header */}
                            <button
                                onClick={() => setCreateNeuronExpanded(!createNeuronExpanded)}
                                style={{
                                    width: '100%',
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'center',
                                    padding: '1rem 1.25rem',
                                    background: (createNeuronExpanded || neuronIds.length === 0)
                                        ? `linear-gradient(90deg, ${theme.colors.success}15 0%, transparent 100%)`
                                        : theme.colors.cardGradient,
                                    border: `1px solid ${neuronIds.length === 0 ? theme.colors.success : theme.colors.border}30`,
                                    borderRadius: (createNeuronExpanded || neuronIds.length === 0) ? '14px 14px 0 0' : '14px',
                                    cursor: 'pointer',
                                    color: theme.colors.primaryText,
                                    transition: 'all 0.2s',
                                    boxShadow: theme.colors.cardShadow,
                                }}
                            >
                                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                    <div style={{
                                        width: '36px',
                                        height: '36px',
                                        borderRadius: '10px',
                                        background: `linear-gradient(135deg, ${theme.colors.success}30, ${theme.colors.success}10)`,
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        fontSize: '16px'
                                    }}>
                                        ➕
                                    </div>
                                    <span style={{ fontSize: '1.05rem', fontWeight: '600' }}>
                                        {neuronIds.length === 0 ? 'Create Your First Neuron' : 'Create Another Neuron'}
                                    </span>
                                </div>
                                <span style={{ 
                                    fontSize: '14px',
                                    transform: (createNeuronExpanded || neuronIds.length === 0) ? 'rotate(180deg)' : 'rotate(0deg)',
                                    transition: 'transform 0.2s ease',
                                    color: theme.colors.mutedText,
                                }}>
                                    {(createNeuronExpanded || neuronIds.length === 0) ? <FaChevronUp /> : <FaChevronDown />}
                                </span>
                            </button>
                            
                            {/* Section Content - auto-expand if no neurons */}
                            {(createNeuronExpanded || neuronIds.length === 0) && (
                                <div style={{
                                    border: `1px solid ${theme.colors.border}`,
                                    borderTop: 'none',
                                    borderRadius: '0 0 14px 14px',
                                    padding: '1.25rem',
                                    background: theme.colors.cardGradient,
                                }}>
                                    <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: '1rem' }}>
                                        <div style={{ flex: 1, minWidth: '140px' }}>
                                            <label style={{ color: theme.colors.mutedText, fontSize: '0.75rem', display: 'block', marginBottom: '6px' }}>
                                                Amount to Stake (ICP)
                                            </label>
                                            <input
                                                type="text"
                                                inputMode="decimal"
                                                value={stakeAmount}
                                                onChange={(e) => setStakeAmount(e.target.value)}
                                                style={inputStyle}
                                                placeholder="1.0"
                                            />
                                        </div>
                                        <div style={{ flex: 1, minWidth: '140px' }}>
                                            <label style={{ color: theme.colors.mutedText, fontSize: '0.75rem', display: 'block', marginBottom: '6px' }}>
                                                Dissolve Delay (days)
                                            </label>
                                            <input
                                                type="text"
                                                inputMode="numeric"
                                                value={stakeDissolveDelay}
                                                onChange={(e) => setStakeDissolveDelay(e.target.value)}
                                                style={inputStyle}
                                                placeholder="365"
                                            />
                                        </div>
                                        <button
                                            onClick={handleStakeNeuron}
                                            disabled={actionLoading === 'stake' || !userIcpBalance || userIcpBalance < E8S}
                                            style={{ 
                                                ...buttonStyle, 
                                                opacity: (actionLoading === 'stake' || !userIcpBalance || userIcpBalance < E8S) ? 0.6 : 1,
                                                background: `linear-gradient(135deg, ${theme.colors.success}, ${theme.colors.success}dd)`,
                                                boxShadow: `0 4px 12px ${theme.colors.success}30`,
                                            }}
                                        >
                                            {actionLoading === 'stake' ? '⏳...' : '🚀 Create Neuron'}
                                        </button>
                                    </div>
                                    <p style={{ color: theme.colors.mutedText, fontSize: '0.75rem', margin: 0 }}>
                                        💡 Min 183 days to vote, max 8 years. Stakes directly from your wallet ({formatIcp(userIcpBalance)} ICP available)
                                    </p>
                                </div>
                            )}
                        </div>
                        )}

                        {/* Selected Neuron - Show tabs */}
                        {selectedNeuronId && (
                            <>
                                {/* Neuron Summary */}
                                <div style={{
                                    ...cardStyle,
                                    background: `linear-gradient(135deg, ${neuronPrimary}08, ${theme.colors.cardGradient || theme.colors.cardBackground})`,
                                    border: `1px solid ${neuronPrimary}25`,
                                }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '1rem', flexWrap: 'wrap' }}>
                                        <div style={{
                                            width: '40px',
                                            height: '40px',
                                            borderRadius: '10px',
                                            background: `linear-gradient(135deg, ${neuronPrimary}30, ${neuronPrimary}10)`,
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            fontSize: '20px',
                                            flexShrink: 0
                                        }}>
                                            🧠
                                        </div>
                                        <h2 style={{ color: theme.colors.primaryText, margin: 0, fontSize: '1.15rem', fontWeight: '600' }}>
                                            Neuron #{selectedNeuronId.id.toString()}
                                        </h2>
                                        {neuronInfo && (
                                            <span style={{
                                                background: getNeuronState(neuronInfo.state).color,
                                                color: '#fff',
                                                padding: '4px 12px',
                                                borderRadius: '20px',
                                                fontSize: '0.75rem',
                                                fontWeight: '600',
                                            }}>
                                                {getNeuronState(neuronInfo.state).label}
                                            </span>
                                        )}
                                    </div>
                                    
                                    {neuronInfo && (
                                        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                                            <div style={statBoxStyle}>
                                                <div style={{ color: theme.colors.mutedText, fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px' }}>Stake</div>
                                                <div style={{ color: theme.colors.primaryText, fontSize: '1.1rem', fontWeight: '700' }}>
                                                    {formatIcp(Number(neuronInfo.stake_e8s))} ICP
                                                </div>
                                            </div>
                                            <div style={statBoxStyle}>
                                                <div style={{ color: theme.colors.mutedText, fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px' }}>Voting Power</div>
                                                <div style={{ color: theme.colors.primaryText, fontSize: '1.1rem', fontWeight: '700' }}>
                                                    {formatIcp(Number(neuronInfo.voting_power))}
                                                </div>
                                            </div>
                                            <div style={statBoxStyle}>
                                                <div style={{ color: theme.colors.mutedText, fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px' }}>Dissolve Delay</div>
                                                <div style={{ color: theme.colors.primaryText, fontSize: '1.1rem', fontWeight: '700' }}>
                                                    {formatDuration(Number(neuronInfo.dissolve_delay_seconds))}
                                                </div>
                                            </div>
                                            <div style={statBoxStyle}>
                                                <div style={{ color: theme.colors.mutedText, fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px' }}>Age</div>
                                                <div style={{ color: theme.colors.primaryText, fontSize: '1.1rem', fontWeight: '700' }}>
                                                    {formatDuration(Number(neuronInfo.age_seconds))}
                                                </div>
                                            </div>
                                            {fullNeuron && (
                                                <div style={statBoxStyle}>
                                                    <div style={{ color: theme.colors.mutedText, fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px' }}>Maturity</div>
                                                    <div style={{ color: theme.colors.primaryText, fontSize: '1.1rem', fontWeight: '700' }}>
                                                        {formatIcp(Number(fullNeuron.maturity_e8s_equivalent))} ICP
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>

                                {/* Tabs */}
                                <div style={{ 
                                    display: 'flex', 
                                    marginBottom: '1.25rem', 
                                    flexWrap: 'wrap',
                                    gap: '0'
                                }}>
                                    <button style={tabStyle(activeTab === 'overview')} onClick={() => setActiveTab('overview')}>
                                        Overview
                                    </button>
                                    {/* Management tabs - shown based on user permissions */}
                                    {hasTabAccess('stake') && (
                                        <button style={tabStyle(activeTab === 'stake')} onClick={() => setActiveTab('stake')}>
                                            Stake
                                        </button>
                                    )}
                                    {hasTabAccess('maturity') && (
                                        <button style={tabStyle(activeTab === 'maturity')} onClick={() => setActiveTab('maturity')}>
                                            Maturity
                                        </button>
                                    )}
                                    {hasTabAccess('following') && (
                                        <button style={tabStyle(activeTab === 'following')} onClick={() => setActiveTab('following')}>
                                            Following
                                        </button>
                                    )}
                                    {hasTabAccess('dissolve') && (
                                        <button style={tabStyle(activeTab === 'dissolve')} onClick={() => setActiveTab('dissolve')}>
                                            Dissolve
                                        </button>
                                    )}
                                    {hasTabAccess('disburse') && (
                                        <button style={tabStyle(activeTab === 'disburse')} onClick={() => setActiveTab('disburse')}>
                                            Disburse
                                        </button>
                                    )}
                                    {hasTabAccess('hotkeys') && (
                                        <button style={tabStyle(activeTab === 'hotkeys')} onClick={() => setActiveTab('hotkeys')}>
                                            Hot Keys
                                        </button>
                                    )}
                                    {hasTabAccess('advanced') && (
                                        <button style={tabStyle(activeTab === 'advanced')} onClick={() => setActiveTab('advanced')}>
                                            Advanced
                                        </button>
                                    )}
                                </div>

                                {/* Tab Content */}
                                {activeTab === 'overview' && (
                                    <div style={cardStyle}>
                                        <h3 style={{ color: theme.colors.primaryText, marginBottom: '15px' }}>Neuron Overview</h3>
                                        
                                        {/* Dissolving Status Alert */}
                                        {neuronInfo && neuronInfo.state === 2 && (
                                            <div style={{ 
                                                background: `${theme.colors.warning || '#f59e0b'}15`, 
                                                border: `1px solid ${theme.colors.warning || '#f59e0b'}40`,
                                                padding: '12px 15px', 
                                                borderRadius: '8px',
                                                marginBottom: '15px'
                                            }}>
                                                <div style={{ 
                                                    display: 'flex', 
                                                    alignItems: 'center', 
                                                    gap: '8px',
                                                    color: theme.colors.warning || '#f59e0b',
                                                    fontWeight: '600',
                                                    fontSize: '14px',
                                                    marginBottom: '4px'
                                                }}>
                                                    ⏳ Dissolving
                                                </div>
                                                <div style={{ color: theme.colors.primaryText, fontSize: '13px' }}>
                                                    <strong>{formatDuration(Number(neuronInfo.dissolve_delay_seconds))}</strong> remaining until dissolved
                                                </div>
                                            </div>
                                        )}

                                        {/* Details Grid */}
                                        <div style={{ display: 'grid', gap: '8px' }}>
                                            {fullNeuron && (
                                                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: `1px solid ${theme.colors.border}` }}>
                                                    <span style={{ color: theme.colors.mutedText, fontSize: '13px' }}>Visibility</span>
                                                    <span style={{ 
                                                        color: fullNeuron.visibility?.[0] === 2 ? (theme.colors.success || '#22c55e') : theme.colors.primaryText, 
                                                        fontSize: '13px',
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: '4px'
                                                    }}>
                                                        {fullNeuron.visibility?.[0] === 2 ? '🌐 Public' : '🔒 Private'}
                                                    </span>
                                                </div>
                                            )}
                                            {fullNeuron && (
                                                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: `1px solid ${theme.colors.border}` }}>
                                                    <span style={{ color: theme.colors.mutedText, fontSize: '13px' }}>Controller</span>
                                                    <span style={{ color: theme.colors.primaryText, fontFamily: 'monospace', fontSize: '12px' }}>
                                                        {fullNeuron.controller?.[0]?.toText() 
                                                            ? `${fullNeuron.controller[0].toText().slice(0, 10)}...${fullNeuron.controller[0].toText().slice(-5)}`
                                                            : 'N/A'}
                                                    </span>
                                                </div>
                                            )}
                                            {fullNeuron && (
                                                <>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: `1px solid ${theme.colors.border}` }}>
                                                        <span style={{ color: theme.colors.mutedText, fontSize: '13px' }}>Available Maturity</span>
                                                        <span style={{ color: theme.colors.primaryText, fontSize: '13px' }}>
                                                            {formatIcp(Number(fullNeuron.maturity_e8s_equivalent))} ICP
                                                        </span>
                                                    </div>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: `1px solid ${theme.colors.border}` }}>
                                                        <span style={{ color: theme.colors.mutedText, fontSize: '13px' }}>Staked Maturity</span>
                                                        <span style={{ color: theme.colors.primaryText, fontSize: '13px' }}>
                                                            {fullNeuron.staked_maturity_e8s_equivalent?.[0] 
                                                                ? formatIcp(Number(fullNeuron.staked_maturity_e8s_equivalent[0])) + ' ICP' 
                                                                : '0 ICP'}
                                                        </span>
                                                    </div>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: `1px solid ${theme.colors.border}` }}>
                                                        <span style={{ color: theme.colors.mutedText, fontSize: '13px' }}>Hotkeys</span>
                                                        <span style={{ color: theme.colors.primaryText, fontSize: '13px' }}>
                                                            {fullNeuron.hot_keys?.length || 0}
                                                        </span>
                                                    </div>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0' }}>
                                                        <span style={{ color: theme.colors.mutedText, fontSize: '13px' }}>Following Topics</span>
                                                        <span style={{ color: theme.colors.primaryText, fontSize: '13px' }}>
                                                            {fullNeuron.followees?.length || 0}
                                                        </span>
                                                    </div>
                                                </>
                                            )}
                                        </div>
                                        
                                        {/* Link to IC Dashboard */}
                                        {selectedNeuronId && (
                                            <div style={{ marginTop: '15px' }}>
                                                <a 
                                                    href={`https://dashboard.internetcomputer.org/neuron/${selectedNeuronId.id.toString()}`}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    style={{ 
                                                        color: theme.colors.accent, 
                                                        fontSize: '13px',
                                                        textDecoration: 'none',
                                                        display: 'inline-flex',
                                                        alignItems: 'center',
                                                        gap: '6px'
                                                    }}
                                                    onMouseEnter={(e) => e.target.style.textDecoration = 'underline'}
                                                    onMouseLeave={(e) => e.target.style.textDecoration = 'none'}
                                                >
                                                    🔗 View on IC Dashboard →
                                                </a>
                                            </div>
                                        )}
                                        
                                        <div style={{ marginTop: '15px' }}>
                                            <button 
                                                onClick={fetchManagerData}
                                                style={secondaryButtonStyle}
                                            >
                                                🔄 Refresh Data
                                            </button>
                                        </div>
                                    </div>
                                )}

                                {activeTab === 'dissolve' && hasTabAccess('dissolve') && (
                                    <div style={cardStyle}>
                                        <h3 style={{ color: theme.colors.primaryText, marginBottom: '15px' }}>Dissolve Management</h3>
                                        
                                        {/* Current dissolve delay info */}
                                        {neuronInfo && (
                                            <div style={{ 
                                                background: `${theme.colors.accent}10`, 
                                                padding: '12px', 
                                                borderRadius: '8px', 
                                                marginBottom: '20px' 
                                            }}>
                                                <div style={{ color: theme.colors.mutedText, fontSize: '12px' }}>Current Dissolve Delay</div>
                                                <div style={{ color: theme.colors.primaryText, fontSize: '18px', fontWeight: '600' }}>
                                                    {formatDuration(Number(neuronInfo.dissolve_delay_seconds))}
                                                    <span style={{ color: theme.colors.mutedText, fontSize: '12px', marginLeft: '8px' }}>
                                                        ({Math.floor(Number(neuronInfo.dissolve_delay_seconds) / 86400)} days)
                                                    </span>
                                                </div>
                                            </div>
                                        )}
                                        
                                        {/* Increase Dissolve Delay */}
                                        <PermissionGate permKey="ConfigureDissolveState">
                                        <div style={{ marginBottom: '25px' }}>
                                            <h4 style={{ color: theme.colors.primaryText, fontSize: '14px', marginBottom: '10px' }}>Increase Dissolve Delay</h4>
                                            <p style={{ color: theme.colors.mutedText, fontSize: '13px', marginBottom: '10px' }}>
                                                <strong>Note:</strong> This <em>adds</em> to your current delay. Max total is 8 years (2922 days).
                                            </p>
                                            <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                                                <div style={{ flex: 1, minWidth: '150px' }}>
                                                    <label style={{ color: theme.colors.mutedText, fontSize: '12px', display: 'block', marginBottom: '4px' }}>
                                                        Days to Add
                                                    </label>
                                                    <input
                                                        type="text"
                                                        inputMode="numeric"
                                                        value={dissolveDelay}
                                                        onChange={(e) => setDissolveDelay(e.target.value)}
                                                        style={inputStyle}
                                                        placeholder="e.g., 365"
                                                    />
                                                </div>
                                                <button
                                                    onClick={handleSetDissolveDelay}
                                                    disabled={actionLoading === 'dissolve'}
                                                    style={{ 
                                                        ...buttonStyle, 
                                                        opacity: actionLoading === 'dissolve' ? 0.6 : 1,
                                                    }}
                                                >
                                                    {actionLoading === 'dissolve' ? '⏳...' : '+ Add Days'}
                                                </button>
                                            </div>
                                            {dissolveDelay && neuronInfo && (
                                                <p style={{ color: theme.colors.accent, fontSize: '12px', marginTop: '8px' }}>
                                                    New total will be: {formatDuration(Number(neuronInfo.dissolve_delay_seconds) + parseInt(dissolveDelay) * 86400)}
                                                </p>
                                            )}
                                        </div>

                                        {/* Start/Stop Dissolving */}
                                        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                                            {/* State 1 = Locked, State 2 = Dissolving, State 3 = Dissolved */}
                                            <button
                                                onClick={handleStartDissolving}
                                                disabled={actionLoading === 'startDissolve' || !neuronInfo || neuronInfo.state !== 1}
                                                style={{ 
                                                    ...buttonStyle,
                                                    background: theme.colors.warning || '#f59e0b',
                                                    opacity: (actionLoading === 'startDissolve' || !neuronInfo || neuronInfo.state !== 1) ? 0.5 : 1,
                                                    cursor: (!neuronInfo || neuronInfo.state !== 1) ? 'not-allowed' : 'pointer',
                                                }}
                                            >
                                                {actionLoading === 'startDissolve' ? '⏳...' : '⏳ Start Dissolving'}
                                            </button>
                                            <button
                                                onClick={handleStopDissolving}
                                                disabled={actionLoading === 'stopDissolve' || !neuronInfo || neuronInfo.state !== 2}
                                                style={{ 
                                                    ...secondaryButtonStyle,
                                                    opacity: (actionLoading === 'stopDissolve' || !neuronInfo || neuronInfo.state !== 2) ? 0.5 : 1,
                                                    cursor: (!neuronInfo || neuronInfo.state !== 2) ? 'not-allowed' : 'pointer',
                                                }}
                                            >
                                                {actionLoading === 'stopDissolve' ? '⏳...' : '⏹️ Stop Dissolving'}
                                            </button>
                                        </div>
                                        {neuronInfo && neuronInfo.state === 3 && (
                                            <p style={{ color: theme.colors.success || '#22c55e', fontSize: '13px', marginTop: '10px' }}>
                                                ✅ Neuron is fully dissolved and ready to disburse.
                                            </p>
                                        )}
                                        </PermissionGate>
                                    </div>
                                )}

                                {activeTab === 'stake' && hasTabAccess('stake') && (
                                    <div style={cardStyle}>
                                        <h3 style={{ color: theme.colors.primaryText, marginBottom: '15px' }}>Stake Management</h3>
                                        
                                        {/* Current stake info */}
                                        {neuronInfo && (
                                            <div style={{ 
                                                background: `${theme.colors.accent}10`, 
                                                padding: '12px', 
                                                borderRadius: '8px', 
                                                marginBottom: '20px',
                                            }}>
                                                <div>
                                                    <div style={{ color: theme.colors.mutedText, fontSize: '12px' }}>Current Stake</div>
                                                    <div style={{ color: theme.colors.primaryText, fontSize: '18px', fontWeight: '600' }}>
                                                        {formatIcp(Number(neuronInfo.stake_e8s))} ICP
                                                    </div>
                                                </div>
                                            </div>
                                        )}

                                        {/* Neuron Deposit Account - for direct ICP transfers */}
                                        {fullNeuron && fullNeuron.account && (
                                            <div style={{ 
                                                background: `${theme.colors.accent}08`, 
                                                border: `1px solid ${theme.colors.border}`,
                                                padding: '14px', 
                                                borderRadius: '8px', 
                                                marginBottom: '20px',
                                            }}>
                                                <div style={{ color: theme.colors.primaryText, fontSize: '13px', fontWeight: '600', marginBottom: '8px' }}>
                                                    Neuron Deposit Account
                                                </div>
                                                <p style={{ color: theme.colors.mutedText, fontSize: '12px', marginBottom: '10px', marginTop: 0 }}>
                                                    Send ICP directly to this account to increase the neuron's stake. If the "Refresh Stake" chore is enabled, deposited ICP will be automatically picked up and staked. Otherwise, use the "Refresh Stake from NNS" button below after depositing.
                                                </p>
                                                {(() => {
                                                    try {
                                                        const governancePrincipal = Principal.fromText(NNS_GOVERNANCE_CANISTER_ID);
                                                        const subaccount = fullNeuron.account instanceof Uint8Array 
                                                            ? fullNeuron.account 
                                                            : new Uint8Array(fullNeuron.account);
                                                        const accountStr = encodeIcrcAccount({ 
                                                            owner: governancePrincipal, 
                                                            subaccount: subaccount 
                                                        });
                                                        return (
                                                            <div style={{ 
                                                                display: 'flex', 
                                                                alignItems: 'center', 
                                                                gap: '8px',
                                                                background: theme.colors.cardBg || theme.colors.background,
                                                                padding: '10px 12px',
                                                                borderRadius: '6px',
                                                                border: `1px solid ${theme.colors.border}`,
                                                            }}>
                                                                <code style={{ 
                                                                    color: theme.colors.primaryText, 
                                                                    fontSize: '11px', 
                                                                    fontFamily: 'monospace',
                                                                    wordBreak: 'break-all',
                                                                    flex: 1,
                                                                    lineHeight: '1.4',
                                                                }}>
                                                                    {accountStr}
                                                                </code>
                                                                <button
                                                                    onClick={() => {
                                                                        copyToClipboard(accountStr);
                                                                        setSuccess('Neuron deposit account copied to clipboard!');
                                                                        setTimeout(() => setSuccess(''), 3000);
                                                                    }}
                                                                    title="Copy account to clipboard"
                                                                    style={{
                                                                        background: theme.colors.accent,
                                                                        color: '#fff',
                                                                        border: 'none',
                                                                        borderRadius: '4px',
                                                                        padding: '6px 10px',
                                                                        fontSize: '11px',
                                                                        cursor: 'pointer',
                                                                        whiteSpace: 'nowrap',
                                                                        flexShrink: 0,
                                                                    }}
                                                                >
                                                                    Copy
                                                                </button>
                                                            </div>
                                                        );
                                                    } catch (e) {
                                                        return (
                                                            <div style={{ color: theme.colors.mutedText, fontSize: '12px' }}>
                                                                Unable to compute account: {e.message}
                                                            </div>
                                                        );
                                                    }
                                                })()}
                                            </div>
                                        )}
                                        
                                        {/* Increase Stake - permissionless (sends ICP from user's wallet, not canister funds) */}
                                        <div style={{ marginBottom: '30px' }}>
                                            <h4 style={{ color: theme.colors.primaryText, fontSize: '14px', marginBottom: '10px' }}>Increase Stake</h4>
                                            <p style={{ color: theme.colors.mutedText, fontSize: '13px', marginBottom: '15px' }}>
                                                Add more ICP to your neuron directly from your wallet. More stake = more voting power.
                                            </p>
                                            <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                                                <div style={{ flex: 1, minWidth: '150px' }}>
                                                    <label style={{ color: theme.colors.mutedText, fontSize: '12px', display: 'block', marginBottom: '6px' }}>
                                                        Amount (ICP)
                                                    </label>
                                                    <input
                                                        type="text"
                                                        inputMode="decimal"
                                                        value={increaseStakeAmount}
                                                        onChange={(e) => setIncreaseStakeAmount(e.target.value)}
                                                        style={inputStyle}
                                                        placeholder="e.g., 1.0"
                                                    />
                                                </div>
                                                <button
                                                    onClick={handleIncreaseStake}
                                                    disabled={actionLoading === 'increaseStake' || !userIcpBalance || userIcpBalance < E8S * 0.01}
                                                    style={{ 
                                                        ...buttonStyle, 
                                                        opacity: (actionLoading === 'increaseStake' || !userIcpBalance || userIcpBalance < E8S * 0.01) ? 0.6 : 1,
                                                    }}
                                                >
                                                    {actionLoading === 'increaseStake' ? '⏳...' : '➕ Add to Stake'}
                                                </button>
                                            </div>
                                            <p style={{ color: theme.colors.mutedText, fontSize: '11px', marginTop: '8px' }}>
                                                Your wallet: {formatIcp(userIcpBalance)} ICP available
                                            </p>
                                            
                                            {/* Manual Refresh Button */}
                                            <div style={{ marginTop: '15px', paddingTop: '15px', borderTop: `1px dashed ${theme.colors.border}` }}>
                                                <button
                                                    onClick={handleManualRefreshStake}
                                                    disabled={actionLoading === 'refreshStake'}
                                                    style={{ 
                                                        background: 'transparent',
                                                        color: theme.colors.accent,
                                                        border: `1px solid ${theme.colors.accent}`,
                                                        borderRadius: '6px',
                                                        padding: '6px 12px',
                                                        fontSize: '12px',
                                                        cursor: actionLoading === 'refreshStake' ? 'not-allowed' : 'pointer',
                                                        opacity: actionLoading === 'refreshStake' ? 0.6 : 1,
                                                    }}
                                                >
                                                    {actionLoading === 'refreshStake' ? '⏳ Refreshing...' : '🔄 Refresh Stake from NNS'}
                                                </button>
                                                <p style={{ color: theme.colors.mutedText, fontSize: '10px', marginTop: '5px', marginBottom: 0 }}>
                                                    Use this if you sent ICP to the neuron externally or if stake doesn't update automatically
                                                </p>
                                            </div>
                                        </div>

                                        {/* Auto-stake Maturity */}
                                        <PermissionGate permKey="AutoStakeMaturity">
                                        <div style={{ borderTop: `1px solid ${theme.colors.border}`, paddingTop: '20px' }}>
                                            <h4 style={{ color: theme.colors.primaryText, fontSize: '14px', marginBottom: '10px' }}>Auto-Stake Maturity</h4>
                                            <p style={{ color: theme.colors.mutedText, fontSize: '13px', marginBottom: '15px' }}>
                                                When enabled, maturity rewards are automatically staked to your neuron instead of accumulating.
                                            </p>
                                            
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                                                <div style={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '10px',
                                                    padding: '10px 15px',
                                                    background: `${theme.colors.accent}10`,
                                                    borderRadius: '8px',
                                                }}>
                                                    <span style={{ color: theme.colors.mutedText, fontSize: '13px' }}>Current:</span>
                                                    <span style={{ 
                                                        color: fullNeuron?.auto_stake_maturity?.[0] ? (theme.colors.success || '#22c55e') : theme.colors.mutedText,
                                                        fontWeight: '600',
                                                    }}>
                                                        {fullNeuron?.auto_stake_maturity?.[0] ? '✅ Enabled' : '❌ Disabled'}
                                                    </span>
                                                </div>
                                                
                                                {fullNeuron?.auto_stake_maturity?.[0] ? (
                                                    <button
                                                        onClick={() => handleToggleAutoStakeMaturity(false)}
                                                        disabled={actionLoading === 'autoStake'}
                                                        style={{ 
                                                            ...secondaryButtonStyle, 
                                                            opacity: actionLoading === 'autoStake' ? 0.6 : 1,
                                                        }}
                                                    >
                                                        {actionLoading === 'autoStake' ? '⏳...' : 'Disable'}
                                                    </button>
                                                ) : (
                                                    <button
                                                        onClick={() => handleToggleAutoStakeMaturity(true)}
                                                        disabled={actionLoading === 'autoStake'}
                                                        style={{ 
                                                            ...buttonStyle, 
                                                            opacity: actionLoading === 'autoStake' ? 0.6 : 1,
                                                        }}
                                                    >
                                                        {actionLoading === 'autoStake' ? '⏳...' : 'Enable'}
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                        </PermissionGate>
                                    </div>
                                )}

                                {activeTab === 'maturity' && hasTabAccess('maturity') && (
                                    <div style={cardStyle}>
                                        <h3 style={{ color: theme.colors.primaryText, marginBottom: '15px' }}>Maturity Management</h3>
                                        
                                        {/* Current maturity info */}
                                        <div style={{ 
                                            background: `${theme.colors.accent}10`, 
                                            padding: '15px', 
                                            borderRadius: '8px', 
                                            marginBottom: '25px',
                                            display: 'flex',
                                            gap: '30px',
                                            flexWrap: 'wrap',
                                        }}>
                                            <div>
                                                <div style={{ color: theme.colors.mutedText, fontSize: '12px' }}>Available Maturity</div>
                                                <div style={{ color: theme.colors.primaryText, fontSize: '20px', fontWeight: '700' }}>
                                                    {fullNeuron ? formatIcp(Number(fullNeuron.maturity_e8s_equivalent)) : '...'} ICP
                                                </div>
                                            </div>
                                            <div>
                                                <div style={{ color: theme.colors.mutedText, fontSize: '12px' }}>Staked Maturity</div>
                                                <div style={{ color: theme.colors.primaryText, fontSize: '20px', fontWeight: '700' }}>
                                                    {fullNeuron?.staked_maturity_e8s_equivalent?.[0] 
                                                        ? formatIcp(Number(fullNeuron.staked_maturity_e8s_equivalent[0])) 
                                                        : '0.00'} ICP
                                                </div>
                                            </div>
                                            <div>
                                                <div style={{ color: theme.colors.mutedText, fontSize: '12px' }}>Auto-Stake</div>
                                                <div style={{ 
                                                    color: fullNeuron?.auto_stake_maturity?.[0] ? (theme.colors.success || '#22c55e') : theme.colors.mutedText,
                                                    fontSize: '20px', 
                                                    fontWeight: '700' 
                                                }}>
                                                    {fullNeuron?.auto_stake_maturity?.[0] ? 'On' : 'Off'}
                                                </div>
                                            </div>
                                        </div>

                                        {/* Percentage input */}
                                        <div style={{ marginBottom: '20px' }}>
                                            <label style={{ color: theme.colors.mutedText, fontSize: '12px', display: 'block', marginBottom: '6px' }}>
                                                Percentage of Maturity
                                            </label>
                                            <input
                                                type="text"
                                                inputMode="numeric"
                                                value={maturityPercentage}
                                                onChange={(e) => setMaturityPercentage(e.target.value)}
                                                style={{ ...inputStyle, maxWidth: '150px' }}
                                                placeholder="100"
                                            />
                                            <span style={{ color: theme.colors.mutedText, fontSize: '12px', marginLeft: '8px' }}>%</span>
                                        </div>

                                        {/* Maturity Actions */}
                                        <div style={{ display: 'grid', gap: '20px' }}>
                                            {/* Stake Maturity */}
                                            <PermissionGate permKey="StakeMaturity">
                                            <div style={{ padding: '15px', border: `1px solid ${theme.colors.border}`, borderRadius: '8px' }}>
                                                <h4 style={{ color: theme.colors.primaryText, fontSize: '14px', marginBottom: '8px' }}>Stake Maturity</h4>
                                                <p style={{ color: theme.colors.mutedText, fontSize: '12px', marginBottom: '12px' }}>
                                                    Convert maturity to staked maturity. Staked maturity increases voting power but takes 7 days to become liquid.
                                                </p>
                                                <button
                                                    onClick={handleStakeMaturity}
                                                    disabled={actionLoading === 'stakeMaturity' || !fullNeuron || fullNeuron.maturity_e8s_equivalent === BigInt(0)}
                                                    style={{ 
                                                        ...buttonStyle, 
                                                        opacity: (actionLoading === 'stakeMaturity' || !fullNeuron || fullNeuron.maturity_e8s_equivalent === BigInt(0)) ? 0.6 : 1,
                                                    }}
                                                >
                                                    {actionLoading === 'stakeMaturity' ? '⏳...' : '📈 Stake Maturity'}
                                                </button>
                                            </div>
                                            </PermissionGate>

                                            {/* Merge Maturity */}
                                            <PermissionGate permKey="MergeMaturity">
                                            <div style={{ padding: '15px', border: `1px solid ${theme.colors.border}`, borderRadius: '8px' }}>
                                                <h4 style={{ color: theme.colors.primaryText, fontSize: '14px', marginBottom: '8px' }}>Merge Maturity</h4>
                                                <p style={{ color: theme.colors.mutedText, fontSize: '12px', marginBottom: '12px' }}>
                                                    Merge maturity directly into your neuron's stake. Increases stake permanently.
                                                </p>
                                                <button
                                                    onClick={handleMergeMaturity}
                                                    disabled={actionLoading === 'mergeMaturity' || !fullNeuron || fullNeuron.maturity_e8s_equivalent === BigInt(0)}
                                                    style={{ 
                                                        ...buttonStyle, 
                                                        opacity: (actionLoading === 'mergeMaturity' || !fullNeuron || fullNeuron.maturity_e8s_equivalent === BigInt(0)) ? 0.6 : 1,
                                                    }}
                                                >
                                                    {actionLoading === 'mergeMaturity' ? '⏳...' : '🔄 Merge into Stake'}
                                                </button>
                                            </div>
                                            </PermissionGate>

                                            {/* Spawn Maturity */}
                                            <PermissionGate permKey="Spawn">
                                            <div style={{ padding: '15px', border: `1px solid ${theme.colors.border}`, borderRadius: '8px' }}>
                                                <h4 style={{ color: theme.colors.primaryText, fontSize: '14px', marginBottom: '8px' }}>Spawn New Neuron</h4>
                                                <p style={{ color: theme.colors.mutedText, fontSize: '12px', marginBottom: '12px' }}>
                                                    Create a new neuron from your maturity. Requires at least 1 ICP equivalent in maturity.
                                                </p>
                                                <div style={{ marginBottom: '12px' }}>
                                                    <label style={{ color: theme.colors.mutedText, fontSize: '11px', display: 'block', marginBottom: '4px' }}>
                                                        Controller (optional, defaults to this canister)
                                                    </label>
                                                    <input
                                                        type="text"
                                                        value={spawnController}
                                                        onChange={(e) => setSpawnController(e.target.value)}
                                                        style={inputStyle}
                                                        placeholder="Principal ID (optional)"
                                                    />
                                                </div>
                                                <button
                                                    onClick={handleSpawnMaturity}
                                                    disabled={actionLoading === 'spawnMaturity' || !fullNeuron || Number(fullNeuron.maturity_e8s_equivalent) < E8S}
                                                    style={{ 
                                                        ...buttonStyle, 
                                                        opacity: (actionLoading === 'spawnMaturity' || !fullNeuron || Number(fullNeuron.maturity_e8s_equivalent) < E8S) ? 0.6 : 1,
                                                    }}
                                                >
                                                    {actionLoading === 'spawnMaturity' ? '⏳...' : '🐣 Spawn Neuron'}
                                                </button>
                                                {fullNeuron && Number(fullNeuron.maturity_e8s_equivalent) < E8S && (
                                                    <p style={{ color: theme.colors.warning || '#f59e0b', fontSize: '11px', marginTop: '8px' }}>
                                                        Need at least 1 ICP equivalent in maturity to spawn.
                                                    </p>
                                                )}
                                            </div>
                                            </PermissionGate>

                                            {/* Disburse Maturity */}
                                            <PermissionGate permKey="DisburseMaturity">
                                            <div style={{ padding: '15px', border: `1px solid ${theme.colors.border}`, borderRadius: '8px' }}>
                                                <h4 style={{ color: theme.colors.primaryText, fontSize: '14px', marginBottom: '8px' }}>Disburse Maturity</h4>
                                                <p style={{ color: theme.colors.mutedText, fontSize: '12px', marginBottom: '12px' }}>
                                                    Convert maturity to ICP and withdraw it. Subject to a 7-day modulation period.
                                                </p>
                                                <div style={{ marginBottom: '12px' }}>
                                                    <label style={{ color: theme.colors.mutedText, fontSize: '11px', display: 'block', marginBottom: '4px' }}>
                                                        Destination (optional, defaults to this canister)
                                                    </label>
                                                    <input
                                                        type="text"
                                                        value={disburseMaturityDestination}
                                                        onChange={(e) => setDisburseMaturityDestination(e.target.value)}
                                                        style={inputStyle}
                                                        placeholder="Principal ID (optional)"
                                                    />
                                                </div>
                                                <button
                                                    onClick={handleDisburseMaturity}
                                                    disabled={actionLoading === 'disburseMaturity' || !fullNeuron || fullNeuron.maturity_e8s_equivalent === BigInt(0)}
                                                    style={{ 
                                                        ...buttonStyle, 
                                                        background: theme.colors.warning || '#f59e0b',
                                                        opacity: (actionLoading === 'disburseMaturity' || !fullNeuron || fullNeuron.maturity_e8s_equivalent === BigInt(0)) ? 0.6 : 1,
                                                    }}
                                                >
                                                    {actionLoading === 'disburseMaturity' ? '⏳...' : '💸 Disburse Maturity'}
                                                </button>
                                            </div>
                                            </PermissionGate>
                                        </div>
                                    </div>
                                )}

                                {activeTab === 'following' && hasTabAccess('following') && (
                                    <div style={cardStyle}>
                                        <h3 style={{ color: theme.colors.primaryText, marginBottom: '15px' }}>Following Management</h3>
                                        <p style={{ color: theme.colors.mutedText, fontSize: '13px', marginBottom: '20px' }}>
                                            Set neurons to follow for automatic voting. Your neuron will vote the same way as your followees.
                                            Following the DFINITY Foundation neuron (27) is common for governance topics.
                                        </p>
                                        <PermissionGate permKey="ManageFollowees">
                                        
                                        {/* Current followees */}
                                        {fullNeuron && fullNeuron.followees && fullNeuron.followees.length > 0 && (
                                            <div style={{ marginBottom: '25px' }}>
                                                <h4 style={{ color: theme.colors.primaryText, fontSize: '14px', marginBottom: '10px' }}>Current Following</h4>
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '15px' }}>
                                                    {fullNeuron.followees.map(([topicId, followeesData]) => {
                                                        const topicInfo = NNS_TOPICS.find(t => t.id === topicId);
                                                        return (
                                                            <div key={topicId} style={{
                                                                background: `${theme.colors.accent}10`,
                                                                padding: '10px',
                                                                borderRadius: '6px',
                                                            }}>
                                                                <div style={{ color: theme.colors.primaryText, fontWeight: '500', fontSize: '13px' }}>
                                                                    {topicInfo?.name || `Topic ${topicId}`}
                                                                </div>
                                                                <div style={{ color: theme.colors.mutedText, fontSize: '12px', marginTop: '4px' }}>
                                                                    Following: {followeesData.followees.map(f => formatNeuronId(f.id)).join(', ') || 'None'}
                                                                </div>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                                
                                                {/* Confirmation status */}
                                                {(() => {
                                                    const status = getFollowingConfirmationStatus(fullNeuron);
                                                    return (
                                                        <div style={{
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            gap: '10px',
                                                            padding: '12px',
                                                            borderRadius: '8px',
                                                            marginBottom: '15px',
                                                            background: status.isUrgent 
                                                                ? `${theme.colors.warning || '#f59e0b'}20`
                                                                : `${theme.colors.green || '#22c55e'}20`,
                                                            border: `1px solid ${status.isUrgent 
                                                                ? (theme.colors.warning || '#f59e0b')
                                                                : (theme.colors.green || '#22c55e')}`,
                                                        }}>
                                                            <span style={{ fontSize: '20px' }}>
                                                                {status.isUrgent ? '⚠️' : '✅'}
                                                            </span>
                                                            <div>
                                                                <div style={{ 
                                                                    color: status.isUrgent 
                                                                        ? (theme.colors.warning || '#f59e0b')
                                                                        : (theme.colors.green || '#22c55e'),
                                                                    fontWeight: '600',
                                                                    fontSize: '14px',
                                                                }}>
                                                                    {status.secondsRemaining > 0 ? 'Active neuron' : 'Inactive neuron'}
                                                                </div>
                                                                <div style={{ color: theme.colors.mutedText, fontSize: '12px' }}>
                                                                    {status.text}
                                                                </div>
                                                            </div>
                                                        </div>
                                                    );
                                                })()}
                                                
                                                <button
                                                    onClick={handleConfirmFollowing}
                                                    disabled={actionLoading === 'confirmFollowing'}
                                                    style={{ 
                                                        ...buttonStyle, 
                                                        opacity: actionLoading === 'confirmFollowing' ? 0.6 : 1,
                                                        background: theme.colors.green || '#22c55e',
                                                    }}
                                                >
                                                    {actionLoading === 'confirmFollowing' ? '⏳ Confirming...' : '✅ Confirm Following'}
                                                </button>
                                                <p style={{ color: theme.colors.mutedText, fontSize: '11px', marginTop: '8px' }}>
                                                    Neurons must confirm following every ~6 months to remain active for automatic voting.
                                                </p>
                                            </div>
                                        )}

                                        {/* Set new following */}
                                        <h4 style={{ color: theme.colors.primaryText, fontSize: '14px', marginBottom: '10px' }}>Set Following</h4>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                                            <div>
                                                <label style={{ color: theme.colors.mutedText, fontSize: '12px', display: 'block', marginBottom: '6px' }}>
                                                    Topics <span style={{ color: theme.colors.accent }}>({selectedTopics.length} selected)</span>
                                                </label>
                                                
                                                {/* Quick select buttons */}
                                                <div style={{ display: 'flex', gap: '8px', marginBottom: '10px', flexWrap: 'wrap' }}>
                                                    <button
                                                        onClick={() => setSelectedTopics(NNS_TOPICS.map(t => t.id))}
                                                        style={{
                                                            ...secondaryButtonStyle,
                                                            padding: '4px 10px',
                                                            fontSize: '11px',
                                                        }}
                                                    >
                                                        Select All
                                                    </button>
                                                    <button
                                                        onClick={() => setSelectedTopics(NNS_TOPICS.filter(t => t.isCritical).map(t => t.id))}
                                                        style={{
                                                            ...secondaryButtonStyle,
                                                            padding: '4px 10px',
                                                            fontSize: '11px',
                                                            borderColor: theme.colors.warning || '#f59e0b',
                                                            color: theme.colors.warning || '#f59e0b',
                                                        }}
                                                    >
                                                        ⚠️ Critical Only
                                                    </button>
                                                    <button
                                                        onClick={() => setSelectedTopics(NNS_TOPICS.filter(t => !t.isCritical).map(t => t.id))}
                                                        style={{
                                                            ...secondaryButtonStyle,
                                                            padding: '4px 10px',
                                                            fontSize: '11px',
                                                        }}
                                                    >
                                                        Non-Critical Only
                                                    </button>
                                                    <button
                                                        onClick={() => setSelectedTopics([])}
                                                        style={{
                                                            ...secondaryButtonStyle,
                                                            padding: '4px 10px',
                                                            fontSize: '11px',
                                                        }}
                                                    >
                                                        Clear All
                                                    </button>
                                                </div>
                                                
                                                {/* Topic checkboxes */}
                                                <div style={{ 
                                                    display: 'grid', 
                                                    gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                                                    gap: '4px',
                                                    maxHeight: '300px',
                                                    overflowY: 'auto',
                                                    padding: '10px',
                                                    background: theme.colors.inputBackground,
                                                    borderRadius: '8px',
                                                    border: `1px solid ${theme.colors.border}`,
                                                }}>
                                                    {NNS_TOPICS.map(topic => (
                                                        <label 
                                                            key={topic.id}
                                                            style={{ 
                                                                display: 'flex', 
                                                                alignItems: 'flex-start', 
                                                                gap: '8px',
                                                                cursor: 'pointer',
                                                                padding: '6px 8px',
                                                                borderRadius: '6px',
                                                                background: selectedTopics.includes(topic.id) ? `${theme.colors.accent}15` : 'transparent',
                                                                border: `1px solid ${selectedTopics.includes(topic.id) ? theme.colors.accent : 'transparent'}`,
                                                                transition: 'all 0.15s',
                                                            }}
                                                        >
                                                            <input
                                                                type="checkbox"
                                                                checked={selectedTopics.includes(topic.id)}
                                                                onChange={(e) => {
                                                                    if (e.target.checked) {
                                                                        setSelectedTopics([...selectedTopics, topic.id]);
                                                                    } else {
                                                                        setSelectedTopics(selectedTopics.filter(id => id !== topic.id));
                                                                    }
                                                                }}
                                                                style={{ 
                                                                    marginTop: '2px',
                                                                    accentColor: theme.colors.accent,
                                                                }}
                                                            />
                                                            <div style={{ flex: 1 }}>
                                                                <div style={{ 
                                                                    fontSize: '13px', 
                                                                    color: topic.isCritical ? (theme.colors.warning || '#f59e0b') : theme.colors.primaryText,
                                                                    fontWeight: selectedTopics.includes(topic.id) ? 500 : 400,
                                                                }}>
                                                                    {topic.isCritical ? '⚠️ ' : ''}{topic.name}
                                                                </div>
                                                                <div style={{ 
                                                                    fontSize: '10px', 
                                                                    color: theme.colors.mutedText,
                                                                    marginTop: '2px',
                                                                }}>
                                                                    {topic.description}
                                                                </div>
                                                            </div>
                                                        </label>
                                                    ))}
                                                </div>
                                                
                                                {selectedTopics.some(id => NNS_TOPICS.find(t => t.id === id)?.isCritical) && (
                                                    <p style={{ 
                                                        color: theme.colors.warning || '#f59e0b', 
                                                        fontSize: '11px', 
                                                        marginTop: '8px',
                                                        padding: '8px',
                                                        background: `${theme.colors.warning || '#f59e0b'}15`,
                                                        borderRadius: '6px',
                                                    }}>
                                                        ⚠️ You have selected critical topics. Following for critical topics is NOT inherited from "All Topics" and must be set explicitly.
                                                    </p>
                                                )}
                                            </div>
                                            <div>
                                                <label style={{ color: theme.colors.mutedText, fontSize: '12px', display: 'block', marginBottom: '6px' }}>
                                                    Select Neurons to Follow
                                                </label>
                                                
                                                {/* Known neurons dropdown */}
                                                <select
                                                    onChange={(e) => {
                                                        const val = e.target.value;
                                                        if (val && val !== '__clear__') {
                                                            // Add to existing (avoid duplicates)
                                                            const existing = followeeIds.split(',').map(s => s.trim()).filter(s => s);
                                                            if (!existing.includes(val)) {
                                                                setFolloweeIds(existing.length > 0 ? `${followeeIds}, ${val}` : val);
                                                            }
                                                        } else if (val === '__clear__') {
                                                            setFolloweeIds('');
                                                        }
                                                        e.target.value = ''; // Reset dropdown
                                                    }}
                                                    style={{ 
                                                        ...inputStyle, 
                                                        cursor: 'pointer',
                                                        marginBottom: '10px',
                                                    }}
                                                    defaultValue=""
                                                >
                                                    <option value="" disabled>+ Add known neuron...</option>
                                                    <option value="__clear__">🗑️ Clear all followees</option>
                                                    <option disabled>──────────────</option>
                                                    {Object.entries(knownNeurons)
                                                        .sort((a, b) => a[1].localeCompare(b[1]))
                                                        .map(([id, name]) => (
                                                            <option key={id} value={id}>
                                                                {name} ({id})
                                                            </option>
                                                        ))
                                                    }
                                                </select>
                                                
                                                {/* Current selection / manual input */}
                                                <label style={{ color: theme.colors.mutedText, fontSize: '11px', display: 'block', marginBottom: '4px' }}>
                                                    Selected neurons (or enter custom IDs, comma-separated):
                                                </label>
                                                <input
                                                    type="text"
                                                    value={followeeIds}
                                                    onChange={(e) => setFolloweeIds(e.target.value)}
                                                    style={inputStyle}
                                                    placeholder="Leave empty to clear following for selected topics"
                                                />
                                                
                                                {/* Show selected as pills */}
                                                {followeeIds && (
                                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '8px' }}>
                                                        {followeeIds.split(',').map(s => s.trim()).filter(s => s).map((id, idx) => (
                                                            <span 
                                                                key={idx}
                                                                style={{
                                                                    background: `${theme.colors.accent}20`,
                                                                    border: `1px solid ${theme.colors.accent}`,
                                                                    padding: '4px 8px',
                                                                    borderRadius: '16px',
                                                                    fontSize: '12px',
                                                                    color: theme.colors.primaryText,
                                                                    display: 'flex',
                                                                    alignItems: 'center',
                                                                    gap: '6px',
                                                                }}
                                                            >
                                                                {knownNeurons[id] ? `${knownNeurons[id]}` : `Neuron ${id}`}
                                                                <button
                                                                    onClick={() => {
                                                                        const ids = followeeIds.split(',').map(s => s.trim()).filter(s => s && s !== id);
                                                                        setFolloweeIds(ids.join(', '));
                                                                    }}
                                                                    style={{
                                                                        background: 'transparent',
                                                                        border: 'none',
                                                                        color: theme.colors.mutedText,
                                                                        cursor: 'pointer',
                                                                        padding: '0',
                                                                        fontSize: '14px',
                                                                        lineHeight: 1,
                                                                    }}
                                                                >
                                                                    ×
                                                                </button>
                                                            </span>
                                                        ))}
                                                    </div>
                                                )}
                                                
                                                <p style={{ color: theme.colors.mutedText, fontSize: '11px', marginTop: '8px' }}>
                                                    {followeeIds 
                                                        ? `🔄 Setting these neurons as followees will replace existing followees for ${selectedTopics.length} selected topic(s).` 
                                                        : `🗑️ Submitting with no neurons selected will clear following for ${selectedTopics.length} selected topic(s).`
                                                    }
                                                </p>
                                            </div>
                                            <button
                                                onClick={handleSetFollowing}
                                                disabled={actionLoading === 'following' || selectedTopics.length === 0}
                                                style={{ 
                                                    ...buttonStyle, 
                                                    opacity: (actionLoading === 'following' || selectedTopics.length === 0) ? 0.6 : 1,
                                                    alignSelf: 'flex-start',
                                                    background: followeeIds ? theme.colors.accent : (theme.colors.error || '#ef4444'),
                                                }}
                                            >
                                                {actionLoading === 'following' 
                                                    ? `⏳ Setting for ${selectedTopics.length} topics...` 
                                                    : (followeeIds 
                                                        ? `✅ Set Following for ${selectedTopics.length} Topic(s)` 
                                                        : `🗑️ Clear Following for ${selectedTopics.length} Topic(s)`
                                                    )
                                                }
                                            </button>
                                        </div>
                                        </PermissionGate>
                                    </div>
                                )}

                                {activeTab === 'disburse' && hasTabAccess('disburse') && (
                                    <div style={cardStyle}>
                                        <h3 style={{ color: theme.colors.primaryText, marginBottom: '15px' }}>Disburse Neuron</h3>
                                        
                                        <PermissionGate permKey="Disburse">
                                        {neuronInfo && neuronInfo.state !== 3 ? (
                                            <div style={{
                                                background: `${theme.colors.warning || '#f59e0b'}20`,
                                                border: `1px solid ${theme.colors.warning || '#f59e0b'}`,
                                                padding: '15px',
                                                borderRadius: '8px',
                                                marginBottom: '20px',
                                            }}>
                                                <p style={{ color: theme.colors.warning || '#f59e0b', margin: 0 }}>
                                                    ⚠️ Neuron must be fully dissolved before disbursing.
                                                    Current state: <strong>{getNeuronState(neuronInfo.state).label}</strong>
                                                </p>
                                                {neuronInfo.state === 1 && (
                                                    <p style={{ color: theme.colors.mutedText, fontSize: '13px', marginTop: '8px', marginBottom: 0 }}>
                                                        Start dissolving first, then wait for the dissolve delay to complete.
                                                    </p>
                                                )}
                                                {neuronInfo.state === 2 && (
                                                    <p style={{ color: theme.colors.mutedText, fontSize: '13px', marginTop: '8px', marginBottom: 0 }}>
                                                        Dissolving... {formatDuration(Number(neuronInfo.dissolve_delay_seconds))} remaining.
                                                    </p>
                                                )}
                                            </div>
                                        ) : (
                                            <>
                                                <p style={{ color: theme.colors.mutedText, fontSize: '13px', marginBottom: '20px' }}>
                                                    Withdraw ICP from your dissolved neuron. Leave fields empty to disburse all to this canister.
                                                </p>
                                                
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                                                    <div>
                                                        <label style={{ color: theme.colors.mutedText, fontSize: '12px', display: 'block', marginBottom: '6px' }}>
                                                            Amount (ICP) - leave empty to disburse all
                                                        </label>
                                                        <input
                                                            type="text"
                                                            inputMode="decimal"
                                                            value={disburseAmount}
                                                            onChange={(e) => setDisburseAmount(e.target.value)}
                                                            style={inputStyle}
                                                            placeholder="All"
                                                        />
                                                    </div>
                                                    <div>
                                                        <label style={{ color: theme.colors.mutedText, fontSize: '12px', display: 'block', marginBottom: '6px' }}>
                                                            Destination Account ID (hex) - leave empty to send to this canister
                                                        </label>
                                                        <input
                                                            type="text"
                                                            value={disburseToAccount}
                                                            onChange={(e) => setDisburseToAccount(e.target.value)}
                                                            style={inputStyle}
                                                            placeholder="64-character hex (optional)"
                                                        />
                                                    </div>
                                                    <button
                                                        onClick={handleDisburse}
                                                        disabled={actionLoading === 'disburse'}
                                                        style={{ 
                                                            ...buttonStyle, 
                                                            background: theme.colors.error || '#ef4444',
                                                            opacity: actionLoading === 'disburse' ? 0.6 : 1,
                                                            alignSelf: 'flex-start',
                                                        }}
                                                    >
                                                        {actionLoading === 'disburse' ? '⏳...' : '💸 Disburse'}
                                                    </button>
                                                </div>
                                            </>
                                        )}
                                        </PermissionGate>
                                    </div>
                                )}

                                {activeTab === 'advanced' && hasTabAccess('advanced') && (
                                    <div style={cardStyle}>
                                        <h3 style={{ color: theme.colors.primaryText, marginBottom: '15px' }}>Advanced Operations</h3>
                                        
                                        {/* Split Neuron */}
                                        <PermissionGate permKey="Split">
                                        <div style={{ padding: '15px', border: `1px solid ${theme.colors.border}`, borderRadius: '8px', marginBottom: '20px' }}>
                                            <h4 style={{ color: theme.colors.primaryText, fontSize: '14px', marginBottom: '8px' }}>✂️ Split Neuron</h4>
                                            <p style={{ color: theme.colors.mutedText, fontSize: '12px', marginBottom: '15px' }}>
                                                Split this neuron into two. Specify the amount for the new neuron (minimum 1 ICP). 
                                                The new neuron will have the same controller and dissolve delay.
                                            </p>
                                            {neuronInfo && (
                                                <div style={{ 
                                                    background: `${theme.colors.accent}10`, 
                                                    padding: '10px', 
                                                    borderRadius: '6px', 
                                                    marginBottom: '15px' 
                                                }}>
                                                    <span style={{ color: theme.colors.mutedText, fontSize: '12px' }}>Current Stake: </span>
                                                    <span style={{ color: theme.colors.primaryText, fontWeight: '600' }}>{formatIcp(Number(neuronInfo.stake_e8s))} ICP</span>
                                                </div>
                                            )}
                                            <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                                                <div style={{ flex: 1, minWidth: '150px' }}>
                                                    <label style={{ color: theme.colors.mutedText, fontSize: '11px', display: 'block', marginBottom: '4px' }}>
                                                        Amount for New Neuron (ICP)
                                                    </label>
                                                    <input
                                                        type="text"
                                                        inputMode="decimal"
                                                        value={splitAmount}
                                                        onChange={(e) => setSplitAmount(e.target.value)}
                                                        style={inputStyle}
                                                        placeholder="Min 1 ICP"
                                                    />
                                                </div>
                                                <button
                                                    onClick={handleSplitNeuron}
                                                    disabled={actionLoading === 'split' || !neuronInfo || Number(neuronInfo.stake_e8s) < 2 * E8S}
                                                    style={{ 
                                                        ...buttonStyle, 
                                                        background: theme.colors.warning || '#f59e0b',
                                                        opacity: (actionLoading === 'split' || !neuronInfo || Number(neuronInfo.stake_e8s) < 2 * E8S) ? 0.6 : 1,
                                                    }}
                                                >
                                                    {actionLoading === 'split' ? '⏳...' : '✂️ Split'}
                                                </button>
                                            </div>
                                            {neuronInfo && Number(neuronInfo.stake_e8s) < 2 * E8S && (
                                                <p style={{ color: theme.colors.warning || '#f59e0b', fontSize: '11px', marginTop: '8px' }}>
                                                    Need at least 2 ICP stake to split (1 ICP min for each neuron).
                                                </p>
                                            )}
                                        </div>
                                        </PermissionGate>

                                        {/* Merge Neurons */}
                                        <PermissionGate permKey="MergeNeurons">
                                        <div style={{ padding: '15px', border: `1px solid ${theme.colors.border}`, borderRadius: '8px', marginBottom: '20px' }}>
                                            <h4 style={{ color: theme.colors.primaryText, fontSize: '14px', marginBottom: '8px' }}>🔗 Merge Neurons</h4>
                                            <p style={{ color: theme.colors.mutedText, fontSize: '12px', marginBottom: '15px' }}>
                                                Merge another neuron into this one. Both neurons must:
                                            </p>
                                            <ul style={{ color: theme.colors.mutedText, fontSize: '12px', marginBottom: '15px', paddingLeft: '20px' }}>
                                                <li>Have the same controller</li>
                                                <li>Have no hotkeys</li>
                                                <li>Not be dissolving</li>
                                                <li>Not be in the Community Fund</li>
                                            </ul>
                                            <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                                                <div style={{ flex: 1, minWidth: '200px' }}>
                                                    <label style={{ color: theme.colors.mutedText, fontSize: '11px', display: 'block', marginBottom: '4px' }}>
                                                        Source Neuron ID (to merge FROM)
                                                    </label>
                                                    <input
                                                        type="text"
                                                        value={mergeSourceNeuronId}
                                                        onChange={(e) => setMergeSourceNeuronId(e.target.value)}
                                                        style={inputStyle}
                                                        placeholder="Neuron ID"
                                                    />
                                                </div>
                                                <button
                                                    onClick={handleMergeNeurons}
                                                    disabled={actionLoading === 'merge'}
                                                    style={{ 
                                                        ...buttonStyle, 
                                                        background: theme.colors.warning || '#f59e0b',
                                                        opacity: actionLoading === 'merge' ? 0.6 : 1,
                                                    }}
                                                >
                                                    {actionLoading === 'merge' ? '⏳...' : '🔗 Merge'}
                                                </button>
                                            </div>
                                        </div>
                                        </PermissionGate>

                                        {/* Neuron Visibility */}
                                        <PermissionGate permKey="ManageVisibility">
                                        <div style={{ padding: '15px', border: `1px solid ${theme.colors.border}`, borderRadius: '8px' }}>
                                            <h4 style={{ color: theme.colors.primaryText, fontSize: '14px', marginBottom: '8px' }}>
                                                {fullNeuron?.visibility?.[0] === 2 ? '🌐' : '🔒'} Neuron Visibility
                                            </h4>
                                            <p style={{ color: theme.colors.mutedText, fontSize: '12px', marginBottom: '15px' }}>
                                                Control whether your neuron's voting history and details are publicly visible.
                                            </p>
                                            
                                            {fullNeuron && (
                                                <div style={{ 
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'space-between',
                                                    background: fullNeuron.visibility?.[0] === 2 
                                                        ? `${theme.colors.success || '#22c55e'}15` 
                                                        : theme.colors.tertiaryBg || theme.colors.secondaryBg,
                                                    padding: '12px 15px',
                                                    borderRadius: '8px',
                                                    marginBottom: '15px'
                                                }}>
                                                    <div>
                                                        <div style={{ 
                                                            color: fullNeuron.visibility?.[0] === 2 
                                                                ? (theme.colors.success || '#22c55e') 
                                                                : theme.colors.primaryText,
                                                            fontWeight: '600',
                                                            fontSize: '14px'
                                                        }}>
                                                            {fullNeuron.visibility?.[0] === 2 ? '🌐 Public' : '🔒 Private'}
                                                        </div>
                                                        <div style={{ color: theme.colors.mutedText, fontSize: '12px', marginTop: '2px' }}>
                                                            {fullNeuron.visibility?.[0] === 2 
                                                                ? 'Your neuron\'s voting history is visible to everyone'
                                                                : 'Your neuron\'s voting history is hidden'}
                                                        </div>
                                                    </div>
                                                </div>
                                            )}

                                            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                                                {fullNeuron?.visibility?.[0] !== 2 ? (
                                                    <button
                                                        onClick={() => handleSetVisibility(true)}
                                                        disabled={actionLoading === 'visibility'}
                                                        style={{ 
                                                            ...buttonStyle,
                                                            background: theme.colors.success || '#22c55e',
                                                            opacity: actionLoading === 'visibility' ? 0.6 : 1,
                                                        }}
                                                    >
                                                        {actionLoading === 'visibility' ? '⏳...' : '🌐 Make Public'}
                                                    </button>
                                                ) : (
                                                    <button
                                                        onClick={() => handleSetVisibility(false)}
                                                        disabled={actionLoading === 'visibility'}
                                                        style={{ 
                                                            ...buttonStyle,
                                                            background: theme.colors.mutedText,
                                                            opacity: actionLoading === 'visibility' ? 0.6 : 1,
                                                        }}
                                                    >
                                                        {actionLoading === 'visibility' ? '⏳...' : '🔒 Make Private'}
                                                    </button>
                                                )}
                                            </div>
                                            
                                            <p style={{ color: theme.colors.mutedText, fontSize: '11px', marginTop: '10px', marginBottom: 0 }}>
                                                ⚠️ Note: Making your neuron public means anyone can see its voting history and other details on the NNS.
                                            </p>
                                        </div>
                                        </PermissionGate>
                                    </div>
                                )}

                                {activeTab === 'hotkeys' && hasTabAccess('hotkeys') && (
                                    <div style={cardStyle}>
                                        <h3 style={{ color: theme.colors.primaryText, marginBottom: '15px' }}>Hot Key Management</h3>
                                        <p style={{ color: theme.colors.mutedText, fontSize: '13px', marginBottom: '20px' }}>
                                            Hot keys can vote and manage following on behalf of this neuron, but cannot disburse or change dissolve settings.
                                        </p>
                                        
                                        <PermissionGate permKey="ManageNeuronHotkeys">
                                        {/* Current Hot Keys */}
                                        {fullNeuron && fullNeuron.hot_keys && fullNeuron.hot_keys.length > 0 && (
                                            <div style={{ marginBottom: '20px' }}>
                                                <h4 style={{ color: theme.colors.primaryText, fontSize: '14px', marginBottom: '10px' }}>Current Hot Keys</h4>
                                                {fullNeuron.hot_keys.map((key, idx) => (
                                                    <div key={idx} style={{ 
                                                        display: 'flex', 
                                                        justifyContent: 'space-between', 
                                                        alignItems: 'center',
                                                        padding: '8px',
                                                        background: `${theme.colors.accent}10`,
                                                        borderRadius: '4px',
                                                        marginBottom: '8px',
                                                    }}>
                                                        <span style={{ color: theme.colors.primaryText, fontFamily: 'monospace', fontSize: '12px' }}>
                                                            {key.toText()}
                                                        </span>
                                                        <button
                                                            onClick={() => handleRemoveHotKey(key)}
                                                            disabled={actionLoading === 'removeHotKey'}
                                                            style={{ 
                                                                ...secondaryButtonStyle, 
                                                                padding: '4px 12px', 
                                                                fontSize: '12px',
                                                                color: theme.colors.error,
                                                                borderColor: theme.colors.error,
                                                            }}
                                                        >
                                                            Remove
                                                        </button>
                                                    </div>
                                                ))}
                                            </div>
                                        )}

                                        {/* Add Hot Key */}
                                        <h4 style={{ color: theme.colors.primaryText, fontSize: '14px', marginBottom: '10px' }}>Add Hot Key</h4>
                                        <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                                            <div style={{ flex: 1, minWidth: '250px' }}>
                                                <input
                                                    type="text"
                                                    value={hotKeyPrincipal}
                                                    onChange={(e) => setHotKeyPrincipal(e.target.value)}
                                                    style={inputStyle}
                                                    placeholder="Principal ID"
                                                />
                                            </div>
                                            <button
                                                onClick={handleAddHotKey}
                                                disabled={actionLoading === 'addHotKey'}
                                                style={{ 
                                                    ...buttonStyle, 
                                                    opacity: actionLoading === 'addHotKey' ? 0.6 : 1,
                                                }}
                                            >
                                                {actionLoading === 'addHotKey' ? '⏳...' : '➕ Add Hot Key'}
                                            </button>
                                        </div>
                                        </PermissionGate>
                                    </div>
                                )}
                            </>
                        )}
                                </div>
                            )}
                        </div>
                        </>
                        )}
                    </>
                )}
            </main>
        </div>
    );
}

export default IcpNeuronManager;

