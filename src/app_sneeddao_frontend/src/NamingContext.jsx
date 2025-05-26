import React, { createContext, useContext, useState, useEffect } from 'react';
import { useAuth } from './AuthContext';
import { getAllNeuronNames, getAllNeuronNicknames, getAllPrincipalNames, getAllPrincipalNicknames } from './utils/BackendUtils';
import { uint8ArrayToHex } from './utils/NeuronUtils';

const NamingContext = createContext();

export function NamingProvider({ children }) {
    const { identity } = useAuth();
    const [neuronNames, setNeuronNames] = useState(new Map());
    const [neuronNicknames, setNeuronNicknames] = useState(new Map());
    const [principalNames, setPrincipalNames] = useState(new Map());
    const [principalNicknames, setPrincipalNicknames] = useState(new Map());
    const [verifiedNames, setVerifiedNames] = useState(new Map());
    const [loading, setLoading] = useState(true);

    const fetchAllNames = async () => {
        try {
            setLoading(true);
            console.log('NamingContext: Starting to fetch all names...');
            const [neuronNamesData, neuronNicknamesData, principalNamesData, principalNicknamesData] = await Promise.all([
                getAllNeuronNames(identity),
                identity ? getAllNeuronNicknames(identity) : null,
                getAllPrincipalNames(identity),
                identity ? getAllPrincipalNicknames(identity) : null
            ]);

            console.log('NamingContext: Raw principal names data:', principalNamesData);
            console.log('NamingContext: Raw principal nicknames data:', principalNicknamesData);

            // Process neuron names
            const neuronNamesMap = new Map();
            const verifiedMap = new Map();
            if (neuronNamesData) {
                neuronNamesData.forEach(([key, nameData]) => {
                    const neuronId = uint8ArrayToHex(key.neuron_id.id);
                    const snsRoot = key.sns_root_canister_id.toString();
                    const mapKey = `${snsRoot}:${neuronId}`;
                    const [name, verified] = nameData;
                    neuronNamesMap.set(mapKey, name);
                    verifiedMap.set(mapKey, verified);
                });
            }
            setNeuronNames(neuronNamesMap);
            setVerifiedNames(verifiedMap);

            // Process neuron nicknames
            const neuronNicknamesMap = new Map();
            if (neuronNicknamesData) {
                neuronNicknamesData.forEach(([key, nickname]) => {
                    const neuronId = uint8ArrayToHex(key.neuron_id.id);
                    const snsRoot = key.sns_root_canister_id.toString();
                    const mapKey = `${snsRoot}:${neuronId}`;
                    neuronNicknamesMap.set(mapKey, nickname);
                });
            }
            setNeuronNicknames(neuronNicknamesMap);

            // Process principal names
            const principalNamesMap = new Map();
            if (principalNamesData) {
                console.log('NamingContext: Processing principal names, count:', principalNamesData.length);
                principalNamesData.forEach(([principalId, nameData]) => {
                    const [name, verified] = nameData;
                    const principalIdStr = principalId.toString();
                    console.log('NamingContext: Adding principal name:', principalIdStr, '->', name);
                    principalNamesMap.set(principalIdStr, name);
                    // Note: We could extend verifiedMap to include principal verification if needed
                });
            }
            setPrincipalNames(principalNamesMap);
            console.log('NamingContext: Final principal names map size:', principalNamesMap.size);

            // Process principal nicknames
            const principalNicknamesMap = new Map();
            if (principalNicknamesData) {
                console.log('NamingContext: Processing principal nicknames, count:', principalNicknamesData.length);
                principalNicknamesData.forEach(([principalId, nickname]) => {
                    const principalIdStr = principalId.toString();
                    console.log('NamingContext: Adding principal nickname:', principalIdStr, '->', nickname);
                    principalNicknamesMap.set(principalIdStr, nickname);
                });
            }
            setPrincipalNicknames(principalNicknamesMap);
            console.log('NamingContext: Final principal nicknames map size:', principalNicknamesMap.size);

        } catch (err) {
            console.error('Error fetching names:', err);
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

    const getPrincipalDisplayName = (principalId) => {
        if (!principalId) return null;
        const name = principalNames.get(principalId.toString());
        const nickname = principalNicknames.get(principalId.toString());
        
        return { name, nickname };
    };

    return (
        <NamingContext.Provider value={{
            neuronNames,
            neuronNicknames,
            principalNames,
            principalNicknames,
            verifiedNames,
            loading,
            fetchAllNames,
            getNeuronDisplayName,
            getPrincipalDisplayName
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