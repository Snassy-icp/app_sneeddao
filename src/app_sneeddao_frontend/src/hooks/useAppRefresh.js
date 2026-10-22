import { useEffect, useRef } from 'react';

// 'sneed-refresh' on window: "show the latest". PushOpenHandler sends it when a tapped notification
// opens the page the user is already on (the installed app on iOS comes forward without a reload).
export const REFRESH_EVENT = 'sneed-refresh';
export const requestAppRefresh = () => window.dispatchEvent(new Event(REFRESH_EVENT));

const VISIBLE_THROTTLE_MS = 10_000;

/// Calls `refresh` on 'sneed-refresh' and, with { onVisible: true }, also when the page becomes
/// visible again (at most once per 10 s): iOS may bring the app forward with no event at all.
export function useAppRefresh(refresh, { onVisible = false } = {}) {
    const ref = useRef(refresh);
    ref.current = refresh;
    useEffect(() => {
        let last = Date.now();
        const run = () => { last = Date.now(); try { ref.current?.(); } catch (e) { console.warn('refresh failed', e); } };
        const onVis = () => { if (document.visibilityState === 'visible' && Date.now() - last >= VISIBLE_THROTTLE_MS) run(); };
        window.addEventListener(REFRESH_EVENT, run);
        if (onVisible) document.addEventListener('visibilitychange', onVis);
        return () => { window.removeEventListener(REFRESH_EVENT, run); document.removeEventListener('visibilitychange', onVis); };
    }, [onVisible]);
}
