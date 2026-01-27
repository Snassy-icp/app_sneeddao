import React, { useState, useEffect } from 'react';
import { useAuth } from '../AuthContext';
import Header from '../components/Header';
import { createActor as createSmsActor } from '../../../declarations/sneed_sms';
import { Principal } from '@dfinity/principal';

const SmsAdmin = () => {
    const { identity, isAuthenticated } = useAuth();
    
    const [config, setConfig] = useState(null);
    const [premiumConfig, setPremiumConfig] = useState(null);
    const [stats, setStats] = useState(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [savingPremium, setSavingPremium] = useState(false);
    const [error, setError] = useState(null);
    const [premiumError, setPremiumError] = useState(null);
    const [success, setSuccess] = useState(null);
    const [premiumSuccess, setPremiumSuccess] = useState(null);
    const [isAdmin, setIsAdmin] = useState(false);
    
    // Form state
    const [formConfig, setFormConfig] = useState({
        rate_limit_minutes: 10,
        max_subject_length: 200,
        max_body_length: 5000,
        max_recipients: 20
    });

    // Premium form state
    const [formPremiumConfig, setFormPremiumConfig] = useState({
        sneed_premium_canister_id: '',
        premium_max_subject_length: 500,
        premium_max_body_length: 20000,
        premium_rate_limit_minutes: 1,
        premium_max_recipients: 50
    });
    
    // System notification config state
    const [authorizedSenders, setAuthorizedSenders] = useState([]);
    const [systemSenderPrincipal, setSystemSenderPrincipal] = useState('');
    const [newAuthorizedSender, setNewAuthorizedSender] = useState('');
    const [savingSystem, setSavingSystem] = useState(false);
    const [systemError, setSystemError] = useState(null);
    const [systemSuccess, setSystemSuccess] = useState(null);

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

                // Try to fetch premium config separately (might not exist on older deployments)
                try {
                    if (actor.get_premium_config) {
                        const premiumConfigData = await actor.get_premium_config();
                        if (premiumConfigData) {
                            setPremiumConfig(premiumConfigData);
                            setFormPremiumConfig({
                                sneed_premium_canister_id: premiumConfigData.sneed_premium_canister_id?.[0]?.toString() || '',
                                premium_max_subject_length: Number(premiumConfigData.premium_max_subject_length),
                                premium_max_body_length: Number(premiumConfigData.premium_max_body_length),
                                premium_rate_limit_minutes: Number(premiumConfigData.premium_rate_limit_minutes ?? 1),
                                premium_max_recipients: Number(premiumConfigData.premium_max_recipients ?? 50)
                            });
                        }
                    }
                } catch (premiumErr) {
                    console.warn('Premium config not available:', premiumErr);
                }
                
                // Try to fetch system notification settings
                try {
                    const [sendersResult, systemSenderResult] = await Promise.all([
                        actor.get_authorized_senders(),
                        actor.get_system_sender_principal(),
                    ]);
                    if (sendersResult.ok) {
                        setAuthorizedSenders(sendersResult.ok);
                    }
                    if (systemSenderResult) {
                        setSystemSenderPrincipal(systemSenderResult.toString());
                    }
                } catch (systemErr) {
                    console.warn('System notification config not available:', systemErr);
                }

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

    const handlePremiumConfigUpdate = async (e) => {
        e.preventDefault();
        
        if (!isAdmin) {
            setPremiumError('Access denied. Admin privileges required.');
            return;
        }

        try {
            setSavingPremium(true);
            setPremiumError(null);
            setPremiumSuccess(null);

            const actor = getSmsActor();
            if (!actor) throw new Error('Failed to create SMS actor');

            // Build the update input
            let sneedPremiumCanisterId = [];
            if (formPremiumConfig.sneed_premium_canister_id && formPremiumConfig.sneed_premium_canister_id.trim()) {
                try {
                    const principal = Principal.fromText(formPremiumConfig.sneed_premium_canister_id.trim());
                    sneedPremiumCanisterId = [[principal]]; // ?(?Principal)
                } catch (e) {
                    setPremiumError('Invalid Principal ID format for Sneed Premium Canister');
                    setSavingPremium(false);
                    return;
                }
            } else {
                sneedPremiumCanisterId = [[]]; // ?(null) - clear
            }

            const result = await actor.update_premium_config(
                sneedPremiumCanisterId,
                [BigInt(formPremiumConfig.premium_max_subject_length)],
                [BigInt(formPremiumConfig.premium_max_body_length)],
                [BigInt(formPremiumConfig.premium_rate_limit_minutes)],
                [BigInt(formPremiumConfig.premium_max_recipients)]
            );

            if ('ok' in result) {
                setPremiumSuccess('Premium configuration updated successfully!');
                
                // Refresh premium config data
                const newPremiumConfig = await actor.get_premium_config();
                setPremiumConfig(newPremiumConfig);
            } else {
                const errorMsg = result.err.Unauthorized || result.err.InvalidInput || 'Failed to update premium configuration';
                setPremiumError(errorMsg);
            }
        } catch (err) {
            console.error('Error updating premium config:', err);
            setPremiumError('Failed to update premium configuration: ' + err.message);
        } finally {
            setSavingPremium(false);
        }
    };
    
    // Handle adding an authorized sender
    const handleAddAuthorizedSender = async () => {
        if (!newAuthorizedSender.trim()) {
            setSystemError('Please enter a principal ID');
            return;
        }
        
        try {
            setSavingSystem(true);
            setSystemError(null);
            setSystemSuccess(null);
            
            const principal = Principal.fromText(newAuthorizedSender.trim());
            
            const actor = getSmsActor();
            if (!actor) throw new Error('Failed to create SMS actor');
            
            const result = await actor.add_authorized_sender(principal);
            
            if ('ok' in result) {
                setSystemSuccess('Authorized sender added successfully');
                setNewAuthorizedSender('');
                
                // Refresh the list
                const sendersResult = await actor.get_authorized_senders();
                if (sendersResult.ok) {
                    setAuthorizedSenders(sendersResult.ok);
                }
            } else {
                const errorMsg = result.err.Unauthorized || result.err.AlreadyExists || result.err.InvalidInput || JSON.stringify(result.err);
                setSystemError('Failed: ' + errorMsg);
            }
        } catch (err) {
            console.error('Error adding authorized sender:', err);
            setSystemError('Invalid principal ID format or error: ' + err.message);
        } finally {
            setSavingSystem(false);
        }
    };
    
    // Handle removing an authorized sender
    const handleRemoveAuthorizedSender = async (principalToRemove) => {
        if (!window.confirm(`Remove ${principalToRemove.toString()} from authorized senders?`)) {
            return;
        }
        
        try {
            setSavingSystem(true);
            setSystemError(null);
            setSystemSuccess(null);
            
            const actor = getSmsActor();
            if (!actor) throw new Error('Failed to create SMS actor');
            
            const result = await actor.remove_authorized_sender(principalToRemove);
            
            if ('ok' in result) {
                setSystemSuccess('Authorized sender removed successfully');
                
                // Refresh the list
                const sendersResult = await actor.get_authorized_senders();
                if (sendersResult.ok) {
                    setAuthorizedSenders(sendersResult.ok);
                }
            } else {
                const errorMsg = result.err.Unauthorized || result.err.NotFound || JSON.stringify(result.err);
                setSystemError('Failed: ' + errorMsg);
            }
        } catch (err) {
            console.error('Error removing authorized sender:', err);
            setSystemError('Error: ' + err.message);
        } finally {
            setSavingSystem(false);
        }
    };
    
    // Handle updating system sender principal
    const handleUpdateSystemSenderPrincipal = async () => {
        try {
            setSavingSystem(true);
            setSystemError(null);
            setSystemSuccess(null);
            
            const actor = getSmsActor();
            if (!actor) throw new Error('Failed to create SMS actor');
            
            let principal = null;
            if (systemSenderPrincipal.trim()) {
                principal = Principal.fromText(systemSenderPrincipal.trim());
            }
            
            const result = await actor.set_system_sender_principal(principal ? [principal] : []);
            
            if ('ok' in result) {
                setSystemSuccess('System sender principal updated successfully');
                
                // Refresh
                const newPrincipal = await actor.get_system_sender_principal();
                setSystemSenderPrincipal(newPrincipal ? newPrincipal.toString() : '');
            } else {
                const errorMsg = result.err.Unauthorized || result.err.InvalidInput || JSON.stringify(result.err);
                setSystemError('Failed: ' + errorMsg);
            }
        } catch (err) {
            console.error('Error updating system sender principal:', err);
            setSystemError('Invalid principal ID format or error: ' + err.message);
        } finally {
            setSavingSystem(false);
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

                {/* Premium Configuration Section */}
                <div style={{
                    backgroundColor: '#2a2a2a',
                    borderRadius: '12px',
                    padding: '30px',
                    border: '1px solid #ffd700',
                    marginTop: '30px'
                }}>
                    <h2 style={{ 
                        fontSize: '24px', 
                        fontWeight: 'bold', 
                        marginBottom: '10px',
                        color: '#ffd700',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px'
                    }}>
                        ⭐ Premium Configuration
                    </h2>
                    <p style={{ color: '#888', marginBottom: '20px' }}>
                        Configure premium member limits. Premium members will use these limits instead of the regular limits.
                    </p>

                    {premiumError && (
                        <div style={{
                            backgroundColor: 'rgba(231, 76, 60, 0.1)',
                            border: '1px solid #e74c3c',
                            borderRadius: '8px',
                            padding: '12px',
                            marginBottom: '20px',
                            color: '#e74c3c'
                        }}>
                            {premiumError}
                        </div>
                    )}

                    {premiumSuccess && (
                        <div style={{
                            backgroundColor: 'rgba(46, 204, 113, 0.1)',
                            border: '1px solid #2ecc71',
                            borderRadius: '8px',
                            padding: '12px',
                            marginBottom: '20px',
                            color: '#2ecc71'
                        }}>
                            {premiumSuccess}
                        </div>
                    )}

                    <form onSubmit={handlePremiumConfigUpdate}>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '20px' }}>
                            <div style={{ gridColumn: '1 / -1' }}>
                                <label style={{ color: '#ffffff', display: 'block', marginBottom: '8px', fontWeight: '500' }}>
                                    Sneed Premium Canister ID
                                </label>
                                <input
                                    type="text"
                                    placeholder="e.g., 7gump-4aaaa-aaaal-qtyka-cai (leave empty to disable)"
                                    value={formPremiumConfig.sneed_premium_canister_id}
                                    onChange={(e) => setFormPremiumConfig(prev => ({ ...prev, sneed_premium_canister_id: e.target.value }))}
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

                            <div>
                                <label style={{ color: '#ffffff', display: 'block', marginBottom: '8px', fontWeight: '500' }}>
                                    Premium Max Subject Length
                                </label>
                                <input
                                    type="number"
                                    min="1"
                                    value={formPremiumConfig.premium_max_subject_length}
                                    onChange={(e) => setFormPremiumConfig(prev => ({ ...prev, premium_max_subject_length: parseInt(e.target.value) || 1 }))}
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
                                    Max subject length for premium members (regular: {formConfig.max_subject_length})
                                </div>
                            </div>

                            <div>
                                <label style={{ color: '#ffffff', display: 'block', marginBottom: '8px', fontWeight: '500' }}>
                                    Premium Max Body Length
                                </label>
                                <input
                                    type="number"
                                    min="1"
                                    value={formPremiumConfig.premium_max_body_length}
                                    onChange={(e) => setFormPremiumConfig(prev => ({ ...prev, premium_max_body_length: parseInt(e.target.value) || 1 }))}
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
                                    Max body length for premium members (regular: {formConfig.max_body_length})
                                </div>
                            </div>

                            <div>
                                <label style={{ color: '#ffffff', display: 'block', marginBottom: '8px', fontWeight: '500' }}>
                                    Premium Rate Limit (Minutes)
                                </label>
                                <input
                                    type="number"
                                    min="0"
                                    value={formPremiumConfig.premium_rate_limit_minutes}
                                    onChange={(e) => setFormPremiumConfig(prev => ({ ...prev, premium_rate_limit_minutes: parseInt(e.target.value) || 0 }))}
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
                                    Minutes between messages for premium members (regular: {formConfig.rate_limit_minutes})
                                </div>
                            </div>

                            <div>
                                <label style={{ color: '#ffffff', display: 'block', marginBottom: '8px', fontWeight: '500' }}>
                                    Premium Max Recipients
                                </label>
                                <input
                                    type="number"
                                    min="1"
                                    value={formPremiumConfig.premium_max_recipients}
                                    onChange={(e) => setFormPremiumConfig(prev => ({ ...prev, premium_max_recipients: parseInt(e.target.value) || 1 }))}
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
                                    Max recipients per message for premium members (regular: {formConfig.max_recipients})
                                </div>
                            </div>
                        </div>

                        {/* Comparison Box */}
                        <div style={{ 
                            backgroundColor: 'rgba(255, 215, 0, 0.1)', 
                            border: '1px solid #ffd700', 
                            padding: '15px', 
                            borderRadius: '8px',
                            marginTop: '20px'
                        }}>
                            <strong style={{ color: '#ffd700' }}>Limits Comparison:</strong>
                            <div style={{ color: '#ccc', marginTop: '10px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                                <div>Regular Subject Max: <strong>{formConfig.max_subject_length}</strong></div>
                                <div>Premium Subject Max: <strong style={{ color: '#4caf50' }}>{formPremiumConfig.premium_max_subject_length}</strong></div>
                                <div>Regular Body Max: <strong>{formConfig.max_body_length}</strong></div>
                                <div>Premium Body Max: <strong style={{ color: '#4caf50' }}>{formPremiumConfig.premium_max_body_length}</strong></div>
                                <div>Regular Rate Limit: <strong>{formConfig.rate_limit_minutes} min</strong></div>
                                <div>Premium Rate Limit: <strong style={{ color: '#4caf50' }}>{formPremiumConfig.premium_rate_limit_minutes} min</strong></div>
                                <div>Regular Max Recipients: <strong>{formConfig.max_recipients}</strong></div>
                                <div>Premium Max Recipients: <strong style={{ color: '#4caf50' }}>{formPremiumConfig.premium_max_recipients}</strong></div>
                            </div>
                        </div>

                        <button
                            type="submit"
                            disabled={savingPremium}
                            style={{
                                backgroundColor: savingPremium ? '#555' : '#ffd700',
                                color: '#1a1a1a',
                                border: 'none',
                                borderRadius: '8px',
                                padding: '12px 24px',
                                fontSize: '16px',
                                fontWeight: '600',
                                cursor: savingPremium ? 'not-allowed' : 'pointer',
                                marginTop: '30px',
                                transition: 'background-color 0.2s ease'
                            }}
                        >
                            {savingPremium ? 'Saving...' : '⭐ Update Premium Configuration'}
                        </button>
                    </form>
                </div>
                
                {/* System Notifications Section */}
                <div style={{
                    backgroundColor: '#2a2a2a',
                    borderRadius: '12px',
                    padding: '30px',
                    border: '1px solid #00d4aa',
                    marginTop: '30px'
                }}>
                    <h2 style={{
                        color: '#00d4aa',
                        fontSize: '20px',
                        marginBottom: '10px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px'
                    }}>
                        🔔 System Notifications
                    </h2>
                    <p style={{ color: '#888', marginBottom: '20px' }}>
                        Configure which canisters can send system notifications to users and the principal that appears as the sender.
                    </p>

                    {systemError && (
                        <div style={{
                            backgroundColor: 'rgba(220, 53, 69, 0.1)',
                            border: '1px solid #dc3545',
                            borderRadius: '8px',
                            padding: '12px 16px',
                            marginBottom: '20px',
                            color: '#dc3545'
                        }}>
                            {systemError}
                        </div>
                    )}

                    {systemSuccess && (
                        <div style={{
                            backgroundColor: 'rgba(0, 212, 170, 0.1)',
                            border: '1px solid #00d4aa',
                            borderRadius: '8px',
                            padding: '12px 16px',
                            marginBottom: '20px',
                            color: '#00d4aa'
                        }}>
                            {systemSuccess}
                        </div>
                    )}
                    
                    {/* System Sender Principal */}
                    <div style={{ marginBottom: '25px' }}>
                        <label style={{
                            display: 'block',
                            color: '#ccc',
                            marginBottom: '8px',
                            fontSize: '14px'
                        }}>
                            System Sender Principal
                        </label>
                        <p style={{ color: '#888', fontSize: '12px', marginBottom: '10px' }}>
                            The principal ID that appears as the "from" address on system notification messages.
                        </p>
                        <div style={{ display: 'flex', gap: '10px' }}>
                            <input
                                type="text"
                                value={systemSenderPrincipal}
                                onChange={(e) => setSystemSenderPrincipal(e.target.value)}
                                placeholder="Leave empty to use canister ID"
                                style={{
                                    flex: 1,
                                    backgroundColor: '#1a1a1a',
                                    border: '1px solid #444',
                                    borderRadius: '8px',
                                    padding: '12px 16px',
                                    color: '#fff',
                                    fontFamily: 'monospace',
                                    fontSize: '13px'
                                }}
                                disabled={savingSystem}
                            />
                            <button
                                onClick={handleUpdateSystemSenderPrincipal}
                                disabled={savingSystem}
                                style={{
                                    backgroundColor: '#00d4aa',
                                    color: '#000',
                                    border: 'none',
                                    borderRadius: '8px',
                                    padding: '12px 20px',
                                    cursor: savingSystem ? 'not-allowed' : 'pointer',
                                    opacity: savingSystem ? 0.6 : 1,
                                    fontWeight: '600'
                                }}
                            >
                                {savingSystem ? 'Saving...' : 'Save'}
                            </button>
                        </div>
                    </div>
                    
                    {/* Authorized Senders */}
                    <div>
                        <label style={{
                            display: 'block',
                            color: '#ccc',
                            marginBottom: '8px',
                            fontSize: '14px'
                        }}>
                            Authorized System Senders
                        </label>
                        <p style={{ color: '#888', fontSize: '12px', marginBottom: '15px' }}>
                            Canisters authorized to send system notification messages (e.g., Sneedex for auction alerts).
                        </p>
                        
                        {/* Current senders list */}
                        <div style={{
                            backgroundColor: '#1a1a1a',
                            borderRadius: '8px',
                            padding: '15px',
                            marginBottom: '15px',
                            minHeight: '60px'
                        }}>
                            {authorizedSenders.length === 0 ? (
                                <p style={{ color: '#666', fontStyle: 'italic', margin: 0 }}>
                                    No authorized senders configured
                                </p>
                            ) : (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                    {authorizedSenders.map((sender, idx) => (
                                        <div key={idx} style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'space-between',
                                            backgroundColor: '#252525',
                                            padding: '10px 12px',
                                            borderRadius: '6px'
                                        }}>
                                            <span style={{
                                                color: '#00d4aa',
                                                fontFamily: 'monospace',
                                                fontSize: '13px'
                                            }}>
                                                {sender.toString()}
                                            </span>
                                            <button
                                                onClick={() => handleRemoveAuthorizedSender(sender)}
                                                disabled={savingSystem}
                                                style={{
                                                    backgroundColor: '#dc3545',
                                                    color: '#fff',
                                                    border: 'none',
                                                    borderRadius: '4px',
                                                    padding: '6px 12px',
                                                    cursor: savingSystem ? 'not-allowed' : 'pointer',
                                                    fontSize: '12px',
                                                    opacity: savingSystem ? 0.6 : 1
                                                }}
                                            >
                                                Remove
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                        
                        {/* Add new sender */}
                        <div style={{ display: 'flex', gap: '10px' }}>
                            <input
                                type="text"
                                value={newAuthorizedSender}
                                onChange={(e) => setNewAuthorizedSender(e.target.value)}
                                placeholder="Enter canister principal ID to authorize"
                                style={{
                                    flex: 1,
                                    backgroundColor: '#1a1a1a',
                                    border: '1px solid #444',
                                    borderRadius: '8px',
                                    padding: '12px 16px',
                                    color: '#fff',
                                    fontFamily: 'monospace',
                                    fontSize: '13px'
                                }}
                                disabled={savingSystem}
                            />
                            <button
                                onClick={handleAddAuthorizedSender}
                                disabled={savingSystem || !newAuthorizedSender.trim()}
                                style={{
                                    backgroundColor: '#00d4aa',
                                    color: '#000',
                                    border: 'none',
                                    borderRadius: '8px',
                                    padding: '12px 20px',
                                    cursor: (savingSystem || !newAuthorizedSender.trim()) ? 'not-allowed' : 'pointer',
                                    opacity: (savingSystem || !newAuthorizedSender.trim()) ? 0.6 : 1,
                                    fontWeight: '600'
                                }}
                            >
                                {savingSystem ? 'Adding...' : 'Add Sender'}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default SmsAdmin;
