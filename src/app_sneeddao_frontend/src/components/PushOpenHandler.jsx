import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { requestAppRefresh } from '../hooks/useAppRefresh';

// A tapped notification asks an already open window to go to its link (public/sw.js, when the worker
// can't navigate it): another page → go there in the app; the page already shown → refresh its data.
export default function PushOpenHandler() {
    const navigate = useNavigate();
    const location = useLocation();
    useEffect(() => {
        if (!('serviceWorker' in navigator)) return undefined;
        const onMessage = (e) => {
            const url = e.data?.type === 'sneed-open' ? e.data.url : null;
            if (typeof url !== 'string' || !url.startsWith('/') || url.startsWith('//')) return;
            if (url === location.pathname + location.search) requestAppRefresh();
            else navigate(url);
        };
        navigator.serviceWorker.addEventListener('message', onMessage);
        return () => navigator.serviceWorker.removeEventListener('message', onMessage);
    }, [navigate, location.pathname, location.search]);
    return null;
}
