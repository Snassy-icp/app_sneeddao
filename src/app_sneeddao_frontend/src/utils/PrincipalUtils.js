import React from 'react';
import { getPrincipalName, getPrincipalNickname } from './BackendUtils';

// Truncate a principal ID to a shorter format
export const truncatePrincipal = (principal) => {
    if (!principal) return 'Unknown';
    const principalText = principal.toString();
    const start = principalText.slice(0, 5);
    const end = principalText.slice(-5);
    return `${start}...${end}`;
};

// Generate a consistent color from a principal ID
export const getPrincipalColor = (principal) => {
    if (!principal) return '#888';
    const principalText = principal.toString();
    
    // Simple hash function that sums char codes multiplied by position
    let hash = 0;
    for (let i = 0; i < principalText.length; i++) {
        hash = ((hash << 5) - hash) + principalText.charCodeAt(i);
        hash = hash & hash; // Convert to 32-bit integer
    }

    // Generate HSL color with:
    // - Hue: full range (0-360) for maximum distinction
    // - Saturation: 60-80% for good color without being too bright
    // - Lightness: 45-65% for good contrast on both dark and light backgrounds
    const hue = Math.abs(hash % 360);
    const saturation = 70 + (Math.abs((hash >> 8) % 11)); // 70-80%
    const lightness = 55 + (Math.abs((hash >> 16) % 11)); // 55-65%

    return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
};

// Get the display name for a principal, including name and verification status
export const getPrincipalDisplayInfo = async (identity, principal) => {
    if (!identity || !principal) return { name: null, nickname: null, isVerified: false };

    try {
        // Get public name and verification status
        const nameResponse = await getPrincipalName(identity, principal);
        const name = nameResponse ? nameResponse[0] : null;
        const isVerified = nameResponse ? nameResponse[1] : false;

        // Get private nickname
        const nickname = await getPrincipalNickname(identity, principal);

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

    const { name, nickname, isVerified } = displayInfo;

    if (!name && !nickname) return truncated;

    return {
        name,
        nickname,
        truncatedId: truncated,
        fullId: principal.toString(),
        isVerified
    };
};

// React component for displaying a principal
export const PrincipalDisplay = ({ principal, displayInfo = null, showCopyButton = true, style = {} }) => {
    const formatted = formatPrincipal(principal, displayInfo);
    const principalColor = getPrincipalColor(principal);
    
    // Create a link wrapper component
    const LinkWrapper = ({ children }) => {
        const href = `/principal?id=${principal?.toString()}`;
        return React.createElement('a', 
            {
                href,
                style: {
                    textDecoration: 'none',
                    color: 'inherit'
                },
                onMouseEnter: (e) => e.target.style.textDecoration = 'underline',
                onMouseLeave: (e) => e.target.style.textDecoration = 'none'
            },
            children
        );
    };
    
    // If no display info was provided, just show truncated ID
    if (typeof formatted === 'string') {
        return React.createElement('div', 
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
                    { title: principal?.toString() }, 
                    formatted
                )
            ),
            showCopyButton && React.createElement('button',
                {
                    onClick: () => navigator.clipboard.writeText(principal?.toString()),
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
        );
    }

    // Show compact display with name and/or nickname
    return React.createElement('div',
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
                    formatted.name,
                    formatted.isVerified && React.createElement('span',
                        {
                            style: {
                                fontSize: '14px',
                                cursor: 'help',
                                color: '#2ecc71',
                                marginLeft: '2px'
                            },
                            title: "Verified name"
                        },
                        "✓"
                    )
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
                React.createElement('span',
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
    );
}; 