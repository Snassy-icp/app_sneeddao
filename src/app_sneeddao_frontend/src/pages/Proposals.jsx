import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, Link, useSearchParams, useLocation } from 'react-router-dom';
import { createActor as createSnsGovernanceActor } from 'external/sns_governance';
import { createActor as createIcrc1Actor } from 'external/icrc1_ledger';
import { useAuth } from '../AuthContext';
import { useSns } from '../contexts/SnsContext';
import { useNeurons } from '../contexts/NeuronsContext';
import Header from '../components/Header';
import ReactMarkdown from 'react-markdown';
import { getSnsById, fetchSnsLogo, getAllSnses } from '../utils/SnsUtils';
import { useOptimizedSnsLoading } from '../hooks/useOptimizedSnsLoading';
import { formatProposalIdLink, formatNeuronDisplayWithContext, uint8ArrayToHex } from '../utils/NeuronUtils';
import { PrincipalDisplay, getPrincipalDisplayInfoFromContext } from '../utils/PrincipalUtils';
import { useNaming } from '../NamingContext';
import { useTheme } from '../contexts/ThemeContext';
import { getProposalStatus, isProposalAcceptingVotes, getVotingTimeRemaining } from '../utils/ProposalUtils';
import { calculateVotingPower } from '../utils/VotingPowerUtils';
import { getRelativeTime, getFullDate } from '../utils/DateUtils';
import { HttpAgent } from '@dfinity/agent';
import { FaGavel, FaSearch, FaFilter, FaDownload, FaChevronDown, FaChevronRight, FaExternalLinkAlt, FaCheck, FaTimes, FaClock, FaLayerGroup, FaVoteYea } from 'react-icons/fa';

// Custom CSS for animations
const customStyles = `
@keyframes shimmer {
    0% { background-position: -200% 0; }
    100% { background-position: 200% 0; }
}

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

@keyframes slideDown {
    from {
        opacity: 0;
        max-height: 0;
    }
    to {
        opacity: 1;
        max-height: 2000px;
    }
}

.proposals-card-animate {
    animation: fadeInUp 0.4s ease-out forwards;
}

.proposals-shimmer {
    background: linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.1) 50%, transparent 100%);
    background-size: 200% 100%;
    animation: shimmer 2s infinite;
}

.proposals-pulse {
    animation: pulse 2s ease-in-out infinite;
}
`;

// Accent colors
const proposalPrimary = '#6366f1'; // Indigo
const proposalSecondary = '#8b5cf6'; // Purple
const proposalAccent = '#06b6d4'; // Cyan

