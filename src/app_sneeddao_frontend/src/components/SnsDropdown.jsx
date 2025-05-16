import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import { fetchAndCacheSnsData, clearSnsCache } from '../utils/SnsUtils';

function SnsDropdown() {
    const { identity } = useAuth();
    const [searchParams, setSearchParams] = useSearchParams();
    const [snsList, setSnsList] = useState([]);
    const [loadingSnses, setLoadingSnses] = useState(true);
    const [selectedSnsRoot, setSelectedSnsRoot] = useState(searchParams.get('sns') || '');

    const loadSnsData = async () => {
        setLoadingSnses(true);
        try {
            const data = await fetchAndCacheSnsData(identity);
            setSnsList(data);
            
            // If no SNS is selected but we have SNSes, select the first one
            if (!selectedSnsRoot && data.length > 0) {
                const defaultSns = data[0].rootCanisterId;
                setSelectedSnsRoot(defaultSns);
                setSearchParams(prev => {
                    prev.set('sns', defaultSns);
                    return prev;
                });
            }
        } catch (err) {
            console.error('Error loading SNS data:', err);
        } finally {
            setLoadingSnses(false);
        }
    };

    useEffect(() => {
        if (identity) {
            loadSnsData();
        }
    }, [identity]);

    const handleSnsChange = (e) => {
        const newSnsRoot = e.target.value;
        setSelectedSnsRoot(newSnsRoot);
        setSearchParams(prev => {
            prev.set('sns', newSnsRoot);
            return prev;
        });
    };

    return (
        <div style={{ display: 'flex', alignItems: 'center', marginRight: '15px' }}>
            <select
                value={selectedSnsRoot}
                onChange={handleSnsChange}
                style={{
                    backgroundColor: '#3a3a3a',
                    border: '1px solid #4a4a4a',
                    borderRadius: '4px',
                    color: '#ffffff',
                    padding: '8px 12px',
                    fontSize: '14px',
                    minWidth: '150px'
                }}
                disabled={loadingSnses}
            >
                {loadingSnses ? (
                    <option>Loading SNSes...</option>
                ) : (
                    <>
                        <option value="">Select an SNS</option>
                        {snsList.map(sns => (
                            <option key={sns.rootCanisterId} value={sns.rootCanisterId}>
                                {sns.name}
                            </option>
                        ))}
                    </>
                )}
            </select>
        </div>
    );
}

export default SnsDropdown; 