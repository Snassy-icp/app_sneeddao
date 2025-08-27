import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Principal } from '@dfinity/principal';
import { useNaming } from '../NamingContext';
import { useTheme } from '../contexts/ThemeContext';
import { PrincipalDisplay, getPrincipalDisplayInfoFromContext } from '../utils/PrincipalUtils';

const PrincipalInput = ({ 
    value = '', 
    onChange, 
    placeholder = 'Enter principal ID or search by name', 
    style = {},
    disabled = false 
}) => {
    const { theme } = useTheme();
    const { principalNames, principalNicknames } = useNaming();
    const [inputValue, setInputValue] = useState(value);
    const [showDropdown, setShowDropdown] = useState(false);
    const [isValid, setIsValid] = useState(false);
    const [resolvedInfo, setResolvedInfo] = useState(null);
    const inputRef = useRef(null);
    const dropdownRef = useRef(null);

    // Search and rank principals
    const searchResults = useMemo(() => {
        if (!inputValue.trim() || !principalNames || !principalNicknames) {
            return [];
        }

        const query = inputValue.trim().toLowerCase();
        const results = [];

        // Collect all principals with their info
        const allPrincipals = new Set();
        
        // Add principals from names
        if (principalNames) {
            principalNames.forEach((name, principal) => {
                allPrincipals.add(principal);
            });
        }
        
        // Add principals from nicknames
        if (principalNicknames) {
            principalNicknames.forEach((nickname, principal) => {
                allPrincipals.add(principal);
            });
        }

        allPrincipals.forEach(principalStr => {
            if (!principalStr || !principalStr.trim()) return; // Skip empty principals
            
            try {
                const principal = Principal.fromText(principalStr);
                const displayInfo = getPrincipalDisplayInfoFromContext(principal, principalNames, principalNicknames);
                
                const name = displayInfo.name || '';
                const nickname = displayInfo.nickname || '';
                const isVerified = displayInfo.isVerified || false;
                
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
                
                // Check principal ID matches (lowest priority)
                if (score === 0 && principalStr.toLowerCase().includes(query)) {
                    score = 100; // Principal ID contains
                    matchType = 'principal-contains';
                }
                
                if (score > 0) {
                    results.push({
                        principal,
                        principalStr,
                        displayInfo,
                        score,
                        matchType
                    });
                }
            } catch (e) {
                // Invalid principal, skip
            }
        });

        // Sort by score (highest first) and limit results
        return results
            .sort((a, b) => b.score - a.score)
            .slice(0, 20);
    }, [inputValue, principalNames, principalNicknames]);

    // Validate input and resolve info
    useEffect(() => {
        const trimmed = inputValue.trim();
        
        if (!trimmed) {
            setIsValid(false);
            setResolvedInfo(null);
            return;
        }

        try {
            const principal = Principal.fromText(trimmed);
            setIsValid(true);
            
            // Get display info if available
            if (principalNames && principalNicknames) {
                const displayInfo = getPrincipalDisplayInfoFromContext(principal, principalNames, principalNicknames);
                if (displayInfo.name || displayInfo.nickname) {
                    setResolvedInfo(displayInfo);
                } else {
                    setResolvedInfo(null);
                }
            } else {
                setResolvedInfo(null);
            }
        } catch (e) {
            // Invalid principal - no green border, no resolved info
            setIsValid(false);
            setResolvedInfo(null);
        }
    }, [inputValue, principalNames, principalNicknames]);

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
        setInputValue(item.principalStr);
        setShowDropdown(false);
        
        if (onChange) {
            onChange(item.principalStr);
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

    return (
        <div style={{ 
            position: 'relative', 
            width: '100%',
            maxWidth: '300px',
            ...style 
        }}>
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
                    border: `2px solid ${isValid ? theme.colors.success : theme.colors.border}`,
                    borderRadius: '4px',
                    backgroundColor: theme.colors.tertiaryBg,
                    color: theme.colors.primaryText,
                    fontSize: '14px',
                    outline: 'none',
                    transition: 'border-color 0.2s ease',
                    boxSizing: 'border-box'
                }}
            />
            
            {/* Resolved name display */}
            {resolvedInfo && isValid && (
                <div style={{
                    marginTop: '4px',
                    fontSize: '12px',
                    color: theme.colors.mutedText
                }}>
                    {(() => {
                        try {
                            return (
                                <PrincipalDisplay
                                    principal={Principal.fromText(inputValue.trim())}
                                    displayInfo={resolvedInfo}
                                    showCopyButton={false}
                                    style={{ fontSize: '12px' }}
                                    noLink={true}
                                    short={true}
                                />
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
                        backgroundColor: theme.colors.tertiaryBg,
                        border: `1px solid ${theme.colors.border}`,
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
                            key={item.principalStr}
                            onClick={() => handleSelect(item)}
                            style={{
                                padding: '8px 12px',
                                cursor: 'pointer',
                                borderBottom: index < searchResults.length - 1 ? `1px solid ${theme.colors.border}` : 'none',
                                backgroundColor: 'transparent',
                                transition: 'background-color 0.2s ease'
                            }}
                            onMouseEnter={(e) => e.target.style.backgroundColor = theme.colors.secondaryBg}
                            onMouseLeave={(e) => e.target.style.backgroundColor = 'transparent'}
                        >
                            <PrincipalDisplay
                                principal={item.principal}
                                displayInfo={item.displayInfo}
                                showCopyButton={false}
                                style={{ fontSize: '14px' }}
                                noLink={true}
                                short={true}
                            />
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export default PrincipalInput;
