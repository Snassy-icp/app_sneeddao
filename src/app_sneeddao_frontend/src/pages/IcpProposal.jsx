import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { useNaming } from '../NamingContext';
import Header from '../components/Header';
import IcpHotkeyNeurons from '../components/IcpHotkeyNeurons';
import ReactMarkdown from 'react-markdown';
import { getRelativeTime, getFullDate } from '../utils/DateUtils';
import { FaGavel, FaArrowLeft, FaExternalLinkAlt, FaCheck, FaTimes, FaClock, FaChevronDown, FaChevronRight, FaFilter, FaSort, FaSync, FaCopy } from 'react-icons/fa';
import {
    createNnsGovActor, getNnsTopicName, getNnsProposalStatusText,
    getNnsProposalStatus, isNnsProposalAcceptingVotes,
    getNnsVotingTimeRemaining, getNnsVotingDeadline,
    getNnsActionTypeName, getNnsBallotForNeuron, formatNnsVote,
    formatIcpE8s, fetchKnownNeurons, NNS_GOVERNANCE_CANISTER_ID,
    KNOWN_NEURONS_FALLBACK, NNS_REWARD_STATUS
} from '../utils/NnsUtils';

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

@keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.7; }
}

@keyframes slideIn {
    from {
        opacity: 0;
        transform: translateX(-10px);
    }
    to {
        opacity: 1;
        transform: translateX(0);
    }
}

.proposal-animate {
    animation: fadeInUp 0.4s ease-out forwards;
}

.proposal-pulse {
    animation: pulse 2s ease-in-out infinite;
}

