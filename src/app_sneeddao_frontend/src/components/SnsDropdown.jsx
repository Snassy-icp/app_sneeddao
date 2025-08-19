import React, { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import { useSns } from '../contexts/SnsContext';
import { fetchSnsLogo, startBackgroundSnsFetch, getAllSnses } from '../utils/SnsUtils';
import { HttpAgent } from '@dfinity/agent';

function SnsDropdown({ onSnsChange, showSnsDropdown = true }) {
    const { identity } = useAuth();
    const { selectedSnsRoot, updateSelectedSns, SNEED_SNS_ROOT } = useSns();
    const [searchParams, setSearchParams] = useSearchParams();
    const [snsList, setSnsList] = useState([]);
    const [loadingSnses, setLoadingSnses] = useState(true);
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef(null);
    const [snsLogos, setSnsLogos] = useState(new Map());
    const [loadingLogos, setLoadingLogos] = useState(new Set());

    useEffect(() => {
        // Close dropdown when clicking outside
        const handleClickOutside = (event) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
                setIsOpen(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // Sync URL parameters with global state
    useEffect(() => {
        const snsParam = searchParams.get('sns');
        if (snsParam && snsParam !== selectedSnsRoot) {
            // URL parameter takes precedence (for direct links)
            updateSelectedSns(snsParam);
        } else if (!snsParam && selectedSnsRoot !== SNEED_SNS_ROOT) {
            // Update URL to match global state
            setSearchParams(prev => {
                prev.set('sns', selectedSnsRoot);
                return prev;
            });
        }
    }, [searchParams, selectedSnsRoot, updateSelectedSns, SNEED_SNS_ROOT, setSearchParams]);

    // Function to load a single SNS logo
    const loadSnsLogo = async (governanceId) => {
        if (snsLogos.has(governanceId) || loadingLogos.has(governanceId)) return;
        
        setLoadingLogos(prev => new Set([...prev, governanceId]));
        
        try {
            const host = process.env.DFX_NETWORK === 'ic' ? 'https://ic0.app' : 'http://localhost:4943';
            const agent = new HttpAgent({
                host,
                ...(identity && { identity })
            });

            if (process.env.DFX_NETWORK !== 'ic') {
                await agent.fetchRootKey();
            }

            const logo = await fetchSnsLogo(governanceId, agent);
            setSnsLogos(prev => new Map(prev).set(governanceId, logo));
        } catch (error) {
            console.error(`Error loading logo for SNS ${governanceId}:`, error);
        } finally {
            setLoadingLogos(prev => {
                const next = new Set(prev);
                next.delete(governanceId);
                return next;
            });
        }
    };

    const loadSnsData = async () => {
        console.log('SnsDropdown: Starting to load SNS data...'); // Debug log
        setLoadingSnses(true);
        
        try {
            // First check if we have cached data
            const cachedData = getAllSnses();
            if (cachedData && cachedData.length > 0) {
                console.log('SnsDropdown: Using cached SNS data:', cachedData); // Debug log
                setSnsList(cachedData);
                setLoadingSnses(false);
                
                // Start loading logos for visible SNSes
                cachedData.forEach(sns => {
                    if (sns.canisters.governance) {
                        loadSnsLogo(sns.canisters.governance);
                    }
                });
                return;
            }
            
            // No cached data - start background fetch and show loading state
            console.log('SnsDropdown: No cached data, starting background fetch...'); // Debug log
            startBackgroundSnsFetch(identity, (data) => {
                console.log('SnsDropdown: Background fetch completed:', data); // Debug log
                setSnsList(data);
                setLoadingSnses(false);
                
                // Start loading logos for visible SNSes
                data.forEach(sns => {
                    if (sns.canisters.governance) {
                        loadSnsLogo(sns.canisters.governance);
                    }
                });
            }).catch(err => {
                console.error('SnsDropdown: Background fetch failed:', err);
                setLoadingSnses(false);
            });
            
        } catch (err) {
            console.error('SnsDropdown: Error loading SNS data:', err);
            setLoadingSnses(false);
        }
    };

    useEffect(() => {
        console.log('SnsDropdown: Initial mount, loading SNS data...'); // Debug log
        loadSnsData();
    }, []); // Only run once on mount

    const handleSnsChange = (snsRoot) => {
        // Update global state
        updateSelectedSns(snsRoot);
        
        // Update URL parameters
        setSearchParams(prev => {
            if (snsRoot === SNEED_SNS_ROOT) {
                prev.delete('sns'); // Remove parameter for default SNS
            } else {
                prev.set('sns', snsRoot);
            }
            return prev;
        });
        
        setIsOpen(false);
        if (onSnsChange) {
            onSnsChange(snsRoot);
        }
    };

    const getSelectedSns = () => {
        return snsList.find(sns => sns.rootCanisterId === selectedSnsRoot) || { name: 'Select an SNS' };
    };

    const handleSneedLogoClick = () => {
        handleSnsChange(SNEED_SNS_ROOT);
    };

    // Find Sneed SNS data
    const sneedSns = snsList.find(sns => sns.rootCanisterId === SNEED_SNS_ROOT) || { name: 'Sneed' };
    const sneedLogo = snsLogos.get(sneedSns?.canisters?.governance);

    // If showSnsDropdown is false, return null (don't render anything)
    if (!showSnsDropdown) {
        return null;
    }

    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {/* Sneed Logo Quick Link */}
            <div
                onClick={handleSneedLogoClick}
                style={{
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    padding: '2px',
                    borderRadius: '4px',
                    transition: 'background-color 0.2s ease'
                }}
                onMouseEnter={(e) => {
                    e.target.style.backgroundColor = 'rgba(255,255,255,0.1)';
                }}
                onMouseLeave={(e) => {
                    e.target.style.backgroundColor = 'transparent';
                }}
                title="Switch to Sneed SNS"
            >
                {sneedLogo && (
                    <img 
                        src={sneedLogo} 
                        alt="Sneed"
                        style={{ 
                            width: '24px', 
                            height: '24px',
                            borderRadius: '50%',
                            objectFit: 'cover',
                            border: selectedSnsRoot === SNEED_SNS_ROOT ? '2px solid #3498db' : 'none'
                        }} 
                    />
                )}
            </div>

            {/* Compact SNS Dropdown - Shows only selected logo and chevron */}
            <div 
                ref={dropdownRef}
                style={{ 
                    position: 'relative'
                }}
            >
                <div
                    onClick={() => !loadingSnses && setIsOpen(!isOpen)}
                    style={{
                        backgroundColor: 'transparent',
                        border: 'none',
                        color: '#ffffff',
                        padding: '4px',
                        cursor: loadingSnses ? 'wait' : 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        userSelect: 'none',
                        borderRadius: '4px',
                        transition: 'background-color 0.2s ease'
                    }}
                    onMouseEnter={(e) => {
                        e.target.style.backgroundColor = 'rgba(255,255,255,0.1)';
                    }}
                    onMouseLeave={(e) => {
                        e.target.style.backgroundColor = 'transparent';
                    }}
                    title={loadingSnses ? 'Loading SNSes...' : `Current SNS: ${getSelectedSns().name}`}
                >
                    {loadingSnses ? (
                        <div style={{ 
                            width: '24px', 
                            height: '24px',
                            borderRadius: '50%',
                            backgroundColor: '#3a3a3a',
                            marginRight: '4px'
                        }} />
                    ) : (
                        <>
                            {/* Show selected SNS logo or Sneed logo */}
                            {selectedSnsRoot === SNEED_SNS_ROOT ? (
                                sneedLogo && (
                                    <img 
                                        src={sneedLogo} 
                                        alt="Sneed"
                                        style={{ 
                                            width: '24px', 
                                            height: '24px',
                                            borderRadius: '50%',
                                            objectFit: 'cover',
                                            marginRight: '4px'
                                        }} 
                                    />
                                )
                            ) : (
                                snsLogos.get(getSelectedSns()?.canisters?.governance) && (
                                    <img 
                                        src={snsLogos.get(getSelectedSns().canisters.governance)} 
                                        alt={getSelectedSns().name}
                                        style={{ 
                                            width: '24px', 
                                            height: '24px',
                                            borderRadius: '50%',
                                            objectFit: 'cover',
                                            marginRight: '4px'
                                        }} 
                                    />
                                )
                            )}
                        </>
                    )}
                    <span style={{ 
                        transform: isOpen ? 'rotate(180deg)' : 'none',
                        transition: 'transform 0.2s ease',
                        fontSize: '12px',
                        color: '#888'
                    }}>▼</span>
                </div>

                {isOpen && !loadingSnses && (
                    <div style={{
                        position: 'absolute',
                        top: '100%',
                        right: '0',
                        backgroundColor: '#2a2a2a',
                        border: '1px solid #4a4a4a',
                        borderRadius: '4px',
                        marginTop: '4px',
                        maxHeight: '300px',
                        overflowY: 'auto',
                        overflowX: 'hidden',
                        zIndex: 1000,
                        boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
                        minWidth: '250px'
                    }}>
                        {snsList.map(sns => {
                            const logo = snsLogos.get(sns.canisters.governance);
                            const isLoading = loadingLogos.has(sns.canisters.governance);
                            
                            return (
                                <div
                                    key={sns.rootCanisterId}
                                    onClick={() => handleSnsChange(sns.rootCanisterId)}
                                    style={{
                                        padding: '8px 12px',
                                        cursor: 'pointer',
                                        backgroundColor: selectedSnsRoot === sns.rootCanisterId ? '#3a3a3a' : 'transparent',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '8px',
                                        width: '100%',
                                        ':hover': {
                                            backgroundColor: '#3a3a3a'
                                        }
                                    }}
                                    onMouseEnter={(e) => {
                                        e.target.style.backgroundColor = '#3a3a3a';
                                    }}
                                    onMouseLeave={(e) => {
                                        if (selectedSnsRoot !== sns.rootCanisterId) {
                                            e.target.style.backgroundColor = 'transparent';
                                        }
                                    }}
                                >
                                    <div style={{
                                        display: 'grid',
                                        gridTemplateColumns: '20px 1fr',
                                        gap: '8px',
                                        alignItems: 'center',
                                        width: '100%'
                                    }}>
                                        {isLoading ? (
                                            <div style={{ 
                                                width: '20px', 
                                                height: '20px',
                                                borderRadius: '50%',
                                                backgroundColor: '#3a3a3a',
                                                gridColumn: '1'
                                            }} />
                                        ) : logo ? (
                                            <img 
                                                src={logo} 
                                                alt={sns.name}
                                                style={{ 
                                                    width: '20px', 
                                                    height: '20px',
                                                    borderRadius: '50%',
                                                    objectFit: 'cover',
                                                    gridColumn: '1'
                                                }} 
                                            />
                                        ) : (
                                            <div style={{ 
                                                width: '20px', 
                                                height: '20px',
                                                borderRadius: '50%',
                                                backgroundColor: '#3a3a3a',
                                                gridColumn: '1'
                                            }} />
                                        )}
                                        <span style={{
                                            gridColumn: '2',
                                            textAlign: 'left',
                                            whiteSpace: 'nowrap',
                                            overflow: 'hidden',
                                            textOverflow: 'ellipsis'
                                        }}>{sns.name}</span>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}

export default SnsDropdown; 