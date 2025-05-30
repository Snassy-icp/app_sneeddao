import { useState, useEffect } from 'react';
import { getTextLimits } from '../utils/BackendUtils';

export const useTextLimits = (forumActor) => {
    const [textLimits, setTextLimits] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    useEffect(() => {
        const fetchTextLimits = async () => {
            if (!forumActor) return;
            
            setLoading(true);
            setError(null);
            
            try {
                const limits = await getTextLimits(forumActor);
                console.log('Fetched text limits from backend:', limits);
                
                if (limits) {
                    // Map backend field names to frontend-friendly names
                    const mappedLimits = {
                        max_title_length: limits.post_title_max_length,
                        max_body_length: limits.post_body_max_length,
                        max_comment_length: limits.post_body_max_length, // Use post body limit for comments
                        thread_title_max_length: limits.thread_title_max_length,
                        thread_body_max_length: limits.thread_body_max_length,
                        // Keep original field names for reference
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

    return { textLimits, loading, error };
}; 