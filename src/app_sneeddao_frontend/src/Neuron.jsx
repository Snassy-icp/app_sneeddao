import React, { useState, useEffect } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { createActor as createSnsGovernanceActor } from 'external/sns_governance';
import { createActor as createRllActor, canisterId as rllCanisterId } from 'external/rll';
import { useAuth } from './AuthContext';
import Header from './components/Header';
import './Wallet.css';
import { fetchAndCacheSnsData, getSnsById, getAllSnses, clearSnsCache } from './utils/SnsUtils';
import { formatProposalIdLink, uint8ArrayToHex, getNeuronColor } from './utils/NeuronUtils';
import { useNaming } from './NamingContext';
import { setNeuronNickname } from './utils/BackendUtils';

function Neuron() {
    const { isAuthenticated, identity } = useAuth();
    const [searchParams, setSearchParams] = useSearchParams();
    const navigate = useNavigate();
    const [neuronIdInput, setNeuronIdInput] = useState(searchParams.get('neuronid') || '');
    const [currentNeuronId, setCurrentNeuronId] = useState(searchParams.get('neuronid') || '');
    const [selectedSnsRoot, setSelectedSnsRoot] = useState(searchParams.get('sns') || '');
    const [snsList, setSnsList] = useState([]);
    const [neuronData, setNeuronData] = useState(null);
    const [votingHistory, setVotingHistory] = useState(null);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [loadingSnses, setLoadingSnses] = useState(true);
    const SNEED_SNS_ROOT = 'fp274-iaaaa-aaaaq-aacha-cai';
    // Add filter states
    const [hideYes, setHideYes] = useState(false);
    const [hideNo, setHideNo] = useState(false);
    const [hideNotVoted, setHideNotVoted] = useState(false);
    // Add sort state
    const [sortBy, setSortBy] = useState('proposalId');
    // Add nickname editing states
    const [isEditingNickname, setIsEditingNickname] = useState(false);
    const [nicknameInput, setNicknameInput] = useState('');
    
    // Get naming context
    const { neuronNames, neuronNicknames, verifiedNames, fetchAllNames } = useNaming();

    // Helper function to get display name
    const getDisplayName = (neuronId) => {
        const mapKey = `${selectedSnsRoot}:${neuronId}`;
        
        // Convert arrays to Maps for easier lookup
        const namesMap = new Map(Array.from(neuronNames.entries()));
        const nicknamesMap = new Map(Array.from(neuronNicknames.entries()));
        const verifiedMap = new Map(Array.from(verifiedNames.entries()));

        // Get values from maps
        const name = namesMap.get(mapKey);
        const nickname = nicknamesMap.get(mapKey);
        const isVerified = verifiedMap.get(mapKey);

        console.log('Getting display name for:', {
            neuronId,
            mapKey,
            name,
            nickname,
            isVerified,
            allNames: Array.from(namesMap.entries()),
            allNicknames: Array.from(nicknamesMap.entries()),
            allVerified: Array.from(verifiedMap.entries())
        });

        return { name, nickname, isVerified };
    };

    // Add filter and sort function
    const filterAndSortVotes = (votes) => {
        if (!votes) return [];
        const filtered = votes.filter(vote => {
            if (vote.vote === 1 && hideYes) return false;
            if (vote.vote === 2 && hideNo) return false;
            if (vote.vote !== 1 && vote.vote !== 2 && hideNotVoted) return false;
            return true;
        });

        return filtered.sort((a, b) => {
            switch (sortBy) {
                case 'proposalId':
                    return Number(b.proposal_id) - Number(a.proposal_id);
                case 'date':
                    return Number(b.timestamp) - Number(a.timestamp);
                case 'votingPower':
                    return Number(b.voting_power) - Number(a.voting_power);
                default:
                    return 0;
            }
        });
    };

    // Fetch SNS data on component mount
    useEffect(() => {
        async function loadSnsData() {
            console.log('Starting loadSnsData in Neuron component...'); // Debug log
            setLoadingSnses(true);
            try {
                console.log('Calling fetchAndCacheSnsData...'); // Debug log
                const data = await fetchAndCacheSnsData(identity);
                console.log('Received SNS data:', data); // Debug log
                setSnsList(data);
                
                // If no SNS is selected but we have SNSes, select the first one
                if (!selectedSnsRoot && data.length > 0) {
                    console.log('Setting default SNS:', data[0]); // Debug log
                    setSelectedSnsRoot(data[0].rootCanisterId);
                    setSearchParams(prev => {
                        prev.set('sns', data[0].rootCanisterId);
                        return prev;
                    });
                }
                
                // Fetch all names when component mounts
                console.log('Fetching all names on mount...');
                await fetchAllNames();
                console.log('Names after mount fetch:', {
                    names: Array.from(neuronNames.entries()),
                    nicknames: Array.from(neuronNicknames.entries()),
                    verified: Array.from(verifiedNames.entries())
                });
            } catch (err) {
                console.error('Error loading SNS data:', err);
                setError('Failed to load SNS list');
            } finally {
                setLoadingSnses(false);
            }
        }

        if (isAuthenticated) {
            console.log('User is authenticated, loading SNS data...'); // Debug log
            loadSnsData();
        } else {
            console.log('User is not authenticated'); // Debug log
        }
    }, [isAuthenticated, identity]);

    useEffect(() => {
        if (currentNeuronId && selectedSnsRoot) {
            fetchNeuronData();
            // If this is a Sneed neuron, also fetch its voting history
            if (selectedSnsRoot === SNEED_SNS_ROOT) {
                fetchVotingHistory();
            }
        }
    }, [currentNeuronId, selectedSnsRoot]);

    const fetchNeuronData = async () => {
        setLoading(true);
        setError('');
        try {
            const selectedSns = getSnsById(selectedSnsRoot);
            if (!selectedSns) {
                setError('Selected SNS not found');
                return;
            }

            const snsGovActor = createSnsGovernanceActor(selectedSns.canisters.governance, {
                agentOptions: {
                    identity,
                },
            });

            // Convert the hex string neuron ID back to a byte array
            const neuronIdBytes = new Uint8Array(
                currentNeuronId.match(/.{1,2}/g)
                    .map(byte => parseInt(byte, 16))
            );
            
            const neuronIdArg = {
                neuron_id: [{ id: Array.from(neuronIdBytes) }]
            };

            const response = await snsGovActor.get_neuron(neuronIdArg);
            if (response?.result?.[0]?.Neuron) {
                setNeuronData(response.result[0].Neuron);
                // Fetch all names to ensure we have the latest data
                console.log('Fetching all names after getting neuron data...');
                await fetchAllNames();
                console.log('Names after neuron data fetch:', {
                    names: Array.from(neuronNames.entries()),
                    nicknames: Array.from(neuronNicknames.entries()),
                    verified: Array.from(verifiedNames.entries())
                });
            } else if (response?.result?.[0]?.Error) {
                setError(response.result[0].Error.error_message);
            } else {
                setError('Neuron not found');
            }
        } catch (err) {
            console.error('Error fetching neuron data:', err);
            setError('Failed to fetch neuron data');
        } finally {
            setLoading(false);
        }
    };

    const fetchVotingHistory = async () => {
        try {
            const rllActor = createRllActor(rllCanisterId, { agentOptions: { identity } });
            
            // Convert the hex string neuron ID back to a byte array
            const neuronIdBytes = new Uint8Array(
                currentNeuronId.match(/.{1,2}/g)
                    .map(byte => parseInt(byte, 16))
            );
            
            const history = await rllActor.get_neuron_voting_history(Array.from(neuronIdBytes));
            setVotingHistory(history);
        } catch (err) {
            console.error('Error fetching voting history:', err);
            setVotingHistory([]);
        }
    };

    const handleSearch = (e) => {
        e.preventDefault();
        setError('');
        
        if (!neuronIdInput.trim()) {
            setError('Please enter a neuron ID');
            return;
        }

        if (!selectedSnsRoot) {
            setError('Please select an SNS');
            return;
        }

        // Update URL and trigger search
        setSearchParams({ neuronid: neuronIdInput, sns: selectedSnsRoot });
        setCurrentNeuronId(neuronIdInput);
    };

    const handleSnsChange = (e) => {
        const newSnsRoot = e.target.value;
        setSelectedSnsRoot(newSnsRoot);
        setSearchParams(prev => {
            prev.set('sns', newSnsRoot);
            if (currentNeuronId) {
                prev.set('neuronid', currentNeuronId);
            }
            return prev;
        });
    };

    const formatE8s = (e8s) => {
        return (Number(e8s) / 100000000).toFixed(8);
    };

    const getDissolveState = (neuron) => {
        if (!neuron.dissolve_state?.[0]) return 'Unknown';
        
        if ('DissolveDelaySeconds' in neuron.dissolve_state[0]) {
            const seconds = Number(neuron.dissolve_state[0].DissolveDelaySeconds);
            const days = Math.floor(seconds / (24 * 60 * 60));
            return `Locked for ${days} days`;
        }
        
        if ('WhenDissolvedTimestampSeconds' in neuron.dissolve_state[0]) {
            const dissolveTime = Number(neuron.dissolve_state[0].WhenDissolvedTimestampSeconds);
            const now = Math.floor(Date.now() / 1000);
            if (dissolveTime <= now) {
                return 'Dissolved';
            }
            const daysLeft = Math.floor((dissolveTime - now) / (24 * 60 * 60));
            return `Dissolving (${daysLeft} days left)`;
        }
        
        return 'Unknown';
    };

    const selectedSns = getSnsById(selectedSnsRoot);

    // Helper function to format vote
    const formatVote = (voteNumber) => {
        switch (voteNumber) {
            case 1:
                return 'Yes';
            case 2:
                return 'No';
            default:
                return 'Not Voted';
        }
    };

    // Add handleNicknameSubmit function
    const handleNicknameSubmit = async () => {
        if (!nicknameInput.trim() || !identity || !currentNeuronId) return;

        try {
            const response = await setNeuronNickname(identity, selectedSnsRoot, currentNeuronId, nicknameInput);
            if ('ok' in response) {
                // Refresh global names
                await fetchAllNames();
            } else {
                setError(response.err);
            }
        } catch (err) {
            console.error('Error setting neuron nickname:', err);
            setError('Failed to set neuron nickname');
        } finally {
            setIsEditingNickname(false);
            setNicknameInput('');
        }
    };

    return (
        <div className='page-container'>
            <Header showSnsDropdown={true} />
            <main className="wallet-container">
                <h1 style={{ color: '#ffffff' }}>Neuron Details</h1>
                
                <section style={{ backgroundColor: '#2a2a2a', borderRadius: '8px', padding: '20px', marginTop: '20px' }}>
                    <form onSubmit={handleSearch} style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <input
                                type="text"
                                value={neuronIdInput}
                                onChange={(e) => setNeuronIdInput(e.target.value)}
                                placeholder="Enter Neuron ID"
                                style={{
                                    backgroundColor: '#3a3a3a',
                                    border: '1px solid #4a4a4a',
                                    borderRadius: '4px',
                                    color: '#ffffff',
                                    padding: '8px 12px',
                                    width: '100%',
                                    fontSize: '14px'
                                }}
                            />
                            <button 
                                type="submit" 
                                style={{
                                    backgroundColor: '#3498db',
                                    color: '#ffffff',
                                    border: 'none',
                                    borderRadius: '4px',
                                    padding: '8px 16px',
                                    cursor: 'pointer',
                                    fontSize: '14px',
                                    whiteSpace: 'nowrap'
                                }}
                            >
                                Search
                            </button>
                        </div>
                    </form>
                    {error && <div style={{ color: '#e74c3c', marginTop: '10px' }}>{error}</div>}

                    {loading && (
                        <div style={{ color: '#ffffff', textAlign: 'center', padding: '20px' }}>
                            Loading...
                        </div>
                    )}

                    {neuronData && !loading && (
                        <div style={{ color: '#ffffff' }}>
                            <h2>Neuron Information</h2>
                            <div style={{ backgroundColor: '#3a3a3a', padding: '15px', borderRadius: '6px', marginTop: '10px' }}>
                                <div style={{ marginBottom: '15px' }}>
                                    <div style={{ 
                                        display: 'flex', 
                                        alignItems: 'center', 
                                        gap: '10px',
                                        marginBottom: '10px'
                                    }}>
                                        <div style={{ 
                                            fontFamily: 'monospace',
                                            fontSize: '16px',
                                            color: '#888'
                                        }}>
                                            {currentNeuronId}
                                            <button
                                                onClick={() => navigator.clipboard.writeText(currentNeuronId)}
                                                style={{
                                                    background: 'none',
                                                    border: 'none',
                                                    padding: '4px',
                                                    cursor: 'pointer',
                                                    color: '#888',
                                                    display: 'inline-flex',
                                                    alignItems: 'center',
                                                    marginLeft: '8px'
                                                }}
                                                title="Copy neuron ID to clipboard"
                                            >
                                                📋
                                            </button>
                                        </div>
                                    </div>
                                    {(() => {
                                        const { name, nickname, isVerified } = getDisplayName(currentNeuronId);
                                        const neuronColor = getNeuronColor(currentNeuronId);
                                        return (
                                            <>
                                                {name && (
                                                    <div style={{ 
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: '4px',
                                                        marginBottom: '5px'
                                                    }}>
                                                        <span style={{ 
                                                            color: neuronColor,
                                                            fontSize: '18px',
                                                            fontWeight: 'bold'
                                                        }}>
                                                            {name}
                                                        </span>
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
                                                        color: neuronColor,
                                                        fontSize: '16px',
                                                        fontStyle: 'italic',
                                                        opacity: 0.8,
                                                        marginBottom: '5px'
                                                    }}>
                                                        {nickname}
                                                    </div>
                                                )}
                                                <div style={{ 
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '10px',
                                                    marginBottom: '5px'
                                                }}>
                                                    {isEditingNickname ? (
                                                        <div style={{ 
                                                            display: 'flex',
                                                            flexDirection: 'column',
                                                            gap: '10px',
                                                            width: '100%'
                                                        }}>
                                                            <input
                                                                type="text"
                                                                value={nicknameInput}
                                                                onChange={(e) => setNicknameInput(e.target.value)}
                                                                placeholder="Enter nickname"
                                                                style={{
                                                                    backgroundColor: '#2a2a2a',
                                                                    border: '1px solid #4a4a4a',
                                                                    borderRadius: '4px',
                                                                    color: '#ffffff',
                                                                    padding: '8px',
                                                                    width: '100%',
                                                                    fontSize: '14px'
                                                                }}
                                                            />
                                                            <div style={{
                                                                display: 'flex',
                                                                gap: '8px',
                                                                justifyContent: 'flex-end'
                                                            }}>
                                                                <button
                                                                    onClick={handleNicknameSubmit}
                                                                    style={{
                                                                        backgroundColor: '#95a5a6',
                                                                        color: '#ffffff',
                                                                        border: 'none',
                                                                        borderRadius: '4px',
                                                                        padding: '8px 12px',
                                                                        cursor: 'pointer',
                                                                        whiteSpace: 'nowrap'
                                                                    }}
                                                                >
                                                                    Save
                                                                </button>
                                                                <button
                                                                    onClick={() => {
                                                                        setIsEditingNickname(false);
                                                                        setNicknameInput('');
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
                                                    ) : (
                                                        <>
                                                            {isAuthenticated && (
                                                                <button
                                                                    onClick={() => {
                                                                        setIsEditingNickname(true);
                                                                        setNicknameInput(nickname || '');
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
                                                                    title={nickname ? "Edit nickname" : "Add nickname"}
                                                                >
                                                                    ✏️
                                                                </button>
                                                            )}
                                                        </>
                                                    )}
                                                </div>
                                            </>
                                        );
                                    })()}
                                </div>
                                <p><strong>SNS:</strong> {selectedSns?.name || 'Unknown SNS'}</p>
                                <p><strong>Stake:</strong> {formatE8s(neuronData.cached_neuron_stake_e8s)} {selectedSns?.name || 'SNS'}</p>
                                <p><strong>Created:</strong> {new Date(Number(neuronData.created_timestamp_seconds || 0) * 1000).toLocaleString()}</p>
                                <p><strong>Dissolve State:</strong> {getDissolveState(neuronData)}</p>
                                <p><strong>Maturity:</strong> {formatE8s(neuronData.maturity_e8s_equivalent)} {selectedSns?.name || 'SNS'}</p>
                                <p><strong>Voting Power Multiplier:</strong> {(Number(neuronData.voting_power_percentage_multiplier || 0) / 100).toFixed(2)}x</p>
                            </div>

                            {selectedSnsRoot === SNEED_SNS_ROOT && votingHistory && votingHistory.length > 0 && (
                                <div style={{ marginTop: '20px' }}>
                                    <h2>Voting History</h2>
                                    <div style={{ backgroundColor: '#3a3a3a', padding: '15px', borderRadius: '6px' }}>
                                        <div style={{
                                            display: 'flex',
                                            gap: '20px',
                                            marginBottom: '15px',
                                            padding: '10px',
                                            backgroundColor: '#2a2a2a',
                                            borderRadius: '4px',
                                            flexWrap: 'wrap',
                                            alignItems: 'center',
                                            justifyContent: 'space-between'
                                        }}>
                                            <div style={{
                                                display: 'flex',
                                                gap: '20px',
                                                alignItems: 'center'
                                            }}>
                                                <label style={{ 
                                                    display: 'flex', 
                                                    alignItems: 'center', 
                                                    gap: '8px',
                                                    color: '#2ecc71',
                                                    cursor: 'pointer'
                                                }}>
                                                    <input
                                                        type="checkbox"
                                                        checked={hideYes}
                                                        onChange={(e) => setHideYes(e.target.checked)}
                                                    />
                                                    Hide Yes
                                                </label>
                                                <label style={{ 
                                                    display: 'flex', 
                                                    alignItems: 'center', 
                                                    gap: '8px',
                                                    color: '#e74c3c',
                                                    cursor: 'pointer'
                                                }}>
                                                    <input
                                                        type="checkbox"
                                                        checked={hideNo}
                                                        onChange={(e) => setHideNo(e.target.checked)}
                                                    />
                                                    Hide No
                                                </label>
                                                <label style={{ 
                                                    display: 'flex', 
                                                    alignItems: 'center', 
                                                    gap: '8px',
                                                    color: '#888',
                                                    cursor: 'pointer'
                                                }}>
                                                    <input
                                                        type="checkbox"
                                                        checked={hideNotVoted}
                                                        onChange={(e) => setHideNotVoted(e.target.checked)}
                                                    />
                                                    Hide Not Voted
                                                </label>
                                            </div>
                                            <div style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '8px'
                                            }}>
                                                <label style={{
                                                    color: '#888',
                                                    fontSize: '14px'
                                                }}>
                                                    Sort by:
                                                </label>
                                                <select
                                                    value={sortBy}
                                                    onChange={(e) => setSortBy(e.target.value)}
                                                    style={{
                                                        backgroundColor: '#3a3a3a',
                                                        color: '#fff',
                                                        border: '1px solid #4a4a4a',
                                                        borderRadius: '4px',
                                                        padding: '4px 8px',
                                                        cursor: 'pointer'
                                                    }}
                                                >
                                                    <option value="proposalId">Proposal ID</option>
                                                    <option value="date">Date</option>
                                                    <option value="votingPower">Voting Power</option>
                                                </select>
                                            </div>
                                        </div>
                                        {filterAndSortVotes(votingHistory).map((vote, index) => (
                                            <div 
                                                key={index}
                                                style={{
                                                    padding: '10px',
                                                    backgroundColor: '#2a2a2a',
                                                    marginBottom: '10px',
                                                    borderRadius: '4px'
                                                }}
                                            >
                                                <div style={{ 
                                                    display: 'flex',
                                                    justifyContent: 'space-between',
                                                    alignItems: 'center',
                                                    marginBottom: '5px'
                                                }}>
                                                    <div>
                                                        <strong>Proposal:</strong>{' '}
                                                        {formatProposalIdLink(vote.proposal_id, selectedSnsRoot)}
                                                    </div>
                                                    <div style={{ 
                                                        color: vote.vote === 1 ? '#2ecc71' : vote.vote === 2 ? '#e74c3c' : '#ffffff',
                                                        fontWeight: 'bold'
                                                    }}>
                                                        {formatVote(vote.vote)}
                                                    </div>
                                                </div>
                                                <div style={{ fontSize: '14px', color: '#888' }}>
                                                    <div>{vote.proposal_title || 'No title'}</div>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '5px' }}>
                                                        <span>{vote.vote !== 0 ? new Date(Number(vote.timestamp) * 1000).toLocaleString() : ''}</span>
                                                        <span>{formatE8s(vote.voting_power)} VP</span>
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </section>
            </main>
        </div>
    );
}

export default Neuron; 