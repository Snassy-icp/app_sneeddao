import React, { useState, useEffect } from 'react';
import { useNavigate, Link, useSearchParams, useLocation } from 'react-router-dom';
import { createActor as createSnsGovernanceActor } from 'external/sns_governance';
import { useAuth } from '../AuthContext';
import { useSns } from '../contexts/SnsContext';
import Header from '../components/Header';
import ReactMarkdown from 'react-markdown';
import { getSnsById } from '../utils/SnsUtils';
import { useOptimizedSnsLoading } from '../hooks/useOptimizedSnsLoading';
import { formatProposalIdLink, formatNeuronDisplayWithContext, uint8ArrayToHex } from '../utils/NeuronUtils';
import { PrincipalDisplay, getPrincipalDisplayInfoFromContext } from '../utils/PrincipalUtils';
import { useNaming } from '../NamingContext';
import { useTheme } from '../contexts/ThemeContext';

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

    // Add state to track expanded summaries
    const [expandedSummaries, setExpandedSummaries] = useState(new Set());

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

            // Determine token type - simplified to just "SNS" or "ICP"
            const fromTreasury = transferAction.from_treasury;
            if (fromTreasury === 'Icp' || (typeof fromTreasury === 'object' && 'Icp' in fromTreasury)) {
                tokenType = 'ICP';
            } else if (fromTreasury === 'SnsToken' || (typeof fromTreasury === 'object' && 'SnsToken' in fromTreasury)) {
                tokenType = 'SNS';
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

            // Extract target principal
            const targetPrincipal = transferAction.to_principal?.toString() || 
                                   transferAction.to?.toString() || 
                                   transferAction.target?.toString() || 
                                   '';

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

    // Fetch proposals when SNS changes or pagination changes
    useEffect(() => {
        if (selectedSnsRoot) {
            fetchProposals();
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

    const getProposalStatus = (data) => {
        try {
            const now = BigInt(Math.floor(Date.now() / 1000));
            const executed = BigInt(data.executed_timestamp_seconds || 0);
            const failed = BigInt(data.failed_timestamp_seconds || 0);
            const decided = BigInt(data.decided_timestamp_seconds || 0);
            const created = BigInt(data.proposal_creation_timestamp_seconds || 0);
            const votingPeriod = BigInt(data.initial_voting_period_seconds || 0);
            
            if (executed > 0n) return 'Executed';
            if (failed > 0n) return 'Failed';
            if (decided > 0n) return 'Decided';
            if (created + votingPeriod > now) {
                return 'Open for Voting';
            }
            return 'Unknown';
        } catch (err) {
            console.error('Error in getProposalStatus:', err);
            return 'Unknown';
        }
    };

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

    // Theme-aware styles
    const getStyles = (theme) => ({
        pageContainer: {
            backgroundColor: theme.colors.primaryBg,
            minHeight: '100vh'
        },
        title: {
            color: theme.colors.primaryText,
            margin: '0 0 8px 0'
        },
        subtitle: {
            color: theme.colors.mutedText,
            margin: '0',
            fontSize: '14px',
            fontStyle: 'italic'
        },
        link: {
            color: theme.colors.accent,
            textDecoration: 'none'
        },
        label: {
            color: theme.colors.primaryText,
            fontSize: '14px'
        },
        select: {
            backgroundColor: theme.colors.secondaryBg,
            color: theme.colors.primaryText,
            border: `1px solid ${theme.colors.border}`,
            borderRadius: '4px',
            padding: '4px 8px'
        },
        input: {
            backgroundColor: theme.colors.secondaryBg,
            color: theme.colors.primaryText,
            border: `1px solid ${theme.colors.border}`,
            borderRadius: '4px',
            padding: '8px 12px'
        },
        error: {
            color: theme.colors.error,
            marginBottom: '20px'
        },
        filterInfo: {
            color: theme.colors.accent,
            marginBottom: '15px',
            fontSize: '14px',
            backgroundColor: theme.colors.secondaryBg,
            padding: '10px',
            borderRadius: '4px'
        },
        clearButton: {
            backgroundColor: 'transparent',
            border: `1px solid ${theme.colors.accent}`,
            color: theme.colors.accent,
            borderRadius: '3px',
            padding: '2px 6px',
            cursor: 'pointer'
        },
        loading: {
            color: theme.colors.primaryText,
            textAlign: 'center',
            padding: '20px'
        },
        proposalCard: {
            backgroundColor: theme.colors.secondaryBg,
            borderRadius: '8px',
            padding: '20px',
            marginBottom: '15px'
        },
        proposalTitle: {
            color: theme.colors.primaryText,
            margin: '0'
        },
        proposalLink: {
            color: theme.colors.primaryText,
            textDecoration: 'none',
            cursor: 'pointer'
        },
        status: {
            padding: '4px 8px',
            borderRadius: '4px',
            backgroundColor: theme.colors.border,
            color: theme.colors.primaryText,
            fontSize: '12px'
        },
        metaText: {
            color: theme.colors.mutedText,
            fontSize: '14px'
        },
        actionButton: {
            padding: '5px 10px',
            borderRadius: '4px',
            backgroundColor: theme.colors.accent,
            color: theme.colors.primaryText,
            textDecoration: 'none',
            fontSize: '14px'
        },
        summaryToggle: {
            backgroundColor: theme.colors.border,
            borderRadius: '6px',
            padding: '10px',
            color: theme.colors.mutedText
        }
    });

    return (
        <div className='page-container' style={getStyles(theme).pageContainer}>
            <Header showSnsDropdown={true} onSnsChange={handleSnsChange} />
            <main className="wallet-container">
                <div style={{ marginBottom: '20px' }}>
                    <div style={{ 
                        display: 'flex', 
                        justifyContent: 'space-between', 
                        alignItems: 'center', 
                        marginBottom: '15px',
                        flexWrap: 'wrap',
                        gap: '15px'
                    }}>
                        <div>
                            <h1 style={getStyles(theme).title}>Proposals</h1>
                            <p style={getStyles(theme).subtitle}>
                                Want to create a proposal? Sneed DAO recommends{' '}
                                <a 
                                    href="https://ic-toolkit.app" 
                                    target="_blank" 
                                    rel="noopener noreferrer"
                                    style={getStyles(theme).link}
                                    onMouseEnter={(e) => e.target.style.textDecoration = 'underline'}
                                    onMouseLeave={(e) => e.target.style.textDecoration = 'none'}
                                >
                                    ic-toolkit.app
                                </a>
                            </p>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                            <button
                                onClick={loadAllProposals}
                                style={{
                                    backgroundColor: allProposalsLoaded ? theme.colors.success : theme.colors.tertiaryBg,
                                    color: theme.colors.primaryText,
                                    border: `1px solid ${theme.colors.border}`,
                                    borderRadius: '4px',
                                    padding: '8px 12px',
                                    cursor: (loadingAll || allProposalsLoaded) ? 'not-allowed' : 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '6px',
                                    opacity: (loadingAll || allProposalsLoaded) ? 0.7 : 1
                                }}
                                disabled={loadingAll || allProposalsLoaded}
                                title={allProposalsLoaded ? 'All proposals loaded' : 'Load all proposals at once'}
                            >
                                <span style={{ 
                                    fontSize: '14px',
                                    display: 'inline-block',
                                    transform: loadingAll ? 'rotate(360deg)' : 'none',
                                    transition: 'transform 1s linear'
                                }}>
                                    {allProposalsLoaded ? '✓' : loadingAll ? '⟳' : '⬇'}
                                </span>
                                {loadingAll ? 'Loading All...' : allProposalsLoaded ? 'All Loaded' : 'Load All'}
                            </button>
                            <button
                                onClick={exportProposalsToCSV}
                                style={{
                                    backgroundColor: theme.colors.accent,
                                    color: theme.colors.primaryText,
                                    border: 'none',
                                    borderRadius: '4px',
                                    padding: '8px 12px',
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '6px'
                                }}
                                disabled={loading || loadingAll || proposals.length === 0}
                                title={`Export proposals to CSV${!allProposalsLoaded && hasMoreProposals ? ' (will auto-load all first)' : ''}`}
                            >
                                <span style={{ fontSize: '14px' }}>📄</span>
                                Export CSV
                            </button>
                            <label style={getStyles(theme).label}>Items per page:</label>
                            <select
                                value={itemsPerPage}
                                onChange={handleItemsPerPageChange}
                                style={getStyles(theme).select}
                            >
                                <option value={10}>10</option>
                                <option value={20}>20</option>
                                <option value={50}>50</option>
                                <option value={100}>100</option>
                            </select>
                        </div>
                    </div>
                    <div style={{ 
                        display: 'flex', 
                        alignItems: 'center', 
                        gap: '15px',
                        flexWrap: 'wrap'
                    }}>
                        <input
                            type="text"
                            value={proposerFilter}
                            onChange={(e) => setProposerFilter(e.target.value)}
                            placeholder="Filter by proposer (name, nickname, or neuron ID)..."
                            style={{
                                ...getStyles(theme).input,
                                flex: '1 1 250px',
                                minWidth: '200px'
                            }}
                        />
                        <select
                            value={topicFilter}
                            onChange={(e) => setTopicFilter(e.target.value)}
                            style={{
                                ...getStyles(theme).select,
                                padding: '8px 12px',
                                minWidth: '180px'
                            }}
                        >
                            {topicOptions.map(option => (
                                <option key={option.value} value={option.value}>
                                    {option.label}
                                </option>
                            ))}
                        </select>
                    </div>
                </div>

                {error && <div style={getStyles(theme).error}>{error}</div>}

                {(proposerFilter.trim() || topicFilter.trim()) && (
                    <div style={getStyles(theme).filterInfo}>
                        Showing {filteredProposals.length} of {proposals.length} proposals
                        {proposerFilter.trim() && (
                            <span> matching proposer: "{proposerFilter}"</span>
                        )}
                        {topicFilter.trim() && (
                            <span> with topic: "{topicOptions.find(opt => opt.value === topicFilter)?.label || topicFilter}"</span>
                        )}
                        <button 
                            onClick={() => {
                                setProposerFilter('');
                                setTopicFilter('');
                            }}
                            style={{
                                marginLeft: '10px',
                                ...getStyles(theme).clearButton,
                                fontSize: '12px'
                            }}
                        >
                            Clear All
                        </button>
                    </div>
                )}

                {loading && proposals.length === 0 ? (
                    <div style={getStyles(theme).loading}>
                        Loading...
                    </div>
                ) : (
                    <div>
                        {filteredProposals.map((proposal, index) => (
                            <div
                                key={index}
                                style={getStyles(theme).proposalCard}
                            >
                                <div style={{ marginBottom: '15px' }}>
                                    {/* Title and Status Row - Full Width */}
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '5px', flexWrap: 'wrap' }}>
                                        <h3 style={getStyles(theme).proposalTitle}>
                                            {formatProposalIdLink(proposal.id[0].id.toString(), selectedSnsRoot)}
                                        </h3>
                                        <div style={getStyles(theme).status}>
                                            {getProposalStatus(proposal)}
                                        </div>
                                    </div>
                                    
                                    {/* Proposal Title - Full Width */}
                                    <h4 style={{ ...getStyles(theme).proposalTitle, margin: '0 0 8px 0', lineHeight: '1.3' }}>
                                        <Link 
                                            to={`/proposal?proposalid=${proposal.id[0].id.toString()}&sns=${selectedSnsRoot}`}
                                            style={getStyles(theme).proposalLink}
                                            onMouseEnter={(e) => e.target.style.textDecoration = 'underline'}
                                            onMouseLeave={(e) => e.target.style.textDecoration = 'none'}
                                        >
                                            {proposal.proposal[0]?.title || 'No title'}
                                        </Link>
                                    </h4>
                                    
                                    {/* Topic and Proposer - Full Width */}
                                    <div style={{ marginBottom: '10px' }}>
                                        <div style={{ ...getStyles(theme).metaText, marginBottom: '4px' }}>
                                            Topic: {(() => {
                                                const actionType = getProposalActionType(proposal);
                                                const topicOption = topicOptions.find(opt => opt.value === actionType);
                                                return topicOption ? topicOption.label : actionType;
                                            })()}
                                        </div>
                                        <div style={{ ...getStyles(theme).metaText, display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
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
                                    
                                    {/* Treasury Transfer Details - Only for treasury proposals */}
                                    {getProposalActionType(proposal) === 'TransferSnsTreasuryFunds' && (() => {
                                        const treasuryDetails = parseTreasuryTransferDetails(proposal);
                                        if (treasuryDetails.amount || treasuryDetails.targetPrincipal) {
                                            return (
                                                <div style={{ 
                                                    marginBottom: '10px', 
                                                    padding: '10px', 
                                                    backgroundColor: theme.colors.tertiaryBg, 
                                                    borderRadius: '6px',
                                                    border: `1px solid ${theme.colors.border}`
                                                }}>
                                                    <div style={{ ...getStyles(theme).metaText, marginBottom: '6px', fontWeight: 'bold' }}>
                                                        💰 Treasury Transfer Details:
                                                    </div>
                                                    {treasuryDetails.amount && (
                                                        <div style={{ ...getStyles(theme).metaText, marginBottom: '4px' }}>
                                                            <span style={{ color: theme.colors.accent, fontWeight: 'bold' }}>
                                                                {treasuryDetails.amount} {treasuryDetails.tokenType}
                                                            </span>
                                                            {treasuryDetails.amountE8s && (
                                                                <span style={{ color: theme.colors.mutedText, marginLeft: '8px' }}>
                                                                    ({treasuryDetails.amountE8s} e8s)
                                                                </span>
                                                            )}
                                                        </div>
                                                    )}
                                                    {treasuryDetails.targetPrincipal && (
                                                        <div style={{ ...getStyles(theme).metaText, display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                                            <span>To:</span>
                                                            <PrincipalDisplay
                                                                principalId={treasuryDetails.targetPrincipal}
                                                                displayInfo={getPrincipalDisplayInfoFromContext(
                                                                    treasuryDetails.targetPrincipal,
                                                                    principalNames,
                                                                    principalNicknames,
                                                                    verifiedNames
                                                                )}
                                                                showCopyButton={true}
                                                                enableContextMenu={true}
                                                                isAuthenticated={isAuthenticated}
                                                            />
                                                        </div>
                                                    )}
                                                    {treasuryDetails.memo && treasuryDetails.memo !== '0' && (
                                                        <div style={{ ...getStyles(theme).metaText, marginTop: '4px' }}>
                                                            Memo: <span style={{ color: theme.colors.mutedText }}>{treasuryDetails.memo}</span>
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        }
                                        return null;
                                    })()}
                                    
                                    {/* External Links - Responsive Row */}
                                    <div style={{ 
                                        display: 'flex', 
                                        gap: '8px', 
                                        flexWrap: 'wrap',
                                        alignItems: 'center'
                                    }}>
                                        <a 
                                            href={`https://nns.ic0.app/proposal/?u=${selectedSnsRoot}&proposal=${proposal.id[0].id.toString()}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            style={getStyles(theme).actionButton}
                                        >
                                            NNS
                                        </a>
                                        <a 
                                            href={`https://dashboard.internetcomputer.org/sns/${selectedSnsRoot}/proposal/${proposal.id[0].id.toString()}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            style={getStyles(theme).actionButton}
                                        >
                                            Dashboard
                                        </a>
                                        <a 
                                            href={`https://ic-toolkit.app/sns-management/${selectedSnsRoot}/proposals/view/${proposal.id[0].id.toString()}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            style={getStyles(theme).actionButton}
                                        >
                                            Toolkit
                                        </a>
                                    </div>
                                </div>
                                <div 
                                    onClick={() => toggleSummary(proposal.id[0].id.toString())}
                                    style={{
                                        cursor: 'pointer',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '10px',
                                        ...getStyles(theme).summaryToggle,
                                        marginBottom: expandedSummaries.has(proposal.id[0].id.toString()) ? '10px' : '0'
                                    }}
                                >
                                    <span style={{ 
                                        transform: expandedSummaries.has(proposal.id[0].id.toString()) ? 'rotate(90deg)' : 'none',
                                        transition: 'transform 0.3s ease',
                                        display: 'inline-block'
                                    }}>▶</span>
                                    <span>Summary</span>
                                </div>
                                {expandedSummaries.has(proposal.id[0].id.toString()) && (
                                    <div style={{ 
                                        backgroundColor: theme.colors.border, 
                                        padding: '15px', 
                                        borderRadius: '6px',
                                        color: theme.colors.mutedText, 
                                        margin: '0 0 10px 0'
                                    }}>
                                        <ReactMarkdown>
                                            {convertHtmlToMarkdown(proposal.proposal[0]?.summary || 'No summary')}
                                        </ReactMarkdown>
                                    </div>
                                )}
                                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#666', fontSize: '14px' }}>
                                    <span>Created: {new Date(Number(proposal.proposal_creation_timestamp_seconds) * 1000).toLocaleString()}</span>
                                    <span>Voting Period: {Math.floor(Number(proposal.initial_voting_period_seconds) / (24 * 60 * 60))} days</span>
                                </div>
                            </div>
                        ))}

                        {hasMoreProposals && !allProposalsLoaded && (
                            <div style={{ textAlign: 'center', marginTop: '20px' }}>
                                <button
                                    onClick={loadMore}
                                    disabled={loading || loadingAll}
                                    style={{
                                        backgroundColor: '#3498db',
                                        color: '#ffffff',
                                        border: 'none',
                                        borderRadius: '4px',
                                        padding: '10px 20px',
                                        cursor: (loading || loadingAll) ? 'not-allowed' : 'pointer',
                                        opacity: (loading || loadingAll) ? 0.7 : 1
                                    }}
                                >
                                    {(loading || loadingAll) ? 'Loading...' : 'Load More'}
                                </button>
                            </div>
                        )}
                        
                        {allProposalsLoaded && (
                            <div style={{ textAlign: 'center', marginTop: '20px', color: theme.colors.success }}>
                                ✓ All proposals loaded ({proposals.length} total)
                            </div>
                        )}
                    </div>
                )}
            </main>
        </div>
    );
}

export default Proposals; 