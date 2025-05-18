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
    const [authChecked, setAuthChecked] = useState(false);
    let authCheckTimeout = null;

    useEffect(() => {
        const checkAdminStatus = async () => {
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
                setIsAdmin(isAdminResult);
                
                if (!isAdminResult) {
                    console.log('Not an admin, redirecting...');
                    setError('You do not have admin privileges.');
                    setTimeout(() => navigate(redirectPath), 2000);
                }
            } catch (err) {
                console.error('Error checking admin status:', err);
                setError('Error checking admin status: ' + err.message);
                setTimeout(() => navigate(redirectPath), 2000);
            } finally {
                setLoading(false);
            }
        };

        const checkAuth = () => {
            if (!isAuthenticated || !identity) {
                console.log('Not authenticated, setting timeout...');
                // Set a timeout to wait for authentication
                authCheckTimeout = setTimeout(() => {
                    console.log('Auth timeout expired, redirecting...');
                    setError('Please connect your wallet first.');
                    navigate(redirectPath);
                }, 1000);
            } else {
                console.log('Authenticated, checking admin status...');
                if (authCheckTimeout) {
                    clearTimeout(authCheckTimeout);
                }
                checkAdminStatus();
            }
            setAuthChecked(true);
        };

        if (!authChecked) {
            checkAuth();
        }

        return () => {
            if (authCheckTimeout) {
                clearTimeout(authCheckTimeout);
            }
        };
    }, [identity, isAuthenticated, authChecked, navigate, redirectPath]);

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