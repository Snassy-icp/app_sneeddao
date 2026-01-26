import React, { useState, useCallback, useContext } from 'react';
import { sha224 } from '@dfinity/principal/lib/esm/utils/sha224';
import { getPrincipalName, getPrincipalNickname } from './BackendUtils';
import PrincipalContextMenu from '../components/PrincipalContextMenu';
import MessageDialog from '../components/MessageDialog';
import NicknameDialog from '../components/NicknameDialog';
import { PremiumContext } from '../PremiumContext';

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

// Premium crown icon component
const PremiumCrownIcon = ({ size = 14 }) => {
    return React.createElement('span', {
        style: {
            display: 'inline-flex',
            alignItems: 'center',
            marginRight: '3px',
            cursor: 'help'
        },
        title: 'Sneed Premium Member'
    }, React.createElement('svg', {
        width: size,
        height: size,
        viewBox: '0 0 24 24',
        fill: '#FFD700',
        style: {
            filter: 'drop-shadow(0 1px 2px rgba(255, 215, 0, 0.4))'
        }
    }, React.createElement('path', {
        d: 'M5 16L3 5l5.5 5L12 4l3.5 6L21 5l-2 11H5m14 3c0 .6-.4 1-1 1H6c-.6 0-1-.4-1-1v-1h14v1z'
    })));
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
    showViewProfile = true
}) => {
    const [contextMenuOpen, setContextMenuOpen] = useState(false);
    const [contextMenuPosition, setContextMenuPosition] = useState({ x: 0, y: 0 });
    const [messageDialogOpen, setMessageDialogOpen] = useState(false);
    const [nicknameDialogOpen, setNicknameDialogOpen] = useState(false);
    const [longPressTimer, setLongPressTimer] = useState(null);
    
    // Get premium status from context
    const premiumContext = useContext(PremiumContext);
    const isPremium = premiumContext?.isPremiumMember?.(principal) || false;

    const formatted = formatPrincipal(principal, displayInfo);
    
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
    const currentNickname = formatted?.nickname || displayInfo?.nickname || '';

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
            React.createElement('div', 
                { 
                    style: { 
                        display: 'inline-flex', 
                        alignItems: 'center', 
                        gap: '8px',
                        color: principalColor,
                        fontFamily: 'monospace',
                        ...style
                    }
                },
                React.createElement(LinkWrapper, null,
                    React.createElement('span', 
                        { 
                            style: { display: 'inline-flex', alignItems: 'center' },
                            title: principalId 
                        },
                        isPremium && React.createElement(PremiumCrownIcon, { size: 14 }),
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
                showViewProfile: showViewProfile
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
        React.createElement('div',
            {
                style: {
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '8px',
                    color: principalColor,
                    fontFamily: 'monospace',
                    ...style
                }
            },
            React.createElement(LinkWrapper, null,
                React.createElement('span',
                    {
                        style: {
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px'
                        },
                        title: formatted.fullId
                    },
                    // Premium crown badge (shown first)
                    isPremium && React.createElement(PremiumCrownIcon, { size: 14 }),
                    formatted.name && React.createElement('span',
                        {
                            style: {
                                fontWeight: 'bold',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '4px',
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
            showCopyButton && React.createElement('button',
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
            showViewProfile: showViewProfile
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