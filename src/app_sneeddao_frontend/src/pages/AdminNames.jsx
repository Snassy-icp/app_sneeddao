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
    
    const [searchTerm, setSearchTerm] = useState('');
    const [filterType, setFilterType] = useState('all'); // all, principals, neurons
    const [filterVerified, setFilterVerified] = useState('all'); // all, verified, unverified
    const [editingItem, setEditingItem] = useState(null);
    const [newName, setNewName] = useState('');
    const [nameError, setNameError] = useState('');
    const [loading, setLoading] = useState(false);
    const [currentPage, setCurrentPage] = useState(1);
    const [itemsPerPage, setItemsPerPage] = useState(50);

    // Get all entries and combine them
    const getAllEntries = () => {
        const entries = [];
        
        // Add principal names
        if (principalNames) {
            principalNames.forEach((name, key) => {
                const [snsRoot, principalId] = key.split(':');
                if (!selectedSnsRoot || snsRoot === selectedSnsRoot) {
                    entries.push({
                        type: 'principal',
                        key,
                        snsRoot,
                        id: principalId,
                        name,
                        isVerified: verifiedNames?.get(key) || false
                    });
                }
            });
        }
        
        // Add neuron names
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
                if (item.verified) {
                    response = await unverifyNeuronName(identity, selectedSnsRoot, item.id);
                } else {
                    response = await verifyNeuronName(identity, selectedSnsRoot, item.id);
                }
            } else {
                if (item.verified) {
                    response = await unverifyPrincipalName(identity, item.id);
                } else {
                    response = await verifyPrincipalName(identity, item.id);
                }
            }

            if (response && 'ok' in response) {
                // Refresh the naming context data
                await fetchAllNames();
                alert(`${item.verified ? 'Unverified' : 'Verified'} successfully!`);
            } else {
                const errorMsg = response?.err || 'Unknown error occurred';
                alert(`Failed to ${item.verified ? 'unverify' : 'verify'}: ${errorMsg}`);
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

    return (
        <div className='page-container'>
            <Header showSnsDropdown={true} />
            <main className="wallet-container">
                <div style={{ marginBottom: '20px' }}>
                    <h1 style={{ color: '#ffffff', marginBottom: '10px' }}>Admin - Names Management</h1>
                    <p style={{ color: '#888', margin: 0 }}>
                        Manage principal and neuron names across all SNS instances
                    </p>
                </div>

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
                                        {entry.snsRoot.substring(0, 8)}...
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
            </main>
        </div>
    );
}

export default AdminNames; 