import React from 'react';
import { Link } from 'react-router-dom';
import './Doc.css';
import Header from './components/Header';
import { useTheme } from './contexts/ThemeContext';

const getStyles = (theme) => ({
    container: {
        maxWidth: '1200px',
        margin: '0 auto',
        padding: '2rem',
        color: theme.colors.primaryText,
    },
    section: {
        backgroundColor: theme.colors.secondaryBg,
        borderRadius: '8px',
        padding: '2rem',
        marginBottom: '2rem',
        textAlign: 'center',
    },
    heading: {
        fontSize: '2.5rem',
        marginBottom: '1.5rem',
        color: theme.colors.primaryText,
    },
    paragraph: {
        marginBottom: '1rem',
        lineHeight: '1.6',
        color: theme.colors.secondaryText,
        fontSize: '1.1rem',
    },
});

function Doc() {
    const { theme } = useTheme();
    const styles = getStyles(theme);

    return (
        <div className='page-container' style={{ background: theme.colors.primaryGradient, minHeight: '100vh' }}>
            <Header />
            <main style={styles.container}>
                <div style={styles.section}>
                    <h1 style={styles.heading}>Documentation</h1>
                    <p style={styles.paragraph}>
                        Documentation coming soon!
                    </p>
                </div>
            </main>
        </div>
    );
}

export default Doc;
