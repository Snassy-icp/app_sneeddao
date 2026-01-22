import { useState, useEffect, useCallback, useRef } from 'react';
import { createSneedPremiumActor, isMembershipActive, getExpirationFromStatus } from '../utils/SneedPremiumUtils';

const PREMIUM_CACHE_KEY = 'sneed_premium_status';

/**
 * Load cached premium status from localStorage
 * Returns null if no valid cache exists
 */
function loadCachedStatus(principalStr) {
    try {
        const cached = localStorage.getItem(`${PREMIUM_CACHE_KEY}_${principalStr}`);
        if (!cached) return null;
        
        const data = JSON.parse(cached);
        
        // Check if cache is still valid (not past expiration)
        if (data.expiration) {
            const expirationMs = Number(data.expiration) / 1_000_000; // Convert ns to ms
            if (Date.now() < expirationMs) {
                return {
                    isPremium: data.isPremium,
                    expiration: BigInt(data.expiration),
                };
            }
        }
        
        // Cache expired, remove it
        localStorage.removeItem(`${PREMIUM_CACHE_KEY}_${principalStr}`);
        return null;
    } catch (e) {
        console.error('Error loading premium cache:', e);
        return null;
    }
}

/**
 * Save premium status to localStorage with expiration
 */
function saveCachedStatus(principalStr, isPremium, expiration) {
    try {
        const data = {
            isPremium,
            expiration: expiration ? expiration.toString() : null,
            cachedAt: Date.now(),
        };
        localStorage.setItem(`${PREMIUM_CACHE_KEY}_${principalStr}`, JSON.stringify(data));
    } catch (e) {
        console.error('Error saving premium cache:', e);
    }
}

/**
 * Hook to check premium membership status for a principal
 * Results are cached in localStorage until membership expiration
 * @param {Identity} identity - User identity
 * @param {Principal} principal - Principal to check (defaults to identity's principal)
 * @returns {{ isPremium: boolean, expiration: bigint|null, loading: boolean, error: string|null, refresh: function }}
 */
export function usePremiumStatus(identity, principal = null) {
    const [isPremium, setIsPremium] = useState(false);
    const [expiration, setExpiration] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const lastFetchRef = useRef(null);

    const checkStatus = useCallback(async (forceRefresh = false) => {
        const targetPrincipal = principal || identity?.getPrincipal();
        if (!targetPrincipal) {
            setIsPremium(false);
            setExpiration(null);
            setLoading(false);
            return;
        }

        const principalStr = targetPrincipal.toString();
        const now = Date.now();
        
        // Check localStorage cache first (unless force refresh)
        if (!forceRefresh) {
            const cached = loadCachedStatus(principalStr);
            if (cached) {
                setIsPremium(cached.isPremium);
                setExpiration(cached.expiration);
                setLoading(false);
                return;
            }
        }

        // Prevent duplicate fetches within 1 second
        if (!forceRefresh && lastFetchRef.current && (now - lastFetchRef.current < 1000)) {
            return;
        }
        lastFetchRef.current = now;

        setLoading(true);
        setError(null);

        try {
            const actor = await createSneedPremiumActor(identity);
            const status = await actor.checkMembership(targetPrincipal);
            
            const isActive = isMembershipActive(status);
            const exp = getExpirationFromStatus(status);
            
            // Save to localStorage - cache until membership expires
            saveCachedStatus(principalStr, isActive, exp);
            
            setIsPremium(isActive);
            setExpiration(exp);
        } catch (err) {
            console.error('Failed to check premium status:', err);
            setError(err.message);
            setIsPremium(false);
            setExpiration(null);
        } finally {
            setLoading(false);
        }
    }, [identity, principal]);

    useEffect(() => {
        checkStatus();
    }, [checkStatus]);

    const refresh = useCallback(() => {
        checkStatus(true);
    }, [checkStatus]);

    return { isPremium, expiration, loading, error, refresh };
}

/**
 * Premium badge component
 * Use this to display a premium badge anywhere in the app
 */
export function PremiumBadge({ style = {}, size = 'small', showTooltip = true }) {
    const sizes = {
        tiny: { fontSize: '0.7rem', padding: '2px 6px', iconSize: 10 },
        small: { fontSize: '0.75rem', padding: '3px 8px', iconSize: 12 },
        medium: { fontSize: '0.85rem', padding: '4px 10px', iconSize: 14 },
        large: { fontSize: '1rem', padding: '6px 14px', iconSize: 18 },
    };
    
    const { fontSize, padding, iconSize } = sizes[size] || sizes.small;
    
    return (
        <span
            style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                background: 'linear-gradient(135deg, #FFD700, #FFA500)',
                color: '#1a1a2e',
                padding,
                borderRadius: '20px',
                fontSize,
                fontWeight: '600',
                boxShadow: '0 2px 8px rgba(255, 215, 0, 0.3)',
                ...style
            }}
            title={showTooltip ? 'Sneed Premium Member' : undefined}
        >
            <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="currentColor">
                <path d="M5 16L3 5l5.5 5L12 4l3.5 6L21 5l-2 11H5m14 3c0 .6-.4 1-1 1H6c-.6 0-1-.4-1-1v-1h14v1z"/>
            </svg>
            Premium
        </span>
    );
}

export default usePremiumStatus;
