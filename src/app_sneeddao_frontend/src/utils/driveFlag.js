// The admin feature flag of Sneed Drive phase 0 (spec/sneed_drive_phase0.md): the /drive section
// shows only for Sneed Hub admins who turned the "Sneed Drive (beta)" switch on in this browser
// (localStorage, like the Bitcoin beta switch). Its own module, without canister code, so the
// Header can read it cheaply.
export const DRIVE_FLAG_KEY = 'sneedDriveBeta';

export function driveFlagOn(storage) {
    try { return (storage || window.localStorage).getItem(DRIVE_FLAG_KEY) === '1'; } catch { return false; }
}

export function setDriveFlag(on, storage) {
    try {
        const s = storage || window.localStorage;
        if (on) s.setItem(DRIVE_FLAG_KEY, '1'); else s.removeItem(DRIVE_FLAG_KEY);
    } catch { /* storage blocked: the flag stays off */ }
}
