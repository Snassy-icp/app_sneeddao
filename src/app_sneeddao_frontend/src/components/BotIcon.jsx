import React from 'react';
import { FaRobot, FaBrain, FaChartLine } from 'react-icons/fa';

/**
 * Unified bot icon: robot as the base with a type-specific badge overlay.
 *
 * @param {'staking'|'trading'} type - Bot type determines the badge icon
 * @param {number} [size=16] - Icon size in px
 * @param {string} [color] - Icon color (applied to both robot and badge)
 * @param {object} [style] - Additional style for the robot icon
 * @param {string} [className] - Optional className on the wrapper
 */
const BADGE_ACCENT = {
    staking: '#a78bfa',
    trading: '#2dd4bf',
};

export default function BotIcon({ type, size = 16, color, style, className }) {
    const BadgeIcon = type === 'staking' ? FaBrain : type === 'trading' ? FaChartLine : null;
    const showBadge = BadgeIcon && size >= 12;

    if (!showBadge) {
        return <FaRobot size={size} style={{ color, ...style }} className={className} />;
    }

    const badgeSize = Math.max(8, Math.round(size * 0.45));
    const offsetTop = size >= 28 ? -Math.round(size * 0.04) : -Math.round(size * 0.1);
    const offsetRight = size >= 28 ? -Math.round(size * 0.06) : -Math.round(size * 0.14);
    const badgeColor = BADGE_ACCENT[type] || color || 'currentColor';

    return (
        <span
            className={className}
            style={{
                position: 'relative',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: `${size}px`,
                height: `${size}px`,
                flexShrink: 0,
            }}
        >
            <FaRobot size={size} style={{ color, ...style }} />
            <BadgeIcon
                style={{
                    color: badgeColor,
                    fontSize: `${badgeSize}px`,
                    position: 'absolute',
                    top: `${offsetTop}px`,
                    right: `${offsetRight}px`,
                    filter: `drop-shadow(0 0 1px rgba(0,0,0,0.4))`,
                }}
            />
        </span>
    );
}
