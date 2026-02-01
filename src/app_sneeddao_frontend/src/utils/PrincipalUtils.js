import React, { useState, useCallback, useContext, useMemo } from 'react';
import { sha224 } from '@dfinity/principal/lib/esm/utils/sha224';
import { encodeIcrcAccount } from '@dfinity/ledger-icrc';
import { getPrincipalName, getPrincipalNickname } from './BackendUtils';
import PrincipalContextMenu from '../components/PrincipalContextMenu';
import MessageDialog from '../components/MessageDialog';
import NicknameDialog from '../components/NicknameDialog';
import { PremiumContext } from '../PremiumContext';
import { NamingContext } from '../NamingContext';

// ============================================
// ACCOUNT ID UTILITIES
// ============================================

// CRC32 table for checksum computation
const getCrc32Table = () => {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
        let c = i;
        for (let j = 0; j < 8; j++) {
            c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
        }
        table[i] = c;
    }
    return table;
};

// CRC32 checksum computation
const crc32 = (data) => {
    let crc = 0xffffffff;
    const table = getCrc32Table();
    for (let i = 0; i < data.length; i++) {
        crc = (crc >>> 8) ^ table[(crc ^ data[i]) & 0xff];
    }
    return (crc ^ 0xffffffff) >>> 0;
};

// Compute ICP Account ID from a principal (with optional subaccount)
// Returns a 64-character hex string
export const computeAccountId = (principal, subaccountBytes = null) => {
    try {
        const principalBytes = principal.toUint8Array();
        const domainSeparator = new Uint8Array([0x0a, ...new TextEncoder().encode('account-id')]);
        const subaccount = subaccountBytes || new Uint8Array(32);
        const preimage = new Uint8Array(domainSeparator.length + principalBytes.length + subaccount.length);
        preimage.set(domainSeparator, 0);
        preimage.set(principalBytes, domainSeparator.length);
        preimage.set(subaccount, domainSeparator.length + principalBytes.length);
        const hash = sha224(preimage);
        const crc = crc32(hash);
        const accountId = new Uint8Array(32);
        accountId[0] = (crc >> 24) & 0xff;
        accountId[1] = (crc >> 16) & 0xff;
        accountId[2] = (crc >> 8) & 0xff;
        accountId[3] = crc & 0xff;
        accountId.set(hash, 4);
        return Array.from(accountId).map(b => b.toString(16).padStart(2, '0')).join('');
    } catch (err) {
        console.error('Error computing account ID:', err);
        return null;
    }
};

// ============================================
// PRINCIPAL DISPLAY UTILITIES  
// ============================================

// Truncate a principal ID for display
export const truncatePrincipal = (principal) => {
    if (!principal) return 'Unknown';
    const str = principal.toString();
    if (str.length <= 16) return str;
    return `${str.slice(0, 6)}...${str.slice(-6)}`;
};

// Generate a consistent color for a principal
export const getPrincipalColor = (principal) => {
    if (!principal) return '#888';
    const str = principal.toString();
    const hash = str.split('').reduce((a, b) => {
        a = ((a << 5) - a) + b.charCodeAt(0);
        return a & a;
    }, 0);
    const hue = Math.abs(hash) % 360;
    return `hsl(${hue}, 60%, 70%)`;
};

// Get display info from naming context (optimized version)
export const getPrincipalDisplayInfoFromContext = (principal, principalNames, principalNicknames) => {
    if (!principal) return { name: null, nickname: null, isVerified: false };
    
    const principalStr = principal.toString();
    const name = principalNames?.get(principalStr) || null;
    const nickname = principalNicknames?.get(principalStr) || null;
    
    return { name, nickname, isVerified: false }; // Note: verification status not available in context yet
};

// Get the display name for a principal, including name and verification status (fallback version)
export const getPrincipalDisplayInfo = async (identity, principal) => {
    if (!principal) return { name: null, nickname: null, isVerified: false };

    try {
        // Get public name and verification status
        const nameResponse = await getPrincipalName(identity, principal);
        const name = nameResponse ? nameResponse[0] : null;
        const isVerified = nameResponse ? nameResponse[1] : false;

        // Get private nickname only if identity is provided
        const nickname = identity ? await getPrincipalNickname(identity, principal) : null;

        return { name, nickname, isVerified };
    } catch (error) {
        console.error('Error getting principal display info:', error);
        return { name: null, nickname: null, isVerified: false };
    }
};

