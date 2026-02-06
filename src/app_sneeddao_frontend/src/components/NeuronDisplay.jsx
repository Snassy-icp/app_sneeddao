import React, { useState, useCallback, useContext, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { FaCopy, FaCheck } from 'react-icons/fa';
import { getNeuronColor, uint8ArrayToHex } from '../utils/NeuronUtils';
import { useTheme } from '../contexts/ThemeContext';
import NeuronContextMenu from './NeuronContextMenu';
import NeuronNicknameDialog from './NeuronNicknameDialog';
import { NamingContext } from '../NamingContext';

// Enhanced neuron display component with context menu support
export const NeuronDisplay = React.memo(({ 
    neuronId, 
    snsRoot,
    displayInfo = null,
    showCopyButton = true,
    enableContextMenu = true,
    isAuthenticated = false,
    onNicknameUpdate = null,
    style = {},
    noLink = false,
    variant = 'full'
}) => {
    const { theme } = useTheme();
    const [contextMenuOpen, setContextMenuOpen] = useState(false);
    const [contextMenuPosition, setContextMenuPosition] = useState({ x: 0, y: 0 });
    const [nicknameDialogOpen, setNicknameDialogOpen] = useState(false);
    const [longPressTimer, setLongPressTimer] = useState(null);
    const [copied, setCopied] = useState(false);
    
    // Get naming context for automatic name lookup
    const namingContext = useContext(NamingContext);

    if (!neuronId || !snsRoot) return null;

    // Convert the neuron ID to a hex string if it's a byte array
    const displayId = Array.isArray(neuronId) || neuronId instanceof Uint8Array 
        ? uint8ArrayToHex(neuronId)
        : typeof neuronId === 'string' 
            ? neuronId 
            : neuronId.toString();

    if (!displayId) return null;

    // If displayInfo wasn't passed, try to look up from naming context
    const effectiveDisplayInfo = useMemo(() => {
        if (displayInfo) return displayInfo;
        if (!namingContext) return null;
        
        const mapKey = `${snsRoot}:${displayId}`;
        const name = namingContext.neuronNames?.get(mapKey);
        const nickname = namingContext.neuronNicknames?.get(mapKey);
        const isVerified = namingContext.verifiedNames?.get(mapKey) || false;
        
        if (!name && !nickname) return null;
        
        return { name, nickname, isVerified };
    }, [displayInfo, snsRoot, displayId, namingContext?.neuronNames, namingContext?.neuronNicknames, namingContext?.verifiedNames]);

    // Get display info from effective source
    const { name, nickname, isVerified } = effectiveDisplayInfo || {};

    // Create truncated ID display (first 6 and last 6 chars)
    const truncatedId = displayId.length > 16 
        ? `${displayId.slice(0, 6)}...${displayId.slice(-6)}`
        : displayId;

    // Check if color coding is enabled (default to true if not set)
    const colorCodingEnabled = (() => {
        try {
            const saved = localStorage.getItem('neuronColorCoding');
            return saved !== null ? JSON.parse(saved) : true;
        } catch {
            return true;
        }
    })();
    
    // Get consistent color for this neuron ID (or use default if disabled)
    const neuronColor = colorCodingEnabled ? getNeuronColor(displayId) : '#888888';
    const isCompact = variant === 'compact';
    const displayColor = isCompact ? theme.colors.mutedText : neuronColor;
    const idLabel = isCompact ? truncatedId : `[${truncatedId}]`;

    // Handle right click (desktop)
    const handleContextMenu = useCallback((e) => {
        if (!enableContextMenu) return;
        
        e.preventDefault();
        e.stopPropagation();
        
        setContextMenuPosition({ x: e.clientX, y: e.clientY });
        setContextMenuOpen(true);
    }, [enableContextMenu]);

    // Handle long press start (mobile)
    const handleTouchStart = useCallback((e) => {
        if (!enableContextMenu) return;
        
        const touch = e.touches[0];
        if (!touch) return;
        
        const timer = setTimeout(() => {
            setContextMenuPosition({ x: touch.clientX, y: touch.clientY });
            setContextMenuOpen(true);
            
            // Add haptic feedback on mobile if available
            if (navigator.vibrate) {
                navigator.vibrate(50);
            }
        }, 500); // 500ms long press
        
        setLongPressTimer(timer);
    }, [enableContextMenu]);

    // Handle long press end (mobile)
    const handleTouchEnd = useCallback(() => {
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

    // Handle set nickname
    const handleSetNickname = useCallback(() => {
        setNicknameDialogOpen(true);
    }, []);

    // Handle nickname update success
    const handleNicknameSuccess = useCallback((newNickname) => {
        if (onNicknameUpdate) {
            onNicknameUpdate(displayId, snsRoot, newNickname);
        }
    }, [displayId, snsRoot, onNicknameUpdate]);

    return React.createElement(React.Fragment, null,
        // Main display container
        React.createElement('span', {
            style: {
                display: 'inline-flex',
                alignItems: 'center',
                gap: isCompact ? '4px' : '6px',
                flexWrap: 'wrap',
                ...style
            }
        }, [
            // Link or div with name and truncated ID
            React.createElement(noLink ? 'span' : Link, {
                key: 'link',
                ...(noLink ? {} : { to: `/neuron?neuronid=${displayId}&sns=${snsRoot}` }),
                style: {
                    color: displayColor,
                    textDecoration: 'none',
                    fontFamily: 'monospace',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    flexWrap: 'wrap'
                },
                title: displayId,
                ...(noLink ? {} : {
                    onMouseEnter: (e) => e.target.style.textDecoration = 'underline',
                    onMouseLeave: (e) => e.target.style.textDecoration = 'none'
                }),
                onClick: (e) => {
                    e.stopPropagation();
                },
                onContextMenu: handleContextMenu,
                onTouchStart: handleTouchStart,
                onTouchEnd: handleTouchEnd,
                onTouchMove: handleTouchMove
            }, [
                // If there's a name, show it with verification badge
                !isCompact && name && React.createElement('span', {
                    key: 'name-container',
                    style: {
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                        color: neuronColor,
                        fontWeight: 'bold'
                    }
                }, [
                    isVerified && React.createElement('span', {
                        key: 'verified',
                        style: { 
                            color: theme.colors.mutedText,
                            cursor: 'help',
                            fontSize: '14px'
                        },
                        title: 'Verified neuron name'
                    }, '✓'),
                    name
                ]),
                
                // If there's a nickname and it's different from the name, show it
                !isCompact && nickname && (!name || nickname !== name) && React.createElement('span', {
                    key: 'nickname',
                    style: {
                        color: neuronColor,
                        fontStyle: 'italic'
                    }
                }, `(${nickname})`),
                
                // Always show the truncated ID
                React.createElement('span', {
                    key: 'id',
                    style: {
                        color: displayColor,
                        opacity: isCompact ? 1 : 0.7
                    }
                }, idLabel)
            ]),
            
            // Copy button
            showCopyButton && React.createElement('button', {
                key: 'copy',
                onClick: (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    navigator.clipboard.writeText(displayId);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                },
                style: {
                    background: 'none',
                    border: 'none',
                    padding: '4px',
                    cursor: 'pointer',
                    color: theme.colors.mutedText,
                    display: 'flex',
                    alignItems: 'center',
                    flexShrink: 0,
                    transition: 'opacity 0.2s ease',
                    opacity: copied ? 1 : 0.7
                },
                title: copied ? 'Copied!' : 'Copy neuron ID to clipboard'
            }, React.createElement(copied ? FaCheck : FaCopy, { size: 14 }))
        ]),

        // Context menu
        enableContextMenu && React.createElement(NeuronContextMenu, {
            isOpen: contextMenuOpen,
            onClose: handleContextMenuClose,
            position: contextMenuPosition,
            neuronId: displayId,
            snsRoot: snsRoot,
            currentNickname: nickname || '',
            onSetNickname: handleSetNickname,
            isAuthenticated: isAuthenticated
        }),

        // Nickname dialog
        React.createElement(NeuronNicknameDialog, {
            isOpen: nicknameDialogOpen,
            onClose: () => setNicknameDialogOpen(false),
            neuronId: displayId,
            snsRoot: snsRoot,
            currentNickname: nickname || '',
            onSuccess: handleNicknameSuccess
        })
    );
}, (prevProps, nextProps) => {
    // Custom comparison function for React.memo
    return (
        prevProps.neuronId === nextProps.neuronId &&
        prevProps.snsRoot === nextProps.snsRoot &&
        JSON.stringify(prevProps.displayInfo) === JSON.stringify(nextProps.displayInfo) &&
        prevProps.showCopyButton === nextProps.showCopyButton &&
        prevProps.enableContextMenu === nextProps.enableContextMenu &&
        JSON.stringify(prevProps.style) === JSON.stringify(nextProps.style) &&
        prevProps.noLink === nextProps.noLink &&
        prevProps.variant === nextProps.variant
    );
});

export default NeuronDisplay;
