import React, { createContext, useContext, useState, useEffect } from 'react';
import { useAuth } from './AuthContext';
import { getAllNeuronNames, getAllNeuronNicknames } from './utils/BackendUtils';
import { uint8ArrayToHex } from './utils/NeuronUtils';

const NamingContext = createContext();

export function NamingProvider({ children }) {
    const { identity } = useAuth();
    const [neuronNames, setNeuronNames] = useState(new Map());
    const [neuronNicknames, setNeuronNicknames] = useState(new Map());
    const [verifiedNames, setVerifiedNames] = useState(new Map());
    const [loading, setLoading] = useState(true);

    const fetchAllNames = async () => {
        try {
            setLoading(true);
            const [names, nicknames] = await Promise.all([
                getAllNeuronNames(identity),
                identity ? getAllNeuronNicknames(identity) : null
            ]);

            // Process names
            const namesMap = new Map();
            const verifiedMap = new Map();
            if (names) {
                names.forEach(([key, nameData]) => {
                    const neuronId = uint8ArrayToHex(key.neuron_id.id);
                    const snsRoot = key.sns_root_canister_id.toString();
                    const mapKey = `${snsRoot}:${neuronId}`;
                    const [name, verified] = nameData;
                    namesMap.set(mapKey, name);
                    verifiedMap.set(mapKey, verified);
                });
            }
            setNeuronNames(namesMap);
            setVerifiedNames(verifiedMap);

            // Process nicknames
            const nicknamesMap = new Map();
            if (nicknames) {
                nicknames.forEach(([key, nickname]) => {
                    const neuronId = uint8ArrayToHex(key.neuron_id.id);
                    const snsRoot = key.sns_root_canister_id.toString();
                    const mapKey = `${snsRoot}:${neuronId}`;
                    nicknamesMap.set(mapKey, nickname);
                });
            }
            setNeuronNicknames(nicknamesMap);
        } catch (err) {
            console.error('Error fetching neuron names:', err);
        } finally {
            setLoading(false);
        }
    };

    // Initial fetch
    useEffect(() => {
        fetchAllNames();
    }, [identity]);

    const getNeuronDisplayName = (neuronId, snsRoot) => {
        if (!neuronId || !snsRoot) return null;
        const mapKey = `${snsRoot}:${neuronId}`;
        const name = neuronNames.get(mapKey);
        const nickname = neuronNicknames.get(mapKey);
        const isVerified = verifiedNames.get(mapKey);
        
        return { name, nickname, isVerified };
    };

    return (
        <NamingContext.Provider value={{
            neuronNames,
            neuronNicknames,
            verifiedNames,
            loading,
            fetchAllNames,
            getNeuronDisplayName
        }}>
            {children}
        </NamingContext.Provider>
    );
}

export function useNaming() {
    const context = useContext(NamingContext);
    if (!context) {
        throw new Error('useNaming must be used within a NamingProvider');
    }
    return context;
} 