import React, { useState, useEffect, useRef, useMemo } from 'react';
import ReactDOM from 'react-dom';
import { Principal } from '@dfinity/principal';
import { decodeIcrcAccount, encodeIcrcAccount } from '@dfinity/ledger-icrc';
import { useNaming } from '../NamingContext';
import { useTheme } from '../contexts/ThemeContext';
import { PrincipalDisplay, getPrincipalDisplayInfoFromContext } from '../utils/PrincipalUtils';
import { FaUser, FaCube, FaPen, FaWallet, FaTimes, FaCopy, FaExchangeAlt, FaCheck } from 'react-icons/fa';

// Helper to convert bytes to hex
const bytesToHex = (bytes) => {
    if (!bytes || bytes.length === 0) return '';
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
};

// Helper to convert hex to bytes
const hexToBytes = (hex) => {
    if (!hex) return null;
    const cleanHex = hex.replace(/^0x/i, '').replace(/\s/g, '');
    if (!/^[0-9a-fA-F]*$/.test(cleanHex)) return null;
    if (cleanHex.length === 0) return null;
    // Pad to 64 chars (32 bytes)
    const paddedHex = cleanHex.padStart(64, '0');
    return new Uint8Array(paddedHex.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
};

// Parse any account format (ICRC-1 encoded or plain principal)
const parseAccountString = (input) => {
    if (!input || typeof input !== 'string') return null;
    const trimmed = input.trim();
    if (!trimmed) return null;
    
    // Try ICRC-1 encoded format first (contains '.')
    if (trimmed.includes('.')) {
        try {
            const decoded = decodeIcrcAccount(trimmed);
            if (decoded && decoded.owner) {
                return {
                    principal: decoded.owner,
                    subaccount: decoded.subaccount ? new Uint8Array(decoded.subaccount) : null,
                    isEncoded: true
                };
            }
        } catch (e) {
            // Not valid ICRC account
        }
    }
    
    // Try as plain principal
    try {
        const principal = Principal.fromText(trimmed);
        return { principal, subaccount: null, isEncoded: false };
    } catch (e) {
        return null;
    }
};

// Check if subaccount is all zeros (default)
const isDefaultSubaccount = (subaccount) => {
    if (!subaccount || subaccount.length === 0) return true;
    return subaccount.every(b => b === 0);
};

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
    defaultPrincipalType = 'both', // 'users' | 'canisters' | 'both'
    onSelect = null, // Called when user selects from dropdown (principalStr) - use for navigate-on-select
    onFocus: onFocusProp,
    onBlur: onBlurProp,
    // Subaccount support props
    showSubaccountOption = false, // If true, show a button to open subaccount dialog
    onAccountChange = null // Callback with { principal: string, subaccount: Uint8Array|null, encoded: string }
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
    const [isEditing, setIsEditing] = useState(!value); // Start in edit mode if no initial value
    const inputRef = useRef(null);
    const dropdownRef = useRef(null);
    const containerRef = useRef(null);
    
    // Subaccount dialog state
    const [showSubaccountDialog, setShowSubaccountDialog] = useState(false);
    const [dialogPrincipal, setDialogPrincipal] = useState('');
    const [dialogSubaccountHex, setDialogSubaccountHex] = useState('');
    const [dialogEncodedAccount, setDialogEncodedAccount] = useState('');
    const [dialogMode, setDialogMode] = useState('split'); // 'split' or 'encoded'
    const [dialogError, setDialogError] = useState('');
    const [copiedField, setCopiedField] = useState(null);

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

    // Sync internal input value with external value prop
    useEffect(() => {
        setInputValue(value);
        // If value is externally set to a valid principal, exit edit mode
        if (value) {
            try {
                Principal.fromText(value.trim());
                setIsEditing(false);
            } catch (e) {
                // Invalid principal, stay in edit mode
            }
        } else {
            // No value, enter edit mode
            setIsEditing(true);
        }
    }, [value]);

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
        setIsEditing(false); // Exit edit mode after selection
        
        if (onChange) {
            onChange(item.principalStr);
        }
        if (onSelect) {
            onSelect(item.principalStr);
        }
    };

    // Handle input focus
    const handleFocus = () => {
        if (inputValue.trim()) {
            setShowDropdown(true);
        }
        if (onFocusProp) onFocusProp();
    };

    // Handle input blur
    const handleBlur = (e) => {
        // Delay to allow dropdown clicks
        setTimeout(() => {
            if (!dropdownRef.current?.contains(e.relatedTarget)) {
                setShowDropdown(false);
                // Exit edit mode if we have a valid principal
                if (isValid) {
                    setIsEditing(false);
                }
            }
        }, 150);
        if (onBlurProp) onBlurProp();
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

    // Handle entering edit mode
    const handleEditClick = () => {
        setIsEditing(true);
        // Focus the input after state update
        setTimeout(() => {
            inputRef.current?.focus();
            inputRef.current?.select();
        }, 0);
    };

    // Handle clearing the selection
    const handleClear = () => {
        setInputValue('');
        setIsEditing(true);
        if (onChange) {
            onChange('');
        }
        setTimeout(() => {
            inputRef.current?.focus();
        }, 0);
    };

    // === Subaccount Dialog Handlers ===
    
    // Open dialog with current value parsed
    const handleOpenSubaccountDialog = () => {
        setDialogError('');
        setCopiedField(null);
        
        const parsed = parseAccountString(inputValue);
        if (parsed) {
            setDialogPrincipal(parsed.principal.toText());
            if (parsed.subaccount && !isDefaultSubaccount(parsed.subaccount)) {
                setDialogSubaccountHex(bytesToHex(parsed.subaccount));
            } else {
                setDialogSubaccountHex('');
            }
            // Generate encoded version
            try {
                const encoded = encodeIcrcAccount({
                    owner: parsed.principal,
                    subaccount: parsed.subaccount && !isDefaultSubaccount(parsed.subaccount) ? parsed.subaccount : undefined
                });
                setDialogEncodedAccount(encoded);
            } catch (e) {
                setDialogEncodedAccount('');
            }
            setDialogMode('split');
        } else {
            setDialogPrincipal('');
            setDialogSubaccountHex('');
            setDialogEncodedAccount('');
            setDialogMode('split');
        }
        setShowSubaccountDialog(true);
    };
    
    // Handle encoded account input change
    const handleEncodedAccountChange = (val) => {
        setDialogEncodedAccount(val);
        setDialogError('');
        
        const parsed = parseAccountString(val);
        if (parsed) {
            setDialogPrincipal(parsed.principal.toText());
            if (parsed.subaccount && !isDefaultSubaccount(parsed.subaccount)) {
                setDialogSubaccountHex(bytesToHex(parsed.subaccount));
            } else {
                setDialogSubaccountHex('');
            }
        }
    };
    
    // Handle principal change in split mode
    const handleDialogPrincipalChange = (val) => {
        setDialogPrincipal(val);
        setDialogError('');
        updateEncodedFromSplit(val, dialogSubaccountHex);
    };
    
    // Handle subaccount hex change in split mode
    const handleDialogSubaccountChange = (val) => {
        setDialogSubaccountHex(val);
        setDialogError('');
        updateEncodedFromSplit(dialogPrincipal, val);
    };
    
    // Update encoded account from split values
    const updateEncodedFromSplit = (principal, subHex) => {
        try {
            const principalText = principal?.trim?.() || '';
            if (!principalText) {
                setDialogEncodedAccount('');
                return;
            }
            const p = Principal.fromText(principalText);
            const subBytes = subHex.trim() ? hexToBytes(subHex) : null;
            const encoded = encodeIcrcAccount({
                owner: p,
                subaccount: subBytes && !isDefaultSubaccount(subBytes) ? subBytes : undefined
            });
            setDialogEncodedAccount(encoded);
        } catch (e) {
            // Invalid input, don't update encoded
        }
    };
    
    // Copy to clipboard with feedback
    const handleCopy = async (text, field) => {
        try {
            await navigator.clipboard.writeText(text);
            setCopiedField(field);
            setTimeout(() => setCopiedField(null), 1500);
        } catch (e) {
            // Fallback
        }
    };
    
    // Apply the dialog values
    const handleApplySubaccount = () => {
        setDialogError('');
        
        let finalValue = '';
        let parsedAccount = null;
        
        if (dialogMode === 'encoded') {
            // Use the encoded account directly
            parsedAccount = parseAccountString(dialogEncodedAccount);
            if (!parsedAccount) {
                setDialogError('Invalid encoded account format');
                return;
            }
            finalValue = dialogEncodedAccount.trim();
        } else {
            // Use split principal + subaccount
            if (!dialogPrincipal.trim()) {
                setDialogError('Please enter a principal');
                return;
            }
            
            try {
                const principal = Principal.fromText(dialogPrincipal.trim());
                const subBytes = dialogSubaccountHex.trim() ? hexToBytes(dialogSubaccountHex) : null;
                
                if (dialogSubaccountHex.trim() && !subBytes) {
                    setDialogError('Invalid subaccount hex format');
                    return;
                }
                
                // If there's a non-default subaccount, encode as ICRC-1 account
                if (subBytes && !isDefaultSubaccount(subBytes)) {
                    finalValue = encodeIcrcAccount({
                        owner: principal,
                        subaccount: subBytes
                    });
                    parsedAccount = { principal, subaccount: subBytes, isEncoded: true };
                } else {
                    // Just use principal
                    finalValue = dialogPrincipal.trim();
                    parsedAccount = { principal, subaccount: null, isEncoded: false };
                }
            } catch (e) {
                setDialogError('Invalid principal format');
                return;
            }
        }
        
        // Apply the value
        setInputValue(finalValue);
        setShowSubaccountDialog(false);
        setIsEditing(false);
        
        if (onChange) {
            onChange(finalValue);
        }
        
        if (onAccountChange && parsedAccount) {
            onAccountChange({
                principal: parsedAccount.principal.toText(),
                subaccount: parsedAccount.subaccount,
                encoded: finalValue
            });
        }
    };

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
            {/* Display View - shown when valid principal selected and not editing */}
            {isValid && !isEditing && (
                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '6px 12px',
                    border: `1px solid ${theme.colors.border}`,
                    borderRadius: '8px',
                    backgroundColor: theme.colors.tertiaryBg,
                    minHeight: '38px'
                }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                        {(() => {
                            try {
                                const principal = Principal.fromText(inputValue.trim());
                                const displayInfo = getPrincipalDisplayInfoFromContext(principal, principalNames, principalNicknames);
                                return (
                                    <PrincipalDisplay
                                        principal={principal}
                                        displayInfo={displayInfo}
                                        showCopyButton={false}
                                        style={{ fontSize: '14px' }}
                                        noLink={true}
                                        short={true}
                                        isAuthenticated={isAuthenticated}
                                    />
                                );
                            } catch (e) {
                                return <span style={{ color: theme.colors.mutedText }}>{inputValue}</span>;
                            }
                        })()}
                    </div>
                    <button
                        type="button"
                        onClick={handleEditClick}
                        disabled={disabled}
                        style={{
                            background: 'none',
                            border: 'none',
                            padding: '4px',
                            cursor: disabled ? 'not-allowed' : 'pointer',
                            color: theme.colors.mutedText,
                            display: 'flex',
                            alignItems: 'center',
                            opacity: disabled ? 0.5 : 1,
                            transition: 'color 0.2s ease'
                        }}
                        onMouseEnter={(e) => !disabled && (e.currentTarget.style.color = theme.colors.accent)}
                        onMouseLeave={(e) => (e.currentTarget.style.color = theme.colors.mutedText)}
                        title="Edit"
                    >
                        <FaPen size={12} />
                    </button>
                </div>
            )}

            {/* Edit View - shown when editing or no valid principal */}
            {(isEditing || !isValid) && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
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
                            flex: 1,
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
                    {showSubaccountOption && (
                        <button
                            type="button"
                            onClick={handleOpenSubaccountDialog}
                            disabled={disabled}
                            style={{
                                background: 'none',
                                border: `1px solid ${theme.colors.border}`,
                                borderRadius: '6px',
                                padding: '7px 8px',
                                cursor: disabled ? 'not-allowed' : 'pointer',
                                color: theme.colors.mutedText,
                                display: 'flex',
                                alignItems: 'center',
                                opacity: disabled ? 0.5 : 1,
                                transition: 'all 0.2s ease',
                                flexShrink: 0
                            }}
                            onMouseEnter={(e) => {
                                if (!disabled) {
                                    e.currentTarget.style.borderColor = theme.colors.accent;
                                    e.currentTarget.style.color = theme.colors.accent;
                                }
                            }}
                            onMouseLeave={(e) => {
                                e.currentTarget.style.borderColor = theme.colors.border;
                                e.currentTarget.style.color = theme.colors.mutedText;
                            }}
                            title="Add subaccount"
                        >
                            <FaWallet size={12} />
                        </button>
                    )}
                </div>
            )}
            
            {/* Dropdown - rendered via portal to ensure it's above everything (show even when no matches so user can change filters) */}
            {showDropdown && inputValue.trim() && ReactDOM.createPortal(
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
                                onClick={() => {
                                    // If turning off users and canisters would also be off, turn on canisters instead
                                    if (showUsers && !showCanisters) {
                                        setShowCanisters(true);
                                    }
                                    setShowUsers(!showUsers);
                                }}
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
                                onClick={() => {
                                    // If turning off canisters and users would also be off, turn on users instead
                                    if (showCanisters && !showUsers) {
                                        setShowUsers(true);
                                    }
                                    setShowCanisters(!showCanisters);
                                }}
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
                    {searchResults.length === 0 ? (
                        <div style={{ padding: '10px 12px', color: theme.colors.mutedText, fontSize: '12px' }}>
                            No matches in <strong>{activeTab === 'private' ? 'Private (nicknames)' : activeTab === 'public' ? 'Public (names)' : 'All'}</strong>.
                            Try switching tabs or toggling users/canisters.
                        </div>
                    ) : (
                    searchResults.map((item, index) => (
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
                    ))
                    )}
                </div>,
                document.body
            )}
            
            {/* Subaccount Dialog */}
            {showSubaccountDialog && ReactDOM.createPortal(
                <div
                    style={{
                        position: 'fixed',
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        backgroundColor: 'rgba(0, 0, 0, 0.6)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        zIndex: 100000,
                        padding: '1rem'
                    }}
                    onClick={() => setShowSubaccountDialog(false)}
                >
                    <div
                        style={{
                            backgroundColor: theme.colors.secondaryBg,
                            borderRadius: '16px',
                            padding: '1.5rem',
                            width: '100%',
                            maxWidth: '480px',
                            maxHeight: '90vh',
                            overflowY: 'auto',
                            boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
                            border: `1px solid ${theme.colors.border}`
                        }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Dialog Header */}
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                <div style={{
                                    width: '36px',
                                    height: '36px',
                                    borderRadius: '10px',
                                    background: `linear-gradient(135deg, ${theme.colors.accent}, ${theme.colors.accent}80)`,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center'
                                }}>
                                    <FaWallet size={16} color="white" />
                                </div>
                                <h3 style={{ color: theme.colors.primaryText, margin: 0, fontSize: '1.1rem', fontWeight: '600' }}>
                                    Account with Subaccount
                                </h3>
                            </div>
                            <button
                                onClick={() => setShowSubaccountDialog(false)}
                                style={{
                                    background: 'none',
                                    border: 'none',
                                    padding: '8px',
                                    cursor: 'pointer',
                                    color: theme.colors.mutedText,
                                    display: 'flex',
                                    alignItems: 'center',
                                    borderRadius: '6px'
                                }}
                                onMouseEnter={(e) => e.target.style.backgroundColor = theme.colors.primaryBg}
                                onMouseLeave={(e) => e.target.style.backgroundColor = 'transparent'}
                            >
                                <FaTimes size={16} />
                            </button>
                        </div>
                        
                        {/* Mode Toggle */}
                        <div style={{
                            display: 'flex',
                            padding: '4px',
                            background: theme.colors.primaryBg,
                            borderRadius: '10px',
                            marginBottom: '1rem'
                        }}>
                            <button
                                onClick={() => setDialogMode('split')}
                                style={{
                                    flex: 1,
                                    padding: '0.6rem 1rem',
                                    borderRadius: '8px',
                                    border: 'none',
                                    background: dialogMode === 'split' ? theme.colors.accent : 'transparent',
                                    color: dialogMode === 'split' ? 'white' : theme.colors.mutedText,
                                    fontSize: '0.85rem',
                                    fontWeight: '600',
                                    cursor: 'pointer',
                                    transition: 'all 0.15s ease'
                                }}
                            >
                                Principal + Subaccount
                            </button>
                            <button
                                onClick={() => setDialogMode('encoded')}
                                style={{
                                    flex: 1,
                                    padding: '0.6rem 1rem',
                                    borderRadius: '8px',
                                    border: 'none',
                                    background: dialogMode === 'encoded' ? theme.colors.accent : 'transparent',
                                    color: dialogMode === 'encoded' ? 'white' : theme.colors.mutedText,
                                    fontSize: '0.85rem',
                                    fontWeight: '600',
                                    cursor: 'pointer',
                                    transition: 'all 0.15s ease'
                                }}
                            >
                                Encoded Account
                            </button>
                        </div>
                        
                        {/* Split Mode Inputs */}
                        {dialogMode === 'split' && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                                {/* Principal Input */}
                                <div>
                                    <label style={{ display: 'block', fontSize: '0.8rem', color: theme.colors.mutedText, marginBottom: '0.4rem', fontWeight: '500' }}>
                                        Principal
                                    </label>
                                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                                        <input
                                            type="text"
                                            value={dialogPrincipal}
                                            onChange={(e) => handleDialogPrincipalChange(e.target.value)}
                                            placeholder="e.g. ryjl3-tyaaa-aaaaa-aaaba-cai"
                                            style={{
                                                flex: 1,
                                                padding: '0.65rem 0.9rem',
                                                borderRadius: '8px',
                                                border: `1px solid ${theme.colors.border}`,
                                                background: theme.colors.primaryBg,
                                                color: theme.colors.primaryText,
                                                fontSize: '0.9rem',
                                                fontFamily: 'monospace',
                                                outline: 'none'
                                            }}
                                            onFocus={(e) => e.target.style.borderColor = theme.colors.accent}
                                            onBlur={(e) => e.target.style.borderColor = theme.colors.border}
                                        />
                                        <button
                                            onClick={() => handleCopy(dialogPrincipal, 'principal')}
                                            disabled={!dialogPrincipal}
                                            style={{
                                                padding: '0.65rem',
                                                borderRadius: '8px',
                                                border: `1px solid ${theme.colors.border}`,
                                                background: theme.colors.primaryBg,
                                                color: copiedField === 'principal' ? theme.colors.accent : theme.colors.mutedText,
                                                cursor: dialogPrincipal ? 'pointer' : 'not-allowed',
                                                opacity: dialogPrincipal ? 1 : 0.5
                                            }}
                                            title="Copy principal"
                                        >
                                            {copiedField === 'principal' ? <FaCheck size={12} /> : <FaCopy size={12} />}
                                        </button>
                                    </div>
                                </div>
                                
                                {/* Subaccount Input */}
                                <div>
                                    <label style={{ display: 'block', fontSize: '0.8rem', color: theme.colors.mutedText, marginBottom: '0.4rem', fontWeight: '500' }}>
                                        Subaccount (hex) <span style={{ fontWeight: '400', opacity: 0.7 }}>- optional</span>
                                    </label>
                                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                                        <input
                                            type="text"
                                            value={dialogSubaccountHex}
                                            onChange={(e) => handleDialogSubaccountChange(e.target.value)}
                                            placeholder="e.g. 0102030405... (up to 64 hex chars)"
                                            style={{
                                                flex: 1,
                                                padding: '0.65rem 0.9rem',
                                                borderRadius: '8px',
                                                border: `1px solid ${theme.colors.border}`,
                                                background: theme.colors.primaryBg,
                                                color: theme.colors.primaryText,
                                                fontSize: '0.9rem',
                                                fontFamily: 'monospace',
                                                outline: 'none'
                                            }}
                                            onFocus={(e) => e.target.style.borderColor = theme.colors.accent}
                                            onBlur={(e) => e.target.style.borderColor = theme.colors.border}
                                        />
                                        <button
                                            onClick={() => handleCopy(dialogSubaccountHex, 'subaccount')}
                                            disabled={!dialogSubaccountHex}
                                            style={{
                                                padding: '0.65rem',
                                                borderRadius: '8px',
                                                border: `1px solid ${theme.colors.border}`,
                                                background: theme.colors.primaryBg,
                                                color: copiedField === 'subaccount' ? theme.colors.accent : theme.colors.mutedText,
                                                cursor: dialogSubaccountHex ? 'pointer' : 'not-allowed',
                                                opacity: dialogSubaccountHex ? 1 : 0.5
                                            }}
                                            title="Copy subaccount"
                                        >
                                            {copiedField === 'subaccount' ? <FaCheck size={12} /> : <FaCopy size={12} />}
                                        </button>
                                    </div>
                                </div>
                                
                                {/* Encoded Preview */}
                                {dialogEncodedAccount && (
                                    <div style={{
                                        padding: '0.75rem',
                                        background: theme.colors.primaryBg,
                                        borderRadius: '8px',
                                        border: `1px solid ${theme.colors.border}`
                                    }}>
                                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.35rem' }}>
                                            <span style={{ fontSize: '0.75rem', color: theme.colors.mutedText }}>Encoded Account</span>
                                            <button
                                                onClick={() => handleCopy(dialogEncodedAccount, 'encoded')}
                                                style={{
                                                    background: 'none',
                                                    border: 'none',
                                                    padding: '2px',
                                                    cursor: 'pointer',
                                                    color: copiedField === 'encoded' ? theme.colors.accent : theme.colors.mutedText
                                                }}
                                                title="Copy encoded account"
                                            >
                                                {copiedField === 'encoded' ? <FaCheck size={10} /> : <FaCopy size={10} />}
                                            </button>
                                        </div>
                                        <div style={{
                                            fontFamily: 'monospace',
                                            fontSize: '0.8rem',
                                            color: theme.colors.secondaryText,
                                            wordBreak: 'break-all',
                                            lineHeight: '1.4'
                                        }}>
                                            {dialogEncodedAccount}
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                        
                        {/* Encoded Mode Input */}
                        {dialogMode === 'encoded' && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                                <div>
                                    <label style={{ display: 'block', fontSize: '0.8rem', color: theme.colors.mutedText, marginBottom: '0.4rem', fontWeight: '500' }}>
                                        ICRC-1 Account (encoded)
                                    </label>
                                    <textarea
                                        value={dialogEncodedAccount}
                                        onChange={(e) => handleEncodedAccountChange(e.target.value)}
                                        placeholder="Paste encoded account (e.g. principal.checksum-subaccount)"
                                        rows={3}
                                        style={{
                                            width: '100%',
                                            padding: '0.65rem 0.9rem',
                                            borderRadius: '8px',
                                            border: `1px solid ${theme.colors.border}`,
                                            background: theme.colors.primaryBg,
                                            color: theme.colors.primaryText,
                                            fontSize: '0.85rem',
                                            fontFamily: 'monospace',
                                            outline: 'none',
                                            resize: 'vertical',
                                            boxSizing: 'border-box'
                                        }}
                                        onFocus={(e) => e.target.style.borderColor = theme.colors.accent}
                                        onBlur={(e) => e.target.style.borderColor = theme.colors.border}
                                    />
                                </div>
                                
                                {/* Parsed Preview */}
                                {dialogPrincipal && (
                                    <div style={{
                                        padding: '0.75rem',
                                        background: theme.colors.primaryBg,
                                        borderRadius: '8px',
                                        border: `1px solid ${theme.colors.border}`
                                    }}>
                                        <div style={{ fontSize: '0.75rem', color: theme.colors.mutedText, marginBottom: '0.5rem' }}>Parsed Values</div>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                <span style={{ fontSize: '0.75rem', color: theme.colors.mutedText, minWidth: '70px' }}>Principal:</span>
                                                <span style={{ fontFamily: 'monospace', fontSize: '0.8rem', color: theme.colors.secondaryText, wordBreak: 'break-all' }}>
                                                    {dialogPrincipal}
                                                </span>
                                            </div>
                                            {dialogSubaccountHex && (
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                    <span style={{ fontSize: '0.75rem', color: theme.colors.mutedText, minWidth: '70px' }}>Subaccount:</span>
                                                    <span style={{ fontFamily: 'monospace', fontSize: '0.8rem', color: theme.colors.secondaryText, wordBreak: 'break-all' }}>
                                                        {dialogSubaccountHex.length > 32 ? `${dialogSubaccountHex.substring(0, 16)}...${dialogSubaccountHex.substring(dialogSubaccountHex.length - 16)}` : dialogSubaccountHex}
                                                    </span>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                        
                        {/* Error Message */}
                        {dialogError && (
                            <div style={{
                                marginTop: '1rem',
                                padding: '0.6rem 0.9rem',
                                background: `${theme.colors.error}15`,
                                border: `1px solid ${theme.colors.error}40`,
                                borderRadius: '8px',
                                color: theme.colors.error,
                                fontSize: '0.85rem'
                            }}>
                                {dialogError}
                            </div>
                        )}
                        
                        {/* Action Buttons */}
                        <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.25rem' }}>
                            <button
                                onClick={() => setShowSubaccountDialog(false)}
                                style={{
                                    flex: 1,
                                    padding: '0.7rem 1rem',
                                    borderRadius: '8px',
                                    border: `1px solid ${theme.colors.border}`,
                                    background: 'transparent',
                                    color: theme.colors.secondaryText,
                                    fontSize: '0.9rem',
                                    fontWeight: '500',
                                    cursor: 'pointer'
                                }}
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleApplySubaccount}
                                style={{
                                    flex: 1,
                                    padding: '0.7rem 1rem',
                                    borderRadius: '8px',
                                    border: 'none',
                                    background: theme.colors.accent,
                                    color: 'white',
                                    fontSize: '0.9rem',
                                    fontWeight: '600',
                                    cursor: 'pointer'
                                }}
                            >
                                Apply
                            </button>
                        </div>
                    </div>
                </div>,
                document.body
            )}
        </div>
    );
};

export default PrincipalInput;
