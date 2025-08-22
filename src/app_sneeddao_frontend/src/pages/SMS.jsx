import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import Header from '../components/Header';
import { createActor as createSmsActor } from '../../../declarations/sneed_sms';
import { Principal } from '@dfinity/principal';
import { PrincipalDisplay, getPrincipalDisplayInfoFromContext } from '../utils/PrincipalUtils';
import { useNaming } from '../NamingContext';
import { 
    getRecentMessagesCount,
    markMessagesSeenUpTo,
    getLastSeenMessagesTimestamp
} from '../utils/BackendUtils';
import PrincipalInput from '../components/PrincipalInput';

const SMS = () => {
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();
    const { identity, isAuthenticated } = useAuth();
    const { principalNames, principalNicknames } = useNaming();
    

    const [messages, setMessages] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [selectedTab, setSelectedTab] = useState('received'); // 'received', 'sent', 'all'
    const [showComposeModal, setShowComposeModal] = useState(false);
    const [composeForm, setComposeForm] = useState({
        recipients: [''], // Array of principal strings
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
    const [principalDisplayInfo, setPrincipalDisplayInfo] = useState(new Map());
    const [showMessageDetails, setShowMessageDetails] = useState(false);
    
    // Message highlighting state (using single-execution pattern like Posts)
    const [capturedOldMessagesTimestamp, setCapturedOldMessagesTimestamp] = useState(0);
    const [messagesTimestampProcessed, setMessagesTimestampProcessed] = useState(false);

    // Helper function to truncate subject for header display
    const truncateSubject = (subject, maxLength = 50) => {
        if (subject.length <= maxLength) return subject;
        return subject.substring(0, maxLength) + '...';
    };

    // Helper function to check if a message is new (for highlighting)
    const isMessageNew = (messageTimestamp) => {
        const isNew = Number(messageTimestamp) > capturedOldMessagesTimestamp;
        console.log(`🔥 MESSAGE NEW CHECK: messageTimestamp=${messageTimestamp}, capturedOldMessagesTimestamp=${capturedOldMessagesTimestamp}, isNew=${isNew}`);
        return isNew;
    };

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

    // ONE-TIME messages timestamp processing - executes ONCE per page load
    useEffect(() => {
        const processMessagesTimestamp = async () => {
            if (!isAuthenticated || !identity || messagesTimestampProcessed) {
                return;
            }

            try {
                const actor = getSmsActor();
                if (!actor) return;

                const userPrincipal = identity.getPrincipal();

                // Step 1: Get old timestamp ONCE
                const oldTimestampResult = await getLastSeenMessagesTimestamp(actor, userPrincipal);
                const currentOldTimestamp = oldTimestampResult || 0;
                setCapturedOldMessagesTimestamp(currentOldTimestamp);
                
                console.log(`🔥 SMS: CAPTURED OLD TIMESTAMP: ${currentOldTimestamp}`);

                // Step 2: Check if we have new messages
                const newMessagesCount = await getRecentMessagesCount(actor, userPrincipal);
                console.log(`🔥 SMS: NEW MESSAGES COUNT: ${newMessagesCount}`);

                // Step 3: Update backend timestamp ONCE if we have new messages
                if (Number(newMessagesCount) > 0) {
                    const currentTimestamp = Date.now() * 1_000_000;
                    await markMessagesSeenUpTo(actor, currentTimestamp);
                    console.log(`🔥 SMS: UPDATED BACKEND TIMESTAMP ONCE: ${currentTimestamp}`);
                    
                    // Step 4: Default to received tab if new messages > 0
                    setSelectedTab('received');
                    console.log(`🔥 SMS: DEFAULTED TO RECEIVED TAB (${newMessagesCount} new messages)`);
                } else {
                    console.log('🔥 SMS: NO NEW MESSAGES - NO BACKEND UPDATE');
                }

                // Mark as processed to prevent re-execution
                setMessagesTimestampProcessed(true);

            } catch (err) {
                console.error('Error processing messages timestamp:', err);
                setMessagesTimestampProcessed(true); // Still mark as processed to avoid loops
            }
        };

        processMessagesTimestamp();
    }, [isAuthenticated, identity, messagesTimestampProcessed]);

    // Handle reply parameter from URL
    useEffect(() => {
        const replyId = searchParams.get('reply');
        if (replyId && messages.length > 0 && isAuthenticated) {
            const replyToMessage = messages.find(msg => Number(msg.id) === Number(replyId));
            if (replyToMessage) {
                console.log('Auto-opening reply for message:', replyId);
                // Set up the reply form
                const senderPrincipal = replyToMessage.sender.toString();
                const displayInfo = getPrincipalDisplayInfoFromContext(senderPrincipal, principalNames, principalNicknames);
                
                setComposeForm({
                    recipients: [senderPrincipal],
                    subject: replyToMessage.subject.startsWith('Re: ') ? replyToMessage.subject : `Re: ${replyToMessage.subject}`,
                    body: '',
                    replyTo: Number(replyToMessage.id)
                });
                
                // Open compose modal
                setShowComposeModal(true);
                
                // Clear the reply parameter from URL
                setSearchParams({});
            }
        }
    }, [searchParams, messages, isAuthenticated, principalNames, principalNicknames]);

    // Handle recipient parameter from URL (for direct messaging)
    useEffect(() => {
        const recipientParam = searchParams.get('recipient');
        if (recipientParam && isAuthenticated && principalNames && principalNicknames) {
            try {
                // Validate that it's a valid principal
                Principal.fromText(recipientParam);
                
                console.log('Auto-opening compose for recipient:', recipientParam);
                const displayInfo = getPrincipalDisplayInfoFromContext(recipientParam, principalNames, principalNicknames);
                
                setComposeForm({
                    recipients: [recipientParam],
                    subject: '',
                    body: '',
                    replyTo: null
                });
                setShowComposeModal(true);
                
                // Clear the recipient parameter from URL
                setSearchParams({});
            } catch (e) {
                console.error('Invalid recipient principal from URL:', e);
            }
        }
    }, [searchParams, isAuthenticated, principalNames, principalNicknames]);

    // Fetch principal display info for all unique principals in messages
    useEffect(() => {
        if (!messages.length || !principalNames || !principalNicknames) return;

        const uniquePrincipals = new Set();
        messages.forEach(message => {
            // Add sender
            uniquePrincipals.add(message.sender.toString());
            // Add recipients
            message.recipients.forEach(recipient => {
                uniquePrincipals.add(recipient.toString());
            });
        });

        const displayInfoMap = new Map();
        Array.from(uniquePrincipals).forEach(principal => {
            const displayInfo = getPrincipalDisplayInfoFromContext(principal, principalNames, principalNicknames);
            displayInfoMap.set(principal, displayInfo);
        });

        setPrincipalDisplayInfo(displayInfoMap);
    }, [messages, principalNames, principalNicknames]);

        // Send message
    const sendMessage = async () => {
        // Check if we have valid recipients
        const validRecipients = composeForm.recipients.filter(r => {
            if (!r.trim()) return false;
            try {
                Principal.fromText(r.trim());
                return true;
            } catch (e) {
                return false;
            }
        });
        
        if (!identity || !composeForm.subject.trim() || !composeForm.body.trim() || validRecipients.length === 0) {
            setError('Please fill in all required fields and ensure at least one recipient is valid');
            return;
        }

        setSubmitting(true);
        setError(null);
        
        try {
            const actor = getSmsActor();
            if (!actor) return;

            // Convert valid recipients to Principal objects
            const recipientPrincipals = validRecipients.map(r => Principal.fromText(r.trim()));

            const messageInput = {
                recipients: recipientPrincipals,
                subject: composeForm.subject.trim(),
                body: composeForm.body.trim(),
                reply_to: composeForm.replyTo ? [[BigInt(composeForm.replyTo)]] : [] // Optional array containing array of BigInt
            };

            const result = await actor.send_message(messageInput);
            
            if ('ok' in result) {
                setShowComposeModal(false);
                setComposeForm({ recipients: [''], subject: '', body: '', replyTo: null });
                setRecipientValidation('');
                await fetchMessages();
                await fetchStats();
            } else {
                // Extract the specific error message from the backend response
                let errorMsg = 'Failed to send message';
                if (result.err.RateLimited) {
                    errorMsg = `Rate Limited: ${result.err.RateLimited}`;
                } else if (result.err.InvalidInput) {
                    errorMsg = `Invalid Input: ${result.err.InvalidInput}`;
                } else if (result.err.Unauthorized) {
                    errorMsg = `Unauthorized: ${result.err.Unauthorized}`;
                } else if (result.err.NotFound) {
                    errorMsg = `Not Found: ${result.err.NotFound}`;
                } else if (result.err.AlreadyExists) {
                    errorMsg = `Already Exists: ${result.err.AlreadyExists}`;
                }

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

    // Add a new recipient input
    const addRecipient = () => {
        setComposeForm(prev => ({
            ...prev,
            recipients: [...prev.recipients, '']
        }));
    };

    // Remove a recipient input
    const removeRecipient = (index) => {
        setComposeForm(prev => ({
            ...prev,
            recipients: prev.recipients.length > 1 ? prev.recipients.filter((_, i) => i !== index) : prev.recipients
        }));
    };

    // Update a specific recipient
    const updateRecipient = (index, value) => {
        setComposeForm(prev => ({
            ...prev,
            recipients: prev.recipients.map((recipient, i) => i === index ? value : recipient)
        }));
    };





    // Reply to message
    const replyToMessage = (message) => {
        // Close the message modal first
        setShowMessageModal(false);
        setSelectedMessage(null);
        
        // Set up the reply form with the sender as recipient
        const senderPrincipal = message.sender.toString();
        const displayInfo = getPrincipalDisplayInfoFromContext(senderPrincipal, principalNames, principalNicknames);
        
        setComposeForm({
            recipients: [senderPrincipal],
            subject: message.subject.startsWith('Re: ') ? message.subject : `Re: ${message.subject}`,
            body: '',
            replyTo: Number(message.id)
        });
        
        // Open compose modal
        setShowComposeModal(true);
    };

    // Reply to all (sender + all recipients)
    const replyToAllMessage = (message) => {
        // Close the message modal first
        setShowMessageModal(false);
        setSelectedMessage(null);
        
        // Get all unique recipients (sender + recipients, excluding current user)
        const currentUserPrincipal = identity.getPrincipal().toString();
        const allRecipients = new Set();
        
        // Add sender if it's not the current user
        if (message.sender.toString() !== currentUserPrincipal) {
            allRecipients.add(message.sender.toString());
        }
        
        // Add all recipients except current user
        message.recipients.forEach(recipient => {
            const recipientStr = recipient.toString();
            if (recipientStr !== currentUserPrincipal) {
                allRecipients.add(recipientStr);
            }
        });
        
        // Set up the reply all form
        setComposeForm({
            recipients: allRecipients.size > 0 ? Array.from(allRecipients) : [''],
            subject: message.subject.startsWith('Re: ') ? message.subject : `Re: ${message.subject}`,
            body: '',
            replyTo: Number(message.id)
        });
        
        // Open compose modal
        setShowComposeModal(true);
    };

    // Helper function to check if form is valid for submission
    const isFormValid = () => {
        const validRecipients = composeForm.recipients.filter(r => {
            if (!r.trim()) return false;
            try {
                Principal.fromText(r.trim());
                return true;
            } catch (e) {
                return false;
            }
        });
        
        return !submitting && 
               validRecipients.length > 0 && 
               composeForm.subject.trim() && 
               composeForm.body.trim();
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
                        {config && (
                            <div style={{
                                backgroundColor: '#2a2a2a',
                                borderRadius: '8px',
                                padding: '20px',
                                border: '1px solid #3a3a3a',
                                textAlign: 'center'
                            }}>
                                <div style={{ color: '#f39c12', fontSize: '32px', fontWeight: 'bold' }}>
                                    {Number(config.rate_limit_minutes)}
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
                        { key: 'received', label: 'Received' },
                        { key: 'sent', label: 'Sent' },
                        { key: 'all', label: 'All Messages' }
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
                        {messages.map((message) => {
                            // Check if this is a received message (user is recipient, not sender)
                            const userPrincipal = identity?.getPrincipal();
                            const userPrincipalString = userPrincipal?.toString();
                            const messageSenderString = message.sender.toString();
                            const isReceivedMessage = userPrincipalString && messageSenderString !== userPrincipalString;
                            
                            // Check if this received message is new (only highlight received messages)
                            const isNew = isReceivedMessage && isMessageNew(message.created_at);
                            
                            return (
                                <div
                                    key={Number(message.id)}
                                    onClick={() => {
                                        setSelectedMessage(message);
                                        setShowMessageModal(true);
                                    }}
                                    style={{
                                        backgroundColor: isNew ? 'rgba(0, 191, 255, 0.1)' : '#2a2a2a',
                                        borderRadius: '8px',
                                        padding: '20px',
                                        border: isNew ? '1px solid #00BFFF' : '1px solid #3a3a3a',
                                        cursor: 'pointer',
                                        transition: 'all 0.2s ease'
                                    }}
                                onMouseEnter={(e) => {
                                    e.currentTarget.style.backgroundColor = isNew ? 'rgba(0, 191, 255, 0.2)' : '#333333';
                                    e.currentTarget.style.borderColor = '#3498db';
                                }}
                                onMouseLeave={(e) => {
                                    e.currentTarget.style.backgroundColor = isNew ? 'rgba(0, 191, 255, 0.1)' : '#2a2a2a';
                                    e.currentTarget.style.borderColor = isNew ? '#00BFFF' : '#3a3a3a';
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
                                            marginBottom: '5px',
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '8px'
                                        }}>
                                            <span>From:</span>
                                            <PrincipalDisplay 
                                                principal={message.sender}
                                                displayInfo={principalDisplayInfo.get(message.sender.toString())}
                                                showCopyButton={false}
                                                style={{ color: '#888', fontSize: '14px' }}
                                            />
                                        </div>
                                        <div style={{ 
                                            color: '#888', 
                                            fontSize: '14px',
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '8px',
                                            flexWrap: 'wrap'
                                        }}>
                                            <span>To:</span>
                                            {message.recipients.map((recipient, index) => (
                                                <React.Fragment key={recipient.toString()}>
                                                    <PrincipalDisplay 
                                                        principal={recipient}
                                                        displayInfo={principalDisplayInfo.get(recipient.toString())}
                                                        showCopyButton={false}
                                                        style={{ color: '#888', fontSize: '14px' }}
                                                    />
                                                    {index < message.recipients.length - 1 && <span>,</span>}
                                                </React.Fragment>
                                            ))}
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
                                
                                {/* Action buttons */}
                                <div style={{ 
                                    marginTop: '15px', 
                                    display: 'flex', 
                                    gap: '10px',
                                    alignItems: 'center'
                                }}>
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation(); // Prevent triggering the message modal
                                            navigate(`/msg/${message.id}`);
                                        }}
                                        style={{
                                            backgroundColor: '#2ecc71',
                                            color: '#ffffff',
                                            border: 'none',
                                            borderRadius: '4px',
                                            padding: '6px 12px',
                                            cursor: 'pointer',
                                            fontSize: '12px'
                                        }}
                                    >
                                        🔗 View Thread
                                    </button>
                                </div>
                            </div>
                            );
                        })}
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
                        zIndex: 1100
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
                                        setComposeForm({ recipients: [''], subject: '', body: '', replyTo: null });
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
                                    <label style={{ color: '#ffffff', display: 'block', marginBottom: '10px', fontSize: '16px' }}>
                                        Recipients:
                                    </label>
                                    {composeForm.recipients.map((recipient, index) => (
                                        <div key={index} style={{ marginBottom: '10px' }}>
                                            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                                                <div style={{ flex: '1', minWidth: '0' }}>
                                                    <PrincipalInput
                                                        value={recipient}
                                                        onChange={(value) => updateRecipient(index, value)}
                                                        placeholder="Enter principal ID or search by name"
                                                        style={{ 
                                                            marginBottom: '0',
                                                            width: composeForm.recipients.length > 1 ? 'calc(100% - 10px)' : '100%'
                                                        }}
                                                    />
                                                </div>
                                                {composeForm.recipients.length > 1 && (
                                                    <button
                                                        type="button"
                                                        onClick={() => removeRecipient(index)}
                                                        style={{
                                                            padding: '8px 10px',
                                                            backgroundColor: '#e74c3c',
                                                            color: 'white',
                                                            border: 'none',
                                                            borderRadius: '4px',
                                                            cursor: 'pointer',
                                                            fontSize: '16px',
                                                            flexShrink: 0,
                                                            alignSelf: 'flex-start',
                                                            marginTop: '0',
                                                            width: '36px',
                                                            height: '36px',
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            justifyContent: 'center'
                                                        }}
                                                        title="Remove recipient"
                                                    >
                                                        ×
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                    <button
                                        type="button"
                                        onClick={addRecipient}
                                        style={{
                                            padding: '8px 16px',
                                            backgroundColor: '#2ecc71',
                                            color: 'white',
                                            border: 'none',
                                            borderRadius: '4px',
                                            cursor: 'pointer',
                                            fontSize: '14px',
                                            marginBottom: '15px'
                                        }}
                                    >
                                        + Add Recipient
                                    </button>
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

                                {/* Error display in compose modal */}
                                {error && (
                                    <div style={{ 
                                        backgroundColor: 'rgba(231, 76, 60, 0.2)', 
                                        border: '1px solid #e74c3c',
                                        color: '#e74c3c',
                                        padding: '10px',
                                        borderRadius: '4px',
                                        marginTop: '15px',
                                        fontSize: '14px'
                                    }}>
                                        {error}
                                    </div>
                                )}

                                <div style={{ 
                                    display: 'flex', 
                                    justifyContent: 'flex-end', 
                                    gap: '10px',
                                    marginTop: '10px'
                                }}>
                                    <button
                                        onClick={() => {
                                            setShowComposeModal(false);
                                            setComposeForm({ recipients: [''], subject: '', body: '', replyTo: null });
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
                                        disabled={!isFormValid()}
                                        style={{
                                            backgroundColor: '#3498db',
                                            color: '#ffffff',
                                            border: 'none',
                                            borderRadius: '6px',
                                            padding: '10px 20px',
                                            cursor: isFormValid() ? 'pointer' : 'not-allowed',
                                            opacity: isFormValid() ? 1 : 0.6,
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
                    <div 
                        style={{
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
                        }}
                        onClick={(e) => {
                            // Close modal when clicking on backdrop
                            if (e.target === e.currentTarget) {
                                setShowMessageModal(false);
                                setSelectedMessage(null);
                            }
                        }}
                    >
                        <div 
                            style={{
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
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', flex: 1, marginRight: '15px' }}>
                                    <h2 style={{ color: '#ffffff', margin: 0, fontSize: '20px' }}>
                                        {truncateSubject(selectedMessage.subject)}
                                    </h2>
                                    <button
                                        onClick={() => navigate(`/msg/${selectedMessage.id}`)}
                                        style={{
                                            background: 'none',
                                            border: '1px solid #3498db',
                                            color: '#3498db',
                                            cursor: 'pointer',
                                            fontSize: '12px',
                                            padding: '4px 8px',
                                            borderRadius: '4px',
                                            alignSelf: 'flex-start',
                                            textDecoration: 'none'
                                        }}
                                        onMouseOver={(e) => e.target.style.backgroundColor = 'rgba(52, 152, 219, 0.1)'}
                                        onMouseOut={(e) => e.target.style.backgroundColor = 'transparent'}
                                    >
                                        🔗 View Thread
                                    </button>
                                </div>
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

                            {/* Collapsible Message Details */}
                            <div style={{ marginBottom: '20px' }}>
                                <button
                                    onClick={() => setShowMessageDetails(!showMessageDetails)}
                                    style={{
                                        background: 'none',
                                        border: '1px solid #3a3a3a',
                                        color: '#888',
                                        cursor: 'pointer',
                                        fontSize: '14px',
                                        padding: '8px 12px',
                                        borderRadius: '4px',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '8px',
                                        marginBottom: '10px',
                                        width: '100%',
                                        justifyContent: 'space-between'
                                    }}
                                    onMouseOver={(e) => e.target.style.backgroundColor = 'rgba(58, 58, 58, 0.3)'}
                                    onMouseOut={(e) => e.target.style.backgroundColor = 'transparent'}
                                >
                                    <span>Message Details</span>
                                    <span style={{ fontSize: '12px' }}>
                                        {showMessageDetails ? '▼' : '▶'}
                                    </span>
                                </button>

                                {showMessageDetails && (
                                    <div style={{ 
                                        backgroundColor: '#1a1a1a',
                                        padding: '15px',
                                        borderRadius: '6px',
                                        border: '1px solid #3a3a3a'
                                    }}>
                                        <div style={{ marginBottom: '15px' }}>
                                            <strong style={{ color: '#888' }}>Subject:</strong>
                                            <div style={{ color: '#ffffff', fontSize: '16px', marginTop: '5px' }}>
                                                {selectedMessage.subject}
                                            </div>
                                        </div>

                                        <div style={{ marginBottom: '15px' }}>
                                            <strong style={{ color: '#888' }}>From:</strong>
                                            <div style={{ marginTop: '8px' }}>
                                                <PrincipalDisplay 
                                                    principal={selectedMessage.sender}
                                                    displayInfo={principalDisplayInfo.get(selectedMessage.sender.toString())}
                                                    showCopyButton={true}
                                                    style={{ color: '#3498db', fontSize: '14px' }}
                                                />
                                            </div>
                                        </div>

                                        <div style={{ marginBottom: '15px' }}>
                                            <strong style={{ color: '#888' }}>To:</strong>
                                            <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                                {selectedMessage.recipients.map((recipient, index) => (
                                                    <PrincipalDisplay 
                                                        key={recipient.toString()}
                                                        principal={recipient}
                                                        displayInfo={principalDisplayInfo.get(recipient.toString())}
                                                        showCopyButton={true}
                                                        style={{ color: '#3498db', fontSize: '14px' }}
                                                    />
                                                ))}
                                            </div>
                                        </div>

                                        <div style={{ marginBottom: '0' }}>
                                            <strong style={{ color: '#888' }}>Date:</strong>
                                            <div style={{ color: '#ffffff', marginTop: '5px' }}>
                                                {formatDate(selectedMessage.created_at)}
                                            </div>
                                        </div>
                                    </div>
                                )}

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
                                flexWrap: 'wrap',
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
                                <button
                                    onClick={() => replyToAllMessage(selectedMessage)}
                                    style={{
                                        backgroundColor: '#9b59b6',
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
                                    ↩️ Reply All
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
                                <button
                                    onClick={() => {
                                        setShowMessageModal(false);
                                        setSelectedMessage(null);
                                    }}
                                    style={{
                                        backgroundColor: '#6c757d',
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
                                    ✕ Close
                                </button>
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
