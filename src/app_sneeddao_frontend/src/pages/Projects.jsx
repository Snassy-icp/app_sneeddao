import React, { useState, useEffect } from 'react';
import { createActor } from 'declarations/app_sneeddao_backend';
import Header from '../components/Header';
import { useTheme } from '../contexts/ThemeContext';
import { FaRocket, FaCubes, FaCodeBranch, FaExternalLinkAlt, FaSpinner, FaLightbulb, FaLayerGroup } from 'react-icons/fa';

// Custom CSS for animations
const customAnimations = `
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

@keyframes projectsFloat {
    0%, 100% { transform: translateY(0px); }
    50% { transform: translateY(-8px); }
}

@keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
}

.projects-float {
    animation: projectsFloat 3s ease-in-out infinite;
}

.projects-fade-in {
    animation: fadeInUp 0.5s ease-out forwards;
}

.projects-spin {
    animation: spin 1s linear infinite;
}
`;

// Page accent colors
const projectsPrimary = '#8b5cf6';
const projectsSecondary = '#a78bfa';

// Type-specific colors
const productColor = '#10b981';
const projectColor = '#3b82f6';
const forkColor = '#f59e0b';

const getStyles = (theme) => ({
    container: {
        maxWidth: '900px',
        margin: '0 auto',
        padding: '1.25rem',
        color: theme.colors.primaryText,
    },
    section: {
        marginBottom: '1.5rem',
    },
    sectionHeader: {
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        marginBottom: '1rem',
    },
    sectionIcon: (color) => ({
        width: '36px',
        height: '36px',
        borderRadius: '10px',
        background: `linear-gradient(135deg, ${color}20, ${color}10)`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
    }),
    sectionTitle: {
        fontSize: '1.1rem',
        fontWeight: '700',
        color: theme.colors.primaryText,
        margin: 0,
    },
    grid: {
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
        gap: '1rem',
    },
    projectCard: {
        background: theme.colors.cardGradient,
        borderRadius: '16px',
        padding: '1.25rem',
        border: `1px solid ${theme.colors.border}`,
        boxShadow: theme.colors.cardShadow,
        transition: 'all 0.3s ease',
        position: 'relative',
        overflow: 'hidden',
    },
    decorativeGlow: (color) => ({
        position: 'absolute',
        top: '-50%',
        right: '-20%',
        width: '150px',
        height: '150px',
        background: `radial-gradient(circle, ${color}10 0%, transparent 70%)`,
        pointerEvents: 'none',
    }),
    logoContainer: (color) => ({
        width: '52px',
        height: '52px',
        borderRadius: '14px',
        background: `linear-gradient(135deg, ${color}20, ${color}10)`,
        border: `2px solid ${color}30`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        overflow: 'hidden',
    }),
    logo: {
        width: '100%',
        height: '100%',
        objectFit: 'cover',
        borderRadius: '12px',
    },
    logoFallback: (color) => ({
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: `linear-gradient(135deg, ${color}, ${color}cc)`,
        borderRadius: '12px',
        color: '#fff',
        fontSize: '1.25rem',
        fontWeight: '700',
    }),
    cardHeader: {
        display: 'flex',
        alignItems: 'flex-start',
        gap: '12px',
        marginBottom: '0.75rem',
    },
    cardInfo: {
        flex: 1,
        minWidth: 0,
    },
    projectName: {
        color: theme.colors.primaryText,
        margin: '0 0 6px 0',
        fontSize: '1.1rem',
        fontWeight: '700',
    },
    typeBadge: (color) => ({
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        padding: '3px 10px',
        borderRadius: '12px',
        background: `${color}15`,
        color: color,
        fontSize: '0.7rem',
        fontWeight: '600',
    }),
    linksContainer: {
        display: 'flex',
        flexWrap: 'wrap',
        gap: '6px',
        marginBottom: '0.75rem',
    },
    linkButton: (color) => ({
        background: `linear-gradient(135deg, ${color}, ${color}dd)`,
        color: '#fff',
        padding: '5px 12px',
        borderRadius: '8px',
        textDecoration: 'none',
        fontSize: '0.75rem',
        fontWeight: '600',
        transition: 'all 0.3s ease',
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        boxShadow: `0 2px 8px ${color}30`,
    }),
    description: {
        color: theme.colors.secondaryText,
        fontSize: '0.85rem',
        lineHeight: '1.6',
        margin: 0,
    },
    emptyState: {
        background: theme.colors.cardGradient,
        borderRadius: '16px',
        padding: '3rem 1.5rem',
        border: `1px solid ${theme.colors.border}`,
        boxShadow: theme.colors.cardShadow,
        textAlign: 'center',
    },
    emptyIcon: {
        width: '64px',
        height: '64px',
        borderRadius: '16px',
        background: `linear-gradient(135deg, ${projectsPrimary}20, ${projectsPrimary}10)`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        margin: '0 auto 1rem',
    },
    errorBox: {
        backgroundColor: `${theme.colors.error}15`,
        border: `1px solid ${theme.colors.error}30`,
        color: theme.colors.error,
        padding: '1rem',
        borderRadius: '12px',
        marginBottom: '1rem',
        textAlign: 'center',
        fontSize: '0.9rem',
    },
    divider: {
        borderTop: `1px solid ${theme.colors.border}`,
        paddingTop: '1.5rem',
        marginTop: '0.5rem',
    },
});

