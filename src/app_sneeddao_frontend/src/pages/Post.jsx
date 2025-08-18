import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useForum } from '../contexts/ForumContext';
import { useAuth } from '../AuthContext';
import { useSns } from '../contexts/SnsContext';
import ThreadViewer from '../components/ThreadViewer';
import Header from '../components/Header';
import './Post.css';

const Post = () => {
    const [searchParams] = useSearchParams();
    const postId = searchParams.get('postid'); // Get post ID from query params
    const { createForumActor } = useForum();
    const { isAuthenticated, identity } = useAuth();
    const { selectedSnsRoot } = useSns();

    const [threadId, setThreadId] = useState(null);
    const [postDetails, setPostDetails] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    // Get SNS from URL params if provided
    const snsParam = searchParams.get('sns');
    const currentSnsRoot = snsParam || selectedSnsRoot;

    // Memoize forumActor to prevent unnecessary re-renders
    const forumActor = useMemo(() => {
        return identity ? createForumActor(identity) : null;
    }, [identity, createForumActor]);

    // Fetch post details to get the thread ID
    useEffect(() => {
        const fetchPostDetails = async () => {
            if (!forumActor || !postId) return;

            try {
                setLoading(true);
                setError(null);

                console.log('Fetching post details for post ID:', postId);
                const postResponse = await forumActor.get_post(Number(postId));
                
                if (postResponse && postResponse.length > 0) {
                    const post = postResponse[0];
                    console.log('Post details:', post);
                    setPostDetails(post);
                    setThreadId(Number(post.thread_id));
                } else {
                    setError('Post not found');
                }
            } catch (err) {
                console.error('Error fetching post details:', err);
                setError(err.message || 'Failed to load post');
            } finally {
                setLoading(false);
            }
        };

        fetchPostDetails();
    }, [forumActor, postId]);

    const handleError = useCallback((error) => {
        console.error('Post page error:', error);
        setError(error.message || 'An error occurred');
    }, []);

    if (!postId) {
        return (
            <div className="post-page">
                <Header showSnsDropdown={true} />
                <div className="post-container">
                    <div className="error-state">
                        <h2>Post Not Found</h2>
                        <p>No post ID provided in the URL. Please use ?postid=123 format.</p>
                    </div>
                </div>
            </div>
        );
    }

    if (loading) {
        return (
            <div className="post-page">
                <Header showSnsDropdown={true} />
                <div className="post-container">
                    <div className="loading-state">
                        <div className="spinner"></div>
                        <p>Loading post...</p>
                    </div>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="post-page">
                <Header showSnsDropdown={true} />
                <div className="post-container">
                    <div className="error-state">
                        <h2>Error Loading Post</h2>
                        <p>{error}</p>
                    </div>
                </div>
            </div>
        );
    }

    // Only render ThreadViewer when we have successfully loaded the threadId
    if (!threadId) {
        // If we're not loading and have no error, but still no threadId, then post wasn't found
        if (!loading && !error) {
            return (
                <div className="post-page">
                    <Header showSnsDropdown={true} />
                    <div className="post-container">
                        <div className="error-state">
                            <h2>Post Not Found</h2>
                            <p>Could not find the requested post or determine its thread.</p>
                        </div>
                    </div>
                </div>
            );
        }
        // Otherwise, we're still loading or there's an error (handled above)
        return null;
    }

    return (
        <div className="post-page">
            <Header showSnsDropdown={true} />
            <div className="post-container">
                <ThreadViewer
                    forumActor={forumActor}
                    mode="post"
                    threadId={threadId}
                    focusedPostId={Number(postId)}
                    selectedSnsRoot={currentSnsRoot}
                    isAuthenticated={isAuthenticated}
                    onError={handleError}
                    showCreatePost={true}
                    title={postDetails?.title ? `Post: ${postDetails.title}` : `Post #${postId}`}
                />
            </div>
        </div>
    );
};

export default Post;
