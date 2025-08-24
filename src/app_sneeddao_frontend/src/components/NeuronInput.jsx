import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useNaming } from '../NamingContext';
import { formatNeuronDisplayWithContext, uint8ArrayToHex } from '../utils/NeuronUtils';

const NeuronInput = ({ 
    value = '', 
    onChange, 
    placeholder = 'Enter neuron ID or search by name', 
    style = {},
    disabled = false,
    snsRoot = null
}) => {
    const { neuronNames, neuronNicknames, verifiedNames } = useNaming();
    const [inputValue, setInputValue] = useState(value);
    const [showDropdown, setShowDropdown] = useState(false);
    const [isValid, setIsValid] = useState(false);
    const [resolvedInfo, setResolvedInfo] = useState(null);
    const inputRef = useRef(null);
    const dropdownRef = useRef(null);

    // Helper to validate neuron ID format
    const isValidNeuronId = (neuronIdStr) => {
        if (!neuronIdStr || typeof neuronIdStr !== 'string') return false;
        
        // Check if it's a hex string (with or without 0x prefix)
        const hexPattern = /^(0x)?[0-9a-fA-F]+$/;
        if (hexPattern.test(neuronIdStr)) {
            const cleanHex = neuronIdStr.replace(/^0x/, '');
            // Should be even length and reasonable length (not too short or too long)
            return cleanHex.length >= 16 && cleanHex.length <= 128 && cleanHex.length % 2 === 0;
        }
        
        return false;
    };

    // Helper to get neuron display info
    const getNeuronDisplayInfo = (neuronIdStr, snsRootToUse) => {
        if (!neuronIdStr || !snsRootToUse) return null;
        
        // Normalize the neuron ID to hex format
        let neuronIdHex = neuronIdStr.toLowerCase();
        if (neuronIdHex.startsWith('0x')) {
            neuronIdHex = neuronIdHex.slice(2);
        }
        
        const mapKey = `${snsRootToUse}:${neuronIdHex}`;
        const name = neuronNames?.get(mapKey);
        const nickname = neuronNicknames?.get(mapKey);
        const isVerified = verifiedNames?.get(mapKey);
        
        return { name, nickname, isVerified };
    };

    // Search and rank neurons
    const searchResults = useMemo(() => {
        if (!inputValue.trim() || !neuronNames || !neuronNicknames || !snsRoot) {
            return [];
        }

        const query = inputValue.trim().toLowerCase();
        const results = [];

        // Collect all neurons for the current SNS
        const allNeurons = new Set();
        
        // Add neurons from names
        if (neuronNames) {
            neuronNames.forEach((name, mapKey) => {
                if (mapKey.startsWith(`${snsRoot}:`)) {
                    const neuronIdHex = mapKey.substring(snsRoot.length + 1);
                    allNeurons.add(neuronIdHex);
                }
            });
        }
        
        // Add neurons from nicknames
        if (neuronNicknames) {
            neuronNicknames.forEach((nickname, mapKey) => {
                if (mapKey.startsWith(`${snsRoot}:`)) {
                    const neuronIdHex = mapKey.substring(snsRoot.length + 1);
                    allNeurons.add(neuronIdHex);
                }
            });
        }

        allNeurons.forEach(neuronIdHex => {
            if (!neuronIdHex || !neuronIdHex.trim()) return; // Skip empty neurons
            
            const displayInfo = getNeuronDisplayInfo(neuronIdHex, snsRoot);
            
            const name = displayInfo?.name || '';
            const nickname = displayInfo?.nickname || '';
            const isVerified = displayInfo?.isVerified || false;
            
            let score = 0;
            let matchType = '';
            
            // Check name matches
            if (name) {
                if (name.toLowerCase() === query) {
                    score = isVerified ? 1000 : 900; // Exact match
                    matchType = 'name-exact';
                } else if (name.toLowerCase().startsWith(query)) {
                    score = isVerified ? 800 : 700; // Starts with
                    matchType = 'name-start';
                } else if (name.toLowerCase().includes(query)) {
                    score = isVerified ? 600 : 500; // Contains
                    matchType = 'name-contains';
                }
            }
            
            // Check nickname matches (lower priority)
            if (nickname && score === 0) {
                if (nickname.toLowerCase() === query) {
                    score = 400; // Exact nickname match
                    matchType = 'nickname-exact';
                } else if (nickname.toLowerCase().startsWith(query)) {
                    score = 300; // Nickname starts with
                    matchType = 'nickname-start';
                } else if (nickname.toLowerCase().includes(query)) {
                    score = 200; // Nickname contains
                    matchType = 'nickname-contains';
                }
            }
            
            // Check neuron ID matches (lowest priority)
            if (score === 0 && neuronIdHex.toLowerCase().includes(query)) {
                score = 100; // Neuron ID contains
                matchType = 'neuron-contains';
            }
            
            if (score > 0) {
                results.push({
                    neuronIdHex,
                    displayInfo,
                    score,
                    matchType
                });
            }
        });

        // Sort by score (highest first) and limit results
        return results
            .sort((a, b) => b.score - a.score)
            .slice(0, 20);
    }, [inputValue, neuronNames, neuronNicknames, verifiedNames, snsRoot]);

    // Validate input and resolve info
    useEffect(() => {
        const trimmed = inputValue.trim();
        
        if (!trimmed) {
            setIsValid(false);
            setResolvedInfo(null);
            return;
        }

        if (isValidNeuronId(trimmed)) {
            setIsValid(true);
            
            // Get display info if available
            if (neuronNames && neuronNicknames && snsRoot) {
                const displayInfo = getNeuronDisplayInfo(trimmed, snsRoot);
                if (displayInfo?.name || displayInfo?.nickname) {
                    setResolvedInfo(displayInfo);
                } else {
                    setResolvedInfo(null);
                }
            } else {
                setResolvedInfo(null);
            }
        } else {
            // Invalid neuron ID - no green border, no resolved info
            setIsValid(false);
            setResolvedInfo(null);
        }
    }, [inputValue, neuronNames, neuronNicknames, verifiedNames, snsRoot]);

    // Handle input change
    const handleInputChange = (e) => {
        const newValue = e.target.value;
        setInputValue(newValue);
        setShowDropdown(true);
        
        if (onChange) {
            onChange(newValue);
        }
    };

    // Handle dropdown item selection
    const handleSelect = (item) => {
        setInputValue(item.neuronIdHex);
        setShowDropdown(false);
        
        if (onChange) {
            onChange(item.neuronIdHex);
        }
    };

    // Handle input focus
    const handleFocus = () => {
        if (inputValue.trim()) {
            setShowDropdown(true);
        }
    };

    // Handle input blur
    const handleBlur = (e) => {
        // Delay to allow dropdown clicks
        setTimeout(() => {
            if (!dropdownRef.current?.contains(e.relatedTarget)) {
                setShowDropdown(false);
            }
        }, 150);
    };

    // Handle clicks outside
    useEffect(() => {
        const handleClickOutside = (event) => {
            if (
                inputRef.current && 
                !inputRef.current.contains(event.target) &&
                dropdownRef.current &&
                !dropdownRef.current.contains(event.target)
            ) {
                setShowDropdown(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // Handle nickname updates
    const handleNicknameUpdate = (neuronId, snsRootUsed, newNickname) => {
        // The naming context will be updated by the dialog's success callback
        console.log('Nickname updated for neuron:', neuronId, 'in SNS:', snsRootUsed, 'new nickname:', newNickname);
    };

    return (
        <div style={{ position: 'relative', ...style }}>
            <input
                ref={inputRef}
                type="text"
                value={inputValue}
                onChange={handleInputChange}
                onFocus={handleFocus}
                onBlur={handleBlur}
                placeholder={placeholder}
                disabled={disabled}
                style={{
                    width: '100%',
                    padding: '8px 12px',
                    border: `2px solid ${isValid ? '#2ecc71' : '#3a3a3a'}`,
                    borderRadius: '4px',
                    backgroundColor: '#2a2a2a',
                    color: '#ffffff',
                    fontSize: '14px',
                    outline: 'none',
                    transition: 'border-color 0.2s ease'
                }}
            />
            
            {/* Resolved name display */}
            {resolvedInfo && isValid && snsRoot && (
                <div style={{
                    marginTop: '4px',
                    fontSize: '12px',
                    color: '#888'
                }}>
                    {(() => {
                        try {
                            // Convert hex string to Uint8Array for the display component
                            let hexStr = inputValue.trim().toLowerCase();
                            if (hexStr.startsWith('0x')) {
                                hexStr = hexStr.slice(2);
                            }
                            
                            // Convert hex to Uint8Array
                            const neuronIdArray = new Uint8Array(hexStr.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
                            
                            return formatNeuronDisplayWithContext(
                                neuronIdArray,
                                snsRoot,
                                resolvedInfo,
                                { 
                                    onNicknameUpdate: handleNicknameUpdate,
                                    style: { fontSize: '12px' },
                                    noLink: true
                                }
                            );
                        } catch (e) {
                            return null;
                        }
                    })()}
                </div>
            )}
            
            {/* Dropdown */}
            {showDropdown && searchResults.length > 0 && (
                <div
                    ref={dropdownRef}
                    style={{
                        position: 'absolute',
                        top: '100%',
                        left: 0,
                        right: 0,
                        backgroundColor: '#2a2a2a',
                        border: '1px solid #3a3a3a',
                        borderRadius: '4px',
                        maxHeight: '300px',
                        overflowY: 'auto',
                        zIndex: 1000,
                        marginTop: '2px',
                        boxShadow: '0 4px 6px rgba(0, 0, 0, 0.3)'
                    }}
                >
                    {searchResults.map((item, index) => (
                        <div
                            key={item.neuronIdHex}
                            onClick={() => handleSelect(item)}
                            style={{
                                padding: '8px 12px',
                                cursor: 'pointer',
                                borderBottom: index < searchResults.length - 1 ? '1px solid #3a3a3a' : 'none',
                                backgroundColor: 'transparent',
                                transition: 'background-color 0.2s ease'
                            }}
                            onMouseEnter={(e) => e.target.style.backgroundColor = '#3a3a3a'}
                            onMouseLeave={(e) => e.target.style.backgroundColor = 'transparent'}
                        >
                            {(() => {
                                try {
                                    // Convert hex to Uint8Array for display
                                    const neuronIdArray = new Uint8Array(item.neuronIdHex.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
                                    
                                    return formatNeuronDisplayWithContext(
                                        neuronIdArray,
                                        snsRoot,
                                        item.displayInfo,
                                        { 
                                            onNicknameUpdate: handleNicknameUpdate,
                                            style: { fontSize: '14px' },
                                            noLink: true
                                        }
                                    );
                                } catch (e) {
                                    return (
                                        <span style={{ color: '#888', fontFamily: 'monospace' }}>
                                            {item.neuronIdHex}
                                        </span>
                                    );
                                }
                            })()}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export default NeuronInput;
