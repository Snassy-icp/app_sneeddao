import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../AuthContext';
import { getWalletLayout, setWalletLayout } from '../utils/BackendUtils';

const WalletLayoutContext = createContext(null);

const EMPTY_LAYOUT = {
    tokens: [],
    positions: [],
    apps: [],
    staking_bots: [],
};

export function WalletLayoutProvider({ children }) {
    const { identity } = useAuth();
    const [layout, setLayout] = useState(null); // null = not loaded yet
    const [loading, setLoading] = useState(false);
    const saveTimerRef = useRef(null);
    const latestLayoutRef = useRef(null);
    const identityRef = useRef(null);

    // Load layout when identity changes
    useEffect(() => {
        if (!identity) {
            setLayout(null);
            identityRef.current = null;
            return;
        }

        identityRef.current = identity;
        setLoading(true);

        getWalletLayout(identity).then(result => {
            // Only apply if identity hasn't changed while loading
            if (identityRef.current !== identity) return;
            setLayout(result || EMPTY_LAYOUT);
            latestLayoutRef.current = result || EMPTY_LAYOUT;
            setLoading(false);
        }).catch(err => {
            console.error('[WalletLayout] Failed to load layout:', err);
            if (identityRef.current !== identity) return;
            setLayout(EMPTY_LAYOUT);
            latestLayoutRef.current = EMPTY_LAYOUT;
            setLoading(false);
        });
    }, [identity]);

    // Save layout to backend (debounced)
    const saveLayout = useCallback((newLayout) => {
        if (!identity) return;

        setLayout(newLayout);
        latestLayoutRef.current = newLayout;

        // Debounce save to backend (500ms)
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        saveTimerRef.current = setTimeout(() => {
            setWalletLayout(identity, newLayout).catch(err => {
                console.error('[WalletLayout] Failed to save layout:', err);
            });
        }, 500);
    }, [identity]);

    // Helper: reorder a section by moving an item from one index to another
    const reorderSection = useCallback((section, fromIndex, toIndex) => {
        if (!layout) return;
        const list = [...(layout[section] || [])];
        const [moved] = list.splice(fromIndex, 1);
        list.splice(toIndex, 0, moved);
        const newLayout = { ...layout, [section]: list };
        saveLayout(newLayout);
    }, [layout, saveLayout]);

    // Helper: ensure an ID is in a section's list (append if missing)
    const ensureInSection = useCallback((section, id) => {
        if (!layout) return;
        const list = layout[section] || [];
        const normalizedId = typeof id === 'string' ? id : id.toString();
        if (list.includes(normalizedId)) return;
        const newLayout = { ...layout, [section]: [...list, normalizedId] };
        saveLayout(newLayout);
    }, [layout, saveLayout]);

    // Helper: remove an ID from a section
    const removeFromSection = useCallback((section, id) => {
        if (!layout) return;
        const normalizedId = typeof id === 'string' ? id : id.toString();
        const list = (layout[section] || []).filter(item => item !== normalizedId);
        const newLayout = { ...layout, [section]: list };
        saveLayout(newLayout);
    }, [layout, saveLayout]);

    // Helper: given a list of IDs, sort them by layout order, appending unknowns at end
    const sortByLayout = useCallback((section, items, getId) => {
        if (!layout || !layout[section] || layout[section].length === 0) return items;
        const order = layout[section];
        const orderMap = new Map(order.map((id, i) => [id, i]));
        return [...items].sort((a, b) => {
            const idA = getId(a);
            const idB = getId(b);
            const posA = orderMap.has(idA) ? orderMap.get(idA) : Infinity;
            const posB = orderMap.has(idB) ? orderMap.get(idB) : Infinity;
            if (posA === posB) return 0;
            return posA - posB;
        });
    }, [layout]);

    // Helper: batch-ensure multiple IDs are in a section (append only missing ones)
    const ensureManyInSection = useCallback((section, ids) => {
        if (!layout) return;
        const list = layout[section] || [];
        const existing = new Set(list);
        const toAdd = ids
            .map(id => typeof id === 'string' ? id : id.toString())
            .filter(id => !existing.has(id));
        if (toAdd.length === 0) return;
        const newLayout = { ...layout, [section]: [...list, ...toAdd] };
        saveLayout(newLayout);
    }, [layout, saveLayout]);

    // Update a full section list (e.g. after drag-and-drop reorder)
    const setSection = useCallback((section, newList) => {
        if (!layout) return;
        const normalizedList = newList.map(id => typeof id === 'string' ? id : id.toString());
        const newLayout = { ...layout, [section]: normalizedList };
        saveLayout(newLayout);
    }, [layout, saveLayout]);

    const value = {
        layout,
        loading,
        saveLayout,
        reorderSection,
        ensureInSection,
        ensureManyInSection,
        removeFromSection,
        sortByLayout,
        setSection,
    };

    return (
        <WalletLayoutContext.Provider value={value}>
            {children}
        </WalletLayoutContext.Provider>
    );
}

export function useWalletLayout() {
    return useContext(WalletLayoutContext);
}
