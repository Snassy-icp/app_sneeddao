import React, { useState, useEffect } from 'react';
import { useAuth } from '../../AuthContext';
import { createActor } from 'declarations/app_sneeddao_backend';
import Header from '../../components/Header';

function AdminProjects() {
    const { identity } = useAuth();
    const [projects, setProjects] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    
    // Form state
    const [formData, setFormData] = useState({
        name: '',
        logoUrl: '',
        description: '',
        projectType: 'product',
        index: '',
        links: [{ title: '', url: '' }]
    });
    const [editingId, setEditingId] = useState(null);

    const backend = createActor(process.env.CANISTER_ID_APP_SNEEDDAO_BACKEND, {
        agentOptions: { identity }
    });

    useEffect(() => {
        fetchProjects();
    }, []);

    const fetchProjects = async () => {
        try {
            setLoading(true);
            const result = await backend.get_projects();
            setProjects(result);
        } catch (err) {
            console.error('Error fetching projects:', err);
            setError('Failed to fetch projects');
        } finally {
            setLoading(false);
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setIsSubmitting(true);
        setError('');
        setSuccess('');

        try {
            // Validate form
            if (!formData.name.trim()) {
                setError('Project name is required');
                return;
            }
            if (!formData.description.trim()) {
                setError('Description is required');
                return;
            }

            // Filter out empty links
            const validLinks = formData.links.filter(link => 
                link.title.trim() && link.url.trim()
            );

            const projectType = formData.projectType === 'product' ? { product: null } :
                              formData.projectType === 'project' ? { project: null } :
                              { fork: null };

            const logoUrl = formData.logoUrl.trim() ? [formData.logoUrl.trim()] : [];
            const index = formData.index.trim() ? parseInt(formData.index.trim()) : null;

            let result;
            if (editingId) {
                result = await backend.update_project(
                    editingId,
                    formData.name.trim(),
                    logoUrl,
                    formData.description.trim(),
                    projectType,
                    validLinks,
                    index ? [index] : []
                );
            } else {
                result = await backend.add_project(
                    formData.name.trim(),
                    logoUrl,
                    formData.description.trim(),
                    projectType,
                    validLinks,
                    index ? [index] : []
                );
            }

            if ('ok' in result) {
                setSuccess(editingId ? 'Project updated successfully!' : 'Project added successfully!');
                resetForm();
                fetchProjects();
            } else {
                setError(`Error saving project: ${result.err}`);
            }
        } catch (err) {
            console.error('Error saving project:', err);
            setError('Failed to save project');
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleDelete = async (projectId) => {
        if (!window.confirm('Are you sure you want to delete this project?')) {
            return;
        }

        try {
            setError('');
            setSuccess('');
            const result = await backend.remove_project(projectId);
            
            if ('ok' in result) {
                setSuccess('Project deleted successfully!');
                fetchProjects();
            } else {
                setError(`Error deleting project: ${result.err}`);
            }
        } catch (err) {
            console.error('Error deleting project:', err);
            setError('Failed to delete project');
        }
    };

    const resetForm = () => {
        setFormData({
            name: '',
            logoUrl: '',
            description: '',
            projectType: 'product',
            index: '',
            links: [{ title: '', url: '' }]
        });
        setEditingId(null);
    };

    const startEdit = (project) => {
        const projectType = 'product' in project.project_type ? 'product' :
                          'project' in project.project_type ? 'project' : 'fork';
        
        setFormData({
            name: project.name,
            logoUrl: project.logo_url[0] || '',
            description: project.description,
            projectType: projectType,
            index: project.index[0] ? Number(project.index[0]).toString() : '',
            links: project.links.length > 0 ? project.links : [{ title: '', url: '' }]
        });
        setEditingId(project.id);
    };

    const addLink = () => {
        setFormData(prev => ({
            ...prev,
            links: [...prev.links, { title: '', url: '' }]
        }));
    };

    const removeLink = (index) => {
        setFormData(prev => ({
            ...prev,
            links: prev.links.filter((_, i) => i !== index)
        }));
    };

    const formatDate = (timestamp) => {
        return new Date(Number(timestamp) / 1000000).toLocaleDateString();
    };

    const getProjectTypeDisplay = (projectType) => {
        if ('product' in projectType) return 'Product';
        if ('project' in projectType) return 'Project';
        if ('fork' in projectType) return 'Fork';
        return 'Unknown';
    };

    const clearMessages = () => {
        setError('');
        setSuccess('');
    };

    if (!identity) {
        return (
            <div className='page-container'>
                <Header />
                <main className="wallet-container">
                    <div style={{ textAlign: 'center', padding: '40px 20px' }}>
                        <h1 style={{ color: '#ffffff', marginBottom: '20px' }}>Access Denied</h1>
                        <p style={{ color: '#888' }}>Please connect your wallet to access admin features.</p>
                    </div>
                </main>
            </div>
        );
    }

    return (
        <div className='page-container'>
            <Header />
            <main className="wallet-container">
                <h1 style={{ color: '#ffffff', marginBottom: '30px' }}>Manage Projects</h1>

                {error && (
                    <div style={{
                        backgroundColor: 'rgba(231, 76, 60, 0.2)',
                        border: '1px solid #e74c3c',
                        color: '#e74c3c',
                        padding: '15px',
                        borderRadius: '6px',
                        marginBottom: '20px',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center'
                    }}>
                        <span>{error}</span>
                        <button onClick={clearMessages} style={{ background: 'none', border: 'none', color: '#e74c3c', cursor: 'pointer' }}>×</button>
                    </div>
                )}

                {success && (
                    <div style={{
                        backgroundColor: 'rgba(46, 204, 113, 0.2)',
                        border: '1px solid #2ecc71',
                        color: '#2ecc71',
                        padding: '15px',
                        borderRadius: '6px',
                        marginBottom: '20px',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center'
                    }}>
                        <span>{success}</span>
                        <button onClick={clearMessages} style={{ background: 'none', border: 'none', color: '#2ecc71', cursor: 'pointer' }}>×</button>
                    </div>
                )}

                {/* Add/Edit Form */}
                <div style={{
                    backgroundColor: '#2a2a2a',
                    borderRadius: '8px',
                    padding: '20px',
                    marginBottom: '30px'
                }}>
                    <h2 style={{ color: '#ffffff', marginBottom: '20px' }}>
                        {editingId ? 'Edit Project' : 'Add New Project'}
                    </h2>
                    
                    <form onSubmit={handleSubmit}>
                        <div style={{ marginBottom: '20px' }}>
                            <label style={{ color: '#ffffff', display: 'block', marginBottom: '5px' }}>
                                Project Name *
                            </label>
                            <input
                                type="text"
                                value={formData.name}
                                onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                                style={{
                                    width: '100%',
                                    padding: '10px',
                                    backgroundColor: '#3a3a3a',
                                    border: '1px solid #4a4a4a',
                                    borderRadius: '4px',
                                    color: '#ffffff'
                                }}
                                required
                            />
                        </div>

                        <div style={{ marginBottom: '20px' }}>
                            <label style={{ color: '#ffffff', display: 'block', marginBottom: '5px' }}>
                                Logo URL (optional)
                            </label>
                            <input
                                type="url"
                                value={formData.logoUrl}
                                onChange={(e) => setFormData(prev => ({ ...prev, logoUrl: e.target.value }))}
                                style={{
                                    width: '100%',
                                    padding: '10px',
                                    backgroundColor: '#3a3a3a',
                                    border: '1px solid #4a4a4a',
                                    borderRadius: '4px',
                                    color: '#ffffff'
                                }}
                                placeholder="https://example.com/logo.png"
                            />
                        </div>

                        <div style={{ marginBottom: '20px' }}>
                            <label style={{ color: '#ffffff', display: 'block', marginBottom: '5px' }}>
                                Project Type *
                            </label>
                            <select
                                value={formData.projectType}
                                onChange={(e) => setFormData(prev => ({ ...prev, projectType: e.target.value }))}
                                style={{
                                    width: '100%',
                                    padding: '10px',
                                    backgroundColor: '#3a3a3a',
                                    border: '1px solid #4a4a4a',
                                    borderRadius: '4px',
                                    color: '#ffffff'
                                }}
                                required
                            >
                                <option value="product">Product</option>
                                <option value="project">Project</option>
                                <option value="fork">Fork</option>
                            </select>
                        </div>

                        <div style={{ marginBottom: '20px' }}>
                            <label style={{ color: '#ffffff', display: 'block', marginBottom: '5px' }}>
                                Description *
                            </label>
                            <textarea
                                value={formData.description}
                                onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                                style={{
                                    width: '100%',
                                    padding: '10px',
                                    backgroundColor: '#3a3a3a',
                                    border: '1px solid #4a4a4a',
                                    borderRadius: '4px',
                                    color: '#ffffff',
                                    minHeight: '100px',
                                    resize: 'vertical'
                                }}
                                required
                            />
                        </div>

                        <div style={{ marginBottom: '20px' }}>
                            <label style={{ color: '#ffffff', display: 'block', marginBottom: '5px' }}>
                                Index (optional)
                            </label>
                            <input
                                type="number"
                                value={formData.index}
                                onChange={(e) => setFormData(prev => ({ ...prev, index: e.target.value }))}
                                style={{
                                    width: '100%',
                                    padding: '10px',
                                    backgroundColor: '#3a3a3a',
                                    border: '1px solid #4a4a4a',
                                    borderRadius: '4px',
                                    color: '#ffffff'
                                }}
                                placeholder="Enter display order index"
                            />
                            <small style={{ color: '#cccccc', fontSize: '12px', marginTop: '5px', display: 'block' }}>
                                Optional: Lower numbers appear first. Leave empty for default ordering.
                            </small>
                        </div>

                        <div style={{ marginBottom: '20px' }}>
                            <label style={{ color: '#ffffff', display: 'block', marginBottom: '10px' }}>
                                Links
                            </label>
                            {formData.links.map((link, index) => (
                                <div key={index} style={{ 
                                    display: 'flex', 
                                    gap: '10px', 
                                    marginBottom: '10px',
                                    alignItems: 'center'
                                }}>
                                    <input
                                        type="text"
                                        placeholder="Link title"
                                        value={link.title}
                                        onChange={(e) => {
                                            const newLinks = [...formData.links];
                                            newLinks[index].title = e.target.value;
                                            setFormData(prev => ({ ...prev, links: newLinks }));
                                        }}
                                        style={{
                                            flex: 1,
                                            padding: '8px',
                                            backgroundColor: '#3a3a3a',
                                            border: '1px solid #4a4a4a',
                                            borderRadius: '4px',
                                            color: '#ffffff'
                                        }}
                                    />
                                    <input
                                        type="url"
                                        placeholder="https://example.com"
                                        value={link.url}
                                        onChange={(e) => {
                                            const newLinks = [...formData.links];
                                            newLinks[index].url = e.target.value;
                                            setFormData(prev => ({ ...prev, links: newLinks }));
                                        }}
                                        style={{
                                            flex: 2,
                                            padding: '8px',
                                            backgroundColor: '#3a3a3a',
                                            border: '1px solid #4a4a4a',
                                            borderRadius: '4px',
                                            color: '#ffffff'
                                        }}
                                    />
                                    {formData.links.length > 1 && (
                                        <button
                                            type="button"
                                            onClick={() => removeLink(index)}
                                            style={{
                                                backgroundColor: '#e74c3c',
                                                color: '#ffffff',
                                                border: 'none',
                                                borderRadius: '4px',
                                                padding: '8px 12px',
                                                cursor: 'pointer'
                                            }}
                                        >
                                            Remove
                                        </button>
                                    )}
                                </div>
                            ))}
                            <button
                                type="button"
                                onClick={addLink}
                                style={{
                                    backgroundColor: '#3498db',
                                    color: '#ffffff',
                                    border: 'none',
                                    borderRadius: '4px',
                                    padding: '8px 16px',
                                    cursor: 'pointer'
                                }}
                            >
                                Add Link
                            </button>
                        </div>

                        <div style={{ display: 'flex', gap: '10px' }}>
                            <button
                                type="submit"
                                disabled={isSubmitting}
                                style={{
                                    backgroundColor: '#2ecc71',
                                    color: '#ffffff',
                                    border: 'none',
                                    borderRadius: '4px',
                                    padding: '12px 24px',
                                    cursor: isSubmitting ? 'not-allowed' : 'pointer',
                                    opacity: isSubmitting ? 0.7 : 1
                                }}
                            >
                                {isSubmitting ? 'Saving...' : (editingId ? 'Update Project' : 'Add Project')}
                            </button>
                            {editingId && (
                                <button
                                    type="button"
                                    onClick={resetForm}
                                    style={{
                                        backgroundColor: '#95a5a6',
                                        color: '#ffffff',
                                        border: 'none',
                                        borderRadius: '4px',
                                        padding: '12px 24px',
                                        cursor: 'pointer'
                                    }}
                                >
                                    Cancel
                                </button>
                            )}
                        </div>
                    </form>
                </div>

                {/* Projects List */}
                <div style={{
                    backgroundColor: '#2a2a2a',
                    borderRadius: '8px',
                    padding: '20px'
                }}>
                    <h2 style={{ color: '#ffffff', marginBottom: '20px' }}>Existing Projects</h2>
                    
                    {loading ? (
                        <div style={{ textAlign: 'center', color: '#888', padding: '20px' }}>
                            Loading projects...
                        </div>
                    ) : projects.length === 0 ? (
                        <div style={{ textAlign: 'center', color: '#888', padding: '20px' }}>
                            No projects found.
                        </div>
                    ) : (
                        <div style={{ display: 'grid', gap: '15px' }}>
                            {projects.map((project) => (
                                <div
                                    key={project.id}
                                    style={{
                                        backgroundColor: '#3a3a3a',
                                        borderRadius: '6px',
                                        padding: '15px',
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'flex-start'
                                    }}
                                >
                                    <div style={{ flex: 1 }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
                                            {project.logo_url[0] && (
                                                <img
                                                    src={project.logo_url[0]}
                                                    alt={project.name}
                                                    style={{
                                                        width: '40px',
                                                        height: '40px',
                                                        borderRadius: '50%',
                                                        objectFit: 'cover'
                                                    }}
                                                />
                                            )}
                                            <div>
                                                <h3 style={{ color: '#ffffff', margin: '0 0 5px 0' }}>
                                                    {project.name}
                                                </h3>
                                                <span style={{
                                                    backgroundColor: '#4a4a4a',
                                                    color: '#ffffff',
                                                    padding: '2px 8px',
                                                    borderRadius: '12px',
                                                    fontSize: '12px'
                                                }}>
                                                    {getProjectTypeDisplay(project.project_type)}
                                                </span>
                                            </div>
                                        </div>
                                        <p style={{ color: '#888', margin: '0 0 10px 0' }}>
                                            {project.description}
                                        </p>
                                        {project.links.length > 0 && (
                                            <div style={{ marginBottom: '10px' }}>
                                                <strong style={{ color: '#ffffff' }}>Links:</strong>
                                                <div style={{ marginTop: '5px' }}>
                                                    {project.links.map((link, index) => (
                                                        <a
                                                            key={index}
                                                            href={link.url}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            style={{
                                                                color: '#3498db',
                                                                textDecoration: 'none',
                                                                marginRight: '15px'
                                                            }}
                                                        >
                                                            {link.title}
                                                        </a>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                        <div style={{ color: '#666', fontSize: '12px' }}>
                                            Created: {formatDate(project.created_at)}
                                            {project.updated_at !== project.created_at && (
                                                <span> • Updated: {formatDate(project.updated_at)}</span>
                                            )}
                                        </div>
                                    </div>
                                    <div style={{ display: 'flex', gap: '10px', marginLeft: '20px' }}>
                                        <button
                                            onClick={() => startEdit(project)}
                                            style={{
                                                backgroundColor: '#3498db',
                                                color: '#ffffff',
                                                border: 'none',
                                                borderRadius: '4px',
                                                padding: '8px 16px',
                                                cursor: 'pointer'
                                            }}
                                        >
                                            Edit
                                        </button>
                                        <button
                                            onClick={() => handleDelete(project.id)}
                                            style={{
                                                backgroundColor: '#e74c3c',
                                                color: '#ffffff',
                                                border: 'none',
                                                borderRadius: '4px',
                                                padding: '8px 16px',
                                                cursor: 'pointer'
                                            }}
                                        >
                                            Delete
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </main>
        </div>
    );
}

export default AdminProjects; 