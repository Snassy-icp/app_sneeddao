import React from 'react';
import { FaCoins } from 'react-icons/fa';
import { getLogoSync } from '../hooks/useLogoCache';

// Fallback logo service — serves logos for most ICP tokens by canister ID
const LOGO_PROXY_BASE = 'https://static.icpswap.com/logo';
const getProxyLogoUrl = (canisterId) => `${LOGO_PROXY_BASE}/${canisterId}`;

/**
 * TokenIcon - A fixed-size container for token/SNS logos that prevents layout shift
 * 
 * The key to preventing layout displacement when logos load asynchronously is:
 * 1. Fixed dimensions on the container (width, height, minWidth, maxWidth)
 * 2. flexShrink: 0 to prevent flex containers from collapsing it
 * 3. Consistent sizing regardless of whether the logo has loaded
 * 
 * @param {string} logo - URL of the logo image, or null/undefined
 * @param {string} canisterId - Token ledger canister ID for proxy URL fallback
 * @param {string} alt - Alt text for the image
 * @param {number} size - Size in pixels (default: 18)
 * @param {React.ReactNode} fallbackIcon - Icon to show when logo is not available (default: FaCoins)
 * @param {string} fallbackColor - Color for the fallback icon (default: #d4a574)
 * @param {boolean} rounded - Whether to use rounded corners (default: true for circle)
 * @param {object} style - Additional styles to apply to the container
 */
const TokenIcon = ({ 
    logo, 
    canisterId,
    alt = '', 
    size = 18, 
    fallbackIcon,
    fallbackColor = '#d4a574',
    rounded = true,
    borderRadius,
    style = {}
}) => {
    // Calculate icon size (slightly smaller than container for visual balance)
    const iconSize = Math.round(size * 0.78);
    
    // Default fallback icon
    const defaultFallback = <FaCoins size={iconSize} style={{ color: fallbackColor }} />;
    const FallbackComponent = fallbackIcon || defaultFallback;

    // Resolve the best available logo: explicit logo → centralized cache → proxy URL
    const resolvedLogo = logo 
        || (canisterId && getLogoSync(canisterId)) 
        || (canisterId && getProxyLogoUrl(canisterId)) 
        || null;

    const radius = borderRadius || (rounded ? '50%' : '4px');

    return (
        <div style={{ 
            width: `${size}px`, 
            height: `${size}px`, 
            minWidth: `${size}px`,
            maxWidth: `${size}px`,
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            ...style
        }}>
            {resolvedLogo ? (
                <img 
                    src={resolvedLogo} 
                    alt={alt} 
                    style={{ 
                        width: '100%', 
                        height: '100%', 
                        borderRadius: radius, 
                        objectFit: 'cover' 
                    }}
                    onError={(e) => {
                        if (canisterId && e.target.src !== getProxyLogoUrl(canisterId)) {
                            e.target.onerror = null;
                            e.target.src = getProxyLogoUrl(canisterId);
                        } else {
                            e.target.style.display = 'none';
                        }
                    }}
                />
            ) : (
                FallbackComponent
            )}
        </div>
    );
};

export default TokenIcon;
