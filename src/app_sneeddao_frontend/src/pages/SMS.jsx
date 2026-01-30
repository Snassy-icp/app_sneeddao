import React, { useState, useEffect, useRef } from 'react';
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
import { getRelativeTime, getFullDate } from '../utils/DateUtils';
import PrincipalInput from '../components/PrincipalInput';
import EmojiPicker from '../components/EmojiPicker';
import MarkdownButtons from '../components/MarkdownButtons';
import MarkdownBody from '../components/MarkdownBody';
import { usePremiumStatus } from '../hooks/usePremiumStatus';
import { FaEnvelope, FaInbox, FaPaperPlane, FaFolderOpen, FaPen, FaSync, FaLock, FaReply, FaReplyAll, FaTrash, FaExternalLinkAlt, FaTimes, FaPlus, FaStar, FaChevronDown, FaChevronRight, FaUser, FaUsers } from 'react-icons/fa';

const SYSTEM_FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

// Custom CSS for animations
const customStyles = `
@keyframes fadeInUp {
    from {
        opacity: 0;
        transform: translateY(20px);
    }
    to {
        opacity: 1;
        transform: translateY(0);
    }
}

@keyframes float {
    0%, 100% { transform: translateY(0px); }
    50% { transform: translateY(-5px); }
}

@keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.7; }
}

@keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
}

@keyframes newMessageGlow {
    0%, 100% { box-shadow: 0 0 0 0 rgba(59, 130, 246, 0); }
    50% { box-shadow: 0 0 20px 5px rgba(59, 130, 246, 0.3); }
}

.sms-card-animate {
    animation: fadeInUp 0.5s ease-out forwards;
}

.sms-card {
    transition: all 0.3s ease;
}

.sms-card:hover {
    transform: translateY(-2px);
    box-shadow: 0 8px 30px rgba(59, 130, 246, 0.15);
}

.sms-float {
    animation: float 3s ease-in-out infinite;
}

.sms-pulse {
    animation: pulse 2s ease-in-out infinite;
}

.sms-new-glow {
    animation: newMessageGlow 2s ease-in-out 3;
}

.sms-tab {
    transition: all 0.2s ease;
}

.sms-tab:hover {
    transform: translateY(-1px);
}
`;

