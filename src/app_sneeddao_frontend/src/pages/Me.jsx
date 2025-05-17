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
    getAllNeuronNicknames
} from '../utils/BackendUtils';

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
    const [neuronNames, setNeuronNames] = useState(new Map());
    const [neuronNicknames, setNeuronNicknames] = useState(new Map());
    const [editingName, setEditingName] = useState(null);
    const [nameInput, setNameInput] = useState('');

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
                    title: owner === userPrincipal ? 'My Neurons' : `Neurons owned by ${owner}`,
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

    // Fetch neuron names and nicknames
    useEffect(() => {
        const fetchNames = async () => {
            if (!identity || !selectedSnsRoot) return;

            try {
                // Fetch all public names
                const names = await getAllNeuronNames(identity);
                if (names) {
                    const namesMap = new Map();
                    names.forEach(([key, name]) => {
                        if (key.sns_root_canister_id.toString() === selectedSnsRoot) {
                            namesMap.set(uint8ArrayToHex(key.neuron_id.id), name);
                        }
                    });
                    setNeuronNames(namesMap);
                }

                // Fetch user's nicknames
                const nicknames = await getAllNeuronNicknames(identity);
                if (nicknames) {
                    const nicknamesMap = new Map();
                    nicknames.forEach(([key, nickname]) => {
                        if (key.sns_root_canister_id.toString() === selectedSnsRoot) {
                            nicknamesMap.set(uint8ArrayToHex(key.neuron_id.id), nickname);
                        }
                    });
                    setNeuronNicknames(nicknamesMap);
                }
            } catch (err) {
                console.error('Error fetching neuron names:', err);
            }
        };

        fetchNames();
    }, [identity, selectedSnsRoot]);

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
        if (!nameInput.trim()) return;

        try {
            const response = isNickname ?
                await setNeuronNickname(identity, selectedSnsRoot, neuronId, nameInput) :
                await setNeuronName(identity, selectedSnsRoot, neuronId, nameInput);

            if ('ok' in response) {
                // Update local state
                if (isNickname) {
                    setNeuronNicknames(prev => new Map(prev).set(neuronId, nameInput));
                } else {
                    setNeuronNames(prev => new Map(prev).set(neuronId, nameInput));
                }
            } else {
                setError(response.err);
            }
        } catch (err) {
            console.error('Error setting neuron name:', err);
            setError('Failed to set neuron name');
        } finally {
            setEditingName(null);
            setNameInput('');
        }
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
                                        <h2 style={{ margin: 0, color: '#ffffff' }}>
                                            {group.title} ({group.neurons.length})
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

                                            const publicName = neuronNames.get(neuronId);
                                            const nickname = neuronNicknames.get(neuronId);
                                            const displayName = publicName || nickname;

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
                                                            <div 
                                                                style={{ 
                                                                    display: 'flex', 
                                                                    alignItems: 'center',
                                                                    fontFamily: 'monospace',
                                                                    cursor: 'pointer'
                                                                }}
                                                                title={formatNeuronIdLink(neuron.id[0]?.id, selectedSnsRoot)}
                                                            >
                                                                {displayName ? (
                                                                    <span style={{ color: publicName ? '#3498db' : '#95a5a6' }}>
                                                                        {displayName}
                                                                    </span>
                                                                ) : (
                                                                    `${neuronId.slice(0, 8)}...${neuronId.slice(-8)}`
                                                                )}
                                                            </div>
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
                                                                    title="Edit neuron name"
                                                                >
                                                                    ✏️
                                                                </button>
                                                            )}
                                                        </div>
                                                        {editingName === neuronId && (
                                                            <div style={{ 
                                                                marginTop: '10px',
                                                                display: 'flex',
                                                                flexDirection: 'column',
                                                                gap: '10px'
                                                            }}>
                                                                <input
                                                                    type="text"
                                                                    value={nameInput}
                                                                    onChange={(e) => setNameInput(e.target.value)}
                                                                    placeholder="Enter neuron name"
                                                                    style={{
                                                                        backgroundColor: '#3a3a3a',
                                                                        border: '1px solid #4a4a4a',
                                                                        borderRadius: '4px',
                                                                        color: '#ffffff',
                                                                        padding: '8px',
                                                                        width: '100%'
                                                                    }}
                                                                />
                                                                <div style={{
                                                                    display: 'flex',
                                                                    gap: '8px',
                                                                    justifyContent: 'flex-end'
                                                                }}>
                                                                    <button
                                                                        onClick={() => handleNameSubmit(neuronId, true)}
                                                                        style={{
                                                                            backgroundColor: '#95a5a6',
                                                                            color: '#ffffff',
                                                                            border: 'none',
                                                                            borderRadius: '4px',
                                                                            padding: '8px 12px',
                                                                            cursor: 'pointer',
                                                                            whiteSpace: 'nowrap'
                                                                        }}
                                                                        title="Set as private nickname"
                                                                    >
                                                                        Set Nickname
                                                                    </button>
                                                                    <button
                                                                        onClick={() => handleNameSubmit(neuronId, false)}
                                                                        style={{
                                                                            backgroundColor: '#3498db',
                                                                            color: '#ffffff',
                                                                            border: 'none',
                                                                            borderRadius: '4px',
                                                                            padding: '8px 12px',
                                                                            cursor: 'pointer',
                                                                            whiteSpace: 'nowrap'
                                                                        }}
                                                                        title="Set as public name"
                                                                    >
                                                                        Set Name
                                                                    </button>
                                                                    <button
                                                                        onClick={() => {
                                                                            setEditingName(null);
                                                                            setNameInput('');
                                                                        }}
                                                                        style={{
                                                                            backgroundColor: '#e74c3c',
                                                                            color: '#ffffff',
                                                                            border: 'none',
                                                                            borderRadius: '4px',
                                                                            padding: '8px 12px',
                                                                            cursor: 'pointer',
                                                                            whiteSpace: 'nowrap'
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
        </div>
    );
} 