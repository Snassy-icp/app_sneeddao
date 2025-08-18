import React from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useForum } from '../contexts/ForumContext';
import { useAuth } from '../AuthContext';
import { useSns } from '../contexts/SnsContext';
import ThreadViewer from '../components/ThreadViewer';
import Header from '../components/Header';
import './Thread.css';

const Thread = () => {
    const { id } = useParams(); // Get thread ID from URL
    const [searchParams] = useSearchParams();
    const { createForumActor } = useForum();
    const { isAuthenticated, identity } = useAuth();
    const { selectedSnsRoot } = useSns();

    // Get SNS from URL params if provided
    const snsParam = searchParams.get('sns');
    const currentSnsRoot = snsParam || selectedSnsRoot;

    const forumActor = createForumActor(identity);

    const handleError = (error) => {
        console.error('Thread page error:', error);
    };

    if (!id) {
        return (
            <div className="thread-page">
                <Header showSnsDropdown={true} />
                <div className="thread-container">
                    <div className="error-state">
                        <h2>Thread Not Found</h2>
                        <p>No thread ID provided in the URL.</p>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="thread-page">
            <Header showSnsDropdown={true} />
            <div className="thread-container">
                <ThreadViewer
                    forumActor={forumActor}
                    mode="thread"
                    threadId={Number(id)}
                    selectedSnsRoot={currentSnsRoot}
                    isAuthenticated={isAuthenticated}
                    onError={handleError}
                    showCreatePost={true}
                />
            </div>
        </div>
    );
};

export default Thread;
