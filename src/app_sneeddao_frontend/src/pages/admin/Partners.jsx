import React, { useState, useEffect } from 'react';
import { createActor as createBackendActor, canisterId as backendCanisterId } from 'declarations/app_sneeddao_backend';
import { useAuth } from '../../AuthContext';
import Header from '../../components/Header';

function AdminPartners() {
    const { identity } = useAuth();
    const [partners, setPartners] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [showForm, setShowForm] = useState(false);
    const [editingPartner, setEditingPartner] = useState(null);
    const [formData, setFormData] = useState({
        name: '',
        logoUrl: '',
        description: '',
        index: '',
        links: [{ title: '', url: '' }]
    });
    const [newLink, setNewLink] = useState({ title: '', url: '' });

    useEffect(() => {
        fetchPartners();
    }, []);

    const fetchPartners = async () => {
        setLoading(true);
        try {
            const backendActor = createBackendActor(backendCanisterId, {
                agentOptions: {
                    host: process.env.DFX_NETWORK === 'ic' ? 'https://ic0.app' : 'http://localhost:4943',
                }
            });
            const result = await backendActor.get_partners();
            setPartners(result);
            setError('');
        } catch (err) {
            console.error('Error fetching partners:', err);
            setError('Failed to load partners');
        } finally {
            setLoading(false);
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!identity) {
            setError('You must be logged in to manage partners');
            return;
        }

        try {
            const backendActor = createBackendActor(backendCanisterId, {
                agentOptions: {
                    host: process.env.DFX_NETWORK === 'ic' ? 'https://ic0.app' : 'http://localhost:4943',
                    identity: identity
                }
            });

            const validLinks = formData.links.filter(link => 
                link.title.trim() && link.url.trim()
            );

            const index = formData.index.trim() ? parseInt(formData.index.trim()) : null;

            let result;
            if (editingPartner) {
                result = await backendActor.update_partner(
                    editingPartner.id,
                    formData.name.trim(),
                    formData.logoUrl.trim(),
                    formData.description.trim(),
                    validLinks,
                    index ? [index] : []
                );
            } else {
                result = await backendActor.add_partner(
                    formData.name.trim(),
                    formData.logoUrl.trim(),
                    formData.description.trim(),
                    validLinks,
                    index ? [index] : []
                );
            }

            if ('ok' in result) {
                setSuccess(editingPartner ? 'Partner updated successfully!' : 'Partner added successfully!');
                setShowForm(false);
                setEditingPartner(null);
                resetForm();
                fetchPartners();
            } else {
                setError(result.err);
            }
        } catch (err) {
            console.error('Error saving partner:', err);
            setError('Failed to save partner');
        }
    };

    const handleDelete = async (partnerId) => {
        if (!identity) {
            setError('You must be logged in to manage partners');
            return;
        }

        if (!window.confirm('Are you sure you want to delete this partner?')) {
            return;
        }

        try {
            const backendActor = createBackendActor(backendCanisterId, {
                agentOptions: {
                    host: process.env.DFX_NETWORK === 'ic' ? 'https://ic0.app' : 'http://localhost:4943',
                    identity: identity
                }
            });

            const result = await backendActor.remove_partner(partnerId);
            if ('ok' in result) {
                setSuccess('Partner deleted successfully!');
                fetchPartners();
            } else {
                setError(result.err);
            }
        } catch (err) {
            console.error('Error deleting partner:', err);
            setError('Failed to delete partner');
        }
    };

    const resetForm = () => {
        setFormData({
            name: '',
            logoUrl: '',
            description: '',
            index: '',
            links: [{ title: '', url: '' }]
        });
        setEditingPartner(null);
    };

    const startEdit = (partner) => {
        setFormData({
            name: partner.name,
            logoUrl: partner.logo_url,
            description: partner.description,
            index: partner.index[0] ? partner.index[0].toString() : '',
            links: partner.links.length > 0 ? partner.links : [{ title: '', url: '' }]
        });
        setEditingPartner(partner);
    };

    const addLink = () => {
        if (newLink.title && newLink.url) {
            setFormData(prev => ({
                ...prev,
                links: [...prev.links, { ...newLink }]
            }));
            setNewLink({ title: '', url: '' });
        }
    };

    const removeLink = (index) => {
        setFormData(prev => ({
            ...prev,
            links: prev.links.filter((_, i) => i !== index)
        }));
    };

    const formatDate = (timestamp) => {
        try {
            const date = new Date(Number(timestamp) / 1000000);
            return date.toLocaleDateString();
        } catch (err) {
            return 'Invalid Date';
        }
    };

    const clearMessages = () => {
        setError('');
        setSuccess('');
    };

    return (
        <div className='page-container'>
            <Header />
            <main className="wallet-container">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '30px' }}>
                    <h1 style={{ color: '#ffffff', margin: 0 }}>Manage Partners</h1>
                    <button
                        onClick={() => {
                            setShowForm(true);
                            setEditingPartner(null);
                            resetForm();
                            clearMessages();
                        }}
                        style={{
                            backgroundColor: '#27ae60',
                            color: '#ffffff',
                            border: 'none',
                            padding: '12px 24px',
                            borderRadius: '6px',
                            cursor: 'pointer',
                            fontSize: '16px',
                            fontWeight: '500'
                        }}
                    >
                        Add New Partner
                    </button>
                </div>

                {error && (
                    <div style={{ 
                        backgroundColor: 'rgba(231, 76, 60, 0.2)', 
                        border: '1px solid #e74c3c',
                        color: '#e74c3c',
                        padding: '15px',
                        borderRadius: '6px',
                        marginBottom: '20px'
                    }}>
                        {error}
                        <button 
                            onClick={clearMessages}
                            style={{ 
                                float: 'right', 
                                background: 'none', 
                                border: 'none', 
                                color: '#e74c3c', 
                                cursor: 'pointer',
                                fontSize: '18px'
                            }}
                        >
                            ×
                        </button>
                    </div>
                )}

                {success && (
                    <div style={{ 
                        backgroundColor: 'rgba(39, 174, 96, 0.2)', 
                        border: '1px solid #27ae60',
                        color: '#27ae60',
                        padding: '15px',
                        borderRadius: '6px',
                        marginBottom: '20px'
                    }}>
                        {success}
                        <button 
                            onClick={clearMessages}
                            style={{ 
                                float: 'right', 
                                background: 'none', 
                                border: 'none', 
                                color: '#27ae60', 
                                cursor: 'pointer',
                                fontSize: '18px'
                            }}
                        >
                            ×
                        </button>
                    </div>
                )}

                {showForm && (
                    <div style={{
                        backgroundColor: '#2a2a2a',
                        padding: '30px',
                        borderRadius: '12px',
                        marginBottom: '30px',
                        border: '1px solid #3a3a3a'
                    }}>
                        <h2 style={{ color: '#ffffff', marginBottom: '20px' }}>
                            {editingPartner ? 'Edit Partner' : 'Add New Partner'}
                        </h2>
                        <form onSubmit={handleSubmit}>
                            <div style={{ marginBottom: '20px' }}>
                                <label style={{ color: '#ffffff', display: 'block', marginBottom: '8px' }}>
                                    Partner Name *
                                </label>
                                <input
                                    type="text"
                                    value={formData.name}
                                    onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                                    required
                                    style={{
                                        width: '100%',
                                        padding: '12px',
                                        backgroundColor: '#1a1a1a',
                                        border: '1px solid #3a3a3a',
                                        borderRadius: '6px',
                                        color: '#ffffff',
                                        fontSize: '16px'
                                    }}
                                />
                            </div>

                            <div style={{ marginBottom: '20px' }}>
                                <label style={{ color: '#ffffff', display: 'block', marginBottom: '8px' }}>
                                    Logo URL *
                                </label>
                                <input
                                    type="url"
                                    value={formData.logoUrl}
                                    onChange={(e) => setFormData(prev => ({ ...prev, logoUrl: e.target.value }))}
                                    required
                                    style={{
                                        width: '100%',
                                        padding: '12px',
                                        backgroundColor: '#1a1a1a',
                                        border: '1px solid #3a3a3a',
                                        borderRadius: '6px',
                                        color: '#ffffff',
                                        fontSize: '16px'
                                    }}
                                />
                            </div>

                            <div style={{ marginBottom: '20px' }}>
                                <label style={{ color: '#ffffff', display: 'block', marginBottom: '8px' }}>
                                    Description *
                                </label>
                                <textarea
                                    value={formData.description}
                                    onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                                    required
                                    rows={4}
                                    style={{
                                        width: '100%',
                                        padding: '12px',
                                        backgroundColor: '#1a1a1a',
                                        border: '1px solid #3a3a3a',
                                        borderRadius: '6px',
                                        color: '#ffffff',
                                        fontSize: '16px',
                                        resize: 'vertical'
                                    }}
                                />
                            </div>

                            <div style={{ marginBottom: '20px' }}>
                                <label style={{ color: '#ffffff', display: 'block', marginBottom: '8px' }}>
                                    Index (optional)
                                </label>
                                <input
                                    type="number"
                                    value={formData.index}
                                    onChange={(e) => setFormData(prev => ({ ...prev, index: e.target.value }))}
                                    placeholder="Enter display order index"
                                    style={{
                                        width: '100%',
                                        padding: '12px',
                                        backgroundColor: '#1a1a1a',
                                        border: '1px solid #3a3a3a',
                                        borderRadius: '6px',
                                        color: '#ffffff',
                                        fontSize: '16px'
                                    }}
                                />
                                <small style={{ color: '#cccccc', fontSize: '14px' }}>
                                    Optional: Lower numbers appear first. Leave empty for default ordering.
                                </small>
                            </div>

                            <div style={{ marginBottom: '20px' }}>
                                <label style={{ color: '#ffffff', display: 'block', marginBottom: '8px' }}>
                                    Links
                                </label>
                                
                                {/* Existing Links */}
                                {formData.links.map((link, index) => (
                                    <div key={index} style={{ 
                                        display: 'flex', 
                                        gap: '10px', 
                                        marginBottom: '10px',
                                        alignItems: 'center'
                                    }}>
                                        <span style={{ color: '#cccccc', flex: 1 }}>
                                            {link.title} - {link.url}
                                        </span>
                                        <button
                                            type="button"
                                            onClick={() => removeLink(index)}
                                            style={{
                                                backgroundColor: '#e74c3c',
                                                color: '#ffffff',
                                                border: 'none',
                                                padding: '5px 10px',
                                                borderRadius: '4px',
                                                cursor: 'pointer'
                                            }}
                                        >
                                            Remove
                                        </button>
                                    </div>
                                ))}

                                {/* Add New Link */}
                                <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
                                    <input
                                        type="text"
                                        placeholder="Link title"
                                        value={newLink.title}
                                        onChange={(e) => setNewLink(prev => ({ ...prev, title: e.target.value }))}
                                        style={{
                                            flex: 1,
                                            padding: '8px',
                                            backgroundColor: '#1a1a1a',
                                            border: '1px solid #3a3a3a',
                                            borderRadius: '4px',
                                            color: '#ffffff'
                                        }}
                                    />
                                    <input
                                        type="url"
                                        placeholder="Link URL"
                                        value={newLink.url}
                                        onChange={(e) => setNewLink(prev => ({ ...prev, url: e.target.value }))}
                                        style={{
                                            flex: 2,
                                            padding: '8px',
                                            backgroundColor: '#1a1a1a',
                                            border: '1px solid #3a3a3a',
                                            borderRadius: '4px',
                                            color: '#ffffff'
                                        }}
                                    />
                                    <button
                                        type="button"
                                        onClick={addLink}
                                        style={{
                                            backgroundColor: '#3498db',
                                            color: '#ffffff',
                                            border: 'none',
                                            padding: '8px 16px',
                                            borderRadius: '4px',
                                            cursor: 'pointer'
                                        }}
                                    >
                                        Add Link
                                    </button>
                                </div>
                            </div>

                            <div style={{ display: 'flex', gap: '15px' }}>
                                <button
                                    type="submit"
                                    style={{
                                        backgroundColor: '#27ae60',
                                        color: '#ffffff',
                                        border: 'none',
                                        padding: '12px 24px',
                                        borderRadius: '6px',
                                        cursor: 'pointer',
                                        fontSize: '16px',
                                        fontWeight: '500'
                                    }}
                                >
                                    {editingPartner ? 'Update Partner' : 'Add Partner'}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setShowForm(false);
                                        setEditingPartner(null);
                                        resetForm();
                                    }}
                                    style={{
                                        backgroundColor: '#6c757d',
                                        color: '#ffffff',
                                        border: 'none',
                                        padding: '12px 24px',
                                        borderRadius: '6px',
                                        cursor: 'pointer',
                                        fontSize: '16px'
                                    }}
                                >
                                    Cancel
                                </button>
                            </div>
                        </form>
                    </div>
                )}

                {loading ? (
                    <div style={{ textAlign: 'center', padding: '40px', color: '#ffffff' }}>
                        Loading partners...
                    </div>
                ) : (
                    <div style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))',
                        gap: '20px'
                    }}>
                        {partners.map((partner) => (
                            <div
                                key={partner.id}
                                style={{
                                    backgroundColor: '#2a2a2a',
                                    borderRadius: '12px',
                                    padding: '20px',
                                    border: '1px solid #3a3a3a'
                                }}
                            >
                                <div style={{ display: 'flex', alignItems: 'center', gap: '15px', marginBottom: '15px' }}>
                                    <img
                                        src={partner.logo_url}
                                        alt={`${partner.name} logo`}
                                        style={{
                                            width: '50px',
                                            height: '50px',
                                            borderRadius: '6px',
                                            objectFit: 'cover'
                                        }}
                                        onError={(e) => {
                                            e.target.style.display = 'none';
                                        }}
                                    />
                                    <div>
                                        <h3 style={{ color: '#ffffff', margin: '0 0 5px 0' }}>
                                            {partner.name}
                                        </h3>
                                        <div style={{ color: '#888', fontSize: '14px' }}>
                                            ID: {partner.id} | Created: {formatDate(partner.created_at)}
                                        </div>
                                    </div>
                                </div>

                                <p style={{ color: '#cccccc', marginBottom: '15px', lineHeight: '1.4' }}>
                                    {partner.description}
                                </p>

                                {partner.links && partner.links.length > 0 && (
                                    <div style={{ marginBottom: '15px' }}>
                                        <strong style={{ color: '#ffffff', fontSize: '14px' }}>Links:</strong>
                                        <div style={{ marginTop: '5px' }}>
                                            {partner.links.map((link, index) => (
                                                <span key={index} style={{ 
                                                    color: '#3498db', 
                                                    fontSize: '14px',
                                                    marginRight: '15px'
                                                }}>
                                                    {link.title}
                                                </span>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                <div style={{ display: 'flex', gap: '10px' }}>
                                    <button
                                        onClick={() => startEdit(partner)}
                                        style={{
                                            backgroundColor: '#3498db',
                                            color: '#ffffff',
                                            border: 'none',
                                            padding: '8px 16px',
                                            borderRadius: '4px',
                                            cursor: 'pointer',
                                            fontSize: '14px'
                                        }}
                                    >
                                        Edit
                                    </button>
                                    <button
                                        onClick={() => handleDelete(partner.id)}
                                        style={{
                                            backgroundColor: '#e74c3c',
                                            color: '#ffffff',
                                            border: 'none',
                                            padding: '8px 16px',
                                            borderRadius: '4px',
                                            cursor: 'pointer',
                                            fontSize: '14px'
                                        }}
                                    >
                                        Delete
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {!loading && partners.length === 0 && (
                    <div style={{ 
                        textAlign: 'center', 
                        padding: '40px', 
                        color: '#888' 
                    }}>
                        No partners found. Add your first partner using the button above.
                    </div>
                )}
            </main>
        </div>
    );
}

export default AdminPartners; 