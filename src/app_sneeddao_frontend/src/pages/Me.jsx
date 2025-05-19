import React, { useState, useEffect } from 'react';
import { useAuth } from '../AuthContext';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Header from '../components/Header';
import { fetchAndCacheSnsData, getSnsById } from '../utils/SnsUtils';
import { createActor as createIcrc1Actor } from 'external/icrc1_ledger';
import { 
    fetchUserNeuronsForSns, 
    formatE8s, 
    getDissolveState, 
    formatNeuronIdLink,
    uint8ArrayToHex,
    getOwnerPrincipals
} from '../utils/NeuronUtils';
import {
    setNeuronName,
    setNeuronNickname,
    getNeuronName,
    getNeuronNickname,
    getAllNeuronNames,
    getAllNeuronNicknames,
    setPrincipalName,
    getPrincipalName,
    getAllPrincipalNames
} from '../utils/BackendUtils';
import { useNaming } from '../NamingContext';
import { Link } from 'react-router-dom';
import ConfirmationModal from '../ConfirmationModal';

const spinKeyframes = `
@keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
}
`;

export default function Me() {
    const { identity } = useAuth();
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();
    const [selectedSnsRoot, setSelectedSnsRoot] = useState(searchParams.get('sns') || '');
    const [snsList, setSnsList] = useState([]);
    const [neurons, setNeurons] = useState([]);
    const [error, setError] = useState(null);
    const [loading, setLoading] = useState(false);
    const [loadingSnses, setLoadingSnses] = useState(true);
    const [expandedGroups, setExpandedGroups] = useState(new Set(['self'])); // Default expand self group
    const [tokenSymbol, setTokenSymbol] = useState('SNS');
    const [editingName, setEditingName] = useState(null);
    const [nameInput, setNameInput] = useState('');
    const [inputError, setInputError] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [showConfirmModal, setShowConfirmModal] = useState(false);
    const [confirmAction, setConfirmAction] = useState(null);
    const [confirmMessage, setConfirmMessage] = useState('');
    const [principalName, setPrincipalNameState] = useState(null);
    const [isVerified, setIsVerified] = useState(false);
    const [editingPrincipalName, setEditingPrincipalName] = useState(false);
    const [principalNameInput, setPrincipalNameInput] = useState('');
    const [principalNameError, setPrincipalNameError] = useState('');
    const [isSubmittingPrincipalName, setIsSubmittingPrincipalName] = useState(false);
    
    // Get naming context
    const { neuronNames, neuronNicknames, fetchAllNames, verifiedNames } = useNaming();

    // Add validation function
    const validateNameInput = (input) => {
        if (input.length > 32) {
            return "Name must not exceed 32 characters";
        }
        
        const validPattern = /^[a-zA-Z0-9\s\-_.']*$/;
        if (!validPattern.test(input)) {
            return "Only alphanumeric characters, spaces, hyphens, underscores, dots, and apostrophes are allowed";
        }
        
        return "";
    };

    // Group neurons by owner
    const groupedNeurons = React.useMemo(() => {
        const groups = new Map();
        const userPrincipal = identity?.getPrincipal().toString();

        // First, group neurons by their owner
        const neuronsByOwner = new Map();
        neurons.forEach(neuron => {
            // Find the owner (principal with most permissions)
            const ownerPrincipals = getOwnerPrincipals(neuron);
            if (ownerPrincipals.length > 0) {
                const owner = ownerPrincipals[0]; // Take the first owner
                if (!neuronsByOwner.has(owner)) {
                    neuronsByOwner.set(owner, []);
                }
                neuronsByOwner.get(owner).push(neuron);
            }
        });

        // Now, if the user has any permissions on any neuron owned by a principal,
        // add all neurons from that owner to the group
        neuronsByOwner.forEach((ownerNeurons, owner) => {
            // Check if user has permissions on any neuron from this owner
            const hasAccess = ownerNeurons.some(neuron => 
                neuron.permissions.some(p => p.principal?.toString() === userPrincipal)
            );

            if (hasAccess) {
                const totalStake = ownerNeurons.reduce(
                    (sum, n) => sum + BigInt(n.cached_neuron_stake_e8s || 0), 
                    BigInt(0)
                );

                groups.set(owner, {
                    title: owner === userPrincipal ? 'My Neurons' : `Neurons from ${owner.slice(0, 6)}...${owner.slice(-6)}`,
                    tooltip: owner === userPrincipal ? undefined : `Principal ID: ${owner}`,
                    neurons: ownerNeurons,
                    totalStake
                });
            }
        });

        return groups;
    }, [neurons, identity]);

    // Fetch SNS data on component mount
    useEffect(() => {
        const fetchSnsData = async () => {
            try {
                const data = await fetchAndCacheSnsData();
                setSnsList(data);
                
                // If no SNS is selected in URL, default to Sneed SNS
                if (!searchParams.get('sns')) {
                    const sneedSns = data.find(sns => sns.rootCanisterId === 'fp274-iaaaa-aaaaq-aacha-cai');
                    if (sneedSns) {
                        const newSnsRoot = sneedSns.rootCanisterId;
                        setSelectedSnsRoot(newSnsRoot);
                        setSearchParams({ sns: newSnsRoot });
                    }
                }
            } catch (err) {
                console.error('Error fetching SNS data:', err);
                setError('Failed to load SNS data');
            } finally {
                setLoadingSnses(false);
            }
        };
        fetchSnsData();
    }, [identity]);

    // Fetch neurons when selected SNS changes
    useEffect(() => {
        const fetchNeurons = async () => {
            if (!identity || !selectedSnsRoot) return;
            
            setLoading(true);
            setError(null);
            try {
                const selectedSns = getSnsById(selectedSnsRoot);
                if (!selectedSns) {
                    throw new Error('Selected SNS not found');
                }
                
                const neuronsList = await fetchUserNeuronsForSns(identity, selectedSns.canisters.governance);
                setNeurons(neuronsList);

                // Fetch token metadata for the selected SNS
                const icrc1Actor = createIcrc1Actor(selectedSns.canisters.ledger, {
                    agentOptions: { identity }
                });
                const metadata = await icrc1Actor.icrc1_metadata();
                const symbolEntry = metadata.find(entry => entry[0] === 'icrc1:symbol');
                if (symbolEntry && symbolEntry[1]) {
                    setTokenSymbol(symbolEntry[1].Text);
                }
            } catch (err) {
                console.error('Error fetching neurons:', err);
                setError('Failed to load neurons');
            } finally {
                setLoading(false);
            }
        };
        fetchNeurons();
    }, [identity, selectedSnsRoot]);

    // Add after other useEffect hooks
    useEffect(() => {
        if (identity) {
            const fetchPrincipalName = async () => {
                try {
                    const response = await getPrincipalName(identity, identity.getPrincipal());
                    if (response) {
                        setPrincipalNameState(response[0]);
                        setIsVerified(response[1]);
                    }
                } catch (error) {
                    console.error('Error fetching principal name:', error);
                }
            };
            fetchPrincipalName();
        }
    }, [identity]);

    const handleSnsChange = (newSnsRoot) => {
        setSelectedSnsRoot(newSnsRoot);
        setSearchParams({ sns: newSnsRoot });
    };

    const toggleGroup = (groupId) => {
        setExpandedGroups(prev => {
            const newSet = new Set(prev);
            if (newSet.has(groupId)) {
                newSet.delete(groupId);
            } else {
                newSet.add(groupId);
            }
            return newSet;
        });
    };

    const handleNameSubmit = async (neuronId, isNickname = false) => {
        const error = validateNameInput(nameInput);
        if (error) {
            setInputError(error);
            return;
        }

        if (!nameInput.trim()) return;

        if (!isNickname) {
            // Show confirmation dialog for public names
            setConfirmAction(() => async () => {
                setIsSubmitting(true);
                try {
                    const response = await setNeuronName(identity, selectedSnsRoot, neuronId, nameInput);
                    if ('ok' in response) {
                        await fetchAllNames();
                        setInputError('');
                    } else {
                        setError(response.err);
                    }
                } catch (err) {
                    console.error('Error setting neuron name:', err);
                    setError('Failed to set neuron name');
                } finally {
                    setIsSubmitting(false);
                    setEditingName(null);
                    setNameInput('');
                }
            });
            setConfirmMessage(
                "You are about to set a public name for this neuron. Please note:\n\n" +
                "• This name will be visible to everyone\n" +
                "• Only set a name if you want to help others track your neuron\n" +
                "• Inappropriate names can result in a user ban\n\n" +
                "Are you sure you want to proceed?"
            );
            setShowConfirmModal(true);
            return;
        }

        // For nicknames, proceed without confirmation
        setIsSubmitting(true);
        try {
            const response = await setNeuronNickname(identity, selectedSnsRoot, neuronId, nameInput);
            if ('ok' in response) {
                await fetchAllNames();
                setInputError('');
            } else {
                setError(response.err);
            }
        } catch (err) {
            console.error('Error setting neuron nickname:', err);
            setError('Failed to set neuron nickname');
        } finally {
            setIsSubmitting(false);
            setEditingName(null);
            setNameInput('');
        }
    };

    const getDisplayName = (neuronId) => {
        const mapKey = `${selectedSnsRoot}:${neuronId}`;
        const name = neuronNames.get(mapKey);
        const nickname = neuronNicknames.get(mapKey);
        const isVerified = verifiedNames.get(mapKey);
        return { name, nickname, isVerified };
    };

    // Add after other handlers
    const handlePrincipalNameSubmit = async () => {
        const error = validateNameInput(principalNameInput);
        if (error) {
            setPrincipalNameError(error);
            return;
        }

        if (!principalNameInput.trim()) return;

        // Show confirmation dialog for public names
        setConfirmAction(() => async () => {
            setIsSubmittingPrincipalName(true);
            try {
                const response = await setPrincipalName(identity, principalNameInput);
                if ('ok' in response) {
                    const newName = await getPrincipalName(identity, identity.getPrincipal());
                    if (newName) {
                        setPrincipalNameState(newName[0]);
                        setIsVerified(newName[1]);
                    }
                    setPrincipalNameError('');
                } else {
                    setError(response.err);
                }
            } catch (err) {
                console.error('Error setting principal name:', err);
                setError('Failed to set principal name');
            } finally {
                setIsSubmittingPrincipalName(false);
                setEditingPrincipalName(false);
                setPrincipalNameInput('');
            }
        });
        setConfirmMessage(
            "You are about to set a public name for your principal. Please note:\n\n" +
            "• This name will be visible to everyone\n" +
            "• Only set a name if you want to help others identify you\n" +
            "• Inappropriate names can result in a user ban\n\n" +
            "Are you sure you want to proceed?"
        );
        setShowConfirmModal(true);
    };

    if (!identity) {
        return (
            <div className='page-container'>
                <Header showSnsDropdown={true} onSnsChange={handleSnsChange} />
                <main className="wallet-container">
                    <div style={{ textAlign: 'center', padding: '40px 20px' }}>
                        <h1 style={{ color: '#ffffff', marginBottom: '20px' }}>Please Connect Your Wallet</h1>
                        <p style={{ color: '#888' }}>You need to connect your wallet to view your neurons.</p>
                    </div>
                </main>
            </div>
        );
    }

    return (
        <div className='page-container'>
            <Header showSnsDropdown={true} onSnsChange={handleSnsChange} />
            <main className="wallet-container">
                {/* Add principal name section */}
                <div style={{ 
                    backgroundColor: '#2a2a2a',
                    borderRadius: '8px',
                    padding: '20px',
                    marginBottom: '30px',
                    border: '1px solid #3a3a3a'
                }}>
                    <div style={{ 
                        display: 'flex', 
                        justifyContent: 'space-between', 
                        alignItems: 'flex-start',
                        marginBottom: '15px'
                    }}>
                        <div>
                            <h2 style={{ 
                                color: '#ffffff',
                                margin: '0 0 5px 0',
                                fontSize: '18px',
                                fontWeight: '500'
                            }}>
                                Your Principal ID
                            </h2>
                            <div style={{ 
                                fontFamily: 'monospace',
                                color: '#888',
                                fontSize: '14px'
                            }}>
                                {identity?.getPrincipal().toString()}
                            </div>
                        </div>
                        {!editingPrincipalName && (
                            <button
                                onClick={() => setEditingPrincipalName(true)}
                                style={{
                                    backgroundColor: '#3498db',
                                    color: '#ffffff',
                                    border: 'none',
                                    borderRadius: '4px',
                                    padding: '8px 12px',
                                    cursor: 'pointer'
                                }}
                            >
                                {principalName ? 'Change Name' : 'Set Name'}
                            </button>
                        )}
                    </div>

                    {principalName && !editingPrincipalName && (
                        <div style={{ 
                            color: '#3498db',
                            fontSize: '18px',
                            fontWeight: 'bold',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px'
                        }}>
                            {principalName}
                            {isVerified && (
                                <span 
                                    style={{ 
                                        fontSize: '14px',
                                        cursor: 'help'
                                    }}
                                    title="Verified name"
                                >
                                    ✓
                                </span>
                            )}
                        </div>
                    )}

                    {editingPrincipalName && (
                        <div style={{ 
                            marginTop: '10px',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '10px'
                        }}>
                            <div>
                                <input
                                    type="text"
                                    value={principalNameInput}
                                    onChange={(e) => {
                                        const newValue = e.target.value;
                                        setPrincipalNameInput(newValue);
                                        setPrincipalNameError(validateNameInput(newValue));
                                    }}
                                    maxLength={32}
                                    placeholder="Enter your name (max 32 chars)"
                                    style={{
                                        backgroundColor: '#3a3a3a',
                                        border: `1px solid ${principalNameError ? '#e74c3c' : '#4a4a4a'}`,
                                        borderRadius: '4px',
                                        color: '#ffffff',
                                        padding: '8px',
                                        width: '100%'
                                    }}
                                />
                                {principalNameError && (
                                    <div style={{
                                        color: '#e74c3c',
                                        fontSize: '12px',
                                        marginTop: '4px'
                                    }}>
                                        {principalNameError}
                                    </div>
                                )}
                                <div style={{
                                    color: '#888',
                                    fontSize: '12px',
                                    marginTop: '4px'
                                }}>
                                    Allowed: letters, numbers, spaces, hyphens (-), underscores (_), dots (.), apostrophes (')
                                </div>
                            </div>
                            <div style={{
                                display: 'flex',
                                gap: '8px',
                                justifyContent: 'flex-end'
                            }}>
                                <button
                                    onClick={handlePrincipalNameSubmit}
                                    disabled={isSubmittingPrincipalName}
                                    style={{
                                        backgroundColor: '#3498db',
                                        color: '#ffffff',
                                        border: 'none',
                                        borderRadius: '4px',
                                        padding: '8px 12px',
                                        cursor: isSubmittingPrincipalName ? 'not-allowed' : 'pointer',
                                        whiteSpace: 'nowrap',
                                        opacity: isSubmittingPrincipalName ? 0.7 : 1,
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '6px'
                                    }}
                                >
                                    {isSubmittingPrincipalName ? (
                                        <>
                                            <span style={{ 
                                                display: 'inline-block',
                                                animation: 'spin 1s linear infinite',
                                                fontSize: '14px'
                                            }}>⟳</span>
                                            Setting...
                                        </>
                                    ) : (
                                        'Set Name'
                                    )}
                                </button>
                                <button
                                    onClick={() => {
                                        setEditingPrincipalName(false);
                                        setPrincipalNameInput('');
                                    }}
                                    disabled={isSubmittingPrincipalName}
                                    style={{
                                        backgroundColor: '#e74c3c',
                                        color: '#ffffff',
                                        border: 'none',
                                        borderRadius: '4px',
                                        padding: '8px 12px',
                                        cursor: isSubmittingPrincipalName ? 'not-allowed' : 'pointer',
                                        whiteSpace: 'nowrap',
                                        opacity: isSubmittingPrincipalName ? 0.7 : 1
                                    }}
                                >
                                    Cancel
                                </button>
                            </div>
                        </div>
                    )}
                </div>

                <h1 style={{ color: '#ffffff', marginBottom: '20px' }}>My Neurons</h1>

                {error && (
                    <div style={{ 
                        backgroundColor: 'rgba(231, 76, 60, 0.2)', 
                        border: '1px solid #e74c3c',
                        color: '#e74c3c',
                        padding: '15px',
                        borderRadius: '6px',
                        marginBottom: '20px'
                    }}>
                        {error}
                    </div>
                )}

                {loading ? (
                    <div style={{ textAlign: 'center', padding: '40px 20px', color: '#ffffff' }}>
                        Loading...
                    </div>
                ) : neurons.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '40px 20px', color: '#888' }}>
                        <p>No neurons found for this SNS.</p>
                    </div>
                ) : (
                    <div>
                        {Array.from(groupedNeurons.entries()).map(([groupId, group]) => (
                            <div key={groupId} style={{ marginBottom: '30px' }}>
                                <div 
                                    onClick={() => toggleGroup(groupId)}
                                    style={{
                                        cursor: 'pointer',
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center',
                                        padding: '15px',
                                        backgroundColor: '#2a2a2a',
                                        borderRadius: '8px',
                                        marginBottom: '15px'
                                    }}
                                >
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                        <span style={{ 
                                            transform: expandedGroups.has(groupId) ? 'rotate(90deg)' : 'none',
                                            transition: 'transform 0.3s ease',
                                            display: 'inline-block'
                                        }}>▶</span>
                                        <h2 style={{ 
                                            margin: 0, 
                                            color: '#ffffff',
                                            fontSize: '16px',
                                            fontWeight: '500'
                                        }}>
                                            {group.title} ({group.neurons.length})
                                            {group.tooltip && (
                                                <span 
                                                    style={{ 
                                                        marginLeft: '8px',
                                                        fontSize: '14px',
                                                        color: '#888',
                                                        cursor: 'help',
                                                        fontWeight: 'normal'
                                                    }}
                                                    title={group.tooltip}
                                                >
                                                    ℹ️
                                                </span>
                                            )}
                                        </h2>
                                    </div>
                                    <div style={{ color: '#3498db', fontSize: '18px', fontWeight: 'bold' }}>
                                        {formatE8s(group.totalStake)} {tokenSymbol}
                                    </div>
                                </div>

                                {expandedGroups.has(groupId) && (
                                    <div style={{ 
                                        display: 'grid',
                                        gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
                                        gap: '20px'
                                    }}>
                                        {group.neurons.map((neuron) => {
                                            const neuronId = uint8ArrayToHex(neuron.id[0]?.id);
                                            if (!neuronId) return null;

                                            const hasHotkeyAccess = neuron.permissions.some(p => 
                                                p.principal?.toString() === identity.getPrincipal().toString() &&
                                                p.permission_type.includes(4)
                                            );

                                            const { name, nickname, isVerified } = getDisplayName(neuronId);
                                            const displayName = name || nickname;

                                            return (
                                                <div
                                                    key={neuronId}
                                                    style={{
                                                        backgroundColor: '#2a2a2a',
                                                        borderRadius: '8px',
                                                        padding: '20px',
                                                        border: '1px solid #3a3a3a'
                                                    }}
                                                >
                                                    <div style={{ marginBottom: '15px' }}>
                                                        <div style={{ marginBottom: '5px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                            <Link
                                                                to={`/neuron?neuronid=${neuronId}&sns=${selectedSnsRoot}`}
                                                                style={{ 
                                                                    display: 'flex', 
                                                                    alignItems: 'center',
                                                                    fontFamily: 'monospace',
                                                                    color: '#888',
                                                                    fontSize: '14px',
                                                                    textDecoration: 'none'
                                                                }}
                                                                title={neuronId}
                                                                onMouseEnter={(e) => e.target.style.textDecoration = 'underline'}
                                                                onMouseLeave={(e) => e.target.style.textDecoration = 'none'}
                                                            >
                                                                {`${neuronId.slice(0, 6)}...${neuronId.slice(-6)}`}
                                                            </Link>
                                                            <button
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    navigator.clipboard.writeText(neuronId);
                                                                }}
                                                                style={{
                                                                    background: 'none',
                                                                    border: 'none',
                                                                    padding: '4px',
                                                                    cursor: 'pointer',
                                                                    color: '#888',
                                                                    display: 'flex',
                                                                    alignItems: 'center'
                                                                }}
                                                                title="Copy neuron ID to clipboard"
                                                            >
                                                                📋
                                                            </button>
                                                            {hasHotkeyAccess && (
                                                                <button
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        setEditingName(neuronId);
                                                                        setNameInput(displayName || '');
                                                                    }}
                                                                    style={{
                                                                        background: 'none',
                                                                        border: 'none',
                                                                        padding: '4px',
                                                                        cursor: 'pointer',
                                                                        color: '#888',
                                                                        display: 'flex',
                                                                        alignItems: 'center'
                                                                    }}
                                                                    title="Edit neuron name/nickname"
                                                                >
                                                                    ✏️
                                                                </button>
                                                            )}
                                                        </div>
                                                        {name && (
                                                            <div style={{ 
                                                                color: '#3498db',
                                                                fontSize: '18px',
                                                                fontWeight: 'bold',
                                                                marginBottom: '5px',
                                                                display: 'flex',
                                                                alignItems: 'center',
                                                                gap: '4px'
                                                            }}>
                                                                {name}
                                                                {isVerified && (
                                                                    <span 
                                                                        style={{ 
                                                                            fontSize: '14px',
                                                                            cursor: 'help'
                                                                        }}
                                                                        title="Verified name"
                                                                    >
                                                                        ✓
                                                                    </span>
                                                                )}
                                                            </div>
                                                        )}
                                                        {nickname && (
                                                            <div style={{ 
                                                                color: '#95a5a6',
                                                                fontSize: '16px',
                                                                fontStyle: 'italic',
                                                                marginBottom: '5px'
                                                            }}>
                                                                {nickname}
                                                            </div>
                                                        )}
                                                        <div
                                                            style={{
                                                                color: '#888',
                                                                cursor: 'help',
                                                                fontSize: '14px'
                                                            }}
                                                            title="Names (blue) are public and visible to everyone, but can only be set if you have hotkey access. Nicknames (gray) are private and can be set for any neuron you can see."
                                                        >
                                                            ℹ️
                                                        </div>
                                                        {editingName === neuronId && (
                                                            <div style={{ 
                                                                marginTop: '10px',
                                                                display: 'flex',
                                                                flexDirection: 'column',
                                                                gap: '10px'
                                                            }}>
                                                                <div>
                                                                    <input
                                                                        type="text"
                                                                        value={nameInput}
                                                                        onChange={(e) => {
                                                                            const newValue = e.target.value;
                                                                            setNameInput(newValue);
                                                                            setInputError(validateNameInput(newValue));
                                                                        }}
                                                                        maxLength={32}
                                                                        placeholder="Enter neuron name (max 32 chars)"
                                                                        style={{
                                                                            backgroundColor: '#3a3a3a',
                                                                            border: `1px solid ${inputError ? '#e74c3c' : '#4a4a4a'}`,
                                                                            borderRadius: '4px',
                                                                            color: '#ffffff',
                                                                            padding: '8px',
                                                                            width: '100%'
                                                                        }}
                                                                    />
                                                                    {inputError && (
                                                                        <div style={{
                                                                            color: '#e74c3c',
                                                                            fontSize: '12px',
                                                                            marginTop: '4px'
                                                                        }}>
                                                                            {inputError}
                                                                        </div>
                                                                    )}
                                                                    <div style={{
                                                                        color: '#888',
                                                                        fontSize: '12px',
                                                                        marginTop: '4px'
                                                                    }}>
                                                                        Allowed: letters, numbers, spaces, hyphens (-), underscores (_), dots (.), apostrophes (')
                                                                    </div>
                                                                </div>
                                                                <div style={{
                                                                    display: 'flex',
                                                                    gap: '8px',
                                                                    justifyContent: 'flex-end'
                                                                }}>
                                                                    <button
                                                                        onClick={() => handleNameSubmit(neuronId, true)}
                                                                        disabled={isSubmitting}
                                                                        style={{
                                                                            backgroundColor: '#95a5a6',
                                                                            color: '#ffffff',
                                                                            border: 'none',
                                                                            borderRadius: '4px',
                                                                            padding: '8px 12px',
                                                                            cursor: isSubmitting ? 'not-allowed' : 'pointer',
                                                                            whiteSpace: 'nowrap',
                                                                            opacity: isSubmitting ? 0.7 : 1,
                                                                            display: 'flex',
                                                                            alignItems: 'center',
                                                                            gap: '6px'
                                                                        }}
                                                                        title="Set as private nickname"
                                                                    >
                                                                        {isSubmitting ? (
                                                                            <>
                                                                                <span style={{ 
                                                                                    display: 'inline-block',
                                                                                    animation: 'spin 1s linear infinite',
                                                                                    fontSize: '14px'
                                                                                }}>⟳</span>
                                                                                Setting...
                                                                            </>
                                                                        ) : (
                                                                            'Set Nickname'
                                                                        )}
                                                                    </button>
                                                                    {hasHotkeyAccess && (
                                                                        <button
                                                                            onClick={() => handleNameSubmit(neuronId, false)}
                                                                            disabled={isSubmitting}
                                                                            style={{
                                                                                backgroundColor: '#3498db',
                                                                                color: '#ffffff',
                                                                                border: 'none',
                                                                                borderRadius: '4px',
                                                                                padding: '8px 12px',
                                                                                cursor: isSubmitting ? 'not-allowed' : 'pointer',
                                                                                whiteSpace: 'nowrap',
                                                                                opacity: isSubmitting ? 0.7 : 1,
                                                                                display: 'flex',
                                                                                alignItems: 'center',
                                                                                gap: '6px'
                                                                            }}
                                                                            title="Set as public name"
                                                                        >
                                                                            {isSubmitting ? (
                                                                                <>
                                                                                    <span style={{ 
                                                                                        display: 'inline-block',
                                                                                        animation: 'spin 1s linear infinite',
                                                                                        fontSize: '14px'
                                                                                    }}>⟳</span>
                                                                                    Setting...
                                                                                </>
                                                                            ) : (
                                                                                'Set Name'
                                                                            )}
                                                                        </button>
                                                                    )}
                                                                    <button
                                                                        onClick={() => {
                                                                            setEditingName(null);
                                                                            setNameInput('');
                                                                        }}
                                                                        disabled={isSubmitting}
                                                                        style={{
                                                                            backgroundColor: '#e74c3c',
                                                                            color: '#ffffff',
                                                                            border: 'none',
                                                                            borderRadius: '4px',
                                                                            padding: '8px 12px',
                                                                            cursor: isSubmitting ? 'not-allowed' : 'pointer',
                                                                            whiteSpace: 'nowrap',
                                                                            opacity: isSubmitting ? 0.7 : 1
                                                                        }}
                                                                    >
                                                                        Cancel
                                                                    </button>
                                                                </div>
                                                            </div>
                                                        )}
                                                        <div style={{ 
                                                            fontSize: '24px',
                                                            fontWeight: 'bold',
                                                            color: '#3498db'
                                                        }}>
                                                            {formatE8s(neuron.cached_neuron_stake_e8s)} {tokenSymbol}
                                                        </div>
                                                    </div>

                                                    <div style={{ 
                                                        display: 'grid',
                                                        gridTemplateColumns: '1fr 1fr',
                                                        gap: '15px',
                                                        fontSize: '14px'
                                                    }}>
                                                        <div>
                                                            <div style={{ color: '#888' }}>Created</div>
                                                            <div style={{ color: '#ffffff' }}>
                                                                {new Date(Number(neuron.created_timestamp_seconds) * 1000).toLocaleDateString()}
                                                            </div>
                                                        </div>
                                                        <div>
                                                            <div style={{ color: '#888' }}>Dissolve State</div>
                                                            <div style={{ color: '#ffffff' }}>{getDissolveState(neuron)}</div>
                                                        </div>
                                                        <div>
                                                            <div style={{ color: '#888' }}>Maturity</div>
                                                            <div style={{ color: '#ffffff' }}>{formatE8s(neuron.maturity_e8s_equivalent)} {tokenSymbol}</div>
                                                        </div>
                                                        <div>
                                                            <div style={{ color: '#888' }}>Voting Power</div>
                                                            <div style={{ color: '#ffffff' }}>{(Number(neuron.voting_power_percentage_multiplier) / 100).toFixed(2)}x</div>
                                                        </div>
                                                        {/* Replace debug info with hotkey status */}
                                                        <div style={{ gridColumn: '1 / -1' }}>
                                                            <div style={{ 
                                                                color: '#888',
                                                                fontSize: '14px',
                                                                display: 'flex',
                                                                alignItems: 'center',
                                                                gap: '5px'
                                                            }}>
                                                                {neuron.permissions.some(p => 
                                                                    p.principal?.toString() === identity.getPrincipal().toString() &&
                                                                    p.permission_type.includes(4) // Check for vote permission
                                                                ) ? (
                                                                    <>
                                                                        <span style={{ color: '#2ecc71' }}>🔑 Hotkey Access</span>
                                                                    </>
                                                                ) : null}
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </main>
            <style>{spinKeyframes}</style>
            <ConfirmationModal
                show={showConfirmModal}
                onClose={() => setShowConfirmModal(false)}
                onSubmit={confirmAction}
                message={confirmMessage}
                doAwait={true}
            />
        </div>
    );
} 