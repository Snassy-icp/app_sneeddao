import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import Header from '../components/Header';
import { createActor as createSmsActor } from '../../../declarations/sneed_sms';
import { Principal } from '@dfinity/principal';
import { PrincipalDisplay, getPrincipalDisplayInfoFromContext } from '../utils/PrincipalUtils';
import { useNaming } from '../NamingContext';

const Message = () => {
    const { id } = useParams();
    const navigate = useNavigate();
    const { identity, isAuthenticated } = useAuth();
    const { principalNames, principalNicknames } = useNaming();
    
    const [message, setMessage] = useState(null);
    const [parentMessage, setParentMessage] = useState(null);
    const [replies, setReplies] = useState([]);
    const [loading, setLoading] = useState(true);
    const [loadingParent, setLoadingParent] = useState(false);
    const [loadingReplies, setLoadingReplies] = useState(false);
    const [error, setError] = useState(null);

    // Create SMS actor
    const getSmsActor = () => {
        if (!identity) return null;
        const canisterId = process.env.CANISTER_ID_SNEED_SMS || 'v33jy-4qaaa-aaaad-absna-cai';
        return createSmsActor(canisterId, {
            agentOptions: { identity }
        });
    };

    // Format timestamp
    const formatTimestamp = (timestamp) => {
        const date = new Date(Number(timestamp) / 1000000);
        return date.toLocaleString();
    };

    // Fetch the main message
    const fetchMessage = async () => {
        console.log('fetchMessage called with id:', id, 'identity:', identity);
        if (!identity || !id) {
            console.log('Missing identity or id, returning');
            return;
        }
        
        setLoading(true);
        setError(null);
        
        try {
            const actor = getSmsActor();
            console.log('SMS actor created:', actor);
            if (!actor) {
                console.log('No actor, returning');
                return;
            }

            console.log('Calling get_message with id:', BigInt(id));
            // Fetch the specific message
            const messageResult = await actor.get_message(BigInt(id));
            console.log('Message result:', messageResult);
            
            // get_message returns ?MessageResponse (optional), not Result
            if (messageResult === null || messageResult === undefined || messageResult.length === 0) {
                const errorMsg = `Message not found or access denied`;
                console.log('Error: message not found or no access');
                setError(errorMsg);
                return;
            }

            // If it's an array, get the first message, otherwise use directly
            const targetMessage = Array.isArray(messageResult) ? messageResult[0] : messageResult;
            console.log('Successfully loaded message:', targetMessage);
            setMessage(targetMessage);

        } catch (err) {
            console.error('Error fetching message:', err);
            setError('Failed to load message: ' + (err.message || err.toString()));
        } finally {
            setLoading(false);
        }
    };

    // Load parent message (if current message is a reply)
    const loadParentMessage = async () => {
        if (!message || !message.reply_to || message.reply_to.length === 0) return;
        
        setLoadingParent(true);
        try {
            const actor = getSmsActor();
            if (!actor) return;

            const parentId = message.reply_to[0];
            console.log('Loading parent message with ID:', parentId);
            const parentResult = await actor.get_message(BigInt(parentId));
            console.log('Parent message result:', parentResult);
            
            // get_message returns ?MessageResponse (optional), not Result
            if (parentResult === null || parentResult === undefined) {
                console.log('Parent message not found or no access');
                return;
            }

            // If it's an array, get the first message, otherwise use directly
            const parentMsg = Array.isArray(parentResult) ? parentResult[0] : parentResult;
            console.log('Setting parent message:', parentMsg);
            setParentMessage(parentMsg);
        } catch (err) {
            console.error('Error loading parent message:', err);
        } finally {
            setLoadingParent(false);
        }
    };

    // Load replies to current message
    const loadReplies = async () => {
        if (!message) return;
        
        setLoadingReplies(true);
        try {
            const actor = getSmsActor();
            if (!actor) return;

            console.log('Loading all messages to find replies...');
            const allMessages = await actor.get_all_messages();
            console.log('All messages result:', allMessages);
            
            // Find messages that reply to the current message
            const messageReplies = allMessages.filter(msg => 
                msg.reply_to && 
                msg.reply_to.length > 0 && 
                Number(msg.reply_to[0]) === Number(message.id)
            );
            
            console.log('Found replies:', messageReplies);
            
            // Sort by creation time
            messageReplies.sort((a, b) => Number(a.created_at) - Number(b.created_at));
            setReplies(messageReplies);
        } catch (err) {
            console.error('Error loading replies:', err);
        } finally {
            setLoadingReplies(false);
        }
    };

    useEffect(() => {
        console.log('useEffect triggered with isAuthenticated:', isAuthenticated, 'id:', id);
        if (isAuthenticated) {
            fetchMessage();
        }
    }, [isAuthenticated, id]);

    // Debug logging
    console.log('Component state - loading:', loading, 'error:', error, 'message:', message, 'isAuthenticated:', isAuthenticated);

    if (!isAuthenticated) {
        return (
            <div className='page-container'>
                <Header />
                <div style={{ padding: '20px', textAlign: 'center' }}>
                    <h2>Please connect your wallet to view messages</h2>
                </div>
            </div>
        );
    }

    if (loading) {
        return (
            <div className='page-container'>
                <Header />
                <div style={{ padding: '20px', textAlign: 'center' }}>
                    <div>Loading message...</div>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className='page-container'>
                <Header />
                <div style={{ padding: '20px' }}>
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
                    <button 
                        onClick={() => navigate('/sms')}
                        style={{
                            backgroundColor: '#3498db',
                            color: '#ffffff',
                            border: 'none',
                            borderRadius: '6px',
                            padding: '10px 20px',
                            cursor: 'pointer'
                        }}
                    >
                        ← Back to Messages
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className='page-container'>
            <Header />
            <div style={{ padding: '20px', maxWidth: '800px', margin: '0 auto' }}>
                {/* Navigation */}
                <div style={{ marginBottom: '20px' }}>
                    <button 
                        onClick={() => navigate('/sms')}
                        style={{
                            backgroundColor: '#3498db',
                            color: '#ffffff',
                            border: 'none',
                            borderRadius: '6px',
                            padding: '8px 16px',
                            cursor: 'pointer',
                            marginRight: '10px'
                        }}
                    >
                        ← Back to Messages
                    </button>
                    <span style={{ color: '#888' }}>Message Chain</span>
                </div>

                {/* Parent Message (if loaded) */}
                {parentMessage && (
                    <div style={{ marginBottom: '20px' }}>
                        <h3 style={{ color: '#888', marginBottom: '10px', fontSize: '16px' }}>
                            ↩️ Parent Message
                        </h3>
                        <div
                            style={{
                                backgroundColor: '#2a2a2a',
                                border: '1px solid #3a3a3a',
                                borderRadius: '8px',
                                padding: '20px',
                                cursor: 'pointer'
                            }}
                            onClick={() => navigate(`/msg/${parentMessage.id}`)}
                        >
                            <div style={{ 
                                display: 'flex', 
                                justifyContent: 'space-between', 
                                alignItems: 'flex-start',
                                marginBottom: '15px',
                                flexWrap: 'wrap',
                                gap: '10px'
                            }}>
                                <div style={{ flex: 1, minWidth: '200px' }}>
                                    <div style={{ marginBottom: '8px' }}>
                                        <span style={{ color: '#888', fontSize: '14px' }}>From: </span>
                                        <PrincipalDisplay 
                                            principal={parentMessage.sender} 
                                            maxLength={20}
                                            style={{ color: '#ffffff' }}
                                        />
                                    </div>
                                </div>
                                <div style={{ color: '#888', fontSize: '12px', textAlign: 'right' }}>
                                    <div>#{parentMessage.id.toString()}</div>
                                    <div>{formatTimestamp(parentMessage.created_at)}</div>
                                </div>
                            </div>
                            <h4 style={{ color: '#ffffff', margin: '0 0 10px 0', fontSize: '16px' }}>
                                {parentMessage.subject}
                            </h4>
                            <div style={{ 
                                color: '#cccccc', 
                                lineHeight: '1.6',
                                whiteSpace: 'pre-wrap',
                                wordBreak: 'break-word'
                            }}>
                                {parentMessage.body}
                            </div>
                        </div>
                    </div>
                )}

                {/* Current Message */}
                {message && (
                    <div style={{ marginBottom: '20px' }}>
                        <div
                            style={{
                                backgroundColor: 'rgba(52, 152, 219, 0.1)',
                                border: '2px solid #3498db',
                                borderRadius: '8px',
                                padding: '20px',
                                position: 'relative'
                            }}
                        >
                            <div style={{
                                position: 'absolute',
                                top: '-10px',
                                left: '20px',
                                backgroundColor: '#3498db',
                                color: 'white',
                                padding: '4px 12px',
                                borderRadius: '12px',
                                fontSize: '12px',
                                fontWeight: 'bold'
                            }}>
                                Current Message
                            </div>

                            {/* Message Header */}
                            <div style={{ 
                                display: 'flex', 
                                justifyContent: 'space-between', 
                                alignItems: 'flex-start',
                                marginBottom: '15px',
                                flexWrap: 'wrap',
                                gap: '10px'
                            }}>
                                <div style={{ flex: 1, minWidth: '200px' }}>
                                    <div style={{ marginBottom: '8px' }}>
                                        <span style={{ color: '#888', fontSize: '14px' }}>From: </span>
                                        <PrincipalDisplay 
                                            principal={message.sender} 
                                            maxLength={20}
                                            style={{ color: '#ffffff' }}
                                        />
                                    </div>
                                    <div style={{ marginBottom: '8px' }}>
                                        <span style={{ color: '#888', fontSize: '14px' }}>To: </span>
                                        {message.recipients.map((recipient, idx) => (
                                            <span key={idx}>
                                                <PrincipalDisplay 
                                                    principal={recipient} 
                                                    maxLength={20}
                                                    style={{ color: '#ffffff' }}
                                                />
                                                {idx < message.recipients.length - 1 && ', '}
                                            </span>
                                        ))}
                                    </div>
                                    {message.reply_to && message.reply_to.length > 0 && (
                                        <div style={{ marginBottom: '8px' }}>
                                            <span style={{ color: '#888', fontSize: '14px' }}>
                                                ↩️ Reply to message #{message.reply_to[0].toString()}
                                            </span>
                                        </div>
                                    )}
                                </div>
                                <div style={{ color: '#888', fontSize: '12px', textAlign: 'right' }}>
                                    <div>#{message.id.toString()}</div>
                                    <div>{formatTimestamp(message.created_at)}</div>
                                </div>
                            </div>

                            {/* Message Content */}
                            <div style={{ marginBottom: '15px' }}>
                                <h3 style={{ color: '#ffffff', margin: '0 0 10px 0', fontSize: '18px' }}>
                                    {message.subject}
                                </h3>
                                <div style={{ 
                                    color: '#cccccc', 
                                    lineHeight: '1.6',
                                    whiteSpace: 'pre-wrap',
                                    wordBreak: 'break-word'
                                }}>
                                    {message.body}
                                </div>
                            </div>

                            {/* Navigation and Action buttons */}
                            <div style={{ 
                                display: 'flex', 
                                gap: '10px', 
                                borderTop: '1px solid #3a3a3a', 
                                paddingTop: '15px',
                                flexWrap: 'wrap'
                            }}>
                                {/* Load Parent Button */}
                                {message.reply_to && message.reply_to.length > 0 && !parentMessage && (
                                    <button
                                        onClick={loadParentMessage}
                                        disabled={loadingParent}
                                        style={{
                                            backgroundColor: '#9b59b6',
                                            color: '#ffffff',
                                            border: 'none',
                                            borderRadius: '6px',
                                            padding: '8px 16px',
                                            cursor: loadingParent ? 'not-allowed' : 'pointer',
                                            opacity: loadingParent ? 0.6 : 1
                                        }}
                                    >
                                        {loadingParent ? '⏳ Loading...' : '⬆️ Load Parent'}
                                    </button>
                                )}

                                {/* Load Replies Button */}
                                {replies.length === 0 && (
                                    <button
                                        onClick={loadReplies}
                                        disabled={loadingReplies}
                                        style={{
                                            backgroundColor: '#e67e22',
                                            color: '#ffffff',
                                            border: 'none',
                                            borderRadius: '6px',
                                            padding: '8px 16px',
                                            cursor: loadingReplies ? 'not-allowed' : 'pointer',
                                            opacity: loadingReplies ? 0.6 : 1
                                        }}
                                    >
                                        {loadingReplies ? '⏳ Loading...' : '⬇️ Load Replies'}
                                    </button>
                                )}

                                {/* Reply Button */}
                                <button
                                    onClick={() => {
                                        navigate(`/sms?reply=${message.id}`);
                                    }}
                                    style={{
                                        backgroundColor: '#3498db',
                                        color: '#ffffff',
                                        border: 'none',
                                        borderRadius: '6px',
                                        padding: '8px 16px',
                                        cursor: 'pointer'
                                    }}
                                >
                                    ↩️ Reply
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* Replies (if loaded) */}
                {replies.length > 0 && (
                    <div>
                        <h3 style={{ color: '#888', marginBottom: '10px', fontSize: '16px' }}>
                            ⬇️ Replies ({replies.length})
                        </h3>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                            {replies.map((reply) => (
                                <div
                                    key={reply.id}
                                    style={{
                                        backgroundColor: '#2a2a2a',
                                        border: '1px solid #3a3a3a',
                                        borderRadius: '8px',
                                        padding: '20px',
                                        cursor: 'pointer'
                                    }}
                                    onClick={() => navigate(`/msg/${reply.id}`)}
                                >
                                    <div style={{ 
                                        display: 'flex', 
                                        justifyContent: 'space-between', 
                                        alignItems: 'flex-start',
                                        marginBottom: '15px',
                                        flexWrap: 'wrap',
                                        gap: '10px'
                                    }}>
                                        <div style={{ flex: 1, minWidth: '200px' }}>
                                            <div style={{ marginBottom: '8px' }}>
                                                <span style={{ color: '#888', fontSize: '14px' }}>From: </span>
                                                <PrincipalDisplay 
                                                    principal={reply.sender} 
                                                    maxLength={20}
                                                    style={{ color: '#ffffff' }}
                                                />
                                            </div>
                                        </div>
                                        <div style={{ color: '#888', fontSize: '12px', textAlign: 'right' }}>
                                            <div>#{reply.id.toString()}</div>
                                            <div>{formatTimestamp(reply.created_at)}</div>
                                        </div>
                                    </div>
                                    <h4 style={{ color: '#ffffff', margin: '0 0 10px 0', fontSize: '16px' }}>
                                        {reply.subject}
                                    </h4>
                                    <div style={{ 
                                        color: '#cccccc', 
                                        lineHeight: '1.6',
                                        whiteSpace: 'pre-wrap',
                                        wordBreak: 'break-word'
                                    }}>
                                        {reply.body}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default Message;
