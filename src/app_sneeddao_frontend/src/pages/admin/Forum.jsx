import React, { useState, useEffect } from 'react';
import { useAuth } from '../../AuthContext';
import { useAdminCheck } from '../../hooks/useAdminCheck';
import { useForum } from '../../contexts/ForumContext';
import Header from '../../components/Header';
import './Forum.css';

export default function Forum() {
  const { isAuthenticated, identity } = useAuth();
  const { createForumActor, loading: forumLoading, error: forumError } = useForum();
  const [activeTab, setActiveTab] = useState('forums');
  const [forumActor, setForumActor] = useState(null);
  
  // State for forums
  const [forums, setForums] = useState([]);
  const [topics, setTopics] = useState([]);
  const [threads, setThreads] = useState([]);
  const [posts, setPosts] = useState([]);
  const [stats, setStats] = useState(null);
  
  // Loading states
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  
  // Form states
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [formData, setFormData] = useState({});
  const [selectedForum, setSelectedForum] = useState(null);
  const [selectedTopic, setSelectedTopic] = useState(null);
  const [selectedThread, setSelectedThread] = useState(null);

  // Use admin check hook
  useAdminCheck({ identity, isAuthenticated });

  useEffect(() => {
    if (isAuthenticated && identity) {
      const actor = createForumActor(identity);
      setForumActor(actor);
    }
  }, [isAuthenticated, identity, createForumActor]);

  useEffect(() => {
    if (forumActor) {
      fetchData();
    }
  }, [forumActor, activeTab]);

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
    if (selectedForum) {
      try {
        const result = await forumActor.get_topics_by_forum_admin(selectedForum.id);
        setTopics(result);
      } catch (err) {
        console.error('Error fetching topics:', err);
        const result = await forumActor.get_topics_by_forum(selectedForum.id);
        setTopics(result);
      }
    } else {
      setTopics([]);
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
            sns_root_canister_id: [],
          });
          break;
        case 'topics':
          if (!selectedForum) {
            setError('Please select a forum first');
            return;
          }
          result = await forumActor.create_topic({
            forum_id: selectedForum.id,
            parent_topic_id: [],
            title: formData.title,
            description: formData.description,
          });
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
        setError('Error: ' + JSON.stringify(result.err));
      }
    } catch (err) {
      console.error('Error creating:', err);
      setError('Failed to create item: ' + err.message);
    } finally {
      setLoading(false);
    }
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
        setError('Error: ' + JSON.stringify(result.err));
      }
    } catch (err) {
      console.error('Error deleting:', err);
      setError('Failed to delete item: ' + err.message);
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
          <div className="form-actions">
            <button type="submit" disabled={loading}>Create</button>
            <button type="button" onClick={() => setShowCreateForm(false)}>Cancel</button>
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
                  onClick={() => setSelectedForum(forum)}
                >
                  Select
                </button>
                <button 
                  className="delete-btn"
                  onClick={() => handleDelete(forum.id, 'forum')}
                  disabled={forum.deleted}
                >
                  Delete
                </button>
              </div>
            </div>
            <p>{forum.description}</p>
            <div className="item-meta">
              <span>ID: {Number(forum.id)}</span>
              <span>Created: {formatDate(forum.created_at)}</span>
              <span>By: {forum.created_by.toString().slice(0, 8)}...</span>
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
          <div className="form-actions">
            <button type="submit" disabled={loading}>Create</button>
            <button type="button" onClick={() => setShowCreateForm(false)}>Cancel</button>
          </div>
        </form>
      )}

      <div className="items-list">
        {topics.map(topic => (
          <div key={topic.id} className={`item-card ${topic.deleted ? 'deleted' : ''}`}>
            <div className="item-header">
              <h3>{topic.title} {topic.deleted && <span className="deleted-badge">[DELETED]</span>}</h3>
              <div className="item-actions">
                <button 
                  className="select-btn"
                  onClick={() => setSelectedTopic(topic)}
                >
                  Select
                </button>
                <button 
                  className="delete-btn"
                  onClick={() => handleDelete(topic.id, 'topic')}
                  disabled={topic.deleted}
                >
                  Delete
                </button>
              </div>
            </div>
            <p>{topic.description}</p>
            <div className="item-meta">
              <span>ID: {Number(topic.id)}</span>
              <span>Created: {formatDate(topic.created_at)}</span>
              <span>By: {topic.created_by.toString().slice(0, 8)}...</span>
            </div>
          </div>
        ))}
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
      </div>

      {!selectedTopic && (
        <div className="no-selection">
          Please select a topic from the Topics tab first.
        </div>
      )}

      <div className="items-list">
        {threads.map(thread => (
          <div key={thread.id} className={`item-card ${thread.deleted ? 'deleted' : ''}`}>
            <div className="item-header">
              <h3>{thread.title || `Thread #${thread.id}`} {thread.deleted && <span className="deleted-badge">[DELETED]</span>}</h3>
              <div className="item-actions">
                <button 
                  className="select-btn"
                  onClick={() => setSelectedThread(thread)}
                >
                  Select
                </button>
                <button 
                  className="delete-btn"
                  onClick={() => handleDelete(thread.id, 'thread')}
                  disabled={thread.deleted}
                >
                  Delete
                </button>
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
      </div>

      {!selectedThread && (
        <div className="no-selection">
          Please select a thread from the Threads tab first.
        </div>
      )}

      <div className="items-list">
        {posts.map(post => (
          <div key={post.id} className={`item-card ${post.deleted ? 'deleted' : ''}`}>
            <div className="item-header">
              <h3>{post.title || `Post #${post.id}`} {post.deleted && <span className="deleted-badge">[DELETED]</span>}</h3>
              <div className="item-actions">
                <button 
                  className="delete-btn"
                  onClick={() => handleDelete(post.id, 'post')}
                  disabled={post.deleted}
                >
                  Delete
                </button>
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
        ))}
      </div>
    </div>
  );

  const renderStats = () => (
    <div className="forum-section">
      <div className="section-header">
        <h2>Forum Statistics</h2>
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
    </div>
  );

  if (forumLoading || loading) {
    return (
      <div className='page-container'>
        <Header />
        <main className="wallet-container">
          <div style={{ textAlign: 'center', padding: '40px 20px', color: '#ffffff' }}>
            Loading...
          </div>
        </main>
      </div>
    );
  }

  if (forumError || error) {
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
            {forumError || error}
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className='page-container'>
      <Header />
      <main className="wallet-container">
        <h1 style={{ color: '#ffffff', marginBottom: '20px' }}>Forum Administration</h1>
        
        <div className="forum-tabs">
          {['forums', 'topics', 'threads', 'posts', 'stats'].map(tab => (
            <button
              key={tab}
              className={`tab-btn ${activeTab === tab ? 'active' : ''}`}
              onClick={() => {
                setActiveTab(tab);
                setShowCreateForm(false);
                setFormData({});
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
        </div>
      </main>
    </div>
  );
} 