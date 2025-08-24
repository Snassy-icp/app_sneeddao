import React, { useState, useCallback } from 'react';
import { getPrincipalName, getPrincipalNickname } from './BackendUtils';
import PrincipalContextMenu from '../components/PrincipalContextMenu';
import MessageDialog from '../components/MessageDialog';
import NicknameDialog from '../components/NicknameDialog';

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

// React component for displaying a principal with context menu
export const PrincipalDisplay = React.memo(({ 
    principal, 
    displayInfo = null, 
    showCopyButton = true, 
    style = {}, 
    short = false, 
    noLink = false,
    enableContextMenu = true,
    onNicknameUpdate = null 
}) => {
    const [contextMenuOpen, setContextMenuOpen] = useState(false);
    const [contextMenuPosition, setContextMenuPosition] = useState({ x: 0, y: 0 });
    const [messageDialogOpen, setMessageDialogOpen] = useState(false);
    const [nicknameDialogOpen, setNicknameDialogOpen] = useState(false);
    const [longPressTimer, setLongPressTimer] = useState(null);

    const formatted = formatPrincipal(principal, displayInfo);
    const principalColor = getPrincipalColor(principal);
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
    
    console.log('PrincipalDisplay rendered with:', {
        principal: principalId,
        displayInfo: displayInfo,
        showCopyButton: showCopyButton,
        style: style,
        enableContextMenu: enableContextMenu
    });

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
                        { title: principalId }, 
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
                onSetNickname: handleSetNickname
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
            onSetNickname: handleSetNickname
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
        JSON.stringify(prevProps.style) === JSON.stringify(nextProps.style) &&
        prevProps.short === nextProps.short &&
        prevProps.noLink === nextProps.noLink
    );
}); 