function Projects() {
    const { theme } = useTheme();
    const styles = getStyles(theme);
    const [projects, setProjects] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [logoErrors, setLogoErrors] = useState({});

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

    const getProjectTypeInfo = (projectType) => {
        if ('product' in projectType) return { label: 'Product', color: productColor, icon: FaRocket };
        if ('project' in projectType) return { label: 'Project', color: projectColor, icon: FaLightbulb };
        if ('fork' in projectType) return { label: 'Fork', color: forkColor, icon: FaCodeBranch };
        return { label: 'Unknown', color: theme.colors.mutedText, icon: FaCubes };
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
            
            if (aIndex !== null && bIndex !== null) return aIndex - bIndex;
            if (aIndex !== null && bIndex === null) return -1;
            if (aIndex === null && bIndex !== null) return 1;
            return a.name.localeCompare(b.name);
        };

        grouped.products.sort(sortByIndex);
        grouped.projects.sort(sortByIndex);
        grouped.forks.sort(sortByIndex);

        return grouped;
    };

    const handleLogoError = (projectId) => {
        setLogoErrors(prev => ({ ...prev, [projectId]: true }));
    };

    const renderProjectCard = (project, index) => {
        const typeInfo = getProjectTypeInfo(project.project_type);
        const TypeIcon = typeInfo.icon;
        
        return (
            <div
                key={project.id}
                className="projects-fade-in"
                style={{ ...styles.projectCard, animationDelay: `${index * 0.05}s` }}
            >
                <div style={styles.decorativeGlow(typeInfo.color)} />
                
                {/* Header with logo and info */}
                <div style={styles.cardHeader}>
                    <div style={styles.logoContainer(typeInfo.color)}>
                        {project.logo_url[0] && !logoErrors[project.id] ? (
                            <img
                                src={project.logo_url[0]}
                                alt={project.name}
                                style={styles.logo}
                                onError={() => handleLogoError(project.id)}
                            />
                        ) : (
                            <div style={styles.logoFallback(typeInfo.color)}>
                                {project.name.charAt(0).toUpperCase()}
                            </div>
                        )}
                    </div>
                    <div style={styles.cardInfo}>
                        <h3 style={styles.projectName}>{project.name}</h3>
                        <span style={styles.typeBadge(typeInfo.color)}>
                            <TypeIcon size={10} />
                            {typeInfo.label}
                        </span>
                    </div>
                </div>
                
                {/* Links */}
                {project.links.length > 0 && (
                    <div style={styles.linksContainer}>
                        {project.links.map((link, linkIndex) => (
                            <a
                                key={linkIndex}
                                href={link.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={styles.linkButton(typeInfo.color)}
                            >
                                {link.title}
                                <FaExternalLinkAlt size={9} />
                            </a>
                        ))}
                    </div>
                )}

                {/* Description */}
                <p style={styles.description}>{project.description}</p>
            </div>
        );
    };

    const renderProjectSection = (title, projectList, icon, color, showDivider = false) => {
        if (projectList.length === 0) return null;
        const Icon = icon;

        return (
            <div style={{ ...styles.section, ...(showDivider ? styles.divider : {}) }}>
                <div style={styles.sectionHeader}>
                    <div style={styles.sectionIcon(color)}>
                        <Icon size={16} style={{ color }} />
                    </div>
                    <h2 style={styles.sectionTitle}>{title}</h2>
                </div>
                <div style={styles.grid}>
                    {projectList.map((project, index) => renderProjectCard(project, index))}
                </div>
            </div>
        );
    };

    const groupedProjects = groupProjectsByType(projects);
    const hasAnyProjects = projects.length > 0;

    return (
        <div className='page-container' style={{ background: theme.colors.primaryGradient, minHeight: '100vh' }}>
            <style>{customAnimations}</style>
            <Header />
            
            {/* Hero Banner */}
            <div style={{
                background: `linear-gradient(135deg, ${theme.colors.primaryBg} 0%, ${projectsPrimary}12 50%, ${projectsSecondary}08 100%)`,
                borderBottom: `1px solid ${theme.colors.border}`,
                padding: '2rem 1rem',
                position: 'relative',
                overflow: 'hidden'
            }}>
                {/* Background decorations */}
                <div style={{
                    position: 'absolute',
                    top: '-30%',
                    right: '-5%',
                    width: '300px',
                    height: '300px',
                    background: `radial-gradient(circle, ${projectsPrimary}15 0%, transparent 70%)`,
                    pointerEvents: 'none'
                }} />
                
                <div className="projects-fade-in" style={{ maxWidth: '900px', margin: '0 auto', textAlign: 'center', position: 'relative', zIndex: 1 }}>
                    <div className="projects-float" style={{
                        width: '72px',
                        height: '72px',
                        borderRadius: '18px',
                        background: `linear-gradient(135deg, ${projectsPrimary}, ${projectsSecondary})`,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        margin: '0 auto 1rem',
                        boxShadow: `0 12px 40px ${projectsPrimary}50`,
                    }}>
                        <FaLayerGroup size={32} style={{ color: '#fff' }} />
                    </div>
                    
                    <div style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                        padding: '6px 14px',
                        borderRadius: '20px',
                        background: `${projectsPrimary}15`,
                        color: projectsPrimary,
                        fontSize: '0.8rem',
                        fontWeight: '600',
                        marginBottom: '0.75rem'
                    }}>
                        <FaCubes size={12} />
                        Sneed DAO Ecosystem
                    </div>
                    
                    <h1 style={{
                        fontSize: '1.75rem',
                        fontWeight: '700',
                        color: theme.colors.primaryText,
                        margin: '0 0 0.5rem',
                        letterSpacing: '-0.5px'
                    }}>
                        Projects
                    </h1>
                    <p style={{
                        fontSize: '0.95rem',
                        color: theme.colors.secondaryText,
                        margin: 0,
                        maxWidth: '500px',
                        marginLeft: 'auto',
                        marginRight: 'auto'
                    }}>
                        Explore our ecosystem of products, projects, and community forks
                    </p>
                </div>
            </div>
            
            <main style={styles.container}>
                {error && (
                    <div className="projects-fade-in" style={styles.errorBox}>
                        {error}
                    </div>
                )}

                {loading ? (
                    <div className="projects-fade-in" style={{ 
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        padding: '3rem 1rem',
                        gap: '1rem'
                    }}>
                        <FaSpinner className="projects-spin" size={32} style={{ color: projectsPrimary }} />
                        <span style={{ color: theme.colors.secondaryText }}>Loading projects...</span>
                    </div>
                ) : !hasAnyProjects ? (
                    <div className="projects-fade-in" style={styles.emptyState}>
                        <div style={styles.emptyIcon}>
                            <FaLayerGroup size={28} style={{ color: projectsPrimary }} />
                        </div>
                        <h3 style={{ color: theme.colors.primaryText, margin: '0 0 0.5rem', fontSize: '1.1rem' }}>
                            No Projects Yet
                        </h3>
                        <p style={{ color: theme.colors.secondaryText, margin: 0, fontSize: '0.9rem' }}>
                            Projects will appear here as they are added to the ecosystem.
                        </p>
                    </div>
                ) : (
                    <>
                        {renderProjectSection('Products', groupedProjects.products, FaRocket, productColor)}
                        {renderProjectSection('Projects', groupedProjects.projects, FaLightbulb, projectColor)}
                        {renderProjectSection('Community Forks', groupedProjects.forks, FaCodeBranch, forkColor, true)}
                    </>
                )}
            </main>
        </div>
    );
}

export default Projects; 