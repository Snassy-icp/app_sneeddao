import { useSyncExternalStore } from 'react';
import { isPrivacyMode, subscribePrivacyMode, togglePrivacyMode, setPrivacyMode } from '../utils/privacyMode';

/** [on, toggle, set] for privacy mode (see utils/privacyMode.js). */
export function usePrivacyMode() {
    const on = useSyncExternalStore(subscribePrivacyMode, isPrivacyMode, () => false);
    return [on, togglePrivacyMode, setPrivacyMode];
}

export default usePrivacyMode;
