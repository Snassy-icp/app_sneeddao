import React, { useState, useEffect, useRef, useMemo } from 'react';
import ReactDOM from 'react-dom';
import { Principal } from '@dfinity/principal';
import { useNaming } from '../NamingContext';
import { useTheme } from '../contexts/ThemeContext';
import { PrincipalDisplay, getPrincipalDisplayInfoFromContext } from '../utils/PrincipalUtils';
import { FaUser, FaCube } from 'react-icons/fa';

// Helper to determine if a principal is a canister (shorter) or user (longer)
// Canister principals are typically 27 chars, user principals are 63 chars
const isCanisterPrincipal = (principalStr) => {
    if (!principalStr) return false;
    // Remove hyphens for length check
    const cleaned = principalStr.replace(/-/g, '');
    // Canisters typically have 10 characters (without hyphens), users have 56
    // With hyphens: canisters ~27 chars, users ~63 chars
    return principalStr.length <= 30;
};

const PrincipalInput = ({ 
    value = '', 
    onChange, 
    placeholder = 'Enter principal ID or search by name', 
    style = {},
    inputStyle = {},
    onKeyDown,
    autoFocus = false,
    disabled = false,
    isAuthenticated = false,
    defaultTab = 'private', // 'private' | 'public' | 'all'
    defaultPrincipalType = 'both' // 'users' | 'canisters' | 'both'
}) => {
    const { theme } = useTheme();
    const { principalNames, principalNicknames } = useNaming();
    const [inputValue, setInputValue] = useState(value);
    const [showDropdown, setShowDropdown] = useState(false);
    const [isValid, setIsValid] = useState(false);
    const [resolvedInfo, setResolvedInfo] = useState(null);
    const [activeTab, setActiveTab] = useState(defaultTab);
    const [showUsers, setShowUsers] = useState(defaultPrincipalType === 'users' || defaultPrincipalType === 'both');
    const [showCanisters, setShowCanisters] = useState(defaultPrincipalType === 'canisters' || defaultPrincipalType === 'both');
    const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0, width: 0 });
    const inputRef = useRef(null);
    const dropdownRef = useRef(null);
    const containerRef = useRef(null);

    // Update dropdown position when showing
    useEffect(() => {
        if (showDropdown && containerRef.current) {
            const rect = containerRef.current.getBoundingClientRect();
            setDropdownPosition({
                top: rect.bottom + window.scrollY + 2,
                left: rect.left + window.scrollX,
                width: rect.width
            });
        }
    }, [showDropdown, inputValue]);

    // Keep tab in sync when component instance requests a different default
    useEffect(() => {
        if (defaultTab) setActiveTab(defaultTab);
    }, [defaultTab]);

    // Search and rank principals
    const searchResults = useMemo(() => {
        if (!inputValue.trim()) {
            return [];
        }

        const query = inputValue.trim().toLowerCase();
        const results = [];

        // Collect all principals with their info
        const allPrincipals = new Set();
        
        const includeNicknames = activeTab === 'private' || activeTab === 'all';
        const includeNames = activeTab === 'public' || activeTab === 'all';

        if (includeNames && principalNames) {
            principalNames.forEach((name, principal) => {
                allPrincipals.add(principal);
            });
        }

        if (includeNicknames && principalNicknames) {
            principalNicknames.forEach((nickname, principal) => {
                allPrincipals.add(principal);
            });
        }

        allPrincipals.forEach(principalStr => {
            if (!principalStr || !principalStr.trim()) return; // Skip empty principals
            
            // Filter by principal type (user vs canister)
            const isCanister = isCanisterPrincipal(principalStr);
            if (isCanister && !showCanisters) return;
            if (!isCanister && !showUsers) return;
            
            try {
                const principal = Principal.fromText(principalStr);
                const displayInfo = getPrincipalDisplayInfoFromContext(principal, principalNames, principalNicknames);
                
                const name = displayInfo.name || '';
                const nickname = displayInfo.nickname || '';
                const isVerified = displayInfo.isVerified || false;
                
                let score = 0;
                let matchType = '';
                
                // STRICT tab matching:
                // - private: ONLY match on nickname
                // - public: ONLY match on public name
                // - all: match on either

                const scoreNameStrict = () => {
                    if (!includeNames || !name) return { score: 0, matchType: '' };
                    const n = name.toLowerCase();
                    if (n === query) return { score: isVerified ? 1000 : 900, matchType: 'name-exact' };
                    if (n.startsWith(query)) return { score: isVerified ? 800 : 700, matchType: 'name-start' };
                    if (n.includes(query)) return { score: isVerified ? 600 : 500, matchType: 'name-contains' };
                    return { score: 0, matchType: '' };
                };

                const scoreNicknameStrict = () => {
                    if (!includeNicknames || !nickname) return { score: 0, matchType: '' };
                    const n = nickname.toLowerCase();
                    if (n === query) return { score: 950, matchType: 'nickname-exact' };
                    if (n.startsWith(query)) return { score: 850, matchType: 'nickname-start' };
                    if (n.includes(query)) return { score: 750, matchType: 'nickname-contains' };
                    return { score: 0, matchType: '' };
                };

                if (activeTab === 'private') {
                    const a = scoreNicknameStrict();
                    score = a.score;
                    matchType = a.matchType;
                } else if (activeTab === 'public') {
                    const a = scoreNameStrict();
                    score = a.score;
                    matchType = a.matchType;
                } else {
                    const a = scoreNameStrict();
                    const b = scoreNicknameStrict();
                    score = a.score || b.score;
                    matchType = a.matchType || b.matchType;
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
    }, [inputValue, principalNames, principalNicknames, activeTab, showUsers, showCanisters]);

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
        <div 
            ref={containerRef}
            style={{ 
                position: 'relative', 
                width: '100%',
                maxWidth: '300px',
                ...style 
            }}
        >
            <input
                ref={inputRef}
                type="text"
                value={inputValue}
                onChange={handleInputChange}
                onFocus={handleFocus}
                onBlur={handleBlur}
                onKeyDown={onKeyDown}
                placeholder={placeholder}
                disabled={disabled}
                autoFocus={autoFocus}
                style={{
                    width: '100%',
                    padding: '8px 12px',
                    border: `1px solid ${theme.colors.border}`,
                    borderRadius: '8px',
                    backgroundColor: theme.colors.tertiaryBg,
                    color: theme.colors.primaryText,
                    fontSize: '14px',
                    outline: 'none',
                    transition: 'border-color 0.2s ease, box-shadow 0.2s ease',
                    boxSizing: 'border-box',
                    ...inputStyle
                }}
                onFocusCapture={(e) => {
                    e.target.style.borderColor = theme.colors.accent;
                    e.target.style.boxShadow = `0 0 0 2px ${theme.colors.accent}25`;
                }}
                onBlurCapture={(e) => {
                    e.target.style.borderColor = theme.colors.border;
                    e.target.style.boxShadow = 'none';
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
                                    isAuthenticated={isAuthenticated}
                                />
                            );
                        } catch (e) {
                            return null;
                        }
                    })()}
                </div>
            )}
            
            {/* Dropdown - rendered via portal to ensure it's above everything */}
            {showDropdown && searchResults.length > 0 && ReactDOM.createPortal(
                <div
                    ref={dropdownRef}
                    style={{
                        position: 'absolute',
                        top: dropdownPosition.top,
                        left: dropdownPosition.left,
                        width: dropdownPosition.width,
                        backgroundColor: theme.colors.tertiaryBg,
                        border: `1px solid ${theme.colors.border}`,
                        borderRadius: '8px',
                        maxHeight: '300px',
                        overflowY: 'auto',
                        zIndex: 99999,
                        boxShadow: '0 8px 32px rgba(0,0,0,0.4)'
                    }}
                >
                    {/* Tabs and Type Filters */}
                    <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        padding: '8px',
                        borderBottom: `1px solid ${theme.colors.border}`,
                        position: 'sticky',
                        top: 0,
                        backgroundColor: theme.colors.tertiaryBg,
                        zIndex: 1
                    }}>
                        {/* Name Tabs */}
                        <div style={{ display: 'flex', gap: '4px', flex: 1 }}>
                            {[
                                { key: 'private', label: 'Private' },
                                { key: 'public', label: 'Public' },
                                { key: 'all', label: 'All' }
                            ].map(tab => (
                                <button
                                    key={tab.key}
                                    type="button"
                                    onMouseDown={(e) => e.preventDefault()}
                                    onClick={() => setActiveTab(tab.key)}
                                    style={{
                                        flex: 1,
                                        padding: '5px 6px',
                                        borderRadius: '6px',
                                        border: `1px solid ${activeTab === tab.key ? theme.colors.accent : theme.colors.border}`,
                                        backgroundColor: activeTab === tab.key ? `${theme.colors.accent}20` : theme.colors.primaryBg,
                                        color: activeTab === tab.key ? theme.colors.accent : theme.colors.mutedText,
                                        cursor: 'pointer',
                                        fontSize: '11px',
                                        fontWeight: 600
                                    }}
                                    title={tab.label}
                                >
                                    {tab.label}
                                </button>
                            ))}
                        </div>
                        
                        {/* Separator */}
                        <div style={{ width: '1px', height: '20px', backgroundColor: theme.colors.border }} />
                        
                        {/* Type Filter Toggles */}
                        <div style={{ display: 'flex', gap: '4px' }}>
                            <button
                                type="button"
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => setShowUsers(!showUsers)}
                                style={{
                                    padding: '5px 8px',
                                    borderRadius: '6px',
                                    border: `1px solid ${showUsers ? theme.colors.accent : theme.colors.border}`,
                                    backgroundColor: showUsers ? `${theme.colors.accent}20` : theme.colors.primaryBg,
                                    color: showUsers ? theme.colors.accent : theme.colors.mutedText,
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '4px',
                                    fontSize: '11px'
                                }}
                                title="Show users"
                            >
                                <FaUser size={10} />
                            </button>
                            <button
                                type="button"
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => setShowCanisters(!showCanisters)}
                                style={{
                                    padding: '5px 8px',
                                    borderRadius: '6px',
                                    border: `1px solid ${showCanisters ? theme.colors.accent : theme.colors.border}`,
                                    backgroundColor: showCanisters ? `${theme.colors.accent}20` : theme.colors.primaryBg,
                                    color: showCanisters ? theme.colors.accent : theme.colors.mutedText,
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '4px',
                                    fontSize: '11px'
                                }}
                                title="Show canisters"
                            >
                                <FaCube size={10} />
                            </button>
                        </div>
                    </div>
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
                                isAuthenticated={isAuthenticated}
                            />
                        </div>
                    ))}
                </div>,
                document.body
            )}
        </div>
    );
};

export default PrincipalInput;
