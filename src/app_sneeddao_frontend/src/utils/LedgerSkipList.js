/**
 * Ledger Skip List (gray list) - ledgers to skip during balance scans.
 * Entries are stored in localStorage and expire after ~1 week.
 * Being on the skip list does NOT affect whitelist or token dropdowns.
 */

const STORAGE_KEY = 'ledger-skip-list';
const EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 1 week

function load() {
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (!stored) return {};
        const parsed = JSON.parse(stored);
        return typeof parsed === 'object' && parsed !== null ? parsed : {};
    } catch (e) {
        console.warn('[LedgerSkipList] Error reading skip list:', e);
        return {};
    }
}

function save(entries) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
    } catch (e) {
        console.warn('[LedgerSkipList] Error saving skip list:', e);
    }
}

/**
 * Add a ledger ID to the skip list. Entry expires after ~1 week.
 * @param {string} ledgerId - Canister ID of the ledger
 */
export function addToSkipList(ledgerId) {
    if (!ledgerId || typeof ledgerId !== 'string') return;
    const entries = load();
    entries[ledgerId] = Date.now();
    save(entries);
}

/**
 * Check if a ledger ID is in the skip list (and not expired).
 * @param {string} ledgerId - Canister ID of the ledger
 * @returns {boolean}
 */
export function isInSkipList(ledgerId) {
    if (!ledgerId || typeof ledgerId !== 'string') return false;
    const entries = load();
    const ts = entries[ledgerId];
    if (!ts || typeof ts !== 'number') return false;
    if (Date.now() - ts > EXPIRY_MS) {
        delete entries[ledgerId];
        save(entries);
        return false;
    }
    return true;
}

/**
 * Get all valid (non-expired) ledger IDs in the skip list.
 * @returns {string[]}
 */
export function getSkipListLedgerIds() {
    const entries = load();
    const now = Date.now();
    let pruned = false;
    const valid = [];
    for (const [id, ts] of Object.entries(entries)) {
        if (typeof ts === 'number' && now - ts <= EXPIRY_MS) {
            valid.push(id);
        } else {
            pruned = true;
        }
    }
    if (pruned) {
        const prunedEntries = {};
        valid.forEach(id => { prunedEntries[id] = entries[id]; });
        save(prunedEntries);
    }
    return valid;
}

/**
 * Filter an array of ledger IDs to exclude those in the skip list.
 * @param {string[]} ledgerIds - Array of ledger IDs to filter
 * @returns {string[]} Ledger IDs not in the skip list
 */
export function filterSkipList(ledgerIds) {
    const skipSet = new Set(getSkipListLedgerIds());
    return ledgerIds.filter(id => !skipSet.has(id));
}

/**
 * Clear the entire skip list (gray list).
 * After clearing, all previously skipped ledgers will be scanned again on next balance check.
 */
export function clearSkipList() {
    try {
        localStorage.removeItem(STORAGE_KEY);
    } catch (e) {
        console.warn('[LedgerSkipList] Error clearing skip list:', e);
    }
}
