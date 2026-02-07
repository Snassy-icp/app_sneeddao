import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { FaInfoCircle } from 'react-icons/fa';
import { useTheme } from '../contexts/ThemeContext';

/**
 * A nice-looking info tooltip that shows on hover.
 * @param {string} text - The tooltip content
 * @param {string} accentColor - Optional accent color for the icon (default: theme accent)
 * @param {number} iconSize - Size of the info icon (default: 12)
 */
const InfoTooltip = ({ text, accentColor, iconSize = 12 }) => {
    const { theme } = useTheme();
    const [visible, setVisible] = useState(false);
    const [position, setPosition] = useState({ top: 0, left: 0 });
    const triggerRef = useRef(null);
    const tooltipRef = useRef(null);

    const accent = accentColor || theme.colors.accent;

    useEffect(() => {
        if (!visible || !triggerRef.current) return;

        const updatePosition = () => {
            if (!triggerRef.current) return;
            const triggerRect = triggerRef.current.getBoundingClientRect();
            const tooltipWidth = 280;
            const margin = 8;

            let top = triggerRect.bottom + margin;
            let left = triggerRect.left + (triggerRect.width / 2) - (tooltipWidth / 2);

            if (left < margin) left = margin;
            if (left + tooltipWidth > window.innerWidth - margin) {
                left = window.innerWidth - tooltipWidth - margin;
            }
            if (top < margin) top = margin;

            setPosition({ top, left });
        };

        updatePosition();
    }, [visible]);

    return (
        <>
            <span
                ref={triggerRef}
                onMouseEnter={() => setVisible(true)}
                onMouseLeave={() => setVisible(false)}
                style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: `${iconSize + 4}px`,
                    height: `${iconSize + 4}px`,
                    borderRadius: '50%',
                    background: `${accent}20`,
                    color: accent,
                    cursor: 'help',
                    flexShrink: 0,
                    marginLeft: '4px'
                }}
            >
                <FaInfoCircle size={iconSize} />
            </span>
            {visible && createPortal(
                <div
                    ref={tooltipRef}
                    onMouseEnter={() => setVisible(true)}
                    onMouseLeave={() => setVisible(false)}
                    style={{
                        position: 'fixed',
                        top: position.top || 0,
                        left: position.left || 0,
                        zIndex: 99999,
                        maxWidth: '280px',
                        padding: '10px 12px',
                        background: theme.colors.tertiaryBg,
                        border: `1px solid ${theme.colors.border}`,
                        borderRadius: '10px',
                        boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
                        fontSize: '0.8rem',
                        lineHeight: 1.45,
                        color: theme.colors.secondaryText,
                        pointerEvents: 'auto'
                    }}
                >
                    {text}
                </div>,
                document.body
            )}
        </>
    );
};

export default InfoTooltip;
