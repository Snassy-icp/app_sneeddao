import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import Header from '../components/Header';
import { useTheme } from '../contexts/ThemeContext';
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
import { usePremiumStatus } from '../hooks/usePremiumStatus';

const SMS = () => {
    const { theme } = useTheme();
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

    const [config, setConfig] = useState(null);
    const [premiumConfig, setPremiumConfig] = useState(null);
    const [selectedMessage, setSelectedMessage] = useState(null);
    const [showMessageModal, setShowMessageModal] = useState(false);
    const [recipientValidation, setRecipientValidation] = useState('');
    const [principalDisplayInfo, setPrincipalDisplayInfo] = useState(new Map());
    const [showMessageDetails, setShowMessageDetails] = useState(false);
    
    // Premium status
    const { isPremium } = usePremiumStatus(identity);
    
    // Message highlighting state (using single-execution pattern like Posts)
    const [capturedOldMessagesTimestamp, setCapturedOldMessagesTimestamp] = useState(0);
    const [messagesTimestampProcessed, setMessagesTimestampProcessed] = useState(false);
    
    // Effective limits based on premium status
    const effectiveSubjectLimit = (isPremium && premiumConfig?.premium_max_subject_length) 
        ? premiumConfig.premium_max_subject_length 
        : (config?.max_subject_length || 200);
    const effectiveBodyLimit = (isPremium && premiumConfig?.premium_max_body_length) 
        ? premiumConfig.premium_max_body_length 
        : (config?.max_body_length || 5000);
    const effectiveMaxRecipients = (isPremium && premiumConfig?.premium_max_recipients)
        ? premiumConfig.premium_max_recipients
        : (config?.max_recipients || 20);
    const regularSubjectLimit = config?.max_subject_length || 200;
    const regularBodyLimit = config?.max_body_length || 5000;
    const regularMaxRecipients = config?.max_recipients || 20;
    const hasPremiumSubjectLimit = isPremium && effectiveSubjectLimit > regularSubjectLimit;
    const hasPremiumBodyLimit = isPremium && effectiveBodyLimit > regularBodyLimit;
    const hasPremiumMaxRecipients = isPremium && effectiveMaxRecipients > regularMaxRecipients;

    // Helper function to truncate subject for header display
    const truncateSubject = (subject, maxLength = 50) => {
        if (subject.length <= maxLength) return subject;
        return subject.substring(0, maxLength) + '...';
    };

    // Helper function to check if a message is new (for highlighting)
    const isMessageNew = (messageTimestamp) => {
        return Number(messageTimestamp) > capturedOldMessagesTimestamp;
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

    useEffect(() => {
        if (isAuthenticated) {
            fetchMessages();
            fetchConfig();
        }
    }, [isAuthenticated, selectedTab]);

    // Fetch SMS config (regular and premium)
    const fetchConfig = async () => {
        try {
            const actor = getSmsActor();
            if (!actor) return;
            
            const [regularConfig, premiumCfg] = await Promise.all([
                actor.get_config(),
                actor.get_premium_config().catch(() => null)
            ]);
            
            setConfig(regularConfig);
            if (premiumCfg) {
                setPremiumConfig({
                    sneed_premium_canister_id: premiumCfg.sneed_premium_canister_id?.[0]?.toString() || null,
                    premium_max_subject_length: Number(premiumCfg.premium_max_subject_length),
                    premium_max_body_length: Number(premiumCfg.premium_max_body_length),
                    premium_rate_limit_minutes: Number(premiumCfg.premium_rate_limit_minutes ?? 1),
                    premium_max_recipients: Number(premiumCfg.premium_max_recipients ?? 50)
                });
            }
        } catch (err) {
            console.error('Error fetching SMS config:', err);
        }
    };

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
            <div className='page-container' style={{ background: theme.colors.primaryGradient, minHeight: '100vh' }}>
                <Header />
                <main className="wallet-container">
                    <div style={{ textAlign: 'center', padding: '40px 20px' }}>
                        <h1 style={{ color: theme.colors.primaryText, marginBottom: '20px' }}>Please Connect Your Wallet</h1>
                        <p style={{ color: theme.colors.mutedText }}>You need to connect your wallet to access your messages.</p>
                    </div>
                </main>
            </div>
        );
    }

    return (
        <div className='page-container' style={{ background: theme.colors.primaryGradient, minHeight: '100vh' }}>
            <Header />
            <main className="wallet-container">
                {error && (
                    <div style={{ 
                        backgroundColor: `${theme.colors.error}20`, 
                        border: `1px solid ${theme.colors.error}`,
                        color: theme.colors.error,
                        padding: '15px',
                        borderRadius: '6px',
                        marginBottom: '20px'
                    }}>
                        {error}
                    </div>
                )}

                {/* Tabs with Compose Button */}
                <div style={{ 
                    display: 'flex', 
                    justifyContent: 'space-between',
                    alignItems: 'flex-end',
                    flexWrap: 'wrap',
                    gap: '15px',
                    marginBottom: '20px',
                    borderBottom: `1px solid ${theme.colors.border}`,
                    paddingBottom: '0'
                }}>
                    <div style={{ 
                        display: 'flex', 
                        gap: '10px',
                        flexWrap: 'wrap'
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
                                    background: selectedTab === tab.key ? theme.colors.accent : 'transparent',
                                    color: selectedTab === tab.key ? theme.colors.primaryText : theme.colors.mutedText,
                                    border: 'none',
                                    borderRadius: '4px 4px 0 0',
                                    padding: '12px 20px',
                                    cursor: 'pointer',
                                    fontSize: '16px',
                                    borderBottom: selectedTab === tab.key ? `2px solid ${theme.colors.accent}` : '2px solid transparent'
                                }}
                            >
                                {tab.label}
                            </button>
                        ))}
                    </div>
                    
                    {/* Compose Button - Responsive */}
                    <button
                        onClick={() => setShowComposeModal(true)}
                        style={{
                            backgroundColor: theme.colors.accent,
                            color: theme.colors.primaryText,
                            border: 'none',
                            borderRadius: '8px',
                            padding: '12px 24px',
                            cursor: 'pointer',
                            fontSize: '16px',
                            fontWeight: '500',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            marginBottom: '2px', // Align with tab bottom border
                            flexShrink: 0 // Prevent button from shrinking
                        }}
                    >
                        ✉️ Compose Message
                    </button>
                </div>

                {/* Messages List */}
                {loading ? (
                    <div style={{ textAlign: 'center', padding: '40px 20px', color: theme.colors.primaryText }}>
                        Loading messages...
                    </div>
                ) : messages.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '40px 20px', color: theme.colors.mutedText }}>
                        <p>No messages found.</p>
                        <button
                            onClick={() => setShowComposeModal(true)}
                            style={{
                                backgroundColor: theme.colors.accent,
                                color: theme.colors.primaryText,
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
                                        backgroundColor: isNew ? `${theme.colors.accent}20` : theme.colors.secondaryBg,
                                        borderRadius: '8px',
                                        padding: '20px',
                                        border: isNew ? `1px solid ${theme.colors.accent}` : `1px solid ${theme.colors.border}`,
                                        cursor: 'pointer',
                                        transition: 'all 0.2s ease'
                                    }}
                                onMouseEnter={(e) => {
                                    e.currentTarget.style.backgroundColor = isNew ? `${theme.colors.accent}30` : theme.colors.tertiaryBg;
                                    e.currentTarget.style.borderColor = theme.colors.accent;
                                }}
                                onMouseLeave={(e) => {
                                    e.currentTarget.style.backgroundColor = isNew ? `${theme.colors.accent}20` : theme.colors.secondaryBg;
                                    e.currentTarget.style.borderColor = isNew ? theme.colors.accent : theme.colors.border;
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
                                            color: theme.colors.primaryText, 
                                            fontSize: '18px', 
                                            fontWeight: '500',
                                            marginBottom: '5px'
                                        }}>
                                            {message.subject}
                                        </div>
                                        <div style={{ 
                                            color: theme.colors.mutedText, 
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
                                                short={true}
                                                style={{ color: theme.colors.mutedText, fontSize: '14px' }}
                                            />
                                        </div>
                                        <div style={{ 
                                            color: theme.colors.mutedText, 
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
                                                        short={true}
                                                        style={{ color: theme.colors.mutedText, fontSize: '14px' }}
                                                    />
                                                    {index < message.recipients.length - 1 && <span>,</span>}
                                                </React.Fragment>
                                            ))}
                                        </div>
                                    </div>
                                    <div style={{ 
                                        color: theme.colors.mutedText, 
                                        fontSize: '12px',
                                        textAlign: 'right'
                                    }}>
                                        {formatDate(message.created_at)}
                                    </div>
                                </div>
                                <div style={{ 
                                    color: theme.colors.secondaryText, 
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
                                            backgroundColor: theme.colors.success,
                                            color: theme.colors.primaryText,
                                            border: 'none',
                                            borderRadius: '4px',
                                            padding: '6px 12px',
                                            cursor: 'pointer',
                                            fontSize: '12px'
                                        }}
                                    >
                                        🔗 View Thread
                                    </button>
                                    
                                    {/* Reply button - only show if message is not from current user */}
                                    {message.sender.toString() !== identity?.getPrincipal().toString() && (
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation(); // Prevent triggering the message modal
                                                replyToMessage(message);
                                            }}
                                            style={{
                                                backgroundColor: theme.colors.accent,
                                                color: theme.colors.primaryText,
                                                border: 'none',
                                                borderRadius: '4px',
                                                padding: '6px 12px',
                                                cursor: 'pointer',
                                                fontSize: '12px'
                                            }}
                                        >
                                            ↩️ Reply
                                        </button>
                                    )}
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
                            backgroundColor: theme.colors.secondaryBg,
                            borderRadius: '8px',
                            padding: '30px',
                            width: '90%',
                            maxWidth: '600px',
                            maxHeight: '80vh',
                            overflow: 'auto',
                            border: `1px solid ${theme.colors.border}`
                        }}>
                            <div style={{ 
                                display: 'flex', 
                                justifyContent: 'space-between', 
                                alignItems: 'center',
                                marginBottom: '20px'
                            }}>
                                <h2 style={{ color: theme.colors.primaryText, margin: 0 }}>
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
                                        color: theme.colors.mutedText,
                                        cursor: 'pointer',
                                        fontSize: '24px'
                                    }}
                                >
                                    ×
                                </button>
                            </div>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                                <div>
                                    <label style={{ color: theme.colors.primaryText, marginBottom: '10px', fontSize: '16px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                                        <span>Recipients:</span>
                                        <span style={{ 
                                            fontSize: '12px', 
                                            color: composeForm.recipients.filter(r => r.trim()).length > effectiveMaxRecipients 
                                                ? theme.colors.error 
                                                : theme.colors.mutedText 
                                        }}>
                                            ({composeForm.recipients.filter(r => r.trim()).length}/{effectiveMaxRecipients})
                                        </span>
                                        {hasPremiumMaxRecipients && (
                                            <span style={{
                                                backgroundColor: 'rgba(255, 215, 0, 0.2)',
                                                color: '#ffd700',
                                                padding: '2px 6px',
                                                borderRadius: '4px',
                                                fontSize: '10px',
                                                fontWeight: 'bold'
                                            }}>
                                                ⭐ PREMIUM
                                            </span>
                                        )}
                                    </label>
                                    {composeForm.recipients.map((recipient, index) => (
                                        <div key={index} style={{ marginBottom: '10px' }}>
                                            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                                                <div style={{ flex: '1', minWidth: '0', maxWidth: composeForm.recipients.length > 1 ? 'calc(100% - 56px)' : '100%' }}>
                                                    <PrincipalInput
                                                        value={recipient}
                                                        onChange={(value) => updateRecipient(index, value)}
                                                        placeholder="Enter principal ID or search by name"
                                                        style={{ 
                                                            marginBottom: '0'
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
                                        disabled={composeForm.recipients.length >= effectiveMaxRecipients}
                                        style={{
                                            padding: '8px 16px',
                                            backgroundColor: composeForm.recipients.length >= effectiveMaxRecipients 
                                                ? theme.colors.mutedText 
                                                : theme.colors.success,
                                            color: 'white',
                                            border: 'none',
                                            borderRadius: '4px',
                                            cursor: composeForm.recipients.length >= effectiveMaxRecipients 
                                                ? 'not-allowed' 
                                                : 'pointer',
                                            fontSize: '14px',
                                            marginBottom: '15px',
                                            opacity: composeForm.recipients.length >= effectiveMaxRecipients ? 0.6 : 1
                                        }}
                                    >
                                        + Add Recipient {composeForm.recipients.length >= effectiveMaxRecipients && `(max ${effectiveMaxRecipients})`}
                                    </button>
                                </div>

                                <div>
                                    <label style={{ color: theme.colors.primaryText, display: 'block', marginBottom: '5px' }}>
                                        Subject:
                                    </label>
                                    <input
                                        type="text"
                                        value={composeForm.subject}
                                        onChange={(e) => setComposeForm(prev => ({ ...prev, subject: e.target.value }))}
                                        placeholder="Enter subject..."
                                        maxLength={effectiveSubjectLimit}
                                        style={{
                                            width: '100%',
                                            padding: '10px',
                                            backgroundColor: theme.colors.tertiaryBg,
                                            border: `1px solid ${composeForm.subject.length > effectiveSubjectLimit ? theme.colors.error : theme.colors.border}`,
                                            borderRadius: '4px',
                                            color: theme.colors.primaryText,
                                            fontSize: '14px'
                                        }}
                                    />
                                    <div style={{ 
                                        fontSize: '12px', 
                                        color: composeForm.subject.length > effectiveSubjectLimit ? theme.colors.error : 
                                               (effectiveSubjectLimit - composeForm.subject.length) < 20 ? theme.colors.warning : theme.colors.mutedText,
                                        marginTop: '5px',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '8px'
                                    }}>
                                        <span>{composeForm.subject.length}/{effectiveSubjectLimit} characters</span>
                                        {hasPremiumSubjectLimit && (
                                            <span style={{
                                                backgroundColor: 'rgba(255, 215, 0, 0.2)',
                                                color: '#ffd700',
                                                padding: '2px 6px',
                                                borderRadius: '4px',
                                                fontSize: '10px',
                                                fontWeight: 'bold'
                                            }}>
                                                ⭐ PREMIUM
                                            </span>
                                        )}
                                    </div>
                                </div>

                                <div>
                                    <label style={{ color: theme.colors.primaryText, display: 'block', marginBottom: '5px' }}>
                                        Message:
                                    </label>
                                    <textarea
                                        value={composeForm.body}
                                        onChange={(e) => setComposeForm(prev => ({ ...prev, body: e.target.value }))}
                                        placeholder="Enter your message..."
                                        maxLength={effectiveBodyLimit}
                                        rows={8}
                                        style={{
                                            width: '100%',
                                            padding: '10px',
                                            backgroundColor: theme.colors.tertiaryBg,
                                            border: `1px solid ${composeForm.body.length > effectiveBodyLimit ? theme.colors.error : theme.colors.border}`,
                                            borderRadius: '4px',
                                            color: theme.colors.primaryText,
                                            fontSize: '14px',
                                            resize: 'vertical'
                                        }}
                                    />
                                    <div style={{ 
                                        fontSize: '12px', 
                                        color: composeForm.body.length > effectiveBodyLimit ? theme.colors.error : 
                                               (effectiveBodyLimit - composeForm.body.length) < 100 ? theme.colors.warning : theme.colors.mutedText,
                                        marginTop: '5px',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '8px'
                                    }}>
                                        <span>{composeForm.body.length}/{effectiveBodyLimit} characters</span>
                                        {hasPremiumBodyLimit && (
                                            <span style={{
                                                backgroundColor: 'rgba(255, 215, 0, 0.2)',
                                                color: '#ffd700',
                                                padding: '2px 6px',
                                                borderRadius: '4px',
                                                fontSize: '10px',
                                                fontWeight: 'bold'
                                            }}>
                                                ⭐ PREMIUM
                                            </span>
                                        )}
                                    </div>
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
                                            color: theme.colors.primaryText,
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
                                            backgroundColor: theme.colors.accent,
                                            color: theme.colors.primaryText,
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
                            backgroundColor: theme.colors.secondaryBg,
                            borderRadius: '8px',
                            padding: '30px',
                            width: '90%',
                            maxWidth: '700px',
                            maxHeight: '80vh',
                            overflow: 'auto',
                            border: `1px solid ${theme.colors.border}`
                        }}>
                            <div style={{ 
                                display: 'flex', 
                                justifyContent: 'space-between', 
                                alignItems: 'center',
                                marginBottom: '20px'
                            }}>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', flex: 1, marginRight: '15px' }}>
                                    <h2 style={{ color: theme.colors.primaryText, margin: 0, fontSize: '20px' }}>
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
                                        onMouseOver={(e) => e.target.style.backgroundColor = `${theme.colors.accent}20`}
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
                                        color: theme.colors.mutedText,
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
                                        border: `1px solid ${theme.colors.border}`,
                                        color: theme.colors.mutedText,
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
                                        backgroundColor: theme.colors.tertiaryBg,
                                        padding: '15px',
                                        borderRadius: '6px',
                                        border: '1px solid #3a3a3a'
                                    }}>
                                        <div style={{ marginBottom: '15px' }}>
                                            <strong style={{ color: theme.colors.mutedText }}>Subject:</strong>
                                            <div style={{ color: theme.colors.primaryText, fontSize: '16px', marginTop: '5px' }}>
                                                {selectedMessage.subject}
                                            </div>
                                        </div>

                                        <div style={{ marginBottom: '15px' }}>
                                            <strong style={{ color: theme.colors.mutedText }}>From:</strong>
                                            <div style={{ marginTop: '8px' }}>
                                                <PrincipalDisplay 
                                                    principal={selectedMessage.sender}
                                                    displayInfo={principalDisplayInfo.get(selectedMessage.sender.toString())}
                                                    showCopyButton={true}
                                                    short={true}
                                                    style={{ color: '#3498db', fontSize: '14px' }}
                                                />
                                            </div>
                                        </div>

                                        <div style={{ marginBottom: '15px' }}>
                                            <strong style={{ color: theme.colors.mutedText }}>To:</strong>
                                            <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                                {selectedMessage.recipients.map((recipient, index) => (
                                                    <PrincipalDisplay 
                                                        key={recipient.toString()}
                                                        principal={recipient}
                                                        displayInfo={principalDisplayInfo.get(recipient.toString())}
                                                        short={true}
                                                        showCopyButton={true}
                                                        style={{ color: '#3498db', fontSize: '14px' }}
                                                    />
                                                ))}
                                            </div>
                                        </div>

                                        <div style={{ marginBottom: '0' }}>
                                            <strong style={{ color: theme.colors.mutedText }}>Date:</strong>
                                            <div style={{ color: theme.colors.primaryText, marginTop: '5px' }}>
                                                {formatDate(selectedMessage.created_at)}
                                            </div>
                                        </div>
                                    </div>
                                )}

                                <div style={{ marginBottom: '20px' }}>
                                    <strong style={{ color: theme.colors.mutedText }}>Message:</strong>
                                    <div style={{ 
                                        color: theme.colors.primaryText, 
                                        marginTop: '10px',
                                        backgroundColor: theme.colors.tertiaryBg,
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
                                borderTop: `1px solid ${theme.colors.border}`,
                                paddingTop: '15px'
                            }}>
                                <button
                                    onClick={() => replyToMessage(selectedMessage)}
                                    style={{
                                        backgroundColor: theme.colors.accent,
                                        color: theme.colors.primaryText,
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
                                        color: theme.colors.primaryText,
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
                                            color: theme.colors.primaryText,
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
                                        color: theme.colors.primaryText,
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