.proposal-slide {
    animation: slideIn 0.3s ease-out forwards;
}
`;

// Accent colors - matching Forum/Topic pages
const proposalPrimary = '#6366f1'; // Indigo
const proposalSecondary = '#8b5cf6'; // Purple
const proposalAccent = '#06b6d4'; // Cyan

// System font stack
const SYSTEM_FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

function IcpProposal() {
    const { theme } = useTheme();
    const { isAuthenticated, identity } = useAuth();
    const [searchParams, setSearchParams] = useSearchParams();
    const navigate = useNavigate();
    const { neuronNames, neuronNicknames, verifiedNames } = useNaming();

    const proposalId = searchParams.get('proposalid') || '';

    const [proposalData, setProposalData] = useState(null);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [knownNeurons, setKnownNeurons] = useState({});
    const [copiedText, setCopiedText] = useState(null);

    // Voting history state
    const [isVotingHistoryExpanded, setIsVotingHistoryExpanded] = useState(false);
    const [hideAdopt, setHideAdopt] = useState(false);
    const [hideReject, setHideReject] = useState(false);
    const [hideNotVoted, setHideNotVoted] = useState(false);
    const [sortBy, setSortBy] = useState('power');

    // Section expand/collapse
    const [isProposalExpanded, setIsProposalExpanded] = useState(true);
    const [isSummaryExpanded, setIsSummaryExpanded] = useState(true);
    const [isActionExpanded, setIsActionExpanded] = useState(false);
    const [isPayloadExpanded, setIsPayloadExpanded] = useState(false);

    // Refresh timer
    const refreshTimerRef = useRef(null);

    // ========================================================================
    // Data Fetching
    // ========================================================================

    const fetchProposal = useCallback(async (silent = false) => {
        if (!proposalId) return;
        if (!silent) setLoading(true);
        setError('');

        try {
            const nnsGovActor = createNnsGovActor(identity);
            const result = await nnsGovActor.get_proposal_info(BigInt(proposalId));

            if (result && result.length > 0 && result[0]) {
                setProposalData(result[0]);
            } else {
                setError('Proposal not found');
                setProposalData(null);
            }
        } catch (err) {
            console.error('Error fetching NNS proposal:', err);
            setError('Failed to fetch proposal data: ' + (err.message || 'Unknown error'));
            if (!silent) setProposalData(null);
        } finally {
            if (!silent) setLoading(false);
        }
    }, [proposalId, identity]);

    const refreshProposal = useCallback(() => {
        fetchProposal(true);
    }, [fetchProposal]);

    // Fetch known neurons
    useEffect(() => {
        const loadKnownNeurons = async () => {
            try {
                const neurons = await fetchKnownNeurons(identity);
                setKnownNeurons(neurons || {});
            } catch (err) {
                console.warn('Failed to fetch known neurons, using fallback:', err);
                setKnownNeurons({ ...KNOWN_NEURONS_FALLBACK });
            }
        };
        loadKnownNeurons();
    }, [identity]);

    // Fetch proposal on mount or when proposalId changes
    useEffect(() => {
        if (proposalId) {
            fetchProposal();
        } else {
            setProposalData(null);
        }
    }, [proposalId, fetchProposal]);

    // Auto-refresh if proposal is open for voting
    useEffect(() => {
        if (proposalData && isNnsProposalAcceptingVotes(proposalData)) {
            refreshTimerRef.current = setInterval(() => {
                refreshProposal();
            }, 30000); // 30s
        }
        return () => {
            if (refreshTimerRef.current) {
                clearInterval(refreshTimerRef.current);
                refreshTimerRef.current = null;
            }
        };
    }, [proposalData, refreshProposal]);

    // ========================================================================
    // Helpers
    // ========================================================================

    const getKnownNeuronName = useCallback((neuronId) => {
        if (!neuronId) return null;
        const idStr = neuronId.toString();
        return knownNeurons[idStr] || null;
    }, [knownNeurons]);

    const formatNeuronIdDisplay = useCallback((neuronId) => {
        if (!neuronId && neuronId !== 0n && neuronId !== 0) return 'Unknown';
        const idStr = neuronId.toString();
        const knownName = getKnownNeuronName(neuronId);
        if (knownName) return knownName;
        if (idStr.length > 16) {
            return idStr.substring(0, 8) + '...' + idStr.substring(idStr.length - 8);
        }
        return idStr;
    }, [getKnownNeuronName]);

    const formatE8s = (e8s) => {
        if (e8s === undefined || e8s === null) return '0';
        return (Number(e8s) / 100_000_000).toFixed(4);
    };

    const formatCompactVP = (vp) => {
        if (!vp || vp === 0) return '0';
        const displayValue = Number(vp) / 100_000_000;
        if (displayValue >= 1_000_000) {
            return (displayValue / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
        } else if (displayValue >= 1_000) {
            return (displayValue / 1_000).toFixed(1).replace(/\.0$/, '') + 'K';
        }
        return displayValue.toFixed(displayValue < 10 ? 2 : 0).replace(/\.0$/, '');
    };

    const convertHtmlToMarkdown = (text) => {
        if (!text) return '';
        return text.replace(/<br>/g, '\n\n');
    };

    const copyToClipboard = useCallback((text) => {
        navigator.clipboard.writeText(text).then(() => {
            setCopiedText(text);
            setTimeout(() => setCopiedText(null), 2000);
        }).catch(() => {});
    }, []);

    // ========================================================================
    // Status helpers
    // ========================================================================

    const getStatusColor = (statusText) => {
        if (!statusText) return theme.colors.mutedText;
        if (statusText.includes('Executed') || statusText.includes('Adopted')) return theme.colors.success;
        if (statusText.includes('Rejected') || statusText.includes('Failed')) return theme.colors.error;
        if (statusText.includes('Open')) return proposalPrimary;
        return theme.colors.mutedText;
    };

    const getStatusIcon = (statusText) => {
        if (!statusText) return <FaClock />;
        if (statusText.includes('Executed') || statusText.includes('Adopted')) return <FaCheck />;
        if (statusText.includes('Rejected') || statusText.includes('Failed')) return <FaTimes />;
        if (statusText.includes('Open')) return <FaClock />;
        return <FaClock />;
    };

    // ========================================================================
    // Voting Bar
    // ========================================================================

    const calculateVotingPercentages = (tally) => {
        if (!tally) return { yesPercent: 0, noPercent: 0 };
        const total = Number(tally.total);
        if (total === 0) return { yesPercent: 0, noPercent: 0 };

        const yesPercent = (Number(tally.yes) / total) * 100;
        const noPercent = (Number(tally.no) / total) * 100;
        return { yesPercent, noPercent };
    };

    const VotingBar = ({ proposalData: pd }) => {
        if (!pd?.latest_tally?.[0]) return null;

        const tally = pd.latest_tally[0];
        const { yesPercent, noPercent } = useMemo(() => calculateVotingPercentages(tally), [tally]);

        return (
            <div style={{ marginTop: '1.5rem' }}>
                {/* Vote Summary */}
                <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '1rem'
                }}>
                    <div>
                        <div style={{
                            color: theme.colors.success,
                            fontSize: '1.5rem',
                            fontWeight: '700'
                        }}>
                            {yesPercent.toFixed(2)}%
                        </div>
                        <div style={{
                            color: theme.colors.success,
                            fontSize: '0.85rem',
                            opacity: 0.8
                        }}>
                            Adopt: {formatE8s(tally.yes)} ICP
                        </div>
                    </div>
                    <div style={{
                        textAlign: 'center',
                        color: theme.colors.mutedText,
                        fontSize: '0.8rem'
                    }}>
                        <div>Total: {formatE8s(tally.total)} ICP</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                        <div style={{
                            color: theme.colors.error,
                            fontSize: '1.5rem',
                            fontWeight: '700'
                        }}>
                            {noPercent.toFixed(2)}%
                        </div>
                        <div style={{
                            color: theme.colors.error,
                            fontSize: '0.85rem',
                            opacity: 0.8
                        }}>
                            Reject: {formatE8s(tally.no)} ICP
                        </div>
                    </div>
                </div>

                {/* Voting Bar */}
                <div style={{
                    position: 'relative',
                    height: '28px',
                    backgroundColor: theme.colors.border,
                    borderRadius: '14px',
                    overflow: 'visible',
                    marginBottom: '2.5rem'
                }}>
                    {/* Yes votes */}
                    <div style={{
                        position: 'absolute',
                        left: 0,
                        height: '100%',
                        width: `${yesPercent}%`,
                        background: `linear-gradient(90deg, ${theme.colors.success}, #27ae60)`,
                        borderRadius: '14px 0 0 14px',
                        transition: 'width 0.5s ease'
                    }} />

                    {/* No votes */}
                    <div style={{
                        position: 'absolute',
                        right: 0,
                        height: '100%',
                        width: `${noPercent}%`,
                        background: `linear-gradient(90deg, #c0392b, ${theme.colors.error})`,
                        borderRadius: '0 14px 14px 0',
                        transition: 'width 0.5s ease'
                    }} />

                    {/* 50% threshold marker */}
                    <div style={{
                        position: 'absolute',
                        left: '50%',
                        height: '36px',
                        width: '3px',
                        backgroundColor: proposalSecondary,
                        top: '-4px',
                        borderRadius: '2px',
                        cursor: 'help'
                    }} title="50% threshold for adoption" />

                    {/* Current position */}
                    <div style={{
                        position: 'absolute',
                        left: `${yesPercent}%`,
                        height: '36px',
                        width: '3px',
                        backgroundColor: proposalAccent,
                        top: '-4px',
                        borderRadius: '2px',
                        cursor: 'help',
                        boxShadow: `0 0 8px ${proposalAccent}`
                    }} title={`Current: ${yesPercent.toFixed(2)}% Adopt`} />
                </div>

                {/* Legend */}
                <div style={{
                    display: 'flex',
                    gap: '1.5rem',
                    flexWrap: 'wrap',
                    fontSize: '0.8rem',
                    color: theme.colors.mutedText
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <div style={{ width: '12px', height: '12px', backgroundColor: proposalAccent, borderRadius: '2px' }} />
                        <span>Current</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <div style={{ width: '12px', height: '12px', backgroundColor: proposalSecondary, borderRadius: '2px' }} />
                        <span>50% Threshold</span>
                    </div>
                </div>
            </div>
        );
    };

    // ========================================================================
    // Ballot / Vote History
    // ========================================================================

    const filterAndSortVotes = useCallback((ballots) => {
        if (!ballots || ballots.length === 0) return [];

        const filtered = ballots.filter(([_, ballot]) => {
            const vote = Number(ballot.vote);
            if (vote === 1 && hideAdopt) return false;
            if (vote === 2 && hideReject) return false;
            if (vote !== 1 && vote !== 2 && hideNotVoted) return false;
            return true;
        });

        return filtered.sort((a, b) => {
            const [, ballotA] = a;
            const [, ballotB] = b;
            if (sortBy === 'power') {
                return Number(ballotB.voting_power) - Number(ballotA.voting_power);
            } else if (sortBy === 'vote') {
                return Number(ballotB.vote) - Number(ballotA.vote);
            }
            // Default: by voting power
            return Number(ballotB.voting_power) - Number(ballotA.voting_power);
        });
    }, [hideAdopt, hideReject, hideNotVoted, sortBy]);

    const voteSummary = useMemo(() => {
        if (!proposalData?.ballots) return { adopt: 0, reject: 0, notVoted: 0, total: 0 };
        let adopt = 0, reject = 0, notVoted = 0;
        for (const [_, ballot] of proposalData.ballots) {
            const vote = Number(ballot.vote);
            if (vote === 1) adopt++;
            else if (vote === 2) reject++;
            else notVoted++;
        }
        return { adopt, reject, notVoted, total: proposalData.ballots.length };
    }, [proposalData?.ballots]);

    // ========================================================================
    // Navigation
    // ========================================================================

    const navigateToProposal = useCallback((id) => {
        setSearchParams({ proposalid: id.toString() });
    }, [setSearchParams]);

    const goToPrevious = useCallback(() => {
        const prevId = Number(proposalId) - 1;
        if (prevId >= 1) {
            navigateToProposal(prevId);
        }
    }, [proposalId, navigateToProposal]);

    const goToNext = useCallback(() => {
        const nextId = Number(proposalId) + 1;
        navigateToProposal(nextId);
    }, [proposalId, navigateToProposal]);

    // ========================================================================
    // Action Details Rendering
    // ========================================================================

    const renderActionDetails = useCallback((action) => {
        if (!action) return null;

        const actionKey = Object.keys(action)[0];
        const actionData = action[actionKey];

        if (actionKey === 'Motion') {
            const motionText = actionData?.motion_text || '';
            return (
                <div>
                    <div style={{
                        color: theme.colors.mutedText,
                        fontSize: '0.8rem',
                        marginBottom: '0.5rem',
                        fontWeight: '600'
                    }}>
                        Motion Text
                    </div>
                    <div style={{
                        color: theme.colors.primaryText,
                        fontSize: '0.9rem',
                        lineHeight: '1.6',
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word'
                    }}>
                        <ReactMarkdown
                            components={{
                                a: ({node, ...props}) => (
                                    <a {...props} style={{
                                        color: proposalPrimary,
                                        wordBreak: 'break-all'
                                    }} target="_blank" rel="noopener noreferrer" />
                                ),
                                p: ({node, ...props}) => (
                                    <p {...props} style={{ margin: '0 0 0.75rem 0' }} />
                                )
                            }}
                        >
                            {convertHtmlToMarkdown(motionText)}
                        </ReactMarkdown>
                    </div>
                </div>
            );
        }

        if (actionKey === 'ExecuteNnsFunction') {
            const nnsFunctionId = actionData?.nns_function;
            const payload = actionData?.payload;
            let payloadHex = '';
            if (payload) {
                try {
                    if (payload instanceof Uint8Array || Array.isArray(payload)) {
                        payloadHex = Array.from(payload).map(b => b.toString(16).padStart(2, '0')).join('');
                    } else {
                        payloadHex = String(payload);
                    }
                } catch {
                    payloadHex = 'Unable to decode payload';
                }
            }

            const truncatedPayload = payloadHex.length > 2000
                ? payloadHex.substring(0, 2000) + '... (truncated)'
                : payloadHex;

            return (
                <div>
                    <div style={{
                        display: 'flex',
                        gap: '1rem',
                        marginBottom: '1rem',
                        flexWrap: 'wrap'
                    }}>
                        <div style={{
                            background: theme.colors.primaryBg,
                            borderRadius: '8px',
                            padding: '0.5rem 1rem',
                            border: `1px solid ${theme.colors.border}`
                        }}>
                            <div style={{ color: theme.colors.mutedText, fontSize: '0.75rem' }}>NNS Function ID</div>
                            <div style={{ color: theme.colors.primaryText, fontSize: '0.95rem', fontWeight: '600' }}>
                                {nnsFunctionId !== undefined ? Number(nnsFunctionId).toString() : 'N/A'}
                            </div>
                        </div>
                        {payloadHex && (
                            <div style={{
                                background: theme.colors.primaryBg,
                                borderRadius: '8px',
                                padding: '0.5rem 1rem',
                                border: `1px solid ${theme.colors.border}`
                            }}>
                                <div style={{ color: theme.colors.mutedText, fontSize: '0.75rem' }}>Payload Size</div>
                                <div style={{ color: theme.colors.primaryText, fontSize: '0.95rem', fontWeight: '600' }}>
                                    {payloadHex.length / 2} bytes
                                </div>
                            </div>
                        )}
                    </div>
                    {payloadHex && (
                        <div>
                            <div style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                marginBottom: '0.5rem'
                            }}>
                                <div style={{ color: theme.colors.mutedText, fontSize: '0.8rem', fontWeight: '600' }}>
                                    Payload (hex)
                                </div>
                                <button
                                    onClick={() => copyToClipboard(payloadHex)}
                                    style={{
                                        background: 'none',
                                        border: 'none',
                                        color: copiedText === payloadHex ? theme.colors.success : theme.colors.mutedText,
                                        cursor: 'pointer',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '4px',
                                        fontSize: '0.75rem',
                                        padding: '2px 6px',
                                        borderRadius: '4px'
                                    }}
                                >
                                    <FaCopy size={10} />
                                    {copiedText === payloadHex ? 'Copied!' : 'Copy'}
                                </button>
                            </div>
                            <div style={{
                                background: theme.colors.primaryBg,
                                borderRadius: '8px',
                                padding: '0.75rem',
                                border: `1px solid ${theme.colors.border}`,
                                fontFamily: 'monospace',
                                fontSize: '0.75rem',
                                color: theme.colors.secondaryText,
                                whiteSpace: 'pre-wrap',
                                wordBreak: 'break-all',
                                maxHeight: '200px',
                                overflowY: 'auto'
                            }}>
                                {truncatedPayload || 'Empty payload'}
                            </div>
                        </div>
                    )}
                </div>
            );
        }

        if (actionKey === 'CreateServiceNervousSystem') {
            const snsName = actionData?.name?.[0] || 'N/A';
            const snsDescription = actionData?.description?.[0] || '';
            const snsUrl = actionData?.url?.[0] || '';
            const tokenName = actionData?.sns_token_e8s?.[0]
                ? actionData.sns_token_e8s[0]
                : null;
            const tokenSymbol = actionData?.token_symbol?.[0] || '';
            const tokenNameStr = actionData?.token_name?.[0] || '';

            return (
                <div>
                    <div style={{
                        color: theme.colors.mutedText,
                        fontSize: '0.8rem',
                        marginBottom: '0.75rem',
                        fontWeight: '600'
                    }}>
                        Create Service Nervous System
                    </div>
                    <div style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                        gap: '0.75rem',
                        marginBottom: '1rem'
                    }}>
                        <div style={{
                            background: theme.colors.primaryBg,
                            borderRadius: '8px',
                            padding: '0.5rem 1rem',
                            border: `1px solid ${theme.colors.border}`
                        }}>
                            <div style={{ color: theme.colors.mutedText, fontSize: '0.75rem' }}>SNS Name</div>
                            <div style={{ color: theme.colors.primaryText, fontSize: '0.9rem', fontWeight: '600' }}>{snsName}</div>
                        </div>
                        {tokenNameStr && (
                            <div style={{
                                background: theme.colors.primaryBg,
                                borderRadius: '8px',
                                padding: '0.5rem 1rem',
                                border: `1px solid ${theme.colors.border}`
                            }}>
                                <div style={{ color: theme.colors.mutedText, fontSize: '0.75rem' }}>Token Name</div>
                                <div style={{ color: theme.colors.primaryText, fontSize: '0.9rem', fontWeight: '600' }}>{tokenNameStr}</div>
                            </div>
                        )}
                        {tokenSymbol && (
                            <div style={{
                                background: theme.colors.primaryBg,
                                borderRadius: '8px',
                                padding: '0.5rem 1rem',
                                border: `1px solid ${theme.colors.border}`
                            }}>
                                <div style={{ color: theme.colors.mutedText, fontSize: '0.75rem' }}>Token Symbol</div>
                                <div style={{ color: theme.colors.primaryText, fontSize: '0.9rem', fontWeight: '600' }}>{tokenSymbol}</div>
                            </div>
                        )}
                    </div>
                    {snsDescription && (
                        <div style={{
                            color: theme.colors.secondaryText,
                            fontSize: '0.85rem',
                            lineHeight: '1.5',
                            marginBottom: '0.75rem'
                        }}>
                            {snsDescription.substring(0, 500)}{snsDescription.length > 500 ? '...' : ''}
                        </div>
                    )}
                    {snsUrl && (
                        <a
                            href={snsUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{
                                color: proposalPrimary,
                                fontSize: '0.85rem',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '4px'
                            }}
                        >
                            <FaExternalLinkAlt size={10} />
                            {snsUrl}
                        </a>
                    )}
                </div>
            );
        }

        // Default: JSON display for other action types
        try {
            const jsonStr = JSON.stringify(actionData, (key, value) => {
                if (typeof value === 'bigint') return value.toString();
                return value;
            }, 2);

            const truncatedJson = jsonStr.length > 5000
                ? jsonStr.substring(0, 5000) + '\n... (truncated)'
                : jsonStr;

            return (
                <div>
                    <div style={{
                        color: theme.colors.mutedText,
                        fontSize: '0.8rem',
                        marginBottom: '0.5rem',
                        fontWeight: '600'
                    }}>
                        {getNnsActionTypeName(action)} Data
                    </div>
                    <div style={{
                        background: theme.colors.primaryBg,
                        borderRadius: '8px',
                        padding: '0.75rem',
                        border: `1px solid ${theme.colors.border}`,
                        fontFamily: 'monospace',
                        fontSize: '0.75rem',
                        color: theme.colors.secondaryText,
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-all',
                        maxHeight: '400px',
                        overflowY: 'auto'
                    }}>
                        {truncatedJson}
                    </div>
                </div>
            );
        } catch {
            return (
                <div style={{ color: theme.colors.mutedText, fontSize: '0.85rem' }}>
                    Unable to display action data
                </div>
            );
        }
    }, [theme, copiedText, copyToClipboard]);

    // ========================================================================
    // Derived data
    // ========================================================================

    const p = proposalData;
    const proposal = p?.proposal?.[0];
    const statusText = p ? getNnsProposalStatus(p) : '';
    const statusColor = getStatusColor(statusText);
    const statusIcon = getStatusIcon(statusText);
    const topicName = p ? getNnsTopicName(p.topic) : '';
    const title = proposal?.title?.[0] || 'Untitled Proposal';
    const summary = proposal?.summary || '';
    const url = proposal?.url || '';
    const action = proposal?.action?.[0] || null;
    const actionTypeName = action ? getNnsActionTypeName(action) : '';
    const proposerNeuronId = p?.proposer?.[0]?.id;
    const proposerName = getKnownNeuronName(proposerNeuronId);
    const tally = p?.latest_tally?.[0];
    const ballots = p?.ballots || [];
    const failureReason = p?.failure_reason?.[0]?.error_message;
    const isVotingOpen = p ? isNnsProposalAcceptingVotes(p) : false;
    const votingTimeRemaining = p ? getNnsVotingTimeRemaining(p) : '';
    const totalPotentialVP = p?.total_potential_voting_power?.[0];

    const createdTimestamp = p?.proposal_timestamp_seconds
        ? Number(p.proposal_timestamp_seconds) * 1000
        : null;
    const deadlineTimestamp = p?.deadline_timestamp_seconds?.[0]
        ? Number(p.deadline_timestamp_seconds[0]) * 1000
        : null;
    const executedTimestamp = p?.executed_timestamp_seconds && Number(p.executed_timestamp_seconds) > 0
        ? Number(p.executed_timestamp_seconds) * 1000
        : null;
    const failedTimestamp = p?.failed_timestamp_seconds && Number(p.failed_timestamp_seconds) > 0
        ? Number(p.failed_timestamp_seconds) * 1000
        : null;
    const decidedTimestamp = p?.decided_timestamp_seconds && Number(p.decided_timestamp_seconds) > 0
        ? Number(p.decided_timestamp_seconds) * 1000
        : null;

    const rewardStatusText = useMemo(() => {
        if (!p) return '';
        switch (Number(p.reward_status)) {
            case NNS_REWARD_STATUS.ACCEPT_VOTES: return 'Accepting Votes';
            case NNS_REWARD_STATUS.READY_TO_SETTLE: return 'Ready to Settle';
            case NNS_REWARD_STATUS.SETTLED: return 'Settled';
            case NNS_REWARD_STATUS.INELIGIBLE: return 'Ineligible';
            default: return 'Unknown';
        }
    }, [p]);

    // ========================================================================
    // Render
    // ========================================================================

    return (
        <div className='page-container'>
            <style>{customStyles}</style>
            <Header />

            <main style={{
                background: theme.colors.primaryGradient,
                minHeight: '100vh'
            }}>
                {/* Hero Section */}
                <div style={{
                    background: `linear-gradient(135deg, ${theme.colors.primaryBg} 0%, ${proposalPrimary}15 50%, ${proposalSecondary}10 100%)`,
                    borderBottom: `1px solid ${theme.colors.border}`,
                    padding: '2rem 1.5rem',
                    position: 'relative',
                    overflow: 'hidden'
                }}>
                    <div style={{
                        position: 'absolute',
                        top: '-50%',
                        right: '-10%',
                        width: '400px',
                        height: '400px',
                        background: `radial-gradient(circle, ${proposalPrimary}20 0%, transparent 70%)`,
                        borderRadius: '50%',
                        pointerEvents: 'none'
                    }} />

                    <div style={{
                        maxWidth: '900px',
                        margin: '0 auto',
                        position: 'relative',
                        zIndex: 1
                    }}>
                        {/* Back Navigation + Title */}
                        <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '1rem',
                            marginBottom: '1.5rem'
                        }}>
                            <button
                                onClick={() => navigate('/icp_proposals')}
                                style={{
                                    width: '42px',
                                    height: '42px',
                                    borderRadius: '12px',
                                    background: `${proposalPrimary}15`,
                                    border: `1px solid ${proposalPrimary}30`,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    cursor: 'pointer',
                                    color: proposalPrimary,
                                    flexShrink: 0,
                                    transition: 'all 0.2s ease'
                                }}
                                title="Back to ICP Proposals"
                            >
                                <FaArrowLeft size={16} />
                            </button>
                            <div style={{
                                width: '48px',
                                height: '48px',
                                borderRadius: '14px',
                                background: `linear-gradient(135deg, ${proposalPrimary}, ${proposalSecondary})`,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                flexShrink: 0,
                                boxShadow: `0 4px 20px ${proposalPrimary}40`
                            }}>
                                <FaGavel size={20} style={{ color: 'white' }} />
                            </div>
                            <div>
                                <h1 style={{
                                    color: theme.colors.primaryText,
                                    fontSize: '1.75rem',
                                    fontWeight: '700',
                                    margin: 0
                                }}>
                                    NNS Proposal {proposalId ? `#${proposalId}` : ''}
                                </h1>
                                <p style={{
                                    color: theme.colors.secondaryText,
                                    fontSize: '0.95rem',
                                    margin: '0.25rem 0 0 0'
                                }}>
                                    Internet Computer Governance
                                </p>
                            </div>
                        </div>

                        {/* Navigation Controls */}
                        <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.75rem',
                            flexWrap: 'wrap'
                        }}>
                            <button
                                onClick={goToPrevious}
                                disabled={!proposalId || Number(proposalId) <= 1}
                                style={{
                                    background: (!proposalId || Number(proposalId) <= 1)
                                        ? theme.colors.mutedText
                                        : `linear-gradient(135deg, ${proposalPrimary}, ${proposalSecondary})`,
                                    color: 'white',
                                    border: 'none',
                                    borderRadius: '10px',
                                    padding: '0.6rem 1rem',
                                    cursor: (!proposalId || Number(proposalId) <= 1) ? 'not-allowed' : 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '0.5rem',
                                    fontSize: '0.9rem',
                                    fontWeight: '500',
                                    opacity: (!proposalId || Number(proposalId) <= 1) ? 0.5 : 1,
                                    transition: 'all 0.3s ease'
                                }}
                            >
                                <FaArrowLeft size={12} />
                                Previous
                            </button>

                            <button
                                onClick={refreshProposal}
                                disabled={loading || !proposalId}
                                style={{
                                    background: `${proposalPrimary}15`,
                                    color: proposalPrimary,
                                    border: `1px solid ${proposalPrimary}30`,
                                    borderRadius: '10px',
                                    padding: '0.6rem 1rem',
                                    cursor: (loading || !proposalId) ? 'not-allowed' : 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '0.5rem',
                                    fontSize: '0.9rem',
                                    fontWeight: '500',
                                    transition: 'all 0.3s ease'
                                }}
                                title="Refresh proposal data"
                            >
                                <FaSync size={12} className={loading ? 'proposal-pulse' : ''} />
                                Refresh
                            </button>

                            <button
                                onClick={goToNext}
                                disabled={!proposalId}
                                style={{
                                    background: !proposalId
                                        ? theme.colors.mutedText
                                        : `linear-gradient(135deg, ${proposalPrimary}, ${proposalSecondary})`,
                                    color: 'white',
                                    border: 'none',
                                    borderRadius: '10px',
                                    padding: '0.6rem 1rem',
                                    cursor: !proposalId ? 'not-allowed' : 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '0.5rem',
                                    fontSize: '0.9rem',
                                    fontWeight: '500',
                                    opacity: !proposalId ? 0.5 : 1,
                                    transition: 'all 0.3s ease'
                                }}
                            >
                                Next
                                <FaChevronRight size={12} />
                            </button>
                        </div>
                    </div>
                </div>

                {/* Main Content */}
                <div style={{
                    maxWidth: '900px',
                    margin: '0 auto',
                    padding: '2rem 1.5rem'
                }}>
                    {/* Error */}
                    {error && (
                        <div style={{
                            background: 'rgba(231, 76, 60, 0.1)',
                            border: '1px solid rgba(231, 76, 60, 0.3)',
                            borderRadius: '12px',
                            padding: '1rem 1.5rem',
                            marginBottom: '1.5rem',
                            color: theme.colors.error,
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.75rem'
                        }}>
                            <FaTimes />
                            {error}
                        </div>
                    )}

                    {/* Loading */}
                    {loading && (
                        <div style={{
                            textAlign: 'center',
                            padding: '4rem 2rem',
                            color: theme.colors.mutedText
                        }}>
                            <div className="proposal-pulse" style={{
                                width: '60px',
                                height: '60px',
                                borderRadius: '50%',
                                background: `linear-gradient(135deg, ${proposalPrimary}, ${proposalSecondary})`,
                                margin: '0 auto 1rem',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center'
                            }}>
                                <FaGavel size={24} color="white" />
                            </div>
                            <p>Loading proposal...</p>
                        </div>
                    )}

                    {/* No Proposal ID */}
                    {!proposalId && !loading && (
                        <div style={{
                            textAlign: 'center',
                            padding: '4rem 2rem',
                            color: theme.colors.mutedText
                        }}>
                            <FaGavel size={40} style={{ marginBottom: '1rem', opacity: 0.4 }} />
                            <p>No proposal ID specified. Go back to the proposals list to select one.</p>
                            <button
                                onClick={() => navigate('/icp_proposals')}
                                style={{
                                    background: `linear-gradient(135deg, ${proposalPrimary}, ${proposalSecondary})`,
                                    color: 'white',
                                    border: 'none',
                                    borderRadius: '10px',
                                    padding: '0.75rem 1.5rem',
                                    cursor: 'pointer',
                                    fontSize: '0.95rem',
                                    fontWeight: '500',
                                    marginTop: '1rem'
                                }}
                            >
                                View ICP Proposals
                            </button>
                        </div>
                    )}

                    {/* Proposal Content */}
                    {proposalData && !loading && !error && (
                        <div className="proposal-animate" style={{ opacity: 0 }}>

                            {/* ============================================ */}
                            {/* PROPOSAL INFO CARD                           */}
                            {/* ============================================ */}
                            <div style={{
                                background: theme.colors.secondaryBg,
                                borderRadius: '16px',
                                border: `1px solid ${theme.colors.border}`,
                                marginBottom: '1.5rem',
                                overflow: 'hidden'
                            }}>
                                {/* Card Header */}
                                <div
                                    onClick={() => setIsProposalExpanded(!isProposalExpanded)}
                                    style={{
                                        padding: '1.25rem 1.5rem',
                                        cursor: 'pointer',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'space-between',
                                        background: `linear-gradient(135deg, ${proposalPrimary}10 0%, transparent 100%)`,
                                        borderBottom: isProposalExpanded ? `1px solid ${theme.colors.border}` : 'none'
                                    }}
                                >
                                    <div style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '1rem'
                                    }}>
                                        <div style={{
                                            width: '40px',
                                            height: '40px',
                                            borderRadius: '10px',
                                            background: `${proposalPrimary}20`,
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            color: proposalPrimary
                                        }}>
                                            <FaGavel size={18} />
                                        </div>
                                        <div>
                                            <h2 style={{
                                                color: theme.colors.primaryText,
                                                fontSize: '1.1rem',
                                                fontWeight: '600',
                                                margin: 0
                                            }}>
                                                Proposal #{proposalId}
                                            </h2>
                                            <div style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '0.75rem',
                                                marginTop: '0.25rem',
                                                flexWrap: 'wrap'
                                            }}>
                                                <span style={{
                                                    color: statusColor,
                                                    fontSize: '0.85rem',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '4px'
                                                }}>
                                                    {statusIcon}
                                                    {statusText}
                                                </span>
                                                <span style={{
                                                    color: theme.colors.mutedText,
                                                    fontSize: '0.85rem'
                                                }}>
                                                    {topicName}
                                                </span>
                                                {actionTypeName && (
                                                    <span style={{
                                                        color: proposalAccent,
                                                        fontSize: '0.75rem',
                                                        background: `${proposalAccent}15`,
                                                        padding: '2px 8px',
                                                        borderRadius: '6px'
                                                    }}>
                                                        {actionTypeName}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                    <FaChevronDown
                                        color={theme.colors.mutedText}
                                        style={{
                                            transform: isProposalExpanded ? 'rotate(180deg)' : 'rotate(0)',
                                            transition: 'transform 0.2s ease'
                                        }}
                                    />
                                </div>

                                {/* Card Content */}
                                {isProposalExpanded && (
                                    <div style={{ padding: '1.5rem' }}>

                                        {/* Title */}
                                        <h3 style={{
                                            color: theme.colors.primaryText,
                                            fontSize: '1.25rem',
                                            fontWeight: '600',
                                            marginBottom: '1rem',
                                            lineHeight: '1.4'
                                        }}>
                                            {title}
                                        </h3>

                                        {/* Meta Info Grid */}
                                        <div style={{
                                            display: 'grid',
                                            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                                            gap: '0.75rem',
                                            marginBottom: '1.5rem'
                                        }}>
                                            {/* Created */}
                                            {createdTimestamp && (
                                                <div style={{
                                                    background: theme.colors.primaryBg,
                                                    borderRadius: '10px',
                                                    padding: '0.75rem 1rem'
                                                }}>
                                                    <div style={{ color: theme.colors.mutedText, fontSize: '0.8rem', marginBottom: '0.25rem' }}>Created</div>
                                                    <div style={{ color: theme.colors.primaryText, fontSize: '0.9rem' }}
                                                        title={new Date(createdTimestamp).toLocaleString()}
                                                    >
                                                        {getRelativeTime(createdTimestamp, false)}
                                                    </div>
                                                </div>
                                            )}

                                            {/* Deadline */}
                                            {deadlineTimestamp && (
                                                <div style={{
                                                    background: isVotingOpen ? `${proposalPrimary}15` : theme.colors.primaryBg,
                                                    borderRadius: '10px',
                                                    padding: '0.75rem 1rem',
                                                    border: isVotingOpen ? `1px solid ${proposalPrimary}30` : 'none'
                                                }}>
                                                    <div style={{ color: isVotingOpen ? proposalPrimary : theme.colors.mutedText, fontSize: '0.8rem', marginBottom: '0.25rem' }}>
                                                        Deadline
                                                    </div>
                                                    <div style={{ color: isVotingOpen ? proposalPrimary : theme.colors.primaryText, fontSize: '0.9rem', fontWeight: isVotingOpen ? '500' : '400' }}
                                                        title={new Date(deadlineTimestamp).toLocaleString()}
                                                    >
                                                        {new Date(deadlineTimestamp).toLocaleString()}
                                                    </div>
                                                </div>
                                            )}

                                            {/* Voting Time Remaining */}
                                            {isVotingOpen && votingTimeRemaining && (
                                                <div style={{
                                                    background: `${proposalPrimary}15`,
                                                    borderRadius: '10px',
                                                    padding: '0.75rem 1rem',
                                                    border: `1px solid ${proposalPrimary}30`
                                                }}>
                                                    <div style={{ color: proposalPrimary, fontSize: '0.8rem', marginBottom: '0.25rem' }}>Time Remaining</div>
                                                    <div style={{ color: proposalPrimary, fontSize: '0.9rem', fontWeight: '500' }}>
                                                        {votingTimeRemaining}
                                                    </div>
                                                </div>
                                            )}

                                            {/* Reward Status */}
                                            <div style={{
                                                background: theme.colors.primaryBg,
                                                borderRadius: '10px',
                                                padding: '0.75rem 1rem'
                                            }}>
                                                <div style={{ color: theme.colors.mutedText, fontSize: '0.8rem', marginBottom: '0.25rem' }}>Reward Status</div>
                                                <div style={{ color: theme.colors.primaryText, fontSize: '0.9rem' }}>
                                                    {rewardStatusText}
                                                </div>
                                            </div>

                                            {/* Topic */}
                                            <div style={{
                                                background: theme.colors.primaryBg,
                                                borderRadius: '10px',
                                                padding: '0.75rem 1rem'
                                            }}>
                                                <div style={{ color: theme.colors.mutedText, fontSize: '0.8rem', marginBottom: '0.25rem' }}>Topic</div>
                                                <div style={{ color: theme.colors.primaryText, fontSize: '0.9rem' }}>
                                                    {topicName}
                                                </div>
                                            </div>

                                            {/* Decided */}
                                            {decidedTimestamp && (
                                                <div style={{
                                                    background: theme.colors.primaryBg,
                                                    borderRadius: '10px',
                                                    padding: '0.75rem 1rem'
                                                }}>
                                                    <div style={{ color: theme.colors.mutedText, fontSize: '0.8rem', marginBottom: '0.25rem' }}>Decided</div>
                                                    <div style={{ color: theme.colors.primaryText, fontSize: '0.9rem' }}
                                                        title={new Date(decidedTimestamp).toLocaleString()}
                                                    >
                                                        {getRelativeTime(decidedTimestamp, false)}
                                                    </div>
                                                </div>
                                            )}

                                            {/* Executed */}
                                            {executedTimestamp && (
                                                <div style={{
                                                    background: `${theme.colors.success}15`,
                                                    borderRadius: '10px',
                                                    padding: '0.75rem 1rem',
                                                    border: `1px solid ${theme.colors.success}30`
                                                }}>
                                                    <div style={{ color: theme.colors.success, fontSize: '0.8rem', marginBottom: '0.25rem' }}>Executed</div>
                                                    <div style={{ color: theme.colors.success, fontSize: '0.9rem' }}
                                                        title={new Date(executedTimestamp).toLocaleString()}
                                                    >
                                                        {getRelativeTime(executedTimestamp, false)}
                                                    </div>
                                                </div>
                                            )}

                                            {/* Failed */}
                                            {failedTimestamp && (
                                                <div style={{
                                                    background: `${theme.colors.error}15`,
                                                    borderRadius: '10px',
                                                    padding: '0.75rem 1rem',
                                                    border: `1px solid ${theme.colors.error}30`
                                                }}>
                                                    <div style={{ color: theme.colors.error, fontSize: '0.8rem', marginBottom: '0.25rem' }}>Failed</div>
                                                    <div style={{ color: theme.colors.error, fontSize: '0.9rem' }}
                                                        title={new Date(failedTimestamp).toLocaleString()}
                                                    >
                                                        {getRelativeTime(failedTimestamp, false)}
                                                    </div>
                                                </div>
                                            )}

                                            {/* Total Potential VP */}
                                            {totalPotentialVP && (
                                                <div style={{
                                                    background: theme.colors.primaryBg,
                                                    borderRadius: '10px',
                                                    padding: '0.75rem 1rem'
                                                }}>
                                                    <div style={{ color: theme.colors.mutedText, fontSize: '0.8rem', marginBottom: '0.25rem' }}>Total Potential VP</div>
                                                    <div style={{ color: theme.colors.primaryText, fontSize: '0.9rem' }}>
                                                        {formatCompactVP(totalPotentialVP)} ICP
                                                    </div>
                                                </div>
                                            )}
                                        </div>

                                        {/* Proposed By */}
                                        {proposerNeuronId !== undefined && proposerNeuronId !== null && (
                                            <div style={{
                                                background: theme.colors.primaryBg,
                                                borderRadius: '12px',
                                                padding: '1rem 1.25rem',
                                                marginBottom: '1.5rem'
                                            }}>
                                                <div style={{ color: theme.colors.mutedText, fontSize: '0.85rem', marginBottom: '0.5rem' }}>Proposed by</div>
                                                <div style={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '0.75rem',
                                                    flexWrap: 'wrap'
                                                }}>
                                                    <span style={{
                                                        color: theme.colors.primaryText,
                                                        fontSize: '0.95rem',
                                                        fontFamily: proposerName ? SYSTEM_FONT : 'monospace',
                                                        fontWeight: proposerName ? '600' : '400'
                                                    }}>
                                                        {proposerName || proposerNeuronId.toString()}
                                                    </span>
                                                    {proposerName && (
                                                        <span style={{
                                                            color: theme.colors.mutedText,
                                                            fontSize: '0.8rem',
                                                            fontFamily: 'monospace'
                                                        }}>
                                                            (Neuron {proposerNeuronId.toString()})
                                                        </span>
                                                    )}
                                                    <button
                                                        onClick={() => copyToClipboard(proposerNeuronId.toString())}
                                                        style={{
                                                            background: 'none',
                                                            border: 'none',
                                                            cursor: 'pointer',
                                                            color: copiedText === proposerNeuronId.toString() ? theme.colors.success : theme.colors.mutedText,
                                                            padding: '2px',
                                                            display: 'flex',
                                                            alignItems: 'center'
                                                        }}
                                                        title="Copy neuron ID"
                                                    >
                                                        <FaCopy size={12} />
                                                    </button>
                                                </div>
                                            </div>
                                        )}

                                        {/* Failure Reason */}
                                        {failureReason && (
                                            <div style={{
                                                background: `${theme.colors.error}10`,
                                                border: `1px solid ${theme.colors.error}30`,
                                                borderRadius: '12px',
                                                padding: '1rem 1.25rem',
                                                marginBottom: '1.5rem'
                                            }}>
                                                <div style={{
                                                    color: theme.colors.error,
                                                    fontSize: '0.85rem',
                                                    fontWeight: '600',
                                                    marginBottom: '0.5rem',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '0.5rem'
                                                }}>
                                                    <FaTimes size={14} />
                                                    Failure Reason
                                                </div>
                                                <div style={{
                                                    color: theme.colors.error,
                                                    fontSize: '0.9rem',
                                                    lineHeight: '1.5',
                                                    wordBreak: 'break-word'
                                                }}>
                                                    {failureReason}
                                                </div>
                                            </div>
                                        )}

                                        {/* Voting Bar */}
                                        {tally && <VotingBar proposalData={proposalData} />}

                                        {/* Inline Voting */}
                                        {isAuthenticated && isVotingOpen && (
                                            <div style={{ marginTop: '1.5rem' }}>
                                                <IcpHotkeyNeurons
                                                    inlineInProposal={true}
                                                    proposalData={proposalData}
                                                    currentProposalId={proposalId}
                                                    onVoteSuccess={refreshProposal}
                                                />
                                            </div>
                                        )}

                                        {/* Summary */}
                                        {summary && (
                                            <div style={{ marginTop: '1.5rem' }}>
                                                <div
                                                    onClick={() => setIsSummaryExpanded(!isSummaryExpanded)}
                                                    style={{
                                                        cursor: 'pointer',
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        justifyContent: 'space-between',
                                                        padding: '0.75rem 1rem',
                                                        background: theme.colors.primaryBg,
                                                        borderRadius: isSummaryExpanded ? '10px 10px 0 0' : '10px',
                                                        border: `1px solid ${theme.colors.border}`,
                                                        borderBottom: isSummaryExpanded ? 'none' : `1px solid ${theme.colors.border}`
                                                    }}
                                                >
                                                    <span style={{
                                                        color: theme.colors.primaryText,
                                                        fontWeight: '600',
                                                        fontSize: '0.95rem'
                                                    }}>
                                                        Summary
                                                    </span>
                                                    <FaChevronDown
                                                        color={theme.colors.mutedText}
                                                        size={14}
                                                        style={{
                                                            transform: isSummaryExpanded ? 'rotate(180deg)' : 'rotate(0)',
                                                            transition: 'transform 0.2s ease'
                                                        }}
                                                    />
                                                </div>
                                                {isSummaryExpanded && (
                                                    <div style={{
                                                        background: theme.colors.primaryBg,
                                                        borderRadius: '0 0 10px 10px',
                                                        padding: '1.25rem',
                                                        border: `1px solid ${theme.colors.border}`,
                                                        borderTop: 'none'
                                                    }}>
                                                        <div style={{
                                                            color: theme.colors.primaryText,
                                                            fontSize: '0.95rem',
                                                            lineHeight: '1.6',
                                                            wordBreak: 'break-word'
                                                        }}>
                                                            <ReactMarkdown
                                                                components={{
                                                                    a: ({node, ...props}) => (
                                                                        <a {...props} style={{
                                                                            color: proposalPrimary,
                                                                            wordBreak: 'break-all'
                                                                        }} target="_blank" rel="noopener noreferrer" />
                                                                    ),
                                                                    p: ({node, ...props}) => (
                                                                        <p {...props} style={{ margin: '0 0 0.75rem 0' }} />
                                                                    ),
                                                                    h1: ({node, ...props}) => (
                                                                        <h1 {...props} style={{ fontSize: '1.2rem', fontWeight: '700', color: theme.colors.primaryText, margin: '1rem 0 0.5rem 0' }} />
                                                                    ),
                                                                    h2: ({node, ...props}) => (
                                                                        <h2 {...props} style={{ fontSize: '1.1rem', fontWeight: '600', color: theme.colors.primaryText, margin: '0.75rem 0 0.5rem 0' }} />
                                                                    ),
                                                                    h3: ({node, ...props}) => (
                                                                        <h3 {...props} style={{ fontSize: '1rem', fontWeight: '600', color: theme.colors.primaryText, margin: '0.5rem 0 0.25rem 0' }} />
                                                                    ),
                                                                    ul: ({node, ...props}) => (
                                                                        <ul {...props} style={{ paddingLeft: '1.5rem', margin: '0.5rem 0' }} />
                                                                    ),
                                                                    ol: ({node, ...props}) => (
                                                                        <ol {...props} style={{ paddingLeft: '1.5rem', margin: '0.5rem 0' }} />
                                                                    ),
                                                                    li: ({node, ...props}) => (
                                                                        <li {...props} style={{ marginBottom: '0.25rem' }} />
                                                                    ),
                                                                    code: ({node, inline, ...props}) => (
                                                                        inline
                                                                            ? <code {...props} style={{
                                                                                background: theme.colors.secondaryBg,
                                                                                padding: '2px 6px',
                                                                                borderRadius: '4px',
                                                                                fontSize: '0.85em',
                                                                                fontFamily: 'monospace'
                                                                            }} />
                                                                            : <code {...props} style={{
                                                                                display: 'block',
                                                                                background: theme.colors.secondaryBg,
                                                                                padding: '0.75rem',
                                                                                borderRadius: '6px',
                                                                                fontSize: '0.85em',
                                                                                fontFamily: 'monospace',
                                                                                overflowX: 'auto',
                                                                                whiteSpace: 'pre-wrap',
                                                                                wordBreak: 'break-all'
                                                                            }} />
                                                                    ),
                                                                    blockquote: ({node, ...props}) => (
                                                                        <blockquote {...props} style={{
                                                                            borderLeft: `3px solid ${proposalPrimary}`,
                                                                            paddingLeft: '1rem',
                                                                            margin: '0.75rem 0',
                                                                            color: theme.colors.secondaryText
                                                                        }} />
                                                                    )
                                                                }}
                                                            >
                                                                {convertHtmlToMarkdown(summary)}
                                                            </ReactMarkdown>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        )}

                                        {/* Action Details */}
                                        {action && (
                                            <div style={{ marginTop: '1rem' }}>
                                                <div
                                                    onClick={() => setIsActionExpanded(!isActionExpanded)}
                                                    style={{
                                                        cursor: 'pointer',
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        justifyContent: 'space-between',
                                                        padding: '0.75rem 1rem',
                                                        background: theme.colors.primaryBg,
                                                        borderRadius: isActionExpanded ? '10px 10px 0 0' : '10px',
                                                        border: `1px solid ${theme.colors.border}`,
                                                        borderBottom: isActionExpanded ? 'none' : `1px solid ${theme.colors.border}`
                                                    }}
                                                >
                                                    <span style={{
                                                        color: theme.colors.primaryText,
                                                        fontWeight: '600',
                                                        fontSize: '0.95rem',
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: '0.5rem'
                                                    }}>
                                                        Action Details
                                                        <span style={{
                                                            color: proposalAccent,
                                                            fontSize: '0.75rem',
                                                            background: `${proposalAccent}15`,
                                                            padding: '2px 8px',
                                                            borderRadius: '6px'
                                                        }}>
                                                            {actionTypeName}
                                                        </span>
                                                    </span>
                                                    <FaChevronDown
                                                        color={theme.colors.mutedText}
                                                        size={14}
                                                        style={{
                                                            transform: isActionExpanded ? 'rotate(180deg)' : 'rotate(0)',
                                                            transition: 'transform 0.2s ease'
                                                        }}
                                                    />
                                                </div>
                                                {isActionExpanded && (
                                                    <div style={{
                                                        background: theme.colors.primaryBg,
                                                        borderRadius: '0 0 10px 10px',
                                                        padding: '1.25rem',
                                                        border: `1px solid ${theme.colors.border}`,
                                                        borderTop: 'none'
                                                    }}>
                                                        {renderActionDetails(action)}
                                                    </div>
                                                )}
                                            </div>
                                        )}

                                        {/* URL Link */}
                                        {url && (
                                            <div style={{
                                                marginTop: '1rem',
                                                background: theme.colors.primaryBg,
                                                borderRadius: '10px',
                                                padding: '0.75rem 1rem',
                                                border: `1px solid ${theme.colors.border}`
                                            }}>
                                                <div style={{ color: theme.colors.mutedText, fontSize: '0.8rem', marginBottom: '0.25rem' }}>Proposal URL</div>
                                                <a
                                                    href={url}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    style={{
                                                        color: proposalPrimary,
                                                        fontSize: '0.9rem',
                                                        wordBreak: 'break-all',
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: '0.5rem'
                                                    }}
                                                >
                                                    <FaExternalLinkAlt size={12} />
                                                    {url}
                                                </a>
                                            </div>
                                        )}

                                        {/* External Links */}
                                        <div style={{
                                            display: 'flex',
                                            gap: '0.75rem',
                                            flexWrap: 'wrap',
                                            marginTop: '1.5rem'
                                        }}>
                                            <a
                                                href={`https://dashboard.internetcomputer.org/proposal/${proposalId}`}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                style={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '0.5rem',
                                                    padding: '0.5rem 1rem',
                                                    background: `${proposalPrimary}15`,
                                                    border: `1px solid ${proposalPrimary}30`,
                                                    borderRadius: '8px',
                                                    color: proposalPrimary,
                                                    textDecoration: 'none',
                                                    fontSize: '0.85rem',
                                                    fontWeight: '500',
                                                    transition: 'all 0.2s ease'
                                                }}
                                            >
                                                <FaExternalLinkAlt size={12} />
                                                IC Dashboard
                                            </a>
                                            <a
                                                href={`https://nns.ic0.app/proposal/?u=qoctq-giaaa-aaaaa-aaaea-cai&proposal=${proposalId}`}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                style={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '0.5rem',
                                                    padding: '0.5rem 1rem',
                                                    background: `${proposalPrimary}15`,
                                                    border: `1px solid ${proposalPrimary}30`,
                                                    borderRadius: '8px',
                                                    color: proposalPrimary,
                                                    textDecoration: 'none',
                                                    fontSize: '0.85rem',
                                                    fontWeight: '500',
                                                    transition: 'all 0.2s ease'
                                                }}
                                            >
                                                <FaExternalLinkAlt size={12} />
                                                NNS Dapp
                                            </a>
                                        </div>

                                        {/* ============================================ */}
                                        {/* VOTING HISTORY / BALLOTS                     */}
                                        {/* ============================================ */}
                                        {ballots && ballots.length > 0 && (
                                            <div style={{ marginTop: '1.5rem' }}>
                                                <div
                                                    onClick={() => setIsVotingHistoryExpanded(!isVotingHistoryExpanded)}
                                                    style={{
                                                        cursor: 'pointer',
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        justifyContent: 'space-between',
                                                        padding: '0.75rem 1rem',
                                                        background: theme.colors.primaryBg,
                                                        borderRadius: '10px',
                                                        border: `1px solid ${theme.colors.border}`
                                                    }}
                                                >
                                                    <div style={{
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: '0.5rem',
                                                        color: theme.colors.primaryText,
                                                        fontWeight: '600'
                                                    }}>
                                                        <FaGavel size={16} style={{ color: proposalPrimary }} />
                                                        Voting History
                                                        <span style={{
                                                            background: `${proposalPrimary}20`,
                                                            color: proposalPrimary,
                                                            padding: '2px 8px',
                                                            borderRadius: '10px',
                                                            fontSize: '0.8rem'
                                                        }}>
                                                            {ballots.length}
                                                        </span>
                                                        {/* Vote summary badges */}
                                                        <span style={{
                                                            background: `${theme.colors.success}20`,
                                                            color: theme.colors.success,
                                                            padding: '2px 6px',
                                                            borderRadius: '8px',
                                                            fontSize: '0.7rem'
                                                        }}>
                                                            {voteSummary.adopt}
                                                        </span>
                                                        <span style={{
                                                            background: `${theme.colors.error}20`,
                                                            color: theme.colors.error,
                                                            padding: '2px 6px',
                                                            borderRadius: '8px',
                                                            fontSize: '0.7rem'
                                                        }}>
                                                            {voteSummary.reject}
                                                        </span>
                                                        <span style={{
                                                            background: `${theme.colors.mutedText}20`,
                                                            color: theme.colors.mutedText,
                                                            padding: '2px 6px',
                                                            borderRadius: '8px',
                                                            fontSize: '0.7rem'
                                                        }}>
                                                            {voteSummary.notVoted}
                                                        </span>
                                                    </div>
                                                    <FaChevronDown
                                                        color={theme.colors.mutedText}
                                                        style={{
                                                            transform: isVotingHistoryExpanded ? 'rotate(180deg)' : 'rotate(0)',
                                                            transition: 'transform 0.2s ease'
                                                        }}
                                                    />
                                                </div>

                                                {isVotingHistoryExpanded && (
                                                    <div style={{
                                                        marginTop: '0.75rem',
                                                        background: theme.colors.primaryBg,
                                                        borderRadius: '12px',
                                                        padding: '1rem',
                                                        border: `1px solid ${theme.colors.border}`
                                                    }}>
                                                        {/* Filters */}
                                                        <div style={{
                                                            display: 'flex',
                                                            gap: '1rem',
                                                            marginBottom: '1rem',
                                                            padding: '0.75rem',
                                                            background: theme.colors.secondaryBg,
                                                            borderRadius: '8px',
                                                            flexWrap: 'wrap',
                                                            alignItems: 'center',
                                                            justifyContent: 'space-between'
                                                        }}>
                                                            <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                                                                <label style={{
                                                                    display: 'flex',
                                                                    alignItems: 'center',
                                                                    gap: '6px',
                                                                    color: theme.colors.success,
                                                                    cursor: 'pointer',
                                                                    fontSize: '0.85rem'
                                                                }}>
                                                                    <input
                                                                        type="checkbox"
                                                                        checked={hideAdopt}
                                                                        onChange={(e) => setHideAdopt(e.target.checked)}
                                                                    />
                                                                    Hide Adopt
                                                                </label>
                                                                <label style={{
                                                                    display: 'flex',
                                                                    alignItems: 'center',
                                                                    gap: '6px',
                                                                    color: theme.colors.error,
                                                                    cursor: 'pointer',
                                                                    fontSize: '0.85rem'
                                                                }}>
                                                                    <input
                                                                        type="checkbox"
                                                                        checked={hideReject}
                                                                        onChange={(e) => setHideReject(e.target.checked)}
                                                                    />
                                                                    Hide Reject
                                                                </label>
                                                                <label style={{
                                                                    display: 'flex',
                                                                    alignItems: 'center',
                                                                    gap: '6px',
                                                                    color: theme.colors.mutedText,
                                                                    cursor: 'pointer',
                                                                    fontSize: '0.85rem'
                                                                }}>
                                                                    <input
                                                                        type="checkbox"
                                                                        checked={hideNotVoted}
                                                                        onChange={(e) => setHideNotVoted(e.target.checked)}
                                                                    />
                                                                    Hide Pending
                                                                </label>
                                                            </div>
                                                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                                <FaSort size={12} color={theme.colors.mutedText} />
                                                                <select
                                                                    value={sortBy}
                                                                    onChange={(e) => setSortBy(e.target.value)}
                                                                    style={{
                                                                        background: theme.colors.primaryBg,
                                                                        color: theme.colors.primaryText,
                                                                        border: `1px solid ${theme.colors.border}`,
                                                                        borderRadius: '6px',
                                                                        padding: '4px 8px',
                                                                        fontSize: '0.85rem',
                                                                        cursor: 'pointer'
                                                                    }}
                                                                >
                                                                    <option value="power">By VP</option>
                                                                    <option value="vote">By Vote</option>
                                                                </select>
                                                            </div>
                                                        </div>

                                                        {/* Votes List */}
                                                        <div style={{ maxHeight: '500px', overflowY: 'auto' }}>
                                                            {filterAndSortVotes(ballots).map(([neuronId, ballot], index) => {
                                                                const neuronIdStr = neuronId.toString();
                                                                const knownName = getKnownNeuronName(neuronId);
                                                                const voteInfo = formatNnsVote(ballot.vote);
                                                                const voteColor = voteInfo.isYes === true
                                                                    ? theme.colors.success
                                                                    : voteInfo.isYes === false
                                                                        ? theme.colors.error
                                                                        : theme.colors.mutedText;

                                                                return (
                                                                    <div
                                                                        key={index}
                                                                        style={{
                                                                            padding: '0.4rem 0.6rem',
                                                                            background: theme.colors.secondaryBg,
                                                                            marginBottom: '0.25rem',
                                                                            borderRadius: '6px',
                                                                            border: `1px solid ${theme.colors.border}`,
                                                                            fontSize: '0.8rem'
                                                                        }}
                                                                    >
                                                                        <div style={{
                                                                            display: 'flex',
                                                                            alignItems: 'center',
                                                                            gap: '0.75rem'
                                                                        }}>
                                                                            {/* Vote indicator */}
                                                                            <span style={{
                                                                                color: voteColor,
                                                                                fontWeight: '600',
                                                                                minWidth: '65px',
                                                                                fontSize: '0.8rem'
                                                                            }}>
                                                                                {voteInfo.text}
                                                                            </span>

                                                                            {/* Neuron ID */}
                                                                            <div style={{
                                                                                flex: 1,
                                                                                minWidth: 0,
                                                                                overflow: 'hidden',
                                                                                display: 'flex',
                                                                                alignItems: 'center',
                                                                                gap: '0.5rem'
                                                                            }}>
                                                                                {knownName && (
                                                                                    <span style={{
                                                                                        color: proposalPrimary,
                                                                                        fontWeight: '600',
                                                                                        fontSize: '0.8rem',
                                                                                        whiteSpace: 'nowrap'
                                                                                    }}>
                                                                                        {knownName}
                                                                                    </span>
                                                                                )}
                                                                                <span
                                                                                    style={{
                                                                                        fontFamily: 'monospace',
                                                                                        color: knownName ? theme.colors.mutedText : theme.colors.secondaryText,
                                                                                        fontSize: '0.75rem',
                                                                                        whiteSpace: 'nowrap',
                                                                                        overflow: 'hidden',
                                                                                        textOverflow: 'ellipsis',
                                                                                        cursor: 'pointer'
                                                                                    }}
                                                                                    onClick={() => copyToClipboard(neuronIdStr)}
                                                                                    title={`Click to copy: ${neuronIdStr}`}
                                                                                >
                                                                                    {neuronIdStr.length > 20
                                                                                        ? neuronIdStr.substring(0, 8) + '...' + neuronIdStr.substring(neuronIdStr.length - 8)
                                                                                        : neuronIdStr
                                                                                    }
                                                                                </span>
                                                                                {copiedText === neuronIdStr && (
                                                                                    <span style={{
                                                                                        color: theme.colors.success,
                                                                                        fontSize: '0.65rem'
                                                                                    }}>
                                                                                        Copied!
                                                                                    </span>
                                                                                )}
                                                                            </div>

                                                                            {/* Voting power */}
                                                                            <span style={{
                                                                                color: theme.colors.secondaryText,
                                                                                whiteSpace: 'nowrap',
                                                                                fontSize: '0.75rem',
                                                                                fontWeight: '500'
                                                                            }}
                                                                                title={`${formatE8s(ballot.voting_power)} ICP voting power`}
                                                                            >
                                                                                {formatCompactVP(ballot.voting_power)} VP
                                                                            </span>
                                                                        </div>
                                                                    </div>
                                                                );
                                                            })}

                                                            {filterAndSortVotes(ballots).length === 0 && (
                                                                <div style={{
                                                                    textAlign: 'center',
                                                                    padding: '1.5rem',
                                                                    color: theme.colors.mutedText,
                                                                    fontSize: '0.9rem'
                                                                }}>
                                                                    No votes match the current filters
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            </main>
        </div>
    );
}

export default IcpProposal;
