import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../AuthContext';
import { useTheme } from '../contexts/ThemeContext';

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
    const { theme } = useTheme();
    
    // Voting state
    const [votingStates, setVotingStates] = useState(new Map()); // optionId -> 'voting'|'success'|'error'
    const [userVotes, setUserVotes] = useState(new Map()); // neuronId -> optionId
    const [isVoting, setIsVoting] = useState(false); // Track if any vote is in progress
    
    // Create poll state
    const [pollTitle, setPollTitle] = useState('');
    const [pollBody, setPollBody] = useState('');
    const [pollOptions, setPollOptions] = useState([{ title: '', body: '' }, { title: '', body: '' }]);
    const [pollVpPower, setPollVpPower] = useState(1.0);
    
    // Set default poll expiration to exactly 5 days from now
    const getDefaultEndDateTime = () => {
        const now = new Date();
        const fiveDaysFromNow = new Date(now.getTime() + (5 * 24 * 60 * 60 * 1000)); // Add 5 days in milliseconds
        
        const dateStr = fiveDaysFromNow.toISOString().split('T')[0]; // YYYY-MM-DD format
        const timeStr = fiveDaysFromNow.toTimeString().slice(0, 5); // HH:MM format
        
        return { dateStr, timeStr };
    };
    
    const defaultDateTime = getDefaultEndDateTime();
    const [pollEndDate, setPollEndDate] = useState(defaultDateTime.dateStr);
    const [pollEndTime, setPollEndTime] = useState(defaultDateTime.timeStr);
    const [allowVoteChanges, setAllowVoteChanges] = useState(true);
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
        const defaultDateTime = getDefaultEndDateTime();
        setPollTitle('');
        setPollBody('');
        setPollOptions([{ title: '', body: '' }, { title: '', body: '' }]);
        setPollVpPower(1.0);
        setPollEndDate(defaultDateTime.dateStr);
        setPollEndTime(defaultDateTime.timeStr);
        setAllowVoteChanges(true);
        setPollError(null);
    };

    // Get forum actor
    const forumActor = useMemo(() => {
        return identity ? createActor(canisterId, {
            agentOptions: {
                host: process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging' ? 'https://icp0.io' : 'http://localhost:4943',
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

        // Check if user has already voted and vote changes are not allowed
        const hasExistingVote = Array.from(userVotes.values()).length > 0;
        if (hasExistingVote && !poll.allow_vote_changes) {
            alert('Vote changes are not allowed for this poll. You have already cast your vote.');
            return;
        }

        setVotingStates(prev => new Map(prev.set(optionId, 'voting')));
        setIsVoting(true);

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
                
                // Refresh poll data and wait for it to complete
                if (onPollUpdate) {
                    await onPollUpdate();
                }
                
                // Clear voting state after delay
                setTimeout(() => {
                    setVotingStates(prev => {
                        const newState = new Map(prev);
                        newState.delete(optionId);
                        return newState;
                    });
                    setIsVoting(false);
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
                    setIsVoting(false);
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
                setIsVoting(false);
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
                end_timestamp: endTimestamp,
                allow_vote_changes: allowVoteChanges === true ? [] : [allowVoteChanges] // Default to true if not specified
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
        // Handle undefined/null timestamps
        if (!timestamp && timestamp !== 0) {
            return 'Unknown';
        }
        
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

    // Get the winning option(s) - could be multiple in case of ties
    const getWinningOptionIds = () => {
        if (!poll || !poll.options || !Array.isArray(poll.options)) return new Set();
        
        const maxVotingPower = Math.max(...poll.options.map(opt => Number(opt.total_voting_power || 0)));
        const winningOptions = poll.options
            .filter(opt => Number(opt.total_voting_power || 0) === maxVotingPower)
            .map(opt => opt.id);
        
        return new Set(winningOptions);
    };

    // Show create form


    if (showCreateForm) {
        return (
            <div style={{ 
                backgroundColor: theme.colors.secondaryBg, 
                borderRadius: '6px', 
                padding: '20px', 
                border: `1px solid ${theme.colors.border}`,
                marginTop: '15px'
            }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
                    <h4 style={{ color: theme.colors.primaryText, fontSize: '16px', margin: 0 }}>
                        📊 Create Poll {postId ? 'for Post' : 'for Thread'}
                    </h4>
                    {onCancelCreate && (
                        <button
                            onClick={onCancelCreate}
                            disabled={submittingPoll}
                            style={{
                                backgroundColor: 'transparent',
                                color: theme.colors.mutedText,
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
                        border: `1px solid ${theme.colors.error}`,
                        color: theme.colors.error,
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
                        backgroundColor: theme.colors.secondaryBg,
                        color: theme.colors.primaryText,
                        border: `1px solid ${textLimits && textLimits.post_title_max_length && pollTitle.length > textLimits.post_title_max_length ? theme.colors.error : theme.colors.border}`,
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
                        color: textLimits && textLimits.post_title_max_length && pollTitle.length > textLimits.post_title_max_length ? theme.colors.error : theme.colors.mutedText,
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
                        backgroundColor: theme.colors.secondaryBg,
                        color: theme.colors.primaryText,
                        border: `1px solid ${textLimits && textLimits.post_body_max_length && pollBody.length > textLimits.post_body_max_length ? theme.colors.error : theme.colors.border}`,
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
                        color: textLimits && textLimits.post_body_max_length && pollBody.length > textLimits.post_body_max_length ? theme.colors.error : theme.colors.mutedText,
                        marginBottom: '15px',
                        textAlign: 'right'
                    }}>
                        Poll body: {pollBody.length}/{textLimits.post_body_max_length || 0} characters
                    </div>
                )}

                {/* Poll Options */}
                <div style={{ marginBottom: '15px' }}>
                    <h5 style={{ color: theme.colors.primaryText, marginBottom: '10px', fontSize: '14px' }}>Poll Options</h5>
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
                                        backgroundColor: theme.colors.secondaryBg,
                                        color: theme.colors.primaryText,
                                        border: `1px solid ${theme.colors.border}`,
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
                                        backgroundColor: theme.colors.secondaryBg,
                                        color: theme.colors.primaryText,
                                        border: `1px solid ${theme.colors.border}`,
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
                                        backgroundColor: theme.colors.error,
                                        color: theme.colors.primaryText,
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
                                backgroundColor: theme.colors.accent,
                                color: theme.colors.primaryText,
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
                            color: theme.colors.secondaryText, 
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
                                backgroundColor: theme.colors.secondaryBg,
                                color: theme.colors.primaryText,
                                border: `1px solid ${theme.colors.border}`,
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
                            color: theme.colors.secondaryText, 
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
                                backgroundColor: theme.colors.secondaryBg,
                                color: theme.colors.primaryText,
                                border: `1px solid ${theme.colors.border}`,
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
                            color: theme.colors.secondaryText, 
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
                                backgroundColor: theme.colors.secondaryBg,
                                color: theme.colors.primaryText,
                                border: `1px solid ${theme.colors.border}`,
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

                    {/* Allow Vote Changes */}
                    <div style={{ marginBottom: '15px' }}>
                        <label style={{ 
                            color: theme.colors.secondaryText, 
                            fontSize: '14px', 
                            display: 'flex', 
                            alignItems: 'center',
                            gap: '8px',
                            cursor: 'pointer'
                        }}>
                            <input
                                type="checkbox"
                                checked={allowVoteChanges}
                                onChange={(e) => setAllowVoteChanges(e.target.checked)}
                                disabled={submittingPoll}
                                style={{
                                    transform: 'scale(1.2)'
                                }}
                            />
                            Allow voters to change their votes
                        </label>
                        <div style={{ 
                            fontSize: '12px', 
                            color: theme.colors.mutedText, 
                            marginTop: '5px',
                            marginLeft: '28px'
                        }}>
                            If unchecked, voters can only vote once and cannot change their choice
                        </div>
                    </div>
                </div>

                <div style={{ display: 'flex', gap: '10px', marginTop: '15px' }}>
                    <button
                        onClick={handleCreatePoll}
                        disabled={submittingPoll}
                        style={{
                            backgroundColor: submittingPoll ? theme.colors.mutedText : theme.colors.success,
                            color: theme.colors.primaryText,
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
                            color: theme.colors.mutedText,
                            border: `1px solid ${theme.colors.border}`,
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

    // Debug: Log poll structure (can be removed later)
    console.log('🗳️ Poll component received poll data:', {
        title: poll.title,
        body: poll.body,
        optionsCount: poll.options ? poll.options.length : 0,
        hasEnded: poll.has_ended,
        vpPower: poll.vp_power,
        endTimestamp: poll.end_timestamp
    });

    return (
        <div style={{ 
            backgroundColor: theme.colors.secondaryBg, 
            borderRadius: '6px', 
            padding: '20px', 
            border: `1px solid ${theme.colors.border}`,
            marginTop: '15px'
        }}>
            <div style={{ marginBottom: '15px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
                    <h4 style={{ color: theme.colors.primaryText, fontSize: '16px', margin: 0 }}>
                        📊 {poll.title || 'Untitled Poll'}
                    </h4>
                    {poll.has_ended && (
                        <span style={{
                            backgroundColor: theme.colors.error,
                            color: theme.colors.primaryText,
                            padding: '2px 8px',
                            borderRadius: '12px',
                            fontSize: '12px',
                            fontWeight: '500'
                        }}>
                            ENDED
                        </span>
                    )}
                </div>
                {poll.body && (
                    <p style={{ color: theme.colors.secondaryText, fontSize: '14px', margin: '0 0 10px 0', lineHeight: '1.4' }}>
                        {poll.body}
                    </p>
                )}
                <div style={{ fontSize: '12px', color: theme.colors.mutedText }}>
                    Ends: {formatDate(poll.end_timestamp)} • VP Power: {poll.vp_power || 1}x
                    {!poll.allow_vote_changes && (
                        <>
                            {' • '}
                            <span style={{ color: theme.colors.warning, fontWeight: '500' }}>
                                ⚠️ Vote changes not allowed
                            </span>
                        </>
                    )}
                </div>
            </div>

            <div style={{ marginBottom: '15px' }}>
                {poll.options && poll.options.length > 0 ? poll.options.map((option, index) => {
                    const percentage = getOptionVotePercentage(option);
                    const userVoteCount = getUserVoteForOption(option.id);
                    const votingState = votingStates.get(option.id);
                    const winningOptionIds = getWinningOptionIds();
                    const isWinning = winningOptionIds.has(option.id);
                    
                    return (
                        <div key={option.id} style={{ marginBottom: '12px' }}>
                            <div style={{ 
                                display: 'flex', 
                                justifyContent: 'space-between', 
                                alignItems: 'center',
                                marginBottom: '5px'
                            }}>
                                <div style={{ flex: 1 }}>
                                    <strong style={{ color: theme.colors.primaryText, fontSize: '14px' }}>
                                        {option.title}
                                    </strong>
                                    {option.body && Array.isArray(option.body) && option.body.length > 0 && (
                                        <p style={{ 
                                            color: theme.colors.secondaryText, 
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
                                    <span style={{ color: theme.colors.mutedText, fontSize: '12px', minWidth: '60px', textAlign: 'right' }}>
                                        {option.vote_count} votes
                                        <br />
                                        {formatVotingPowerDisplay(Number(option.total_voting_power))} VP
                                    </span>
                                    {userVoteCount > 0 && (
                                        <span style={{
                                            backgroundColor: theme.colors.accent,
                                            color: theme.colors.primaryText,
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
                                            disabled={isVoting || !selectedNeurons || selectedNeurons.length === 0}
                                            style={{
                                                                                backgroundColor: 
                                    votingState === 'voting' ? theme.colors.mutedText :
                                    votingState === 'success' ? theme.colors.success :
                                    votingState === 'error' ? theme.colors.error :
                                    isVoting ? theme.colors.mutedText :
                                    userVoteCount > 0 ? theme.colors.accent : theme.colors.accentHover,
                                                color: theme.colors.primaryText,
                                                border: 'none',
                                                borderRadius: '4px',
                                                padding: '4px 8px',
                                                cursor: (isVoting || !selectedNeurons || selectedNeurons.length === 0) ? 'not-allowed' : 'pointer',
                                                fontSize: '12px',
                                                fontWeight: '500',
                                                minWidth: '50px'
                                            }}
                                            title={!selectedNeurons || selectedNeurons.length === 0 ? 'Select neurons to vote' : isVoting ? 'Vote in progress...' : ''}
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
                                backgroundColor: theme.colors.primaryBg,
                                borderRadius: '3px',
                                overflow: 'hidden'
                            }}>
                                <div style={{
                                    width: `${percentage}%`,
                                    height: '100%',
                                    backgroundColor: 
                                        poll.has_ended && isWinning ? theme.colors.success : // Green for winning option when poll ended
                                        userVoteCount > 0 ? theme.colors.accent : theme.colors.mutedText,    // Blue for user voted, gray for others
                                    transition: 'width 0.3s ease, background-color 0.3s ease'
                                }} />
                            </div>
                            <div style={{ 
                                fontSize: '11px', 
                                color: theme.colors.mutedText, 
                                marginTop: '2px',
                                textAlign: 'right'
                            }}>
                                {percentage.toFixed(1)}%
                            </div>
                        </div>
                    );
                }) : (
                    <div style={{
                        padding: '20px',
                        textAlign: 'center',
                        color: theme.colors.mutedText,
                        fontStyle: 'italic'
                    }}>
                        No poll options available
                    </div>
                )}
            </div>

            {selectedNeurons && selectedNeurons.length > 0 && !poll.has_ended && (
                <div style={{
                    fontSize: '12px',
                    color: theme.colors.mutedText,
                    padding: '10px',
                    backgroundColor: theme.colors.primaryBg,
                    borderRadius: '4px',
                    border: `1px solid ${theme.colors.border}`
                }}>
                    💡 Voting with {selectedNeurons ? selectedNeurons.length : 0} neuron{selectedNeurons && selectedNeurons.length !== 1 ? 's' : ''} 
                    ({formatVotingPowerDisplay(Number(totalVotingPower || 0))} total VP)
                </div>
            )}
        </div>
    );
};

export default Poll;
