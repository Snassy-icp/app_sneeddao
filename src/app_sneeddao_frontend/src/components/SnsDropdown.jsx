import React, { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import { fetchAndCacheSnsData, fetchSnsLogo } from '../utils/SnsUtils';
import { HttpAgent } from '@dfinity/agent';

function SnsDropdown({ onSnsChange, showSnsDropdown = true }) {
    const { identity } = useAuth();
    const [searchParams, setSearchParams] = useSearchParams();
    const [snsList, setSnsList] = useState([]);
    const [loadingSnses, setLoadingSnses] = useState(true);
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef(null);
    const SNEED_SNS_ROOT = 'fp274-iaaaa-aaaaq-aacha-cai';
    const [selectedSnsRoot, setSelectedSnsRoot] = useState(searchParams.get('sns') || SNEED_SNS_ROOT);
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

    // Add effect to listen for URL changes
    useEffect(() => {
        const snsParam = searchParams.get('sns');
        if (snsParam && snsParam !== selectedSnsRoot) {
            setSelectedSnsRoot(snsParam);
        }
    }, [searchParams]);

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
            console.log('SnsDropdown: Calling fetchAndCacheSnsData...'); // Debug log
            const data = await fetchAndCacheSnsData();
            console.log('SnsDropdown: Received SNS data:', data); // Debug log
            setSnsList(data);
            
            // Start loading logos for visible SNSes
            data.forEach(sns => {
                if (sns.canisters.governance) {
                    loadSnsLogo(sns.canisters.governance);
                }
            });
            
            // If no SNS is selected in the URL, set it to Sneed
            if (!searchParams.get('sns')) {
                setSelectedSnsRoot(SNEED_SNS_ROOT);
                setSearchParams(prev => {
                    prev.set('sns', SNEED_SNS_ROOT);
                    return prev;
                });
            }
        } catch (err) {
            console.error('SnsDropdown: Error loading SNS data:', err);
        } finally {
            setLoadingSnses(false);
        }
    };

    useEffect(() => {
        console.log('SnsDropdown: Initial mount, loading SNS data...'); // Debug log
        loadSnsData();
    }, []); // Only run once on mount

    const handleSnsChange = (snsRoot) => {
        setSelectedSnsRoot(snsRoot);
        setSearchParams(prev => {
            prev.set('sns', snsRoot);
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
        <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
            {/* Sneed Logo - Always visible */}
            <div
                onClick={handleSneedLogoClick}
                style={{
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
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
                            border: selectedSnsRoot === SNEED_SNS_ROOT ? '2px solid #3498db' : 'none',
                            padding: '2px'
                        }} 
                    />
                )}
            </div>

            {/* SNS Dropdown */}
            <div 
                ref={dropdownRef}
                style={{ 
                    position: 'relative',
                    marginRight: '15px',
                    minWidth: '200px'
                }}
            >
                <div
                    onClick={() => !loadingSnses && setIsOpen(!isOpen)}
                    style={{
                        backgroundColor: '#3a3a3a',
                        border: '1px solid #4a4a4a',
                        borderRadius: '4px',
                        color: '#ffffff',
                        padding: '8px 12px',
                        fontSize: '14px',
                        cursor: loadingSnses ? 'wait' : 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'flex-start',
                        userSelect: 'none',
                        minWidth: '250px'
                    }}
                >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1 }}>
                        {loadingSnses ? (
                            <span>Loading SNSes...</span>
                        ) : (
                            <>
                                {selectedSnsRoot !== SNEED_SNS_ROOT && (
                                    <>
                                        {snsLogos.get(getSelectedSns()?.canisters?.governance) && (
                                            <img 
                                                src={snsLogos.get(getSelectedSns().canisters.governance)} 
                                                alt={getSelectedSns().name}
                                                style={{ 
                                                    width: '20px', 
                                                    height: '20px',
                                                    borderRadius: '50%',
                                                    objectFit: 'cover',
                                                    flexShrink: 0
                                                }} 
                                            />
                                        )}
                                    </>
                                )}
                                <span style={{ flex: 1 }}>{getSelectedSns().name}</span>
                            </>
                        )}
                    </div>
                    <span style={{ 
                        marginLeft: '8px',
                        transform: isOpen ? 'rotate(180deg)' : 'none',
                        transition: 'transform 0.2s ease',
                        flexShrink: 0
                    }}>▼</span>
                </div>

                {isOpen && !loadingSnses && (
                    <div style={{
                        position: 'absolute',
                        top: '100%',
                        left: '0',
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