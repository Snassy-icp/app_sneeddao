import React, { useState, useEffect } from 'react';
import { useAuth } from '../AuthContext';
import { useNaming } from '../NamingContext';
import { useSns } from '../contexts/SnsContext';
import Header from '../components/Header';
import { PrincipalDisplay } from '../utils/PrincipalUtils';
import { Principal } from '@dfinity/principal';
import { formatNeuronIdLink } from '../utils/NeuronUtils';
import { 
    setNeuronName, 
    setPrincipalName, 
    setPrincipalNameFor,
    verifyNeuronName, 
    unverifyNeuronName, 
    verifyPrincipalName, 
    unverifyPrincipalName 
} from '../utils/BackendUtils';
import { createActor as createBackendActor, canisterId as BACKEND_CANISTER_ID } from 'declarations/app_sneeddao_backend';

const validateNameInput = (input) => {
    if (!input.trim()) return 'Name cannot be empty';
    if (input.length > 32) return 'Name cannot be longer than 32 characters';
    // Only allow letters, numbers, spaces, hyphens, underscores, dots, and apostrophes
    const validPattern = /^[a-zA-Z0-9\s\-_.']+$/;
    if (!validPattern.test(input)) {
        return 'Name can only contain letters, numbers, spaces, hyphens (-), underscores (_), dots (.), and apostrophes (\')';
    }
    return '';
};

function AdminNames() {
    const { identity } = useAuth();
    const { selectedSnsRoot } = useSns();
    const { 
        principalNames, 
        neuronNames, 
        verifiedNames,
        loading: namingLoading,
        fetchAllNames 
    } = useNaming();
    
    // Tab state
    const [activeTab, setActiveTab] = useState('names');
    
    // Names tab state
    const [searchTerm, setSearchTerm] = useState('');
    const [filterType, setFilterType] = useState('all'); // all, principals, neurons
    const [filterVerified, setFilterVerified] = useState('all'); // all, verified, unverified
    const [editingItem, setEditingItem] = useState(null);
    const [newName, setNewName] = useState('');
    const [nameError, setNameError] = useState('');
    const [loading, setLoading] = useState(false);
    const [currentPage, setCurrentPage] = useState(1);
    const [itemsPerPage, setItemsPerPage] = useState(50);
    
    // Nicknames tab state
    const [nicknameConfig, setNicknameConfig] = useState(null);
    const [formNicknameConfig, setFormNicknameConfig] = useState({
        sneed_premium_canister_id: '',
        max_neuron_nicknames: 10,
        max_principal_nicknames: 10,
        premium_max_neuron_nicknames: 100,
        premium_max_principal_nicknames: 100
    });
    const [savingNicknameConfig, setSavingNicknameConfig] = useState(false);
    const [nicknameConfigError, setNicknameConfigError] = useState(null);
    const [nicknameConfigSuccess, setNicknameConfigSuccess] = useState(null);
    const [loadingNicknameConfig, setLoadingNicknameConfig] = useState(false);

    // Create backend actor
    const getBackendActor = () => {
        if (!identity) return null;
        return createBackendActor(BACKEND_CANISTER_ID, {
            agentOptions: { identity }
        });
    };

    // Fetch nickname limits config
    useEffect(() => {
        const fetchNicknameConfig = async () => {
            if (activeTab !== 'nicknames') return;
            
            setLoadingNicknameConfig(true);
            try {
                const actor = getBackendActor();
                if (!actor) return;
                
                const config = await actor.get_nickname_limits_config();
                setNicknameConfig(config);
                setFormNicknameConfig({
                    sneed_premium_canister_id: config.sneed_premium_canister_id?.[0]?.toString() || '',
                    max_neuron_nicknames: Number(config.max_neuron_nicknames),
                    max_principal_nicknames: Number(config.max_principal_nicknames),
                    premium_max_neuron_nicknames: Number(config.premium_max_neuron_nicknames),
                    premium_max_principal_nicknames: Number(config.premium_max_principal_nicknames)
                });
            } catch (err) {
                console.error('Error fetching nickname config:', err);
                setNicknameConfigError('Failed to load nickname configuration');
            } finally {
                setLoadingNicknameConfig(false);
            }
        };
        
        fetchNicknameConfig();
    }, [activeTab, identity]);

    // Handle nickname config update
    const handleNicknameConfigUpdate = async (e) => {
        e.preventDefault();
        
        setSavingNicknameConfig(true);
        setNicknameConfigError(null);
        setNicknameConfigSuccess(null);
        
        try {
            const actor = getBackendActor();
            if (!actor) throw new Error('Failed to create backend actor');
            
            // Update premium canister ID
            let premiumCanisterId = [];
            if (formNicknameConfig.sneed_premium_canister_id && formNicknameConfig.sneed_premium_canister_id.trim()) {
                try {
                    const principal = Principal.fromText(formNicknameConfig.sneed_premium_canister_id.trim());
                    premiumCanisterId = [principal];
                } catch (e) {
                    setNicknameConfigError('Invalid Principal ID format for Sneed Premium Canister');
                    setSavingNicknameConfig(false);
                    return;
                }
            }
            
            // Set premium canister ID
            const setPremiumResult = await actor.set_nickname_premium_canister(premiumCanisterId.length > 0 ? premiumCanisterId : []);
            if ('err' in setPremiumResult) {
                throw new Error(setPremiumResult.err);
            }
            
            // Update limits
            const updateResult = await actor.update_nickname_limits(
                [BigInt(formNicknameConfig.max_neuron_nicknames)],
                [BigInt(formNicknameConfig.max_principal_nicknames)],
                [BigInt(formNicknameConfig.premium_max_neuron_nicknames)],
                [BigInt(formNicknameConfig.premium_max_principal_nicknames)]
            );
            
            if ('ok' in updateResult) {
                setNicknameConfigSuccess('Nickname configuration updated successfully!');
                // Refresh the config
                const newConfig = await actor.get_nickname_limits_config();
                setNicknameConfig(newConfig);
            } else {
                throw new Error(updateResult.err);
            }
        } catch (err) {
            console.error('Error updating nickname config:', err);
            setNicknameConfigError('Failed to update nickname configuration: ' + err.message);
        } finally {
            setSavingNicknameConfig(false);
        }
    };

    // Get all entries and combine them
    const getAllEntries = () => {
        const entries = [];
        
        // Add principal names (global - not per-SNS, so no snsRoot in key)
        if (principalNames) {
            principalNames.forEach((name, principalId) => {
                // Principal names are global, show them regardless of selectedSnsRoot filter
                // Use a placeholder snsRoot for display purposes
                    entries.push({
                        type: 'principal',
                    key: `global:${principalId}`,
                    snsRoot: 'global',
                        id: principalId,
                        name,
                    isVerified: verifiedNames?.get(principalId) || false
                    });
            });
        }
        
        // Add neuron names (per-SNS, key format is snsRoot:neuronId)
        if (neuronNames) {
            neuronNames.forEach((name, key) => {
                const [snsRoot, neuronId] = key.split(':');
                if (!selectedSnsRoot || snsRoot === selectedSnsRoot) {
                    entries.push({
                        type: 'neuron',
                        key,
                        snsRoot,
                        id: neuronId,
                        name,
                        isVerified: verifiedNames?.get(key) || false
                    });
                }
            });
        }
        
        return entries;
    };

    // Filter and search entries
    const getFilteredEntries = () => {
        let entries = getAllEntries();
        
        // Apply search filter
        if (searchTerm.trim()) {
            const searchLower = searchTerm.toLowerCase();
            entries = entries.filter(entry => 
                entry.name.toLowerCase().includes(searchLower) ||
                entry.id.toLowerCase().includes(searchLower)
            );
        }
        
        // Apply type filter
        if (filterType !== 'all') {
            entries = entries.filter(entry => entry.type === filterType);
        }
        
        // Apply verified filter
        if (filterVerified !== 'all') {
            entries = entries.filter(entry => 
                filterVerified === 'verified' ? entry.isVerified : !entry.isVerified
            );
        }
        
        // Sort by name
        entries.sort((a, b) => a.name.localeCompare(b.name));
        
        return entries;
    };

    const filteredEntries = getFilteredEntries();
    const totalPages = Math.ceil(filteredEntries.length / itemsPerPage);
    const paginatedEntries = filteredEntries.slice(
        (currentPage - 1) * itemsPerPage,
        currentPage * itemsPerPage
    );

    const handleEdit = (entry) => {
        setEditingItem(entry);
        setNewName(entry.name);
        setNameError('');
    };

    const handleSaveName = async (item) => {
        if (!validateNameInput(editingItem.name)) {
            alert('Invalid name. Names must be 1-32 characters and contain only letters, numbers, spaces, and basic punctuation.');
            return;
        }

        setLoading(true);
        try {
            let response;
            if (item.type === 'neuron') {
                response = await setNeuronName(identity, selectedSnsRoot, item.id, editingItem.name);
            } else {
                // For principals, use setPrincipalNameFor for admin functionality
                response = await setPrincipalNameFor(identity, item.id, editingItem.name, selectedSnsRoot);
            }

            if (response && 'ok' in response) {
                // Refresh the naming context data
                await fetchAllNames();
                setEditingItem(null);
                alert('Name updated successfully!');
            } else {
                const errorMsg = response?.err || 'Unknown error occurred';
                alert(`Failed to update name: ${errorMsg}`);
            }
        } catch (error) {
            console.error('Error updating name:', error);
            alert(`Error updating name: ${error.message}`);
        } finally {
            setLoading(false);
        }
    };

    const handleToggleVerification = async (item) => {
        setLoading(true);
        try {
            let response;
            if (item.type === 'neuron') {
                if (item.isVerified) {
                    response = await unverifyNeuronName(identity, selectedSnsRoot, item.id);
                } else {
                    response = await verifyNeuronName(identity, selectedSnsRoot, item.id);
                }
            } else {
                if (item.isVerified) {
                    response = await unverifyPrincipalName(identity, item.id);
                } else {
                    response = await verifyPrincipalName(identity, item.id);
                }
            }

            if (response && 'ok' in response) {
                // Refresh the naming context data
                await fetchAllNames();
                alert(`${item.isVerified ? 'Unverified' : 'Verified'} successfully!`);
            } else {
                const errorMsg = response?.err || 'Unknown error occurred';
                alert(`Failed to ${item.isVerified ? 'unverify' : 'verify'}: ${errorMsg}`);
            }
        } catch (error) {
            console.error('Error toggling verification:', error);
            alert(`Error toggling verification: ${error.message}`);
        } finally {
            setLoading(false);
        }
    };

    const handleCancel = () => {
        setEditingItem(null);
        setNewName('');
        setNameError('');
    };

    const handlePageChange = (newPage) => {
        setCurrentPage(newPage);
    };

    // Render the Nicknames tab content
    const renderNicknamesTab = () => (
        <div>
            <div style={{ marginBottom: '20px' }}>
                <h2 style={{ color: '#ffffff', marginBottom: '10px' }}>Nickname Limits Configuration</h2>
                <p style={{ color: '#888', margin: 0 }}>
                    Configure limits for how many nicknames users can create. Premium members get higher limits.
                </p>
            </div>

            {loadingNicknameConfig ? (
                <div style={{ textAlign: 'center', padding: '40px', color: '#888' }}>
                    Loading configuration...
                </div>
            ) : (
                <div style={{
                    backgroundColor: '#2a2a2a',
                    borderRadius: '12px',
                    padding: '30px'
                }}>
                    {nicknameConfigError && (
                        <div style={{
                            backgroundColor: 'rgba(231, 76, 60, 0.1)',
                            border: '1px solid #e74c3c',
                            borderRadius: '8px',
                            padding: '12px',
                            marginBottom: '20px',
                            color: '#e74c3c'
                        }}>
                            {nicknameConfigError}
                        </div>
                    )}

                    {nicknameConfigSuccess && (
                        <div style={{
                            backgroundColor: 'rgba(46, 204, 113, 0.1)',
                            border: '1px solid #2ecc71',
                            borderRadius: '8px',
                            padding: '12px',
                            marginBottom: '20px',
                            color: '#2ecc71'
                        }}>
                            {nicknameConfigSuccess}
                        </div>
                    )}

                    <form onSubmit={handleNicknameConfigUpdate}>
                        {/* Premium Canister ID */}
                        <div style={{ marginBottom: '20px' }}>
                            <label style={{ color: '#ffffff', display: 'block', marginBottom: '8px', fontWeight: '500' }}>
                                Sneed Premium Canister ID
                            </label>
                            <input
                                type="text"
                                placeholder="e.g., 7gump-4aaaa-aaaal-qtyka-cai (leave empty to disable premium limits)"
                                value={formNicknameConfig.sneed_premium_canister_id}
                                onChange={(e) => setFormNicknameConfig(prev => ({ ...prev, sneed_premium_canister_id: e.target.value }))}
                                style={{
                                    width: '100%',
                                    padding: '12px',
                                    borderRadius: '8px',
                                    border: '1px solid #3a3a3a',
                                    backgroundColor: '#1a1a1a',
                                    color: '#ffffff',
                                    fontSize: '16px'
                                }}
                            />
                            <div style={{ color: '#888', fontSize: '12px', marginTop: '4px' }}>
                                The canister ID of the Sneed Premium membership canister. Leave empty to disable premium limits.
                            </div>
                        </div>

                        {/* Regular Limits */}
                        <h3 style={{ color: '#ffffff', marginBottom: '15px', marginTop: '30px' }}>Regular User Limits</h3>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '20px' }}>
                            <div>
                                <label style={{ color: '#ffffff', display: 'block', marginBottom: '8px', fontWeight: '500' }}>
                                    Max Neuron Nicknames
                                </label>
                                <input
                                    type="number"
                                    min="1"
                                    value={formNicknameConfig.max_neuron_nicknames}
                                    onChange={(e) => setFormNicknameConfig(prev => ({ ...prev, max_neuron_nicknames: parseInt(e.target.value) || 1 }))}
                                    style={{
                                        width: '100%',
                                        padding: '12px',
                                        borderRadius: '8px',
                                        border: '1px solid #3a3a3a',
                                        backgroundColor: '#1a1a1a',
                                        color: '#ffffff',
                                        fontSize: '16px'
                                    }}
                                />
                            </div>
                            <div>
                                <label style={{ color: '#ffffff', display: 'block', marginBottom: '8px', fontWeight: '500' }}>
                                    Max Principal Nicknames
                                </label>
                                <input
                                    type="number"
                                    min="1"
                                    value={formNicknameConfig.max_principal_nicknames}
                                    onChange={(e) => setFormNicknameConfig(prev => ({ ...prev, max_principal_nicknames: parseInt(e.target.value) || 1 }))}
                                    style={{
                                        width: '100%',
                                        padding: '12px',
                                        borderRadius: '8px',
                                        border: '1px solid #3a3a3a',
                                        backgroundColor: '#1a1a1a',
                                        color: '#ffffff',
                                        fontSize: '16px'
                                    }}
                                />
                            </div>
                        </div>

                        {/* Premium Limits */}
                        <h3 style={{ color: '#ffd700', marginBottom: '15px', marginTop: '30px' }}>⭐ Premium User Limits</h3>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '20px' }}>
                            <div>
                                <label style={{ color: '#ffffff', display: 'block', marginBottom: '8px', fontWeight: '500' }}>
                                    Premium Max Neuron Nicknames
                                </label>
                                <input
                                    type="number"
                                    min="1"
                                    value={formNicknameConfig.premium_max_neuron_nicknames}
                                    onChange={(e) => setFormNicknameConfig(prev => ({ ...prev, premium_max_neuron_nicknames: parseInt(e.target.value) || 1 }))}
                                    style={{
                                        width: '100%',
                                        padding: '12px',
                                        borderRadius: '8px',
                                        border: '1px solid #ffd700',
                                        backgroundColor: '#1a1a1a',
                                        color: '#ffffff',
                                        fontSize: '16px'
                                    }}
                                />
                            </div>
                            <div>
                                <label style={{ color: '#ffffff', display: 'block', marginBottom: '8px', fontWeight: '500' }}>
                                    Premium Max Principal Nicknames
                                </label>
                                <input
                                    type="number"
                                    min="1"
                                    value={formNicknameConfig.premium_max_principal_nicknames}
                                    onChange={(e) => setFormNicknameConfig(prev => ({ ...prev, premium_max_principal_nicknames: parseInt(e.target.value) || 1 }))}
                                    style={{
                                        width: '100%',
                                        padding: '12px',
                                        borderRadius: '8px',
                                        border: '1px solid #ffd700',
                                        backgroundColor: '#1a1a1a',
                                        color: '#ffffff',
                                        fontSize: '16px'
                                    }}
                                />
                            </div>
                        </div>

                        {/* Comparison Box */}
                        <div style={{ 
                            backgroundColor: 'rgba(255, 215, 0, 0.1)', 
                            border: '1px solid #ffd700', 
                            padding: '15px', 
                            borderRadius: '8px',
                            marginTop: '30px'
                        }}>
                            <strong style={{ color: '#ffd700' }}>Limits Comparison:</strong>
                            <div style={{ color: '#ccc', marginTop: '10px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                                <div>Regular Neuron Nicknames: <strong>{formNicknameConfig.max_neuron_nicknames}</strong></div>
                                <div>Premium Neuron Nicknames: <strong style={{ color: '#4caf50' }}>{formNicknameConfig.premium_max_neuron_nicknames}</strong></div>
                                <div>Regular Principal Nicknames: <strong>{formNicknameConfig.max_principal_nicknames}</strong></div>
                                <div>Premium Principal Nicknames: <strong style={{ color: '#4caf50' }}>{formNicknameConfig.premium_max_principal_nicknames}</strong></div>
                            </div>
                        </div>

                        <button
                            type="submit"
                            disabled={savingNicknameConfig}
                            style={{
                                backgroundColor: savingNicknameConfig ? '#555' : '#3498db',
                                color: '#ffffff',
                                border: 'none',
                                borderRadius: '8px',
                                padding: '12px 24px',
                                fontSize: '16px',
                                fontWeight: '600',
                                cursor: savingNicknameConfig ? 'not-allowed' : 'pointer',
                                marginTop: '30px',
                                transition: 'background-color 0.2s ease'
                            }}
                        >
                            {savingNicknameConfig ? 'Saving...' : 'Update Configuration'}
                        </button>
                    </form>
                </div>
            )}
        </div>
    );

    return (
        <div className='page-container'>
            <Header showSnsDropdown={true} />
            <main className="wallet-container">
                <div style={{ marginBottom: '20px' }}>
                    <h1 style={{ color: '#ffffff', marginBottom: '10px' }}>Admin - Names & Nicknames</h1>
                    <p style={{ color: '#888', margin: 0 }}>
                        Manage principal and neuron names, and configure nickname limits
                    </p>
                </div>

                {/* Tabs */}
                <div style={{ 
                    display: 'flex', 
                    gap: '10px', 
                    marginBottom: '20px',
                    borderBottom: '1px solid #3a3a3a',
                    paddingBottom: '10px'
                }}>
                    <button
                        onClick={() => setActiveTab('names')}
                        style={{
                            backgroundColor: activeTab === 'names' ? '#3498db' : 'transparent',
                            color: activeTab === 'names' ? '#ffffff' : '#888',
                            border: activeTab === 'names' ? 'none' : '1px solid #3a3a3a',
                            borderRadius: '8px',
                            padding: '10px 20px',
                            fontSize: '14px',
                            fontWeight: '600',
                            cursor: 'pointer',
                            transition: 'all 0.2s ease'
                        }}
                    >
                        📝 Names
                    </button>
                    <button
                        onClick={() => setActiveTab('nicknames')}
                        style={{
                            backgroundColor: activeTab === 'nicknames' ? '#3498db' : 'transparent',
                            color: activeTab === 'nicknames' ? '#ffffff' : '#888',
                            border: activeTab === 'nicknames' ? 'none' : '1px solid #3a3a3a',
                            borderRadius: '8px',
                            padding: '10px 20px',
                            fontSize: '14px',
                            fontWeight: '600',
                            cursor: 'pointer',
                            transition: 'all 0.2s ease'
                        }}
                    >
                        ⭐ Nicknames Config
                    </button>
                </div>

                {activeTab === 'nicknames' ? renderNicknamesTab() : (
                <>
                {/* Filters */}
                <div style={{ 
                    backgroundColor: '#2a2a2a',
                    borderRadius: '8px',
                    padding: '20px',
                    marginBottom: '20px',
                    display: 'flex',
                    gap: '15px',
                    alignItems: 'center',
                    flexWrap: 'wrap'
                }}>
                    <input
                        type="text"
                        value={searchTerm}
                        onChange={(e) => {
                            setSearchTerm(e.target.value);
                            setCurrentPage(1);
                        }}
                        placeholder="Search by name or ID..."
                        style={{
                            backgroundColor: '#3a3a3a',
                            color: '#ffffff',
                            border: '1px solid #4a4a4a',
                            borderRadius: '4px',
                            padding: '8px 12px',
                            flex: 1,
                            minWidth: '200px'
                        }}
                    />
                    
                    <select
                        value={filterType}
                        onChange={(e) => {
                            setFilterType(e.target.value);
                            setCurrentPage(1);
                        }}
                        style={{
                            backgroundColor: '#3a3a3a',
                            color: '#ffffff',
                            border: '1px solid #4a4a4a',
                            borderRadius: '4px',
                            padding: '8px 12px'
                        }}
                    >
                        <option value="all">All Types</option>
                        <option value="principal">Principals</option>
                        <option value="neuron">Neurons</option>
                    </select>
                    
                    <select
                        value={filterVerified}
                        onChange={(e) => {
                            setFilterVerified(e.target.value);
                            setCurrentPage(1);
                        }}
                        style={{
                            backgroundColor: '#3a3a3a',
                            color: '#ffffff',
                            border: '1px solid #4a4a4a',
                            borderRadius: '4px',
                            padding: '8px 12px'
                        }}
                    >
                        <option value="all">All Status</option>
                        <option value="verified">Verified</option>
                        <option value="unverified">Unverified</option>
                    </select>

                    <select
                        value={itemsPerPage}
                        onChange={(e) => {
                            setItemsPerPage(Number(e.target.value));
                            setCurrentPage(1);
                        }}
                        style={{
                            backgroundColor: '#3a3a3a',
                            color: '#ffffff',
                            border: '1px solid #4a4a4a',
                            borderRadius: '4px',
                            padding: '8px 12px'
                        }}
                    >
                        <option value={25}>25 per page</option>
                        <option value={50}>50 per page</option>
                        <option value={100}>100 per page</option>
                    </select>
                </div>

                {/* Stats */}
                <div style={{ 
                    backgroundColor: '#2a2a2a',
                    borderRadius: '8px',
                    padding: '15px 20px',
                    marginBottom: '20px',
                    display: 'flex',
                    gap: '30px',
                    alignItems: 'center'
                }}>
                    <div style={{ color: '#888' }}>
                        Total: <span style={{ color: '#ffffff', fontWeight: 'bold' }}>{filteredEntries.length}</span>
                    </div>
                    <div style={{ color: '#888' }}>
                        Principals: <span style={{ color: '#ffffff', fontWeight: 'bold' }}>
                            {filteredEntries.filter(e => e.type === 'principal').length}
                        </span>
                    </div>
                    <div style={{ color: '#888' }}>
                        Neurons: <span style={{ color: '#ffffff', fontWeight: 'bold' }}>
                            {filteredEntries.filter(e => e.type === 'neuron').length}
                        </span>
                    </div>
                    <div style={{ color: '#888' }}>
                        Verified: <span style={{ color: '#2ecc71', fontWeight: 'bold' }}>
                            {filteredEntries.filter(e => e.isVerified).length}
                        </span>
                    </div>
                </div>

                {/* Names Table */}
                <div style={{ 
                    backgroundColor: '#2a2a2a',
                    borderRadius: '8px',
                    overflow: 'hidden'
                }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                            <tr style={{ backgroundColor: '#3a3a3a' }}>
                                <th style={{ 
                                    padding: '15px', 
                                    textAlign: 'left', 
                                    color: '#888',
                                    fontWeight: 'bold',
                                    width: '10%'
                                }}>
                                    Type
                                </th>
                                <th style={{ 
                                    padding: '15px', 
                                    textAlign: 'left', 
                                    color: '#888',
                                    fontWeight: 'bold',
                                    width: '25%'
                                }}>
                                    Name
                                </th>
                                <th style={{ 
                                    padding: '15px', 
                                    textAlign: 'left', 
                                    color: '#888',
                                    fontWeight: 'bold',
                                    width: '35%'
                                }}>
                                    ID
                                </th>
                                <th style={{ 
                                    padding: '15px', 
                                    textAlign: 'left', 
                                    color: '#888',
                                    fontWeight: 'bold',
                                    width: '10%'
                                }}>
                                    SNS
                                </th>
                                <th style={{ 
                                    padding: '15px', 
                                    textAlign: 'left', 
                                    color: '#888',
                                    fontWeight: 'bold',
                                    width: '10%'
                                }}>
                                    Status
                                </th>
                                <th style={{ 
                                    padding: '15px', 
                                    textAlign: 'left', 
                                    color: '#888',
                                    fontWeight: 'bold',
                                    width: '10%'
                                }}>
                                    Actions
                                </th>
                            </tr>
                        </thead>
                        <tbody>
                            {paginatedEntries.map((entry, index) => (
                                <tr key={entry.key} style={{ 
                                    borderBottom: '1px solid #3a3a3a',
                                    backgroundColor: index % 2 === 0 ? 'transparent' : 'rgba(255, 255, 255, 0.02)'
                                }}>
                                    <td style={{ padding: '15px', color: '#ffffff' }}>
                                        <span style={{
                                            backgroundColor: entry.type === 'principal' ? '#3498db' : '#e67e22',
                                            color: '#ffffff',
                                            padding: '4px 8px',
                                            borderRadius: '4px',
                                            fontSize: '12px',
                                            fontWeight: 'bold'
                                        }}>
                                            {entry.type === 'principal' ? 'PRINCIPAL' : 'NEURON'}
                                        </span>
                                    </td>
                                    <td style={{ padding: '15px', color: '#ffffff' }}>
                                        {editingItem?.key === entry.key ? (
                                            <div>
                                                <input
                                                    type="text"
                                                    value={newName}
                                                    onChange={(e) => setNewName(e.target.value)}
                                                    style={{
                                                        backgroundColor: '#3a3a3a',
                                                        color: '#ffffff',
                                                        border: nameError ? '1px solid #e74c3c' : '1px solid #4a4a4a',
                                                        borderRadius: '4px',
                                                        padding: '6px 8px',
                                                        width: '100%',
                                                        marginBottom: nameError ? '5px' : '0'
                                                    }}
                                                    placeholder="Enter name..."
                                                />
                                                {nameError && (
                                                    <div style={{ color: '#e74c3c', fontSize: '12px' }}>
                                                        {nameError}
                                                    </div>
                                                )}
                                            </div>
                                        ) : (
                                            <span style={{ fontWeight: 'bold' }}>{entry.name}</span>
                                        )}
                                    </td>
                                    <td style={{ padding: '15px', color: '#ffffff' }}>
                                        {entry.type === 'principal' ? (
                                            <PrincipalDisplay 
                                                principal={Principal.fromText(entry.id)}
                                                showCopyButton={true}
                                                maxLength={20}
                                            />
                                        ) : (
                                            formatNeuronIdLink(entry.id, entry.snsRoot)
                                        )}
                                    </td>
                                    <td style={{ padding: '15px', color: '#888', fontSize: '12px' }}>
                                        {entry.snsRoot === 'global' ? (
                                            <span style={{ color: '#9b59b6', fontStyle: 'italic' }}>Global</span>
                                        ) : (
                                            `${entry.snsRoot.substring(0, 8)}...`
                                        )}
                                    </td>
                                    <td style={{ padding: '15px' }}>
                                        <button
                                            onClick={() => handleToggleVerification(entry)}
                                            disabled={loading}
                                            style={{
                                                backgroundColor: entry.isVerified ? '#2ecc71' : '#e74c3c',
                                                color: '#ffffff',
                                                border: 'none',
                                                borderRadius: '4px',
                                                padding: '4px 8px',
                                                fontSize: '12px',
                                                cursor: loading ? 'not-allowed' : 'pointer',
                                                opacity: loading ? 0.7 : 1
                                            }}
                                        >
                                            {entry.isVerified ? 'VERIFIED' : 'UNVERIFIED'}
                                        </button>
                                    </td>
                                    <td style={{ padding: '15px' }}>
                                        {editingItem?.key === entry.key ? (
                                            <div style={{ display: 'flex', gap: '5px' }}>
                                                <button
                                                    onClick={() => handleSaveName(entry)}
                                                    disabled={loading}
                                                    style={{
                                                        backgroundColor: '#2ecc71',
                                                        color: '#ffffff',
                                                        border: 'none',
                                                        borderRadius: '4px',
                                                        padding: '6px 10px',
                                                        fontSize: '12px',
                                                        cursor: loading ? 'not-allowed' : 'pointer',
                                                        opacity: loading ? 0.7 : 1
                                                    }}
                                                >
                                                    Save
                                                </button>
                                                <button
                                                    onClick={handleCancel}
                                                    disabled={loading}
                                                    style={{
                                                        backgroundColor: '#e74c3c',
                                                        color: '#ffffff',
                                                        border: 'none',
                                                        borderRadius: '4px',
                                                        padding: '6px 10px',
                                                        fontSize: '12px',
                                                        cursor: loading ? 'not-allowed' : 'pointer',
                                                        opacity: loading ? 0.7 : 1
                                                    }}
                                                >
                                                    Cancel
                                                </button>
                                            </div>
                                        ) : (
                                            <button
                                                onClick={() => handleEdit(entry)}
                                                disabled={loading}
                                                style={{
                                                    backgroundColor: '#3498db',
                                                    color: '#ffffff',
                                                    border: 'none',
                                                    borderRadius: '4px',
                                                    padding: '6px 10px',
                                                    fontSize: '12px',
                                                    cursor: loading ? 'not-allowed' : 'pointer',
                                                    opacity: loading ? 0.7 : 1
                                                }}
                                            >
                                                Edit
                                            </button>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                {/* Pagination */}
                {totalPages > 1 && (
                    <div style={{ 
                        display: 'flex',
                        justifyContent: 'center',
                        alignItems: 'center',
                        gap: '10px',
                        marginTop: '20px'
                    }}>
                        <button
                            onClick={() => handlePageChange(currentPage - 1)}
                            disabled={currentPage === 1}
                            style={{
                                backgroundColor: '#3498db',
                                color: '#ffffff',
                                border: 'none',
                                borderRadius: '4px',
                                padding: '8px 16px',
                                cursor: currentPage === 1 ? 'not-allowed' : 'pointer',
                                opacity: currentPage === 1 ? 0.7 : 1
                            }}
                        >
                            Previous
                        </button>
                        
                        <span style={{ color: '#ffffff' }}>
                            Page {currentPage} of {totalPages}
                        </span>
                        
                        <button
                            onClick={() => handlePageChange(currentPage + 1)}
                            disabled={currentPage === totalPages}
                            style={{
                                backgroundColor: '#3498db',
                                color: '#ffffff',
                                border: 'none',
                                borderRadius: '4px',
                                padding: '8px 16px',
                                cursor: currentPage === totalPages ? 'not-allowed' : 'pointer',
                                opacity: currentPage === totalPages ? 0.7 : 1
                            }}
                        >
                            Next
                        </button>
                    </div>
                )}

                {filteredEntries.length === 0 && (
                    <div style={{ 
                        textAlign: 'center', 
                        color: '#888', 
                        padding: '40px',
                        backgroundColor: '#2a2a2a',
                        borderRadius: '8px',
                        marginTop: '20px'
                    }}>
                        No names found matching your filters.
                    </div>
                )}
                </>
                )}
            </main>
        </div>
    );
}

export default AdminNames; 