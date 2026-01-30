import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import Header from '../components/Header';
import { useTheme } from '../contexts/ThemeContext';
import { createActor as createSmsActor } from '../../../declarations/sneed_sms';
import { Principal } from '@dfinity/principal';
import { PrincipalDisplay, getPrincipalDisplayInfoFromContext } from '../utils/PrincipalUtils';
import { useNaming } from '../NamingContext';
import MarkdownBody from '../components/MarkdownBody';
import { getRelativeTime, getFullDate } from '../utils/DateUtils';
import { FaEnvelope, FaArrowLeft, FaExpandAlt, FaCompressAlt, FaReply, FaChevronDown, FaChevronRight, FaUser, FaUsers, FaClock, FaLock, FaBookOpen } from 'react-icons/fa';

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

.msg-card-animate {
    animation: fadeInUp 0.5s ease-out forwards;
}

.msg-card {
    transition: all 0.3s ease;
}

.msg-float {
    animation: float 3s ease-in-out infinite;
}

.msg-pulse {
    animation: pulse 2s ease-in-out infinite;
}
`;

// Accent colors for this page
const msgPrimary = '#3b82f6'; // Blue
const msgSecondary = '#1d4ed8'; // Darker blue
const msgAccent = '#60a5fa'; // Light blue

const Message = () => {
    const { theme } = useTheme();
    const { id } = useParams();
    const navigate = useNavigate();
    const { identity, isAuthenticated } = useAuth();
    const { principalNames, principalNicknames } = useNaming();
    
    const [messageTree, setMessageTree] = useState(new Map()); // Map of messageId -> message object
    const [messageChildren, setMessageChildren] = useState(new Map()); // Map of messageId -> array of child message IDs
    const [focusMessageId, setFocusMessageId] = useState(null);
    const [loading, setLoading] = useState(true);
    const [loadingStates, setLoadingStates] = useState(new Map()); // Map of messageId -> {loadingParent: bool}
    const [expandedMessages, setExpandedMessages] = useState(new Set()); // Set of message IDs with expanded content
    const [collapsedMessages, setCollapsedMessages] = useState(new Set()); // Set of message IDs that are collapsed
    const [collapsedHeaders, setCollapsedHeaders] = useState(new Set()); // Set of message IDs with collapsed headers (From/To info)
    const [error, setError] = useState(null);
    const [principalDisplayInfo, setPrincipalDisplayInfo] = useState(new Map());

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
            
            // Ensure focus message is always expanded and never collapsed
            setExpandedMessages(new Set([messageId])); // Focus message starts expanded
            setCollapsedMessages(prev => {
                const newSet = new Set(prev);
                newSet.delete(messageId); // Remove focus message from collapsed state if it was there
                return newSet;
            });
            // Start all message headers as collapsed by default
            setCollapsedHeaders(new Set([messageId]));

            // Auto-load replies for the focused message (they will start collapsed)
            await loadReplies(messageId);
            
            // Auto-load the first parent and its siblings (siblings will be collapsed)
            if (targetMessage.reply_to && targetMessage.reply_to.length > 0) {
                console.log('Auto-loading parent for focus message. Parent ID should be:', Number(targetMessage.reply_to[0]));
                
                // Load parent directly using the targetMessage data
                const parentId = Number(targetMessage.reply_to[0]);
                try {
                    const parentResult = await actor.get_message(BigInt(parentId));
                    console.log('Parent message result for auto-load:', parentResult);
                    
                    if (parentResult && parentResult !== null && parentResult !== undefined) {
                        const parentMsg = Array.isArray(parentResult) ? parentResult[0] : parentResult;
                        console.log('Auto-loading parent message:', parentMsg);
                        
                        // Add parent to tree
                        setMessageTree(prev => new Map(prev.set(parentId, parentMsg)));
                        
                        // Add focus message as child of parent
                        setMessageChildren(prev => {
                            const newChildren = new Map(prev);
                            const parentChildren = newChildren.get(parentId) || [];
                            if (!parentChildren.includes(messageId)) {
                                newChildren.set(parentId, [...parentChildren, messageId]);
                            }
                            return newChildren;
                        });
                        
                        // Start parent message collapsed (but never collapse the focus message)
                        if (parentId !== messageId) {
                            setCollapsedMessages(prev => new Set([...prev, parentId]));
                        }
                        setExpandedMessages(prev => new Set([...prev, parentId])); // Expand content but collapsed structurally
                        
                        // Set parent header as collapsed
                        setCollapsedHeaders(prev => new Set([...prev, parentId]));
                        
                        // Load siblings (replies of the parent)
                        await loadReplies(parentId);
                        
                        // Ensure focus message is still not collapsed after loading siblings
                        setCollapsedMessages(prev => {
                            const newSet = new Set(prev);
                            newSet.delete(messageId); // Remove focus message from collapsed state
                            return newSet;
                        });
                        setExpandedMessages(prev => new Set([...prev, messageId])); // Ensure focus message is expanded
                    }
                } catch (parentErr) {
                    console.error('Error auto-loading parent:', parentErr);
                }
            }

        } catch (err) {
            console.error('Error fetching message:', err);
            setError('Failed to load message: ' + (err.message || err.toString()));
        } finally {
            setLoading(false);
        }
    };

    // Load parent of a specific message and its siblings
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
            
            // Set parent header as collapsed
            setCollapsedHeaders(prev => new Set([...prev, parentId]));
            
            // Load siblings of this message (collapsed)
            await loadReplies(parentId); // This will load all children of parent (including siblings)
            
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

    // Load all parents up to the root (with collapsed siblings)
    const loadAllParents = async (startMessageId) => {
        if (!startMessageId) return;
        
        setLoadingStates(prev => new Map(prev.set(startMessageId, { 
            ...prev.get(startMessageId), 
            loadingParent: true 
        })));
        
        try {
            const actor = getSmsActor();
            if (!actor) return;

            console.log('Loading all parents starting from message:', startMessageId);
            
            // Get all messages once to avoid multiple API calls
            const allMessages = await actor.get_all_messages();
            console.log('All messages loaded for parent chain:', allMessages.length);
            
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

            // Load all parents upward (expanded) and their siblings (collapsed)
            let currentId = startMessageId;
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
                    if (!msgA || !msgB) return 0;
                    return Number(msgA.created_at) - Number(msgB.created_at);
                });
                newMessageChildren.set(parentId, parentChildren);
                
                ancestorPath.push(parentId);
                currentId = parentId;
            }

            // Update all states
            setMessageTree(newMessageTree);
            setMessageChildren(newMessageChildren);
            setExpandedMessages(newExpandedMessages);
            setCollapsedMessages(newCollapsedMessages);
            // Set all newly loaded messages' headers as collapsed
            const newlyLoadedIds = Array.from(newMessageTree.keys()).filter(id => !messageTree.has(id));
            setCollapsedHeaders(prev => new Set([...prev, ...newlyLoadedIds]));
            
        } catch (err) {
            console.error('Error loading all parents:', err);
        } finally {
            // Clear loading state
            setLoadingStates(prev => new Map(prev.set(startMessageId, { 
                ...prev.get(startMessageId), 
                loadingParent: false 
            })));
        }
    };

    // Load replies for a specific message
    const loadReplies = async (messageId) => {
        // Set loading state for this message
        setLoadingStates(prev => new Map(prev.set(messageId, { 
            ...prev.get(messageId), 
            loadingParent: true 
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
            
            // Start all reply messages in collapsed state (they will auto-load their replies when expanded)
            // But never collapse the focus message
            console.log('loadReplies: messageId=', messageId, 'focusMessageId=', focusMessageId, 'replyIds=', replyIds);
            const replyIdsToCollapse = replyIds.filter(id => id !== focusMessageId);
            console.log('replyIdsToCollapse (after filtering focus):', replyIdsToCollapse);
            if (replyIdsToCollapse.length > 0) {
                setCollapsedMessages(prev => new Set([...prev, ...replyIdsToCollapse]));
            }
            
            // Expand the message content for replies (so the text is readable, but they're structurally collapsed)
            setExpandedMessages(prev => new Set([...prev, ...replyIds]));
            
            // Start all reply headers as collapsed by default
            setCollapsedHeaders(prev => new Set([...prev, ...replyIds]));
            
        } catch (err) {
            console.error('Error loading replies:', err);
        } finally {
            // Clear loading state
            setLoadingStates(prev => new Map(prev.set(messageId, { 
                ...prev.get(messageId), 
                loadingParent: false 
            })));
        }
    };

    useEffect(() => {
        console.log('useEffect triggered with isAuthenticated:', isAuthenticated, 'id:', id);
        if (isAuthenticated) {
            fetchFocusMessage();
        }
    }, [isAuthenticated, id]);

    // Build principal display info map when messages change
    useEffect(() => {
        const uniquePrincipals = new Set();
        
        // Collect all principals from all messages in the tree
        messageTree.forEach(message => {
            // Add sender
            if (message.sender) {
                uniquePrincipals.add(message.sender.toString());
            }
            // Add recipients
            if (message.recipients) {
                message.recipients.forEach(recipient => {
                    uniquePrincipals.add(recipient.toString());
                });
            }
        });

        const displayInfoMap = new Map();
        Array.from(uniquePrincipals).forEach(principal => {
            const displayInfo = getPrincipalDisplayInfoFromContext(principal, principalNames, principalNicknames);
            displayInfoMap.set(principal, displayInfo);
        });

        setPrincipalDisplayInfo(displayInfoMap);
    }, [messageTree, principalNames, principalNicknames]);

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

    // Toggle header collapse (From/To info visibility)
    const toggleHeaderCollapse = (messageId) => {
        setCollapsedHeaders(prev => {
            const newSet = new Set(prev);
            if (newSet.has(messageId)) {
                newSet.delete(messageId);
            } else {
                newSet.add(messageId);
            }
            return newSet;
        });
    };

    // Expand all messages in the current tree
    const expandAll = () => {
        const allMessageIds = Array.from(messageTree.keys());
        setCollapsedMessages(new Set()); // Clear all collapsed messages
        setExpandedMessages(new Set(allMessageIds)); // Expand all messages
        setCollapsedHeaders(new Set()); // Expand all headers
    };

    // Collapse all messages except the focus message
    const collapseAll = () => {
        const allMessageIds = Array.from(messageTree.keys());
        const messagesToCollapse = allMessageIds.filter(id => id !== focusMessageId);
        setCollapsedMessages(new Set(messagesToCollapse));
        setCollapsedHeaders(new Set(allMessageIds)); // Collapse all headers including focus message
        // Keep focus message expanded
        if (focusMessageId) {
            setExpandedMessages(new Set([focusMessageId]));
        }
    };

    // Toggle message collapse state (hide/show entire message content)
    const toggleMessageCollapse = async (messageId) => {
        const wasCollapsed = collapsedMessages.has(messageId);
        
        // Toggle collapse state
        setCollapsedMessages(prev => {
            const newSet = new Set(prev);
            if (newSet.has(messageId)) {
                newSet.delete(messageId);
            } else {
                newSet.add(messageId);
            }
            return newSet;
        });
        
        // If we're expanding (was collapsed) and no replies loaded yet, auto-load them
        if (wasCollapsed && !messageChildren.has(messageId)) {
            console.log('Auto-loading replies for expanded message:', messageId);
            await loadReplies(messageId);
        }
    };

    // Get loading state for a message
    const getLoadingState = (messageId) => {
        return loadingStates.get(messageId) || { loadingParent: false };
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



    // Render a single message in the tree
    const renderMessage = (messageId, depth = 0) => {
        const message = messageTree.get(messageId);
        if (!message) return null;

        const isFocused = messageId === focusMessageId;
        const isExpanded = expandedMessages.has(messageId);
        const isCollapsed = collapsedMessages.has(messageId);
        const isHeaderCollapsed = collapsedHeaders.has(messageId);
        const loadingState = getLoadingState(messageId);
        const children = messageChildren.get(messageId) || [];
        const hasParent = message.reply_to && message.reply_to.length > 0;
        const canLoadParent = hasParent && !messageTree.has(Number(message.reply_to[0]));


        // Truncate long messages
        const isLongMessage = message.body.length > 300;
        const displayBody = isExpanded || !isLongMessage ? message.body : message.body.substring(0, 300) + '...';

        // Reddit-style nesting: use borderLeft for visual indication, minimal marginLeft
        const nestingIndicatorColor = depth === 0 ? 'transparent' : 
            depth === 1 ? msgPrimary : 
            depth === 2 ? theme.colors.success : 
            depth === 3 ? theme.colors.warning : 
            theme.colors.accent;

        return (
            <div 
                key={messageId} 
                style={{ 
                    marginLeft: depth > 0 ? '0.5rem' : '0',
                    paddingLeft: depth > 0 ? '0.75rem' : '0',
                    borderLeft: depth > 0 ? `3px solid ${nestingIndicatorColor}40` : 'none',
                }}
            >
                {/* Load Context Button */}
                {canLoadParent && (
                    <div style={{ marginBottom: '0.75rem' }}>
                        <button
                            onClick={() => loadAllParents(messageId)}
                            disabled={loadingState.loadingParent}
                            style={{
                                background: `${msgPrimary}15`,
                                color: msgPrimary,
                                border: `1px solid ${msgPrimary}30`,
                                borderRadius: '10px',
                                padding: '0.5rem 1rem',
                                cursor: loadingState.loadingParent ? 'not-allowed' : 'pointer',
                                opacity: loadingState.loadingParent ? 0.6 : 1,
                                fontSize: '0.85rem',
                                fontWeight: '600',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.5rem',
                                transition: 'all 0.2s ease'
                            }}
                        >
                            <FaBookOpen size={12} />
                            {loadingState.loadingParent ? 'Loading...' : 'Load Full Context'}
                        </button>
                    </div>
                )}

                {/* Message Container */}
                <div
                    className="msg-card"
                    style={{
                        background: isFocused 
                            ? `linear-gradient(145deg, ${theme.colors.secondaryBg} 0%, ${msgPrimary}12 100%)` 
                            : `linear-gradient(145deg, ${theme.colors.tertiaryBg} 0%, ${theme.colors.secondaryBg} 100%)`,
                        border: isFocused 
                            ? `2px solid ${msgPrimary}` 
                            : `1px solid ${theme.colors.border}`,
                        borderRadius: '12px',
                        padding: '0.875rem',
                        marginBottom: '0.75rem',
                        position: 'relative',
                        boxShadow: isFocused 
                            ? `0 6px 24px ${msgPrimary}20, 0 2px 6px rgba(0,0,0,0.12)` 
                            : '0 1px 4px rgba(0,0,0,0.08)',
                        borderLeft: isFocused ? `4px solid ${msgPrimary}` : 'none'
                    }}
                >
                    {/* Header Row */}
                    <div style={{ 
                        display: 'flex', 
                        alignItems: 'flex-start',
                        gap: '0.6rem',
                        marginBottom: isCollapsed ? '0' : '0.5rem'
                    }}>
                        {/* Collapse Toggle */}
                        <button
                            onClick={() => toggleMessageCollapse(messageId)}
                            style={{
                                width: '28px',
                                height: '28px',
                                minWidth: '28px',
                                borderRadius: '8px',
                                background: isFocused 
                                    ? `linear-gradient(135deg, ${msgPrimary}, ${msgSecondary})`
                                    : theme.colors.secondaryBg,
                                border: isFocused ? 'none' : `1px solid ${theme.colors.border}`,
                                color: isFocused ? 'white' : theme.colors.mutedText,
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                transition: 'all 0.2s ease',
                                flexShrink: 0,
                                boxShadow: isFocused ? `0 3px 10px ${msgPrimary}35` : 'none'
                            }}
                            title={isCollapsed ? 'Expand message' : 'Collapse message'}
                        >
                            {isCollapsed ? <FaChevronRight size={10} /> : <FaChevronDown size={10} />}
                        </button>

                        {/* Message Info */}
                        <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '0.6rem', marginBottom: '0.4rem' }}>
                                <h4 style={{ 
                                    color: isFocused ? msgPrimary : theme.colors.primaryText, 
                                    margin: '0', 
                                    fontSize: isFocused ? '1.1rem' : '1rem',
                                    fontWeight: '600',
                                    cursor: isCollapsed ? 'pointer' : 'default',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    lineHeight: '1.3'
                                }}
                                onClick={isCollapsed ? () => toggleMessageCollapse(messageId) : undefined}
                                >
                                    {message.subject}
                                </h4>
                                <span 
                                    style={{ 
                                        color: msgAccent, 
                                        fontSize: '0.75rem', 
                                        fontWeight: '600',
                                        cursor: 'pointer',
                                        background: `${msgPrimary}12`,
                                        padding: '0.2rem 0.6rem',
                                        borderRadius: '8px',
                                        border: `1px solid ${msgPrimary}20`,
                                        transition: 'all 0.2s ease'
                                    }}
                                    onClick={() => navigate(`/msg/${message.id}`)}
                                    title="Click to focus this message"
                                >
                                    #{message.id.toString()}
                                </span>
                            </div>
                            
                            {/* Time and Header Toggle */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                                <span style={{ 
                                    color: theme.colors.mutedText, 
                                    fontSize: '0.8rem',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '0.4rem'
                                }}
                                title={getFullDate(message.created_at)}
                                >
                                    <FaClock size={11} style={{ opacity: 0.7 }} />
                                    {getRelativeTime(message.created_at)}
                                </span>
                                <button
                                    onClick={() => toggleHeaderCollapse(messageId)}
                                    style={{
                                        background: `${theme.colors.tertiaryBg}`,
                                        border: `1px solid ${theme.colors.border}`,
                                        color: theme.colors.mutedText,
                                        fontSize: '0.75rem',
                                        cursor: 'pointer',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '0.3rem',
                                        padding: '0.25rem 0.6rem',
                                        borderRadius: '6px',
                                        transition: 'all 0.2s ease'
                                    }}
                                    title={isHeaderCollapsed ? 'Show details' : 'Hide details'}
                                >
                                    {isHeaderCollapsed ? <FaChevronRight size={8} /> : <FaChevronDown size={8} />}
                                    Details
                                </button>
                            </div>

                            {/* Expandable From/To Details */}
                            {!isCollapsed && !isHeaderCollapsed && (
                                <div style={{ 
                                    marginTop: '1rem',
                                    padding: '1rem',
                                    background: `linear-gradient(135deg, ${theme.colors.primaryBg}80, ${theme.colors.secondaryBg})`,
                                    borderRadius: '12px',
                                    border: `1px solid ${theme.colors.border}`,
                                    backdropFilter: 'blur(4px)'
                                }}>
                                    <div style={{ marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                                        <div style={{
                                            width: '24px',
                                            height: '24px',
                                            borderRadius: '6px',
                                            background: `${msgPrimary}15`,
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center'
                                        }}>
                                            <FaUser size={10} style={{ color: msgPrimary }} />
                                        </div>
                                        <span style={{ color: theme.colors.mutedText, fontSize: '0.8rem', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.5px' }}>From</span>
                                        <PrincipalDisplay 
                                            principal={message.sender} 
                                            displayInfo={principalDisplayInfo.get(message.sender.toString())}
                                            showCopyButton={false}
                                            short={true}
                                            style={{ color: theme.colors.primaryText, fontSize: '0.9rem', fontWeight: '500' }}
                                        />
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.6rem' }}>
                                        <div style={{
                                            width: '24px',
                                            height: '24px',
                                            borderRadius: '6px',
                                            background: `${theme.colors.success}15`,
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            flexShrink: 0
                                        }}>
                                            <FaUsers size={10} style={{ color: theme.colors.success }} />
                                        </div>
                                        <span style={{ color: theme.colors.mutedText, fontSize: '0.8rem', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.5px', marginTop: '2px' }}>To</span>
                                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', alignItems: 'center' }}>
                                            {message.recipients.map((recipient, idx) => (
                                                <span key={idx} style={{ display: 'inline-flex', alignItems: 'center' }}>
                                                    <PrincipalDisplay 
                                                        principal={recipient} 
                                                        displayInfo={principalDisplayInfo.get(recipient.toString())}
                                                        showCopyButton={false}
                                                        short={true}
                                                        style={{ color: theme.colors.primaryText, fontSize: '0.9rem', fontWeight: '500' }}
                                                    />
                                                    {idx < message.recipients.length - 1 && <span style={{ color: theme.colors.mutedText, marginLeft: '0.25rem' }}>,</span>}
                                                </span>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Collapsible Content */}
                    {!isCollapsed && (
                        <>
                            {/* Message Body */}
                            <div style={{ 
                                marginTop: '0.75rem',
                                marginBottom: '1rem',
                                padding: '1rem',
                                background: theme.colors.primaryBg,
                                borderRadius: '10px',
                                border: `1px solid ${theme.colors.border}`,
                                borderLeft: `3px solid ${msgAccent}40`
                            }}>
                                <MarkdownBody
                                    text={displayBody}
                                    style={{
                                        color: theme.colors.secondaryText,
                                        fontSize: '0.95rem',
                                        lineHeight: '1.7',
                                        wordBreak: 'break-word'
                                    }}
                                />
                                {isLongMessage && (
                                    <button
                                        onClick={() => toggleMessageExpansion(messageId)}
                                        style={{
                                            background: `${msgPrimary}10`,
                                            border: `1px solid ${msgPrimary}30`,
                                            color: msgPrimary,
                                            cursor: 'pointer',
                                            fontSize: '0.8rem',
                                            fontWeight: '600',
                                            marginTop: '0.75rem',
                                            padding: '0.4rem 0.8rem',
                                            borderRadius: '6px',
                                            transition: 'all 0.2s ease'
                                        }}
                                    >
                                        {isExpanded ? 'Show Less' : 'Show More'}
                                    </button>
                                )}
                            </div>

                            {/* Action Buttons */}
                            <div style={{ 
                                display: 'flex', 
                                gap: '0.5rem', 
                                flexWrap: 'wrap'
                            }}>
                                <button
                                    onClick={() => navigate(`/sms?reply=${message.id}`)}
                                    style={{
                                        background: `linear-gradient(135deg, ${msgPrimary}, ${msgSecondary})`,
                                        color: 'white',
                                        border: 'none',
                                        borderRadius: '8px',
                                        padding: '0.5rem 1rem',
                                        cursor: 'pointer',
                                        fontSize: '0.8rem',
                                        fontWeight: '600',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '0.4rem',
                                        boxShadow: `0 3px 10px ${msgPrimary}30`,
                                        transition: 'all 0.2s ease'
                                    }}
                                >
                                    <FaReply size={11} />
                                    Reply
                                </button>
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
                <style>{customStyles}</style>
                <Header />
                <main style={{ background: theme.colors.primaryGradient, minHeight: '100vh' }}>
                    {/* Hero Section */}
                    <div style={{
                        background: `linear-gradient(135deg, ${theme.colors.primaryBg} 0%, ${msgPrimary}15 50%, ${msgSecondary}10 100%)`,
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
                            background: `radial-gradient(circle, ${msgPrimary}20 0%, transparent 70%)`,
                            borderRadius: '50%',
                            pointerEvents: 'none'
                        }} />
                        <div style={{ maxWidth: '900px', margin: '0 auto', position: 'relative', zIndex: 1 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
                                <div className="msg-float" style={{
                                    width: '64px',
                                    height: '64px',
                                    minWidth: '64px',
                                    borderRadius: '16px',
                                    background: `linear-gradient(135deg, ${msgPrimary}, ${msgSecondary})`,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    boxShadow: `0 8px 30px ${msgPrimary}40`
                                }}>
                                    <FaEnvelope size={28} color="white" />
                                </div>
                                <div>
                                    <h1 style={{ color: theme.colors.primaryText, fontSize: '2rem', fontWeight: '700', margin: 0 }}>
                                        Message Thread
                                    </h1>
                                    <p style={{ color: theme.colors.secondaryText, fontSize: '1rem', margin: '0.35rem 0 0 0' }}>
                                        View conversation history
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Login Required */}
                    <div style={{ maxWidth: '900px', margin: '0 auto', padding: '2rem 1.5rem' }}>
                        <div className="msg-card-animate" style={{
                            background: theme.colors.secondaryBg,
                            borderRadius: '20px',
                            padding: '3rem 2rem',
                            textAlign: 'center',
                            border: `1px solid ${theme.colors.border}`,
                            opacity: 0,
                            animationDelay: '0.1s'
                        }}>
                            <div className="msg-float" style={{
                                width: '80px',
                                height: '80px',
                                margin: '0 auto 1.5rem',
                                borderRadius: '50%',
                                background: `linear-gradient(135deg, ${msgPrimary}, ${msgSecondary})`,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                boxShadow: `0 8px 30px ${msgPrimary}40`
                            }}>
                                <FaLock size={32} color="white" />
                            </div>
                            <h2 style={{ color: theme.colors.primaryText, fontSize: '1.5rem', marginBottom: '1rem', fontWeight: '600' }}>
                                Connect to View Thread
                            </h2>
                            <p style={{ color: theme.colors.secondaryText, maxWidth: '400px', margin: '0 auto', lineHeight: '1.6' }}>
                                Connect your wallet to view this message thread.
                            </p>
                        </div>
                    </div>
                </main>
            </div>
        );
    }

    if (loading) {
        return (
            <div className='page-container'>
                <style>{customStyles}</style>
                <Header />
                <main style={{ background: theme.colors.primaryGradient, minHeight: '100vh' }}>
                    {/* Hero Section */}
                    <div style={{
                        background: `linear-gradient(135deg, ${theme.colors.primaryBg} 0%, ${msgPrimary}15 50%, ${msgSecondary}10 100%)`,
                        borderBottom: `1px solid ${theme.colors.border}`,
                        padding: '2rem 1.5rem',
                        position: 'relative',
                        overflow: 'hidden'
                    }}>
                        <div style={{ maxWidth: '900px', margin: '0 auto', position: 'relative', zIndex: 1 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
                                <div className="msg-float" style={{
                                    width: '64px',
                                    height: '64px',
                                    minWidth: '64px',
                                    borderRadius: '16px',
                                    background: `linear-gradient(135deg, ${msgPrimary}, ${msgSecondary})`,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    boxShadow: `0 8px 30px ${msgPrimary}40`
                                }}>
                                    <FaEnvelope size={28} color="white" />
                                </div>
                                <div>
                                    <h1 style={{ color: theme.colors.primaryText, fontSize: '2rem', fontWeight: '700', margin: 0 }}>
                                        Message Thread
                                    </h1>
                                    <p style={{ color: theme.colors.secondaryText, fontSize: '1rem', margin: '0.35rem 0 0 0' }}>
                                        Loading conversation...
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Loading State */}
                    <div style={{ maxWidth: '900px', margin: '0 auto', padding: '2rem 1.5rem' }}>
                        <div style={{
                            background: theme.colors.secondaryBg,
                            borderRadius: '16px',
                            padding: '4rem 2rem',
                            textAlign: 'center',
                            border: `1px solid ${theme.colors.border}`
                        }}>
                            <div className="msg-pulse" style={{
                                width: '60px',
                                height: '60px',
                                borderRadius: '50%',
                                background: `linear-gradient(135deg, ${msgPrimary}, ${msgSecondary})`,
                                margin: '0 auto 1.5rem',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center'
                            }}>
                                <FaEnvelope size={24} color="white" />
                            </div>
                            <p style={{ color: theme.colors.secondaryText, fontSize: '1.1rem' }}>
                                Loading message thread...
                            </p>
                        </div>
                    </div>
                </main>
            </div>
        );
    }

    if (error) {
        return (
            <div className='page-container'>
                <style>{customStyles}</style>
                <Header />
                <main style={{ background: theme.colors.primaryGradient, minHeight: '100vh' }}>
                    {/* Hero Section */}
                    <div style={{
                        background: `linear-gradient(135deg, ${theme.colors.primaryBg} 0%, ${msgPrimary}15 50%, ${msgSecondary}10 100%)`,
                        borderBottom: `1px solid ${theme.colors.border}`,
                        padding: '2rem 1.5rem',
                        position: 'relative',
                        overflow: 'hidden'
                    }}>
                        <div style={{ maxWidth: '900px', margin: '0 auto', position: 'relative', zIndex: 1 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
                                <div style={{
                                    width: '64px',
                                    height: '64px',
                                    minWidth: '64px',
                                    borderRadius: '16px',
                                    background: `linear-gradient(135deg, ${theme.colors.error}, ${theme.colors.error}cc)`,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center'
                                }}>
                                    <FaEnvelope size={28} color="white" />
                                </div>
                                <div>
                                    <h1 style={{ color: theme.colors.primaryText, fontSize: '2rem', fontWeight: '700', margin: 0 }}>
                                        Message Thread
                                    </h1>
                                    <p style={{ color: theme.colors.error, fontSize: '1rem', margin: '0.35rem 0 0 0' }}>
                                        Error loading thread
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Error State */}
                    <div style={{ maxWidth: '900px', margin: '0 auto', padding: '2rem 1.5rem' }}>
                        <div style={{
                            background: `linear-gradient(135deg, ${theme.colors.error}15, ${theme.colors.error}08)`,
                            border: `1px solid ${theme.colors.error}30`,
                            borderRadius: '16px',
                            padding: '2rem',
                            marginBottom: '1.5rem'
                        }}>
                            <p style={{ color: theme.colors.error, margin: 0, fontSize: '1rem' }}>{error}</p>
                        </div>
                        <button 
                            onClick={() => navigate('/sms')}
                            style={{
                                background: `linear-gradient(135deg, ${msgPrimary}, ${msgSecondary})`,
                                color: 'white',
                                border: 'none',
                                borderRadius: '12px',
                                padding: '0.75rem 1.5rem',
                                cursor: 'pointer',
                                fontSize: '0.9rem',
                                fontWeight: '600',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '0.5rem',
                                boxShadow: `0 4px 15px ${msgPrimary}40`
                            }}
                        >
                            <FaArrowLeft size={14} />
                            Back to Messages
                        </button>
                    </div>
                </main>
            </div>
        );
    }

    // Get the focus message for hero subtitle
    const focusMessage = messageTree.get(focusMessageId);

    return (
        <div className='page-container'>
            <style>{customStyles}</style>
            <Header />
            <main style={{ background: theme.colors.primaryGradient, minHeight: '100vh' }}>
                {/* Hero Section */}
                <div style={{
                    background: `linear-gradient(135deg, ${theme.colors.primaryBg} 0%, ${msgPrimary}15 50%, ${msgSecondary}10 100%)`,
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
                        background: `radial-gradient(circle, ${msgPrimary}20 0%, transparent 70%)`,
                        borderRadius: '50%',
                        pointerEvents: 'none'
                    }} />
                    <div style={{
                        position: 'absolute',
                        bottom: '-30%',
                        left: '-5%',
                        width: '300px',
                        height: '300px',
                        background: `radial-gradient(circle, ${msgSecondary}15 0%, transparent 70%)`,
                        borderRadius: '50%',
                        pointerEvents: 'none'
                    }} />
                    
                    <div style={{ maxWidth: '900px', margin: '0 auto', position: 'relative', zIndex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem', marginBottom: '1rem' }}>
                            <div className="msg-float" style={{
                                width: '64px',
                                height: '64px',
                                minWidth: '64px',
                                maxWidth: '64px',
                                flexShrink: 0,
                                borderRadius: '16px',
                                background: `linear-gradient(135deg, ${msgPrimary}, ${msgSecondary})`,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                boxShadow: `0 8px 30px ${msgPrimary}40`
                            }}>
                                <FaEnvelope size={28} color="white" />
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <h1 style={{ 
                                    color: theme.colors.primaryText, 
                                    fontSize: '1.5rem', 
                                    fontWeight: '700', 
                                    margin: 0, 
                                    lineHeight: '1.2',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap'
                                }}>
                                    {focusMessage?.subject || 'Message Thread'}
                                </h1>
                                <p style={{ color: theme.colors.secondaryText, fontSize: '0.9rem', margin: '0.35rem 0 0 0' }}>
                                    Thread #{id}
                                </p>
                            </div>
                        </div>
                        
                        {/* Quick Stats */}
                        <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: theme.colors.secondaryText, fontSize: '0.9rem' }}>
                                <FaEnvelope size={14} style={{ color: msgPrimary }} />
                                <span><strong style={{ color: msgPrimary }}>{messageTree.size}</strong> message{messageTree.size !== 1 ? 's' : ''}</span>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Main Content */}
                <div style={{ maxWidth: '900px', margin: '0 auto', padding: '2rem 1.5rem' }}>
                    {/* Navigation Bar */}
                    <div style={{ 
                        display: 'flex', 
                        alignItems: 'center', 
                        justifyContent: 'space-between',
                        gap: '1rem', 
                        marginBottom: '1.5rem',
                        flexWrap: 'wrap'
                    }}>
                        <button 
                            onClick={() => navigate('/sms')}
                            style={{
                                background: theme.colors.tertiaryBg,
                                color: theme.colors.primaryText,
                                border: `1px solid ${theme.colors.border}`,
                                borderRadius: '10px',
                                padding: '0.6rem 1rem',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.5rem',
                                fontSize: '0.85rem',
                                fontWeight: '500',
                                transition: 'all 0.2s ease'
                            }}
                        >
                            <FaArrowLeft size={12} />
                            Back to Messages
                        </button>
                        
                        {/* Global Expand/Collapse Controls */}
                        {messageTree.size > 1 && (
                            <div style={{ display: 'flex', gap: '0.5rem' }}>
                                <button
                                    onClick={expandAll}
                                    style={{
                                        background: `${theme.colors.success}15`,
                                        color: theme.colors.success,
                                        border: `1px solid ${theme.colors.success}30`,
                                        borderRadius: '10px',
                                        padding: '0.6rem 1rem',
                                        cursor: 'pointer',
                                        fontSize: '0.85rem',
                                        fontWeight: '600',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '0.4rem',
                                        transition: 'all 0.2s ease'
                                    }}
                                >
                                    <FaExpandAlt size={12} />
                                    Expand All
                                </button>
                                <button
                                    onClick={collapseAll}
                                    style={{
                                        background: `${theme.colors.warning}15`,
                                        color: theme.colors.warning,
                                        border: `1px solid ${theme.colors.warning}30`,
                                        borderRadius: '10px',
                                        padding: '0.6rem 1rem',
                                        cursor: 'pointer',
                                        fontSize: '0.85rem',
                                        fontWeight: '600',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '0.4rem',
                                        transition: 'all 0.2s ease'
                                    }}
                                >
                                    <FaCompressAlt size={12} />
                                    Collapse All
                                </button>
                            </div>
                        )}
                    </div>

                    {/* Message Tree */}
                    {focusMessageId && messageTree.size > 0 && (
                        <div style={{ 
                            background: theme.colors.secondaryBg,
                            borderRadius: '16px',
                            padding: '1.5rem',
                            border: `1px solid ${theme.colors.border}`
                        }}>
                            {renderMessage(findTreeRoot())}
                        </div>
                    )}
                </div>
            </main>
        </div>
    );
};

export default Message;
