// Back, Forward and Refresh for the installed app (home-screen PWA, iPhone first): there is no browser
// chrome there, so without these a user can't go back or reload. Shown only in standalone mode.
//
// Tap Refresh: the page reloads its data (requestAppRefresh; a page with no listener is remounted, so
// it fetches again while the app keeps its login and caches). Then "Reload app" is offered for a few
// seconds for when the app is stuck; a long press on Refresh reloads the app straight away.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useNavigationType } from 'react-router-dom';
import { FaChevronLeft, FaChevronRight, FaSyncAlt } from 'react-icons/fa';
import { useTheme } from '../contexts/ThemeContext';
import { isStandaloneApp } from '../utils/pairing';
import { requestAppRefresh, hasPageRefreshListeners } from '../hooks/useAppRefresh';

const MAX_IDX_KEY = 'sneed_pwa_nav_max_idx';
const FORCE_KEY = 'sneed_pwa_nav'; // localStorage '1': show it in a normal tab too (for testing)
const LONG_PRESS_MS = 550;
const RELOAD_OFFER_MS = 5000;

const readSession = (k) => { try { return sessionStorage.getItem(k); } catch { return null; } };
const writeSession = (k, v) => { try { sessionStorage.setItem(k, v); } catch { /* private mode */ } };

export const shouldShowPwaNav = () => {
    if (isStandaloneApp()) return true;
    try { return localStorage.getItem(FORCE_KEY) === '1'; } catch { return false; }
};

/// React Router keeps the entry's position in history.state.idx (0 = where the app was opened).
/// Back is possible above 0; Forward while below the furthest entry we pushed (kept in
/// sessionStorage so it survives a full reload). window.history.length is no use in standalone.
function useInAppHistory() {
    const location = useLocation();
    const navType = useNavigationType();
    const [pos, setPos] = useState({ idx: 0, max: 0 });
    useEffect(() => {
        const raw = window.history.state?.idx;
        const idx = Number.isInteger(raw) ? raw : 0;
        const stored = parseInt(readSession(MAX_IDX_KEY) ?? '', 10);
        let max = Number.isInteger(stored) ? stored : idx;
        if (navType === 'PUSH') max = idx; // a new entry drops everything that was ahead
        else max = Math.max(max, idx);
        writeSession(MAX_IDX_KEY, String(max));
        setPos({ idx, max });
    }, [location.key, navType]);
    return { canBack: pos.idx > 0, canForward: pos.idx < pos.max };
}

