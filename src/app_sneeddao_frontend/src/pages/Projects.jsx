import React, { useState, useEffect } from 'react';
import { createActor } from 'declarations/app_sneeddao_backend';
import Header from '../components/Header';
import { useTheme } from '../contexts/ThemeContext';

function Projects() {
    const { theme } = useTheme();
    const [projects, setProjects] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    const backend = createActor(process.env.CANISTER_ID_APP_SNEEDDAO_BACKEND);

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
            setError('Failed to load projects');
        } finally {
            setLoading(false);
        }
    };

    const getProjectTypeDisplay = (projectType) => {
        if ('product' in projectType) return 'Product';
        if ('project' in projectType) return 'Project';
        if ('fork' in projectType) return 'Fork';
        return 'Unknown';
    };

    const groupProjectsByType = (projects) => {
        const grouped = {
            products: [],
            projects: [],
            forks: []
        };

        projects.forEach(project => {
            if ('product' in project.project_type) {
                grouped.products.push(project);
            } else if ('project' in project.project_type) {
                grouped.projects.push(project);
            } else if ('fork' in project.project_type) {
                grouped.forks.push(project);
            }
        });

        // Sort each group by index (projects with index come first, sorted by index value)
        const sortByIndex = (a, b) => {
            const aIndex = a.index && a.index.length > 0 ? Number(a.index[0]) : null;
            const bIndex = b.index && b.index.length > 0 ? Number(b.index[0]) : null;
            
            // If both have indexes, sort by index value
            if (aIndex !== null && bIndex !== null) {
                return aIndex - bIndex;
            }
            // If only a has index, a comes first
            if (aIndex !== null && bIndex === null) {
                return -1;
            }
            // If only b has index, b comes first
            if (aIndex === null && bIndex !== null) {
                return 1;
            }
            // If neither has index, maintain original order (sort by name as fallback)
            return a.name.localeCompare(b.name);
        };

        grouped.products.sort(sortByIndex);
        grouped.projects.sort(sortByIndex);
        grouped.forks.sort(sortByIndex);

        return grouped;
    };

    const renderProjectCard = (project) => (
        <div
            key={project.id}
            style={{
                background: theme.colors.cardGradient,
                borderRadius: '12px',
                padding: '24px',
                border: `1px solid ${theme.colors.border}`,
                boxShadow: theme.colors.cardShadow,
                transition: 'all 0.3s ease',
                cursor: 'default'
            }}
            onMouseEnter={(e) => {
                e.target.style.transform = 'translateY(-3px)';
                e.target.style.boxShadow = `0 8px 25px ${theme.colors.accent}20`;
            }}
            onMouseLeave={(e) => {
                e.target.style.transform = 'translateY(0)';
                e.target.style.boxShadow = theme.colors.cardShadow;
            }}
        >
            {/* Header with logo, name, and links */}
            <div style={{ marginBottom: '16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
                    {project.logo_url[0] && (
                        <img
                            src={project.logo_url[0]}
                            alt={project.name}
                            style={{
                                width: '48px',
                                height: '48px',
                                borderRadius: '50%',
                                objectFit: 'cover',
                                border: `2px solid ${theme.colors.border}`
                            }}
                        />
                    )}
                    <div style={{ flex: 1 }}>
                        <h3 style={{ 
                            color: theme.colors.primaryText, 
                            margin: '0 0 4px 0',
                            fontSize: '20px',
                            fontWeight: '600'
                        }}>
                            {project.name}
                        </h3>
                        <span style={{
                            backgroundColor: theme.colors.tertiaryBg,
                            color: theme.colors.primaryText,
                            padding: '4px 12px',
                            borderRadius: '16px',
                            fontSize: '12px',
                            fontWeight: '500',
                            border: `1px solid ${theme.colors.border}`
                        }}>
                            {getProjectTypeDisplay(project.project_type)}
                        </span>
                    </div>
                </div>
                
                {/* Links */}
                {project.links.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                        {project.links.map((link, index) => (
                            <a
                                key={index}
                                href={link.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{
                                    background: `linear-gradient(135deg, ${theme.colors.accent}, ${theme.colors.accent}dd)`,
                                    color: theme.colors.primaryBg,
                                    textDecoration: 'none',
                                    padding: '6px 14px',
                                    borderRadius: '6px',
                                    fontSize: '12px',
                                    fontWeight: '600',
                                    transition: 'all 0.3s ease',
                                    boxShadow: theme.colors.accentShadow
                                }}
                                onMouseEnter={(e) => {
                                    e.target.style.transform = 'translateY(-1px)';
                                    e.target.style.boxShadow = `0 6px 20px ${theme.colors.accent}40`;
                                }}
                                onMouseLeave={(e) => {
                                    e.target.style.transform = 'translateY(0)';
                                    e.target.style.boxShadow = theme.colors.accentShadow;
                                }}
                            >
                                {link.title}
                            </a>
                        ))}
                    </div>
                )}
            </div>

            {/* Description */}
            <p style={{ 
                color: theme.colors.secondaryText, 
                margin: '0',
                lineHeight: '1.6',
                fontSize: '14px'
            }}>
                {project.description}
            </p>
        </div>
    );

    const renderProjectSection = (title, projects, showHeader = true) => {
        if (projects.length === 0) return null;

        return (
            <div style={{ marginBottom: '40px' }}>
                {showHeader && (
                    <h2 style={{ 
                        color: theme.colors.primaryText, 
                        marginBottom: '24px',
                        fontSize: '24px',
                        fontWeight: '600'
                    }}>
                        {title}
                    </h2>
                )}
                <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(350px, 1fr))',
                    gap: '20px'
                }}>
                    {projects.map(renderProjectCard)}
                </div>
            </div>
        );
    };

    if (loading) {
        return (
            <div className='page-container' style={{ background: theme.colors.primaryGradient, minHeight: '100vh' }}>
                <Header />
                <main className="wallet-container">
                    <div style={{ textAlign: 'center', padding: '40px 20px' }}>
                        <h1 style={{ color: theme.colors.primaryText, marginBottom: '20px' }}>Projects</h1>
                        <p style={{ color: theme.colors.mutedText }}>Loading projects...</p>
                    </div>
                </main>
            </div>
        );
    }

    if (error) {
        return (
            <div className='page-container' style={{ background: theme.colors.primaryGradient, minHeight: '100vh' }}>
                <Header />
                <main className="wallet-container">
                    <div style={{ textAlign: 'center', padding: '40px 20px' }}>
                        <h1 style={{ color: theme.colors.primaryText, marginBottom: '20px' }}>Projects</h1>
                        <div style={{
                            backgroundColor: `${theme.colors.error}20`,
                            border: `1px solid ${theme.colors.error}`,
                            color: theme.colors.error,
                            padding: '15px',
                            borderRadius: '8px',
                            maxWidth: '400px',
                            margin: '0 auto'
                        }}>
                            {error}
                        </div>
                    </div>
                </main>
            </div>
        );
    }

    const groupedProjects = groupProjectsByType(projects);
    const hasAnyProjects = projects.length > 0;

    return (
        <div className='page-container' style={{ background: theme.colors.primaryGradient, minHeight: '100vh' }}>
            <Header />
            <main className="wallet-container">
                <div style={{ marginBottom: '40px' }}>
                    <h1 style={{ 
                        color: theme.colors.primaryText, 
                        marginBottom: '16px',
                        fontSize: '32px',
                        fontWeight: '700'
                    }}>
                        Projects
                    </h1>
                    <p style={{ 
                        color: theme.colors.mutedText, 
                        fontSize: '16px',
                        lineHeight: '1.6',
                        maxWidth: '600px'
                    }}>
                        Explore our ecosystem of products, projects, and community forks that extend and enhance the SneedDAO platform.
                    </p>
                </div>

                {!hasAnyProjects ? (
                    <div style={{ textAlign: 'center', padding: '60px 20px' }}>
                        <h2 style={{ color: theme.colors.primaryText, marginBottom: '16px' }}>No Projects Yet</h2>
                        <p style={{ color: theme.colors.mutedText }}>
                            Projects will appear here as they are added to the ecosystem.
                        </p>
                    </div>
                ) : (
                    <>
                        {/* Products and Projects */}
                        {renderProjectSection('Products', groupedProjects.products, false)}
                        {renderProjectSection('Projects', groupedProjects.projects, groupedProjects.products.length > 0)}
                        
                        {/* Forks under separate header */}
                        {groupedProjects.forks.length > 0 && (
                            <div style={{ 
                                borderTop: `1px solid ${theme.colors.border}`, 
                                paddingTop: '40px',
                                marginTop: '40px'
                            }}>
                                {renderProjectSection('Community Forks', groupedProjects.forks, true)}
                            </div>
                        )}
                    </>
                )}
            </main>
        </div>
    );
}

export default Projects; 