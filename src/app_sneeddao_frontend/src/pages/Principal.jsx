import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../AuthContext';
import { useSns } from '../contexts/SnsContext';
import { useSearchParams, Link } from 'react-router-dom';
import Header from '../components/Header';
import { getPrincipalName, setPrincipalName, setPrincipalNickname, getPrincipalNickname } from '../utils/BackendUtils';
import { Principal } from '@dfinity/principal';
import { PrincipalDisplay, getPrincipalColor, getPrincipalDisplayInfo } from '../utils/PrincipalUtils';
import ConfirmationModal from '../ConfirmationModal';
import { fetchPrincipalNeuronsForSns, getOwnerPrincipals, formatNeuronIdLink } from '../utils/NeuronUtils';
import { createActor as createIcrc1Actor } from 'external/icrc1_ledger';
import { getSnsById, fetchAndCacheSnsData } from '../utils/SnsUtils';
import { formatE8s, getDissolveState, uint8ArrayToHex } from '../utils/NeuronUtils';
import { HttpAgent } from '@dfinity/agent';
import TransactionList from '../components/TransactionList';
import { useNaming } from '../NamingContext';

const validateNameInput = (input) => {
    if (!input.trim()) return 'Name cannot be empty';
    if (input.length > 32) return 'Name cannot be longer than 32 characters';
    // Only allow letters, numbers, spaces, hyphens, underscores, dots, and apostrophes
    const validPattern = /^[a-zA-Z0-9\s\-_.']+$/;
    if (!validPattern.test(input)) {
        return 'Name can only contain letters, numbers, spaces, hyphens (-), underscores (_), dots (.), and apostrophes (\')';
    }
    return '';
};

const spinKeyframes = `
@keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
}
`;

export default function PrincipalPage() {
    const { identity } = useAuth();
    const { selectedSnsRoot, SNEED_SNS_ROOT } = useSns();
    const { principalNames, principalNicknames } = useNaming();
    const [searchParams, setSearchParams] = useSearchParams();
    const [principalInfo, setPrincipalInfo] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [editingName, setEditingName] = useState(false);
    const [editingNickname, setEditingNickname] = useState(false);
    const [nameInput, setNameInput] = useState('');
    const [nicknameInput, setNicknameInput] = useState('');
    const [inputError, setInputError] = useState('');
    const [nicknameError, setNicknameError] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isSubmittingNickname, setIsSubmittingNickname] = useState(false);
    const [showConfirmModal, setShowConfirmModal] = useState(false);
    const [confirmAction, setConfirmAction] = useState(null);
    const [confirmMessage, setConfirmMessage] = useState('');
    const [neurons, setNeurons] = useState([]);
    const [loadingNeurons, setLoadingNeurons] = useState(false);
    const [neuronError, setNeuronError] = useState(null);
    const [tokenSymbol, setTokenSymbol] = useState('SNS');
    const [principalDisplayInfo, setPrincipalDisplayInfo] = useState(new Map());
    const [isNeuronsCollapsed, setIsNeuronsCollapsed] = useState(true);
    const [isTransactionsCollapsed, setIsTransactionsCollapsed] = useState(true);
    
    // Add search state
    const [searchInput, setSearchInput] = useState('');
    const [searchLoading, setSearchLoading] = useState(false);
    const [searchResults, setSearchResults] = useState([]);
    const [showSearchResults, setShowSearchResults] = useState(false);
    
    // Keep stable references to dependencies
    const stableIdentity = useRef(identity);
    const stablePrincipalId = useRef(null);
    const searchContainerRef = useRef(null);

    const principalParam = searchParams.get('id');
    try {
        stablePrincipalId.current = principalParam ? Principal.fromText(principalParam) : null;
    } catch (e) {
        console.error('Invalid principal ID:', e);
    }

    // Initialize search input from URL parameter
    useEffect(() => {
        if (principalParam) {
            setSearchInput(principalParam);
        }
    }, [principalParam]);

    // Add click outside handler for search results
    useEffect(() => {
        const handleClickOutside = (event) => {
            if (searchContainerRef.current && !searchContainerRef.current.contains(event.target)) {
                setShowSearchResults(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // Search function that can search by principal ID, name, or nickname
    const searchPrincipals = async (query) => {
        if (!query.trim()) {
            setSearchResults([]);
            setShowSearchResults(false);
            return;
        }

        setSearchLoading(true);
        try {
            const queryLower = query.toLowerCase().trim();
            const results = [];

            // First, try to parse as a principal ID for direct match
            let directPrincipalMatch = null;
            try {
                const principal = Principal.fromText(query.trim());
                directPrincipalMatch = {
                    principal: principal.toString(),
                    type: 'direct',
                    displayText: principal.toString(),
                    score: queryLower === principal.toString().toLowerCase() ? 100 : 50
                };
            } catch (e) {
                // Not a valid principal ID, continue with name/nickname search
            }

            // Search through cached principal names
            for (const [principalId, name] of principalNames.entries()) {
                if (name.toLowerCase().includes(queryLower)) {
                    const score = name.toLowerCase() === queryLower ? 95 : 
                                 name.toLowerCase().startsWith(queryLower) ? 90 : 70;
                    
                    results.push({
                        principal: principalId,
                        type: 'name',
                        name: name,
                        displayText: `${name} (${principalId.substring(0, 8)}...)`,
                        score: score
                    });
                }
            }

            // Search through cached principal nicknames (only for logged-in user)
            if (identity) {
                for (const [principalId, nickname] of principalNicknames.entries()) {
                    if (nickname.toLowerCase().includes(queryLower)) {
                        // Check if we already have this principal from name search
                        const existingIndex = results.findIndex(r => r.principal === principalId);
                        
                        if (existingIndex >= 0) {
                            // Add nickname info to existing result
                            results[existingIndex].nickname = nickname;
                            results[existingIndex].displayText = `${results[existingIndex].name || nickname} (${principalId.substring(0, 8)}...)`;
                            // Boost score if nickname matches better
                            const nicknameScore = nickname.toLowerCase() === queryLower ? 95 : 
                                                nickname.toLowerCase().startsWith(queryLower) ? 90 : 70;
                            results[existingIndex].score = Math.max(results[existingIndex].score, nicknameScore);
                        } else {
                            const score = nickname.toLowerCase() === queryLower ? 95 : 
                                         nickname.toLowerCase().startsWith(queryLower) ? 90 : 70;
                            
                            results.push({
                                principal: principalId,
                                type: 'nickname',
                                nickname: nickname,
                                displayText: `${nickname} (${principalId.substring(0, 8)}...)`,
                                score: score
                            });
                        }
                    }
                }
            }

            // Add direct principal match if it's not already in results and is valid
            if (directPrincipalMatch) {
                const existingIndex = results.findIndex(r => r.principal === directPrincipalMatch.principal);
                if (existingIndex === -1) {
                    // Try to get name/nickname for the direct match
                    const name = principalNames.get(directPrincipalMatch.principal);
                    const nickname = identity ? principalNicknames.get(directPrincipalMatch.principal) : null;
                    
                    if (name || nickname) {
                        directPrincipalMatch.name = name;
                        directPrincipalMatch.nickname = nickname;
                        directPrincipalMatch.displayText = `${name || nickname} (${directPrincipalMatch.principal.substring(0, 8)}...)`;
                    }
                    
                    results.push(directPrincipalMatch);
                }
            }

            // Sort results by score (highest first) and limit to top 10
            const sortedResults = results
                .sort((a, b) => b.score - a.score)
                .slice(0, 10);
            
            setSearchResults(sortedResults);
            setShowSearchResults(sortedResults.length > 0);
        } catch (err) {
            console.error('Error searching principals:', err);
            setSearchResults([]);
            setShowSearchResults(false);
        } finally {
            setSearchLoading(false);
        }
    };

    // Handle search input changes with debouncing
    useEffect(() => {
        const timeoutId = setTimeout(() => {
            if (searchInput.trim() && searchInput !== principalParam) {
                searchPrincipals(searchInput);
            } else if (!searchInput.trim()) {
                setSearchResults([]);
                setShowSearchResults(false);
            }
        }, 300);

        return () => clearTimeout(timeoutId);
    }, [searchInput, principalParam, identity]);

    // Handle search result selection
    const handleSearchResultSelect = (result) => {
        setSearchParams({ id: result.principal });
        setSearchInput(result.principal);
        setShowSearchResults(false);
    };

    // Handle search form submission
    const handleSearchSubmit = (e) => {
        e.preventDefault();
        if (searchInput.trim()) {
            try {
                // Validate principal ID
                Principal.fromText(searchInput.trim());
                setSearchParams({ id: searchInput.trim() });
                setShowSearchResults(false);
            } catch (err) {
                setError('Invalid principal ID format');
            }
        }
    };

    // Update stable refs when values change
    useEffect(() => {
        stableIdentity.current = identity;
    }, [identity]);

    // Fetch initial principal info
    useEffect(() => {
        const fetchInitialPrincipalInfo = async () => {
            if (!stablePrincipalId.current) {
                setLoading(false);
                return;
            }

            try {
                // Always fetch public name, even when not logged in
                const nameResponse = await getPrincipalName(null, stablePrincipalId.current);
                console.log("NAME RESPONSE", nameResponse, stablePrincipalId.current);
                // Only fetch nickname if user is logged in
                let nicknameResponse = null;
                if (identity) {
                    nicknameResponse = await getPrincipalNickname(identity, stablePrincipalId.current);
                }

                setPrincipalInfo({
                    name: nameResponse ? nameResponse[0] : null,
                    isVerified: nameResponse ? nameResponse[1] : false,
                    nickname: nicknameResponse ? nicknameResponse[0] : null
                });
            } catch (err) {
                console.error('Error fetching principal info:', err);
                setError('Failed to load principal information');
            } finally {
                setLoading(false);
            }
        };

        fetchInitialPrincipalInfo();
    }, [identity, principalParam]);

    // Load neurons when dependencies change
    useEffect(() => {
        let mounted = true;
        let currentFetchKey = null;

        const fetchNeurons = async () => {
            const currentSnsRoot = searchParams.get('sns') || selectedSnsRoot || SNEED_SNS_ROOT;
            const currentPrincipalId = stablePrincipalId.current;

            if (!currentSnsRoot || !currentPrincipalId) {
                if (mounted) {
                    setLoadingNeurons(false);
                    setNeurons([]);
                }
                return;
            }

            const fetchKey = `${currentSnsRoot}-${currentPrincipalId.toString()}`;
            if (fetchKey === currentFetchKey) {
                return;
            }
            currentFetchKey = fetchKey;

            if (mounted) {
                setLoadingNeurons(true);
                setNeuronError(null);
            }

            try {
                const selectedSns = getSnsById(currentSnsRoot);
                if (!selectedSns) {
                    throw new Error('Selected SNS not found');
                }

                const neuronsList = await fetchPrincipalNeuronsForSns(null, selectedSns.canisters.governance, currentPrincipalId.toString());
                const relevantNeurons = neuronsList.filter(neuron => 
                    neuron.permissions.some(p => 
                        p.principal?.toString() === currentPrincipalId.toString()
                    )
                );

                if (mounted) {
                    setNeurons(relevantNeurons);

                    // Get token symbol - we can do this anonymously
                    const icrc1Actor = createIcrc1Actor(selectedSns.canisters.ledger, {
                        agentOptions: { agent: new HttpAgent() }
                    });
                    const metadata = await icrc1Actor.icrc1_metadata();
                    const symbolEntry = metadata.find(entry => entry[0] === 'icrc1:symbol');
                    if (symbolEntry && symbolEntry[1]) {
                        setTokenSymbol(symbolEntry[1].Text);
                    }
                }
            } catch (err) {
                console.error('Error fetching neurons:', err);
                if (mounted) {
                    setNeuronError('Failed to load neurons');
                }
            } finally {
                if (mounted) {
                    setLoadingNeurons(false);
                }
            }
        };

        fetchNeurons();
        return () => { mounted = false; };
    }, [identity, searchParams, principalParam, selectedSnsRoot, SNEED_SNS_ROOT]);

    // Add effect to fetch principal display info
    useEffect(() => {
        const fetchPrincipalInfo = async () => {
            if (neurons.length === 0) return;

            const uniquePrincipals = new Set();
            neurons.forEach(neuron => {
                // Add owner principals
                getOwnerPrincipals(neuron).forEach(p => uniquePrincipals.add(p));
                // Add all principals with permissions
                neuron.permissions.forEach(p => {
                    if (p.principal) uniquePrincipals.add(p.principal.toString());
                });
            });

            const displayInfoMap = new Map();
            await Promise.all(Array.from(uniquePrincipals).map(async principal => {
                const displayInfo = await getPrincipalDisplayInfo(identity, Principal.fromText(principal));
                displayInfoMap.set(principal, displayInfo);
            }));

            setPrincipalDisplayInfo(displayInfoMap);
        };

        fetchPrincipalInfo();
    }, [identity, neurons]);

    // Add effect to auto-expand neurons section if there are neurons
    useEffect(() => {
        if (neurons.length > 0) {
            setIsNeuronsCollapsed(false);  // Auto-expand if neurons exist
        }
    }, [neurons]);

    const handleNameSubmit = async () => {
        const error = validateNameInput(nameInput);
        if (error) {
            setInputError(error);
            return;
        }

        if (!nameInput.trim()) return;

        // Show confirmation dialog
        setConfirmAction(() => async () => {
            setIsSubmitting(true);
            try {
                const response = await setPrincipalName(identity, nameInput);
                if ('ok' in response) {
                    const newInfo = await getPrincipalName(identity, stablePrincipalId.current);
                    setPrincipalInfo(prev => ({
                        ...prev,
                        name: newInfo ? newInfo[0] : null,
                        isVerified: newInfo ? newInfo[1] : false
                    }));
                    setInputError('');
                } else {
                    setError(response.err);
                }
            } catch (err) {
                console.error('Error setting principal name:', err);
                setError('Failed to set principal name');
            } finally {
                setIsSubmitting(false);
                setEditingName(false);
                setNameInput('');
            }
        });
        setConfirmMessage(
            "You are about to set a public name for this principal. Please note:\n\n" +
            "• This name will be visible to everyone\n" +
            "• Only set a name if you want to help others identify you\n" +
            "• Inappropriate names can result in a user ban\n\n" +
            "Are you sure you want to proceed?"
        );
        setShowConfirmModal(true);
    };

    const handleNicknameSubmit = async () => {
        const error = validateNameInput(nicknameInput);
        if (error) {
            setNicknameError(error);
            return;
        }

        if (!nicknameInput.trim()) return;

        setIsSubmittingNickname(true);
        try {
            const response = await setPrincipalNickname(identity, stablePrincipalId.current, nicknameInput);
            if ('ok' in response) {
                // Fetch the updated nickname to ensure consistency
                const nicknameResponse = await getPrincipalNickname(identity, stablePrincipalId.current);
                setPrincipalInfo(prev => ({
                    ...prev,
                    nickname: nicknameResponse ? nicknameResponse[0] : null
                }));
                setNicknameError('');
            } else {
                setError(response.err);
            }
        } catch (err) {
            console.error('Error setting principal nickname:', err);
            setError('Failed to set principal nickname');
        } finally {
            setIsSubmittingNickname(false);
            setEditingNickname(false);
            setNicknameInput('');
        }
    };

    if (!stablePrincipalId.current) {
        return (
            <div className='page-container'>
                <Header showSnsDropdown={true} />
                <main className="wallet-container">
                    {/* Search Section */}
                    <div 
                        ref={searchContainerRef}
                        style={{ 
                            backgroundColor: '#2a2a2a',
                            borderRadius: '8px',
                            padding: '20px',
                            marginBottom: '20px',
                            border: '1px solid #3a3a3a',
                            position: 'relative'
                        }}
                    >
                        <div style={{ 
                            display: 'flex', 
                            justifyContent: 'space-between', 
                            alignItems: 'center',
                            marginBottom: '15px'
                        }}>
                            <h2 style={{ 
                                color: '#ffffff',
                                margin: '0',
                                fontSize: '18px',
                                fontWeight: '500'
                            }}>
                                Search Principal
                            </h2>
                            {identity && (
                                <button
                                    onClick={() => {
                                        const myPrincipal = identity.getPrincipal().toString();
                                        setSearchParams({ id: myPrincipal });
                                        setSearchInput(myPrincipal);
                                        setShowSearchResults(false);
                                    }}
                                    style={{
                                        backgroundColor: '#27ae60',
                                        color: '#ffffff',
                                        border: 'none',
                                        borderRadius: '4px',
                                        padding: '8px 12px',
                                        cursor: 'pointer',
                                        fontSize: '14px',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '6px'
                                    }}
                                >
                                    👤 My Principal
                                </button>
                            )}
                        </div>
                        <form onSubmit={handleSearchSubmit} style={{ position: 'relative' }}>
                            <div style={{ position: 'relative' }}>
                                <input
                                    type="text"
                                    value={searchInput}
                                    onChange={(e) => setSearchInput(e.target.value)}
                                    placeholder="Enter principal ID, name, or nickname..."
                                    style={{
                                        backgroundColor: '#3a3a3a',
                                        border: '1px solid #4a4a4a',
                                        borderRadius: '4px',
                                        color: '#ffffff',
                                        padding: '12px 60px 12px 16px',
                                        width: '100%',
                                        fontSize: '14px'
                                    }}
                                />
                                <button
                                    type="submit"
                                    style={{
                                        position: 'absolute',
                                        right: '8px',
                                        top: '50%',
                                        transform: 'translateY(-50%)',
                                        backgroundColor: '#3498db',
                                        color: '#ffffff',
                                        border: 'none',
                                        borderRadius: '4px',
                                        padding: '6px 12px',
                                        cursor: 'pointer',
                                        fontSize: '12px'
                                    }}
                                >
                                    {searchLoading ? '...' : 'Go'}
                                </button>
                            </div>
                            
                            {/* Search Results Dropdown */}
                            {showSearchResults && searchResults.length > 0 && (
                                <div style={{
                                    position: 'absolute',
                                    top: '100%',
                                    left: '0',
                                    right: '0',
                                    backgroundColor: '#2a2a2a',
                                    border: '1px solid #4a4a4a',
                                    borderRadius: '4px',
                                    marginTop: '4px',
                                    maxHeight: '200px',
                                    overflowY: 'auto',
                                    zIndex: 1000,
                                    boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)'
                                }}>
                                    {searchResults.map((result, index) => (
                                        <div
                                            key={index}
                                            onClick={() => handleSearchResultSelect(result)}
                                            style={{
                                                padding: '12px 16px',
                                                cursor: 'pointer',
                                                borderBottom: index < searchResults.length - 1 ? '1px solid #3a3a3a' : 'none',
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '8px'
                                            }}
                                            onMouseEnter={(e) => {
                                                e.target.style.backgroundColor = '#3a3a3a';
                                            }}
                                            onMouseLeave={(e) => {
                                                e.target.style.backgroundColor = 'transparent';
                                            }}
                                        >
                                            <div style={{ flex: 1 }}>
                                                <div style={{ color: '#ffffff', fontSize: '14px' }}>
                                                    {result.displayText}
                                                </div>
                                                <div style={{ 
                                                    color: '#888', 
                                                    fontSize: '12px',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '4px',
                                                    marginTop: '2px'
                                                }}>
                                                    {result.type === 'name' && (
                                                        <>
                                                            <span style={{ color: '#3498db' }}>📛</span>
                                                            Public Name
                                                        </>
                                                    )}
                                                    {result.type === 'nickname' && (
                                                        <>
                                                            <span style={{ color: '#f39c12' }}>🏷️</span>
                                                            Your Nickname
                                                        </>
                                                    )}
                                                    {result.type === 'direct' && (
                                                        <>
                                                            <span style={{ color: '#95a5a6' }}>🔗</span>
                                                            Principal ID
                                                        </>
                                                    )}
                                                    {result.name && result.nickname && result.type !== 'direct' && (
                                                        <span style={{ color: '#2ecc71', marginLeft: '8px' }}>
                                                            • Has both name & nickname
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </form>
                    </div>

                    <div style={{ textAlign: 'center', padding: '40px 20px' }}>
                        <h1 style={{ color: '#ffffff', marginBottom: '20px' }}>No Principal Selected</h1>
                        <p style={{ color: '#888' }}>Use the search box above to find a principal.</p>
                    </div>
                </main>
            </div>
        );
    }

    return (
        <div className='page-container'>
            <Header showSnsDropdown={true} />
            <main className="wallet-container">
                {/* Search Section */}
                <div 
                    ref={searchContainerRef}
                    style={{ 
                        backgroundColor: '#2a2a2a',
                        borderRadius: '8px',
                        padding: '20px',
                        marginBottom: '20px',
                        border: '1px solid #3a3a3a',
                        position: 'relative'
                    }}
                >
                    <div style={{ 
                        display: 'flex', 
                        justifyContent: 'space-between', 
                        alignItems: 'center',
                        marginBottom: '15px'
                    }}>
                        <h2 style={{ 
                            color: '#ffffff',
                            margin: '0',
                            fontSize: '18px',
                            fontWeight: '500'
                        }}>
                            Search Principal
                        </h2>
                        {identity && (
                            <button
                                onClick={() => {
                                    const myPrincipal = identity.getPrincipal().toString();
                                    setSearchParams({ id: myPrincipal });
                                    setSearchInput(myPrincipal);
                                    setShowSearchResults(false);
                                }}
                                style={{
                                    backgroundColor: '#27ae60',
                                    color: '#ffffff',
                                    border: 'none',
                                    borderRadius: '4px',
                                    padding: '8px 12px',
                                    cursor: 'pointer',
                                    fontSize: '14px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '6px'
                                }}
                            >
                                👤 My Principal
                            </button>
                        )}
                    </div>
                    <form onSubmit={handleSearchSubmit} style={{ position: 'relative' }}>
                        <div style={{ position: 'relative' }}>
                            <input
                                type="text"
                                value={searchInput}
                                onChange={(e) => setSearchInput(e.target.value)}
                                placeholder="Enter principal ID, name, or nickname..."
                                style={{
                                    backgroundColor: '#3a3a3a',
                                    border: '1px solid #4a4a4a',
                                    borderRadius: '4px',
                                    color: '#ffffff',
                                    padding: '12px 60px 12px 16px',
                                    width: '100%',
                                    fontSize: '14px'
                                }}
                            />
                            <button
                                type="submit"
                                style={{
                                    position: 'absolute',
                                    right: '8px',
                                    top: '50%',
                                    transform: 'translateY(-50%)',
                                    backgroundColor: '#3498db',
                                    color: '#ffffff',
                                    border: 'none',
                                    borderRadius: '4px',
                                    padding: '6px 12px',
                                    cursor: 'pointer',
                                    fontSize: '12px'
                                }}
                            >
                                {searchLoading ? '...' : 'Go'}
                            </button>
                        </div>
                        
                        {/* Search Results Dropdown */}
                        {showSearchResults && searchResults.length > 0 && (
                            <div style={{
                                position: 'absolute',
                                top: '100%',
                                left: '0',
                                right: '0',
                                backgroundColor: '#2a2a2a',
                                border: '1px solid #4a4a4a',
                                borderRadius: '4px',
                                marginTop: '4px',
                                maxHeight: '200px',
                                overflowY: 'auto',
                                zIndex: 1000,
                                boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)'
                            }}>
                                {searchResults.map((result, index) => (
                                    <div
                                        key={index}
                                        onClick={() => handleSearchResultSelect(result)}
                                        style={{
                                            padding: '12px 16px',
                                            cursor: 'pointer',
                                            borderBottom: index < searchResults.length - 1 ? '1px solid #3a3a3a' : 'none',
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '8px'
                                        }}
                                        onMouseEnter={(e) => {
                                            e.target.style.backgroundColor = '#3a3a3a';
                                        }}
                                        onMouseLeave={(e) => {
                                            e.target.style.backgroundColor = 'transparent';
                                        }}
                                    >
                                        <div style={{ flex: 1 }}>
                                            <div style={{ color: '#ffffff', fontSize: '14px' }}>
                                                {result.displayText}
                                            </div>
                                            <div style={{ 
                                                color: '#888', 
                                                fontSize: '12px',
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '4px',
                                                marginTop: '2px'
                                            }}>
                                                {result.type === 'name' && (
                                                    <>
                                                        <span style={{ color: '#3498db' }}>📛</span>
                                                        Public Name
                                                    </>
                                                )}
                                                {result.type === 'nickname' && (
                                                    <>
                                                        <span style={{ color: '#f39c12' }}>🏷️</span>
                                                        Your Nickname
                                                    </>
                                                )}
                                                {result.type === 'direct' && (
                                                    <>
                                                        <span style={{ color: '#95a5a6' }}>🔗</span>
                                                        Principal ID
                                                    </>
                                                )}
                                                {result.name && result.nickname && result.type !== 'direct' && (
                                                    <span style={{ color: '#2ecc71', marginLeft: '8px' }}>
                                                        • Has both name & nickname
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </form>
                </div>

                {!stablePrincipalId.current ? (
                    <div style={{ textAlign: 'center', padding: '40px 20px' }}>
                        <h1 style={{ color: '#ffffff', marginBottom: '20px' }}>No Principal Selected</h1>
                        <p style={{ color: '#888' }}>Use the search box above to find a principal.</p>
                    </div>
                ) : (
                    <>
                        <div style={{ 
                            backgroundColor: '#2a2a2a',
                            borderRadius: '8px',
                            padding: '20px',
                            marginBottom: '30px',
                            border: '1px solid #3a3a3a'
                        }}>
                            {loading ? (
                                <div style={{ textAlign: 'center', padding: '20px', color: '#888' }}>
                                    Loading...
                                </div>
                            ) : error ? (
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
                            ) : (
                                <>
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
                                                Principal Details
                                            </h2>
                                            <PrincipalDisplay 
                                                principal={stablePrincipalId.current}
                                                displayInfo={{
                                                    name: principalInfo?.name,
                                                    nickname: principalInfo?.nickname,
                                                    isVerified: principalInfo?.isVerified
                                                }}
                                                style={{
                                                    fontSize: '16px'
                                                }}
                                            />
                                        </div>
                                        <div style={{ display: 'flex', gap: '8px' }}>
                                            {!editingName && !editingNickname && (
                                                <>
                                                    <button
                                                        onClick={() => setEditingNickname(true)}
                                                        style={{
                                                            backgroundColor: '#95a5a6',
                                                            color: '#ffffff',
                                                            border: 'none',
                                                            borderRadius: '4px',
                                                            padding: '8px 12px',
                                                            cursor: 'pointer'
                                                        }}
                                                    >
                                                        {principalInfo?.nickname ? 'Change Nickname' : 'Set Nickname'}
                                                    </button>
                                                    {identity?.getPrincipal().toString() === stablePrincipalId.current.toString() && (
                                                        <button
                                                            onClick={() => setEditingName(true)}
                                                            style={{
                                                                backgroundColor: '#3498db',
                                                                color: '#ffffff',
                                                                border: 'none',
                                                                borderRadius: '4px',
                                                                padding: '8px 12px',
                                                                cursor: 'pointer'
                                                            }}
                                                        >
                                                            {principalInfo?.name ? 'Change Name' : 'Set Name'}
                                                        </button>
                                                    )}
                                                </>
                                            )}
                                        </div>
                                    </div>

                                    {editingName && (
                                        <div style={{ 
                                            marginTop: '20px',
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
                                                    placeholder="Enter public name (max 32 chars)"
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
                                                    onClick={handleNameSubmit}
                                                    disabled={isSubmitting}
                                                    style={{
                                                        backgroundColor: '#3498db',
                                                        color: '#ffffff',
                                                        border: 'none',
                                                        borderRadius: '4px',
                                                        padding: '8px 12px',
                                                        cursor: isSubmitting ? 'not-allowed' : 'pointer',
                                                        opacity: isSubmitting ? 0.7 : 1,
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: '6px'
                                                    }}
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
                                                <button
                                                    onClick={() => {
                                                        setEditingName(false);
                                                        setNameInput('');
                                                        setInputError('');
                                                    }}
                                                    disabled={isSubmitting}
                                                    style={{
                                                        backgroundColor: '#e74c3c',
                                                        color: '#ffffff',
                                                        border: 'none',
                                                        borderRadius: '4px',
                                                        padding: '8px 12px',
                                                        cursor: isSubmitting ? 'not-allowed' : 'pointer',
                                                        opacity: isSubmitting ? 0.7 : 1
                                                    }}
                                                >
                                                    Cancel
                                                </button>
                                            </div>
                                        </div>
                                    )}

                                    {editingNickname && (
                                        <div style={{ 
                                            marginTop: '20px',
                                            display: 'flex',
                                            flexDirection: 'column',
                                            gap: '10px'
                                        }}>
                                            <div>
                                                <input
                                                    type="text"
                                                    value={nicknameInput}
                                                    onChange={(e) => {
                                                        const newValue = e.target.value;
                                                        setNicknameInput(newValue);
                                                        setNicknameError(validateNameInput(newValue));
                                                    }}
                                                    maxLength={32}
                                                    placeholder="Enter private nickname (max 32 chars)"
                                                    style={{
                                                        backgroundColor: '#3a3a3a',
                                                        border: `1px solid ${nicknameError ? '#e74c3c' : '#4a4a4a'}`,
                                                        borderRadius: '4px',
                                                        color: '#ffffff',
                                                        padding: '8px',
                                                        width: '100%'
                                                    }}
                                                />
                                                {nicknameError && (
                                                    <div style={{
                                                        color: '#e74c3c',
                                                        fontSize: '12px',
                                                        marginTop: '4px'
                                                    }}>
                                                        {nicknameError}
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
                                                    onClick={handleNicknameSubmit}
                                                    disabled={isSubmittingNickname}
                                                    style={{
                                                        backgroundColor: '#95a5a6',
                                                        color: '#ffffff',
                                                        border: 'none',
                                                        borderRadius: '4px',
                                                        padding: '8px 12px',
                                                        cursor: isSubmittingNickname ? 'not-allowed' : 'pointer',
                                                        opacity: isSubmittingNickname ? 0.7 : 1,
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: '6px'
                                                    }}
                                                >
                                                    {isSubmittingNickname ? (
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
                                                <button
                                                    onClick={() => {
                                                        setEditingNickname(false);
                                                        setNicknameInput('');
                                                        setNicknameError('');
                                                    }}
                                                    disabled={isSubmittingNickname}
                                                    style={{
                                                        backgroundColor: '#e74c3c',
                                                        color: '#ffffff',
                                                        border: 'none',
                                                        borderRadius: '4px',
                                                        padding: '8px 12px',
                                                        cursor: isSubmittingNickname ? 'not-allowed' : 'pointer',
                                                        opacity: isSubmittingNickname ? 0.7 : 1
                                                    }}
                                                >
                                                    Cancel
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </>
                            )}
                        </div>

                        <div style={{ 
                            backgroundColor: '#2a2a2a',
                            borderRadius: '8px',
                            padding: '20px',
                            marginBottom: '30px',
                            border: '1px solid #3a3a3a'
                        }}>
                            <div 
                                style={{ 
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '10px',
                                    cursor: 'pointer',
                                    userSelect: 'none',
                                    marginBottom: isNeuronsCollapsed ? 0 : '20px'
                                }}
                                onClick={() => setIsNeuronsCollapsed(!isNeuronsCollapsed)}
                            >
                                <span style={{
                                    fontSize: '18px',
                                    color: '#888',
                                    transition: 'transform 0.2s',
                                    transform: isNeuronsCollapsed ? 'rotate(-90deg)' : 'none'
                                }}>
                                    ▼
                                </span>
                                <h2 style={{ 
                                    color: '#ffffff',
                                    fontSize: '18px',
                                    fontWeight: '500',
                                    margin: 0
                                }}>
                                    Hotkeyed Neurons
                                </h2>
                            </div>

                            {!isNeuronsCollapsed && (
                                <>
                                    {loadingNeurons ? (
                                        <div style={{ textAlign: 'center', padding: '20px', color: '#888' }}>
                                            Loading neurons...
                                        </div>
                                    ) : neuronError ? (
                                        <div style={{ 
                                            backgroundColor: 'rgba(231, 76, 60, 0.2)', 
                                            border: '1px solid #e74c3c',
                                            color: '#e74c3c',
                                            padding: '15px',
                                            borderRadius: '6px',
                                            marginBottom: '20px'
                                        }}>
                                            {neuronError}
                                        </div>
                                    ) : neurons.length === 0 ? (
                                        <div style={{ textAlign: 'center', padding: '20px', color: '#888' }}>
                                            No neurons found where this principal is a hotkey.
                                        </div>
                                    ) : (
                                        <div style={{ 
                                            display: 'grid',
                                            gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
                                            gap: '20px'
                                        }}>
                                            {neurons.map((neuron) => {
                                                const neuronId = uint8ArrayToHex(neuron.id[0]?.id);
                                                if (!neuronId) return null;

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
                                                            <div style={{ 
                                                                display: 'flex', 
                                                                alignItems: 'flex-start',
                                                                gap: '8px',
                                                                marginBottom: '10px',
                                                                flexWrap: 'wrap'
                                                            }}>
                                                                {formatNeuronIdLink(neuronId, searchParams.get('sns') || selectedSnsRoot || SNEED_SNS_ROOT)}
                                                            </div>
                                                        </div>

                                                        <div style={{ marginBottom: '20px' }}>
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
                                                            {/* Add permissions section */}
                                                            <div style={{ gridColumn: '1 / -1' }}>
                                                                <div style={{ color: '#888', marginBottom: '8px' }}>Permissions</div>
                                                                {/* Owner */}
                                                                {getOwnerPrincipals(neuron).length > 0 && (
                                                                    <div style={{ 
                                                                        marginBottom: '8px',
                                                                        display: 'flex',
                                                                        alignItems: 'center',
                                                                        gap: '8px'
                                                                    }}>
                                                                        <span style={{ color: '#888' }}>Owner:</span>
                                                                        <PrincipalDisplay 
                                                                            principal={Principal.fromText(getOwnerPrincipals(neuron)[0])}
                                                                            displayInfo={principalDisplayInfo.get(getOwnerPrincipals(neuron)[0])}
                                                                            showCopyButton={false}
                                                                        />
                                                                    </div>
                                                                )}
                                                                {/* Hotkeys */}
                                                                {neuron.permissions
                                                                    .filter(p => !getOwnerPrincipals(neuron).includes(p.principal?.toString()))
                                                                    .map((p, index) => (
                                                                        <div key={index} style={{ 
                                                                            display: 'flex',
                                                                            alignItems: 'center',
                                                                            gap: '8px',
                                                                            marginBottom: index < neuron.permissions.length - 1 ? '8px' : 0
                                                                        }}>
                                                                            <span style={{ color: '#888', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                                                🔑 Hotkey:
                                                                            </span>
                                                                            <PrincipalDisplay 
                                                                                principal={p.principal}
                                                                                displayInfo={principalDisplayInfo.get(p.principal?.toString())}
                                                                                showCopyButton={false}
                                                                            />
                                                                        </div>
                                                                    ))
                                                                }
                                                            </div>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                </>
                            )}
                        </div>

                        {/* Wrap TransactionList with collapse state */}
                        <TransactionList 
                            snsRootCanisterId={searchParams.get('sns') || selectedSnsRoot || SNEED_SNS_ROOT}
                            principalId={stablePrincipalId.current?.toString()}
                            isCollapsed={isTransactionsCollapsed}
                            onToggleCollapse={() => setIsTransactionsCollapsed(!isTransactionsCollapsed)}
                        />
                    </>
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