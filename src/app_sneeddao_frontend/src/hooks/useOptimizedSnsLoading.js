import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useSns } from '../contexts/SnsContext';
import { useAuth } from '../AuthContext';
import { normalizeId } from './useNeuronsCache';
import { 
    fetchSingleSnsData, 
    startBackgroundSnsFetch,
    getAllSnses
} from '../utils/SnsUtils';

/**
 * Custom hook for optimized SNS loading
 * 
 * This hook implements the non-blocking SNS loading strategy:
 * 1. Check cache first
 * 2. If empty, immediately load current/default SNS only
 * 3. Start background fetch for all SNSes
 * 4. Update dropdown when background fetch completes
 */
export function useOptimizedSnsLoading() {
    const { identity } = useAuth();
    const { selectedSnsRoot, updateSelectedSns, SNEED_SNS_ROOT } = useSns();
    const [searchParams, setSearchParams] = useSearchParams();
    
    const [snsList, setSnsList] = useState([]);
    const [currentSns, setCurrentSns] = useState(null);
    const [loadingCurrent, setLoadingCurrent] = useState(true);
    const [loadingAll, setLoadingAll] = useState(false);
    const [error, setError] = useState(null);

    // Determine target SNS from URL or default to Sneed
    const getTargetSnsRoot = useCallback(() => {
        const snsParam = searchParams.get('sns');
        return snsParam || SNEED_SNS_ROOT;
    }, [searchParams, SNEED_SNS_ROOT]);

    // Sync URL parameters with global state
    useEffect(() => {
        const snsParam = searchParams.get('sns');
        const targetSns = getTargetSnsRoot();
        
        if (snsParam && snsParam !== selectedSnsRoot) {
            updateSelectedSns(snsParam);
        } else if (!snsParam && targetSns === SNEED_SNS_ROOT && selectedSnsRoot !== SNEED_SNS_ROOT) {
            setSearchParams(prev => {
                prev.set('sns', selectedSnsRoot);
                return prev;
            });
        }
    }, [searchParams, selectedSnsRoot, updateSelectedSns, SNEED_SNS_ROOT, setSearchParams, getTargetSnsRoot]);

    // Main loading logic
    const loadSnsData = useCallback(async () => {
        const targetSnsRoot = getTargetSnsRoot();
        console.log(`useOptimizedSnsLoading: Loading for SNS ${targetSnsRoot}`);
        
        setLoadingCurrent(true);
        setError(null);

        try {
            // Step 1: Check if we have cached data
            const cachedData = getAllSnses();
            
            if (cachedData && cachedData.length > 0) {
                console.log('useOptimizedSnsLoading: Found cached SNS data');
                setSnsList(cachedData);
                
                // Find current SNS in cache
                const normalizedTargetRoot = normalizeId(targetSnsRoot);
                const currentFromCache = cachedData.find(sns => sns.rootCanisterId === normalizedTargetRoot);
                if (currentFromCache) {
                    setCurrentSns(currentFromCache);
                    setLoadingCurrent(false);
                    return;
                }
            }

            // Step 2: Cache is empty or current SNS not found - load single SNS immediately
            console.log('useOptimizedSnsLoading: Loading single SNS immediately');
            
            try {
                const singleSnsData = await fetchSingleSnsData(targetSnsRoot, identity);
                setCurrentSns(singleSnsData);
                
                // Update global state if needed
                if (selectedSnsRoot !== targetSnsRoot) {
                    updateSelectedSns(targetSnsRoot);
                }
                
                // If we don't have cached data, set this as the only SNS for now
                if (!cachedData || cachedData.length === 0) {
                    setSnsList([singleSnsData]);
                }
                
            } catch (singleError) {
                console.error('useOptimizedSnsLoading: Failed to load single SNS, defaulting to Sneed:', singleError);
                
                // Fallback to Sneed SNS if the requested SNS fails
                if (targetSnsRoot !== SNEED_SNS_ROOT) {
                    try {
                        const sneedData = await fetchSingleSnsData(SNEED_SNS_ROOT, identity);
                        setCurrentSns(sneedData);
                        updateSelectedSns(SNEED_SNS_ROOT);
                        setSnsList([sneedData]);
                        
                        // Update URL to reflect fallback
                        setSearchParams(prev => {
                            prev.delete('sns'); // Remove invalid SNS param
                            return prev;
                        });
                        
                        setError(`SNS not found, defaulted to Sneed`);
                    } catch (sneedError) {
                        console.error('useOptimizedSnsLoading: Failed to load Sneed SNS as fallback:', sneedError);
                        throw new Error('Failed to load SNS data');
                    }
                } else {
                    throw singleError;
                }
            }

        } catch (error) {
            console.error('useOptimizedSnsLoading: Critical error:', error);
            setError('Failed to load SNS data');
        } finally {
            setLoadingCurrent(false);
        }

        // Step 3: Start background fetch for all SNSes (non-blocking)
        if (!cachedData || cachedData.length <= 1) {
            console.log('useOptimizedSnsLoading: Starting background fetch for all SNSes');
            setLoadingAll(true);
            
            startBackgroundSnsFetch(identity, (allSnsData) => {
                console.log('useOptimizedSnsLoading: Background fetch completed', allSnsData);
                setSnsList(allSnsData);
                setLoadingAll(false);
                
                // Update current SNS if we got better data
                const updatedCurrent = allSnsData.find(sns => sns.rootCanisterId === normalizeId(targetSnsRoot));
                if (updatedCurrent) {
                    setCurrentSns(updatedCurrent);
                }
            }).catch(error => {
                console.error('useOptimizedSnsLoading: Background fetch failed:', error);
                setLoadingAll(false);
            });
        }

    }, [identity, getTargetSnsRoot, selectedSnsRoot, updateSelectedSns, SNEED_SNS_ROOT, setSearchParams]);

    // Load SNS data when component mounts or identity changes
    useEffect(() => {
        if (identity) {
            loadSnsData();
        }
    }, [identity, loadSnsData]);

    // Refresh function for manual reload
    const refreshSnsData = useCallback(() => {
        loadSnsData();
    }, [loadSnsData]);

    return {
        snsList,
        currentSns,
        loadingCurrent,
        loadingAll,
        error,
        refreshSnsData,
        targetSnsRoot: getTargetSnsRoot()
    };
}
