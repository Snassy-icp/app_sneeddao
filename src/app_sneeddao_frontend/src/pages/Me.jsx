import React, { useState, useEffect } from 'react';
import { useAuth } from '../AuthContext';
import { useNavigate } from 'react-router-dom';
import Header from '../components/Header';
import { fetchAndCacheSnsData, getSnsById } from '../utils/SnsUtils';
import { 
    fetchUserNeuronsForSns, 
    formatE8s, 
    getDissolveState, 
    formatNeuronIdLink,
    uint8ArrayToHex,
    getOwnerPrincipals
} from '../utils/NeuronUtils';

export default function Me() {
    const { identity } = useAuth();
    const navigate = useNavigate();
    const [selectedSnsRoot, setSelectedSnsRoot] = useState('');
    const [snsList, setSnsList] = useState([]);
    const [neurons, setNeurons] = useState([]);
    const [error, setError] = useState(null);
    const [loading, setLoading] = useState(false);
    const [loadingSnses, setLoadingSnses] = useState(true);
    const [expandedGroups, setExpandedGroups] = useState(new Set(['self'])); // Default expand self group

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
                // Default to Sneed SNS
                const sneedSns = data.find(sns => sns.rootCanisterId === 'fp274-iaaaa-aaaaq-aacha-cai');
                if (sneedSns) {
                    setSelectedSnsRoot(sneedSns.rootCanisterId);
                }
            } catch (err) {
                console.error('Error fetching SNS data:', err);
                setError('Failed to load SNS data');
            } finally {
                setLoadingSnses(false);
            }
        };
        fetchSnsData();
    }, []);

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
            } catch (err) {
                console.error('Error fetching neurons:', err);
                setError('Failed to load neurons');
            } finally {
                setLoading(false);
            }
        };
        fetchNeurons();
    }, [identity, selectedSnsRoot]);

    const handleSnsChange = (e) => {
        setSelectedSnsRoot(e.target.value);
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
                                        {formatE8s(group.totalStake)} SNS
                                    </div>
                                </div>

                                {expandedGroups.has(groupId) && (
                                    <div style={{ 
                                        display: 'grid',
                                        gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
                                        gap: '20px'
                                    }}>
                                        {group.neurons.map((neuron) => {
                                            const neuronId = neuron.id[0]?.id;
                                            if (!neuronId) return null;

                                            return (
                                                <div
                                                    key={uint8ArrayToHex(neuronId)}
                                                    style={{
                                                        backgroundColor: '#2a2a2a',
                                                        borderRadius: '8px',
                                                        padding: '20px',
                                                        border: '1px solid #3a3a3a'
                                                    }}
                                                >
                                                    <div style={{ marginBottom: '15px' }}>
                                                        <div style={{ marginBottom: '5px' }}>
                                                            {formatNeuronIdLink(neuronId, selectedSnsRoot)}
                                                        </div>
                                                        <div style={{ 
                                                            fontSize: '24px',
                                                            fontWeight: 'bold',
                                                            color: '#3498db'
                                                        }}>
                                                            {formatE8s(neuron.cached_neuron_stake_e8s)} SNS
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
                                                            <div style={{ color: '#ffffff' }}>{formatE8s(neuron.maturity_e8s_equivalent)} SNS</div>
                                                        </div>
                                                        <div>
                                                            <div style={{ color: '#888' }}>Voting Power</div>
                                                            <div style={{ color: '#ffffff' }}>{(Number(neuron.voting_power_percentage_multiplier) / 100).toFixed(2)}x</div>
                                                        </div>
                                                        {/* Temporary debugging info */}
                                                        <div style={{ gridColumn: '1 / -1' }}>
                                                            <div style={{ color: '#888' }}>Permissions</div>
                                                            <div style={{ color: '#ffffff', fontSize: '12px', wordBreak: 'break-all' }}>
                                                                {neuron.permissions.map((p, i) => (
                                                                    <div key={i}>
                                                                        {p.principal?.toString()}: [{p.permission_type.join(', ')}]
                                                                    </div>
                                                                ))}
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