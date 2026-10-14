// Upgrades walk every published version between the running one and the target, in
// order, the way the canisters were upgraded when each version was current. A version's
// stable-memory migration is written against the version just before it, so skipping one
// can break the upgrade or lose state (the staking bot's 0.9.2 migration expects the
// 0.9.1 layout; from 0.9.0 it only works via 0.9.1).

function cmp(a, b) {
    const d = (x, y) => Number(x) - Number(y);
    return d(a.major, b.major) || d(a.minor, b.minor) || d(a.patch, b.patch);
}

function urlOf(v) {
    const u = Array.isArray(v?.wasmUrl) ? v.wasmUrl[0] : v?.wasmUrl;
    return typeof u === 'string' ? u.trim() : '';
}

/// The versions to install, oldest first, to go from `current` to `target`: every
/// version in `versions` with a wasm URL that is newer than `current` and not newer
/// than `target`, ending with `target`. With no known current version only the target
/// can be installed.
export function upgradeSteps(current, target, versions = []) {
    if (!target) return [];
    if (!current) return [target];
    const seen = new Set();
    const steps = versions
        .filter((v) => urlOf(v) && cmp(v, current) > 0 && cmp(v, target) < 0)
        .sort(cmp)
        .filter((v) => {
            const k = `${Number(v.major)}.${Number(v.minor)}.${Number(v.patch)}`;
            if (seen.has(k)) return false;
            seen.add(k);
            return true;
        });
    return [...steps, target];
}
