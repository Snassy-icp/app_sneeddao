import React, { useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { getNeuronColor, uint8ArrayToHex } from '../utils/NeuronUtils';
import NeuronContextMenu from './NeuronContextMenu';
import NeuronNicknameDialog from './NeuronNicknameDialog';

// Enhanced neuron display component with context menu support
export const NeuronDisplay = React.memo(({ 
    neuronId, 
    snsRoot,
    displayInfo = null,
    showCopyButton = true,
    enableContextMenu = true,
    onNicknameUpdate = null,
    style = {},
    noLink = false
}) => {
    const [contextMenuOpen, setContextMenuOpen] = useState(false);
    const [contextMenuPosition, setContextMenuPosition] = useState({ x: 0, y: 0 });
    const [nicknameDialogOpen, setNicknameDialogOpen] = useState(false);
    const [longPressTimer, setLongPressTimer] = useState(null);

    if (!neuronId || !snsRoot) return null;

    // Convert the neuron ID to a hex string if it's a byte array
    const displayId = Array.isArray(neuronId) || neuronId instanceof Uint8Array 
        ? uint8ArrayToHex(neuronId)
        : typeof neuronId === 'string' 
            ? neuronId 
            : neuronId.toString();

    if (!displayId) return null;

    // Get display info
    const { name, nickname, isVerified } = displayInfo || {};

    // Create truncated ID display (first 6 and last 6 chars)
    const truncatedId = displayId.length > 16 
        ? `${displayId.slice(0, 6)}...${displayId.slice(-6)}`
        : displayId;

    // Get consistent color for this neuron ID
    const neuronColor = getNeuronColor(displayId);

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
        React.createElement('div', {
            style: {
                display: 'flex',
                alignItems: 'flex-start',
                gap: '8px',
                flexWrap: 'wrap',
                width: '100%',
                ...style
            }
        }, [
            // Link or div with name and truncated ID
            React.createElement(noLink ? 'div' : Link, {
                key: 'link',
                ...(noLink ? {} : { to: `/neuron?neuronid=${displayId}&sns=${snsRoot}` }),
                style: {
                    color: neuronColor,
                    textDecoration: 'none',
                    fontFamily: 'monospace',
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '4px',
                    flexWrap: 'wrap',
                    flex: '1'
                },
                title: displayId,
                ...(noLink ? {} : {
                    onMouseEnter: (e) => e.target.style.textDecoration = 'underline',
                    onMouseLeave: (e) => e.target.style.textDecoration = 'none'
                }),
                onContextMenu: handleContextMenu,
                onTouchStart: handleTouchStart,
                onTouchEnd: handleTouchEnd,
                onTouchMove: handleTouchMove
            }, [
                // If there's a name, show it with verification badge
                name && React.createElement('span', {
                    key: 'name-container',
                    style: {
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                        color: neuronColor,
                        fontWeight: 'bold',
                        flexWrap: 'wrap'
                    }
                }, [
                    isVerified && React.createElement('span', {
                        key: 'verified',
                        style: { 
                            color: '#2ecc71',
                            cursor: 'help',
                            fontSize: '14px'
                        },
                        title: 'Verified neuron name'
                    }, '✓'),
                    name
                ]),
                
                // If there's a nickname and it's different from the name, show it
                nickname && (!name || nickname !== name) && React.createElement('span', {
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
                        color: neuronColor,
                        opacity: 0.7
                    }
                }, `[${truncatedId}]`)
            ]),
            
            // Copy button
            showCopyButton && React.createElement('button', {
                key: 'copy',
                onClick: (e) => {
                    e.preventDefault();
                    navigator.clipboard.writeText(displayId);
                },
                style: {
                    background: 'none',
                    border: 'none',
                    padding: '4px',
                    cursor: 'pointer',
                    color: '#888',
                    display: 'flex',
                    alignItems: 'center',
                    flexShrink: 0
                },
                title: 'Copy neuron ID to clipboard'
            }, '📋')
        ]),

        // Context menu
        enableContextMenu && React.createElement(NeuronContextMenu, {
            isOpen: contextMenuOpen,
            onClose: handleContextMenuClose,
            position: contextMenuPosition,
            neuronId: displayId,
            snsRoot: snsRoot,
            currentNickname: nickname || '',
            onSetNickname: handleSetNickname
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
        prevProps.noLink === nextProps.noLink
    );
});

export default NeuronDisplay;
