import React, { useState, useEffect, useMemo } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { useSns } from '../contexts/SnsContext';
import Header from '../components/Header';
import useNeuronsCache from '../hooks/useNeuronsCache';
import { fetchAndCacheSnsData, getSnsById, fetchSnsLogo } from '../utils/SnsUtils';
import { HttpAgent } from '@dfinity/agent';
import { uint8ArrayToHex } from '../utils/NeuronUtils';
import { useNaming } from '../NamingContext';
import { PrincipalDisplay, getPrincipalDisplayInfoFromContext } from '../utils/PrincipalUtils';
import { Principal } from '@dfinity/principal';
import { FaUsers, FaSearch, FaChevronRight, FaChevronLeft, FaBrain, FaCoins, FaSync, FaFilter, FaArrowUp, FaArrowDown, FaSort, FaExternalLinkAlt, FaCheckCircle } from 'react-icons/fa';

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

@keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
}

.user-card-animate {
    animation: fadeInUp 0.5s ease-out forwards;
}

.user-card:hover {
    transform: translateY(-3px);
    box-shadow: 0 12px 40px rgba(99, 102, 241, 0.15);
}

.stat-card:hover {
    transform: translateY(-2px);
}
`;

// Accent colors
const usersPrimary = '#6366f1'; // Indigo
const usersSecondary = '#8b5cf6'; // Violet
const usersAccent = '#a78bfa'; // Light violet

function Users() {
    const { theme } = useTheme();
    const { identity } = useAuth();
    const { selectedSnsRoot, updateSelectedSns } = useSns();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    
    // SNS logo state
    const [snsLogo, setSnsLogo] = useState(null);
    const [loadingLogo, setLoadingLogo] = useState(false);
    
    // Use the shared neurons cache hook
    const {
        neurons,
        loading,
        error,
        tokenSymbol,
        totalNeuronCount,
        loadingProgress,
        refreshData,
        setError
    } = useNeuronsCache(selectedSnsRoot, identity);
    
    // Local state
    const [searchTerm, setSearchTerm] = useState('');
    const [currentPage, setCurrentPage] = useState(1);
    const [itemsPerPage, setItemsPerPage] = useState(20);
    const [sortConfig, setSortConfig] = useState({ key: 'stake', direction: 'desc' });
    const [hideUnnamed, setHideUnnamed] = useState(false);
    const [userTypeFilter, setUserTypeFilter] = useState('all'); // 'all', 'owners', 'hotkeys'
    
    // Get naming context
    const { principalNames, principalNicknames, verifiedNames } = useNaming();

    // Get SNS info for the selected SNS
    const snsInfo = useMemo(() => {
        if (!selectedSnsRoot) return null;
        return getSnsById(selectedSnsRoot);
    }, [selectedSnsRoot]);

    // Fetch SNS logo when SNS changes
    useEffect(() => {
        const loadLogo = async () => {
            if (!snsInfo) {
                setSnsLogo(null);
                return;
            }
            
            setLoadingLogo(true);
            try {
                const host = process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging' 
                    ? 'https://ic0.app' 
                    : 'http://localhost:4943';
                const agent = new HttpAgent({ host, ...(identity && { identity }) });
                if (process.env.DFX_NETWORK !== 'ic') {
                    await agent.fetchRootKey();
                }
                const logo = await fetchSnsLogo(snsInfo.canisters.governance, agent);
                setSnsLogo(logo);
            } catch (err) {
                console.error('Error loading SNS logo:', err);
                setSnsLogo(null);
            } finally {
                setLoadingLogo(false);
            }
        };
        
        loadLogo();
    }, [snsInfo, identity]);

    // Listen for URL parameter changes and sync with global state
    useEffect(() => {
        const snsParam = searchParams.get('sns');
        if (snsParam && snsParam !== selectedSnsRoot) {
            updateSelectedSns(snsParam);
            setCurrentPage(1);
        }
    }, [searchParams, selectedSnsRoot, updateSelectedSns]);

    // Helper to safely extract principal string from various formats
    // Handles: Principal object, [Principal] opt array, serialized {_arr} from IndexedDB
    const extractPrincipalString = (principalData) => {
        if (!principalData) return null;
        
        // If it's an array (opt type), get first element
        const principal = Array.isArray(principalData) ? principalData[0] : principalData;
        if (!principal) return null;
        
        // If it has a toString method that returns a valid principal string, use it
        if (typeof principal.toString === 'function') {
            const str = principal.toString();
            // Check if it's a valid principal string (not "[object Object]")
            if (str && !str.includes('[object')) {
                return str;
            }
        }
        
        // If it has _arr (serialized Principal from IndexedDB), reconstruct
        if (principal._arr) {
            try {
                return Principal.fromUint8Array(new Uint8Array(principal._arr)).toString();
            } catch (e) {
                console.warn('Failed to reconstruct principal from _arr:', e);
            }
        }
        
        // If it's a Uint8Array directly
        if (principal instanceof Uint8Array) {
            try {
                return Principal.fromUint8Array(principal).toString();
            } catch (e) {
                console.warn('Failed to reconstruct principal from Uint8Array:', e);
            }
        }
        
        return null;
    };

    // Format stake with M/B suffixes for large numbers (millions and above only)
    const formatStakeCompact = (e8sValue) => {
        if (!e8sValue) return '0';
        const value = Number(e8sValue) / 100000000;
        if (value >= 1000000000) {
            return (value / 1000000000).toFixed(2).replace(/\.?0+$/, '') + 'B';
        }
        if (value >= 1000000) {
            return (value / 1000000).toFixed(2).replace(/\.?0+$/, '') + 'M';
        }
        return Math.floor(value).toLocaleString();
    };

    // MANAGE_PRINCIPALS permission type (owner permission)
    const MANAGE_PRINCIPALS = 2;

    // Index neurons by principal (both owners and hotkeys)
    const usersData = useMemo(() => {
        const userMap = new Map();
        
        neurons.forEach(neuron => {
            const neuronId = uint8ArrayToHex(neuron.id[0]?.id);
            if (!neuronId) return;
            
            const stake = BigInt(neuron.cached_neuron_stake_e8s || 0);
            const maturity = BigInt(neuron.maturity_e8s_equivalent || 0);
            
            // Build owner set by checking MANAGE_PRINCIPALS permission directly
            // This handles both fresh and cached neurons correctly
            const ownerPrincipals = new Set();
            const allPrincipals = new Set();
            
            neuron.permissions?.forEach(p => {
                const principalStr = extractPrincipalString(p.principal);
                if (!principalStr) return;
                
                allPrincipals.add(principalStr);
                
                // Check if this principal has MANAGE_PRINCIPALS permission (owner)
                const permTypes = p.permission_type || [];
                if (permTypes.includes(MANAGE_PRINCIPALS)) {
                    ownerPrincipals.add(principalStr);
                }
            });
            
            // Update user data for each principal
            allPrincipals.forEach(principal => {
                if (!userMap.has(principal)) {
                    userMap.set(principal, {
                        principal,
                        neurons: [],
                        ownedNeurons: [],
                        hotkeyNeurons: [],
                        totalStake: BigInt(0),
                        totalMaturity: BigInt(0),
                        ownedStake: BigInt(0),
                        hotkeyStake: BigInt(0)
                    });
                }
                
                const userData = userMap.get(principal);
                userData.neurons.push(neuron);
                userData.totalStake += stake;
                userData.totalMaturity += maturity;
                
                // Track if this is owned or hotkey access
                if (ownerPrincipals.has(principal)) {
                    userData.ownedNeurons.push(neuron);
                    userData.ownedStake += stake;
                } else {
                    userData.hotkeyNeurons.push(neuron);
                    userData.hotkeyStake += stake;
                }
            });
        });
        
        return Array.from(userMap.values());
    }, [neurons]);

    // Get display info for principals
    const getPrincipalDisplayInfo = (principal) => {
        return getPrincipalDisplayInfoFromContext(principal, principalNames, principalNicknames);
    };

    // Filter and sort users
    const filteredUsers = useMemo(() => {
        let filtered = usersData;
        
        // Apply owner/hotkey filter
        if (userTypeFilter === 'owners') {
            // Filter to users with actual owned stake (not just owned neurons with 0 stake)
            filtered = filtered.filter(user => user.ownedStake > BigInt(0));
        } else if (userTypeFilter === 'hotkeys') {
            filtered = filtered.filter(user => user.ownedNeurons.length === 0 && user.hotkeyNeurons.length > 0);
        }
        
        // Apply search filter
        if (searchTerm.trim()) {
            const searchLower = searchTerm.toLowerCase();
            filtered = filtered.filter(user => {
                // Check principal ID
                if (user.principal.toLowerCase().includes(searchLower)) {
                    return true;
                }
                
                // Check names
                const displayInfo = getPrincipalDisplayInfo(user.principal);
                if (displayInfo?.name?.toLowerCase().includes(searchLower)) {
                    return true;
                }
                if (displayInfo?.nickname?.toLowerCase().includes(searchLower)) {
                    return true;
                }
                
                return false;
            });
        }
        
        // Apply hideUnnamed filter
        if (hideUnnamed) {
            filtered = filtered.filter(user => {
                const displayInfo = getPrincipalDisplayInfo(user.principal);
                return displayInfo?.name || displayInfo?.nickname;
            });
        }
        
        // Apply sorting
        filtered = [...filtered].sort((a, b) => {
            let result = 0;
            
            switch (sortConfig.key) {
                case 'stake':
                    result = a.totalStake > b.totalStake ? -1 : a.totalStake < b.totalStake ? 1 : 0;
                    break;
                case 'neurons':
                    result = b.neurons.length - a.neurons.length;
                    break;
                case 'owned':
                    // Sort by owned stake (BigInt comparison)
                    result = a.ownedStake > b.ownedStake ? -1 : a.ownedStake < b.ownedStake ? 1 : 0;
                    break;
                case 'name':
                    const nameA = getPrincipalDisplayInfo(a.principal)?.name || getPrincipalDisplayInfo(a.principal)?.nickname || '';
                    const nameB = getPrincipalDisplayInfo(b.principal)?.name || getPrincipalDisplayInfo(b.principal)?.nickname || '';
                    if (nameA && nameB) result = nameA.localeCompare(nameB);
                    else if (nameA) result = -1;
                    else if (nameB) result = 1;
                    else result = a.principal.localeCompare(b.principal);
                    break;
                default:
                    result = 0;
            }
            
            return sortConfig.direction === 'asc' ? -result : result;
        });
        
        return filtered;
    }, [usersData, searchTerm, hideUnnamed, userTypeFilter, sortConfig, principalNames, principalNicknames]);

    // Pagination
    const paginatedUsers = filteredUsers.slice(
        (currentPage - 1) * itemsPerPage,
        currentPage * itemsPerPage
    );
    
    const totalPages = Math.ceil(filteredUsers.length / itemsPerPage);

    // Handlers
    const handleSort = (key) => {
        setSortConfig(prevConfig => ({
            key,
            direction: prevConfig.key === key && prevConfig.direction === 'desc' ? 'asc' : 'desc'
        }));
    };

    const renderSortIndicator = (key) => {
        if (sortConfig.key !== key) return <FaSort size={10} style={{ opacity: 0.4 }} />;
        return sortConfig.direction === 'asc' ? <FaArrowUp size={10} /> : <FaArrowDown size={10} />;
    };

    // Calculate aggregate stats
    const stats = useMemo(() => {
        const uniqueUsers = usersData.length;
        // Count owners (users with ownedStake > 0)
        const totalOwners = usersData.filter(u => u.ownedStake > BigInt(0)).length;
        const totalStake = usersData.reduce((sum, u) => {
            // Only count owned stake to avoid double counting
            return sum + u.ownedStake;
        }, BigInt(0));
        
        return { uniqueUsers, totalOwners, totalStake };
    }, [usersData]);

    return (
        <div className='page-container'>
            <style>{customStyles}</style>
            <Header showSnsDropdown={true} />
            
            <main style={{ background: theme.colors.primaryGradient, minHeight: '100vh' }}>
                {/* Hero Section */}
                <div style={{
                    background: `linear-gradient(135deg, ${theme.colors.primaryBg} 0%, ${usersPrimary}15 50%, ${usersSecondary}10 100%)`,
                    borderBottom: `1px solid ${theme.colors.border}`,
                    padding: '2rem 1.5rem',
                    position: 'relative',
                    overflow: 'hidden'
                }}>
                    {/* Background decorations */}
                    <div style={{
                        position: 'absolute', top: '-50%', right: '-10%', width: '400px', height: '400px',
                        background: `radial-gradient(circle, ${usersPrimary}20 0%, transparent 70%)`,
                        borderRadius: '50%', pointerEvents: 'none'
                    }} />
                    <div style={{
                        position: 'absolute', bottom: '-30%', left: '-5%', width: '300px', height: '300px',
                        background: `radial-gradient(circle, ${usersSecondary}15 0%, transparent 70%)`,
                        borderRadius: '50%', pointerEvents: 'none'
                    }} />
                    
                    <div style={{ maxWidth: '1200px', margin: '0 auto', position: 'relative', zIndex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1rem' }}>
                            <div style={{
                                width: '56px', height: '56px',
                                minWidth: '56px', maxWidth: '56px',
                                flexShrink: 0,
                                borderRadius: '14px',
                                overflow: 'hidden'
                            }}>
                                {loadingLogo ? (
                                    <div style={{
                                        width: '100%', height: '100%',
                                        background: theme.colors.tertiaryBg,
                                        display: 'flex', alignItems: 'center', justifyContent: 'center'
                                    }}>
                                        <span style={{ color: theme.colors.mutedText, animation: 'pulse 1.5s ease-in-out infinite' }}>...</span>
                                    </div>
                                ) : snsLogo ? (
                                    <img src={snsLogo} alt={snsInfo?.name || 'SNS'} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                ) : (
                                    <div style={{
                                        width: '100%', height: '100%',
                                        background: `linear-gradient(135deg, ${usersPrimary}, ${usersSecondary})`,
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        boxShadow: `0 4px 20px ${usersPrimary}40`
                                    }}>
                                        <FaUsers size={24} color="white" />
                                    </div>
                                )}
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <h1 style={{ 
                                    color: theme.colors.primaryText, 
                                    fontSize: '1.75rem', 
                                    fontWeight: '700', 
                                    margin: 0,
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '12px',
                                    flexWrap: 'wrap'
                                }}>
                                    {snsInfo ? `${snsInfo.name}` : ''} User Explorer
                                </h1>
                                <p style={{ color: theme.colors.secondaryText, fontSize: '0.95rem', margin: '0.35rem 0 0 0' }}>
                                    Browse all users with neuron holdings in {snsInfo?.name || 'this SNS'}
                                </p>
                            </div>
                        </div>
                        
                        {/* Quick Stats Row */}
                        <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', marginTop: '1rem' }}>
                            <div style={{ color: theme.colors.secondaryText, fontSize: '0.9rem' }}>
                                <span style={{ color: usersPrimary, fontWeight: '600' }}>{stats.uniqueUsers.toLocaleString()}</span> unique users
                            </div>
                            <div style={{ color: theme.colors.secondaryText, fontSize: '0.9rem' }}>
                                <span style={{ color: '#10b981', fontWeight: '600' }}>{stats.totalOwners.toLocaleString()}</span> owners
                            </div>
                            <div style={{ color: theme.colors.secondaryText, fontSize: '0.9rem' }}>
                                <span style={{ color: usersPrimary, fontWeight: '600' }}>{neurons.length.toLocaleString()}</span> neurons loaded
                            </div>
                            {filteredUsers.length !== usersData.length && (
                                <div style={{ color: theme.colors.secondaryText, fontSize: '0.9rem' }}>
                                    <span style={{ color: usersAccent, fontWeight: '600' }}>{filteredUsers.length.toLocaleString()}</span> matching filters
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '1.5rem' }}>
                    {/* Statistics Cards */}
                    <div style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                        gap: '1rem',
                        marginBottom: '1.5rem'
                    }}>
                        {/* Total Users */}
                        <div className="stat-card" style={{
                            background: theme.colors.secondaryBg,
                            borderRadius: '16px',
                            padding: '1.25rem',
                            border: `1px solid ${theme.colors.border}`,
                            transition: 'all 0.3s ease'
                        }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem' }}>
                                <div style={{
                                    width: '40px', height: '40px', borderRadius: '10px',
                                    background: `linear-gradient(135deg, ${usersPrimary}30, ${usersSecondary}20)`,
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    color: usersPrimary
                                }}>
                                    <FaUsers size={18} />
                                </div>
                                <span style={{ color: theme.colors.mutedText, fontSize: '0.85rem', fontWeight: '500' }}>Total Users</span>
                            </div>
                            <div style={{ color: theme.colors.primaryText, fontSize: '1.75rem', fontWeight: '700' }}>
                                {stats.uniqueUsers.toLocaleString()}
                            </div>
                            <div style={{ color: theme.colors.mutedText, fontSize: '0.8rem', marginTop: '0.25rem' }}>
                                with neuron access
                            </div>
                        </div>

                        {/* Total Neurons */}
                        <div className="stat-card" style={{
                            background: theme.colors.secondaryBg,
                            borderRadius: '16px',
                            padding: '1.25rem',
                            border: `1px solid ${theme.colors.border}`,
                            transition: 'all 0.3s ease'
                        }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem' }}>
                                <div style={{
                                    width: '40px', height: '40px', borderRadius: '10px',
                                    background: `linear-gradient(135deg, #10b98130, #10b98120)`,
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    color: '#10b981'
                                }}>
                                    <FaBrain size={18} />
                                </div>
                                <span style={{ color: theme.colors.mutedText, fontSize: '0.85rem', fontWeight: '500' }}>Total Neurons</span>
                            </div>
                            <div style={{ color: '#10b981', fontSize: '1.75rem', fontWeight: '700' }}>
                                {neurons.length.toLocaleString()}
                            </div>
                            {totalNeuronCount && (
                                <div style={{ color: theme.colors.mutedText, fontSize: '0.8rem', marginTop: '0.25rem' }}>
                                    of {totalNeuronCount.toLocaleString()} on-chain
                                </div>
                            )}
                        </div>

                        {/* Total Staked */}
                        <div className="stat-card" style={{
                            background: theme.colors.secondaryBg,
                            borderRadius: '16px',
                            padding: '1.25rem',
                            border: `1px solid ${theme.colors.border}`,
                            transition: 'all 0.3s ease'
                        }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem' }}>
                                <div style={{
                                    width: '40px', height: '40px', borderRadius: '10px',
                                    background: `linear-gradient(135deg, #f59e0b30, #f59e0b20)`,
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    color: '#f59e0b'
                                }}>
                                    <FaCoins size={18} />
                                </div>
                                <span style={{ color: theme.colors.mutedText, fontSize: '0.85rem', fontWeight: '500' }}>Total Staked</span>
                            </div>
                            <div style={{ color: '#f59e0b', fontSize: '1.5rem', fontWeight: '700' }}>
                                {formatStakeCompact(stats.totalStake)}
                            </div>
                            <div style={{ color: theme.colors.mutedText, fontSize: '0.8rem', marginTop: '0.25rem' }}>
                                {tokenSymbol}
                            </div>
                        </div>
                    </div>

                    {/* Controls Section */}
                    <div style={{
                        background: theme.colors.secondaryBg,
                        borderRadius: '16px',
                        padding: '1.25rem',
                        marginBottom: '1.5rem',
                        border: `1px solid ${theme.colors.border}`
                    }}>
                        {/* Top row: Title and action buttons */}
                        <div style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            marginBottom: '1rem',
                            flexWrap: 'wrap',
                            gap: '1rem'
                        }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                <FaFilter size={14} color={usersPrimary} />
                                <span style={{ color: theme.colors.primaryText, fontWeight: '600', fontSize: '1rem' }}>
                                    Filters & Controls
                                </span>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                                <button
                                    onClick={refreshData}
                                    disabled={loading}
                                    style={{
                                        background: theme.colors.tertiaryBg,
                                        color: theme.colors.primaryText,
                                        border: `1px solid ${theme.colors.border}`,
                                        borderRadius: '8px',
                                        padding: '0.5rem 1rem',
                                        cursor: loading ? 'not-allowed' : 'pointer',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '0.5rem',
                                        fontSize: '0.85rem',
                                        fontWeight: '500',
                                        opacity: loading ? 0.6 : 1,
                                        transition: 'all 0.2s ease'
                                    }}
                                >
                                    <FaSync size={12} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
                                    Refresh
                                </button>
                            </div>
                        </div>

                        {/* Search and filters row */}
                        <div style={{
                            display: 'flex',
                            gap: '1rem',
                            flexWrap: 'wrap',
                            alignItems: 'center',
                            marginBottom: '1rem'
                        }}>
                            <div style={{ width: '280px', minWidth: '200px', position: 'relative' }}>
                                <FaSearch size={14} style={{
                                    position: 'absolute',
                                    left: '12px',
                                    top: '50%',
                                    transform: 'translateY(-50%)',
                                    color: theme.colors.mutedText
                                }} />
                                <input
                                    type="text"
                                    value={searchTerm}
                                    onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1); }}
                                    placeholder="Search by name or ID..."
                                    style={{
                                        backgroundColor: theme.colors.tertiaryBg,
                                        color: theme.colors.primaryText,
                                        border: `1px solid ${theme.colors.border}`,
                                        borderRadius: '10px',
                                        padding: '0.65rem 1rem 0.65rem 2.5rem',
                                        width: '100%',
                                        fontSize: '0.9rem'
                                    }}
                                />
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <span style={{ color: theme.colors.secondaryText, fontSize: '0.85rem' }}>Show:</span>
                                <select
                                    value={userTypeFilter}
                                    onChange={(e) => { setUserTypeFilter(e.target.value); setCurrentPage(1); }}
                                    style={{
                                        backgroundColor: theme.colors.tertiaryBg,
                                        color: theme.colors.primaryText,
                                        border: `1px solid ${theme.colors.border}`,
                                        borderRadius: '8px',
                                        padding: '0.5rem 0.75rem',
                                        fontSize: '0.9rem',
                                        cursor: 'pointer'
                                    }}
                                >
                                    <option value="all">All Users</option>
                                    <option value="owners">Owners Only</option>
                                    <option value="hotkeys">Hotkeys Only</option>
                                </select>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <span style={{ color: theme.colors.secondaryText, fontSize: '0.85rem' }}>Per page:</span>
                                <select
                                    value={itemsPerPage}
                                    onChange={(e) => { setItemsPerPage(Number(e.target.value)); setCurrentPage(1); }}
                                    style={{
                                        backgroundColor: theme.colors.tertiaryBg,
                                        color: theme.colors.primaryText,
                                        border: `1px solid ${theme.colors.border}`,
                                        borderRadius: '8px',
                                        padding: '0.5rem 0.75rem',
                                        fontSize: '0.9rem',
                                        cursor: 'pointer'
                                    }}
                                >
                                    <option value={10}>10</option>
                                    <option value={20}>20</option>
                                    <option value={50}>50</option>
                                    <option value={100}>100</option>
                                </select>
                            </div>
                        </div>

                        {/* Checkbox filters */}
                        <div style={{
                            display: 'flex',
                            gap: '1.5rem',
                            flexWrap: 'wrap',
                            paddingTop: '0.75rem',
                            borderTop: `1px solid ${theme.colors.border}`
                        }}>
                            <label style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.5rem',
                                color: theme.colors.secondaryText,
                                fontSize: '0.85rem',
                                cursor: 'pointer'
                            }}>
                                <input
                                    type="checkbox"
                                    checked={hideUnnamed}
                                    onChange={(e) => { setHideUnnamed(e.target.checked); setCurrentPage(1); }}
                                    style={{ accentColor: usersPrimary, width: '16px', height: '16px' }}
                                />
                                Show only named users
                            </label>
                        </div>
                    </div>

                    {/* Sort Controls */}
                    <div style={{
                        background: theme.colors.secondaryBg,
                        borderRadius: '12px',
                        padding: '0.75rem 1rem',
                        marginBottom: '1rem',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem',
                        flexWrap: 'wrap',
                        border: `1px solid ${theme.colors.border}`
                    }}>
                        <span style={{ color: theme.colors.mutedText, fontSize: '0.85rem', fontWeight: '500', marginRight: '0.5rem' }}>
                            Sort by:
                        </span>
                        {[
                            { key: 'stake', label: 'Total Stake', icon: <FaCoins size={12} /> },
                            { key: 'neurons', label: 'Neurons', icon: <FaBrain size={12} /> },
                            { key: 'owned', label: 'Owned', icon: <FaUsers size={12} /> },
                            { key: 'name', label: 'Name', icon: <FaUsers size={12} /> }
                        ].map(sort => (
                            <button
                                key={sort.key}
                                onClick={() => handleSort(sort.key)}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '0.4rem',
                                    padding: '0.4rem 0.75rem',
                                    borderRadius: '6px',
                                    border: sortConfig.key === sort.key ? `1px solid ${usersPrimary}` : `1px solid transparent`,
                                    background: sortConfig.key === sort.key ? `${usersPrimary}15` : 'transparent',
                                    color: sortConfig.key === sort.key ? usersPrimary : theme.colors.secondaryText,
                                    cursor: 'pointer',
                                    fontSize: '0.8rem',
                                    fontWeight: sortConfig.key === sort.key ? '600' : '500',
                                    transition: 'all 0.2s ease'
                                }}
                            >
                                {sort.icon}
                                {sort.label}
                                {renderSortIndicator(sort.key)}
                            </button>
                        ))}
                    </div>

                    {/* Error display */}
                    {error && (
                        <div style={{
                            background: `linear-gradient(135deg, ${theme.colors.error}15, ${theme.colors.error}08)`,
                            border: `1px solid ${theme.colors.error}30`,
                            borderRadius: '12px',
                            padding: '1rem',
                            marginBottom: '1rem',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.75rem'
                        }}>
                            <span style={{ color: theme.colors.error }}>⚠️ {error}</span>
                        </div>
                    )}

                    {/* Loading State */}
                    {loading ? (
                        <div style={{
                            background: theme.colors.secondaryBg,
                            borderRadius: '16px',
                            padding: '3rem',
                            textAlign: 'center',
                            border: `1px solid ${theme.colors.border}`
                        }}>
                            <div style={{
                                width: '48px', height: '48px',
                                border: `3px solid ${usersPrimary}30`,
                                borderTop: `3px solid ${usersPrimary}`,
                                borderRadius: '50%',
                                animation: 'spin 1s linear infinite',
                                margin: '0 auto 1.5rem'
                            }} />
                            <div style={{ color: theme.colors.primaryText, fontSize: '1rem', marginBottom: '0.5rem' }}>
                                {loadingProgress.message}
                            </div>
                            {/* Progress bar */}
                            <div style={{
                                width: '100%',
                                maxWidth: '400px',
                                margin: '1rem auto',
                                backgroundColor: theme.colors.tertiaryBg,
                                borderRadius: '8px',
                                overflow: 'hidden',
                                height: '8px'
                            }}>
                                <div style={{
                                    width: `${loadingProgress.percent}%`,
                                    background: `linear-gradient(90deg, ${usersPrimary}, ${usersSecondary})`,
                                    height: '100%',
                                    transition: 'width 0.3s ease',
                                    borderRadius: '8px'
                                }} />
                            </div>
                            <div style={{ color: theme.colors.mutedText, fontSize: '0.85rem' }}>
                                {loadingProgress.count > 0 && `Found ${loadingProgress.count.toLocaleString()} neurons`}
                            </div>
                        </div>
                    ) : (
                        <>
                            {/* User Cards */}
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                                {paginatedUsers.map((user, index) => {
                                    const displayInfo = getPrincipalDisplayInfo(user.principal);
                                    
                                    return (
                                        <Link
                                            key={user.principal}
                                            to={`/principal?id=${user.principal}${selectedSnsRoot ? `&sns=${selectedSnsRoot}` : ''}`}
                                            className="user-card user-card-animate"
                                            style={{
                                                backgroundColor: theme.colors.secondaryBg,
                                                borderRadius: '14px',
                                                padding: '1.25rem',
                                                border: `1px solid ${theme.colors.border}`,
                                                opacity: 0,
                                                animationDelay: `${index * 0.03}s`,
                                                textDecoration: 'none',
                                                transition: 'all 0.3s ease',
                                                display: 'block'
                                            }}
                                        >
                                            <div style={{
                                                display: 'grid',
                                                gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                                                gap: '1.25rem',
                                                alignItems: 'center'
                                            }}>
                                                {/* User Identity */}
                                                <div style={{ minWidth: 0, gridColumn: 'span 2' }}>
                                                    <div style={{ color: theme.colors.mutedText, fontSize: '0.75rem', marginBottom: '0.35rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                                                        User
                                                    </div>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                                                        {displayInfo?.name ? (
                                                            <span style={{
                                                                color: usersPrimary,
                                                                fontSize: '1.1rem',
                                                                fontWeight: '600',
                                                                display: 'flex',
                                                                alignItems: 'center',
                                                                gap: '0.35rem'
                                                            }}>
                                                                {displayInfo.name}
                                                                {displayInfo.verified && (
                                                                    <FaCheckCircle size={14} color={usersPrimary} title="Verified" />
                                                                )}
                                                            </span>
                                                        ) : displayInfo?.nickname ? (
                                                            <span style={{
                                                                color: theme.colors.secondaryText,
                                                                fontSize: '1.1rem',
                                                                fontWeight: '500',
                                                                fontStyle: 'italic'
                                                            }}>
                                                                {displayInfo.nickname}
                                                            </span>
                                                        ) : null}
                                                        <span style={{
                                                            color: theme.colors.mutedText,
                                                            fontSize: '0.85rem',
                                                            fontFamily: 'monospace'
                                                        }}>
                                                            {user.principal.slice(0, 8)}...{user.principal.slice(-6)}
                                                        </span>
                                                    </div>
                                                </div>

                                                {/* Total Neurons */}
                                                <div>
                                                    <div style={{ color: theme.colors.mutedText, fontSize: '0.75rem', marginBottom: '0.35rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                                                        Neurons
                                                    </div>
                                                    <div style={{ color: theme.colors.primaryText, fontSize: '1.1rem', fontWeight: '600' }}>
                                                        {user.neurons.length}
                                                        <span style={{ fontSize: '0.8rem', fontWeight: '400', color: theme.colors.mutedText, marginLeft: '0.35rem' }}>
                                                            ({user.ownedNeurons.length} owned)
                                                        </span>
                                                    </div>
                                                </div>

                                                {/* Total Stake */}
                                                <div>
                                                    <div style={{ color: theme.colors.mutedText, fontSize: '0.75rem', marginBottom: '0.35rem', textTransform: 'uppercase', letterSpacing: '0.5px', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                                                        <FaCoins size={10} />
                                                        Total Stake
                                                    </div>
                                                    <div style={{ color: usersPrimary, fontSize: '1.1rem', fontWeight: '600' }}>
                                                        {formatStakeCompact(user.totalStake)}
                                                        <span style={{ fontSize: '0.8rem', fontWeight: '400', color: theme.colors.secondaryText, marginLeft: '0.35rem' }}>
                                                            {tokenSymbol}
                                                        </span>
                                                    </div>
                                                </div>

                                                {/* Owned Stake */}
                                                <div>
                                                    <div style={{ color: theme.colors.mutedText, fontSize: '0.75rem', marginBottom: '0.35rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                                                        Owned Stake
                                                    </div>
                                                    <div style={{ color: '#10b981', fontSize: '1rem', fontWeight: '600' }}>
                                                        {formatStakeCompact(user.ownedStake)}
                                                    </div>
                                                </div>

                                                {/* View button */}
                                                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                                                    <div style={{
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: '0.35rem',
                                                        color: usersPrimary,
                                                        fontSize: '0.85rem',
                                                        fontWeight: '500'
                                                    }}>
                                                        View Profile
                                                        <FaExternalLinkAlt size={10} />
                                                    </div>
                                                </div>
                                            </div>
                                        </Link>
                                    );
                                })}
                            </div>

                            {/* Empty State */}
                            {filteredUsers.length === 0 && !loading && (
                                <div style={{
                                    background: theme.colors.secondaryBg,
                                    borderRadius: '16px',
                                    padding: '3rem',
                                    textAlign: 'center',
                                    border: `1px solid ${theme.colors.border}`
                                }}>
                                    <FaUsers size={48} color={theme.colors.mutedText} style={{ opacity: 0.3, marginBottom: '1rem' }} />
                                    <div style={{ color: theme.colors.secondaryText, fontSize: '1rem' }}>
                                        {neurons.length === 0 ? 'No neurons loaded yet' : 'No users match your filters'}
                                    </div>
                                    <div style={{ color: theme.colors.mutedText, fontSize: '0.85rem', marginTop: '0.5rem' }}>
                                        {neurons.length === 0 ? 'Click Refresh to load neurons' : 'Try adjusting your search or filter criteria'}
                                    </div>
                                </div>
                            )}

                            {/* Pagination */}
                            {filteredUsers.length > 0 && (
                                <div style={{
                                    display: 'flex',
                                    justifyContent: 'center',
                                    alignItems: 'center',
                                    gap: '1rem',
                                    marginTop: '1.5rem',
                                    padding: '1rem',
                                    background: theme.colors.secondaryBg,
                                    borderRadius: '12px',
                                    border: `1px solid ${theme.colors.border}`
                                }}>
                                    <button
                                        onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                                        disabled={currentPage === 1}
                                        style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '0.4rem',
                                            padding: '0.5rem 1rem',
                                            borderRadius: '8px',
                                            border: 'none',
                                            background: currentPage === 1 ? theme.colors.tertiaryBg : `linear-gradient(135deg, ${usersPrimary}, ${usersSecondary})`,
                                            color: currentPage === 1 ? theme.colors.mutedText : 'white',
                                            cursor: currentPage === 1 ? 'not-allowed' : 'pointer',
                                            fontSize: '0.85rem',
                                            fontWeight: '500',
                                            opacity: currentPage === 1 ? 0.5 : 1
                                        }}
                                    >
                                        <FaChevronLeft size={10} />
                                        Previous
                                    </button>
                                    <span style={{ color: theme.colors.secondaryText, fontSize: '0.9rem' }}>
                                        Page <strong style={{ color: theme.colors.primaryText }}>{currentPage}</strong> of <strong style={{ color: theme.colors.primaryText }}>{totalPages}</strong>
                                    </span>
                                    <button
                                        onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                                        disabled={currentPage === totalPages}
                                        style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '0.4rem',
                                            padding: '0.5rem 1rem',
                                            borderRadius: '8px',
                                            border: 'none',
                                            background: currentPage === totalPages ? theme.colors.tertiaryBg : `linear-gradient(135deg, ${usersPrimary}, ${usersSecondary})`,
                                            color: currentPage === totalPages ? theme.colors.mutedText : 'white',
                                            cursor: currentPage === totalPages ? 'not-allowed' : 'pointer',
                                            fontSize: '0.85rem',
                                            fontWeight: '500',
                                            opacity: currentPage === totalPages ? 0.5 : 1
                                        }}
                                    >
                                        Next
                                        <FaChevronRight size={10} />
                                    </button>
                                </div>
                            )}
                        </>
                    )}
                </div>
            </main>
        </div>
    );
}

export default Users;
