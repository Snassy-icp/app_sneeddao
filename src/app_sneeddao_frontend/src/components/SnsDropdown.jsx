import React, { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { useSns } from '../contexts/SnsContext';
import { fetchSnsLogo, startBackgroundSnsFetch, getAllSnses } from '../utils/SnsUtils';
import { HttpAgent } from '@dfinity/agent';

function SnsDropdown({ onSnsChange, showSnsDropdown = true }) {
    const { identity } = useAuth();
    const { theme } = useTheme();
    const { selectedSnsRoot, updateSelectedSns, SNEED_SNS_ROOT } = useSns();
    const [searchParams, setSearchParams] = useSearchParams();
    const [snsList, setSnsList] = useState([]);
    const [loadingSnses, setLoadingSnses] = useState(true);
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef(null);
    const [snsLogos, setSnsLogos] = useState(new Map());
    const [loadingLogos, setLoadingLogos] = useState(new Set());
    const [dropdownOffset, setDropdownOffset] = useState(0);

    // Function to calculate dropdown offset to keep it within bounds
    const calculateDropdownOffset = () => {
        if (!dropdownRef.current) return;
        
        // Wait a tick for the dropdown to render
        setTimeout(() => {
            const dropdown = dropdownRef.current?.querySelector('div[style*="position: absolute"]');
            if (!dropdown) return;
            
            const rect = dropdown.getBoundingClientRect();
            const viewportWidth = window.innerWidth;
            
            console.log('Dropdown bounds check:', {
                left: rect.left,
                right: rect.right,
                viewportWidth,
                isOffLeft: rect.left < 0,
                isOffRight: rect.right > viewportWidth
            });
            
            // If dropdown goes off the left edge, calculate offset to bring it back
            if (rect.left < 0) {
                const offset = Math.abs(rect.left) + 10; // Add 10px padding
                console.log('Applying left offset:', offset);
                setDropdownOffset(offset);
            } else if (rect.right > viewportWidth) {
                // If it goes off the right, push it left
                const offset = -(rect.right - viewportWidth + 10); // Add 10px padding
                console.log('Applying right offset:', offset);
                setDropdownOffset(offset);
            } else {
                setDropdownOffset(0);
            }
        }, 0);
    };

    useEffect(() => {
        // Close dropdown when clicking outside
        const handleClickOutside = (event) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
                setIsOpen(false);
            }
        };

        // Handle window resize to recalculate dropdown position
        const handleResize = () => {
            if (isOpen) {
                calculateDropdownOffset();
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        window.addEventListener('resize', handleResize);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            window.removeEventListener('resize', handleResize);
        };
    }, [isOpen]);

    // Recalculate position when dropdown opens
    useEffect(() => {
        if (isOpen) {
            calculateDropdownOffset();
        } else {
            setDropdownOffset(0); // Reset offset when closed
        }
    }, [isOpen]);

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
            const host = process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging' ? 'https://ic0.app' : 'http://localhost:4943';
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
                // Sort so Sneed always comes first
                const sortedData = [...cachedData].sort((a, b) => {
                    if (a.rootCanisterId === SNEED_SNS_ROOT) return -1;
                    if (b.rootCanisterId === SNEED_SNS_ROOT) return 1;
                    return a.name.localeCompare(b.name);
                });
                setSnsList(sortedData);
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
                // Sort so Sneed always comes first
                const sortedData = [...data].sort((a, b) => {
                    if (a.rootCanisterId === SNEED_SNS_ROOT) return -1;
                    if (b.rootCanisterId === SNEED_SNS_ROOT) return 1;
                    return a.name.localeCompare(b.name);
                });
                setSnsList(sortedData);
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
            console.log('SnsDropdown: Calling onSnsChange with:', snsRoot);
            onSnsChange(snsRoot);
        } else {
            console.log('SnsDropdown: No onSnsChange callback provided');
        }
    };

    const getSelectedSns = () => {
        return snsList.find(sns => sns.rootCanisterId === selectedSnsRoot) || { name: 'Select an SNS' };
    };

    // If showSnsDropdown is false, return null (don't render anything)
    if (!showSnsDropdown) {
        return null;
    }

    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {/* Compact SNS Dropdown - Shows only selected logo and chevron */}
            <div 
                ref={dropdownRef}
                style={{ 
                    position: 'relative'
                }}
            >
                <div
                    onClick={() => {
                        if (!loadingSnses) {
                            setIsOpen(!isOpen);
                        }
                    }}
                    style={{
                        backgroundColor: 'transparent',
                        border: 'none',
                        color: theme.colors.primaryText,
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
                            backgroundColor: theme.colors.border,
                            marginRight: '4px'
                        }} />
                    ) : (
                        <>
                            {/* Show selected SNS logo */}
                            {selectedSnsRoot === SNEED_SNS_ROOT ? (
                                <img 
                                    src="sneed_logo.png" 
                                    alt="Sneed"
                                    style={{ 
                                        width: '24px', 
                                        height: '24px',
                                        borderRadius: '50%',
                                        objectFit: 'cover',
                                        marginRight: '4px'
                                    }} 
                                />
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
                        color: theme.colors.mutedText
                    }}>▼</span>
                </div>

                {isOpen && !loadingSnses && (
                    <div style={{
                        position: 'absolute',
                        top: '100%',
                        right: '0',
                        transform: `translateX(${dropdownOffset}px)`,
                        backgroundColor: theme.colors.secondaryBg,
                        border: `1px solid ${theme.colors.border}`,
                        borderRadius: '4px',
                        marginTop: '4px',
                        maxHeight: '300px',
                        overflowY: 'auto',
                        overflowX: 'hidden',
                        zIndex: 1000,
                        boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
                        minWidth: '250px',
                        maxWidth: '90vw',
                        width: 'max-content'
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
                                        backgroundColor: selectedSnsRoot === sns.rootCanisterId ? theme.colors.accentHover : 'transparent',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '8px',
                                        width: '100%'
                                    }}
                                    onMouseEnter={(e) => {
                                        e.target.style.backgroundColor = theme.colors.accentHover;
                                    }}
                                    onMouseLeave={(e) => {
                                        e.target.style.backgroundColor = selectedSnsRoot === sns.rootCanisterId ? theme.colors.accentHover : 'transparent';
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
                                                backgroundColor: theme.colors.border,
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
                                                backgroundColor: theme.colors.border,
                                                gridColumn: '1'
                                            }} />
                                        )}
                                        <span style={{
                                            gridColumn: '2',
                                            textAlign: 'left',
                                            whiteSpace: 'nowrap',
                                            overflow: 'hidden',
                                            textOverflow: 'ellipsis',
                                            color: theme.colors.primaryText
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