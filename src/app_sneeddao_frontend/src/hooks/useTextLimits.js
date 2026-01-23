import { useState, useEffect } from 'react';
import { getTextLimits } from '../utils/BackendUtils';
import { usePremiumStatus } from './usePremiumStatus';

export const useTextLimits = (forumActor) => {
    const [textLimits, setTextLimits] = useState(null);
    const [premiumConfig, setPremiumConfig] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    
    // Get premium status from the hook
    const { isPremium, loading: premiumLoading } = usePremiumStatus();

    useEffect(() => {
        const fetchTextLimits = async () => {
            if (!forumActor) return;
            
            setLoading(true);
            setError(null);
            
            try {
                // Fetch both text limits and premium config in parallel
                const [limits, premiumCfg] = await Promise.all([
                    getTextLimits(forumActor),
                    forumActor.get_premium_config().catch(() => null)
                ]);
                
                console.log('Fetched text limits from backend:', limits);
                console.log('Fetched premium config from backend:', premiumCfg);
                
                if (premiumCfg) {
                    setPremiumConfig({
                        sneed_premium_canister_id: premiumCfg.sneed_premium_canister_id?.[0]?.toString() || null,
                        premium_post_body_max_length: Number(premiumCfg.premium_post_body_max_length),
                        premium_thread_body_max_length: Number(premiumCfg.premium_thread_body_max_length)
                    });
                }
                
                if (limits) {
                    // Map backend field names to frontend-friendly names
                    const mappedLimits = {
                        max_title_length: limits.post_title_max_length,
                        max_body_length: limits.post_body_max_length,
                        max_comment_length: limits.post_body_max_length,
                        thread_title_max_length: limits.thread_title_max_length,
                        thread_body_max_length: limits.thread_body_max_length,
                        ...limits
                    };
                    setTextLimits(mappedLimits);
                } else {
                    throw new Error('No text limits received from backend');
                }
            } catch (err) {
                console.error('Error fetching text limits:', err);
                setError(err);
                // Set default limits on error
                setTextLimits({
                    max_title_length: 200,
                    max_body_length: 10000,
                    max_comment_length: 10000,
                    post_title_max_length: 200,
                    post_body_max_length: 10000,
                    thread_title_max_length: 200,
                    thread_body_max_length: 10000,
                    topic_title_max_length: 100,
                    topic_description_max_length: 1000,
                    forum_title_max_length: 100,
                    forum_description_max_length: 1000
                });
            } finally {
                setLoading(false);
            }
        };

        fetchTextLimits();
    }, [forumActor]);

    // Compute effective limits based on premium status
    const effectiveLimits = textLimits ? {
        ...textLimits,
        // Override with premium limits if user is premium and premium config is available
        post_body_max_length: (isPremium && premiumConfig?.premium_post_body_max_length) 
            ? premiumConfig.premium_post_body_max_length 
            : textLimits.post_body_max_length,
        thread_body_max_length: (isPremium && premiumConfig?.premium_thread_body_max_length) 
            ? premiumConfig.premium_thread_body_max_length 
            : textLimits.thread_body_max_length,
        // Update aliases as well
        max_body_length: (isPremium && premiumConfig?.premium_post_body_max_length) 
            ? premiumConfig.premium_post_body_max_length 
            : textLimits.post_body_max_length,
        max_comment_length: (isPremium && premiumConfig?.premium_post_body_max_length) 
            ? premiumConfig.premium_post_body_max_length 
            : textLimits.post_body_max_length,
    } : null;

    return { 
        textLimits: effectiveLimits, 
        regularLimits: textLimits,
        premiumConfig,
        isPremium,
        loading: loading || premiumLoading, 
        error 
    };
};
