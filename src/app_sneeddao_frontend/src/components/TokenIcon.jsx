import React from 'react';
import { FaCoins } from 'react-icons/fa';

/**
 * TokenIcon - A fixed-size container for token/SNS logos that prevents layout shift
 * 
 * The key to preventing layout displacement when logos load asynchronously is:
 * 1. Fixed dimensions on the container (width, height, minWidth, maxWidth)
 * 2. flexShrink: 0 to prevent flex containers from collapsing it
 * 3. Consistent sizing regardless of whether the logo has loaded
 * 
 * @param {string} logo - URL of the logo image, or null/undefined
 * @param {string} alt - Alt text for the image
 * @param {number} size - Size in pixels (default: 18)
 * @param {React.ReactNode} fallbackIcon - Icon to show when logo is not available (default: FaCoins)
 * @param {string} fallbackColor - Color for the fallback icon (default: #d4a574)
 * @param {boolean} rounded - Whether to use rounded corners (default: true for circle)
 * @param {object} style - Additional styles to apply to the container
 */
const TokenIcon = ({ 
    logo, 
    alt = '', 
    size = 18, 
    fallbackIcon,
    fallbackColor = '#d4a574',
    rounded = true,
    style = {}
}) => {
    // Calculate icon size (slightly smaller than container for visual balance)
    const iconSize = Math.round(size * 0.78);
    
    // Default fallback icon
    const defaultFallback = <FaCoins size={iconSize} style={{ color: fallbackColor }} />;
    const FallbackComponent = fallbackIcon || defaultFallback;

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
            {logo ? (
                <img 
                    src={logo} 
                    alt={alt} 
                    style={{ 
                        width: '100%', 
                        height: '100%', 
                        borderRadius: rounded ? '50%' : '4px', 
                        objectFit: 'cover' 
                    }} 
                />
            ) : (
                FallbackComponent
            )}
        </div>
    );
};

export default TokenIcon;
