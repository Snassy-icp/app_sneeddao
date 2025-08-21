import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../AuthContext';

import { createActor, canisterId } from 'declarations/sneed_sns_forum';
import { formatError } from '../utils/errorUtils';

const Poll = ({ 
    poll, 
    onPollUpdate, 
    showCreateForm = false, 
    onCreatePoll,
    onCancelCreate,
    threadId,
    postId = null,
    textLimits,
    selectedNeurons = [],
    allNeurons = [],
    totalVotingPower = 0
}) => {
    const { identity } = useAuth();
    
    // Voting state
    const [votingStates, setVotingStates] = useState(new Map()); // optionId -> 'voting'|'success'|'error'
    const [userVotes, setUserVotes] = useState(new Map()); // neuronId -> optionId
    
    // Create poll state
    const [pollTitle, setPollTitle] = useState('');
    const [pollBody, setPollBody] = useState('');
    const [pollOptions, setPollOptions] = useState([{ title: '', body: '' }, { title: '', body: '' }]);
    const [pollVpPower, setPollVpPower] = useState(1.0);
    const [pollEndDate, setPollEndDate] = useState('');
    const [pollEndTime, setPollEndTime] = useState('12:00');
    const [submittingPoll, setSubmittingPoll] = useState(false);
    const [pollError, setPollError] = useState(null);

    // Poll option management
    const addPollOption = () => {
        if (pollOptions.length < 10) {
            setPollOptions([...pollOptions, { title: '', body: '' }]);
        }
    };

    const removePollOption = (index) => {
        if (pollOptions.length > 2) {
            setPollOptions(pollOptions.filter((_, i) => i !== index));
        }
    };

    const updatePollOption = (index, field, value) => {
        const updated = pollOptions.map((option, i) => 
            i === index ? { ...option, [field]: value } : option
        );
        setPollOptions(updated);
    };

    const clearPollForm = () => {
        setPollTitle('');
        setPollBody('');
        setPollOptions([{ title: '', body: '' }, { title: '', body: '' }]);
        setPollVpPower(1.0);
        setPollEndDate('');
        setPollEndTime('12:00');
        setPollError(null);
    };

    // Get forum actor
    const forumActor = useMemo(() => {
        return identity ? createActor(canisterId, {
            agentOptions: {
                host: process.env.DFX_NETWORK === 'ic' ? 'https://icp0.io' : 'http://localhost:4943',
                identity: identity,
            },
        }) : null;
    }, [identity]);

    // Load user votes for existing poll
    useEffect(() => {
        if (poll && forumActor && allNeurons && allNeurons.length > 0) {
            loadUserVotes();
        }
    }, [poll, forumActor, allNeurons]);

    const loadUserVotes = async () => {
        if (!poll || !forumActor) return;
        
        try {
            const votes = await forumActor.get_poll_votes(poll.id);
            const userVoteMap = new Map();
            
            // Map user's neuron votes
            votes.forEach(vote => {
                const neuronIdStr = Array.from(vote.neuron_id.id).toString();
                const hasNeuron = allNeurons.some(n => 
                    Array.from(n.id[0].id).toString() === neuronIdStr
                );
                
                if (hasNeuron) {
                    userVoteMap.set(neuronIdStr, vote.option_id);
                }
            });
            
            setUserVotes(userVoteMap);
        } catch (error) {
            console.error('Failed to load user votes:', error);
        }
    };

    const handleVoteOnOption = async (optionId) => {
        if (!identity || !forumActor || !selectedNeurons || selectedNeurons.length === 0) {
            alert('Please connect your wallet and select neurons to vote');
            return;
        }

        if (poll.has_ended) {
            alert('This poll has ended');
            return;
        }

        setVotingStates(prev => new Map(prev.set(optionId, 'voting')));

        try {
            const neuronIds = selectedNeurons.map(neuron => ({
                id: neuron.id[0].id
            }));
            
            const result = await forumActor.vote_on_poll_with_neurons(
                poll.id, 
                optionId, 
                neuronIds
            );
            
            if ('ok' in result) {
                setVotingStates(prev => new Map(prev.set(optionId, 'success')));
                
                // Update user votes map
                const newUserVotes = new Map(userVotes);
                selectedNeurons.forEach(neuron => {
                    const neuronIdStr = Array.from(neuron.id[0].id).toString();
                    newUserVotes.set(neuronIdStr, optionId);
                });
                setUserVotes(newUserVotes);
                
                // Refresh poll data
                if (onPollUpdate) {
                    onPollUpdate();
                }
                
                // Clear voting state after delay
                setTimeout(() => {
                    setVotingStates(prev => {
                        const newState = new Map(prev);
                        newState.delete(optionId);
                        return newState;
                    });
                }, 2000);
            } else {
                console.error('Vote failed:', result.err);
                setVotingStates(prev => new Map(prev.set(optionId, 'error')));
                setTimeout(() => {
                    setVotingStates(prev => {
                        const newState = new Map(prev);
                        newState.delete(optionId);
                        return newState;
                    });
                }, 3000);
            }
        } catch (error) {
            console.error('Error voting:', error);
            setVotingStates(prev => new Map(prev.set(optionId, 'error')));
            setTimeout(() => {
                setVotingStates(prev => {
                    const newState = new Map(prev);
                    newState.delete(optionId);
                    return newState;
                });
            }, 3000);
        }
    };

    const handleCreatePoll = async () => {
        if (!identity || !forumActor) {
            setPollError('Please connect your wallet');
            return;
        }

        // Validate poll
        if (!pollTitle.trim() || !pollBody.trim()) {
            setPollError('Please fill in poll title and body');
            return;
        }
        
        if (!pollEndDate || !pollEndTime) {
            setPollError('Please set poll end date and time');
            return;
        }
        
        const validOptions = pollOptions.filter(opt => opt.title.trim());
        if (validOptions.length < 2) {
            setPollError('Poll must have at least 2 options with titles');
            return;
        }
        
        // Check if end date is in the future
        const endDateTime = new Date(`${pollEndDate}T${pollEndTime}`);
        if (endDateTime <= new Date()) {
            setPollError('Poll end date must be in the future');
            return;
        }

        try {
            setSubmittingPoll(true);
            setPollError(null);

            const endTimestamp = endDateTime.getTime() * 1000000; // Convert to nanoseconds

            const formattedOptions = validOptions.map(opt => ({
                title: opt.title.trim(),
                body: opt.body.trim() ? [opt.body.trim()] : [] // Motoko optional
            }));

            const result = await forumActor.create_poll({
                thread_id: threadId,
                post_id: postId ? [postId] : [], // Motoko optional
                title: pollTitle.trim(),
                body: pollBody.trim(),
                options: formattedOptions,
                vp_power: pollVpPower === 1.0 ? [] : [pollVpPower], // Default to 1.0 if not specified
                end_timestamp: endTimestamp
            });

            if ('ok' in result) {
                clearPollForm();
                if (onCreatePoll) {
                    onCreatePoll(result.ok);
                }
            } else {
                setPollError('Failed to create poll: ' + formatError(result.err, 'Unknown error'));
            }
        } catch (error) {
            console.error('Error creating poll:', error);
            setPollError('Failed to create poll: ' + formatError(error, 'Network error'));
        } finally {
            setSubmittingPoll(false);
        }
    };

    const formatDate = (timestamp) => {
        // Convert nanoseconds to milliseconds, handling BigInt
        const timestampBigInt = typeof timestamp === 'bigint' ? timestamp : BigInt(timestamp);
        return new Date(Number(timestampBigInt / 1000000n)).toLocaleString();
    };

    // Format voting power for display (same as ThreadViewer)
    const formatVotingPowerDisplay = (votingPower) => {
        if (votingPower === 0) return '0';
        
        // Convert from e8s to display units
        const displayValue = votingPower / 100_000_000;
        
        if (displayValue >= 1) {
            return displayValue.toLocaleString(undefined, {
                minimumFractionDigits: 0,
                maximumFractionDigits: 2
            });
        } else {
            return displayValue.toLocaleString(undefined, {
                minimumFractionDigits: 0,
                maximumFractionDigits: 8
            });
        }
    };

    const getOptionVotePercentage = (option) => {
        if (!poll || !poll.options || !Array.isArray(poll.options)) return 0;
        const totalVotes = poll.options.reduce((sum, opt) => sum + Number(opt.total_voting_power || 0), 0);
        return totalVotes > 0 ? (Number(option.total_voting_power || 0) / totalVotes) * 100 : 0;
    };

    const getUserVoteForOption = (optionId) => {
        let voteCount = 0;
        userVotes.forEach((votedOptionId, neuronId) => {
            if (votedOptionId === optionId) {
                voteCount++;
            }
        });
        return voteCount;
    };

    // Show create form


    if (showCreateForm) {
        return (
            <div style={{ 
                backgroundColor: '#333', 
                borderRadius: '6px', 
                padding: '20px', 
                border: '1px solid #444',
                marginTop: '15px'
            }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
                    <h4 style={{ color: '#ffffff', fontSize: '16px', margin: 0 }}>
                        📊 Create Poll {postId ? 'for Post' : 'for Thread'}
                    </h4>
                    {onCancelCreate && (
                        <button
                            onClick={onCancelCreate}
                            disabled={submittingPoll}
                            style={{
                                backgroundColor: 'transparent',
                                color: '#888',
                                border: 'none',
                                fontSize: '18px',
                                cursor: 'pointer',
                                padding: '0 5px'
                            }}
                        >
                            ✕
                        </button>
                    )}
                </div>

                {pollError && (
                    <div style={{
                        backgroundColor: 'rgba(231, 76, 60, 0.2)',
                        border: '1px solid #e74c3c',
                        color: '#e74c3c',
                        padding: '10px',
                        borderRadius: '4px',
                        marginBottom: '15px',
                        fontSize: '14px'
                    }}>
                        {pollError}
                    </div>
                )}
                
                {/* Poll Title */}
                <input
                    type="text"
                    value={pollTitle}
                    onChange={(e) => setPollTitle(e.target.value)}
                    placeholder="Poll title (e.g., 'What should we prioritize next?')"
                    style={{
                        width: '100%',
                        backgroundColor: '#2a2a2a',
                        color: '#ffffff',
                        border: `1px solid ${textLimits && textLimits.post_title_max_length && pollTitle.length > textLimits.post_title_max_length ? '#e74c3c' : '#444'}`,
                        borderRadius: '4px',
                        padding: '10px',
                        marginBottom: '5px',
                        fontSize: '14px',
                        boxSizing: 'border-box'
                    }}
                    disabled={submittingPoll}
                />
                {textLimits && (
                    <div style={{
                        fontSize: '12px',
                        color: textLimits && textLimits.post_title_max_length && pollTitle.length > textLimits.post_title_max_length ? '#e74c3c' : '#888',
                        marginBottom: '10px',
                        textAlign: 'right'
                    }}>
                        Poll title: {pollTitle.length}/{textLimits.post_title_max_length || 0} characters
                    </div>
                )}

                {/* Poll Body */}
                <textarea
                    value={pollBody}
                    onChange={(e) => setPollBody(e.target.value)}
                    placeholder="Poll description (explain what this poll is about)"
                    style={{
                        width: '100%',
                        backgroundColor: '#2a2a2a',
                        color: '#ffffff',
                        border: `1px solid ${textLimits && textLimits.post_body_max_length && pollBody.length > textLimits.post_body_max_length ? '#e74c3c' : '#444'}`,
                        borderRadius: '4px',
                        padding: '10px',
                        fontSize: '14px',
                        minHeight: '80px',
                        resize: 'vertical',
                        marginBottom: '5px',
                        boxSizing: 'border-box'
                    }}
                    disabled={submittingPoll}
                />
                {textLimits && (
                    <div style={{
                        fontSize: '12px',
                        color: textLimits && textLimits.post_body_max_length && pollBody.length > textLimits.post_body_max_length ? '#e74c3c' : '#888',
                        marginBottom: '15px',
                        textAlign: 'right'
                    }}>
                        Poll body: {pollBody.length}/{textLimits.post_body_max_length || 0} characters
                    </div>
                )}

                {/* Poll Options */}
                <div style={{ marginBottom: '15px' }}>
                    <h5 style={{ color: '#ffffff', marginBottom: '10px', fontSize: '14px' }}>Poll Options</h5>
                    {pollOptions.map((option, index) => (
                        <div key={index} style={{ 
                            display: 'flex', 
                            gap: '10px', 
                            marginBottom: '10px',
                            alignItems: 'flex-start'
                        }}>
                            <div style={{ flex: 1 }}>
                                <input
                                    type="text"
                                    value={option.title}
                                    onChange={(e) => updatePollOption(index, 'title', e.target.value)}
                                    placeholder={`Option ${index + 1} (e.g., 'Feature A', 'Yes', 'No')`}
                                    style={{
                                        width: '100%',
                                        backgroundColor: '#2a2a2a',
                                        color: '#ffffff',
                                        border: '1px solid #444',
                                        borderRadius: '4px',
                                        padding: '8px',
                                        fontSize: '14px',
                                        marginBottom: '5px',
                                        boxSizing: 'border-box'
                                    }}
                                    disabled={submittingPoll}
                                />
                                <textarea
                                    value={option.body}
                                    onChange={(e) => updatePollOption(index, 'body', e.target.value)}
                                    placeholder="Optional description for this option"
                                    style={{
                                        width: '100%',
                                        backgroundColor: '#2a2a2a',
                                        color: '#ffffff',
                                        border: '1px solid #444',
                                        borderRadius: '4px',
                                        padding: '8px',
                                        fontSize: '12px',
                                        minHeight: '40px',
                                        resize: 'vertical',
                                        boxSizing: 'border-box'
                                    }}
                                    disabled={submittingPoll}
                                />
                            </div>
                            {pollOptions.length > 2 && (
                                <button
                                    onClick={() => removePollOption(index)}
                                    disabled={submittingPoll}
                                    style={{
                                        backgroundColor: '#e74c3c',
                                        color: '#ffffff',
                                        border: 'none',
                                        borderRadius: '4px',
                                        padding: '8px',
                                        cursor: 'pointer',
                                        fontSize: '12px',
                                        marginTop: '5px'
                                    }}
                                    title="Remove this option"
                                >
                                    ✕
                                </button>
                            )}
                        </div>
                    ))}
                    {pollOptions.length < 10 && (
                        <button
                            onClick={addPollOption}
                            disabled={submittingPoll}
                            style={{
                                backgroundColor: '#3498db',
                                color: '#ffffff',
                                border: 'none',
                                borderRadius: '4px',
                                padding: '6px 12px',
                                cursor: 'pointer',
                                fontSize: '12px'
                            }}
                        >
                            + Add Option
                        </button>
                    )}
                </div>

                {/* Poll Settings */}
                <div style={{ 
                    display: 'grid', 
                    gridTemplateColumns: '1fr 1fr 1fr', 
                    gap: '15px',
                    marginBottom: '15px'
                }}>
                    <div>
                        <label style={{ 
                            color: '#ccc', 
                            fontSize: '12px', 
                            display: 'block', 
                            marginBottom: '5px' 
                        }}>
                            End Date
                        </label>
                        <input
                            type="date"
                            value={pollEndDate}
                            onChange={(e) => setPollEndDate(e.target.value)}
                            min={new Date().toISOString().split('T')[0]}
                            style={{
                                width: '100%',
                                backgroundColor: '#2a2a2a',
                                color: '#ffffff',
                                border: '1px solid #444',
                                borderRadius: '4px',
                                padding: '8px',
                                fontSize: '14px',
                                boxSizing: 'border-box'
                            }}
                            disabled={submittingPoll}
                        />
                    </div>
                    <div>
                        <label style={{ 
                            color: '#ccc', 
                            fontSize: '12px', 
                            display: 'block', 
                            marginBottom: '5px' 
                        }}>
                            End Time
                        </label>
                        <input
                            type="time"
                            value={pollEndTime}
                            onChange={(e) => setPollEndTime(e.target.value)}
                            style={{
                                width: '100%',
                                backgroundColor: '#2a2a2a',
                                color: '#ffffff',
                                border: '1px solid #444',
                                borderRadius: '4px',
                                padding: '8px',
                                fontSize: '14px',
                                boxSizing: 'border-box'
                            }}
                            disabled={submittingPoll}
                        />
                    </div>
                    <div>
                        <label style={{ 
                            color: '#ccc', 
                            fontSize: '12px', 
                            display: 'block', 
                            marginBottom: '5px' 
                        }}>
                            VP Power
                        </label>
                        <select
                            value={pollVpPower}
                            onChange={(e) => setPollVpPower(parseFloat(e.target.value))}
                            style={{
                                width: '100%',
                                backgroundColor: '#2a2a2a',
                                color: '#ffffff',
                                border: '1px solid #444',
                                borderRadius: '4px',
                                padding: '8px',
                                fontSize: '14px',
                                boxSizing: 'border-box'
                            }}
                            disabled={submittingPoll}
                        >
                            <option value={0}>Equal (0 - each vote = 1)</option>
                            <option value={0.5}>Square Root (0.5)</option>
                            <option value={1}>Linear (1 - default)</option>
                            <option value={2}>Quadratic (2)</option>
                        </select>
                    </div>
                </div>

                <div style={{ display: 'flex', gap: '10px', marginTop: '15px' }}>
                    <button
                        onClick={handleCreatePoll}
                        disabled={submittingPoll}
                        style={{
                            backgroundColor: submittingPoll ? '#666' : '#2ecc71',
                            color: '#ffffff',
                            border: 'none',
                            borderRadius: '4px',
                            padding: '8px 16px',
                            cursor: submittingPoll ? 'not-allowed' : 'pointer',
                            fontSize: '14px',
                            fontWeight: '500'
                        }}
                    >
                        {submittingPoll ? 'Creating Poll...' : 'Create Poll'}
                    </button>
                    <button
                        onClick={clearPollForm}
                        disabled={submittingPoll}
                        style={{
                            backgroundColor: 'transparent',
                            color: '#888',
                            border: '1px solid #555',
                            borderRadius: '4px',
                            padding: '8px 16px',
                            cursor: submittingPoll ? 'not-allowed' : 'pointer',
                            fontSize: '14px'
                        }}
                    >
                        Clear
                    </button>
                </div>
            </div>
        );
    }

    // Show existing poll
    if (!poll) return null;

    return (
        <div style={{ 
            backgroundColor: '#2a2a2a', 
            borderRadius: '6px', 
            padding: '20px', 
            border: '1px solid #444',
            marginTop: '15px'
        }}>
            <div style={{ marginBottom: '15px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
                    <h4 style={{ color: '#ffffff', fontSize: '16px', margin: 0 }}>
                        📊 {poll.title}
                    </h4>
                    {poll.has_ended && (
                        <span style={{
                            backgroundColor: '#e74c3c',
                            color: '#ffffff',
                            padding: '2px 8px',
                            borderRadius: '12px',
                            fontSize: '12px',
                            fontWeight: '500'
                        }}>
                            ENDED
                        </span>
                    )}
                </div>
                <p style={{ color: '#ccc', fontSize: '14px', margin: '0 0 10px 0', lineHeight: '1.4' }}>
                    {poll.body}
                </p>
                <div style={{ fontSize: '12px', color: '#888' }}>
                    Ends: {formatDate(poll.end_timestamp)} • VP Power: {poll.vp_power}x
                </div>
            </div>

            <div style={{ marginBottom: '15px' }}>
                {poll.options && poll.options.map((option, index) => {
                    const percentage = getOptionVotePercentage(option);
                    const userVoteCount = getUserVoteForOption(option.id);
                    const votingState = votingStates.get(option.id);
                    
                    return (
                        <div key={option.id} style={{ marginBottom: '12px' }}>
                            <div style={{ 
                                display: 'flex', 
                                justifyContent: 'space-between', 
                                alignItems: 'center',
                                marginBottom: '5px'
                            }}>
                                <div style={{ flex: 1 }}>
                                    <strong style={{ color: '#ffffff', fontSize: '14px' }}>
                                        {option.title}
                                    </strong>
                                    {option.body && Array.isArray(option.body) && option.body.length > 0 && (
                                        <p style={{ 
                                            color: '#ccc', 
                                            fontSize: '12px', 
                                            margin: '2px 0 0 0',
                                            lineHeight: '1.3'
                                        }}>
                                            {option.body[0]}
                                        </p>
                                    )}
                                </div>
                                <div style={{ 
                                    display: 'flex', 
                                    alignItems: 'center', 
                                    gap: '10px',
                                    marginLeft: '15px'
                                }}>
                                    <span style={{ color: '#888', fontSize: '12px', minWidth: '60px', textAlign: 'right' }}>
                                        {option.vote_count} votes
                                        <br />
                                        {formatVotingPowerDisplay(Number(option.total_voting_power))} VP
                                    </span>
                                    {userVoteCount > 0 && (
                                        <span style={{
                                            backgroundColor: '#3498db',
                                            color: '#ffffff',
                                            padding: '2px 6px',
                                            borderRadius: '10px',
                                            fontSize: '10px',
                                            fontWeight: '500'
                                        }}>
                                            ✓ {userVoteCount}
                                        </span>
                                    )}
                                    {!poll.has_ended && identity && (
                                        <button
                                            onClick={() => handleVoteOnOption(option.id)}
                                            disabled={votingState === 'voting' || !selectedNeurons || selectedNeurons.length === 0}
                                            style={{
                                                backgroundColor: 
                                                    votingState === 'voting' ? '#666' :
                                                    votingState === 'success' ? '#27ae60' :
                                                    votingState === 'error' ? '#e74c3c' :
                                                    userVoteCount > 0 ? '#3498db' : '#2980b9',
                                                color: '#ffffff',
                                                border: 'none',
                                                borderRadius: '4px',
                                                padding: '4px 8px',
                                                cursor: (votingState === 'voting' || !selectedNeurons || selectedNeurons.length === 0) ? 'not-allowed' : 'pointer',
                                                fontSize: '12px',
                                                fontWeight: '500',
                                                minWidth: '50px'
                                            }}
                                            title={!selectedNeurons || selectedNeurons.length === 0 ? 'Select neurons to vote' : ''}
                                        >
                                            {votingState === 'voting' ? '...' :
                                             votingState === 'success' ? '✓' :
                                             votingState === 'error' ? '✗' :
                                             'Vote'}
                                        </button>
                                    )}
                                </div>
                            </div>
                            
                            {/* Progress bar */}
                            <div style={{
                                width: '100%',
                                height: '6px',
                                backgroundColor: '#1a1a1a',
                                borderRadius: '3px',
                                overflow: 'hidden'
                            }}>
                                <div style={{
                                    width: `${percentage}%`,
                                    height: '100%',
                                    backgroundColor: userVoteCount > 0 ? '#3498db' : '#555',
                                    transition: 'width 0.3s ease'
                                }} />
                            </div>
                            <div style={{ 
                                fontSize: '11px', 
                                color: '#888', 
                                marginTop: '2px',
                                textAlign: 'right'
                            }}>
                                {percentage.toFixed(1)}%
                            </div>
                        </div>
                    );
                })}
            </div>

            {selectedNeurons && selectedNeurons.length > 0 && !poll.has_ended && (
                <div style={{
                    fontSize: '12px',
                    color: '#888',
                    padding: '10px',
                    backgroundColor: '#1a1a1a',
                    borderRadius: '4px',
                    border: '1px solid #333'
                }}>
                    💡 Voting with {selectedNeurons ? selectedNeurons.length : 0} neuron{selectedNeurons && selectedNeurons.length !== 1 ? 's' : ''} 
                    ({formatVotingPowerDisplay(Number(totalVotingPower || 0))} total VP)
                </div>
            )}
        </div>
    );
};

export default Poll;
