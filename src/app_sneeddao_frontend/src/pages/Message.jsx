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
    
    const [messageTree, setMessageTree] = useState(new Map()); // Map of messageId -> message object
    const [messageChildren, setMessageChildren] = useState(new Map()); // Map of messageId -> array of child message IDs
    const [focusMessageId, setFocusMessageId] = useState(null);
    const [loading, setLoading] = useState(true);
    const [loadingStates, setLoadingStates] = useState(new Map()); // Map of messageId -> {loadingParent: bool, loadingReplies: bool}
    const [expandedMessages, setExpandedMessages] = useState(new Set()); // Set of message IDs with expanded content
    const [collapsedMessages, setCollapsedMessages] = useState(new Set()); // Set of message IDs that are collapsed
    const [loadingFullTree, setLoadingFullTree] = useState(false);
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

    // Fetch the focus message and initialize the tree
    const fetchFocusMessage = async () => {
        console.log('fetchFocusMessage called with id:', id);
        if (!identity || !id) {
            console.log('Missing identity or id, returning');
            return;
        }
        
        setLoading(true);
        setError(null);
        
        try {
            const actor = getSmsActor();
            if (!actor) {
                console.log('No actor, returning');
                return;
            }

            console.log('Calling get_message with id:', BigInt(id));
            const messageResult = await actor.get_message(BigInt(id));
            console.log('Message result:', messageResult);
            
            if (messageResult === null || messageResult === undefined) {
                const errorMsg = `Message not found or access denied`;
                console.log('Error: message not found or no access');
                setError(errorMsg);
                return;
            }

            const targetMessage = Array.isArray(messageResult) ? messageResult[0] : messageResult;
            console.log('Successfully loaded focus message:', targetMessage);
            
            // Initialize the tree with just the focus message
            const messageId = Number(targetMessage.id);
            setMessageTree(new Map([[messageId, targetMessage]]));
            setMessageChildren(new Map());
            setFocusMessageId(messageId);
            setExpandedMessages(new Set([messageId])); // Focus message starts expanded

        } catch (err) {
            console.error('Error fetching message:', err);
            setError('Failed to load message: ' + (err.message || err.toString()));
        } finally {
            setLoading(false);
        }
    };

    // Load parent of a specific message
    const loadParentMessage = async (messageId) => {
        const message = messageTree.get(messageId);
        if (!message || !message.reply_to || message.reply_to.length === 0) return;
        
        // Set loading state for this message
        setLoadingStates(prev => new Map(prev.set(messageId, { 
            ...prev.get(messageId), 
            loadingParent: true 
        })));
        
        try {
            const actor = getSmsActor();
            if (!actor) return;

            const parentId = Number(message.reply_to[0]);
            console.log('Loading parent message with ID:', parentId, 'for message:', messageId);
            
            // Check if parent is already loaded
            if (messageTree.has(parentId)) {
                console.log('Parent already loaded');
                return;
            }
            
            const parentResult = await actor.get_message(BigInt(parentId));
            console.log('Parent message result:', parentResult);
            
            if (parentResult === null || parentResult === undefined) {
                console.log('Parent message not found or no access');
                return;
            }

            const parentMsg = Array.isArray(parentResult) ? parentResult[0] : parentResult;
            console.log('Adding parent message to tree:', parentMsg);
            
            // Add parent to tree
            setMessageTree(prev => new Map(prev.set(parentId, parentMsg)));
            
            // Add this message as a child of the parent
            setMessageChildren(prev => {
                const newChildren = new Map(prev);
                const parentChildren = newChildren.get(parentId) || [];
                if (!parentChildren.includes(messageId)) {
                    newChildren.set(parentId, [...parentChildren, messageId]);
                }
                return newChildren;
            });
            
            // Expand parent message
            setExpandedMessages(prev => new Set([...prev, parentId]));
            
        } catch (err) {
            console.error('Error loading parent message:', err);
        } finally {
            // Clear loading state
            setLoadingStates(prev => new Map(prev.set(messageId, { 
                ...prev.get(messageId), 
                loadingParent: false 
            })));
        }
    };

    // Load replies for a specific message
    const loadReplies = async (messageId) => {
        // Set loading state for this message
        setLoadingStates(prev => new Map(prev.set(messageId, { 
            ...prev.get(messageId), 
            loadingReplies: true 
        })));
        
        try {
            const actor = getSmsActor();
            if (!actor) return;

            console.log('Loading replies for message:', messageId);
            const allMessages = await actor.get_all_messages();
            console.log('All messages result:', allMessages);
            
            // Find messages that reply to this message
            const messageReplies = allMessages.filter(msg => 
                msg.reply_to && 
                msg.reply_to.length > 0 && 
                Number(msg.reply_to[0]) === messageId
            );
            
            console.log('Found replies:', messageReplies);
            
            // Sort by creation time
            messageReplies.sort((a, b) => Number(a.created_at) - Number(b.created_at));
            
            // Add replies to tree
            setMessageTree(prev => {
                const newTree = new Map(prev);
                messageReplies.forEach(reply => {
                    newTree.set(Number(reply.id), reply);
                });
                return newTree;
            });
            
            // Set children for this message
            const replyIds = messageReplies.map(reply => Number(reply.id));
            setMessageChildren(prev => new Map(prev.set(messageId, replyIds)));
            
            // Expand all reply messages
            setExpandedMessages(prev => new Set([...prev, ...replyIds]));
            
        } catch (err) {
            console.error('Error loading replies:', err);
        } finally {
            // Clear loading state
            setLoadingStates(prev => new Map(prev.set(messageId, { 
                ...prev.get(messageId), 
                loadingReplies: false 
            })));
        }
    };

    useEffect(() => {
        console.log('useEffect triggered with isAuthenticated:', isAuthenticated, 'id:', id);
        if (isAuthenticated) {
            fetchFocusMessage();
        }
    }, [isAuthenticated, id]);

    // Toggle message content expansion (for long messages)
    const toggleMessageExpansion = (messageId) => {
        setExpandedMessages(prev => {
            const newSet = new Set(prev);
            if (newSet.has(messageId)) {
                newSet.delete(messageId);
            } else {
                newSet.add(messageId);
            }
            return newSet;
        });
    };

    // Toggle message collapse state (hide/show entire message content)
    const toggleMessageCollapse = (messageId) => {
        setCollapsedMessages(prev => {
            const newSet = new Set(prev);
            if (newSet.has(messageId)) {
                newSet.delete(messageId);
            } else {
                newSet.add(messageId);
            }
            return newSet;
        });
    };

    // Get loading state for a message
    const getLoadingState = (messageId) => {
        return loadingStates.get(messageId) || { loadingParent: false, loadingReplies: false };
    };

    // Find the root of the current tree (message with no loaded parent)
    const findTreeRoot = () => {
        for (const [messageId, message] of messageTree) {
            const hasParentInTree = message.reply_to && 
                message.reply_to.length > 0 && 
                messageTree.has(Number(message.reply_to[0]));
            if (!hasParentInTree) {
                return messageId;
            }
        }
        return focusMessageId; // Fallback to focus message
    };

    // Load full tree recursively
    const loadFullTree = async () => {
        if (!focusMessageId) return;
        
        setLoadingFullTree(true);
        try {
            const actor = getSmsActor();
            if (!actor) return;

            console.log('Loading full tree starting from focus message:', focusMessageId);
            
            // Get all messages once to avoid multiple API calls
            const allMessages = await actor.get_all_messages();
            console.log('All messages loaded:', allMessages.length);
            
            // Create lookup maps for efficiency
            const messageMap = new Map();
            const childrenMap = new Map();
            
            allMessages.forEach(msg => {
                const msgId = Number(msg.id);
                messageMap.set(msgId, msg);
                
                // Build children map
                if (msg.reply_to && msg.reply_to.length > 0) {
                    const parentId = Number(msg.reply_to[0]);
                    if (!childrenMap.has(parentId)) {
                        childrenMap.set(parentId, []);
                    }
                    childrenMap.get(parentId).push(msgId);
                }
            });
            
            // Sort children by creation time
            childrenMap.forEach(children => {
                children.sort((a, b) => {
                    const msgA = messageMap.get(a);
                    const msgB = messageMap.get(b);
                    return Number(msgA.created_at) - Number(msgB.created_at);
                });
            });

            const newMessageTree = new Map(messageTree);
            const newMessageChildren = new Map(messageChildren);
            const newExpandedMessages = new Set(expandedMessages);
            const newCollapsedMessages = new Set(collapsedMessages);

            // 1. Load all parents upward (expanded) and their siblings (collapsed)
            let currentId = focusMessageId;
            const ancestorPath = [currentId]; // Track the direct ancestor path
            
            while (true) {
                const currentMsg = messageMap.get(currentId);
                if (!currentMsg || !currentMsg.reply_to || currentMsg.reply_to.length === 0) break;
                
                const parentId = Number(currentMsg.reply_to[0]);
                const parentMsg = messageMap.get(parentId);
                if (!parentMsg) break;
                
                console.log('Loading parent:', parentId);
                
                // Add parent to tree (expanded)
                newMessageTree.set(parentId, parentMsg);
                newExpandedMessages.add(parentId);
                
                // Add current message as child of parent
                const parentChildren = newMessageChildren.get(parentId) || [];
                if (!parentChildren.includes(currentId)) {
                    parentChildren.push(currentId);
                    newMessageChildren.set(parentId, parentChildren);
                }
                
                // Load all siblings of current message (collapsed, no recursion)
                const siblings = childrenMap.get(parentId) || [];
                siblings.forEach(siblingId => {
                    if (siblingId !== currentId && !ancestorPath.includes(siblingId)) {
                        const siblingMsg = messageMap.get(siblingId);
                        if (siblingMsg) {
                            console.log('Loading sibling (collapsed):', siblingId);
                            newMessageTree.set(siblingId, siblingMsg);
                            newCollapsedMessages.add(siblingId); // Siblings start collapsed
                            
                            // Add sibling to parent's children
                            if (!parentChildren.includes(siblingId)) {
                                parentChildren.push(siblingId);
                            }
                        }
                    }
                });
                
                // Sort parent's children by creation time
                parentChildren.sort((a, b) => {
                    const msgA = newMessageTree.get(a);
                    const msgB = newMessageTree.get(b);
                    return Number(msgA.created_at) - Number(msgB.created_at);
                });
                newMessageChildren.set(parentId, parentChildren);
                
                ancestorPath.push(parentId);
                currentId = parentId;
            }

            // 2. Load all descendants recursively (expanded)
            const loadDescendants = (parentId) => {
                const children = childrenMap.get(parentId) || [];
                if (children.length === 0) return;
                
                console.log('Loading descendants of:', parentId, children);
                
                const childrenToAdd = [];
                children.forEach(childId => {
                    const childMsg = messageMap.get(childId);
                    if (childMsg) {
                        newMessageTree.set(childId, childMsg);
                        newExpandedMessages.add(childId); // Descendants are expanded
                        childrenToAdd.push(childId);
                        
                        // Recursively load their children
                        loadDescendants(childId);
                    }
                });
                
                // Sort children by creation time
                childrenToAdd.sort((a, b) => {
                    const msgA = newMessageTree.get(a);
                    const msgB = newMessageTree.get(b);
                    return Number(msgA.created_at) - Number(msgB.created_at);
                });
                
                newMessageChildren.set(parentId, childrenToAdd);
            };
            
            loadDescendants(focusMessageId);

            // Update state
            setMessageTree(newMessageTree);
            setMessageChildren(newMessageChildren);
            setExpandedMessages(newExpandedMessages);
            setCollapsedMessages(newCollapsedMessages);
            
            console.log('Full tree loaded. Total messages:', newMessageTree.size);
            
        } catch (err) {
            console.error('Error loading full tree:', err);
            setError('Failed to load full tree: ' + (err.message || err.toString()));
        } finally {
            setLoadingFullTree(false);
        }
    };

    // Render a single message in the tree
    const renderMessage = (messageId, depth = 0) => {
        const message = messageTree.get(messageId);
        if (!message) return null;

        const isFocused = messageId === focusMessageId;
        const isExpanded = expandedMessages.has(messageId);
        const isCollapsed = collapsedMessages.has(messageId);
        const loadingState = getLoadingState(messageId);
        const children = messageChildren.get(messageId) || [];
        const hasParent = message.reply_to && message.reply_to.length > 0;
        const canLoadParent = hasParent && !messageTree.has(Number(message.reply_to[0]));
        const hasLoadedReplies = children.length > 0;
        const canLoadReplies = true; // All messages can potentially have replies

        // Truncate long messages
        const isLongMessage = message.body.length > 300;
        const displayBody = isExpanded || !isLongMessage ? message.body : message.body.substring(0, 300) + '...';

        return (
            <div key={messageId} style={{ marginLeft: depth * 20 + 'px' }}>
                {/* Load Parent Button */}
                {canLoadParent && (
                    <div style={{ marginBottom: '10px' }}>
                        <button
                            onClick={() => loadParentMessage(messageId)}
                            disabled={loadingState.loadingParent}
                            style={{
                                backgroundColor: '#9b59b6',
                                color: '#ffffff',
                                border: 'none',
                                borderRadius: '4px',
                                padding: '6px 12px',
                                cursor: loadingState.loadingParent ? 'not-allowed' : 'pointer',
                                opacity: loadingState.loadingParent ? 0.6 : 1,
                                fontSize: '12px'
                            }}
                        >
                            {loadingState.loadingParent ? '⏳ Loading...' : '⬆️ Load Parent'}
                        </button>
                    </div>
                )}

                {/* Message Container */}
                <div
                    style={{
                        backgroundColor: isFocused ? 'rgba(52, 152, 219, 0.1)' : '#2a2a2a',
                        border: isFocused ? '2px solid #3498db' : '1px solid #3a3a3a',
                        borderRadius: '8px',
                        padding: '15px',
                        marginBottom: '10px',
                        position: 'relative'
                    }}
                >
                    {/* Collapse/Expand Arrow */}
                    <div
                        onClick={() => toggleMessageCollapse(messageId)}
                        style={{
                            position: 'absolute',
                            top: '8px',
                            left: '8px',
                            cursor: 'pointer',
                            fontSize: '14px',
                            color: '#888',
                            userSelect: 'none',
                            zIndex: 10,
                            width: '20px',
                            height: '20px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            borderRadius: '3px',
                            transition: 'background-color 0.2s'
                        }}
                        onMouseEnter={(e) => e.target.style.backgroundColor = '#444'}
                        onMouseLeave={(e) => e.target.style.backgroundColor = 'transparent'}
                        title={isCollapsed ? 'Expand message' : 'Collapse message'}
                    >
                        {isCollapsed ? '▶' : '▼'}
                    </div>

                    {isFocused && (
                        <div style={{
                            position: 'absolute',
                            top: '-10px',
                            left: '35px', // Moved right to avoid arrow
                            backgroundColor: '#3498db',
                            color: 'white',
                            padding: '4px 12px',
                            borderRadius: '12px',
                            fontSize: '12px',
                            fontWeight: 'bold'
                        }}>
                            Focus Message
                        </div>
                    )}

                    {/* Always visible header (even when collapsed) */}
                    <div style={{ 
                        display: 'flex', 
                        justifyContent: 'space-between', 
                        alignItems: 'center',
                        marginBottom: isCollapsed ? '0' : '10px',
                        flexWrap: 'wrap',
                        gap: '10px',
                        paddingLeft: '25px' // Make room for arrow
                    }}>
                        <div style={{ flex: 1, minWidth: '200px' }}>
                            <h4 style={{ 
                                color: '#ffffff', 
                                margin: '0', 
                                fontSize: '16px',
                                cursor: isCollapsed ? 'pointer' : 'default'
                            }}
                            onClick={isCollapsed ? () => toggleMessageCollapse(messageId) : undefined}
                            >
                                {message.subject}
                            </h4>
                            {!isCollapsed && (
                                <>
                                    <div style={{ marginTop: '5px', marginBottom: '3px' }}>
                                        <span style={{ color: '#888', fontSize: '12px' }}>From: </span>
                                        <PrincipalDisplay 
                                            principal={message.sender} 
                                            maxLength={20}
                                            style={{ color: '#ffffff', fontSize: '14px' }}
                                        />
                                    </div>
                                    <div style={{ marginBottom: '5px' }}>
                                        <span style={{ color: '#888', fontSize: '12px' }}>To: </span>
                                        {message.recipients.map((recipient, idx) => (
                                            <span key={idx}>
                                                <PrincipalDisplay 
                                                    principal={recipient} 
                                                    maxLength={15}
                                                    style={{ color: '#ffffff', fontSize: '14px' }}
                                                />
                                                {idx < message.recipients.length - 1 && ', '}
                                            </span>
                                        ))}
                                    </div>
                                </>
                            )}
                        </div>
                        <div style={{ color: '#888', fontSize: '12px', textAlign: 'right' }}>
                            <div 
                                style={{ cursor: 'pointer', color: '#3498db' }}
                                onClick={() => navigate(`/msg/${message.id}`)}
                                title="Click to focus this message"
                            >
                                #{message.id.toString()}
                            </div>
                            <div>{formatTimestamp(message.created_at)}</div>
                        </div>
                    </div>

                    {/* Collapsible Content */}
                    {!isCollapsed && (
                        <>
                            {/* Message Body */}
                            <div style={{ marginBottom: '10px', paddingLeft: '25px' }}>
                                <div style={{ 
                                    color: '#cccccc', 
                                    lineHeight: '1.5',
                                    whiteSpace: 'pre-wrap',
                                    wordBreak: 'break-word',
                                    fontSize: '14px'
                                }}>
                                    {displayBody}
                                </div>
                                {isLongMessage && (
                                    <button
                                        onClick={() => toggleMessageExpansion(messageId)}
                                        style={{
                                            background: 'none',
                                            border: 'none',
                                            color: '#3498db',
                                            cursor: 'pointer',
                                            fontSize: '12px',
                                            marginTop: '5px'
                                        }}
                                    >
                                        {isExpanded ? 'Show Less' : 'Show More'}
                                    </button>
                                )}
                            </div>

                            {/* Action Buttons */}
                            <div style={{ 
                                display: 'flex', 
                                gap: '8px', 
                                borderTop: '1px solid #3a3a3a', 
                                paddingTop: '10px',
                                paddingLeft: '25px',
                                flexWrap: 'wrap'
                            }}>
                                <button
                                    onClick={() => navigate(`/sms?reply=${message.id}`)}
                                    style={{
                                        backgroundColor: '#3498db',
                                        color: '#ffffff',
                                        border: 'none',
                                        borderRadius: '4px',
                                        padding: '6px 12px',
                                        cursor: 'pointer',
                                        fontSize: '12px'
                                    }}
                                >
                                    ↩️ Reply
                                </button>
                                
                                {canLoadReplies && (
                                    <button
                                        onClick={() => loadReplies(messageId)}
                                        disabled={loadingState.loadingReplies}
                                        style={{
                                            backgroundColor: '#e67e22',
                                            color: '#ffffff',
                                            border: 'none',
                                            borderRadius: '4px',
                                            padding: '6px 12px',
                                            cursor: loadingState.loadingReplies ? 'not-allowed' : 'pointer',
                                            opacity: loadingState.loadingReplies ? 0.6 : 1,
                                            fontSize: '12px'
                                        }}
                                    >
                                        {loadingState.loadingReplies ? '⏳ Loading...' : 
                                         hasLoadedReplies ? '🔄 Refresh Replies' : '⬇️ Load Replies'}
                                    </button>
                                )}
                            </div>
                        </>
                    )}
                </div>

                {/* Render Children */}
                {children.map(childId => renderMessage(childId, depth + 1))}
            </div>
        );
    };

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
            <div style={{ padding: '20px', maxWidth: '1000px', margin: '0 auto' }}>
                {/* Navigation */}
                <div style={{ marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                    <button 
                        onClick={() => navigate('/sms')}
                        style={{
                            backgroundColor: '#3498db',
                            color: '#ffffff',
                            border: 'none',
                            borderRadius: '6px',
                            padding: '8px 16px',
                            cursor: 'pointer'
                        }}
                    >
                        ← Back to Messages
                    </button>
                    
                    <button
                        onClick={loadFullTree}
                        disabled={loadingFullTree}
                        style={{
                            backgroundColor: '#27ae60',
                            color: '#ffffff',
                            border: 'none',
                            borderRadius: '6px',
                            padding: '8px 16px',
                            cursor: loadingFullTree ? 'not-allowed' : 'pointer',
                            opacity: loadingFullTree ? 0.6 : 1,
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px'
                        }}
                    >
                        {loadingFullTree ? (
                            <>⏳ Loading Full Tree...</>
                        ) : (
                            <>🌳 Load Full Tree</>
                        )}
                    </button>
                    
                    <span style={{ color: '#888' }}>Message Thread</span>
                </div>

                {/* Message Tree */}
                {focusMessageId && messageTree.size > 0 && (
                    <div style={{ 
                        backgroundColor: '#1a1a1a',
                        borderRadius: '8px',
                        padding: '20px',
                        border: '1px solid #333'
                    }}>
                        {renderMessage(findTreeRoot())}
                    </div>
                )}
            </div>
        </div>
    );
};

export default Message;
