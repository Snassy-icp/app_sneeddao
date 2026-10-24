import { useCallback, useRef, useState } from 'react';

// The last count of each header notification, per principal, for the whole page session. Every page
// renders its own Header, so a navigation remounts the notification hooks: kept here, a remounted
// hook starts from the last count and its check refreshes it in the background instead of the
// notification bar clearing and filling again.
const lastCounts = new Map(); // `${name}:${principal}` -> count

/// useState for a notification count that survives remounts. `principal`: text, or null when
/// logged out (then nothing is kept).
export function useStickyCount(name, principal) {
    const key = principal ? `${name}:${principal}` : null;
    const keyRef = useRef(key);
    keyRef.current = key;
    const [count, setCountState] = useState(() => (key && lastCounts.get(key)) || 0);
    const setCount = useCallback((n) => {
        if (keyRef.current) lastCounts.set(keyRef.current, n);
        setCountState(n);
    }, []);
    return [count, setCount];
}

export default useStickyCount;