// Accent colors for this page
const smsPrimary = '#3b82f6'; // Blue
const smsSecondary = '#1d4ed8'; // Darker blue
const smsAccent = '#60a5fa'; // Light blue

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
    const composeBodyRef = useRef(null);
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
            
            // Normalize candid nat values (BigInt) into Numbers for safe arithmetic in the UI.
            // (Otherwise expressions like `effectiveSubjectLimit - subject.length` can throw.)
            setConfig({
                ...regularConfig,
                max_subject_length: Number(regularConfig?.max_subject_length ?? 200),
                max_body_length: Number(regularConfig?.max_body_length ?? 5000),
                max_recipients: Number(regularConfig?.max_recipients ?? 20)
            });
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
            <div className='page-container'>
                <style>{customStyles}</style>
                <Header />
                <main style={{ background: theme.colors.primaryGradient, minHeight: '100vh' }}>
                    {/* Hero Section */}
                    <div style={{
                        background: `linear-gradient(135deg, ${theme.colors.primaryBg} 0%, ${smsPrimary}15 50%, ${smsSecondary}10 100%)`,
                        borderBottom: `1px solid ${theme.colors.border}`,
                        padding: '2rem 1.5rem',
                        position: 'relative',
                        overflow: 'hidden'
                    }}>
                        <div style={{
                            position: 'absolute',
                            top: '-50%',
                            right: '-10%',
                            width: '400px',
                            height: '400px',
                            background: `radial-gradient(circle, ${smsPrimary}20 0%, transparent 70%)`,
                            borderRadius: '50%',
                            pointerEvents: 'none'
                        }} />
                        <div style={{ maxWidth: '900px', margin: '0 auto', position: 'relative', zIndex: 1 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
                                <div className="sms-float" style={{
                                    width: '64px',
                                    height: '64px',
                                    minWidth: '64px',
                                    borderRadius: '16px',
                                    background: `linear-gradient(135deg, ${smsPrimary}, ${smsSecondary})`,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    boxShadow: `0 8px 30px ${smsPrimary}40`
                                }}>
                                    <FaEnvelope size={28} color="white" />
                                </div>
                                <div>
                                    <h1 style={{ color: theme.colors.primaryText, fontSize: '2rem', fontWeight: '700', margin: 0 }}>
                                        Messages
                                    </h1>
                                    <p style={{ color: theme.colors.secondaryText, fontSize: '1rem', margin: '0.35rem 0 0 0' }}>
                                        Private messaging on the Internet Computer
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Login Required */}
                    <div style={{ maxWidth: '900px', margin: '0 auto', padding: '2rem 1.5rem' }}>
                        <div className="sms-card-animate" style={{
                            background: theme.colors.secondaryBg,
                            borderRadius: '20px',
                            padding: '3rem 2rem',
                            textAlign: 'center',
                            border: `1px solid ${theme.colors.border}`,
                            opacity: 0,
                            animationDelay: '0.1s'
                        }}>
                            <div className="sms-float" style={{
                                width: '80px',
                                height: '80px',
                                margin: '0 auto 1.5rem',
                                borderRadius: '50%',
                                background: `linear-gradient(135deg, ${smsPrimary}, ${smsSecondary})`,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                boxShadow: `0 8px 30px ${smsPrimary}40`
                            }}>
                                <FaLock size={32} color="white" />
                            </div>
                            <h2 style={{ color: theme.colors.primaryText, fontSize: '1.5rem', marginBottom: '1rem', fontWeight: '600' }}>
                                Connect to View Messages
                            </h2>
                            <p style={{ color: theme.colors.secondaryText, maxWidth: '400px', margin: '0 auto', lineHeight: '1.6' }}>
                                Connect your wallet to access your private messages and send messages to other users.
                            </p>
                        </div>
                    </div>
                </main>
            </div>
        );
    }

    // Count messages for tabs
    const receivedCount = messages.filter(m => m.sender.toString() !== identity?.getPrincipal().toString()).length;
    const sentCount = messages.filter(m => m.sender.toString() === identity?.getPrincipal().toString()).length;

    return (
        <div className='page-container'>
            <style>{customStyles}</style>
            <Header />
            <main style={{ background: theme.colors.primaryGradient, minHeight: '100vh', fontFamily: SYSTEM_FONT }}>
                {/* Hero Section */}
                <div style={{
                    background: `linear-gradient(135deg, ${theme.colors.primaryBg} 0%, ${smsPrimary}15 50%, ${smsSecondary}10 100%)`,
                    borderBottom: `1px solid ${theme.colors.border}`,
                    padding: '2rem 1.5rem',
                    position: 'relative',
                    overflow: 'hidden'
                }}>
                    {/* Background decorations */}
                    <div style={{
                        position: 'absolute',
                        top: '-50%',
                        right: '-10%',
                        width: '400px',
                        height: '400px',
                        background: `radial-gradient(circle, ${smsPrimary}20 0%, transparent 70%)`,
                        borderRadius: '50%',
                        pointerEvents: 'none'
                    }} />
                    <div style={{
                        position: 'absolute',
                        bottom: '-30%',
                        left: '-5%',
                        width: '300px',
                        height: '300px',
                        background: `radial-gradient(circle, ${smsSecondary}15 0%, transparent 70%)`,
                        borderRadius: '50%',
                        pointerEvents: 'none'
                    }} />
                    
                    <div style={{ maxWidth: '900px', margin: '0 auto', position: 'relative', zIndex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem', marginBottom: '1rem' }}>
                            <div className="sms-float" style={{
                                width: '64px',
                                height: '64px',
                                minWidth: '64px',
                                maxWidth: '64px',
                                flexShrink: 0,
                                borderRadius: '16px',
                                background: `linear-gradient(135deg, ${smsPrimary}, ${smsSecondary})`,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                boxShadow: `0 8px 30px ${smsPrimary}40`
                            }}>
                                <FaEnvelope size={28} color="white" />
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <h1 style={{ color: theme.colors.primaryText, fontSize: '2rem', fontWeight: '700', margin: 0, lineHeight: '1.2' }}>
                                    Messages
                                </h1>
                                <p style={{ color: theme.colors.secondaryText, fontSize: '1rem', margin: '0.35rem 0 0 0' }}>
                                    Private messaging on the Internet Computer
                                </p>
                            </div>
                        </div>
                        
                        {/* Quick Stats */}
                        <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: theme.colors.secondaryText, fontSize: '0.9rem' }}>
                                <FaInbox size={14} style={{ color: smsPrimary }} />
                                <span><strong style={{ color: smsPrimary }}>{receivedCount}</strong> received</span>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: theme.colors.secondaryText, fontSize: '0.9rem' }}>
                                <FaPaperPlane size={14} style={{ color: theme.colors.success }} />
                                <span><strong style={{ color: theme.colors.success }}>{sentCount}</strong> sent</span>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Main Content */}
                <div style={{ maxWidth: '900px', margin: '0 auto', padding: '2rem 1.5rem' }}>
                    {/* Error Display */}
                    {error && (
                        <div style={{ 
                            background: `linear-gradient(135deg, ${theme.colors.error}15, ${theme.colors.error}08)`,
                            border: `1px solid ${theme.colors.error}30`,
                            borderRadius: '12px',
                            padding: '1rem 1.25rem',
                            marginBottom: '1.5rem',
                            color: theme.colors.error,
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.75rem'
                        }}>
                            <FaTimes size={16} />
                            {error}
                        </div>
                    )}

                    {/* Tab Buttons + Compose */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
                        <div style={{
                            display: 'flex',
                            gap: '0.5rem',
                            background: theme.colors.secondaryBg,
                            padding: '0.5rem',
                            borderRadius: '14px',
                            border: `1px solid ${theme.colors.border}`,
                            flexWrap: 'wrap',
                            flex: '1 1 auto'
                        }}>
                            {[
                                { key: 'received', label: 'Inbox', icon: <FaInbox size={14} />, color: smsPrimary },
                                { key: 'sent', label: 'Sent', icon: <FaPaperPlane size={14} />, color: theme.colors.success },
                                { key: 'all', label: 'All', icon: <FaFolderOpen size={14} />, color: smsAccent }
                            ].map(tab => (
                                <button
                                    key={tab.key}
                                    onClick={() => setSelectedTab(tab.key)}
                                    className="sms-tab"
                                    style={{
                                        flex: '1 1 auto',
                                        minWidth: '80px',
                                        background: selectedTab === tab.key 
                                            ? `linear-gradient(135deg, ${tab.color}, ${tab.color}cc)` 
                                            : 'transparent',
                                        color: selectedTab === tab.key ? 'white' : theme.colors.secondaryText,
                                        border: 'none',
                                        borderRadius: '10px',
                                        padding: '0.65rem 0.75rem',
                                        cursor: 'pointer',
                                        fontSize: '0.9rem',
                                        fontWeight: '600',
                                        fontFamily: SYSTEM_FONT,
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        gap: '0.4rem',
                                        boxShadow: selectedTab === tab.key ? `0 4px 15px ${tab.color}40` : 'none'
                                    }}
                                >
                                    {tab.icon}
                                    {tab.label}
                                </button>
                            ))}
                        </div>
                        
                        {/* Compose Button */}
                        <button
                            onClick={() => setShowComposeModal(true)}
                            style={{
                                background: `linear-gradient(135deg, ${smsPrimary}, ${smsSecondary})`,
                                color: 'white',
                                border: 'none',
                                borderRadius: '12px',
                                padding: '0.75rem 1.25rem',
                                cursor: 'pointer',
                                fontSize: '0.9rem',
                                fontWeight: '600',
                                fontFamily: SYSTEM_FONT,
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.5rem',
                                boxShadow: `0 4px 15px ${smsPrimary}40`,
                                flexShrink: 0,
                                transition: 'all 0.2s ease'
                            }}
                        >
                            <FaPen size={14} />
                            Compose
                        </button>
                    </div>

                    {/* Refresh Button */}
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '1rem' }}>
                        <button 
                            onClick={fetchMessages}
                            disabled={loading}
                            style={{
                                background: theme.colors.tertiaryBg,
                                color: theme.colors.primaryText,
                                border: `1px solid ${theme.colors.border}`,
                                borderRadius: '10px',
                                padding: '0.6rem 1rem',
                                cursor: loading ? 'not-allowed' : 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.5rem',
                                fontSize: '0.85rem',
                                fontWeight: '500',
                                fontFamily: SYSTEM_FONT,
                                opacity: loading ? 0.6 : 1,
                                transition: 'all 0.2s ease'
                            }}
                        >
                            <FaSync size={12} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
                            Refresh
                        </button>
                    </div>

                    {/* Messages List */}
                    {loading ? (
                        <div style={{
                            background: theme.colors.secondaryBg,
                            borderRadius: '16px',
                            padding: '4rem 2rem',
                            textAlign: 'center',
                            border: `1px solid ${theme.colors.border}`
                        }}>
                            <div className="sms-pulse" style={{
                                width: '60px',
                                height: '60px',
                                borderRadius: '50%',
                                background: `linear-gradient(135deg, ${smsPrimary}, ${smsSecondary})`,
                                margin: '0 auto 1.5rem',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center'
                            }}>
                                <FaEnvelope size={24} color="white" />
                            </div>
                            <p style={{ color: theme.colors.secondaryText, fontSize: '1.1rem' }}>
                                Loading messages...
                            </p>
                        </div>
                    ) : messages.length === 0 ? (
                        <div className="sms-card-animate" style={{
                            background: theme.colors.secondaryBg,
                            borderRadius: '16px',
                            padding: '3rem 2rem',
                            textAlign: 'center',
                            border: `1px solid ${theme.colors.border}`,
                            opacity: 0,
                            animationDelay: '0.1s'
                        }}>
                            <div className="sms-float" style={{
                                width: '60px',
                                height: '60px',
                                borderRadius: '50%',
                                background: `linear-gradient(135deg, ${smsPrimary}30, ${smsPrimary}20)`,
                                margin: '0 auto 1rem',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                color: smsPrimary
                            }}>
                                <FaInbox size={24} />
                            </div>
                            <h3 style={{ color: theme.colors.primaryText, marginBottom: '0.75rem', fontWeight: '600' }}>
                                No Messages Yet
                            </h3>
                            <p style={{ color: theme.colors.secondaryText, maxWidth: '400px', margin: '0 auto 1.5rem', lineHeight: '1.6' }}>
                                Start a conversation by sending your first message.
                            </p>
                            <button
                                onClick={() => setShowComposeModal(true)}
                                style={{
                                    background: `linear-gradient(135deg, ${smsPrimary}, ${smsSecondary})`,
                                    color: 'white',
                                    border: 'none',
                                    borderRadius: '10px',
                                    padding: '0.75rem 1.5rem',
                                    cursor: 'pointer',
                                    fontSize: '0.9rem',
                                    fontWeight: '600',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '0.5rem',
                                    boxShadow: `0 4px 15px ${smsPrimary}40`
                                }}
                            >
                                <FaPen size={14} />
                                Send your first message
                            </button>
                        </div>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                            {messages.map((message, index) => {
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
                                        className={`sms-card sms-card-animate ${isNew ? 'sms-new-glow' : ''}`}
                                        onClick={() => {
                                            setSelectedMessage(message);
                                            setShowMessageModal(true);
                                        }}
                                        style={{
                                            background: isNew ? `${smsPrimary}10` : theme.colors.secondaryBg,
                                            borderRadius: '14px',
                                            padding: '1.25rem',
                                            border: isNew ? `2px solid ${smsPrimary}` : `1px solid ${theme.colors.border}`,
                                            cursor: 'pointer',
                                            opacity: 0,
                                            animationDelay: `${index * 0.05}s`
                                        }}
                                    >
                                        {/* Header */}
                                        <div style={{ 
                                            display: 'flex', 
                                            justifyContent: 'space-between', 
                                            alignItems: 'flex-start',
                                            marginBottom: '0.75rem',
                                            flexWrap: 'wrap',
                                            gap: '0.5rem'
                                        }}>
                                            <div style={{ flex: 1, minWidth: 0 }}>
                                                <div style={{ 
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '0.75rem',
                                                    marginBottom: '0.5rem'
                                                }}>
                                                    <span style={{ 
                                                        color: theme.colors.primaryText, 
                                                        fontSize: '1.05rem', 
                                                        fontWeight: '600',
                                                        fontFamily: SYSTEM_FONT,
                                                        lineHeight: '1.4',
                                                        overflow: 'hidden',
                                                        textOverflow: 'ellipsis',
                                                        whiteSpace: 'nowrap'
                                                    }}>
                                                        {message.subject}
                                                    </span>
                                                    {isNew && (
                                                        <span style={{
                                                            background: `${smsPrimary}20`,
                                                            color: smsPrimary,
                                                            padding: '0.15rem 0.5rem',
                                                            borderRadius: '4px',
                                                            fontSize: '0.7rem',
                                                            fontWeight: '600',
                                                            textTransform: 'uppercase',
                                                            flexShrink: 0
                                                        }}>
                                                            New
                                                        </span>
                                                    )}
                                                </div>
                                                <div style={{ 
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '0.5rem',
                                                    flexWrap: 'wrap',
                                                    fontSize: '0.85rem',
                                                    color: theme.colors.mutedText
                                                }}>
                                                    <span style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                                                        <FaUser size={10} />
                                                        From:
                                                    </span>
                                                    <PrincipalDisplay 
                                                        principal={message.sender}
                                                        displayInfo={principalDisplayInfo.get(message.sender.toString())}
                                                        showCopyButton={false}
                                                        short={true}
                                                        style={{ color: smsPrimary, fontSize: '0.85rem' }}
                                                    />
                                                </div>
                                                {message.recipients.length > 1 && (
                                                    <div style={{ 
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: '0.35rem',
                                                        fontSize: '0.8rem',
                                                        color: theme.colors.mutedText,
                                                        marginTop: '0.25rem'
                                                    }}>
                                                        <FaUsers size={10} />
                                                        +{message.recipients.length - 1} recipients
                                                    </div>
                                                )}
                                            </div>
                                            <span 
                                                style={{ 
                                                    color: theme.colors.mutedText, 
                                                    fontSize: '0.8rem',
                                                    fontFamily: SYSTEM_FONT,
                                                    whiteSpace: 'nowrap',
                                                    flexShrink: 0
                                                }}
                                                title={getFullDate(message.created_at)}
                                            >
                                                {getRelativeTime(message.created_at)}
                                            </span>
                                        </div>
                                        
                                        {/* Body Preview */}
                                        <div style={{ 
                                            color: theme.colors.secondaryText, 
                                            fontSize: '0.9rem',
                                            fontFamily: SYSTEM_FONT,
                                            overflow: 'hidden',
                                            maxHeight: '50px',
                                            lineHeight: '1.5',
                                            marginBottom: '0.75rem'
                                        }}>
                                            <MarkdownBody 
                                                text={message.body.length > 120 ? message.body.substring(0, 120) + '...' : message.body}
                                                style={{ fontSize: '0.9rem', lineHeight: '1.5' }}
                                            />
                                        </div>
                                        
                                        {/* Action buttons */}
                                        <div style={{ 
                                            display: 'flex', 
                                            gap: '0.5rem',
                                            alignItems: 'center',
                                            borderTop: `1px solid ${theme.colors.border}`,
                                            paddingTop: '0.75rem'
                                        }}>
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    navigate(`/msg/${message.id}`);
                                                }}
                                                style={{
                                                    background: `${smsPrimary}15`,
                                                    color: smsPrimary,
                                                    border: 'none',
                                                    borderRadius: '8px',
                                                    padding: '0.5rem 0.75rem',
                                                    cursor: 'pointer',
                                                    fontSize: '0.8rem',
                                                    fontFamily: SYSTEM_FONT,
                                                    fontWeight: '500',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '0.35rem',
                                                    transition: 'all 0.2s ease'
                                                }}
                                            >
                                                <FaExternalLinkAlt size={10} />
                                                Thread
                                            </button>
                                            
                                            {message.sender.toString() !== identity?.getPrincipal().toString() && (
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        replyToMessage(message);
                                                    }}
                                                    style={{
                                                        background: `${theme.colors.success}15`,
                                                        color: theme.colors.success,
                                                        border: 'none',
                                                        borderRadius: '8px',
                                                        padding: '0.5rem 0.75rem',
                                                        cursor: 'pointer',
                                                        fontSize: '0.8rem',
                                                        fontFamily: SYSTEM_FONT,
                                                        fontWeight: '500',
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: '0.35rem',
                                                        transition: 'all 0.2s ease'
                                                    }}
                                                >
                                                    <FaReply size={10} />
                                                    Reply
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>

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
                            padding: '24px',
                            width: '90%',
                            maxWidth: '600px',
                            maxHeight: '80vh',
                            overflow: 'auto',
                            border: `1px solid ${theme.colors.border}`,
                            fontFamily: SYSTEM_FONT,
                            fontSize: '14px'
                        }}>
                            <div style={{ 
                                display: 'flex', 
                                justifyContent: 'space-between', 
                                alignItems: 'center',
                                marginBottom: '20px'
                            }}>
                                <h2 style={{ color: theme.colors.primaryText, margin: 0, fontSize: '18px', fontFamily: SYSTEM_FONT }}>
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
                                    <label style={{ color: theme.colors.primaryText, marginBottom: '10px', fontSize: '13px', fontFamily: SYSTEM_FONT, display: 'flex', alignItems: 'center', gap: '10px' }}>
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
                                    <label style={{ color: theme.colors.primaryText, display: 'block', marginBottom: '5px', fontSize: '13px', fontFamily: SYSTEM_FONT }}>
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
                                            fontSize: '13px',
                                            fontFamily: SYSTEM_FONT
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
                                    <label style={{ color: theme.colors.primaryText, display: 'block', marginBottom: '5px', fontSize: '13px', fontFamily: SYSTEM_FONT }}>
                                        Message:
                                    </label>
                                    <EmojiPicker
                                        targetRef={composeBodyRef}
                                        getValue={() => composeForm.body}
                                        setValue={(v) => setComposeForm(prev => ({ ...prev, body: v }))}
                                        ariaLabel="Insert emoji into message body"
                                        rightSlot={
                                            <MarkdownButtons
                                                targetRef={composeBodyRef}
                                                getValue={() => composeForm.body}
                                                setValue={(v) => setComposeForm(prev => ({ ...prev, body: v }))}
                                            />
                                        }
                                    />
                                    <textarea
                                        value={composeForm.body}
                                        onChange={(e) => setComposeForm(prev => ({ ...prev, body: e.target.value }))}
                                        placeholder="Enter your message..."
                                        maxLength={effectiveBodyLimit}
                                        rows={8}
                                        ref={composeBodyRef}
                                        style={{
                                            width: '100%',
                                            padding: '10px',
                                            backgroundColor: theme.colors.tertiaryBg,
                                            border: `1px solid ${composeForm.body.length > effectiveBodyLimit ? theme.colors.error : theme.colors.border}`,
                                            borderRadius: '4px',
                                            color: theme.colors.primaryText,
                                            fontSize: '13px',
                                            fontFamily: SYSTEM_FONT,
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
                            padding: '24px',
                            width: '90%',
                            maxWidth: '700px',
                            maxHeight: '80vh',
                            overflow: 'auto',
                            border: `1px solid ${theme.colors.border}`,
                            fontFamily: SYSTEM_FONT,
                            fontSize: '14px'
                        }}>
                            <div style={{ 
                                display: 'flex', 
                                justifyContent: 'space-between', 
                                alignItems: 'center',
                                marginBottom: '20px'
                            }}>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', flex: 1, marginRight: '15px' }}>
                                    <h2 style={{ color: theme.colors.primaryText, margin: 0, fontSize: '16px', fontFamily: SYSTEM_FONT }}>
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
                                    <MarkdownBody
                                        text={selectedMessage.body}
                                        style={{
                                            color: theme.colors.primaryText,
                                            marginTop: '10px',
                                            backgroundColor: theme.colors.tertiaryBg,
                                            padding: '15px',
                                            borderRadius: '6px'
                                        }}
                                    />
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
        </div>
    );
};

export default SMS;
