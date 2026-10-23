// usePockets(): the pockets model for a component (spec/programmable_accounts.md §4.5):
//   pockets, pocketsFor(ledger), total(ledger), balanceFor(ledger) (the switcher's selection),
//   holders(ledger), showDisclosure(ledger), selected / setSelected, hideEmpty / setHideEmpty,
//   create, rename, hide, forget, refresh, checkNumber(ledger, n), deepScan(ledger), loading, error,
//   rules(pocket, ledger), transfer(from, to, ledger, amount), pocketById(id).
// The first component that uses it switches the provider on (it reads nothing before that).
// Without a PocketsProvider it returns an empty, inert model, so a component can always call it.
import { useContext, useEffect } from 'react';
import { PocketsContext } from '../contexts/PocketsContext';
import { ALL, displayName } from '../utils/pockets/model';

const none = async () => { throw new Error('Pockets are not available here'); };
const EMPTY = Object.freeze({
    active: false, pockets: [], loading: false, error: null, discoveryNotes: [], ctx: null,
    selected: ALL, setSelected: () => {}, hideEmpty: true, setHideEmpty: () => {}, showQuiet: false, setShowQuiet: () => {},
    pocketsFor: () => [], total: () => 0n, balanceFor: () => 0n, holders: () => [], showDisclosure: () => false,
    displayName, create: none, rename: none, hide: none, forget: none, refresh: async () => {}, checkNumber: none, deepScan: none,
    rules: none, transfer: none, pocketById: () => null, registryEntries: () => [],
});

export function usePockets({ enabled = true } = {}) {
    const ctx = useContext(PocketsContext);
    useEffect(() => { if (enabled && ctx && !ctx.active) ctx.activate(); }, [enabled, ctx]);
    return ctx || EMPTY;
}

export default usePockets;
