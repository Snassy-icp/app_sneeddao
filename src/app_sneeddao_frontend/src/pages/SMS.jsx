import React, { useState, useEffect } from 'react';
import { useAuth } from '../AuthContext';
import Header from '../components/Header';
import { createActor as createSmsActor } from '../../../declarations/sneed_sms';
import { Principal } from '@dfinity/principal';

const SMS = () => {
    const { identity, isAuthenticated } = useAuth();
    const [messages, setMessages] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [selectedTab, setSelectedTab] = useState('all'); // 'all', 'sent', 'received'
    const [showComposeModal, setShowComposeModal] = useState(false);
    const [composeForm, setComposeForm] = useState({
        recipients: '',
        subject: '',
        body: '',
        replyTo: null
    });
    const [submitting, setSubmitting] = useState(false);
    const [stats, setStats] = useState(null);
    const [config, setConfig] = useState(null);
    const [selectedMessage, setSelectedMessage] = useState(null);
    const [showMessageModal, setShowMessageModal] = useState(false);
    const [recipientValidation, setRecipientValidation] = useState('');

    // Create SMS actor
    const getSmsActor = () => {
        if (!identity) return null;
        // Use the canister ID from environment or fallback to the IC canister ID
        const canisterId = process.env.CANISTER_ID_SNEED_SMS || 'v33jy-4qaaa-aaaad-absna-cai';
        return createSmsActor(canisterId, {
            agentOptions: { identity }
        });
    };

    // Fetch messages
    const fetchMessages = async () => {
        if (!identity) return;
        
        setLoading(true);
        setError(null);
        
        try {
            const actor = getSmsActor();
            if (!actor) return;

            let messageData = [];
            switch (selectedTab) {
                case 'sent':
                    messageData = await actor.get_sent_messages();
                    break;
                case 'received':
                    messageData = await actor.get_received_messages();
                    break;
                default:
                    messageData = await actor.get_all_messages();
                    break;
            }
            
            // Sort messages by created_at (newest first)
            messageData.sort((a, b) => Number(b.created_at) - Number(a.created_at));
            setMessages(messageData);
        } catch (err) {
            console.error('Error fetching messages:', err);
            setError('Failed to load messages');
        } finally {
            setLoading(false);
        }
    };

    // Fetch stats and config
    const fetchStats = async () => {
        if (!identity) return;
        
        try {
            const actor = getSmsActor();
            if (!actor) return;

            const [statsData, configData] = await Promise.all([
                actor.get_stats(),
                actor.get_config()
            ]);
            
            setStats(statsData);
            setConfig(configData);
        } catch (err) {
            console.error('Error fetching stats:', err);
        }
    };

    useEffect(() => {
        if (isAuthenticated) {
            fetchMessages();
            fetchStats();
        }
    }, [isAuthenticated, selectedTab]);

    // Send message
    const sendMessage = async () => {
        if (!identity || !composeForm.subject.trim() || !composeForm.body.trim() || !composeForm.recipients.trim()) {
            setError('Please fill in all required fields');
            return;
        }

        setSubmitting(true);
        setError(null);

        try {
            const actor = getSmsActor();
            if (!actor) return;

            // Parse recipients (comma or space separated) and convert to Principal objects
            const recipientStrings = composeForm.recipients
                .split(/[,\s]+/)
                .map(r => r.trim())
                .filter(r => r.length > 0);

            // Validate and convert to Principal objects
            const recipientPrincipals = [];
            for (const recipientStr of recipientStrings) {
                try {
                    const principal = Principal.fromText(recipientStr);
                    recipientPrincipals.push(principal);
                } catch (principalError) {
                    setError(`Invalid principal format: ${recipientStr}. Please check the principal ID.`);
                    setSubmitting(false);
                    return;
                }
            }

            const messageInput = {
                recipients: recipientPrincipals,
                subject: composeForm.subject.trim(),
                body: composeForm.body.trim(),
                reply_to: composeForm.replyTo ? [BigInt(composeForm.replyTo)] : []
            };

            const result = await actor.send_message(messageInput);
            
            if ('ok' in result) {
                setShowComposeModal(false);
                setComposeForm({ recipients: '', subject: '', body: '', replyTo: null });
                setRecipientValidation('');
                await fetchMessages();
                await fetchStats();
            } else {
                const errorMsg = result.err.InvalidInput || result.err.RateLimited || result.err.Unauthorized || result.err.NotFound || result.err.AlreadyExists || 'Failed to send message';
                setError(errorMsg);
            }
        } catch (err) {
            console.error('Error sending message:', err);
            setError('Failed to send message: ' + (err.message || err.toString()));
        } finally {
            setSubmitting(false);
        }
    };

    // Remove self from message
    const removeSelfFromMessage = async (messageId) => {
        if (!identity) return;

        try {
            const actor = getSmsActor();
            if (!actor) return;

            const result = await actor.remove_self_from_message(BigInt(messageId));
            
            if ('ok' in result) {
                await fetchMessages();
                setShowMessageModal(false);
                setSelectedMessage(null);
            } else {
                const errorMsg = result.err.InvalidInput || result.err.Unauthorized || result.err.NotFound || result.err.AlreadyExists || result.err.RateLimited || 'Failed to remove message';
                setError(errorMsg);
            }
        } catch (err) {
            console.error('Error removing message:', err);
            setError('Failed to remove message: ' + (err.message || err.toString()));
        }
    };

    // Format date
    const formatDate = (timestamp) => {
        const date = new Date(Number(timestamp) / 1000000); // Convert nanoseconds to milliseconds
        return date.toLocaleString();
    };

    // Format principal
    const formatPrincipal = (principal) => {
        const principalStr = principal.toString();
        return `${principalStr.slice(0, 6)}...${principalStr.slice(-6)}`;
    };

    // Validate recipients input
    const validateRecipients = (recipientsText) => {
        if (!recipientsText.trim()) {
            setRecipientValidation('');
            return;
        }

        const recipientStrings = recipientsText
            .split(/[,\s]+/)
            .map(r => r.trim())
            .filter(r => r.length > 0);

        const invalidPrincipals = [];
        const validPrincipals = [];

        for (const recipientStr of recipientStrings) {
            try {
                Principal.fromText(recipientStr);
                validPrincipals.push(recipientStr);
            } catch (error) {
                invalidPrincipals.push(recipientStr);
            }
        }

        if (invalidPrincipals.length > 0) {
            setRecipientValidation(`Invalid principals: ${invalidPrincipals.join(', ')}`);
        } else if (validPrincipals.length > 0) {
            setRecipientValidation(`✓ ${validPrincipals.length} valid principal${validPrincipals.length > 1 ? 's' : ''}`);
        } else {
            setRecipientValidation('');
        }
    };

    // Reply to message
    const replyToMessage = (message) => {
        setComposeForm({
            recipients: message.sender.toString(),
            subject: message.subject.startsWith('Re: ') ? message.subject : `Re: ${message.subject}`,
            body: '',
            replyTo: Number(message.id)
        });
        setShowComposeModal(true);
    };

    if (!isAuthenticated) {
        return (
            <div className='page-container'>
                <Header />
                <main className="wallet-container">
                    <div style={{ textAlign: 'center', padding: '40px 20px' }}>
                        <h1 style={{ color: '#ffffff', marginBottom: '20px' }}>Please Connect Your Wallet</h1>
                        <p style={{ color: '#888' }}>You need to connect your wallet to access your messages.</p>
                    </div>
                </main>
            </div>
        );
    }

    return (
        <div className='page-container'>
            <Header />
            <main className="wallet-container">
                {/* Header Section */}
                <div style={{ 
                    display: 'flex', 
                    justifyContent: 'space-between', 
                    alignItems: 'center', 
                    marginBottom: '30px',
                    flexWrap: 'wrap',
                    gap: '15px'
                }}>
                    <h1 style={{ color: '#ffffff', margin: 0 }}>My Messages</h1>
                    <button
                        onClick={() => setShowComposeModal(true)}
                        style={{
                            backgroundColor: '#3498db',
                            color: '#ffffff',
                            border: 'none',
                            borderRadius: '8px',
                            padding: '12px 24px',
                            cursor: 'pointer',
                            fontSize: '16px',
                            fontWeight: '500',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px'
                        }}
                    >
                        ✉️ Compose Message
                    </button>
                </div>

                {/* Stats Section */}
                {stats && (
                    <div style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                        gap: '20px',
                        marginBottom: '30px'
                    }}>
                        <div style={{
                            backgroundColor: '#2a2a2a',
                            borderRadius: '8px',
                            padding: '20px',
                            border: '1px solid #3a3a3a',
                            textAlign: 'center'
                        }}>
                            <div style={{ color: '#3498db', fontSize: '32px', fontWeight: 'bold' }}>
                                {stats.total_messages}
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
                                {stats.total_users}
                            </div>
                            <div style={{ color: '#888', fontSize: '14px' }}>Total Users</div>
                        </div>
                        {config && (
                            <div style={{
                                backgroundColor: '#2a2a2a',
                                borderRadius: '8px',
                                padding: '20px',
                                border: '1px solid #3a3a3a',
                                textAlign: 'center'
                            }}>
                                <div style={{ color: '#f39c12', fontSize: '32px', fontWeight: 'bold' }}>
                                    {config.rate_limit_minutes}
                                </div>
                                <div style={{ color: '#888', fontSize: '14px' }}>Minutes Between Messages</div>
                            </div>
                        )}
                    </div>
                )}

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
                    </div>
                )}

                {/* Tabs */}
                <div style={{ 
                    display: 'flex', 
                    gap: '10px', 
                    marginBottom: '20px',
                    borderBottom: '1px solid #3a3a3a'
                }}>
                    {[
                        { key: 'all', label: 'All Messages' },
                        { key: 'sent', label: 'Sent' },
                        { key: 'received', label: 'Received' }
                    ].map(tab => (
                        <button
                            key={tab.key}
                            onClick={() => setSelectedTab(tab.key)}
                            style={{
                                background: selectedTab === tab.key ? '#3498db' : 'transparent',
                                color: selectedTab === tab.key ? '#ffffff' : '#888',
                                border: 'none',
                                borderRadius: '4px 4px 0 0',
                                padding: '12px 20px',
                                cursor: 'pointer',
                                fontSize: '16px',
                                borderBottom: selectedTab === tab.key ? '2px solid #3498db' : '2px solid transparent'
                            }}
                        >
                            {tab.label}
                        </button>
                    ))}
                </div>

                {/* Messages List */}
                {loading ? (
                    <div style={{ textAlign: 'center', padding: '40px 20px', color: '#ffffff' }}>
                        Loading messages...
                    </div>
                ) : messages.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '40px 20px', color: '#888' }}>
                        <p>No messages found.</p>
                        <button
                            onClick={() => setShowComposeModal(true)}
                            style={{
                                backgroundColor: '#3498db',
                                color: '#ffffff',
                                border: 'none',
                                borderRadius: '6px',
                                padding: '10px 20px',
                                cursor: 'pointer',
                                marginTop: '15px'
                            }}
                        >
                            Send your first message
                        </button>
                    </div>
                ) : (
                    <div style={{ 
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '15px'
                    }}>
                        {messages.map((message) => (
                            <div
                                key={Number(message.id)}
                                onClick={() => {
                                    setSelectedMessage(message);
                                    setShowMessageModal(true);
                                }}
                                style={{
                                    backgroundColor: '#2a2a2a',
                                    borderRadius: '8px',
                                    padding: '20px',
                                    border: '1px solid #3a3a3a',
                                    cursor: 'pointer',
                                    transition: 'all 0.2s ease'
                                }}
                                onMouseEnter={(e) => {
                                    e.currentTarget.style.backgroundColor = '#333333';
                                    e.currentTarget.style.borderColor = '#3498db';
                                }}
                                onMouseLeave={(e) => {
                                    e.currentTarget.style.backgroundColor = '#2a2a2a';
                                    e.currentTarget.style.borderColor = '#3a3a3a';
                                }}
                            >
                                <div style={{ 
                                    display: 'flex', 
                                    justifyContent: 'space-between', 
                                    alignItems: 'flex-start',
                                    marginBottom: '10px'
                                }}>
                                    <div style={{ flex: 1 }}>
                                        <div style={{ 
                                            color: '#ffffff', 
                                            fontSize: '18px', 
                                            fontWeight: '500',
                                            marginBottom: '5px'
                                        }}>
                                            {message.subject}
                                        </div>
                                        <div style={{ 
                                            color: '#888', 
                                            fontSize: '14px',
                                            marginBottom: '5px'
                                        }}>
                                            From: {formatPrincipal(message.sender)}
                                        </div>
                                        <div style={{ 
                                            color: '#888', 
                                            fontSize: '14px'
                                        }}>
                                            To: {message.recipients.map(r => formatPrincipal(r)).join(', ')}
                                        </div>
                                    </div>
                                    <div style={{ 
                                        color: '#888', 
                                        fontSize: '12px',
                                        textAlign: 'right'
                                    }}>
                                        {formatDate(message.created_at)}
                                    </div>
                                </div>
                                <div style={{ 
                                    color: '#ccc', 
                                    fontSize: '14px',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap'
                                }}>
                                    {message.body}
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {/* Compose Modal */}
                {showComposeModal && (
                    <div style={{
                        position: 'fixed',
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        backgroundColor: 'rgba(0, 0, 0, 0.8)',
                        display: 'flex',
                        justifyContent: 'center',
                        alignItems: 'center',
                        zIndex: 1000
                    }}>
                        <div style={{
                            backgroundColor: '#2a2a2a',
                            borderRadius: '8px',
                            padding: '30px',
                            width: '90%',
                            maxWidth: '600px',
                            maxHeight: '80vh',
                            overflow: 'auto',
                            border: '1px solid #3a3a3a'
                        }}>
                            <div style={{ 
                                display: 'flex', 
                                justifyContent: 'space-between', 
                                alignItems: 'center',
                                marginBottom: '20px'
                            }}>
                                <h2 style={{ color: '#ffffff', margin: 0 }}>
                                    {composeForm.replyTo ? 'Reply to Message' : 'Compose Message'}
                                </h2>
                                <button
                                    onClick={() => {
                                        setShowComposeModal(false);
                                        setComposeForm({ recipients: '', subject: '', body: '', replyTo: null });
                                        setRecipientValidation('');
                                        setError(null);
                                    }}
                                    style={{
                                        background: 'none',
                                        border: 'none',
                                        color: '#888',
                                        cursor: 'pointer',
                                        fontSize: '24px'
                                    }}
                                >
                                    ×
                                </button>
                            </div>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                                <div>
                                    <label style={{ color: '#ffffff', display: 'block', marginBottom: '5px' }}>
                                        Recipients (comma or space separated):
                                    </label>
                                    <input
                                        type="text"
                                        value={composeForm.recipients}
                                        onChange={(e) => {
                                            const newValue = e.target.value;
                                            setComposeForm(prev => ({ ...prev, recipients: newValue }));
                                            validateRecipients(newValue);
                                        }}
                                        placeholder="rdmx6-jaaaa-aaaah-qcaiq-cai, abc12-defgh-..."
                                        style={{
                                            width: '100%',
                                            padding: '10px',
                                            backgroundColor: '#3a3a3a',
                                            border: `1px solid ${recipientValidation.startsWith('Invalid') ? '#e74c3c' : '#4a4a4a'}`,
                                            borderRadius: '4px',
                                            color: '#ffffff',
                                            fontSize: '14px'
                                        }}
                                    />
                                    <div style={{
                                        color: recipientValidation.startsWith('✓') ? '#2ecc71' : 
                                               recipientValidation.startsWith('Invalid') ? '#e74c3c' : '#888',
                                        fontSize: '12px',
                                        marginTop: '5px'
                                    }}>
                                        {recipientValidation || 'Enter valid IC principal IDs (format: xxxxx-xxxxx-xxxxx-xxxxx-xxx)'}
                                    </div>
                                </div>

                                <div>
                                    <label style={{ color: '#ffffff', display: 'block', marginBottom: '5px' }}>
                                        Subject:
                                    </label>
                                    <input
                                        type="text"
                                        value={composeForm.subject}
                                        onChange={(e) => setComposeForm(prev => ({ ...prev, subject: e.target.value }))}
                                        placeholder="Enter subject..."
                                        maxLength={config?.max_subject_length || 200}
                                        style={{
                                            width: '100%',
                                            padding: '10px',
                                            backgroundColor: '#3a3a3a',
                                            border: '1px solid #4a4a4a',
                                            borderRadius: '4px',
                                            color: '#ffffff',
                                            fontSize: '14px'
                                        }}
                                    />
                                </div>

                                <div>
                                    <label style={{ color: '#ffffff', display: 'block', marginBottom: '5px' }}>
                                        Message:
                                    </label>
                                    <textarea
                                        value={composeForm.body}
                                        onChange={(e) => setComposeForm(prev => ({ ...prev, body: e.target.value }))}
                                        placeholder="Enter your message..."
                                        maxLength={config?.max_body_length || 5000}
                                        rows={8}
                                        style={{
                                            width: '100%',
                                            padding: '10px',
                                            backgroundColor: '#3a3a3a',
                                            border: '1px solid #4a4a4a',
                                            borderRadius: '4px',
                                            color: '#ffffff',
                                            fontSize: '14px',
                                            resize: 'vertical'
                                        }}
                                    />
                                </div>

                                <div style={{ 
                                    display: 'flex', 
                                    justifyContent: 'flex-end', 
                                    gap: '10px',
                                    marginTop: '10px'
                                }}>
                                    <button
                                        onClick={() => {
                                            setShowComposeModal(false);
                                            setComposeForm({ recipients: '', subject: '', body: '', replyTo: null });
                                            setRecipientValidation('');
                                            setError(null);
                                        }}
                                        disabled={submitting}
                                        style={{
                                            backgroundColor: '#6c757d',
                                            color: '#ffffff',
                                            border: 'none',
                                            borderRadius: '6px',
                                            padding: '10px 20px',
                                            cursor: submitting ? 'not-allowed' : 'pointer',
                                            opacity: submitting ? 0.6 : 1
                                        }}
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        onClick={sendMessage}
                                        disabled={submitting || !composeForm.recipients.trim() || !composeForm.subject.trim() || !composeForm.body.trim()}
                                        style={{
                                            backgroundColor: '#3498db',
                                            color: '#ffffff',
                                            border: 'none',
                                            borderRadius: '6px',
                                            padding: '10px 20px',
                                            cursor: (submitting || !composeForm.recipients.trim() || !composeForm.subject.trim() || !composeForm.body.trim()) ? 'not-allowed' : 'pointer',
                                            opacity: (submitting || !composeForm.recipients.trim() || !composeForm.subject.trim() || !composeForm.body.trim()) ? 0.6 : 1,
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '8px'
                                        }}
                                    >
                                        {submitting ? (
                                            <>
                                                <span style={{ 
                                                    display: 'inline-block',
                                                    animation: 'spin 1s linear infinite',
                                                    fontSize: '14px'
                                                }}>⟳</span>
                                                Sending...
                                            </>
                                        ) : (
                                            <>
                                                ✉️ Send Message
                                            </>
                                        )}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* Message Detail Modal */}
                {showMessageModal && selectedMessage && (
                    <div style={{
                        position: 'fixed',
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        backgroundColor: 'rgba(0, 0, 0, 0.8)',
                        display: 'flex',
                        justifyContent: 'center',
                        alignItems: 'center',
                        zIndex: 1000
                    }}>
                        <div style={{
                            backgroundColor: '#2a2a2a',
                            borderRadius: '8px',
                            padding: '30px',
                            width: '90%',
                            maxWidth: '700px',
                            maxHeight: '80vh',
                            overflow: 'auto',
                            border: '1px solid #3a3a3a'
                        }}>
                            <div style={{ 
                                display: 'flex', 
                                justifyContent: 'space-between', 
                                alignItems: 'center',
                                marginBottom: '20px'
                            }}>
                                <h2 style={{ color: '#ffffff', margin: 0 }}>Message Details</h2>
                                <button
                                    onClick={() => {
                                        setShowMessageModal(false);
                                        setSelectedMessage(null);
                                    }}
                                    style={{
                                        background: 'none',
                                        border: 'none',
                                        color: '#888',
                                        cursor: 'pointer',
                                        fontSize: '24px'
                                    }}
                                >
                                    ×
                                </button>
                            </div>

                            <div style={{ marginBottom: '20px' }}>
                                <div style={{ marginBottom: '15px' }}>
                                    <strong style={{ color: '#888' }}>Subject:</strong>
                                    <div style={{ color: '#ffffff', fontSize: '18px', marginTop: '5px' }}>
                                        {selectedMessage.subject}
                                    </div>
                                </div>

                                <div style={{ marginBottom: '15px' }}>
                                    <strong style={{ color: '#888' }}>From:</strong>
                                    <div style={{ color: '#3498db', fontFamily: 'monospace', marginTop: '5px' }}>
                                        {selectedMessage.sender.toString()}
                                    </div>
                                </div>

                                <div style={{ marginBottom: '15px' }}>
                                    <strong style={{ color: '#888' }}>To:</strong>
                                    <div style={{ marginTop: '5px' }}>
                                        {selectedMessage.recipients.map((recipient, index) => (
                                            <div key={index} style={{ color: '#3498db', fontFamily: 'monospace', marginBottom: '2px' }}>
                                                {recipient.toString()}
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                <div style={{ marginBottom: '15px' }}>
                                    <strong style={{ color: '#888' }}>Date:</strong>
                                    <div style={{ color: '#ffffff', marginTop: '5px' }}>
                                        {formatDate(selectedMessage.created_at)}
                                    </div>
                                </div>

                                <div style={{ marginBottom: '20px' }}>
                                    <strong style={{ color: '#888' }}>Message:</strong>
                                    <div style={{ 
                                        color: '#ffffff', 
                                        marginTop: '10px',
                                        backgroundColor: '#1a1a1a',
                                        padding: '15px',
                                        borderRadius: '6px',
                                        whiteSpace: 'pre-wrap',
                                        lineHeight: '1.5'
                                    }}>
                                        {selectedMessage.body}
                                    </div>
                                </div>
                            </div>

                            <div style={{ 
                                display: 'flex', 
                                justifyContent: 'flex-end', 
                                gap: '10px',
                                borderTop: '1px solid #3a3a3a',
                                paddingTop: '15px'
                            }}>
                                <button
                                    onClick={() => replyToMessage(selectedMessage)}
                                    style={{
                                        backgroundColor: '#3498db',
                                        color: '#ffffff',
                                        border: 'none',
                                        borderRadius: '6px',
                                        padding: '10px 20px',
                                        cursor: 'pointer',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '8px'
                                    }}
                                >
                                    ↩️ Reply
                                </button>
                                {selectedMessage.can_remove_self && (
                                    <button
                                        onClick={() => {
                                            if (window.confirm('Are you sure you want to remove yourself from this message? This action cannot be undone.')) {
                                                removeSelfFromMessage(Number(selectedMessage.id));
                                            }
                                        }}
                                        style={{
                                            backgroundColor: '#e74c3c',
                                            color: '#ffffff',
                                            border: 'none',
                                            borderRadius: '6px',
                                            padding: '10px 20px',
                                            cursor: 'pointer',
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '8px'
                                        }}
                                    >
                                        🗑️ Remove
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                )}
            </main>

            <style>
                {`
                @keyframes spin {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(360deg); }
                }
                `}
            </style>
        </div>
    );
};

export default SMS;