export default function PwaNavBar({ onRemountPage }) {
    const { theme } = useTheme();
    const c = theme.colors;
    const navigate = useNavigate();
    const { canBack, canForward } = useInAppHistory();
    const [hidden, setHidden] = useState(false);     // scrolled down, or typing
    const [spinning, setSpinning] = useState(false);
    const [offerReload, setOfferReload] = useState(false);
    const pressTimer = useRef(null);
    const longPressed = useRef(false);
    const offerTimer = useRef(null);

    // Out of the way while scrolling down or while the keyboard is up; back on scrolling up.
    useEffect(() => {
        let lastY = window.scrollY;
        let typing = false;
        const onScroll = () => {
            const y = window.scrollY;
            const nearBottom = window.innerHeight + y >= document.documentElement.scrollHeight - 40;
            if (!typing) {
                if (y < 40 || nearBottom || y < lastY - 6) setHidden(false);
                else if (y > lastY + 6) setHidden(true);
            }
            lastY = y;
        };
        const isField = (el) => el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
        const onFocusIn = (e) => { if (isField(e.target)) { typing = true; setHidden(true); } };
        const onFocusOut = () => { typing = false; setTimeout(() => { if (!isField(document.activeElement)) setHidden(false); }, 50); };
        window.addEventListener('scroll', onScroll, { passive: true });
        document.addEventListener('focusin', onFocusIn);
        document.addEventListener('focusout', onFocusOut);
        return () => {
            window.removeEventListener('scroll', onScroll);
            document.removeEventListener('focusin', onFocusIn);
            document.removeEventListener('focusout', onFocusOut);
        };
    }, []);

    useEffect(() => () => { clearTimeout(pressTimer.current); clearTimeout(offerTimer.current); }, []);

    const reloadApp = useCallback(() => { window.location.reload(); }, []);

    const softRefresh = useCallback(() => {
        const pageListens = hasPageRefreshListeners();
        requestAppRefresh();                // app-wide data (SMS inbox, ...) and pages that listen
        if (!pageListens) onRemountPage?.(); // otherwise the page fetches again by remounting
        setSpinning(true);
        setTimeout(() => setSpinning(false), 700);
        setOfferReload(true);
        clearTimeout(offerTimer.current);
        offerTimer.current = setTimeout(() => setOfferReload(false), RELOAD_OFFER_MS);
    }, [onRemountPage]);

    const startPress = () => {
        longPressed.current = false;
        clearTimeout(pressTimer.current);
        pressTimer.current = setTimeout(() => {
            longPressed.current = true;
            try { navigator.vibrate?.(15); } catch { /* not on iOS */ }
            reloadApp();
        }, LONG_PRESS_MS);
    };
    const endPress = () => clearTimeout(pressTimer.current);
    const onRefreshClick = () => { if (!longPressed.current) softRefresh(); longPressed.current = false; };

    const btn = (enabled) => ({
        width: 40, height: 40, border: 'none', borderRadius: 20, padding: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'transparent', color: c.primaryText, fontSize: 16,
        opacity: enabled ? 0.95 : 0.3, cursor: enabled ? 'pointer' : 'default',
        WebkitTapHighlightColor: 'transparent', touchAction: 'manipulation',
    });

    return (
        <div
            style={{
                position: 'fixed', zIndex: 900,
                left: 'calc(10px + env(safe-area-inset-left, 0px))',
                bottom: 'max(20px, calc(env(safe-area-inset-bottom, 0px) + 8px))',
                display: 'flex', alignItems: 'center', gap: 8,
                transform: hidden ? 'translateY(140%)' : 'none', opacity: hidden ? 0 : 1,
                transition: 'transform 0.22s ease, opacity 0.22s ease',
                pointerEvents: hidden ? 'none' : 'auto',
                WebkitUserSelect: 'none', userSelect: 'none', WebkitTouchCallout: 'none',
            }}
        >
            <nav
                aria-label="App navigation"
                style={{
                    display: 'flex', alignItems: 'center', gap: 2, padding: 2,
                    background: theme.name === 'dark' ? 'rgba(20, 20, 20, 0.82)' : 'rgba(255, 255, 255, 0.88)',
                    border: `1px solid ${c.border}`, borderRadius: 22,
                    boxShadow: '0 4px 16px rgba(0, 0, 0, 0.25)',
                    backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)',
                }}
            >
                <button type="button" aria-label="Back" title="Back" disabled={!canBack}
                    onClick={() => canBack && navigate(-1)} style={btn(canBack)}>
                    <FaChevronLeft aria-hidden="true" />
                </button>
                <button type="button" aria-label="Forward" title="Forward" disabled={!canForward}
                    onClick={() => canForward && navigate(1)} style={btn(canForward)}>
                    <FaChevronRight aria-hidden="true" />
                </button>
                <button type="button" aria-label="Refresh (hold to reload the app)" title="Refresh (hold to reload the app)"
                    onClick={onRefreshClick}
                    onTouchStart={startPress} onTouchEnd={endPress} onTouchMove={endPress} onTouchCancel={endPress}
                    onMouseDown={startPress} onMouseUp={endPress} onMouseLeave={endPress}
                    onContextMenu={(e) => e.preventDefault()}
                    style={btn(true)}>
                    <FaSyncAlt aria-hidden="true" style={spinning ? { animation: 'spin 0.7s linear' } : undefined} />
                </button>
            </nav>
            {offerReload && (
                <button type="button" onClick={reloadApp}
                    style={{
                        height: 32, padding: '0 12px', borderRadius: 16, fontSize: 12.5, fontWeight: 600,
                        border: `1px solid ${c.border}`, color: c.primaryText, cursor: 'pointer',
                        background: theme.name === 'dark' ? 'rgba(20, 20, 20, 0.82)' : 'rgba(255, 255, 255, 0.88)',
                        boxShadow: '0 4px 16px rgba(0, 0, 0, 0.2)',
                        backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)',
                        WebkitTapHighlightColor: 'transparent',
                    }}>
                    Still stuck? Reload app
                </button>
            )}
        </div>
    );
}
