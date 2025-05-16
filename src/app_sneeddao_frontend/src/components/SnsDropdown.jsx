import React, { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import { fetchAndCacheSnsData, clearSnsCache } from '../utils/SnsUtils';

function SnsDropdown({ onSnsChange }) {
    const { identity } = useAuth();
    const [searchParams, setSearchParams] = useSearchParams();
    const [snsList, setSnsList] = useState([]);
    const [loadingSnses, setLoadingSnses] = useState(true);
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef(null);
    const SNEED_SNS_ROOT = 'fp274-iaaaa-aaaaq-aacha-cai';
    const [selectedSnsRoot, setSelectedSnsRoot] = useState(searchParams.get('sns') || SNEED_SNS_ROOT);

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

    const loadSnsData = async () => {
        setLoadingSnses(true);
        try {
            const data = await fetchAndCacheSnsData(identity);
            setSnsList(data);
            
            // If no SNS is selected in the URL, set it to Sneed
            if (!searchParams.get('sns')) {
                setSelectedSnsRoot(SNEED_SNS_ROOT);
                setSearchParams(prev => {
                    prev.set('sns', SNEED_SNS_ROOT);
                    return prev;
                });
            }
        } catch (err) {
            console.error('Error loading SNS data:', err);
        } finally {
            setLoadingSnses(false);
        }
    };

    useEffect(() => {
        if (identity) {
            loadSnsData();
        }
    }, [identity]);

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
        return snsList.find(sns => sns.rootCanisterId === selectedSnsRoot) || { name: 'Select an SNS', logo: '' };
    };

    return (
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
                            {getSelectedSns().logo && (
                                <img 
                                    src={getSelectedSns().logo} 
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
                    {snsList.map(sns => (
                        <div
                            key={sns.rootCanisterId}
                            onClick={() => handleSnsChange(sns.rootCanisterId)}
                            style={{
                                padding: '8px 12px',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px',
                                color: '#ffffff',
                                backgroundColor: selectedSnsRoot === sns.rootCanisterId ? '#3498db' : 'transparent',
                                transition: 'background-color 0.2s ease',
                                width: '100%'
                            }}
                            onMouseEnter={(e) => {
                                e.currentTarget.style.backgroundColor = selectedSnsRoot === sns.rootCanisterId ? '#3498db' : '#3a3a3a';
                            }}
                            onMouseLeave={(e) => {
                                e.currentTarget.style.backgroundColor = selectedSnsRoot === sns.rootCanisterId ? '#3498db' : 'transparent';
                            }}
                        >
                            {sns.logo && (
                                <img 
                                    src={sns.logo} 
                                    alt={sns.name}
                                    style={{ 
                                        width: '20px', 
                                        height: '20px',
                                        borderRadius: '50%',
                                        objectFit: 'cover',
                                        flexShrink: 0
                                    }} 
                                />
                            )}
                            <span style={{ flex: 1 }}>{sns.name}</span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

export default SnsDropdown; 