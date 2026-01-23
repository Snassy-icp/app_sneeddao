import React, { useState, useEffect } from 'react';
import { useAuth } from '../../AuthContext';
import Header from '../../components/Header';
import { useAdminCheck } from '../../hooks/useAdminCheck';
import { createActor as createBackendActor, canisterId as BACKEND_CANISTER_ID } from 'declarations/app_sneeddao_backend';

export default function CanisterGroupsAdmin() {
    const { identity, isAuthenticated } = useAuth();
    const { isAdmin, loading: adminLoading, loadingComponent, errorComponent, error: adminError } = useAdminCheck({
        identity,
        isAuthenticated,
        redirectPath: '/wallet'
    });

    // State for limits config
    const [limitsConfig, setLimitsConfig] = useState(null);
    const [formConfig, setFormConfig] = useState({
        max_canister_groups: 5,
        max_canisters_per_group: 20,
        max_total_grouped_canisters: 50,
        premium_max_canister_groups: 50,
        premium_max_canisters_per_group: 100,
        premium_max_total_grouped_canisters: 500
    });
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(null);
    const [success, setSuccess] = useState(null);

    // Create backend actor
    const getBackendActor = () => {
        if (!identity) return null;
        return createBackendActor(BACKEND_CANISTER_ID, {
            agentOptions: { identity }
        });
    };

    // Fetch limits config
    useEffect(() => {
        const fetchConfig = async () => {
            if (!isAdmin || adminLoading) return;
            
            setLoading(true);
            try {
                const actor = getBackendActor();
                if (!actor) return;
                
                const config = await actor.get_canister_groups_limits_config();
                setLimitsConfig(config);
                setFormConfig({
                    max_canister_groups: Number(config.max_canister_groups),
                    max_canisters_per_group: Number(config.max_canisters_per_group),
                    max_total_grouped_canisters: Number(config.max_total_grouped_canisters),
                    premium_max_canister_groups: Number(config.premium_max_canister_groups),
                    premium_max_canisters_per_group: Number(config.premium_max_canisters_per_group),
                    premium_max_total_grouped_canisters: Number(config.premium_max_total_grouped_canisters)
                });
            } catch (err) {
                console.error('Error fetching canister groups config:', err);
                setError('Failed to load canister groups configuration');
            } finally {
                setLoading(false);
            }
        };
        
        fetchConfig();
    }, [isAdmin, adminLoading, identity]);

    // Handle config update
    const handleConfigUpdate = async (e) => {
        e.preventDefault();
        
        setSaving(true);
        setError(null);
        setSuccess(null);
        
        try {
            const actor = getBackendActor();
            if (!actor) throw new Error('Failed to create backend actor');
            
            const result = await actor.update_canister_groups_limits(
                [BigInt(formConfig.max_canister_groups)],
                [BigInt(formConfig.max_canisters_per_group)],
                [BigInt(formConfig.max_total_grouped_canisters)],
                [BigInt(formConfig.premium_max_canister_groups)],
                [BigInt(formConfig.premium_max_canisters_per_group)],
                [BigInt(formConfig.premium_max_total_grouped_canisters)]
            );
            
            if ('ok' in result) {
                setSuccess('Canister groups configuration updated successfully!');
                // Refresh the config
                const newConfig = await actor.get_canister_groups_limits_config();
                setLimitsConfig(newConfig);
            } else {
                throw new Error(result.err);
            }
        } catch (err) {
            console.error('Error updating canister groups config:', err);
            setError('Failed to update configuration: ' + err.message);
        } finally {
            setSaving(false);
        }
    };

    if (adminLoading) {
        return (
            <div className='page-container'>
                <Header />
                <main className="wallet-container">
                    <div style={loadingComponent?.style || { textAlign: 'center', padding: '40px 20px', color: '#ffffff' }}>
                        {loadingComponent?.text || 'Loading...'}
                    </div>
                </main>
            </div>
        );
    }

    if (adminError) {
        return (
            <div className='page-container'>
                <Header />
                <main className="wallet-container">
                    <div style={errorComponent?.style || {
                        backgroundColor: 'rgba(231, 76, 60, 0.1)',
                        border: '1px solid #e74c3c',
                        color: '#e74c3c',
                        padding: '15px',
                        borderRadius: '4px',
                        marginBottom: '20px'
                    }}>
                        {errorComponent?.text || adminError || 'An error occurred'}
                    </div>
                </main>
            </div>
        );
    }

    if (!isAdmin) {
        return null;
    }

    return (
        <div className='page-container'>
            <Header />
            <main className="wallet-container">
                <div style={{ marginBottom: '20px' }}>
                    <h1 style={{ color: '#ffffff', marginBottom: '10px' }}>Canister Groups Admin</h1>
                    <p style={{ color: '#888', margin: 0 }}>
                        Configure limits for user canister folders and groups
                    </p>
                </div>

                {loading ? (
                    <div style={{ textAlign: 'center', padding: '40px', color: '#888' }}>
                        Loading configuration...
                    </div>
                ) : (
                    <div style={{
                        backgroundColor: '#2a2a2a',
                        borderRadius: '12px',
                        padding: '30px'
                    }}>
                        {error && (
                            <div style={{
                                backgroundColor: 'rgba(231, 76, 60, 0.1)',
                                border: '1px solid #e74c3c',
                                borderRadius: '8px',
                                padding: '12px',
                                marginBottom: '20px',
                                color: '#e74c3c'
                            }}>
                                {error}
                            </div>
                        )}

                        {success && (
                            <div style={{
                                backgroundColor: 'rgba(46, 204, 113, 0.1)',
                                border: '1px solid #2ecc71',
                                borderRadius: '8px',
                                padding: '12px',
                                marginBottom: '20px',
                                color: '#2ecc71'
                            }}>
                                {success}
                            </div>
                        )}

                        <form onSubmit={handleConfigUpdate}>
                            {/* Regular User Limits */}
                            <h3 style={{ color: '#ffffff', marginBottom: '15px' }}>Regular User Limits</h3>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '20px', marginBottom: '30px' }}>
                                <div>
                                    <label style={{ color: '#ffffff', display: 'block', marginBottom: '8px', fontWeight: '500' }}>
                                        Max Folders
                                    </label>
                                    <input
                                        type="number"
                                        min="1"
                                        value={formConfig.max_canister_groups}
                                        onChange={(e) => setFormConfig(prev => ({ ...prev, max_canister_groups: parseInt(e.target.value) || 1 }))}
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
                                        Maximum number of folders/groups
                                    </div>
                                </div>
                                <div>
                                    <label style={{ color: '#ffffff', display: 'block', marginBottom: '8px', fontWeight: '500' }}>
                                        Max Canisters per Folder
                                    </label>
                                    <input
                                        type="number"
                                        min="1"
                                        value={formConfig.max_canisters_per_group}
                                        onChange={(e) => setFormConfig(prev => ({ ...prev, max_canisters_per_group: parseInt(e.target.value) || 1 }))}
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
                                        Maximum canisters in a single folder
                                    </div>
                                </div>
                                <div>
                                    <label style={{ color: '#ffffff', display: 'block', marginBottom: '8px', fontWeight: '500' }}>
                                        Max Total Canisters
                                    </label>
                                    <input
                                        type="number"
                                        min="1"
                                        value={formConfig.max_total_grouped_canisters}
                                        onChange={(e) => setFormConfig(prev => ({ ...prev, max_total_grouped_canisters: parseInt(e.target.value) || 1 }))}
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
                                        Maximum canisters across all folders
                                    </div>
                                </div>
                            </div>

                            {/* Premium User Limits */}
                            <h3 style={{ color: '#ffd700', marginBottom: '15px' }}>⭐ Premium User Limits</h3>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '20px', marginBottom: '30px' }}>
                                <div>
                                    <label style={{ color: '#ffffff', display: 'block', marginBottom: '8px', fontWeight: '500' }}>
                                        Premium Max Folders
                                    </label>
                                    <input
                                        type="number"
                                        min="1"
                                        value={formConfig.premium_max_canister_groups}
                                        onChange={(e) => setFormConfig(prev => ({ ...prev, premium_max_canister_groups: parseInt(e.target.value) || 1 }))}
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
                                        Premium Max per Folder
                                    </label>
                                    <input
                                        type="number"
                                        min="1"
                                        value={formConfig.premium_max_canisters_per_group}
                                        onChange={(e) => setFormConfig(prev => ({ ...prev, premium_max_canisters_per_group: parseInt(e.target.value) || 1 }))}
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
                                        Premium Max Total
                                    </label>
                                    <input
                                        type="number"
                                        min="1"
                                        value={formConfig.premium_max_total_grouped_canisters}
                                        onChange={(e) => setFormConfig(prev => ({ ...prev, premium_max_total_grouped_canisters: parseInt(e.target.value) || 1 }))}
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
                                marginBottom: '30px'
                            }}>
                                <strong style={{ color: '#ffd700' }}>Limits Comparison:</strong>
                                <div style={{ color: '#ccc', marginTop: '10px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                                    <div>Regular Max Folders: <strong>{formConfig.max_canister_groups}</strong></div>
                                    <div>Premium Max Folders: <strong style={{ color: '#4caf50' }}>{formConfig.premium_max_canister_groups}</strong></div>
                                    <div>Regular Max per Folder: <strong>{formConfig.max_canisters_per_group}</strong></div>
                                    <div>Premium Max per Folder: <strong style={{ color: '#4caf50' }}>{formConfig.premium_max_canisters_per_group}</strong></div>
                                    <div>Regular Max Total: <strong>{formConfig.max_total_grouped_canisters}</strong></div>
                                    <div>Premium Max Total: <strong style={{ color: '#4caf50' }}>{formConfig.premium_max_total_grouped_canisters}</strong></div>
                                </div>
                            </div>

                            <button
                                type="submit"
                                disabled={saving}
                                style={{
                                    backgroundColor: saving ? '#555' : '#3498db',
                                    color: '#ffffff',
                                    border: 'none',
                                    borderRadius: '8px',
                                    padding: '12px 24px',
                                    fontSize: '16px',
                                    fontWeight: '600',
                                    cursor: saving ? 'not-allowed' : 'pointer',
                                    transition: 'background-color 0.2s ease'
                                }}
                            >
                                {saving ? 'Saving...' : 'Update Configuration'}
                            </button>
                        </form>
                    </div>
                )}
            </main>
        </div>
    );
}

