import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { FaCopy } from 'react-icons/fa';

const NeuronContextMenu = ({ 
    isOpen, 
    onClose, 
    position, 
    neuronId,
    snsRoot,
    currentNickname,
    onSetNickname,
    isAuthenticated = false
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

    const handleSetNickname = () => {
        onSetNickname();
        onClose();
    };

    const handleViewNeuron = () => {
        navigate(`/neuron?neuronid=${neuronId}&sns=${snsRoot}`);
        onClose();
    };

    const handleCopyId = () => {
        navigator.clipboard.writeText(neuronId);
        onClose();
    };

    if (!isOpen) return null;

    // Calculate menu position to stay within viewport (same logic as PrincipalContextMenu)
    const getMenuPosition = () => {
        const menuWidth = 200;
        const menuHeight = 140; // Smaller than principal menu (3 items instead of 4)
        const margin = 10;

        // Start with cursor position plus margin
        let x = position.x + margin;
        let y = position.y + margin;

        // Adjust if menu would go off-screen to the right
        if (x + menuWidth > window.innerWidth) {
            x = position.x - menuWidth - margin;
        }

        // Adjust if menu would go off-screen at the bottom
        if (y + menuHeight > window.innerHeight) {
            y = position.y - menuHeight - margin;
        }

        // Ensure menu doesn't go off-screen at the top or left
        x = Math.max(margin, x);
        y = Math.max(margin, y);

        return { x, y };
    };

    const menuPosition = getMenuPosition();

    return createPortal(
        <div
            ref={menuRef}
            style={{
                position: 'fixed',
                left: menuPosition.x,
                top: menuPosition.y,
                zIndex: 10000,
                backgroundColor: '#2a2a2a',
                border: '1px solid #3a3a3a',
                borderRadius: '8px',
                boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
                padding: '8px 0',
                minWidth: '200px'
            }}
        >
            {isAuthenticated && (
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
            )}

            <div
                onClick={handleViewNeuron}
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
                <span>🧠</span>
                <span>View Neuron</span>
            </div>

            {isAuthenticated && (
                <hr style={{
                    margin: '8px 0',
                    border: 'none',
                    borderTop: '1px solid #3a3a3a'
                }} />
            )}

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
                <FaCopy size={14} />
                <span>Copy Neuron ID</span>
            </div>
        </div>,
        document.body
    );
};

export default NeuronContextMenu;