// Format a principal for display, including name/nickname if available
export const formatPrincipal = (principal, displayInfo = null) => {
    if (!principal) return 'Unknown';

    const truncated = truncatePrincipal(principal);
    if (!displayInfo) return truncated;

    // Handle array format for name, verification status, and nickname
    const name = displayInfo.name ? (Array.isArray(displayInfo.name) ? displayInfo.name[0] : displayInfo.name) : null;
    const isVerified = displayInfo.name ? (Array.isArray(displayInfo.name) ? displayInfo.name[1] : displayInfo.isVerified) : false;
    const nickname = displayInfo.nickname ? (Array.isArray(displayInfo.nickname) ? displayInfo.nickname[0] : displayInfo.nickname) : null;

    if (!name && !nickname) return truncated;

    return {
        name,
        nickname,
        truncatedId: truncated,
        fullId: principal.toString(),
        isVerified
    };
};

// Detect if a principal is a canister (shorter bytes) vs a user (self-authenticating, longer)
// Canister principals have 10 or fewer bytes, user principals have 29 bytes
// Anonymous principal "2vxsx-fae" is treated as a user
export const isCanisterPrincipal = (principal) => {
    if (!principal) return false;
    try {
        const bytes = principal.toUint8Array();
        // Anonymous principal has 1 byte (0x04), treat as user
        if (bytes.length === 1 && bytes[0] === 0x04) return false;
        // Canister principals have 10 or fewer bytes
        return bytes.length <= 10;
    } catch {
        return false;
    }
};

// Premium crown icon component
const PremiumCrownIcon = ({ size = 14 }) => {
    return React.createElement('svg', {
        width: size,
        height: size,
        viewBox: '0 0 24 24',
        fill: '#FFD700',
        title: 'Sneed Premium Member',
        style: {
            verticalAlign: 'middle',
            marginRight: '2px',
            flexShrink: 0,
            filter: 'drop-shadow(0 1px 2px rgba(255, 215, 0, 0.4))'
        }
    }, React.createElement('path', {
        d: 'M5 16L3 5l5.5 5L12 4l3.5 6L21 5l-2 11H5m14 3c0 .6-.4 1-1 1H6c-.6 0-1-.4-1-1v-1h14v1z'
    }));
};

// User icon component (anonymous/person silhouette)
const UserIcon = ({ size = 14, color = '#888' }) => {
    return React.createElement('svg', {
        width: size,
        height: size,
        viewBox: '0 0 24 24',
        fill: color,
        title: 'User Principal',
        style: {
            verticalAlign: 'middle',
            marginRight: '2px',
            flexShrink: 0,
            opacity: 0.7
        }
    }, React.createElement('path', {
        d: 'M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z'
    }));
};

// Canister icon component (box/cube)
const CanisterIcon = ({ size = 14, color = '#888' }) => {
    return React.createElement('svg', {
        width: size,
        height: size,
        viewBox: '0 0 24 24',
        fill: color,
        title: 'Canister Principal',
        style: {
            verticalAlign: 'middle',
            marginRight: '2px',
            flexShrink: 0,
            opacity: 0.7
        }
    }, React.createElement('path', {
        d: 'M21 16.5c0 .38-.21.71-.53.88l-7.9 4.44c-.16.12-.36.18-.57.18-.21 0-.41-.06-.57-.18l-7.9-4.44A.991.991 0 013 16.5v-9c0-.38.21-.71.53-.88l7.9-4.44c.16-.12.36-.18.57-.18.21 0 .41.06.57.18l7.9 4.44c.32.17.53.5.53.88v9zM12 4.15L6.04 7.5 12 10.85l5.96-3.35L12 4.15zM5 15.91l6 3.38v-6.71L5 9.21v6.7zm14 0v-6.7l-6 3.37v6.71l6-3.38z'
    }));
};

// Principal type icon - shows crown for premium, user/canister icon otherwise
export const PrincipalTypeIcon = ({ principal, isPremium = false, size = 14, color = '#888' }) => {
    // Premium always shows crown
    if (isPremium) {
        return React.createElement(PremiumCrownIcon, { size });
    }
    
    // Otherwise show user or canister icon
    const isCanister = isCanisterPrincipal(principal);
    if (isCanister) {
        return React.createElement(CanisterIcon, { size, color });
    }
    return React.createElement(UserIcon, { size, color });
};

