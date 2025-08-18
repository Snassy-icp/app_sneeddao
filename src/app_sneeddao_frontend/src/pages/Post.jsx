import React, { useState, useEffect } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useForum } from '../contexts/ForumContext';
import { useAuth } from '../AuthContext';
import { useSns } from '../contexts/SnsContext';
import ThreadViewer from '../components/ThreadViewer';
import Header from '../components/Header';
import './Post.css';

const Post = () => {
    const { id } = useParams(); // Get post ID from URL
    const [searchParams] = useSearchParams();
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

    const forumActor = createForumActor(identity);

    // Fetch post details to get the thread ID
    useEffect(() => {
        const fetchPostDetails = async () => {
            if (!forumActor || !id) return;

            try {
                setLoading(true);
                setError(null);

                console.log('Fetching post details for post ID:', id);
                const postResponse = await forumActor.get_post(Number(id));
                
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
    }, [forumActor, id]);

    const handleError = (error) => {
        console.error('Post page error:', error);
        setError(error.message || 'An error occurred');
    };

    if (!id) {
        return (
            <div className="post-page">
                <Header showSnsDropdown={true} />
                <div className="post-container">
                    <div className="error-state">
                        <h2>Post Not Found</h2>
                        <p>No post ID provided in the URL.</p>
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

    if (!threadId) {
        return (
            <div className="post-page">
                <Header showSnsDropdown={true} />
                <div className="post-container">
                    <div className="error-state">
                        <h2>Post Not Found</h2>
                        <p>Could not find the requested post.</p>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="post-page">
            <Header showSnsDropdown={true} />
            <div className="post-container">
                <ThreadViewer
                    forumActor={forumActor}
                    mode="post"
                    threadId={threadId}
                    focusedPostId={Number(id)}
                    selectedSnsRoot={currentSnsRoot}
                    isAuthenticated={isAuthenticated}
                    onError={handleError}
                    showCreatePost={true}
                    title={postDetails?.title ? `Post: ${postDetails.title}` : `Post #${id}`}
                />
            </div>
        </div>
    );
};

export default Post;
