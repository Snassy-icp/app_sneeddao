import React, { useState, useEffect } from 'react';
import { useAuth } from '../AuthContext';
import Header from '../components/Header';
import { createActor as createSmsActor } from '../../../declarations/sneed_sms';

const SmsAdmin = () => {
    const { identity, isAuthenticated } = useAuth();
    
    const [config, setConfig] = useState(null);
    const [stats, setStats] = useState(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(null);
    const [success, setSuccess] = useState(null);
    const [isAdmin, setIsAdmin] = useState(false);
    
    // Form state
    const [formConfig, setFormConfig] = useState({
        rate_limit_minutes: 10,
        max_subject_length: 200,
        max_body_length: 5000,
        max_recipients: 20
    });

    // Create SMS actor
    const getSmsActor = () => {
        if (!identity) return null;
        const canisterId = process.env.CANISTER_ID_SNEED_SMS || 'v33jy-4qaaa-aaaad-absna-cai';
        return createSmsActor(canisterId, {
            agentOptions: { identity }
        });
    };

    // Check if user is admin and fetch initial data
    useEffect(() => {
        const fetchData = async () => {
            if (!isAuthenticated || !identity) {
                setLoading(false);
                return;
            }

            try {
                setLoading(true);
                setError(null);

                const actor = getSmsActor();
                if (!actor) return;

                // Check if user is admin
                const adminCheck = await actor.is_admin_query(identity.getPrincipal());
                setIsAdmin(adminCheck);

                if (!adminCheck) {
                    setError('Access denied. Admin privileges required.');
                    setLoading(false);
                    return;
                }

                // Fetch current config and stats
                const [configData, statsData] = await Promise.all([
                    actor.get_config(),
                    actor.get_stats()
                ]);

                setConfig(configData);
                setStats(statsData);
                
                // Set form values from current config
                setFormConfig({
                    rate_limit_minutes: Number(configData.rate_limit_minutes),
                    max_subject_length: Number(configData.max_subject_length),
                    max_body_length: Number(configData.max_body_length),
                    max_recipients: Number(configData.max_recipients)
                });

            } catch (err) {
                console.error('Error fetching SMS admin data:', err);
                setError('Failed to load admin data: ' + err.message);
            } finally {
                setLoading(false);
            }
        };

        fetchData();
    }, [isAuthenticated, identity]);

    const handleConfigUpdate = async (e) => {
        e.preventDefault();
        
        if (!isAdmin) {
            setError('Access denied. Admin privileges required.');
            return;
        }

        try {
            setSaving(true);
            setError(null);
            setSuccess(null);

            const actor = getSmsActor();
            if (!actor) throw new Error('Failed to create SMS actor');

            const result = await actor.update_config(
                formConfig.rate_limit_minutes !== config?.rate_limit_minutes ? [BigInt(formConfig.rate_limit_minutes)] : [],
                formConfig.max_subject_length !== config?.max_subject_length ? [BigInt(formConfig.max_subject_length)] : [],
                formConfig.max_body_length !== config?.max_body_length ? [BigInt(formConfig.max_body_length)] : [],
                formConfig.max_recipients !== config?.max_recipients ? [BigInt(formConfig.max_recipients)] : []
            );

            if ('ok' in result) {
                setSuccess('Configuration updated successfully!');
                
                // Refresh config data
                const newConfig = await actor.get_config();
                setConfig(newConfig);
            } else {
                const errorMsg = result.err.Unauthorized || result.err.InvalidInput || 'Failed to update configuration';
                setError(errorMsg);
            }
        } catch (err) {
            console.error('Error updating config:', err);
            setError('Failed to update configuration: ' + err.message);
        } finally {
            setSaving(false);
        }
    };

    if (!isAuthenticated) {
        return (
            <div>
                <Header />
                <div style={{ padding: '40px 20px', textAlign: 'center', color: '#ffffff' }}>
                    <h2>Please log in to access SMS Admin</h2>
                </div>
            </div>
        );
    }

    if (loading) {
        return (
            <div>
                <Header />
                <div style={{ padding: '40px 20px', textAlign: 'center', color: '#ffffff' }}>
                    <h2>Loading SMS Admin...</h2>
                </div>
            </div>
        );
    }

    if (!isAdmin) {
        return (
            <div>
                <Header />
                <div style={{ padding: '40px 20px', textAlign: 'center', color: '#ffffff' }}>
                    <h2>Access Denied</h2>
                    <p>Admin privileges required to access SMS administration.</p>
                </div>
            </div>
        );
    }

    return (
        <div>
            <Header />
            <div style={{ 
                padding: '40px 20px', 
                maxWidth: '1200px', 
                margin: '0 auto',
                color: '#ffffff'
            }}>
                <h1 style={{ 
                    fontSize: '32px', 
                    fontWeight: 'bold', 
                    marginBottom: '10px',
                    color: '#ffffff'
                }}>
                    SMS Administration
                </h1>
                <p style={{ color: '#888', marginBottom: '30px' }}>
                    Manage SMS system configuration and view statistics
                </p>

                {/* Stats Section */}
                {stats && (
                    <div style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                        gap: '20px',
                        marginBottom: '40px'
                    }}>
                        <div style={{
                            backgroundColor: '#2a2a2a',
                            borderRadius: '8px',
                            padding: '20px',
                            border: '1px solid #3a3a3a',
                            textAlign: 'center'
                        }}>
                            <div style={{ color: '#3498db', fontSize: '32px', fontWeight: 'bold' }}>
                                {Number(stats.total_messages)}
                            </div>
                            <div style={{ color: '#888', fontSize: '14px' }}>Total Messages</div>
                        </div>
                        <div style={{
                            backgroundColor: '#2a2a2a',
                            borderRadius: '8px',
                            padding: '20px',
                            border: '1px solid #3a3a3a',
                            textAlign: 'center'
                        }}>
                            <div style={{ color: '#2ecc71', fontSize: '32px', fontWeight: 'bold' }}>
                                {Number(stats.total_users)}
                            </div>
                            <div style={{ color: '#888', fontSize: '14px' }}>Total Users</div>
                        </div>
                    </div>
                )}

                {/* Configuration Form */}
                <div style={{
                    backgroundColor: '#2a2a2a',
                    borderRadius: '12px',
                    padding: '30px',
                    border: '1px solid #3a3a3a'
                }}>
                    <h2 style={{ 
                        fontSize: '24px', 
                        fontWeight: 'bold', 
                        marginBottom: '20px',
                        color: '#ffffff'
                    }}>
                        SMS Configuration
                    </h2>

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
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '20px' }}>
                            <div>
                                <label style={{ color: '#ffffff', display: 'block', marginBottom: '8px', fontWeight: '500' }}>
                                    Rate Limit (Minutes Between Messages)
                                </label>
                                <input
                                    type="number"
                                    min="0"
                                    value={formConfig.rate_limit_minutes}
                                    onChange={(e) => setFormConfig(prev => ({ ...prev, rate_limit_minutes: parseInt(e.target.value) || 0 }))}
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
                                    Minimum minutes users must wait between sending messages
                                </div>
                            </div>

                            <div>
                                <label style={{ color: '#ffffff', display: 'block', marginBottom: '8px', fontWeight: '500' }}>
                                    Max Subject Length
                                </label>
                                <input
                                    type="number"
                                    min="1"
                                    value={formConfig.max_subject_length}
                                    onChange={(e) => setFormConfig(prev => ({ ...prev, max_subject_length: parseInt(e.target.value) || 1 }))}
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
                                    Maximum characters allowed in message subject
                                </div>
                            </div>

                            <div>
                                <label style={{ color: '#ffffff', display: 'block', marginBottom: '8px', fontWeight: '500' }}>
                                    Max Body Length
                                </label>
                                <input
                                    type="number"
                                    min="1"
                                    value={formConfig.max_body_length}
                                    onChange={(e) => setFormConfig(prev => ({ ...prev, max_body_length: parseInt(e.target.value) || 1 }))}
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
                                    Maximum characters allowed in message body
                                </div>
                            </div>

                            <div>
                                <label style={{ color: '#ffffff', display: 'block', marginBottom: '8px', fontWeight: '500' }}>
                                    Max Recipients
                                </label>
                                <input
                                    type="number"
                                    min="1"
                                    value={formConfig.max_recipients}
                                    onChange={(e) => setFormConfig(prev => ({ ...prev, max_recipients: parseInt(e.target.value) || 1 }))}
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
                                    Maximum number of recipients per message
                                </div>
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
                                fontWeight: '500',
                                cursor: saving ? 'not-allowed' : 'pointer',
                                marginTop: '30px',
                                transition: 'background-color 0.2s ease'
                            }}
                        >
                            {saving ? 'Saving...' : 'Update Configuration'}
                        </button>
                    </form>
                </div>
            </div>
        </div>
    );
};

export default SmsAdmin;
