import React, { useState, useEffect, useCallback, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import { Principal } from '@dfinity/principal';
import { PrincipalDisplay, getPrincipalDisplayInfoFromContext } from '../utils/PrincipalUtils';
import { useNaming } from '../NamingContext';

function Discussion({ 
    forumActor, 
    currentProposalId, 
    selectedSnsRoot, 
    isAuthenticated,
    onError 
}) {
    const { principalNames, principalNicknames } = useNaming();
    
    // State for discussion
    const [discussionThread, setDiscussionThread] = useState(null);
    const [discussionPosts, setDiscussionPosts] = useState([]);
    const [loadingDiscussion, setLoadingDiscussion] = useState(false);
    const [commentText, setCommentText] = useState('');
    const [showCommentForm, setShowCommentForm] = useState(false);
    const [submittingComment, setSubmittingComment] = useState(false);
    const [commentTitle, setCommentTitle] = useState('');
    const [principalDisplayInfo, setPrincipalDisplayInfo] = useState(new Map());
    
    // State for view mode and interactions
    const [viewMode, setViewMode] = useState('flat');
    const [collapsedPosts, setCollapsedPosts] = useState(new Set());
    const [replyingTo, setReplyingTo] = useState(null);
    const [replyText, setReplyText] = useState('');
    
    // Ref for reply text to avoid re-renders
    const replyTextRef = useRef('');

    // Fetch discussion thread
    const fetchDiscussionThread = async () => {
        if (!forumActor || !currentProposalId || !selectedSnsRoot) return;
        
        setLoadingDiscussion(true);
        try {
            console.log('Fetching discussion thread with params:', {
                currentProposalId,
                selectedSnsRoot,
                forumActor: !!forumActor
            });
            
            const threadMapping = await forumActor.get_proposal_thread(
                Principal.fromText(selectedSnsRoot),
                Number(currentProposalId)
            );
            
            console.log('Thread mapping result:', threadMapping);
            
            if (threadMapping && threadMapping.length > 0) {
                const mapping = Array.isArray(threadMapping) ? threadMapping[0] : threadMapping;
                if (mapping && mapping.thread_id) {
                    console.log('Found thread mapping:', mapping);
                    setDiscussionThread(mapping);
                    await fetchDiscussionPosts(Number(mapping.thread_id));
                } else {
                    console.log('No valid thread mapping found');
                    setDiscussionThread(null);
                    setDiscussionPosts([]);
                }
            } else {
                console.log('No thread mapping found for proposal ID:', currentProposalId);
                setDiscussionThread(null);
                setDiscussionPosts([]);
            }
        } catch (err) {
            console.error('Error fetching discussion thread:', err);
            setDiscussionThread(null);
            setDiscussionPosts([]);
        } finally {
            setLoadingDiscussion(false);
        }
    };

    // Fetch discussion posts
    const fetchDiscussionPosts = async (threadId) => {
        if (!forumActor || !threadId) return;
        
        try {
            console.log('Fetching posts for thread ID:', threadId);
            const posts = await forumActor.get_posts_by_thread(Number(threadId));
            console.log('Posts result:', posts);
            console.log('Posts length:', posts.length);
            console.log('Posts type:', typeof posts);
            
            // Handle BigInt serialization for logging
            try {
                const postsForLogging = posts.map(post => ({
                    ...post,
                    id: post.id.toString(),
                    created_at: post.created_at.toString(),
                    upvote_score: post.upvote_score.toString(),
                    downvote_score: post.downvote_score.toString()
                }));
                console.log('Posts data:', JSON.stringify(postsForLogging, null, 2));
            } catch (serializationError) {
                console.log('Could not serialize posts for logging, but posts were fetched');
                console.log('Posts count:', posts.length);
            }
            
            setDiscussionPosts(posts || []);
        } catch (err) {
            console.error('Error fetching discussion posts:', err);
            setDiscussionPosts([]);
        }
    };

    // Create proposal thread
    const createProposalThread = async (firstCommentText) => {
        if (!forumActor || !currentProposalId || !selectedSnsRoot) return null;
        
        try {
            const threadInput = {
                proposal_id: Number(currentProposalId),
                sns_root_canister_id: Principal.fromText(selectedSnsRoot),
                title: [`Discussion for Proposal ${currentProposalId}`],
                body: firstCommentText
            };

            const result = await forumActor.create_proposal_thread(threadInput);
            if ('ok' in result) {
                console.log('Thread created successfully, thread ID:', result.ok);
                return result.ok;
            } else {
                console.error('Failed to create thread:', result.err);
                if (onError) onError('Failed to create discussion thread: ' + JSON.stringify(result.err));
                return null;
            }
        } catch (err) {
            console.error('Error creating proposal thread:', err);
            if (onError) onError('Error creating proposal thread: ' + err.message);
            return null;
        }
    };

    // Submit comment
    const submitComment = async () => {
        if (!commentText.trim() || !forumActor) return;
        
        setSubmittingComment(true);
        try {
            let threadId = discussionThread?.thread_id;
            let newThreadCreated = false;
            
            // Create thread if it doesn't exist
            if (!threadId) {
                threadId = await createProposalThread(commentText);
                if (!threadId) {
                    return; // Error already handled in createProposalThread
                }
                newThreadCreated = true;
            }

            // Create post if thread already exists or after creating new thread
            if (!newThreadCreated) {
                const postInput = {
                    thread_id: Number(threadId),
                    reply_to_post_id: [],
                    title: commentTitle && commentTitle.trim() ? [commentTitle.trim()] : [],
                    body: commentText
                };

                const dummyNeuronId = { id: new Uint8Array([0, 0, 0, 0, 0, 0, 0, 1]) };
                
                const result = await forumActor.create_post(postInput, dummyNeuronId);
                if ('ok' in result) {
                    console.log('Comment created successfully, post ID:', result.ok);
                } else {
                    console.error('Failed to create comment:', result.err);
                    if (onError) onError('Failed to create comment: ' + JSON.stringify(result.err));
                    return;
                }
            }

            // Clear form and refresh
            setCommentText('');
            setCommentTitle('');
            setShowCommentForm(false);
            
            // Refresh discussion thread or posts
            if (newThreadCreated) {
                await fetchDiscussionThread();
            } else {
                await fetchDiscussionPosts(Number(threadId));
            }
        } catch (err) {
            console.error('Error submitting comment:', err);
            if (onError) onError('Failed to submit comment: ' + err.message);
        } finally {
            setSubmittingComment(false);
        }
    };

    // Helper functions for post organization
    const calculatePostScore = (post) => {
        return Number(post.upvote_score) - Number(post.downvote_score);
    };

    // Helper function to find a post by ID
    const findPostById = (posts, postId) => {
        return posts.find(post => Number(post.id) === Number(postId));
    };

    // Helper function to generate reply title
    const generateReplyTitle = (parentPost) => {
        if (!parentPost) return null;
        
        // If parent has a title
        if (parentPost.title && parentPost.title.length > 0) {
            const parentTitle = parentPost.title[0];
            // Check if it already starts with "Re: "
            if (parentTitle.startsWith('Re: ')) {
                return parentTitle; // Don't add another "Re: "
            } else {
                return `Re: ${parentTitle}`;
            }
        }
        
        return null; // No title to reply to
    };

    const organizePostsFlat = (posts) => {
        // Sort by post ID (chronological)
        return [...posts].sort((a, b) => Number(a.id) - Number(b.id));
    };

    const organizePostsTree = (posts) => {
        const postMap = new Map();
        const rootPosts = [];
        
        // Create a map of all posts
        posts.forEach(post => {
            postMap.set(Number(post.id), { ...post, replies: [] });
        });
        
        // Organize into tree structure
        posts.forEach(post => {
            const postData = postMap.get(Number(post.id));
            if (post.reply_to_post_id && post.reply_to_post_id.length > 0) {
                const parentId = Number(post.reply_to_post_id[0]);
                const parent = postMap.get(parentId);
                if (parent) {
                    parent.replies.push(postData);
                } else {
                    rootPosts.push(postData);
                }
            } else {
                rootPosts.push(postData);
            }
        });
        
        // Sort replies by score (highest first)
        const sortRepliesByScore = (post) => {
            post.replies.sort((a, b) => calculatePostScore(b) - calculatePostScore(a));
            post.replies.forEach(sortRepliesByScore);
        };
        
        // Sort root posts by ID (chronological) and then sort all replies by score
        rootPosts.sort((a, b) => Number(a.id) - Number(b.id));
        rootPosts.forEach(sortRepliesByScore);
        
        return rootPosts;
    };

    const togglePostCollapse = (postId) => {
        const newCollapsed = new Set(collapsedPosts);
        if (newCollapsed.has(postId)) {
            newCollapsed.delete(postId);
        } else {
            newCollapsed.add(postId);
        }
        setCollapsedPosts(newCollapsed);
    };

    const submitReply = async (parentPostId, replyText) => {
        if (!replyText.trim() || !forumActor || !discussionThread) return;
        
        setSubmittingComment(true);
        try {
            // Find the parent post to generate reply title
            const parentPost = findPostById(discussionPosts, parentPostId);
            const replyTitle = generateReplyTitle(parentPost);
            
            const postInput = {
                thread_id: Number(discussionThread.thread_id),
                reply_to_post_id: [Number(parentPostId)],
                title: replyTitle ? [replyTitle] : [],
                body: replyText
            };

            const dummyNeuronId = { id: new Uint8Array([0, 0, 0, 0, 0, 0, 0, 1]) };
            
            const result = await forumActor.create_post(postInput, dummyNeuronId);
            if ('ok' in result) {
                console.log('Reply created successfully, post ID:', result.ok);
                setReplyText('');
                setReplyingTo(null);
                replyTextRef.current = '';
                
                // Refresh posts
                await fetchDiscussionPosts(Number(discussionThread.thread_id));
            } else {
                console.error('Failed to create reply:', result.err);
                if (onError) onError('Failed to create reply: ' + JSON.stringify(result.err));
            }
        } catch (err) {
            console.error('Error submitting reply:', err);
            if (onError) onError('Failed to submit reply: ' + err.message);
        } finally {
            setSubmittingComment(false);
        }
    };

    // Component to render individual posts
    const PostComponent = useCallback(({ post, depth = 0, isFlat = false }) => {
        const score = calculatePostScore(post);
        const isNegative = score < 0;
        const isCollapsed = collapsedPosts.has(Number(post.id)) || (isNegative && !collapsedPosts.has(Number(post.id)));
        const isReplying = replyingTo === Number(post.id);
        
        // Find parent post if this is a reply (for flat mode)
        const parentPost = isFlat && post.reply_to_post_id && post.reply_to_post_id.length > 0 
            ? findPostById(discussionPosts, post.reply_to_post_id[0])
            : null;
        
        // Generate reply title if this is a reply
        const replyTitle = parentPost ? generateReplyTitle(parentPost) : null;
        
        return (
            <div 
                key={post.id}
                style={{
                    marginLeft: isFlat ? '0' : `${depth * 20}px`,
                    marginBottom: '10px'
                }}
            >
                <div style={{
                    backgroundColor: isNegative ? '#3a2a2a' : '#2a2a2a',
                    border: isNegative ? '1px solid #8b4513' : '1px solid #4a4a4a',
                    borderRadius: '6px',
                    padding: '15px'
                }}>
                    {/* Post Header */}
                    <div style={{ 
                        display: 'flex', 
                        justifyContent: 'space-between', 
                        alignItems: 'center',
                        marginBottom: isCollapsed ? '0' : '10px'
                    }}>
                        <div style={{ 
                            color: '#888', 
                            fontSize: '14px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '10px'
                        }}>
                            <span>By: <PrincipalDisplay 
                                principal={post.created_by} 
                                displayInfo={principalDisplayInfo.get(post.created_by?.toString())}
                                showCopyButton={false} 
                            /></span>
                            <span>•</span>
                            <span>{new Date(Number(post.created_at) / 1000000).toLocaleString()}</span>
                            {isFlat && parentPost && (
                                <>
                                    <span>•</span>
                                    <span style={{ color: '#3498db' }}>
                                        Reply to #{Number(post.reply_to_post_id[0])}
                                        {parentPost.title && parentPost.title.length > 0 && (
                                            <span>: {parentPost.title[0]}</span>
                                        )}
                                    </span>
                                </>
                            )}
                            {isNegative && (
                                <>
                                    <span>•</span>
                                    <span style={{ color: '#ff6b6b' }}>Low Score</span>
                                </>
                            )}
                        </div>
                        <div style={{ 
                            display: 'flex', 
                            alignItems: 'center', 
                            gap: '10px'
                        }}>
                            <div style={{ 
                                display: 'flex', 
                                alignItems: 'center', 
                                gap: '10px',
                                color: '#888',
                                fontSize: '14px'
                            }}>
                                <span style={{ color: score > 0 ? '#2ecc71' : score < 0 ? '#e74c3c' : '#888' }}>
                                    {score > 0 ? '+' : ''}{score}
                                </span>
                                <span style={{ color: '#2ecc71' }}>↑{post.upvote_score}</span>
                                <span style={{ color: '#e74c3c' }}>↓{post.downvote_score}</span>
                            </div>
                            {(isNegative || isCollapsed) && (
                                <button
                                    onClick={() => togglePostCollapse(Number(post.id))}
                                    style={{
                                        backgroundColor: 'transparent',
                                        border: '1px solid #666',
                                        color: '#888',
                                        borderRadius: '4px',
                                        padding: '4px 8px',
                                        cursor: 'pointer',
                                        fontSize: '12px'
                                    }}
                                >
                                    {isCollapsed ? 'Expand' : 'Collapse'}
                                </button>
                            )}
                        </div>
                    </div>

                    {/* Post Content */}
                    {!isCollapsed && (
                        <>
                            {/* Show post title if it exists and it's not a duplicate of reply title */}
                            {post.title && post.title.length > 0 && !replyTitle && (
                                <div style={{ 
                                    color: '#ffffff', 
                                    fontSize: '18px', 
                                    fontWeight: 'bold', 
                                    marginBottom: '10px' 
                                }}>
                                    {post.title[0]}
                                </div>
                            )}
                            
                            {/* Show reply title if this is a reply */}
                            {replyTitle && (
                                <div style={{ 
                                    color: '#ffc107', 
                                    fontSize: '16px', 
                                    fontWeight: 'bold', 
                                    marginBottom: '8px' 
                                }}>
                                    {replyTitle}
                                </div>
                            )}
                            
                            <div style={{ color: '#ffffff', lineHeight: '1.6', marginBottom: '10px' }}>
                                <ReactMarkdown>{post.body}</ReactMarkdown>
                            </div>
                            
                            {/* Action Buttons */}
                            {isAuthenticated && (
                                <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                                    <button
                                        onClick={() => {
                                            if (isReplying) {
                                                setReplyingTo(null);
                                                setReplyText('');
                                            } else {
                                                setReplyingTo(Number(post.id));
                                                setReplyText('');
                                            }
                                        }}
                                        style={{
                                            backgroundColor: 'transparent',
                                            border: '1px solid #3498db',
                                            color: '#3498db',
                                            borderRadius: '4px',
                                            padding: '6px 12px',
                                            cursor: 'pointer',
                                            fontSize: '12px'
                                        }}
                                    >
                                        {isReplying ? 'Cancel Reply' : 'Reply'}
                                    </button>
                                </div>
                            )}

                            {/* Reply Form */}
                            {isReplying && (
                                <div style={{ marginTop: '15px', padding: '15px', backgroundColor: '#1a1a1a', borderRadius: '4px' }}>
                                    <textarea
                                        defaultValue=""
                                        onChange={(e) => {
                                            replyTextRef.current = e.target.value;
                                            setReplyText(e.target.value);
                                        }}
                                        placeholder={`Reply to ${post.created_by.toString().slice(0, 8)}...`}
                                        style={{
                                            width: '100%',
                                            minHeight: '80px',
                                            backgroundColor: '#2a2a2a',
                                            border: '1px solid #4a4a4a',
                                            borderRadius: '4px',
                                            color: '#ffffff',
                                            padding: '10px',
                                            fontSize: '14px',
                                            resize: 'vertical',
                                            marginBottom: '10px'
                                        }}
                                    />
                                    <div style={{ marginTop: '10px', display: 'flex', gap: '10px' }}>
                                        <button
                                            onClick={() => submitReply(post.id, replyTextRef.current)}
                                            disabled={!replyTextRef.current?.trim()}
                                            style={{
                                                padding: '8px 16px',
                                                backgroundColor: replyTextRef.current?.trim() ? '#4CAF50' : '#333',
                                                color: replyTextRef.current?.trim() ? 'white' : '#666',
                                                border: 'none',
                                                borderRadius: '4px',
                                                cursor: replyTextRef.current?.trim() ? 'pointer' : 'not-allowed'
                                            }}
                                        >
                                            Submit Reply
                                        </button>
                                        <button
                                            onClick={() => {
                                                setReplyingTo(null);
                                                setReplyText('');
                                                replyTextRef.current = '';
                                            }}
                                            style={{
                                                padding: '8px 16px',
                                                backgroundColor: '#666',
                                                color: 'white',
                                                border: 'none',
                                                borderRadius: '4px',
                                                cursor: 'pointer'
                                            }}
                                        >
                                            Cancel
                                        </button>
                                    </div>
                                </div>
                            )}
                        </>
                    )}
                </div>

                {/* Render replies in tree mode */}
                {!isFlat && !isCollapsed && post.replies && post.replies.length > 0 && (
                    <div style={{ marginTop: '10px' }}>
                        {post.replies.map(reply => (
                            <PostComponent 
                                key={reply.id} 
                                post={reply} 
                                depth={depth + 1} 
                                isFlat={false}
                            />
                        ))}
                    </div>
                )}
            </div>
        );
    }, [collapsedPosts, replyingTo, discussionPosts, principalDisplayInfo]);

    // Effect to fetch discussion when props change
    useEffect(() => {
        if (forumActor && currentProposalId && selectedSnsRoot) {
            fetchDiscussionThread();
        }
    }, [forumActor, currentProposalId, selectedSnsRoot]);

    // Effect to fetch principal display info
    useEffect(() => {
        const fetchPrincipalInfo = async () => {
            if (!discussionPosts.length || !principalNames || !principalNicknames) return;

            const uniquePrincipals = new Set();
            discussionPosts.forEach(post => {
                if (post.created_by) {
                    uniquePrincipals.add(post.created_by.toString());
                }
            });

            const displayInfoMap = new Map();
            Array.from(uniquePrincipals).forEach(principal => {
                try {
                    const displayInfo = getPrincipalDisplayInfoFromContext(
                        Principal.fromText(principal), 
                        principalNames, 
                        principalNicknames
                    );
                    displayInfoMap.set(principal, displayInfo);
                } catch (error) {
                    console.error('Error processing principal:', principal, error);
                }
            });

            setPrincipalDisplayInfo(displayInfoMap);
        };

        fetchPrincipalInfo();
    }, [discussionPosts, principalNames, principalNicknames]);

    return (
        <div style={{ marginTop: '20px' }}>
            <h2 style={{ color: '#ffffff', marginBottom: '15px' }}>Discussion</h2>
            
            {loadingDiscussion ? (
                <div style={{ 
                    backgroundColor: '#3a3a3a', 
                    padding: '20px', 
                    borderRadius: '6px',
                    textAlign: 'center',
                    color: '#888'
                }}>
                    Loading discussion...
                </div>
            ) : (
                <div style={{ backgroundColor: '#3a3a3a', padding: '15px', borderRadius: '6px' }}>
                    {discussionThread && (
                        <div style={{ marginBottom: '20px' }}>
                            <h3 style={{ color: '#ffffff', marginBottom: '15px' }}>Discussion</h3>
                            
                            {/* View Mode Toggle */}
                            <div style={{ 
                                display: 'flex', 
                                gap: '10px', 
                                marginBottom: '20px',
                                alignItems: 'center'
                            }}>
                                <span style={{ color: '#888', fontSize: '14px' }}>View:</span>
                                <button
                                    onClick={() => setViewMode('flat')}
                                    style={{
                                        backgroundColor: viewMode === 'flat' ? '#3498db' : 'transparent',
                                        border: '1px solid #3498db',
                                        color: viewMode === 'flat' ? '#ffffff' : '#3498db',
                                        borderRadius: '4px',
                                        padding: '6px 12px',
                                        cursor: 'pointer',
                                        fontSize: '12px'
                                    }}
                                >
                                    Flat
                                </button>
                                <button
                                    onClick={() => setViewMode('tree')}
                                    style={{
                                        backgroundColor: viewMode === 'tree' ? '#3498db' : 'transparent',
                                        border: '1px solid #3498db',
                                        color: viewMode === 'tree' ? '#ffffff' : '#3498db',
                                        borderRadius: '4px',
                                        padding: '6px 12px',
                                        cursor: 'pointer',
                                        fontSize: '12px'
                                    }}
                                >
                                    Tree
                                </button>
                                <span style={{ color: '#666', fontSize: '12px', marginLeft: '10px' }}>
                                    {discussionPosts.length} {discussionPosts.length === 1 ? 'comment' : 'comments'}
                                </span>
                            </div>

                            {/* Posts Display */}
                            {discussionPosts.length > 0 ? (
                                <div style={{ marginBottom: '20px' }}>
                                    {viewMode === 'flat' ? (
                                        // Flat view - chronological order
                                        organizePostsFlat(discussionPosts).map(post => (
                                            <PostComponent 
                                                key={post.id} 
                                                post={post} 
                                                isFlat={true}
                                            />
                                        ))
                                    ) : (
                                        // Tree view - hierarchical with score sorting
                                        organizePostsTree(discussionPosts).map(post => (
                                            <PostComponent 
                                                key={post.id} 
                                                post={post} 
                                                isFlat={false}
                                            />
                                        ))
                                    )}
                                </div>
                            ) : (
                                <div style={{ 
                                    color: '#888', 
                                    fontStyle: 'italic', 
                                    textAlign: 'center',
                                    padding: '20px',
                                    backgroundColor: '#1a1a1a',
                                    borderRadius: '6px',
                                    marginBottom: '20px'
                                }}>
                                    No comments yet. Be the first to start the discussion!
                                </div>
                            )}
                        </div>
                    )}

                    {/* Comment Form */}
                    {isAuthenticated ? (
                        <div>
                            {!showCommentForm ? (
                                <button
                                    onClick={() => setShowCommentForm(true)}
                                    style={{
                                        backgroundColor: '#3498db',
                                        color: '#ffffff',
                                        border: 'none',
                                        borderRadius: '4px',
                                        padding: '10px 20px',
                                        cursor: 'pointer',
                                        fontSize: '14px',
                                        width: '100%'
                                    }}
                                >
                                    {discussionPosts.length === 0 ? 'Be the first to comment' : 'Add a comment'}
                                </button>
                            ) : (
                                <div style={{ marginTop: '15px' }}>
                                    <input
                                        type="text"
                                        value={commentTitle}
                                        onChange={(e) => setCommentTitle(e.target.value)}
                                        placeholder="Title (optional)"
                                        style={{
                                            width: '100%',
                                            backgroundColor: '#2a2a2a',
                                            border: '1px solid #4a4a4a',
                                            borderRadius: '4px',
                                            color: '#ffffff',
                                            padding: '10px',
                                            fontSize: '14px',
                                            marginBottom: '10px'
                                        }}
                                    />
                                    <textarea
                                        value={commentText}
                                        onChange={(e) => setCommentText(e.target.value)}
                                        placeholder="Share your thoughts on this proposal..."
                                        style={{
                                            width: '100%',
                                            minHeight: '100px',
                                            backgroundColor: '#2a2a2a',
                                            border: '1px solid #4a4a4a',
                                            borderRadius: '4px',
                                            color: '#ffffff',
                                            padding: '10px',
                                            fontSize: '14px',
                                            resize: 'vertical',
                                            marginBottom: '10px'
                                        }}
                                    />
                                    <div style={{ display: 'flex', gap: '10px' }}>
                                        <button
                                            onClick={submitComment}
                                            disabled={!commentText.trim() || submittingComment}
                                            style={{
                                                backgroundColor: commentText.trim() ? '#2ecc71' : '#666',
                                                color: '#ffffff',
                                                border: 'none',
                                                borderRadius: '4px',
                                                padding: '8px 16px',
                                                cursor: commentText.trim() && !submittingComment ? 'pointer' : 'not-allowed',
                                                fontSize: '14px'
                                            }}
                                        >
                                            {submittingComment ? 'Posting...' : 'Post Comment'}
                                        </button>
                                        <button
                                            onClick={() => {
                                                setShowCommentForm(false);
                                                setCommentText('');
                                                setCommentTitle('');
                                            }}
                                            style={{
                                                backgroundColor: '#666',
                                                color: '#ffffff',
                                                border: 'none',
                                                borderRadius: '4px',
                                                padding: '8px 16px',
                                                cursor: 'pointer',
                                                fontSize: '14px'
                                            }}
                                        >
                                            Cancel
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    ) : (
                        <div style={{ 
                            textAlign: 'center', 
                            color: '#888', 
                            padding: '20px',
                            backgroundColor: '#2a2a2a',
                            borderRadius: '4px'
                        }}>
                            Please connect your wallet to participate in the discussion.
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

export default Discussion; 