function Proposals() {
    const { theme } = useTheme();
    const { isAuthenticated, identity } = useAuth();
    const { selectedSnsRoot, updateSelectedSns } = useSns();
    const navigate = useNavigate();
    const location = useLocation();
    const [searchParams] = useSearchParams();
    const [proposals, setProposals] = useState([]);
    const [filteredProposals, setFilteredProposals] = useState([]);
    const [proposerFilter, setProposerFilter] = useState('');
    const [topicFilter, setTopicFilter] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    
    // Use optimized SNS loading
    const { 
        snsList, 
        currentSns, 
        loadingCurrent: loadingSnses, 
        error: snsError 
    } = useOptimizedSnsLoading();
    
    // Get naming context
    const { neuronNames, neuronNicknames, verifiedNames, principalNames, principalNicknames } = useNaming();
    
    // Pagination state
    const [itemsPerPage, setItemsPerPage] = useState(20);
    const [currentPage, setCurrentPage] = useState(1);
    const [hasMoreProposals, setHasMoreProposals] = useState(true);
    const [lastProposalId, setLastProposalId] = useState(null);
    const [loadingAll, setLoadingAll] = useState(false);
    const [allProposalsLoaded, setAllProposalsLoaded] = useState(false);
    const [tokenSymbol, setTokenSymbol] = useState('SNS');

    // Add state to track expanded summaries
    const [expandedSummaries, setExpandedSummaries] = useState(new Set());
    
    // Hover states for cards
    const [hoveredCard, setHoveredCard] = useState(null);

    // SNS logo state
    const [snsLogo, setSnsLogo] = useState(null);
    const [loadingLogo, setLoadingLogo] = useState(false);
    const [snsInfo, setSnsInfo] = useState(null);

    // Quick voting state
    const { getHotkeyNeurons, refreshNeurons } = useNeurons();
    const [proposalEligibility, setProposalEligibility] = useState({}); // { proposalId: { loading, eligibleCount, totalVP, checked } }
    const [quickVotingStates, setQuickVotingStates] = useState({}); // { proposalId: 'idle' | 'voting' | 'success' | 'error' }
    const [votedProposals, setVotedProposals] = useState(new Set()); // Track proposals we've voted on this session
    const [nervousSystemParameters, setNervousSystemParameters] = useState(null);
    const eligibilityCheckRef = useRef(null);

    // Load SNS information and logo
    const loadSnsInfo = async () => {
        if (!selectedSnsRoot) return;

        setSnsLogo(null);
        setLoadingLogo(false);
        setSnsInfo(null);

        try {
            const allSnses = getAllSnses();
            const currentSnsInfo = allSnses.find(sns => sns.rootCanisterId === selectedSnsRoot);
            
            if (currentSnsInfo) {
                setSnsInfo(currentSnsInfo);
                
                if (currentSnsInfo.canisters.governance) {
                    await loadSnsLogo(currentSnsInfo.canisters.governance, currentSnsInfo.name);
                }
            }
        } catch (error) {
            console.error('Error loading SNS info:', error);
        }
    };

    const loadSnsLogo = async (governanceId, snsName) => {
        if (loadingLogo) return;
        
        setLoadingLogo(true);
        
        try {
            const host = process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging' ? 'https://ic0.app' : 'http://localhost:4943';
            const agent = new HttpAgent({
                host,
                ...(identity && { identity })
            });

            if (process.env.DFX_NETWORK !== 'ic') {
                await agent.fetchRootKey();
            }

            const logo = await fetchSnsLogo(governanceId, agent);
            setSnsLogo(logo);
        } catch (error) {
            console.error(`Error loading logo for SNS ${snsName}:`, error);
        } finally {
            setLoadingLogo(false);
        }
    };

    // Load SNS info when selected SNS changes
    useEffect(() => {
        if (selectedSnsRoot) {
            loadSnsInfo();
        }
    }, [selectedSnsRoot, identity]);

    // Format VP in compact form (K, M suffixes)
    const formatCompactVP = (vp) => {
        if (!vp || vp === 0) return '0';
        const displayValue = vp / 100_000_000; // Convert from e8s
        if (displayValue >= 1_000_000) {
            return (displayValue / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
        } else if (displayValue >= 1_000) {
            return (displayValue / 1_000).toFixed(1).replace(/\.0$/, '') + 'K';
        }
        return displayValue.toFixed(displayValue < 10 ? 1 : 0).replace(/\.0$/, '');
    };

    // Fetch nervous system parameters for voting power calculation
    useEffect(() => {
        const fetchParams = async () => {
            if (!selectedSnsRoot || !identity) {
                setNervousSystemParameters(null);
                return;
            }
            
            try {
                const selectedSns = getSnsById(selectedSnsRoot);
                if (!selectedSns) return;

                const snsGovActor = createSnsGovernanceActor(selectedSns.canisters.governance, {
                    agentOptions: { identity }
                });
                
                const params = await snsGovActor.get_nervous_system_parameters(null);
                setNervousSystemParameters(params);
            } catch (error) {
                console.error('Error fetching nervous system parameters:', error);
                setNervousSystemParameters(null);
            }
        };

        fetchParams();
    }, [selectedSnsRoot, identity]);

    // Progressive eligibility check for proposals
    useEffect(() => {
        if (!isAuthenticated || !identity || !selectedSnsRoot || filteredProposals.length === 0) {
            return;
        }

        // Clear previous check
        if (eligibilityCheckRef.current) {
            clearTimeout(eligibilityCheckRef.current);
        }

        const hotkeyNeurons = getHotkeyNeurons();
        if (!hotkeyNeurons || hotkeyNeurons.length === 0) {
            // No hotkey neurons, mark all proposals as checked with 0 eligible
            const emptyEligibility = {};
            filteredProposals.forEach(p => {
                const proposalId = p.id[0]?.id?.toString();
                if (proposalId) {
                    emptyEligibility[proposalId] = { loading: false, eligibleCount: 0, totalVP: 0, checked: true };
                }
            });
            setProposalEligibility(emptyEligibility);
            return;
        }

        // Check eligibility progressively (in batches with delays)
        const checkEligibilityBatch = async (startIndex) => {
            const batchSize = 5;
            const batch = filteredProposals.slice(startIndex, startIndex + batchSize);
            
            if (batch.length === 0) return;

            const updates = {};
            
            for (const proposal of batch) {
                const proposalId = proposal.id[0]?.id?.toString();
                if (!proposalId || !isProposalAcceptingVotes(proposal)) {
                    updates[proposalId] = { loading: false, eligibleCount: 0, totalVP: 0, checked: true };
                    continue;
                }

                // Skip proposals we've already voted on this session (prevents stale ballot data issues)
                if (votedProposals.has(proposalId)) {
                    updates[proposalId] = { loading: false, eligibleCount: 0, totalVP: 0, checked: true };
                    continue;
                }

                // Count eligible neurons and total VP for this proposal
                let eligibleCount = 0;
                let totalVP = 0;
                for (const neuron of hotkeyNeurons) {
                    // Check voting power
                    const votingPower = nervousSystemParameters ? 
                        calculateVotingPower(neuron, nervousSystemParameters) : 0;
                    if (votingPower === 0) continue;

                    // Check if already voted (using ballots from proposal)
                    const neuronIdHex = uint8ArrayToHex(neuron.id?.[0]?.id);
                    const ballot = proposal.ballots?.find(([id, _]) => id === neuronIdHex);
                    
                    if (ballot && ballot[1]) {
                        const ballotData = ballot[1];
                        const hasVoted = ballotData.cast_timestamp_seconds && Number(ballotData.cast_timestamp_seconds) > 0;
                        if (hasVoted) continue;
                    }

                    eligibleCount++;
                    totalVP += votingPower;
                }

                updates[proposalId] = { loading: false, eligibleCount, totalVP, checked: true };
            }

            setProposalEligibility(prev => ({ ...prev, ...updates }));

            // Schedule next batch
            if (startIndex + batchSize < filteredProposals.length) {
                eligibilityCheckRef.current = setTimeout(() => {
                    checkEligibilityBatch(startIndex + batchSize);
                }, 50); // Small delay between batches
            }
        };

        // Mark all as loading initially
        const loadingState = {};
        filteredProposals.forEach(p => {
            const proposalId = p.id[0]?.id?.toString();
            if (proposalId && !proposalEligibility[proposalId]?.checked) {
                loadingState[proposalId] = { loading: true, eligibleCount: 0, totalVP: 0, checked: false };
            }
        });
        if (Object.keys(loadingState).length > 0) {
            setProposalEligibility(prev => ({ ...prev, ...loadingState }));
        }

        // Start checking
        eligibilityCheckRef.current = setTimeout(() => {
            checkEligibilityBatch(0);
        }, 100);

        return () => {
            if (eligibilityCheckRef.current) {
                clearTimeout(eligibilityCheckRef.current);
            }
        };
    }, [filteredProposals, isAuthenticated, identity, selectedSnsRoot, getHotkeyNeurons, nervousSystemParameters, votedProposals]);

    // Quick vote function - votes with all eligible neurons
    const quickVote = useCallback(async (proposal, vote) => {
        const proposalId = proposal.id[0]?.id?.toString();
        if (!proposalId || !identity || !selectedSnsRoot) return;

        const hotkeyNeurons = getHotkeyNeurons();
        if (!hotkeyNeurons || hotkeyNeurons.length === 0) return;

        setQuickVotingStates(prev => ({ ...prev, [proposalId]: 'voting' }));

        try {
            const selectedSns = getSnsById(selectedSnsRoot);
            if (!selectedSns) throw new Error('SNS not found');

            const snsGovActor = createSnsGovernanceActor(selectedSns.canisters.governance, {
                agentOptions: { identity }
            });

            // Filter eligible neurons
            const eligibleNeurons = hotkeyNeurons.filter(neuron => {
                // Check voting power
                const votingPower = nervousSystemParameters ? 
                    calculateVotingPower(neuron, nervousSystemParameters) : 0;
                if (votingPower === 0) return false;

                // Check if already voted
                const neuronIdHex = uint8ArrayToHex(neuron.id?.[0]?.id);
                const ballot = proposal.ballots?.find(([id, _]) => id === neuronIdHex);
                
                if (ballot && ballot[1]) {
                    const ballotData = ballot[1];
                    const hasVoted = ballotData.cast_timestamp_seconds && Number(ballotData.cast_timestamp_seconds) > 0;
                    if (hasVoted) return false;
                }

                return true;
            });

            if (eligibleNeurons.length === 0) {
                setQuickVotingStates(prev => ({ ...prev, [proposalId]: 'error' }));
                return;
            }

            // Vote with all eligible neurons
            let successCount = 0;
            let failCount = 0;

            for (const neuron of eligibleNeurons) {
                try {
                    const manageNeuronRequest = {
                        subaccount: neuron.id[0]?.id,
                        command: [{
                            RegisterVote: {
                                vote: vote, // 1 for Adopt, 2 for Reject
                                proposal: [{ id: BigInt(proposalId) }]
                            }
                        }]
                    };
                    
                    const response = await snsGovActor.manage_neuron(manageNeuronRequest);
                    
                    if (response?.command?.[0]?.RegisterVote) {
                        successCount++;
                    } else if (response?.command?.[0]?.Error) {
                        console.error('Vote error:', response.command[0].Error.error_message);
                        failCount++;
                    } else {
                        failCount++;
                    }
                } catch (error) {
                    console.error('Error voting with neuron:', error);
                    failCount++;
                }
            }

            if (successCount > 0) {
                setQuickVotingStates(prev => ({ ...prev, [proposalId]: 'success' }));
                // Track that we've voted on this proposal (prevents stale ballot data issues)
                setVotedProposals(prev => new Set([...prev, proposalId]));
                // Update eligibility to show 0 eligible now
                setProposalEligibility(prev => ({ 
                    ...prev, 
                    [proposalId]: { loading: false, eligibleCount: 0, totalVP: 0, checked: true } 
                }));
                // Refresh neurons data
                await refreshNeurons(selectedSnsRoot);
            } else {
                setQuickVotingStates(prev => ({ ...prev, [proposalId]: 'error' }));
            }

            // Reset state after a delay
            setTimeout(() => {
                setQuickVotingStates(prev => ({ ...prev, [proposalId]: 'idle' }));
            }, 3000);

        } catch (error) {
            console.error('Quick vote error:', error);
            setQuickVotingStates(prev => ({ ...prev, [proposalId]: 'error' }));
            setTimeout(() => {
                setQuickVotingStates(prev => ({ ...prev, [proposalId]: 'idle' }));
            }, 3000);
        }
    }, [identity, selectedSnsRoot, getHotkeyNeurons, nervousSystemParameters, refreshNeurons]);

    // Helper function to get neuron display info
    const getNeuronDisplayInfo = (neuronId) => {
        if (!neuronId || !selectedSnsRoot) return null;
        
        const neuronIdHex = uint8ArrayToHex(neuronId);
        if (!neuronIdHex) return null;
        
        const mapKey = `${selectedSnsRoot}:${neuronIdHex}`;
        const name = neuronNames?.get(mapKey);
        const nickname = neuronNicknames?.get(mapKey);
        const isVerified = verifiedNames?.get(mapKey);
        
        return { name, nickname, isVerified };
    };

    // Handle nickname updates
    const handleNicknameUpdate = (neuronId, snsRoot, newNickname) => {
        // The naming context will be updated by the dialog's success callback
        // which should trigger a re-render via the useNaming hook
        console.log('Nickname updated for neuron:', neuronId, 'in SNS:', snsRoot, 'new nickname:', newNickname);
    };

    // Define available topic options based on SNS governance interface
    const topicOptions = [
        { value: '', label: 'All Topics' },
        { value: 'Motion', label: 'Motion' },
        { value: 'ManageNervousSystemParameters', label: 'Manage Nervous System Parameters' },
        { value: 'UpgradeSnsToNextVersion', label: 'Upgrade SNS to Next Version' },
        { value: 'ExecuteGenericNervousSystemFunction', label: 'Execute Generic Nervous System Function' },
        { value: 'ManageSnsMetadata', label: 'Manage SNS Metadata' },
        { value: 'TransferSnsTreasuryFunds', label: 'Transfer SNS Treasury Funds' },
        { value: 'RegisterDappCanisters', label: 'Register Dapp Canisters' },
        { value: 'DeregisterDappCanisters', label: 'Deregister Dapp Canisters' },
        { value: 'UpgradeSnsControlledCanister', label: 'Upgrade SNS Controlled Canister' },
        { value: 'ManageDappCanisterSettings', label: 'Manage Dapp Canister Settings' },
        { value: 'MintSnsTokens', label: 'Mint SNS Tokens' },
        { value: 'ManageLedgerParameters', label: 'Manage Ledger Parameters' },
        { value: 'AddGenericNervousSystemFunction', label: 'Add Generic Nervous System Function' },
        { value: 'RemoveGenericNervousSystemFunction', label: 'Remove Generic Nervous System Function' }
    ];

    // Helper function to get topic from proposal
    const getProposalTopic = (proposal) => {
        if (!proposal.topic?.[0]) return 'Unknown';
        return Object.keys(proposal.topic[0])[0] || 'Unknown';
    };

    // Helper function to get action type from proposal
    const getProposalActionType = (proposal) => {
        if (!proposal.proposal?.[0]?.action?.[0]) return 'Unknown';
        return Object.keys(proposal.proposal[0].action[0])[0] || 'Unknown';
    };

    // Helper function to extract raw payload
    const extractRawPayload = (proposal) => {
        try {
            // Get the action payload
            const action = proposal.proposal?.[0]?.action?.[0];
            if (!action) return '';
            
            // Convert the action object to a formatted JSON string
            const payload = JSON.stringify(action, (key, value) => {
                // Handle BigInt values
                if (typeof value === 'bigint') {
                    return value.toString();
                }
                // Handle Uint8Array values (convert to hex or array representation)
                if (value instanceof Uint8Array) {
                    return Array.from(value);
                }
                return value;
            }, 2);
            
            return payload;
        } catch (error) {
            console.error('Error extracting raw payload:', error);
            return '';
        }
    };

    // Helper function to parse treasury transfer details
    const parseTreasuryTransferDetails = (proposal) => {
        const actionType = getProposalActionType(proposal);
        
        if (actionType !== 'TransferSnsTreasuryFunds') {
            return {
                amount: '',
                amountE8s: '',
                tokenType: '',
                targetPrincipal: '',
                memo: ''
            };
        }

        try {
            const action = proposal.proposal?.[0]?.action?.[0];
            const transferAction = action?.TransferSnsTreasuryFunds;
            
            if (!transferAction) {
                return {
                    amount: '',
                    amountE8s: '',
                    tokenType: '',
                    targetPrincipal: '',
                    memo: ''
                };
            }

            // Extract amount and determine token type
            let amount = '';
            let amountE8s = '';
            let tokenType = '';

            // Determine token type using enum values: 1 = ICP, 2 = SNS token
            const fromTreasury = transferAction.from_treasury;
            if (fromTreasury === 1) {
                tokenType = 'ICP';
            } else if (fromTreasury === 2) {
                tokenType = tokenSymbol; // Use actual SNS token symbol
            } else if (fromTreasury === 0) {
                tokenType = 'ICP'; // Fallback for 0 = ICP
            } else {
                tokenType = tokenSymbol; // Default to SNS token for unknown values
            }

            // Extract amount - try different ways to access the amount
            amountE8s = transferAction.amount_e8s?.toString() || 
                       transferAction.amount?.toString() || 
                       transferAction.amount_e8s || 
                       '';
            
            if (amountE8s) {
                const numAmount = typeof amountE8s === 'bigint' ? Number(amountE8s) : Number(amountE8s);
                amount = (numAmount / 100000000).toFixed(8);
            }

            // Extract target principal - it's an array with Principal object
            let targetPrincipal = '';
            if (transferAction.to_principal && Array.isArray(transferAction.to_principal) && transferAction.to_principal.length > 0) {
                targetPrincipal = transferAction.to_principal[0].toString();
            }

            // Extract memo
            const memo = transferAction.memo?.toString() || '0';

            return {
                amount,
                amountE8s,
                tokenType,
                targetPrincipal,
                memo
            };

        } catch (error) {
            console.error('Error parsing treasury transfer details:', error);
            return {
                amount: '',
                amountE8s: '',
                tokenType: '',
                targetPrincipal: '',
                memo: ''
            };
        }
    };

    // Listen for URL parameter changes and sync with global state
    useEffect(() => {
        const snsParam = searchParams.get('sns');
        if (snsParam && snsParam !== selectedSnsRoot) {
            updateSelectedSns(snsParam);
            setCurrentPage(1);
            setLastProposalId(null);
            setHasMoreProposals(true);
            setProposals([]);
        }
    }, [searchParams, selectedSnsRoot, updateSelectedSns]);

    // Reset proposals when SNS changes
    useEffect(() => {
        setCurrentPage(1);
        setLastProposalId(null);
        setHasMoreProposals(true);
        setProposals([]);
        setFilteredProposals([]);
        setAllProposalsLoaded(false);
        setLoadingAll(false);
        setTokenSymbol('SNS'); // Reset to default until new symbol is fetched
        // Reset quick voting state
        setProposalEligibility({});
        setQuickVotingStates({});
        setVotedProposals(new Set());
    }, [selectedSnsRoot]);

    // Filter proposals based on proposer and topic filters
    useEffect(() => {
        if (!proposals.length) {
            setFilteredProposals([]);
            return;
        }

        let filtered = proposals;

        // Apply proposer filter
        if (proposerFilter.trim()) {
            const filterLower = proposerFilter.toLowerCase();
            filtered = filtered.filter(proposal => {
                const neuronIdHex = uint8ArrayToHex(proposal.proposer?.[0]?.id);
                if (!neuronIdHex) return false;

                // Check if neuron ID contains the filter (with wildcard matching)
                if (neuronIdHex.toLowerCase().includes(filterLower)) {
                    return true;
                }

                // Check names and nicknames with wildcard matching
                const mapKey = `${selectedSnsRoot}:${neuronIdHex}`;
                const name = neuronNames.get(mapKey)?.toLowerCase();
                const nickname = neuronNicknames.get(mapKey)?.toLowerCase();

                return (name && name.includes(filterLower)) || 
                       (nickname && nickname.includes(filterLower));
            });
        }

        // Apply topic filter
        if (topicFilter.trim()) {
            filtered = filtered.filter(proposal => {
                const actionType = getProposalActionType(proposal);
                return actionType === topicFilter;
            });
        }

        setFilteredProposals(filtered);
    }, [proposals, proposerFilter, topicFilter, selectedSnsRoot, neuronNames, neuronNicknames]);

    // Handle SNS loading errors
    useEffect(() => {
        if (snsError) {
            setError(snsError);
        }
    }, [snsError]);

    // Fetch token symbol when SNS changes
    const fetchTokenSymbol = async () => {
        try {
            const selectedSns = getSnsById(selectedSnsRoot);
            if (!selectedSns) return;

            const icrc1Actor = createIcrc1Actor(selectedSns.canisters.ledger, {
                agentOptions: { identity }
            });
            
            const metadata = await icrc1Actor.icrc1_metadata();
            const symbolEntry = metadata.find(entry => entry[0] === 'icrc1:symbol');
            let symbol = 'SNS';
            if (symbolEntry && symbolEntry[1]) {
                symbol = symbolEntry[1].Text;
            }
            setTokenSymbol(symbol);
        } catch (err) {
            console.error('Error fetching token symbol:', err);
            setTokenSymbol('SNS'); // Fallback
        }
    };

    // Fetch proposals and token symbol when SNS changes or pagination changes
    useEffect(() => {
        if (selectedSnsRoot) {
            fetchProposals();
            fetchTokenSymbol();
        }
    }, [selectedSnsRoot, itemsPerPage, currentPage]);

    const fetchProposals = async () => {
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

            const listProposalsArg = {
                limit: itemsPerPage,
                before_proposal: lastProposalId ? [{ id: BigInt(lastProposalId) }] : [],
                include_reward_status: [],
                exclude_type: [],
                include_status: [],
                include_topics: []
            };

            const response = await snsGovActor.list_proposals(listProposalsArg);
            
            if (response.proposals.length < itemsPerPage) {
                setHasMoreProposals(false);
            }

            if (currentPage === 1) {
                setProposals(response.proposals);
            } else {
                setProposals(prev => [...prev, ...response.proposals]);
            }

            if (response.proposals.length > 0) {
                const lastProposal = response.proposals[response.proposals.length - 1];
                setLastProposalId(lastProposal.id[0].id.toString());
            }
        } catch (err) {
            console.error('Error fetching proposals:', err);
            setError('Failed to fetch proposals');
        } finally {
            setLoading(false);
        }
    };

    const handleSnsChange = (newSnsRoot) => {
        // The global context and URL sync is handled by SnsDropdown component
        // This callback is mainly for any page-specific logic
        setCurrentPage(1);
        setLastProposalId(null);
        setHasMoreProposals(true);
        setProposals([]);
        setFilteredProposals([]);
        setProposerFilter('');
        setTopicFilter('');
        setAllProposalsLoaded(false);
        setLoadingAll(false);
        setTokenSymbol('SNS'); // Reset to default until new symbol is fetched
    };

    const handleItemsPerPageChange = (e) => {
        setItemsPerPage(parseInt(e.target.value));
        setCurrentPage(1);
        setLastProposalId(null);
        setHasMoreProposals(true);
        setProposals([]);
        setFilteredProposals([]);
        setTopicFilter('');
    };

    const loadMore = () => {
        setCurrentPage(prev => prev + 1);
    };

    // Load all proposals function
    const loadAllProposals = async () => {
        if (loadingAll || allProposalsLoaded) return proposals; // Return current proposals if already loaded
        
        setLoadingAll(true);
        try {
            const selectedSns = getSnsById(selectedSnsRoot);
            if (!selectedSns) {
                setError('Selected SNS not found');
                return proposals;
            }

            const snsGovActor = createSnsGovernanceActor(selectedSns.canisters.governance, {
                agentOptions: {
                    identity,
                },
            });

            let allProposals = [...proposals]; // Start with existing proposals
            let hasMore = hasMoreProposals;
            let currentLastProposalId = lastProposalId;
            let pageCount = 0;

            while (hasMore && pageCount < 100) { // Safety limit of 100 pages
                pageCount++;
                
                const listProposalsArg = {
                    limit: 100, // Use larger batch size for efficiency
                    before_proposal: currentLastProposalId ? [{ id: BigInt(currentLastProposalId) }] : [],
                    include_reward_status: [],
                    exclude_type: [],
                    include_status: [],
                    include_topics: []
                };

                const response = await snsGovActor.list_proposals(listProposalsArg);
                
                if (response.proposals.length === 0) {
                    hasMore = false;
                } else {
                    // Add new proposals, avoiding duplicates
                    const newProposals = response.proposals.filter(newProp => 
                        !allProposals.some(existingProp => 
                            existingProp.id[0]?.id?.toString() === newProp.id[0]?.id?.toString()
                        )
                    );
                    
                    allProposals = [...allProposals, ...newProposals];
                    
                    // Update last proposal ID for next iteration
                    if (response.proposals.length > 0) {
                        const lastProposal = response.proposals[response.proposals.length - 1];
                        currentLastProposalId = lastProposal.id[0].id.toString();
                    }
                    
                    // If we got less than requested, we've reached the end
                    if (response.proposals.length < 100) {
                        hasMore = false;
                    }
                }
            }

            // Update state with all loaded proposals
            setProposals(allProposals);
            setHasMoreProposals(false);
            setAllProposalsLoaded(true);
            setLastProposalId(currentLastProposalId);
            
            // Wait a moment for React state updates to complete
            await new Promise(resolve => setTimeout(resolve, 50));
            
            // Return the loaded proposals array directly
            return allProposals;
            
        } catch (err) {
            console.error('Error loading all proposals:', err);
            setError('Failed to load all proposals: ' + err.message);
            return proposals; // Return current proposals on error
        } finally {
            setLoadingAll(false);
        }
    };

    // getProposalStatus is now imported from ProposalUtils
    // It correctly handles executed proposals that are still accepting votes

    // Helper function to convert HTML breaks to Markdown
    const convertHtmlToMarkdown = (text) => {
        if (!text) return '';
        return text.replace(/<br>/g, '\n\n');
    };

    // Add toggle function for summaries
    const toggleSummary = (proposalId) => {
        setExpandedSummaries(prev => {
            const newSet = new Set(prev);
            if (newSet.has(proposalId)) {
                newSet.delete(proposalId);
            } else {
                newSet.add(proposalId);
            }
            return newSet;
        });
    };

    // CSV export function for proposals
    const exportProposalsToCSV = async () => {
        let proposalsToExport;
        
        try {
            // Auto-load all proposals before export if not already loaded
            let allProposals = proposals;
            if (!allProposalsLoaded && hasMoreProposals) {
                console.log('Auto-loading all proposals before CSV export...');
                allProposals = await loadAllProposals();
                console.log(`All proposals loaded (${allProposals.length}), proceeding with export...`);
            }
            
            // Apply filtering logic directly to get current proposals for export
            proposalsToExport = allProposals;

            // Apply proposer filter
            if (proposerFilter.trim()) {
                const filterLower = proposerFilter.toLowerCase();
                proposalsToExport = proposalsToExport.filter(proposal => {
                    const neuronIdHex = uint8ArrayToHex(proposal.proposer?.[0]?.id);
                    if (!neuronIdHex) return false;

                    // Check if neuron ID contains the filter
                    if (neuronIdHex.toLowerCase().includes(filterLower)) {
                        return true;
                    }

                    // Check names and nicknames
                    const mapKey = `${selectedSnsRoot}:${neuronIdHex}`;
                    const name = neuronNames.get(mapKey)?.toLowerCase();
                    const nickname = neuronNicknames.get(mapKey)?.toLowerCase();

                    return (name && name.includes(filterLower)) || 
                           (nickname && nickname.includes(filterLower));
                });
            }

            // Apply topic filter
            if (topicFilter.trim()) {
                proposalsToExport = proposalsToExport.filter(proposal => {
                    const actionType = getProposalActionType(proposal);
                    return actionType === topicFilter;
                });
            }
            
            if (proposalsToExport.length === 0) {
                alert('No proposals to export');
                return;
            }
            
            console.log(`Exporting ${proposalsToExport.length} proposals out of ${allProposals.length} total loaded`);
            
        } catch (error) {
            console.error('Error during CSV export preparation:', error);
            alert('Failed to prepare proposals for export: ' + error.message);
            return;
        }

        // Define CSV headers
        const headers = [
            'Proposal ID',
            'Title',
            'Topic',
            'Action Type',
            'Status',
            'Proposer Neuron ID',
            'Proposer Name',
            'Proposer Nickname',
            'Created At',
            'Decided At',
            'Executed At',
            'Failed At',
            'Initial Voting Period (hours)',
            'Treasury Transfer Amount',
            'Treasury Transfer Amount (E8s)',
            'Treasury Transfer Token Type',
            'Treasury Transfer Target',
            'Treasury Transfer Target Name',
            'Treasury Transfer Target Nickname',
            'Treasury Transfer Memo',
            'Summary',
            'Raw Payload',
            'NNS URL',
            'Dashboard URL'
        ];

        // Convert proposals to CSV rows
        const csvRows = proposalsToExport.map(proposal => {
            const proposalId = proposal.id[0]?.id?.toString() || '';
            const title = proposal.proposal?.[0]?.title || '';
            const topic = getProposalTopic(proposal);
            const actionType = getProposalActionType(proposal);
            const status = getProposalStatus(proposal);
            
            // Get proposer info
            const proposerNeuronId = proposal.proposer?.[0]?.id ? uint8ArrayToHex(proposal.proposer[0].id) : '';
            const proposerDisplayInfo = proposerNeuronId ? getNeuronDisplayInfo(proposal.proposer[0].id) : { name: '', nickname: '', isVerified: false };
            
            // Get timestamps
            const createdAt = proposal.proposal_creation_timestamp_seconds 
                ? new Date(Number(proposal.proposal_creation_timestamp_seconds) * 1000).toISOString()
                : '';
            const decidedAt = proposal.decided_timestamp_seconds 
                ? new Date(Number(proposal.decided_timestamp_seconds) * 1000).toISOString()
                : '';
            const executedAt = proposal.executed_timestamp_seconds 
                ? new Date(Number(proposal.executed_timestamp_seconds) * 1000).toISOString()
                : '';
            const failedAt = proposal.failed_timestamp_seconds 
                ? new Date(Number(proposal.failed_timestamp_seconds) * 1000).toISOString()
                : '';

            // Convert voting period from seconds to hours
            const votingPeriodHours = proposal.initial_voting_period_seconds 
                ? (Number(proposal.initial_voting_period_seconds) / 3600).toFixed(2)
                : '';

            // Parse treasury transfer details
            const treasuryDetails = parseTreasuryTransferDetails(proposal);

            // Get treasury target principal display info
            let treasuryTargetName = '';
            let treasuryTargetNickname = '';
            if (treasuryDetails.targetPrincipal) {
                // Look up principal name and nickname (not neuron-specific, just principal)
                const principalName = principalNames.get(treasuryDetails.targetPrincipal);
                const principalNickname = principalNicknames.get(treasuryDetails.targetPrincipal);
                treasuryTargetName = principalName || '';
                treasuryTargetNickname = principalNickname || '';
            }

            // Get summary (clean up HTML/Markdown)
            const summary = proposal.proposal?.[0]?.summary || '';
            const cleanSummary = convertHtmlToMarkdown(summary).replace(/\n+/g, ' ').trim();

            // Extract raw payload
            const rawPayload = extractRawPayload(proposal);

            // Generate URLs
            const nnsUrl = `https://nns.ic0.app/proposal/?u=${selectedSnsRoot}&proposal=${proposalId}`;
            const dashboardUrl = `https://dashboard.internetcomputer.org/sns/${selectedSnsRoot}/proposal/${proposalId}`;

            return [
                proposalId,
                title,
                topic,
                actionType,
                status,
                proposerNeuronId,
                proposerDisplayInfo.name || '',
                proposerDisplayInfo.nickname || '',
                createdAt,
                decidedAt,
                executedAt,
                failedAt,
                votingPeriodHours,
                treasuryDetails.amount,
                treasuryDetails.amountE8s,
                treasuryDetails.tokenType,
                treasuryDetails.targetPrincipal,
                treasuryTargetName,
                treasuryTargetNickname,
                treasuryDetails.memo,
                cleanSummary,
                rawPayload,
                nnsUrl,
                dashboardUrl
            ];
        });

        // Create CSV content
        const csvContent = [
            headers.join(','),
            ...csvRows.map(row => 
                row.map(cell => {
                    // Escape cells that contain commas, quotes, or newlines
                    const cellStr = String(cell);
                    if (cellStr.includes(',') || cellStr.includes('"') || cellStr.includes('\n')) {
                        return `"${cellStr.replace(/"/g, '""')}"`;
                    }
                    return cellStr;
                }).join(',')
            )
        ].join('\n');

        // Create and download file
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        
        // Create filename with timestamp and filter info
        const timestamp = new Date().toISOString().slice(0, 19).replace(/[:.]/g, '-');
        const proposerSuffix = proposerFilter ? '_proposer-filtered' : '';
        const topicSuffix = topicFilter ? `_${topicFilter}` : '';
        const filename = `proposals_${selectedSnsRoot}_${timestamp}${proposerSuffix}${topicSuffix}.csv`;
        
        link.setAttribute('download', filename);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    };

    // Get status color and icon
    const getStatusStyle = (status) => {
        const statusLower = status.toLowerCase();
        if (statusLower.includes('executed') || statusLower.includes('adopted')) {
            return { color: theme.colors.success, bg: `${theme.colors.success}20`, icon: <FaCheck size={10} /> };
        }
        if (statusLower.includes('rejected') || statusLower.includes('failed')) {
            return { color: theme.colors.error, bg: `${theme.colors.error}20`, icon: <FaTimes size={10} /> };
        }
        if (statusLower.includes('open') || statusLower.includes('voting')) {
            return { color: proposalAccent, bg: `${proposalAccent}20`, icon: <FaClock size={10} /> };
        }
        return { color: theme.colors.mutedText, bg: theme.colors.tertiaryBg, icon: null };
    };

    // Loading state
    if (loading && proposals.length === 0) {
        return (
            <div className='page-container'>
                <style>{customStyles}</style>
                <Header showSnsDropdown={true} onSnsChange={handleSnsChange} />
                <main style={{
                    background: theme.colors.primaryGradient,
            minHeight: '100vh',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                }}>
                    <div style={{
            textAlign: 'center',
            color: theme.colors.mutedText
                    }}>
                        <div className="proposals-pulse" style={{
                            width: '60px',
                            height: '60px',
                            borderRadius: '50%',
                            background: `linear-gradient(135deg, ${proposalPrimary}, ${proposalSecondary})`,
                            margin: '0 auto 1rem',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center'
                        }}>
                            <FaGavel size={28} color="white" />
                        </div>
                        <p style={{ fontSize: '1.1rem' }}>Loading proposals...</p>
                    </div>
                </main>
            </div>
        );
    }

    return (
        <div className='page-container'>
            <style>{customStyles}</style>
            <Header showSnsDropdown={true} onSnsChange={handleSnsChange} />
            
            <main style={{
                background: theme.colors.primaryGradient,
                minHeight: '100vh'
            }}>
                {/* Hero Section */}
                <div style={{
                    background: `linear-gradient(135deg, ${theme.colors.primaryBg} 0%, ${proposalPrimary}15 50%, ${proposalSecondary}10 100%)`,
                    borderBottom: `1px solid ${theme.colors.border}`,
                    padding: '2.5rem 1.5rem',
                    position: 'relative',
                    overflow: 'hidden',
                    width: '100%',
                    boxSizing: 'border-box'
                }}>
                    {/* Background decoration */}
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
                        position: 'absolute',
                        bottom: '-30%',
                        left: '-5%',
                        width: '300px',
                        height: '300px',
                        background: `radial-gradient(circle, ${proposalSecondary}15 0%, transparent 70%)`,
                        borderRadius: '50%',
                        pointerEvents: 'none'
                    }} />
                    
                    <div style={{
                        maxWidth: '900px',
                        margin: '0 auto',
                        position: 'relative',
                        zIndex: 1
                    }}>
                        {/* SNS Logo and Title */}
                    <div style={{ 
                        display: 'flex', 
                        alignItems: 'center', 
                            gap: '1.25rem',
                            marginBottom: '1.25rem'
                        }}>
                            {loadingLogo ? (
                                <div style={{
                                    width: '64px',
                                    height: '64px',
                                    borderRadius: '50%',
                                    background: theme.colors.tertiaryBg,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center'
                                }}>
                                    <span className="proposals-pulse" style={{ color: theme.colors.mutedText }}>...</span>
                                </div>
                            ) : snsLogo ? (
                                <img
                                    src={snsLogo}
                                    alt={snsInfo?.name || 'SNS Logo'}
                                    style={{
                                        width: '64px',
                                        height: '64px',
                                        borderRadius: '50%',
                                        objectFit: 'cover',
                                        border: `3px solid ${proposalPrimary}40`,
                                        boxShadow: `0 4px 20px ${proposalPrimary}30`
                                    }}
                                />
                            ) : (
                                <div style={{
                                    width: '64px',
                                    height: '64px',
                                    borderRadius: '50%',
                                    background: `linear-gradient(135deg, ${proposalPrimary}, ${proposalSecondary})`,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center'
                                }}>
                                    <FaGavel size={28} color="white" />
                                </div>
                            )}
                            
                            <div style={{ flex: 1 }}>
                                <h1 style={{
                                    color: theme.colors.primaryText,
                                    fontSize: '2rem',
                                    fontWeight: '700',
                                    margin: 0,
                                    lineHeight: '1.2'
                                }}>
                                    {snsInfo?.name ? `${snsInfo.name} Proposals` : 'Governance Proposals'}
                                </h1>
                                <p style={{
                                    color: theme.colors.secondaryText,
                                    fontSize: '1rem',
                                    margin: '0.35rem 0 0 0'
                                }}>
                                    Review and vote on governance proposals • <a 
                                    href="https://ic-toolkit.app" 
                                    target="_blank" 
                                    rel="noopener noreferrer"
                                        style={{ color: proposalPrimary, textDecoration: 'none' }}
                                >
                                        Create proposal →
                                </a>
                            </p>
                        </div>
                        </div>
                        
                        {/* Quick Stats */}
                        <div style={{
                            display: 'flex',
                            gap: '1.5rem',
                            flexWrap: 'wrap',
                            alignItems: 'center'
                        }}>
                            <div style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                gap: '0.5rem',
                                color: theme.colors.secondaryText,
                                fontSize: '0.9rem'
                            }}>
                                <FaLayerGroup size={14} style={{ color: proposalPrimary }} />
                                <span>{proposals.length} proposal{proposals.length !== 1 ? 's' : ''} loaded</span>
                            </div>
                            {filteredProposals.filter(p => isProposalAcceptingVotes(p)).length > 0 && (
                                <div style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '0.5rem',
                                    color: proposalAccent,
                                    background: `${proposalAccent}15`,
                                    padding: '0.4rem 0.75rem',
                                    borderRadius: '20px',
                                    fontSize: '0.85rem',
                                    fontWeight: '500'
                                }}>
                                    <FaVoteYea size={14} />
                                    <span>{filteredProposals.filter(p => isProposalAcceptingVotes(p)).length} open for voting</span>
                        </div>
                            )}
                    </div>
                    </div>
                </div>

                {/* Main Content */}
                <div style={{
                    maxWidth: '900px',
                    margin: '0 auto',
                    padding: '1.5rem'
                }}>
                    {/* Controls Section */}
                    <div style={{
                        background: theme.colors.secondaryBg,
                        borderRadius: '16px',
                        border: `1px solid ${theme.colors.border}`,
                        padding: '1.25rem',
                        marginBottom: '1.5rem'
                    }}>
                        {/* Filters Row */}
                    <div style={{ 
                        display: 'flex', 
                            gap: '0.75rem',
                            marginBottom: '1rem',
                        flexWrap: 'wrap'
                    }}>
                            {/* Search Input */}
                            <div style={{
                                flex: '1 1 250px',
                                position: 'relative'
                            }}>
                                <FaSearch size={14} style={{
                                    position: 'absolute',
                                    left: '12px',
                                    top: '50%',
                                    transform: 'translateY(-50%)',
                                    color: theme.colors.mutedText
                                }} />
                        <input
                            type="text"
                            value={proposerFilter}
                            onChange={(e) => setProposerFilter(e.target.value)}
                                    placeholder="Filter by proposer..."
                            style={{
                                        width: '100%',
                                        padding: '0.65rem 0.75rem 0.65rem 2.25rem',
                                        borderRadius: '10px',
                                        border: `1px solid ${theme.colors.border}`,
                                        background: theme.colors.primaryBg,
                                        color: theme.colors.primaryText,
                                        fontSize: '0.9rem',
                                        outline: 'none',
                                        transition: 'border-color 0.2s ease',
                                        boxSizing: 'border-box'
                                    }}
                                />
                            </div>
                            
                            {/* Topic Filter */}
                            <div style={{
                                flex: '0 0 auto',
                                position: 'relative'
                            }}>
                                <FaFilter size={12} style={{
                                    position: 'absolute',
                                    left: '12px',
                                    top: '50%',
                                    transform: 'translateY(-50%)',
                                    color: theme.colors.mutedText
                                }} />
                        <select
                            value={topicFilter}
                            onChange={(e) => setTopicFilter(e.target.value)}
                            style={{
                                        padding: '0.65rem 2rem 0.65rem 2rem',
                                        borderRadius: '10px',
                                        border: `1px solid ${theme.colors.border}`,
                                        background: theme.colors.primaryBg,
                                        color: theme.colors.primaryText,
                                        fontSize: '0.9rem',
                                        outline: 'none',
                                        cursor: 'pointer',
                                        appearance: 'none'
                            }}
                        >
                            {topicOptions.map(option => (
                                <option key={option.value} value={option.value}>
                                    {option.label}
                                </option>
                            ))}
                        </select>
                                <FaChevronDown size={10} style={{
                                    position: 'absolute',
                                    right: '12px',
                                    top: '50%',
                                    transform: 'translateY(-50%)',
                                    color: theme.colors.mutedText,
                                    pointerEvents: 'none'
                                }} />
                    </div>
                </div>

                        {/* Actions Row */}
                        <div style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            flexWrap: 'wrap',
                            gap: '0.75rem'
                        }}>
                            {/* Left side - Action buttons */}
                            <div style={{
                                display: 'flex',
                                gap: '0.5rem',
                                flexWrap: 'wrap'
                            }}>
                                <button
                                    onClick={loadAllProposals}
                                    disabled={loadingAll || allProposalsLoaded}
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '0.5rem',
                                        padding: '0.5rem 1rem',
                                        borderRadius: '8px',
                                        border: `1px solid ${allProposalsLoaded ? theme.colors.success : theme.colors.border}`,
                                        background: allProposalsLoaded ? `${theme.colors.success}15` : 'transparent',
                                        color: allProposalsLoaded ? theme.colors.success : theme.colors.primaryText,
                                        fontSize: '0.85rem',
                                        fontWeight: '500',
                                        cursor: (loadingAll || allProposalsLoaded) ? 'not-allowed' : 'pointer',
                                        opacity: loadingAll ? 0.7 : 1,
                                        transition: 'all 0.2s ease'
                                    }}
                                >
                                    {allProposalsLoaded ? <FaCheck size={12} /> : loadingAll ? (
                                        <span style={{ display: 'inline-block', animation: 'spin 1s linear infinite' }}>⟳</span>
                                    ) : (
                                        <FaLayerGroup size={12} />
                                    )}
                                    {loadingAll ? 'Loading...' : allProposalsLoaded ? 'All Loaded' : 'Load All'}
                                </button>
                                
                                <button
                                    onClick={exportProposalsToCSV}
                                    disabled={loading || loadingAll || proposals.length === 0}
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '0.5rem',
                                        padding: '0.5rem 1rem',
                                        borderRadius: '8px',
                                        border: 'none',
                                        background: `linear-gradient(135deg, ${proposalPrimary}, ${proposalSecondary})`,
                                        color: 'white',
                                        fontSize: '0.85rem',
                                        fontWeight: '500',
                                        cursor: (loading || loadingAll || proposals.length === 0) ? 'not-allowed' : 'pointer',
                                        opacity: (loading || loadingAll || proposals.length === 0) ? 0.6 : 1,
                                        transition: 'all 0.2s ease'
                                    }}
                                >
                                    <FaDownload size={12} />
                                    Export CSV
                                </button>
                            </div>
                            
                            {/* Right side - Items per page */}
                            <div style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.5rem',
                                fontSize: '0.85rem',
                                color: theme.colors.secondaryText
                            }}>
                                <span>Show</span>
                                <select
                                    value={itemsPerPage}
                                    onChange={handleItemsPerPageChange}
                                    style={{
                                        padding: '0.35rem 0.5rem',
                                        borderRadius: '6px',
                                        border: `1px solid ${theme.colors.border}`,
                                        background: theme.colors.primaryBg,
                                        color: theme.colors.primaryText,
                                        fontSize: '0.85rem',
                                        outline: 'none',
                                        cursor: 'pointer'
                                    }}
                                >
                                    <option value={10}>10</option>
                                    <option value={20}>20</option>
                                    <option value={50}>50</option>
                                    <option value={100}>100</option>
                                </select>
                                <span>per page</span>
                            </div>
                        </div>
                        
                        {/* Filter info */}
                {(proposerFilter.trim() || topicFilter.trim()) && (
                            <div style={{
                                marginTop: '1rem',
                                padding: '0.75rem 1rem',
                                background: `${proposalPrimary}10`,
                                borderRadius: '8px',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                flexWrap: 'wrap',
                                gap: '0.5rem'
                            }}>
                                <span style={{ color: theme.colors.secondaryText, fontSize: '0.9rem' }}>
                                    Showing <strong style={{ color: proposalPrimary }}>{filteredProposals.length}</strong> of {proposals.length} proposals
                                    {proposerFilter.trim() && <span> matching "{proposerFilter}"</span>}
                                    {topicFilter.trim() && <span> in {topicOptions.find(opt => opt.value === topicFilter)?.label || topicFilter}</span>}
                                </span>
                        <button 
                            onClick={() => {
                                setProposerFilter('');
                                setTopicFilter('');
                            }}
                            style={{
                                        background: 'transparent',
                                        border: `1px solid ${theme.colors.border}`,
                                        color: theme.colors.secondaryText,
                                        padding: '0.25rem 0.75rem',
                                        borderRadius: '6px',
                                        fontSize: '0.8rem',
                                        cursor: 'pointer',
                                        transition: 'all 0.2s ease'
                                    }}
                                >
                                    Clear Filters
                        </button>
                    </div>
                )}
                    </div>

                    {/* Error Message */}
                    {error && (
                        <div style={{
                            background: `${theme.colors.error}15`,
                            border: `1px solid ${theme.colors.error}40`,
                            borderRadius: '12px',
                            padding: '1rem 1.25rem',
                            marginBottom: '1.5rem',
                            color: theme.colors.error
                        }}>
                            {error}
                    </div>
                    )}

                    {/* Proposals List */}
                    <div style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '1rem'
                    }}>
                        {filteredProposals.map((proposal, index) => {
                            const proposalId = proposal.id[0]?.id?.toString();
                            const status = getProposalStatus(proposal);
                            const statusStyle = getStatusStyle(status);
                            const isHovered = hoveredCard === proposalId;
                            const isExpanded = expandedSummaries.has(proposalId);
                            const acceptingVotes = isProposalAcceptingVotes(proposal);
                            const actionType = getProposalActionType(proposal);
                            const topicOption = topicOptions.find(opt => opt.value === actionType);
                            
                            return (
                                <div
                                    key={proposalId}
                                    className="proposals-card-animate"
                                    style={{
                                        background: theme.colors.secondaryBg,
                                        borderRadius: '16px',
                                        border: `1px solid ${isHovered ? proposalPrimary : theme.colors.border}`,
                                        overflow: 'hidden',
                                        transition: 'all 0.3s ease',
                                        transform: isHovered ? 'translateY(-2px)' : 'translateY(0)',
                                        boxShadow: isHovered 
                                            ? `0 8px 30px ${proposalPrimary}20`
                                            : '0 2px 10px rgba(0,0,0,0.08)',
                                        animationDelay: `${index * 0.05}s`,
                                        opacity: 0
                                    }}
                                    onMouseEnter={() => setHoveredCard(proposalId)}
                                    onMouseLeave={() => setHoveredCard(null)}
                                >
                                    {/* Card Header */}
                                            <div style={{ 
                                        padding: '1.25rem 1.5rem',
                                        borderBottom: `1px solid ${theme.colors.border}`,
                                        background: acceptingVotes 
                                            ? `linear-gradient(135deg, ${proposalAccent}08 0%, transparent 100%)`
                                            : 'transparent'
                                    }}>
                                        {/* Top Row: ID, Status, Time */}
                                        <div style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '0.75rem',
                                            marginBottom: '0.75rem',
                                            flexWrap: 'wrap'
                                        }}>
                                            <span style={{
                                                color: proposalPrimary,
                                                fontWeight: '600',
                                                fontSize: '0.9rem'
                                            }}>
                                                {formatProposalIdLink(proposalId, selectedSnsRoot)}
                                            </span>
                                            
                                            <span style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '4px',
                                                padding: '3px 10px',
                                                borderRadius: '20px',
                                                background: statusStyle.bg,
                                                color: statusStyle.color,
                                                fontSize: '0.8rem',
                                                fontWeight: '500'
                                            }}>
                                                {statusStyle.icon}
                                                {status}
                                            </span>
                                            
                                            {acceptingVotes && (
                                                <span style={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '4px',
                                                    padding: '3px 10px',
                                                    borderRadius: '20px',
                                                    background: `${proposalAccent}15`,
                                                    color: proposalAccent,
                                                    fontSize: '0.8rem',
                                                    fontWeight: '500'
                                                }}>
                                                    <FaClock size={10} />
                                                    {getVotingTimeRemaining(proposal)}
                                                </span>
                                            )}
                                            
                                            <span style={{
                                                padding: '3px 10px',
                                                borderRadius: '20px',
                                                background: theme.colors.tertiaryBg,
                                                color: theme.colors.secondaryText,
                                                fontSize: '0.75rem'
                                            }}>
                                                {topicOption ? topicOption.label : actionType}
                                            </span>
                                    </div>
                                    
                                        {/* Title */}
                                        <Link 
                                            to={`/proposal?proposalid=${proposalId}&sns=${selectedSnsRoot}`}
                                            style={{
                                                color: theme.colors.primaryText,
                                                textDecoration: 'none',
                                                fontSize: '1.15rem',
                                                fontWeight: '600',
                                                lineHeight: '1.4',
                                                display: 'block',
                                                marginBottom: '0.75rem',
                                                transition: 'color 0.2s ease'
                                            }}
                                        >
                                            {proposal.proposal[0]?.title || 'Untitled Proposal'}
                                        </Link>
                                        
                                        {/* Proposer */}
                                        <div style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '0.5rem',
                                            fontSize: '0.85rem',
                                            color: theme.colors.secondaryText
                                        }}>
                                            <span>Proposed by:</span>
                                            {proposal.proposer?.[0]?.id ? 
                                                formatNeuronDisplayWithContext(
                                                    proposal.proposer[0].id, 
                                                    selectedSnsRoot, 
                                                    getNeuronDisplayInfo(proposal.proposer[0].id),
                                                    { 
                                                        onNicknameUpdate: handleNicknameUpdate,
                                                        isAuthenticated: isAuthenticated
                                                    }
                                                ) : 
                                                <span style={{ color: theme.colors.mutedText }}>Unknown</span>
                                            }
                                        </div>
                                    </div>
                                    
                                    {/* Treasury Transfer Details */}
                                    {actionType === 'TransferSnsTreasuryFunds' && (() => {
                                        const treasuryDetails = parseTreasuryTransferDetails(proposal);
                                        if (treasuryDetails.amount || treasuryDetails.targetPrincipal) {
                                            return (
                                                <div style={{ 
                                                    padding: '1rem 1.5rem',
                                                    borderBottom: `1px solid ${theme.colors.border}`,
                                                    background: `linear-gradient(135deg, #f59e0b10 0%, transparent 100%)`
                                                }}>
                                                    <div style={{ 
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: '0.5rem',
                                                        marginBottom: '0.75rem',
                                                        color: '#f59e0b',
                                                        fontSize: '0.9rem',
                                                        fontWeight: '600'
                                                    }}>
                                                        💰 Treasury Transfer
                                                    </div>
                                                    <div style={{
                                                        display: 'flex',
                                                        flexDirection: 'column',
                                                        gap: '0.5rem',
                                                        fontSize: '0.9rem'
                                                    }}>
                                                    {treasuryDetails.amount && (
                                                            <div style={{ color: theme.colors.primaryText }}>
                                                                <strong style={{ color: '#f59e0b' }}>
                                                                    {treasuryDetails.amount} {treasuryDetails.tokenType}
                                                                </strong>
                                                                <span style={{ color: theme.colors.mutedText, marginLeft: '0.5rem' }}>
                                                                    ({treasuryDetails.amountE8s} e8s)
                                                                </span>
                                                        </div>
                                                    )}
                                                    {treasuryDetails.targetPrincipal && (
                                                            <div style={{ 
                                                                display: 'flex', 
                                                                alignItems: 'center', 
                                                                gap: '0.5rem',
                                                                color: theme.colors.secondaryText
                                                            }}>
                                                            <span>To:</span>
                                                            <div onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
                                                                <PrincipalDisplay
                                                                    principal={treasuryDetails.targetPrincipal}
                                                                    displayInfo={getPrincipalDisplayInfoFromContext(
                                                                        treasuryDetails.targetPrincipal,
                                                                        principalNames,
                                                                        principalNicknames
                                                                    )}
                                                                    showCopyButton={true}
                                                                    short={false}
                                                                    enableContextMenu={true}
                                                                    isAuthenticated={isAuthenticated}
                                                                />
                                                            </div>
                                                        </div>
                                                    )}
                                                        </div>
                                                </div>
                                            );
                                        }
                                        return null;
                                    })()}
                                    
                                    {/* Summary Toggle */}
                                    <div 
                                        onClick={() => toggleSummary(proposalId)}
                                        style={{
                                            padding: '0.75rem 1.5rem',
                                            borderBottom: isExpanded ? `1px solid ${theme.colors.border}` : 'none',
                                            cursor: 'pointer',
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '0.5rem',
                                            color: theme.colors.secondaryText,
                                            fontSize: '0.9rem',
                                            transition: 'background 0.2s ease',
                                            background: isExpanded ? theme.colors.tertiaryBg : 'transparent'
                                        }}
                                    >
                                        <FaChevronRight 
                                            size={12} 
                                            style={{
                                                transition: 'transform 0.3s ease',
                                                transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)'
                                            }}
                                        />
                                        <span>Summary</span>
                                    </div>
                                    
                                    {/* Summary Content */}
                                    {isExpanded && (
                                    <div style={{ 
                                            padding: '1rem 1.5rem',
                                            borderBottom: `1px solid ${theme.colors.border}`,
                                            background: theme.colors.primaryBg,
                                            color: theme.colors.secondaryText,
                                            fontSize: '0.9rem',
                                            lineHeight: '1.6',
                                            maxHeight: '400px',
                                            overflow: 'auto'
                                        }}>
                                            <ReactMarkdown>
                                                {convertHtmlToMarkdown(proposal.proposal[0]?.summary || 'No summary available')}
                                            </ReactMarkdown>
                                        </div>
                                    )}
                                    
                                    {/* Card Footer */}
                                    <div style={{
                                        padding: '1rem 1.5rem',
                                        display: 'flex', 
                                        justifyContent: 'space-between',
                                        alignItems: 'center',
                                        flexWrap: 'wrap',
                                        gap: '0.75rem'
                                    }}>
                                        {/* Left: Meta info */}
                                        <div style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '1rem',
                                            fontSize: '0.8rem',
                                            color: theme.colors.mutedText
                                        }}>
                                            <span title={getFullDate(BigInt(Number(proposal.proposal_creation_timestamp_seconds) * 1_000_000_000))}>
                                                Created {getRelativeTime(BigInt(Number(proposal.proposal_creation_timestamp_seconds) * 1_000_000_000))}
                                            </span>
                                            <span>
                                                {Math.floor(Number(proposal.initial_voting_period_seconds) / (24 * 60 * 60))} day voting
                                            </span>
                                        </div>
                                        
                                        {/* Right: Actions */}
                                        <div style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '0.5rem',
                                            flexWrap: 'wrap'
                                        }}>
                                            {/* External Links */}
                                            <a 
                                                href={`https://nns.ic0.app/proposal/?u=${selectedSnsRoot}&proposal=${proposalId}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                                style={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '4px',
                                                    padding: '0.4rem 0.75rem',
                                                    borderRadius: '6px',
                                                    background: theme.colors.tertiaryBg,
                                                    color: theme.colors.secondaryText,
                                                    textDecoration: 'none',
                                                    fontSize: '0.8rem',
                                                    transition: 'all 0.2s ease'
                                                }}
                                            >
                                                NNS <FaExternalLinkAlt size={10} />
                                        </a>
                                        <a 
                                                href={`https://dashboard.internetcomputer.org/sns/${selectedSnsRoot}/proposal/${proposalId}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                                style={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '4px',
                                                    padding: '0.4rem 0.75rem',
                                                    borderRadius: '6px',
                                                    background: theme.colors.tertiaryBg,
                                                    color: theme.colors.secondaryText,
                                                    textDecoration: 'none',
                                                    fontSize: '0.8rem',
                                                    transition: 'all 0.2s ease'
                                                }}
                                            >
                                                Dashboard <FaExternalLinkAlt size={10} />
                                        </a>
                                        <a 
                                                href={`https://ic-toolkit.app/sns-management/${selectedSnsRoot}/proposals/view/${proposalId}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                                style={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '4px',
                                                    padding: '0.4rem 0.75rem',
                                                    borderRadius: '6px',
                                                    background: theme.colors.tertiaryBg,
                                                    color: theme.colors.secondaryText,
                                                    textDecoration: 'none',
                                                    fontSize: '0.8rem',
                                                    transition: 'all 0.2s ease'
                                                }}
                                            >
                                                Toolkit <FaExternalLinkAlt size={10} />
                                        </a>
                                        
                                        {/* Quick Vote Buttons */}
                                            {isAuthenticated && acceptingVotes && (() => {
                                            const eligibility = proposalEligibility[proposalId];
                                            const votingState = quickVotingStates[proposalId];
                                            const isLoading = eligibility?.loading !== false;
                                            const eligibleCount = eligibility?.eligibleCount || 0;
                                            const totalVP = eligibility?.totalVP || 0;
                                            const isEnabled = !isLoading && eligibleCount > 0;
                                            
                                            const getButtonStyle = (isAdopt) => {
                                                const baseStyle = {
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                        gap: '4px',
                                                        padding: '0.4rem 0.75rem',
                                                        borderRadius: '6px',
                                                        fontSize: '0.8rem',
                                                        fontWeight: '500',
                                                        border: 'none',
                                                        cursor: isEnabled ? 'pointer' : 'default',
                                                        transition: 'all 0.2s ease'
                                                };
                                                
                                                if (votingState === 'voting') {
                                                    return {
                                                        ...baseStyle,
                                                            backgroundColor: theme.colors.tertiaryBg,
                                                            color: theme.colors.mutedText
                                                    };
                                                }
                                                
                                                if (votingState === 'success') {
                                                    return {
                                                        ...baseStyle,
                                                            backgroundColor: `${theme.colors.success}20`,
                                                        color: theme.colors.success
                                                    };
                                                }
                                                
                                                if (votingState === 'error') {
                                                    return {
                                                        ...baseStyle,
                                                            backgroundColor: `${theme.colors.error}20`,
                                                        color: theme.colors.error
                                                    };
                                                }
                                                
                                                if (!isEnabled) {
                                                    return {
                                                        ...baseStyle,
                                                            backgroundColor: theme.colors.tertiaryBg,
                                                            color: theme.colors.mutedText,
                                                            opacity: 0.5
                                                    };
                                                }
                                                
                                                return {
                                                    ...baseStyle,
                                                    backgroundColor: isAdopt 
                                                            ? `${theme.colors.success}15` 
                                                            : `${theme.colors.error}15`,
                                                    color: isAdopt ? theme.colors.success : theme.colors.error
                                                };
                                            };
                                            
                                            return (
                                                <>
                                                    <div style={{ 
                                                        width: '1px', 
                                                        height: '20px', 
                                                        backgroundColor: theme.colors.border,
                                                            margin: '0 0.25rem'
                                                    }} />
                                                    
                                                    <button
                                                        onClick={() => isEnabled && quickVote(proposal, 1)}
                                                        disabled={!isEnabled || votingState === 'voting'}
                                                        style={getButtonStyle(true)}
                                                        title={isLoading ? 'Checking eligibility...' : 
                                                               eligibleCount > 0 ? `Adopt with ${eligibleCount} neuron${eligibleCount !== 1 ? 's' : ''} (${formatCompactVP(totalVP)} VP)` :
                                                               'No eligible neurons'}
                                                    >
                                                            <FaCheck size={10} />
                                                            {isEnabled && <span>({formatCompactVP(totalVP)})</span>}
                                                    </button>
                                                    
                                                    <button
                                                        onClick={() => isEnabled && quickVote(proposal, 2)}
                                                        disabled={!isEnabled || votingState === 'voting'}
                                                        style={getButtonStyle(false)}
                                                        title={isLoading ? 'Checking eligibility...' : 
                                                               eligibleCount > 0 ? `Reject with ${eligibleCount} neuron${eligibleCount !== 1 ? 's' : ''} (${formatCompactVP(totalVP)} VP)` :
                                                               'No eligible neurons'}
                                                    >
                                                            <FaTimes size={10} />
                                                            {isEnabled && <span>({formatCompactVP(totalVP)})</span>}
                                                    </button>
                                                </>
                                            );
                                        })()}
                                    </div>
                                </div>
                                </div>
                            );
                        })}
                                    </div>

                    {/* Load More / All Loaded */}
                    {filteredProposals.length > 0 && (
                        <div style={{
                            textAlign: 'center',
                            marginTop: '2rem',
                            padding: '1rem'
                        }}>
                            {hasMoreProposals && !allProposalsLoaded ? (
                                <button
                                    onClick={loadMore}
                                    disabled={loading || loadingAll}
                                    style={{
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: '0.5rem',
                                        padding: '0.75rem 2rem',
                                        borderRadius: '12px',
                                        border: 'none',
                                        background: `linear-gradient(135deg, ${proposalPrimary}, ${proposalSecondary})`,
                                        color: 'white',
                                        fontSize: '0.95rem',
                                        fontWeight: '600',
                                        cursor: (loading || loadingAll) ? 'not-allowed' : 'pointer',
                                        opacity: (loading || loadingAll) ? 0.7 : 1,
                                        transition: 'all 0.3s ease',
                                        boxShadow: `0 4px 15px ${proposalPrimary}40`
                                    }}
                                >
                                    {(loading || loadingAll) ? (
                                        <>
                                            <span style={{ display: 'inline-block', animation: 'spin 1s linear infinite' }}>⟳</span>
                                            Loading...
                                        </>
                                    ) : (
                                        <>
                                            <FaChevronDown size={14} />
                                            Load More Proposals
                                        </>
                                    )}
                                </button>
                            ) : (
                                <div style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    gap: '0.5rem',
                                    color: theme.colors.success,
                                    fontSize: '0.95rem',
                                    fontWeight: '500'
                                }}>
                                    <FaCheck size={14} />
                                    All {proposals.length} proposals loaded
                            </div>
                        )}
                            </div>
                        )}
                    
                    {/* Empty State */}
                    {filteredProposals.length === 0 && !loading && (
                        <div style={{
                            textAlign: 'center',
                            padding: '4rem 2rem',
                            background: theme.colors.secondaryBg,
                            borderRadius: '16px',
                            border: `1px solid ${theme.colors.border}`
                        }}>
                            <div style={{
                                width: '70px',
                                height: '70px',
                                borderRadius: '50%',
                                background: `linear-gradient(135deg, ${proposalPrimary}30, ${proposalSecondary}20)`,
                                margin: '0 auto 1.5rem',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                color: proposalPrimary
                            }}>
                                <FaGavel size={30} />
                            </div>
                            <h3 style={{
                                color: theme.colors.primaryText,
                                fontSize: '1.25rem',
                                fontWeight: '600',
                                marginBottom: '0.5rem'
                            }}>
                                No proposals found
                            </h3>
                            <p style={{
                                color: theme.colors.secondaryText,
                                fontSize: '0.95rem'
                            }}>
                                {proposerFilter || topicFilter 
                                    ? 'Try adjusting your filters to see more results.'
                                    : 'There are no proposals for this SNS yet.'}
                            </p>
                    </div>
                )}
                </div>
            </main>
        </div>
    );
}

export default Proposals; 
