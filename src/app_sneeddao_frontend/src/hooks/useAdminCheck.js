import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { createActor as createBackendActor, canisterId as backendCanisterId } from 'declarations/app_sneeddao_backend';

// Define status states
export const STATUS = {
    LOADING: 'LOADING',
    CHECKING_AUTH: 'CHECKING_AUTH',
    CHECKING_ADMIN: 'CHECKING_ADMIN',
    NOT_AUTHENTICATED: 'NOT_AUTHENTICATED',
    NOT_ADMIN: 'NOT_ADMIN',
    ADMIN: 'ADMIN',
    ERROR: 'ERROR'
};

export function useAdminCheck({ identity, isAuthenticated, redirectPath = '/' }) {
    const navigate = useNavigate();
    const [isAdmin, setIsAdmin] = useState(false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        let mounted = true;
        let timeoutId = null;

        const checkAdminStatus = async () => {
            if (!mounted) return;
            
            console.log('Checking admin status...');
            console.log('Is authenticated:', isAuthenticated);
            console.log('Identity:', identity);

            try {
                console.log('Creating backend actor...');
                const backendActor = createBackendActor(backendCanisterId, {
                    agentOptions: {
                        identity,
                        host: 'https://ic0.app'
                    }
                });
                console.log('Calling caller_is_admin...');
                const isAdminResult = await backendActor.caller_is_admin();
                console.log('isAdminResult:', isAdminResult);
                
                if (!mounted) return;

                if (timeoutId) {
                    clearTimeout(timeoutId);
                    timeoutId = null;
                }

                setIsAdmin(isAdminResult);
                if (!isAdminResult) {
                    console.log('Not an admin, redirecting...');
                    setError('You do not have admin privileges.');
                    setTimeout(() => mounted && navigate(redirectPath), 2000);
                }
                setLoading(false);
            } catch (err) {
                console.error('Error checking admin status:', err);
                if (!mounted) return;
                setError('Error checking admin status: ' + err.message);
                setTimeout(() => mounted && navigate(redirectPath), 2000);
                setLoading(false);
            }
        };

        const checkAuth = () => {
            if (!isAuthenticated || !identity) {
                console.log('Not authenticated, setting timeout...');
                timeoutId = setTimeout(() => {
                    if (!mounted) return;
                    console.log('Auth timeout expired, redirecting...');
                    setError('Please connect your wallet first.');
                    setLoading(false);
                    navigate(redirectPath);
                }, 1000);
            } else {
                console.log('Authenticated, checking admin status...');
                checkAdminStatus();
            }
        };

        setLoading(true);
        setError(null);
        checkAuth();

        return () => {
            mounted = false;
            if (timeoutId) {
                clearTimeout(timeoutId);
            }
        };
    }, [identity, isAuthenticated, navigate, redirectPath]);

    const loadingComponent = {
        text: 'Loading...',
        style: { textAlign: 'center', padding: '40px 20px', color: '#ffffff' }
    };

    const errorComponent = {
        text: error || 'An error occurred',
        style: {
            backgroundColor: 'rgba(231, 76, 60, 0.1)',
            border: '1px solid #e74c3c',
            color: '#e74c3c',
            padding: '15px',
            borderRadius: '4px',
            marginBottom: '20px'
        }
    };

    return {
        isAdmin,
        loading,
        error,
        loadingComponent,
        errorComponent
    };
} 