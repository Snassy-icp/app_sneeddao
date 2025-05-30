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
                setTextLimits(limits);
            } catch (err) {
                console.error('Error fetching text limits:', err);
                setError(err);
                // Set default limits on error
                setTextLimits({
                    max_title_length: 200,
                    max_body_length: 10000,
                    max_comment_length: 5000
                });
            } finally {
                setLoading(false);
            }
        };

        fetchTextLimits();
    }, [forumActor]);

    return { textLimits, loading, error };
}; 