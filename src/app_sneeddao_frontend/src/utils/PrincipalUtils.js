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
    const displayName = name || nickname;

    if (!displayName) return truncated;

    return {
        displayName,
        truncatedId: truncated,
        fullId: principal.toString(),
        isVerified,
        isNickname: !name && nickname
    };
};

// React component for displaying a principal
export const PrincipalDisplay = ({ principal, displayInfo = null, showCopyButton = true, style = {} }) => {
    const formatted = formatPrincipal(principal, displayInfo);
    
    // If no display info was provided, just show truncated ID
    if (typeof formatted === 'string') {
        return React.createElement('div', 
            { 
                style: { 
                    display: 'flex', 
                    alignItems: 'center', 
                    gap: '8px',
                    ...style
                }
            },
            React.createElement('span', 
                { title: principal?.toString() }, 
                formatted
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

    // Show full display with name/nickname
    return React.createElement('div',
        {
            style: {
                display: 'flex',
                flexDirection: 'column',
                ...style
            }
        },
        React.createElement('div',
            {
                style: {
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    color: formatted.isNickname ? '#95a5a6' : '#3498db',
                    fontSize: '16px',
                    fontWeight: formatted.isNickname ? 'normal' : 'bold',
                    fontStyle: formatted.isNickname ? 'italic' : 'normal'
                }
            },
            formatted.displayName,
            formatted.isVerified && !formatted.isNickname && React.createElement('span',
                {
                    style: {
                        fontSize: '14px',
                        cursor: 'help'
                    },
                    title: "Verified name"
                },
                "✓"
            )
        ),
        React.createElement('div',
            {
                style: {
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    color: '#888',
                    fontSize: '14px',
                    fontFamily: 'monospace'
                }
            },
            React.createElement('span',
                { title: formatted.fullId },
                formatted.truncatedId
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
        )
    );
}; 