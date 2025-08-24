import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

const PrincipalContextMenu = ({ 
    isOpen, 
    onClose, 
    position, 
    principalId,
    currentNickname,
    onSendMessage,
    onSetNickname
}) => {
    const navigate = useNavigate();
    const menuRef = useRef(null);

    // Close menu on outside click
    useEffect(() => {
        const handleClickOutside = (event) => {
            if (menuRef.current && !menuRef.current.contains(event.target)) {
                onClose();
            }
        };

        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside);
            document.addEventListener('touchstart', handleClickOutside);
        }

        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('touchstart', handleClickOutside);
        };
    }, [isOpen, onClose]);

    // Close menu on escape key
    useEffect(() => {
        const handleEscape = (event) => {
            if (event.key === 'Escape') {
                onClose();
            }
        };

        if (isOpen) {
            document.addEventListener('keydown', handleEscape);
        }

        return () => {
            document.removeEventListener('keydown', handleEscape);
        };
    }, [isOpen, onClose]);

    const handleSendMessage = () => {
        onSendMessage();
        onClose();
    };

    const handleSetNickname = () => {
        onSetNickname();
        onClose();
    };

    const handleViewProfile = () => {
        navigate(`/principal?id=${principalId}`);
        onClose();
    };

    const handleCopyId = () => {
        navigator.clipboard.writeText(principalId);
        onClose();
    };

    if (!isOpen) return null;

    // Calculate menu position to stay within viewport
    const getMenuStyle = () => {
        const menuWidth = 200;
        const menuHeight = 180; // Approximate height
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        let left = position.x;
        let top = position.y;

        // Adjust horizontal position if menu would go off screen
        if (left + menuWidth > viewportWidth) {
            left = position.x - menuWidth; // Show to the left of cursor
        }
        
        // Ensure menu doesn't go off the left edge
        if (left < 10) {
            left = 10;
        }

        // Adjust vertical position if menu would go off screen
        if (top + menuHeight > viewportHeight) {
            top = position.y - menuHeight; // Show above cursor
        }
        
        // Ensure menu doesn't go off the top edge
        if (top < 10) {
            top = 10;
        }

        return {
            position: 'fixed',
            left: `${left}px`,
            top: `${top}px`,
            zIndex: 10000 // Much higher z-index
        };
    };

    return (
        <div
            ref={menuRef}
            style={{
                ...getMenuStyle(),
                backgroundColor: '#2a2a2a',
                border: '1px solid #3a3a3a',
                borderRadius: '8px',
                boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
                padding: '8px 0',
                minWidth: '200px'
            }}
        >
            <div
                onClick={handleSendMessage}
                style={{
                    padding: '12px 16px',
                    color: '#ffffff',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    fontSize: '14px',
                    transition: 'background-color 0.2s'
                }}
                onMouseEnter={(e) => e.target.style.backgroundColor = '#3a3a3a'}
                onMouseLeave={(e) => e.target.style.backgroundColor = 'transparent'}
            >
                <span>💬</span>
                <span>Send Message</span>
            </div>

            <div
                onClick={handleSetNickname}
                style={{
                    padding: '12px 16px',
                    color: '#ffffff',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    fontSize: '14px',
                    transition: 'background-color 0.2s'
                }}
                onMouseEnter={(e) => e.target.style.backgroundColor = '#3a3a3a'}
                onMouseLeave={(e) => e.target.style.backgroundColor = 'transparent'}
            >
                <span>🏷️</span>
                <span>{currentNickname ? 'Edit Nickname' : 'Set Nickname'}</span>
            </div>

            <div
                onClick={handleViewProfile}
                style={{
                    padding: '12px 16px',
                    color: '#ffffff',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    fontSize: '14px',
                    transition: 'background-color 0.2s'
                }}
                onMouseEnter={(e) => e.target.style.backgroundColor = '#3a3a3a'}
                onMouseLeave={(e) => e.target.style.backgroundColor = 'transparent'}
            >
                <span>👤</span>
                <span>View Profile</span>
            </div>

            <hr style={{
                margin: '8px 0',
                border: 'none',
                borderTop: '1px solid #3a3a3a'
            }} />

            <div
                onClick={handleCopyId}
                style={{
                    padding: '12px 16px',
                    color: '#ffffff',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    fontSize: '14px',
                    transition: 'background-color 0.2s'
                }}
                onMouseEnter={(e) => e.target.style.backgroundColor = '#3a3a3a'}
                onMouseLeave={(e) => e.target.style.backgroundColor = 'transparent'}
            >
                <span>📋</span>
                <span>Copy Principal ID</span>
            </div>
        </div>
    );
};

export default PrincipalContextMenu;
