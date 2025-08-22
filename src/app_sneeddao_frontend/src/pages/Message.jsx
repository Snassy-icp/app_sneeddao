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
    const [messageChain, setMessageChain] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [showReplyModal, setShowReplyModal] = useState(false);
    const [replyForm, setReplyForm] = useState({
        recipients: [{ value: '', isValid: false, name: '', error: '' }],
        subject: '',
        body: ''
    });
    const [submitting, setSubmitting] = useState(false);

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

    // Fetch message and build chain
    const fetchMessageAndChain = async () => {
        if (!identity || !id) return;
        
        setLoading(true);
        setError(null);
        
        try {
            const actor = getSmsActor();
            if (!actor) return;

            // Fetch the specific message
            const messageResult = await actor.get_message(BigInt(id));
            
            if ('err' in messageResult) {
                setError(`Message not found: ${messageResult.err.NotFound || messageResult.err.Unauthorized || 'Access denied'}`);
                return;
            }

            const targetMessage = messageResult.ok;
            setMessage(targetMessage);

            // Build message chain by following reply_to links
            await buildMessageChain(targetMessage);

        } catch (err) {
            console.error('Error fetching message:', err);
            setError('Failed to load message: ' + (err.message || err.toString()));
        } finally {
            setLoading(false);
        }
    };

    // Build the complete message chain
    const buildMessageChain = async (targetMessage) => {
        const actor = getSmsActor();
        if (!actor) return;

        const chain = [];
        const visited = new Set();
        
        // Start with the target message and work backwards through reply_to
        let currentMessage = targetMessage;
        
        // Add the current message to chain
        chain.unshift(currentMessage);
        visited.add(Number(currentMessage.id));
        
        // Follow reply_to chain backwards
        while (currentMessage.reply_to && currentMessage.reply_to.length > 0) {
            try {
                const parentId = currentMessage.reply_to[0];
                if (visited.has(Number(parentId))) break; // Avoid cycles
                
                const parentResult = await actor.get_message(BigInt(parentId));
                if ('ok' in parentResult) {
                    currentMessage = parentResult.ok;
                    chain.unshift(currentMessage);
                    visited.add(Number(currentMessage.id));
                } else {
                    break; // Parent not accessible
                }
            } catch (err) {
                break; // Error fetching parent
            }
        }

        // Now find all replies to messages in our chain
        try {
            const allMessagesResult = await actor.get_messages();
            if ('ok' in allMessagesResult) {
                const allMessages = allMessagesResult.ok;
                
                // Find messages that reply to any message in our chain
                const chainIds = new Set(chain.map(msg => Number(msg.id)));
                const replies = allMessages.filter(msg => 
                    msg.reply_to && 
                    msg.reply_to.length > 0 && 
                    chainIds.has(Number(msg.reply_to[0])) &&
                    !visited.has(Number(msg.id))
                );
                
                // Add replies in chronological order
                replies.sort((a, b) => Number(a.created_at) - Number(b.created_at));
                chain.push(...replies);
            }
        } catch (err) {
            console.log('Could not fetch full message chain:', err);
        }

        setMessageChain(chain);
    };

    useEffect(() => {
        fetchMessageAndChain();
    }, [identity, id]);

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

                {/* Message Chain */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                    {messageChain.map((msg, index) => {
                        const isTargetMessage = Number(msg.id) === Number(id);
                        return (
                            <div
                                key={msg.id}
                                style={{
                                    backgroundColor: isTargetMessage ? 'rgba(52, 152, 219, 0.1)' : '#2a2a2a',
                                    border: isTargetMessage ? '2px solid #3498db' : '1px solid #3a3a3a',
                                    borderRadius: '8px',
                                    padding: '20px',
                                    position: 'relative'
                                }}
                            >
                                {isTargetMessage && (
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
                                )}

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
                                                principal={msg.sender} 
                                                maxLength={20}
                                                style={{ color: '#ffffff' }}
                                            />
                                        </div>
                                        <div style={{ marginBottom: '8px' }}>
                                            <span style={{ color: '#888', fontSize: '14px' }}>To: </span>
                                            {msg.recipients.map((recipient, idx) => (
                                                <span key={idx}>
                                                    <PrincipalDisplay 
                                                        principal={recipient} 
                                                        maxLength={20}
                                                        style={{ color: '#ffffff' }}
                                                    />
                                                    {idx < msg.recipients.length - 1 && ', '}
                                                </span>
                                            ))}
                                        </div>
                                        {msg.reply_to && msg.reply_to.length > 0 && (
                                            <div style={{ marginBottom: '8px' }}>
                                                <span style={{ color: '#888', fontSize: '14px' }}>
                                                    ↩️ Reply to message #{msg.reply_to[0].toString()}
                                                </span>
                                            </div>
                                        )}
                                    </div>
                                    <div style={{ color: '#888', fontSize: '12px', textAlign: 'right' }}>
                                        <div>#{msg.id.toString()}</div>
                                        <div>{formatTimestamp(msg.created_at)}</div>
                                    </div>
                                </div>

                                {/* Message Content */}
                                <div style={{ marginBottom: '15px' }}>
                                    <h3 style={{ color: '#ffffff', margin: '0 0 10px 0', fontSize: '18px' }}>
                                        {msg.subject}
                                    </h3>
                                    <div style={{ 
                                        color: '#cccccc', 
                                        lineHeight: '1.6',
                                        whiteSpace: 'pre-wrap',
                                        wordBreak: 'break-word'
                                    }}>
                                        {msg.body}
                                    </div>
                                </div>

                                {/* Message Actions */}
                                {isTargetMessage && (
                                    <div style={{ 
                                        display: 'flex', 
                                        gap: '10px', 
                                        borderTop: '1px solid #3a3a3a', 
                                        paddingTop: '15px',
                                        flexWrap: 'wrap'
                                    }}>
                                        <button
                                            onClick={() => {
                                                // Set up reply form
                                                const senderPrincipal = msg.sender.toString();
                                                const displayInfo = getPrincipalDisplayInfoFromContext(senderPrincipal, principalNames, principalNicknames);
                                                
                                                setReplyForm({
                                                    recipients: [{ 
                                                        value: senderPrincipal, 
                                                        isValid: true, 
                                                        name: displayInfo.name && displayInfo.name !== senderPrincipal ? displayInfo.name : '', 
                                                        error: '' 
                                                    }],
                                                    subject: msg.subject.startsWith('Re: ') ? msg.subject : `Re: ${msg.subject}`,
                                                    body: ''
                                                });
                                                setShowReplyModal(true);
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
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
};

export default Message;