// React component for displaying a principal with context menu
export const PrincipalDisplay = React.memo(({ 
    principal, 
    displayInfo = null, 
    showCopyButton = true, 
    style = {}, 
    short = false, 
    noLink = false,
    enableContextMenu = true,
    isAuthenticated = false,
    onNicknameUpdate = null,
    showSendMessage = true,
    showViewProfile = true,
    subaccount = null // Optional subaccount for ICRC-1 account copy in context menu
}) => {
    const [contextMenuOpen, setContextMenuOpen] = useState(false);
    const [contextMenuPosition, setContextMenuPosition] = useState({ x: 0, y: 0 });
    const [messageDialogOpen, setMessageDialogOpen] = useState(false);
    const [nicknameDialogOpen, setNicknameDialogOpen] = useState(false);
    const [longPressTimer, setLongPressTimer] = useState(null);
    
    // Get premium status from context
    const premiumContext = useContext(PremiumContext);
    const isPremium = premiumContext?.isPremiumMember?.(principal) || false;
    
    // Get naming context for automatic name lookup
    const namingContext = useContext(NamingContext);
    
    // If displayInfo wasn't passed, try to look up from naming context
    const effectiveDisplayInfo = useMemo(() => {
        if (displayInfo) return displayInfo;
        if (!principal || !namingContext) return null;
        
        const principalStr = principal.toString();
        const name = namingContext.principalNames?.get(principalStr);
        const nickname = namingContext.principalNicknames?.get(principalStr);
        const isVerified = namingContext.verifiedNames?.get(principalStr) || false;
        
        if (!name && !nickname) return null;
        
        return { name, nickname, isVerified };
    }, [displayInfo, principal, namingContext?.principalNames, namingContext?.principalNicknames, namingContext?.verifiedNames]);

    const formatted = formatPrincipal(principal, effectiveDisplayInfo);
    
    // Check if color coding is enabled (default to true if not set)
    const colorCodingEnabled = (() => {
        try {
            const saved = localStorage.getItem('principalColorCoding');
            return saved !== null ? JSON.parse(saved) : true;
        } catch {
            return true;
        }
    })();
    const principalColor = colorCodingEnabled ? getPrincipalColor(principal) : '#888888';
    
    const principalId = principal?.toString();
    const currentNickname = formatted?.nickname || effectiveDisplayInfo?.nickname || '';

    // Handle right click (desktop)
    const handleContextMenu = useCallback((e) => {
        if (!enableContextMenu || !principalId) return;
        
        e.preventDefault();
        e.stopPropagation();
        
        // Use clientX/clientY for fixed positioning
        setContextMenuPosition({ x: e.clientX, y: e.clientY });
        setContextMenuOpen(true);
    }, [enableContextMenu, principalId]);

    // Handle long press start (mobile)
    const handleTouchStart = useCallback((e) => {
        if (!enableContextMenu || !principalId) return;
        
        const touch = e.touches[0];
        if (!touch) return;
        
        const timer = setTimeout(() => {
            // Use clientX/clientY for fixed positioning
            setContextMenuPosition({ x: touch.clientX, y: touch.clientY });
            setContextMenuOpen(true);
            
            // Add haptic feedback on mobile if available
            if (navigator.vibrate) {
                navigator.vibrate(50);
            }
        }, 500); // 500ms long press
        
        setLongPressTimer(timer);
    }, [enableContextMenu, principalId]);

    // Handle long press end (mobile)
    const handleTouchEnd = useCallback((e) => {
        if (longPressTimer) {
            clearTimeout(longPressTimer);
            setLongPressTimer(null);
        }
    }, [longPressTimer]);

    // Handle touch move (cancel long press if user moves finger)
    const handleTouchMove = useCallback(() => {
        if (longPressTimer) {
            clearTimeout(longPressTimer);
            setLongPressTimer(null);
        }
    }, [longPressTimer]);

    // Handle context menu close
    const handleContextMenuClose = useCallback(() => {
        setContextMenuOpen(false);
    }, []);

    // Handle send message
    const handleSendMessage = useCallback(() => {
        setMessageDialogOpen(true);
    }, []);

    // Handle set nickname
    const handleSetNickname = useCallback(() => {
        setNicknameDialogOpen(true);
    }, []);

    // Handle nickname update success
    const handleNicknameSuccess = useCallback((newNickname) => {
        if (onNicknameUpdate) {
            onNicknameUpdate(principalId, newNickname);
        }
    }, [principalId, onNicknameUpdate]);

    // Create a link wrapper component
    const LinkWrapper = React.useMemo(() => {
        return ({ children }) => {
            if (noLink) {
                // Return a simple span when links are disabled
                return React.createElement('span', 
                    {
                        style: {
                            color: 'inherit'
                        },
                        onContextMenu: handleContextMenu,
                        onTouchStart: handleTouchStart,
                        onTouchEnd: handleTouchEnd,
                        onTouchMove: handleTouchMove
                    },
                    children
                );
            }
            
            const href = `/principal?id=${principalId}`;
            return React.createElement('a', 
                {
                    href,
                    style: {
                        textDecoration: 'none',
                        color: 'inherit'
                    },
                    onMouseEnter: (e) => e.target.style.textDecoration = 'underline',
                    onMouseLeave: (e) => e.target.style.textDecoration = 'none',
                    onContextMenu: handleContextMenu,
                    onTouchStart: handleTouchStart,
                    onTouchEnd: handleTouchEnd,
                    onTouchMove: handleTouchMove
                },
                children
            );
        };
    }, [principal, noLink, handleContextMenu, handleTouchStart, handleTouchEnd, handleTouchMove, principalId]);
    
    /*console.log('PrincipalDisplay rendered with:', {
        principal: principalId,
        displayInfo: displayInfo,
        showCopyButton: showCopyButton,
        style: style,
        enableContextMenu: enableContextMenu
    });*/

    // If no display info was provided, just show truncated ID
    if (typeof formatted === 'string') {
        return React.createElement(React.Fragment, null,
            React.createElement('span', 
                { 
                    style: { 
                        display: 'inline-flex', 
                        alignItems: 'center', 
                        gap: '4px',
                        color: principalColor,
                        fontFamily: 'monospace',
                        verticalAlign: 'middle',
                        ...style
                    }
                },
                React.createElement(LinkWrapper, null,
                    React.createElement('span', 
                        { 
                            style: { display: 'inline-flex', alignItems: 'center' },
                            title: principalId 
                        },
                        React.createElement(PrincipalTypeIcon, { principal, isPremium, size: 14, color: principalColor }),
                        formatted
                    )
                ),
                showCopyButton && React.createElement('button',
                    {
                        onClick: () => navigator.clipboard.writeText(principalId),
                        style: {
                            background: 'none',
                            border: 'none',
                            padding: '4px',
                            cursor: 'pointer',
                            color: '#888',
                            display: 'flex',
                            alignItems: 'center'
                        },
                        title: "Copy principal ID to clipboard"
                    },
                    "📋"
                )
            ),
            // Context menu
            enableContextMenu && principalId && React.createElement(PrincipalContextMenu, {
                isOpen: contextMenuOpen,
                onClose: handleContextMenuClose,
                position: contextMenuPosition,
                principalId: principalId,
                currentNickname: currentNickname,
                onSendMessage: handleSendMessage,
                onSetNickname: handleSetNickname,
                isAuthenticated: isAuthenticated,
                showSendMessage: showSendMessage,
                showViewProfile: showViewProfile,
                extraMenuItems: subaccount && principal ? [{
                    icon: '📋',
                    label: 'Copy ICRC-1 Account',
                    onClick: () => {
                        try {
                            const account = encodeIcrcAccount({
                                owner: principal,
                                subaccount: subaccount
                            });
                            navigator.clipboard.writeText(account);
                        } catch (err) {
                            console.error('Failed to copy ICRC-1 account:', err);
                        }
                    }
                }] : []
            }),
            // Message dialog
            React.createElement(MessageDialog, {
                isOpen: messageDialogOpen,
                onClose: () => setMessageDialogOpen(false),
                initialRecipient: principalId
            }),
            // Nickname dialog
            React.createElement(NicknameDialog, {
                isOpen: nicknameDialogOpen,
                onClose: () => setNicknameDialogOpen(false),
                principalId: principalId,
                currentNickname: currentNickname,
                onSuccess: handleNicknameSuccess
            })
        );
    }

    // Show compact display with name and/or nickname
    return React.createElement(React.Fragment, null,
        React.createElement('span',
            {
                style: {
                    display: 'inline',
                    color: principalColor,
                    verticalAlign: 'middle',
                    ...style
                }
            },
            React.createElement(LinkWrapper, null,
                React.createElement('span',
                    {
                        style: {
                            display: 'inline'
                        },
                        title: formatted.fullId
                    },
                    // Principal type icon (crown for premium, user/canister otherwise)
                    React.createElement('span', 
                        { style: { display: 'inline-flex', alignItems: 'center', verticalAlign: 'middle', marginRight: '4px' } },
                        React.createElement(PrincipalTypeIcon, { principal, isPremium, size: 14, color: principalColor })
                    ),
                    formatted.name && React.createElement('span',
                        {
                            style: {
                                fontWeight: '500',
                                color: principalColor
                            }
                        },
                        formatted.isVerified && React.createElement('span',
                            {
                                style: {
                                    fontSize: '14px',
                                    cursor: 'help',
                                    color: '#2ecc71',
                                    marginRight: '2px'
                                },
                                title: "Verified name"
                            },
                            "✓"
                        ),
                        formatted.name
                    ),
                    (formatted.name && formatted.nickname && formatted.name.length > 0 && formatted.nickname.length > 0) ? " • " : null,
                    formatted.nickname && React.createElement('span',
                        {
                            style: {
                                fontStyle: 'italic',
                                color: principalColor
                            }
                        },
                        formatted.nickname
                    ),
                    // Only show truncated ID if not in short mode, or if there's no name/nickname
                    (!short || (!formatted.name && !formatted.nickname)) && React.createElement('span',
                        {
                            style: {
                                marginLeft: '4px',
                                color: principalColor,
                                opacity: 0.7
                            }
                        },
                        `(${formatted.truncatedId})`
                    )
                )
            ),
            showCopyButton && React.createElement('span',
                { style: { display: 'inline-flex', alignItems: 'center', verticalAlign: 'middle', marginLeft: '4px' } },
                React.createElement('button',
                    {
                        onClick: () => navigator.clipboard.writeText(formatted.fullId),
                        style: {
                            background: 'none',
                            border: 'none',
                            padding: '4px',
                            cursor: 'pointer',
                            color: '#888',
                            display: 'flex',
                            alignItems: 'center'
                        },
                        title: "Copy principal ID to clipboard"
                    },
                    "📋"
                )
            )
        ),
        // Context menu
        enableContextMenu && principalId && React.createElement(PrincipalContextMenu, {
            isOpen: contextMenuOpen,
            onClose: handleContextMenuClose,
            position: contextMenuPosition,
            principalId: principalId,
            currentNickname: currentNickname,
            onSendMessage: handleSendMessage,
            onSetNickname: handleSetNickname,
            isAuthenticated: isAuthenticated,
            showSendMessage: showSendMessage,
            showViewProfile: showViewProfile,
            extraMenuItems: subaccount && principal ? [{
                icon: '📋',
                label: 'Copy ICRC-1 Account',
                onClick: () => {
                    try {
                        const account = encodeIcrcAccount({
                            owner: principal,
                            subaccount: subaccount
                        });
                        navigator.clipboard.writeText(account);
                    } catch (err) {
                        console.error('Failed to copy ICRC-1 account:', err);
                    }
                }
            }] : []
        }),
        // Message dialog
        React.createElement(MessageDialog, {
            isOpen: messageDialogOpen,
            onClose: () => setMessageDialogOpen(false),
            initialRecipient: principalId
        }),
        // Nickname dialog
        React.createElement(NicknameDialog, {
            isOpen: nicknameDialogOpen,
            onClose: () => setNicknameDialogOpen(false),
            principalId: principalId,
            currentNickname: currentNickname,
            onSuccess: handleNicknameSuccess
        })
    );
}, (prevProps, nextProps) => {
    // Custom comparison function for React.memo
    return (
        prevProps.principal?.toString() === nextProps.principal?.toString() &&
        JSON.stringify(prevProps.displayInfo) === JSON.stringify(nextProps.displayInfo) &&
        prevProps.showCopyButton === nextProps.showCopyButton &&
        prevProps.enableContextMenu === nextProps.enableContextMenu &&
        prevProps.isAuthenticated === nextProps.isAuthenticated &&
        JSON.stringify(prevProps.style) === JSON.stringify(nextProps.style) &&
        prevProps.short === nextProps.short &&
        prevProps.noLink === nextProps.noLink &&
        prevProps.showSendMessage === nextProps.showSendMessage &&
        prevProps.showViewProfile === nextProps.showViewProfile
    );
}); 