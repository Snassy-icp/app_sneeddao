import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../../AuthContext';
import { useAdminCheck } from '../../hooks/useAdminCheck';
import { useForum } from '../../contexts/ForumContext';
import { useNavigate } from 'react-router-dom';
import Header from '../../components/Header';
import './Forum.css';
import { Principal } from '@dfinity/principal';
import { getTextLimits, updateTextLimits } from '../../utils/BackendUtils';
import { formatError } from '../../utils/errorUtils';

export default function Forum() {
  const { isAuthenticated, identity } = useAuth();
  const { createForumActor, loading: forumLoading, error: forumError } = useForum();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('forums');
  const [forumActor, setForumActor] = useState(null);
  const hasCheckedForumAdmin = useRef(false);
  
  // State for forums
  const [forums, setForums] = useState([]);
  const [topics, setTopics] = useState([]);
  const [threads, setThreads] = useState([]);
  const [posts, setPosts] = useState([]);
  const [stats, setStats] = useState(null);
  const [admins, setAdmins] = useState([]);
  const [proposalsTopic, setProposalsTopic] = useState(null);
  
  // State for text limits
  const [textLimits, setTextLimits] = useState(null);
  const [textLimitsLoading, setTextLimitsLoading] = useState(false);
  const [textLimitsError, setTextLimitsError] = useState('');
  const [updatingTextLimits, setUpdatingTextLimits] = useState(false);
  
  // Loading states
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [isForumAdmin, setIsForumAdmin] = useState(false);
  const [forumAdminCheckLoading, setForumAdminCheckLoading] = useState(true);
  const [forumAdminError, setForumAdminError] = useState('');
  
  // Form states
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [formData, setFormData] = useState({});
  const [selectedForum, setSelectedForum] = useState(null);
  const [selectedTopic, setSelectedTopic] = useState(null);
  const [selectedThread, setSelectedThread] = useState(null);
  const [showAddAdminForm, setShowAddAdminForm] = useState(false);
  const [newAdminPrincipal, setNewAdminPrincipal] = useState('');
  const [editingItem, setEditingItem] = useState(null);
  const [editingType, setEditingType] = useState(null);

  // Use backend admin check hook
  const { isAdmin: isBackendAdmin, loading: backendAdminLoading, error: backendAdminError } = useAdminCheck({ 
    identity, 
    isAuthenticated,
    redirectPath: '/wallet'
  });

  useEffect(() => {
    if (isAuthenticated && identity) {
      const actor = createForumActor(identity);
      setForumActor(actor);
      hasCheckedForumAdmin.current = false; // Reset when identity changes
    }
  }, [isAuthenticated, identity]);

  useEffect(() => {
    if (forumActor && isBackendAdmin && !hasCheckedForumAdmin.current) {
      hasCheckedForumAdmin.current = true;
      checkForumAdminStatus();
    }
  }, [forumActor, isBackendAdmin]);

  useEffect(() => {
    if (forumActor && isBackendAdmin && isForumAdmin) {
      fetchData();
    }
  }, [forumActor, activeTab, isBackendAdmin, isForumAdmin]);

  const checkForumAdminStatus = async () => {
    if (!forumActor) return;
    
    setForumAdminCheckLoading(true);
    setForumAdminError('');
    try {
      const adminResult = await forumActor.is_admin(identity.getPrincipal());
      setIsForumAdmin(adminResult);
      if (!adminResult) {
        setForumAdminError('You are not an admin in the forum canister. Please contact an existing forum admin to add you.');
      }
    } catch (err) {
      console.error('Error checking forum admin status:', err);
      setForumAdminError('Error checking forum admin status: ' + err.message);
    } finally {
      setForumAdminCheckLoading(false);
    }
  };

  const fetchData = async () => {
    if (!forumActor) return;
    
    setLoading(true);
    try {
      switch (activeTab) {
        case 'forums':
          await fetchForums();
          break;
        case 'topics':
          await fetchTopics();
          break;
        case 'threads':
          await fetchThreads();
          break;
        case 'posts':
          await fetchPosts();
          break;
        case 'stats':
          await fetchStats();
          break;
        case 'textlimits':
          await fetchTextLimits();
          break;
      }
      setError('');
    } catch (err) {
      console.error('Error fetching data:', err);
      setError('Failed to fetch data: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchForums = async () => {
    try {
      // Use admin endpoint to see deleted items
      const result = await forumActor.get_forums_admin();
      setForums(result);
    } catch (err) {
      console.error('Error fetching forums:', err);
      // Fallback to public endpoint
      const result = await forumActor.get_forums();
      setForums(result);
    }
  };

  const fetchTopics = async () => {
    console.log('fetchTopics called, selectedForum:', selectedForum);
    if (selectedForum) {
      const forumId = Number(selectedForum.id);
      console.log('Fetching topics for forum ID:', forumId, 'original:', selectedForum.id);
      try {
        const result = await forumActor.get_topics_by_forum_admin(forumId);
        console.log('Admin topics result:', result);
        setTopics(result);
      } catch (err) {
        console.error('Error fetching topics with admin endpoint:', err);
        try {
          const result = await forumActor.get_topics_by_forum(forumId);
          console.log('Regular topics result:', result);
          setTopics(result);
        } catch (fallbackErr) {
          console.error('Error fetching topics with regular endpoint:', fallbackErr);
          setTopics([]);
        }
      }
      // Also fetch proposals topic
      await fetchProposalsTopic();
    } else {
      console.log('No forum selected, clearing topics');
      setTopics([]);
      setProposalsTopic(null);
    }
  };

  const fetchThreads = async () => {
    if (selectedTopic) {
      try {
        const result = await forumActor.get_threads_by_topic_admin(selectedTopic.id);
        setThreads(result);
      } catch (err) {
        console.error('Error fetching threads:', err);
        const result = await forumActor.get_threads_by_topic(selectedTopic.id);
        setThreads(result);
      }
    } else {
      setThreads([]);
    }
  };

  const fetchPosts = async () => {
    if (selectedThread) {
      try {
        const result = await forumActor.get_posts_by_thread_admin(selectedThread.id);
        setPosts(result);
      } catch (err) {
        console.error('Error fetching posts:', err);
        const result = await forumActor.get_posts_by_thread(selectedThread.id);
        setPosts(result);
      }
    } else {
      setPosts([]);
    }
  };

  const fetchStats = async () => {
    const result = await forumActor.get_stats();
    setStats(result);
    await fetchAdmins();
  };

  const fetchAdmins = async () => {
    try {
      const result = await forumActor.get_admins();
      setAdmins(result);
    } catch (err) {
      console.error('Error fetching admins:', err);
    }
  };

  const fetchTextLimits = async () => {
    setTextLimitsLoading(true);
    setTextLimitsError('');
    try {
      const result = await getTextLimits(forumActor);
      setTextLimits(result);
    } catch (err) {
      console.error('Error fetching text limits:', err);
      setTextLimitsError('Failed to fetch text limits: ' + err.message);
    } finally {
      setTextLimitsLoading(false);
    }
  };

  const handleUpdateTextLimits = async (updatedLimits) => {
    setUpdatingTextLimits(true);
    setTextLimitsError('');
    try {
      const result = await updateTextLimits(forumActor, updatedLimits);
      if ('ok' in result) {
        await fetchTextLimits(); // Refresh the limits
        setTextLimitsError('');
      } else {
        setTextLimitsError('Failed to update text limits: ' + formatError(result.err));
      }
    } catch (err) {
      console.error('Error updating text limits:', err);
      setTextLimitsError('Failed to update text limits: ' + err.message);
    } finally {
      setUpdatingTextLimits(false);
    }
  };

  // Helper function to derive display titles for posts (same logic as Discussion.jsx)
  const getDerivedTitle = (post, parentPost = null, thread = null) => {
    // If post has an explicit title, use it
    if (post.title && post.title.length > 0) {
      return post.title[0];
    }
    
    // If it's a reply to another post
    if (post.reply_to_post_id && post.reply_to_post_id.length > 0 && parentPost) {
      if (parentPost.title && parentPost.title.length > 0) {
        return `Re: ${parentPost.title[0]}`;
      } else {
        // Parent post doesn't have a title, derive it recursively
        const parentDerivedTitle = getDerivedTitle(parentPost, null, thread);
        return `Re: ${parentDerivedTitle}`;
      }
    }
    
    // If it's a top-level post in a thread
    if (thread && thread.title && thread.title.length > 0) {
      return `Re: ${thread.title[0]}`;
    }
    
    // Fallback
    return `Post #${post.id}`;
  };

  const fetchProposalsTopic = async () => {
    if (selectedForum) {
      try {
        const result = await forumActor.get_proposals_topic(Number(selectedForum.id));
        console.log('Proposals topic result:', result);
        // Handle the case where result is an array with one element or null
        setProposalsTopic(result && result.length > 0 ? result[0] : null);
      } catch (err) {
        console.error('Error fetching proposals topic:', err);
        setProposalsTopic(null);
      }
    } else {
      setProposalsTopic(null);
    }
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!forumActor) return;

    setLoading(true);
    try {
      let result;
      switch (activeTab) {
        case 'forums':
          result = await forumActor.create_forum({
            title: formData.title,
            description: formData.description,
            sns_root_canister_id: formData.snsRootCanisterId ? [Principal.fromText(formData.snsRootCanisterId)] : [],
          });
          break;
        case 'topics':
          if (!selectedForum) {
            setError('Please select a forum first');
            return;
          }
          result = await forumActor.create_topic({
            forum_id: Number(selectedForum.id),
            parent_topic_id: formData.parentTopicId ? [parseInt(formData.parentTopicId)] : [],
            title: formData.title,
            description: formData.description,
          });
          break;
        case 'threads':
          if (!selectedTopic) {
            setError('Please select a topic first');
            return;
          }
          result = await forumActor.create_thread({
            topic_id: Number(selectedTopic.id),
            title: formData.title ? [formData.title] : [],
            body: formData.body,
          });
          break;
        case 'posts':
          if (!selectedThread) {
            setError('Please select a thread first');
            return;
          }
          console.log('Creating post with formData:', formData);
          console.log('replyToPostId:', formData.replyToPostId, 'type:', typeof formData.replyToPostId);
          result = await forumActor.create_post(
            Number(selectedThread.id),
            formData.replyToPostId ? [parseInt(formData.replyToPostId)] : [],
            formData.title ? [formData.title] : [],
            formData.body
          );
          break;
        default:
          setError('Create operation not supported for this tab');
          return;
      }

      if ('ok' in result) {
        setFormData({});
        setShowCreateForm(false);
        await fetchData();
      } else {
        setError('Error: ' + formatError(result.err));
      }
    } catch (err) {
      console.error('Error creating:', err);
      setError('Failed to create item: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleEdit = async (e) => {
    e.preventDefault();
    if (!forumActor || !editingItem) return;

    setLoading(true);
    try {
      let result;
      switch (editingType) {
        case 'forum':
          result = await forumActor.update_forum(editingItem.id, {
            title: formData.title,
            description: formData.description,
            sns_root_canister_id: formData.snsRootCanisterId ? [Principal.fromText(formData.snsRootCanisterId)] : [],
          });
          break;
        case 'topic':
          result = await forumActor.update_topic(editingItem.id, {
            forum_id: editingItem.forum_id,
            title: formData.title,
            description: formData.description,
            parent_topic_id: formData.parentTopicId ? [parseInt(formData.parentTopicId)] : [],
          });
          break;
        case 'thread':
          result = await forumActor.update_thread(editingItem.id, {
            title: formData.title || null,
            body: formData.body,
          });
          break;
        case 'post':
          result = await forumActor.update_post(editingItem.id, {
            title: formData.title || null,
            body: formData.body,
          });
          break;
        default:
          setError('Edit operation not supported for this type');
          return;
      }

      if ('ok' in result) {
        setFormData({});
        setEditingItem(null);
        setEditingType(null);
        await fetchData();
        setError('');
      } else {
        setError('Error: ' + formatError(result.err));
      }
    } catch (err) {
      console.error('Error editing:', err);
      setError('Failed to edit item: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const startEdit = (item, type) => {
    setEditingItem(item);
    setEditingType(type);
    
    // Pre-populate form with existing data
    const newFormData = {
      title: item.title || '',
      description: item.description || '',
      body: item.body || '',
    };

    // Add type-specific data
    if (type === 'forum' && item.sns_root_canister_id && item.sns_root_canister_id.length > 0) {
      newFormData.snsRootCanisterId = item.sns_root_canister_id[0].toString();
    }
    if (type === 'topic' && item.parent_topic_id && item.parent_topic_id.length > 0) {
      newFormData.parentTopicId = item.parent_topic_id[0].toString();
      console.log('Setting parentTopicId for edit:', newFormData.parentTopicId, 'from:', item.parent_topic_id);
    }

    console.log('startEdit formData:', newFormData);
    setFormData(newFormData);
    setShowCreateForm(false); // Hide create form if open
  };

  const cancelEdit = () => {
    setEditingItem(null);
    setEditingType(null);
    setFormData({});
  };

  const handleDelete = async (id, type) => {
    if (!forumActor || !confirm(`Are you sure you want to delete this ${type}?`)) return;

    setLoading(true);
    try {
      let result;
      switch (type) {
        case 'forum':
          result = await forumActor.delete_forum(id);
          break;
        case 'topic':
          result = await forumActor.delete_topic(id);
          break;
        case 'thread':
          result = await forumActor.delete_thread(id);
          break;
        case 'post':
          result = await forumActor.delete_post(id);
          break;
        default:
          setError('Delete operation not supported');
          return;
      }

      if ('ok' in result) {
        await fetchData();
      } else {
        setError('Error: ' + formatError(result.err));
      }
    } catch (err) {
      console.error('Error deleting:', err);
      setError('Failed to delete item: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleUndelete = async (id, type) => {
    if (!forumActor || !confirm(`Are you sure you want to undelete this ${type}?`)) return;

    setLoading(true);
    try {
      let result;
      switch (type) {
        case 'forum':
          result = await forumActor.undelete_forum(id);
          break;
        case 'topic':
          result = await forumActor.undelete_topic(id);
          break;
        case 'thread':
          result = await forumActor.undelete_thread(id);
          break;
        case 'post':
          result = await forumActor.undelete_post(id);
          break;
        default:
          setError('Undelete operation not supported');
          return;
      }

      if ('ok' in result) {
        await fetchData();
      } else {
        setError('Error: ' + formatError(result.err));
      }
    } catch (err) {
      console.error('Error undeleting:', err);
      setError('Failed to undelete item: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (timestamp) => {
    return new Date(Number(timestamp) / 1000000).toLocaleString();
  };

  const renderForums = () => (
    <div className="forum-section">
      <div className="section-header">
        <h2>Forums</h2>
        <button 
          className="create-btn"
          onClick={() => setShowCreateForm(true)}
        >
          Create Forum
        </button>
      </div>

      {showCreateForm && (
        <form onSubmit={handleCreate} className="create-form">
          <input
            type="text"
            placeholder="Forum Title"
            value={formData.title || ''}
            onChange={(e) => setFormData({...formData, title: e.target.value})}
            required
          />
          <textarea
            placeholder="Forum Description"
            value={formData.description || ''}
            onChange={(e) => setFormData({...formData, description: e.target.value})}
            required
          />
          <input
            type="text"
            placeholder="SNS Root Canister ID (optional, e.g., rdmx6-jaaaa-aaaah-qcaiq-cai)"
            value={formData.snsRootCanisterId || ''}
            onChange={(e) => setFormData({...formData, snsRootCanisterId: e.target.value})}
          />
          <div className="form-actions">
            <button type="submit" disabled={loading}>Create</button>
            <button type="button" onClick={() => setShowCreateForm(false)}>Cancel</button>
          </div>
        </form>
      )}

      {editingItem && editingType === 'forum' && (
        <form onSubmit={handleEdit} className="create-form">
          <h3>Edit Forum: {editingItem.title}</h3>
          <input
            type="text"
            placeholder="Forum Title"
            value={formData.title || ''}
            onChange={(e) => setFormData({...formData, title: e.target.value})}
            required
          />
          <textarea
            placeholder="Forum Description"
            value={formData.description || ''}
            onChange={(e) => setFormData({...formData, description: e.target.value})}
            required
          />
          <input
            type="text"
            placeholder="SNS Root Canister ID (optional, e.g., rdmx6-jaaaa-aaaah-qcaiq-cai)"
            value={formData.snsRootCanisterId || ''}
            onChange={(e) => setFormData({...formData, snsRootCanisterId: e.target.value})}
          />
          <div className="form-actions">
            <button type="submit" disabled={loading}>Update</button>
            <button type="button" onClick={cancelEdit}>Cancel</button>
          </div>
        </form>
      )}

      <div className="items-list">
        {forums.map(forum => (
          <div key={forum.id} className={`item-card ${forum.deleted ? 'deleted' : ''}`}>
            <div className="item-header">
              <h3>{forum.title} {forum.deleted && <span className="deleted-badge">[DELETED]</span>}</h3>
              <div className="item-actions">
                <button 
                  className="select-btn"
                  onClick={() => {
                    console.log('Selecting forum:', forum);
                    setSelectedForum(forum);
                    setActiveTab('topics');
                    setSelectedTopic(null);
                    setSelectedThread(null);
                  }}
                >
                  Select
                </button>
                <button 
                  className="edit-btn"
                  onClick={() => startEdit(forum, 'forum')}
                  disabled={forum.deleted}
                >
                  Edit
                </button>
                {forum.deleted ? (
                  <button 
                    className="undelete-btn"
                    onClick={() => handleUndelete(forum.id, 'forum')}
                  >
                    Undelete
                  </button>
                ) : (
                  <button 
                    className="delete-btn"
                    onClick={() => handleDelete(forum.id, 'forum')}
                  >
                    Delete
                  </button>
                )}
              </div>
            </div>
            <p>{forum.description}</p>
            <div className="item-meta">
              <span>ID: {Number(forum.id)}</span>
              <span>Created: {formatDate(forum.created_at)}</span>
              <span>By: {forum.created_by.toString().slice(0, 8)}...</span>
              {forum.sns_root_canister_id && forum.sns_root_canister_id.length > 0 && (
                <span>SNS Root: {forum.sns_root_canister_id[0].toString()}</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  const renderTopics = () => (
    <div className="forum-section">
      <div className="section-header">
        <h2>Topics</h2>
        {selectedForum && (
          <div className="selected-info">
            Selected Forum: <strong>{selectedForum.title}</strong>
            {proposalsTopic && (
              <div style={{ marginTop: '5px', fontSize: '0.9em', color: '#ffc107' }}>
                Current Proposals Topic: <strong>#{Number(proposalsTopic.proposals_topic_id)}</strong>
              </div>
            )}
          </div>
        )}
        <button 
          className="create-btn"
          onClick={() => setShowCreateForm(true)}
          disabled={!selectedForum}
        >
          Create Topic
        </button>
      </div>

      {!selectedForum && (
        <div className="no-selection">
          Please select a forum from the Forums tab first.
        </div>
      )}

      {showCreateForm && selectedForum && (
        <form onSubmit={handleCreate} className="create-form">
          <input
            type="text"
            placeholder="Topic Title"
            value={formData.title || ''}
            onChange={(e) => setFormData({...formData, title: e.target.value})}
            required
          />
          <textarea
            placeholder="Topic Description"
            value={formData.description || ''}
            onChange={(e) => setFormData({...formData, description: e.target.value})}
            required
          />
          <select
            value={formData.parentTopicId || ''}
            onChange={(e) => setFormData({...formData, parentTopicId: e.target.value})}
          >
            <option value="">No Parent Topic (Top Level)</option>
            {topics.filter(topic => !topic.deleted).map(topic => (
              <option key={topic.id} value={Number(topic.id).toString()}>
                {topic.title} (ID: {Number(topic.id)})
              </option>
            ))}
          </select>
          <div className="form-actions">
            <button type="submit" disabled={loading}>Create</button>
            <button type="button" onClick={() => setShowCreateForm(false)}>Cancel</button>
          </div>
        </form>
      )}

      {editingItem && editingType === 'topic' && (
        <form onSubmit={handleEdit} className="create-form">
          <h3>Edit Topic: {editingItem.title}</h3>
          <input
            type="text"
            placeholder="Topic Title"
            value={formData.title || ''}
            onChange={(e) => setFormData({...formData, title: e.target.value})}
            required
          />
          <textarea
            placeholder="Topic Description"
            value={formData.description || ''}
            onChange={(e) => setFormData({...formData, description: e.target.value})}
            required
          />
          <select
            value={formData.parentTopicId || ''}
            onChange={(e) => setFormData({...formData, parentTopicId: e.target.value})}
          >
            <option value="">No Parent Topic (Top Level)</option>
            {topics.filter(topic => !topic.deleted && topic.id !== editingItem.id).map(topic => (
              <option key={topic.id} value={Number(topic.id).toString()}>
                {topic.title} (ID: {Number(topic.id)})
              </option>
            ))}
          </select>
          <div className="form-actions">
            <button type="submit" disabled={loading}>Update</button>
            <button type="button" onClick={cancelEdit}>Cancel</button>
          </div>
        </form>
      )}

      <div className="items-list">
        {topics.map(topic => {
          const isProposalsTopic = proposalsTopic && Number(topic.id) === Number(proposalsTopic.proposals_topic_id);
          return (
            <div key={topic.id} className={`item-card ${topic.deleted ? 'deleted' : ''} ${isProposalsTopic ? 'proposals-topic' : ''}`}>
              <div className="item-header">
                <h3>
                  {topic.title} 
                  {topic.deleted && <span className="deleted-badge">[DELETED]</span>}
                  {isProposalsTopic && <span className="proposals-badge">[PROPOSALS TOPIC]</span>}
                </h3>
                <div className="item-actions">
                  <button 
                    className="select-btn"
                    onClick={() => {
                      setSelectedTopic(topic);
                      setActiveTab('threads');
                      setSelectedThread(null);
                    }}
                  >
                    Select
                  </button>
                  <button 
                    className="create-btn"
                    onClick={() => handleSetProposalsTopic(topic.id)}
                    disabled={topic.deleted || !selectedForum || isProposalsTopic}
                    title={isProposalsTopic ? "Already set as Proposals Topic" : "Set as Proposals Topic for this Forum"}
                  >
                    {isProposalsTopic ? "Current Proposals Topic" : "Set as Proposals Topic"}
                  </button>
                  <button 
                    className="edit-btn"
                    onClick={() => startEdit(topic, 'topic')}
                    disabled={topic.deleted}
                  >
                    Edit
                  </button>
                  {topic.deleted ? (
                    <button 
                      className="undelete-btn"
                      onClick={() => handleUndelete(topic.id, 'topic')}
                    >
                      Undelete
                    </button>
                  ) : (
                    <button 
                      className="delete-btn"
                      onClick={() => handleDelete(topic.id, 'topic')}
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
              <p>{topic.description}</p>
              <div className="item-meta">
                <span>ID: {Number(topic.id)}</span>
                <span>Created: {formatDate(topic.created_at)}</span>
                <span>By: {topic.created_by.toString().slice(0, 8)}...</span>
                {topic.parent_topic_id && topic.parent_topic_id.length > 0 && (
                  <span>Parent Topic: #{Number(topic.parent_topic_id[0])}</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  const renderThreads = () => (
    <div className="forum-section">
      <div className="section-header">
        <h2>Threads</h2>
        {selectedTopic && (
          <div className="selected-info">
            Selected Topic: <strong>{selectedTopic.title}</strong>
          </div>
        )}
        <button 
          className="create-btn"
          onClick={() => setShowCreateForm(true)}
          disabled={!selectedTopic}
        >
          Create Thread
        </button>
      </div>

      {!selectedTopic && (
        <div className="no-selection">
          Please select a topic from the Topics tab first.
        </div>
      )}

      {showCreateForm && selectedTopic && (
        <form onSubmit={handleCreate} className="create-form">
          <input
            type="text"
            placeholder="Thread Title (optional)"
            value={formData.title || ''}
            onChange={(e) => setFormData({...formData, title: e.target.value})}
          />
          <textarea
            placeholder="Thread Body"
            value={formData.body || ''}
            onChange={(e) => setFormData({...formData, body: e.target.value})}
            required
          />
          <div className="form-actions">
            <button type="submit" disabled={loading}>Create</button>
            <button type="button" onClick={() => setShowCreateForm(false)}>Cancel</button>
          </div>
        </form>
      )}

      {editingItem && editingType === 'thread' && (
        <form onSubmit={handleEdit} className="create-form">
          <h3>Edit Thread: {editingItem.title || `Thread #${editingItem.id}`}</h3>
          <input
            type="text"
            placeholder="Thread Title (optional)"
            value={formData.title || ''}
            onChange={(e) => setFormData({...formData, title: e.target.value})}
          />
          <textarea
            placeholder="Thread Body"
            value={formData.body || ''}
            onChange={(e) => setFormData({...formData, body: e.target.value})}
            required
          />
          <div className="form-actions">
            <button type="submit" disabled={loading}>Update</button>
            <button type="button" onClick={cancelEdit}>Cancel</button>
          </div>
        </form>
      )}

      <div className="items-list">
        {threads.map(thread => (
          <div key={thread.id} className={`item-card ${thread.deleted ? 'deleted' : ''}`}>
            <div className="item-header">
              <h3>{thread.title || `Thread #${thread.id}`} {thread.deleted && <span className="deleted-badge">[DELETED]</span>}</h3>
              <div className="item-actions">
                <button 
                  className="select-btn"
                  onClick={() => {
                    setSelectedThread(thread);
                    setActiveTab('posts');
                  }}
                >
                  Select
                </button>
                <button 
                  className="edit-btn"
                  onClick={() => startEdit(thread, 'thread')}
                  disabled={thread.deleted}
                >
                  Edit
                </button>
                {thread.deleted ? (
                  <button 
                    className="undelete-btn"
                    onClick={() => handleUndelete(thread.id, 'thread')}
                  >
                    Undelete
                  </button>
                ) : (
                  <button 
                    className="delete-btn"
                    onClick={() => handleDelete(thread.id, 'thread')}
                  >
                    Delete
                  </button>
                )}
              </div>
            </div>
            <p>{thread.body}</p>
            <div className="item-meta">
              <span>ID: {Number(thread.id)}</span>
              <span>Created: {formatDate(thread.created_at)}</span>
              <span>By: {thread.created_by.toString().slice(0, 8)}...</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  const renderPosts = () => (
    <div className="forum-section">
      <div className="section-header">
        <h2>Posts</h2>
        {selectedThread && (
          <div className="selected-info">
            Selected Thread: <strong>{selectedThread.title || `Thread #${selectedThread.id}`}</strong>
          </div>
        )}
        <button 
          className="create-btn"
          onClick={() => setShowCreateForm(true)}
          disabled={!selectedThread}
        >
          Create Post
        </button>
      </div>

      {!selectedThread && (
        <div className="no-selection">
          Please select a thread from the Threads tab first.
        </div>
      )}

      {showCreateForm && selectedThread && (
        <form onSubmit={handleCreate} className="create-form">
          <input
            type="text"
            placeholder="Post Title (optional)"
            value={formData.title || ''}
            onChange={(e) => setFormData({...formData, title: e.target.value})}
          />
          <textarea
            placeholder="Post Body"
            value={formData.body || ''}
            onChange={(e) => setFormData({...formData, body: e.target.value})}
            required
          />
          <select
            value={formData.replyToPostId || ''}
            onChange={(e) => {
              console.log('Reply to dropdown changed:', e.target.value);
              setFormData({...formData, replyToPostId: e.target.value});
            }}
          >
            <option value="">No Reply (Top Level Post)</option>
            {posts.filter(post => !post.deleted).map(post => {
              const postIdStr = Number(post.id).toString();
              const parentPost = post.reply_to_post_id && post.reply_to_post_id.length > 0 
                ? posts.find(p => Number(p.id) === Number(post.reply_to_post_id[0]))
                : null;
              const displayTitle = getDerivedTitle(post, parentPost, selectedThread);
              console.log('Post option:', postIdStr, displayTitle);
              return (
                <option key={post.id} value={postIdStr}>
                  Reply to: {displayTitle}
                </option>
              );
            })}
          </select>
          <div className="form-actions">
            <button type="submit" disabled={loading}>Create</button>
            <button type="button" onClick={() => setShowCreateForm(false)}>Cancel</button>
          </div>
        </form>
      )}

      {editingItem && editingType === 'post' && (
        <form onSubmit={handleEdit} className="create-form">
          <h3>Edit Post: {editingItem.title || `Post #${editingItem.id}`}</h3>
          <input
            type="text"
            placeholder="Post Title (optional)"
            value={formData.title || ''}
            onChange={(e) => setFormData({...formData, title: e.target.value})}
          />
          <textarea
            placeholder="Post Body"
            value={formData.body || ''}
            onChange={(e) => setFormData({...formData, body: e.target.value})}
            required
          />
          <div className="form-actions">
            <button type="submit" disabled={loading}>Update</button>
            <button type="button" onClick={cancelEdit}>Cancel</button>
          </div>
        </form>
      )}

      <div className="items-list">
        {posts.map(post => {
          // Find parent post if this is a reply
          const parentPost = post.reply_to_post_id && post.reply_to_post_id.length > 0 
            ? posts.find(p => Number(p.id) === Number(post.reply_to_post_id[0]))
            : null;
          
          const displayTitle = getDerivedTitle(post, parentPost, selectedThread);
          
          return (
            <div key={post.id} className={`item-card ${post.deleted ? 'deleted' : ''}`}>
              <div className="item-header">
                <h3>{displayTitle} {post.deleted && <span className="deleted-badge">[DELETED]</span>}</h3>
                <div className="item-actions">
                  <button 
                    className="edit-btn"
                    onClick={() => startEdit(post, 'post')}
                    disabled={post.deleted}
                  >
                    Edit
                  </button>
                  {post.deleted ? (
                    <button 
                      className="create-btn"
                      onClick={() => handleUndelete(post.id, 'post')}
                    >
                      Undelete
                    </button>
                  ) : (
                    <button 
                      className="delete-btn"
                      onClick={() => handleDelete(post.id, 'post')}
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
              <p>{post.body}</p>
              <div className="item-meta">
                <span>ID: {Number(post.id)}</span>
                <span>Votes: ↑{Number(post.upvote_score)} ↓{Number(post.downvote_score)}</span>
                <span>Created: {formatDate(post.created_at)}</span>
                <span>By: {post.created_by.toString().slice(0, 8)}...</span>
                {post.reply_to_post_id && post.reply_to_post_id.length > 0 && (
                  <span>Reply to: #{Number(post.reply_to_post_id[0])}</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  const renderStats = () => (
    <div className="forum-section">
      <div className="section-header">
        <h2>Forum Statistics & Admin Management</h2>
      </div>

      {stats && (
        <div className="stats-grid">
          <div className="stat-card">
            <h3>Total Forums</h3>
            <div className="stat-value">{Number(stats.total_forums)}</div>
          </div>
          <div className="stat-card">
            <h3>Total Topics</h3>
            <div className="stat-value">{Number(stats.total_topics)}</div>
          </div>
          <div className="stat-card">
            <h3>Total Threads</h3>
            <div className="stat-value">{Number(stats.total_threads)}</div>
          </div>
          <div className="stat-card">
            <h3>Total Posts</h3>
            <div className="stat-value">{Number(stats.total_posts)}</div>
          </div>
          <div className="stat-card">
            <h3>Total Votes</h3>
            <div className="stat-value">{Number(stats.total_votes)}</div>
          </div>
        </div>
      )}

      <div style={{ marginTop: '40px' }}>
        <div className="section-header">
          <h3 style={{ color: '#ffffff', margin: 0 }}>Forum Admins</h3>
          <button 
            className="create-btn"
            onClick={() => setShowAddAdminForm(true)}
          >
            Add Admin
          </button>
        </div>

        {showAddAdminForm && (
          <form onSubmit={handleAddAdmin} className="create-form">
            <input
              type="text"
              placeholder="Principal ID (e.g., rdmx6-jaaaa-aaaah-qcaiq-cai)"
              value={newAdminPrincipal}
              onChange={(e) => setNewAdminPrincipal(e.target.value)}
              required
            />
            <div className="form-actions">
              <button type="submit" disabled={loading}>Add Admin</button>
              <button type="button" onClick={() => {
                setShowAddAdminForm(false);
                setNewAdminPrincipal('');
              }}>Cancel</button>
            </div>
          </form>
        )}

        <div className="items-list">
          {admins.map((admin, index) => (
            <div key={index} className="item-card">
              <div className="item-header">
                <h4 style={{ color: '#ffffff', margin: 0 }}>
                  {admin.principal.toString()}
                </h4>
                <div className="item-actions">
                  <button 
                    className="delete-btn"
                    onClick={() => handleRemoveAdmin(admin.principal)}
                    disabled={admins.length === 1}
                    title={admins.length === 1 ? "Cannot remove the last admin" : "Remove admin"}
                  >
                    Remove
                  </button>
                </div>
              </div>
              <div className="item-meta">
                <span>Added by: {admin.added_by.toString().slice(0, 8)}...</span>
                <span>Added: {formatDate(admin.added_at)}</span>
              </div>
            </div>
          ))}
          {admins.length === 0 && (
            <div className="no-selection">
              No admins found.
            </div>
          )}
        </div>
      </div>
    </div>
  );

  const renderTextLimits = () => (
    <div className="forum-section">
      <div className="section-header">
        <h2>Text Limits Configuration</h2>
        <button 
          className="create-btn"
          onClick={fetchTextLimits}
          disabled={loading}
        >
          Refresh
        </button>
      </div>

      {textLimits && (
        <div className="create-form">
          <div className="form-group">
            <label>Post Title Max Length</label>
            <input
              type="number"
              value={textLimits.post_title_max_length}
              onChange={(e) => setTextLimits({
                ...textLimits,
                post_title_max_length: parseInt(e.target.value) || 0
              })}
              min="1"
              max="1000"
            />
          </div>
          
          <div className="form-group">
            <label>Post Body Max Length</label>
            <input
              type="number"
              value={textLimits.post_body_max_length}
              onChange={(e) => setTextLimits({
                ...textLimits,
                post_body_max_length: parseInt(e.target.value) || 0
              })}
              min="1"
              max="50000"
            />
          </div>
          
          <div className="form-group">
            <label>Thread Title Max Length</label>
            <input
              type="number"
              value={textLimits.thread_title_max_length}
              onChange={(e) => setTextLimits({
                ...textLimits,
                thread_title_max_length: parseInt(e.target.value) || 0
              })}
              min="1"
              max="1000"
            />
          </div>
          
          <div className="form-group">
            <label>Thread Body Max Length</label>
            <input
              type="number"
              value={textLimits.thread_body_max_length}
              onChange={(e) => setTextLimits({
                ...textLimits,
                thread_body_max_length: parseInt(e.target.value) || 0
              })}
              min="1"
              max="50000"
            />
          </div>
          
          <div className="form-group">
            <label>Topic Title Max Length</label>
            <input
              type="number"
              value={textLimits.topic_title_max_length}
              onChange={(e) => setTextLimits({
                ...textLimits,
                topic_title_max_length: parseInt(e.target.value) || 0
              })}
              min="1"
              max="200"
            />
          </div>
          
          <div className="form-group">
            <label>Topic Description Max Length</label>
            <input
              type="number"
              value={textLimits.topic_description_max_length}
              onChange={(e) => setTextLimits({
                ...textLimits,
                topic_description_max_length: parseInt(e.target.value) || 0
              })}
              min="1"
              max="2000"
            />
          </div>
          
          <div className="form-group">
            <label>Forum Title Max Length</label>
            <input
              type="number"
              value={textLimits.forum_title_max_length}
              onChange={(e) => setTextLimits({
                ...textLimits,
                forum_title_max_length: parseInt(e.target.value) || 0
              })}
              min="1"
              max="200"
            />
          </div>
          
          <div className="form-group">
            <label>Forum Description Max Length</label>
            <input
              type="number"
              value={textLimits.forum_description_max_length}
              onChange={(e) => setTextLimits({
                ...textLimits,
                forum_description_max_length: parseInt(e.target.value) || 0
              })}
              min="1"
              max="2000"
            />
          </div>

          <div className="form-actions">
            <button 
              type="button"
              onClick={() => handleUpdateTextLimits(textLimits)}
              disabled={loading}
              className="create-btn"
            >
              {loading ? 'Updating...' : 'Update Text Limits'}
            </button>
          </div>
        </div>
      )}

      {!textLimits && (
        <div className="no-selection">
          Click "Refresh" to load current text limits.
        </div>
      )}
    </div>
  );

  const handleAddAdmin = async (e) => {
    e.preventDefault();
    if (!forumActor || !newAdminPrincipal.trim()) return;

    setLoading(true);
    try {
      const result = await forumActor.add_admin(Principal.fromText(newAdminPrincipal.trim()));
      if ('ok' in result) {
        setNewAdminPrincipal('');
        setShowAddAdminForm(false);
        await fetchAdmins();
        setError('');
      } else {
        setError('Error adding admin: ' + formatError(result.err));
      }
    } catch (err) {
      console.error('Error adding admin:', err);
      setError('Failed to add admin: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveAdmin = async (adminPrincipal) => {
    if (!forumActor || !confirm('Are you sure you want to remove this admin?')) return;

    setLoading(true);
    try {
      const result = await forumActor.remove_admin(adminPrincipal);
      if ('ok' in result) {
        await fetchAdmins();
        setError('');
      } else {
        setError('Error removing admin: ' + formatError(result.err));
      }
    } catch (err) {
      console.error('Error removing admin:', err);
      setError('Failed to remove admin: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSetProposalsTopic = async (topicId) => {
    if (!forumActor || !selectedForum || !confirm('Set this topic as the proposals topic for this forum?')) return;

    setLoading(true);
    try {
      const result = await forumActor.set_proposals_topic({
        forum_id: Number(selectedForum.id),
        topic_id: Number(topicId),
      });
      if ('ok' in result) {
        setError('');
        alert('Successfully set as proposals topic!');
        await fetchProposalsTopic(); // Refresh the proposals topic info
      } else {
        setError('Error setting proposals topic: ' + formatError(result.err));
      }
    } catch (err) {
      console.error('Error setting proposals topic:', err);
      setError('Failed to set proposals topic: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  // Show loading if any admin check is loading or if we're fetching data
  if (backendAdminLoading || forumLoading || loading) {
    return (
      <div className='page-container'>
        <Header />
        <main className="wallet-container">
          <div style={{ textAlign: 'center', padding: '40px 20px', color: '#ffffff' }}>
            {backendAdminLoading ? 'Checking backend admin status...' : 'Loading...'}
          </div>
        </main>
      </div>
    );
  }

  // Show forum admin loading only if we haven't determined backend admin status yet
  if (forumAdminCheckLoading && isBackendAdmin !== null) {
    return (
      <div className='page-container'>
        <Header />
        <main className="wallet-container">
          <div style={{ textAlign: 'center', padding: '40px 20px', color: '#ffffff' }}>
            Checking forum admin status...
          </div>
        </main>
      </div>
    );
  }

  // Show error if there's a backend admin error, forum error, or general error
  if (backendAdminError || forumError || error) {
    return (
      <div className='page-container'>
        <Header />
        <main className="wallet-container">
          <div style={{
            backgroundColor: 'rgba(231, 76, 60, 0.1)',
            border: '1px solid #e74c3c',
            color: '#e74c3c',
            padding: '15px',
            borderRadius: '4px',
            marginBottom: '20px'
          }}>
            {backendAdminError || forumError || error}
          </div>
        </main>
      </div>
    );
  }

  // Show forum admin error if user is backend admin but not forum admin
  if (isBackendAdmin && !isForumAdmin) {
    return (
      <div className='page-container'>
        <Header />
        <main className="wallet-container">
          <h1 style={{ color: '#ffffff', marginBottom: '20px' }}>Forum Administration</h1>
          <div style={{
            backgroundColor: 'rgba(255, 193, 7, 0.1)',
            border: '1px solid #ffc107',
            color: '#ffc107',
            padding: '15px',
            borderRadius: '4px',
            marginBottom: '20px'
          }}>
            <strong>Forum Admin Access Required:</strong><br />
            {forumAdminError || 'You are not an admin in the forum canister. Please contact an existing forum admin to add you.'}
          </div>
          <div style={{ color: '#cccccc', lineHeight: '1.6' }}>
            <p>You have backend admin privileges, but you need to be added as an admin in the forum canister to manage forum content.</p>
            <p>Current forum admins can add you using the admin management functions.</p>
          </div>
        </main>
      </div>
    );
  }

  // Don't render the main content if user is not both backend and forum admin
  if (!isBackendAdmin || !isForumAdmin) {
    return null;
  }

  return (
    <div className='page-container'>
      <Header />
      <main className="wallet-container">
        <h1 style={{ color: '#ffffff', marginBottom: '20px' }}>Forum Administration</h1>
        
        <div className="forum-tabs">
          {['forums', 'topics', 'threads', 'posts', 'stats', 'textlimits'].map(tab => (
            <button
              key={tab}
              className={`tab-btn ${activeTab === tab ? 'active' : ''}`}
              onClick={() => {
                setActiveTab(tab);
                setShowCreateForm(false);
                setFormData({});
                setShowAddAdminForm(false);
                setNewAdminPrincipal('');
                setEditingItem(null);
                setEditingType(null);
              }}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>

        <div className="forum-content">
          {activeTab === 'forums' && renderForums()}
          {activeTab === 'topics' && renderTopics()}
          {activeTab === 'threads' && renderThreads()}
          {activeTab === 'posts' && renderPosts()}
          {activeTab === 'stats' && renderStats()}
          {activeTab === 'textlimits' && renderTextLimits()}
        </div>
      </main>
    </div>
  );
} 