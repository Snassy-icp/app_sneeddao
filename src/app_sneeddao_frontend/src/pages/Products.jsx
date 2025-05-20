import React from 'react';
import { Link } from 'react-router-dom';
import Header from '../components/Header';

const styles = {
    container: {
        maxWidth: '1200px',
        margin: '0 auto',
        padding: '2rem',
        color: '#ffffff',
    },
    heading: {
        fontSize: '2.5rem',
        marginBottom: '2rem',
        color: '#ffffff',
        textAlign: 'center',
    },
    grid: {
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
        gap: '2rem',
    },
    product: {
        backgroundColor: '#2a2a2a',
        borderRadius: '8px',
        padding: '2rem',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
    },
    productTitle: {
        fontSize: '2rem',
        marginBottom: '1rem',
        color: '#3498db',
    },
    description: {
        fontSize: '1.1rem',
        lineHeight: '1.6',
        color: '#ccc',
        marginBottom: '2rem',
    },
    statsSection: {
        marginTop: 'auto',
    },
    statsGrid: {
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
        gap: '1rem',
        marginBottom: '2rem',
    },
    stat: {
        backgroundColor: '#3a3a3a',
        padding: '1rem',
        borderRadius: '6px',
        textAlign: 'center',
    },
    statValue: {
        fontSize: '1.5rem',
        fontWeight: 'bold',
        color: '#3498db',
        marginBottom: '0.5rem',
    },
    statLabel: {
        color: '#888',
        fontSize: '0.9rem',
    },
    button: {
        backgroundColor: '#3498db',
        color: '#ffffff',
        border: 'none',
        borderRadius: '4px',
        padding: '1rem',
        fontSize: '1.1rem',
        cursor: 'pointer',
        textDecoration: 'none',
        textAlign: 'center',
        transition: 'background-color 0.2s',
        '&:hover': {
            backgroundColor: '#2980b9',
        },
    },
};

// Mock statistics - replace with real data when available
const mockStats = {
    sneedlock: {
        totalLocks: '156',
        activeUsers: '42',
        totalValue: '$1.2M',
    },
    swaprunner: {
        totalSwaps: '1,234',
        dailyVolume: '$500K',
        uniqueUsers: '789',
    },
};

function StatCard({ value, label }) {
    return (
        <div style={styles.stat}>
            <div style={styles.statValue}>{value}</div>
            <div style={styles.statLabel}>{label}</div>
        </div>
    );
}

function Products() {
    return (
        <div className="page-container">
            <Header />
            <main style={styles.container}>
                <h1 style={styles.heading}>Our Products</h1>
                
                <div style={styles.grid}>
                    {/* SneedLock */}
                    <div style={styles.product}>
                        <h2 style={styles.productTitle}>SneedLock</h2>
                        <p style={styles.description}>
                            A secure and flexible token locking solution built on the Internet Computer.
                            Create customizable token locks with various vesting schedules and conditions.
                            Perfect for team tokens, investor allocations, and liquidity management.
                        </p>
                        
                        <div style={styles.statsSection}>
                            <div style={styles.statsGrid}>
                                <StatCard 
                                    value={mockStats.sneedlock.totalLocks} 
                                    label="Total Locks" 
                                />
                                <StatCard 
                                    value={mockStats.sneedlock.activeUsers} 
                                    label="Active Users" 
                                />
                                <StatCard 
                                    value={mockStats.sneedlock.totalValue} 
                                    label="Total Value Locked" 
                                />
                            </div>
                            
                            <Link to="/sneedlock" style={styles.button}>
                                Launch SneedLock
                            </Link>
                        </div>
                    </div>

                    {/* SwapRunner */}
                    <div style={styles.product}>
                        <h2 style={styles.productTitle}>SwapRunner</h2>
                        <p style={styles.description}>
                            A high-performance decentralized exchange (DEX) built for speed and efficiency.
                            Experience lightning-fast token swaps with minimal slippage, powered by
                            advanced routing algorithms and deep liquidity pools.
                        </p>
                        
                        <div style={styles.statsSection}>
                            <div style={styles.statsGrid}>
                                <StatCard 
                                    value={mockStats.swaprunner.totalSwaps} 
                                    label="Total Swaps" 
                                />
                                <StatCard 
                                    value={mockStats.swaprunner.dailyVolume} 
                                    label="Daily Volume" 
                                />
                                <StatCard 
                                    value={mockStats.swaprunner.uniqueUsers} 
                                    label="Unique Users" 
                                />
                            </div>
                            
                            <a 
                                href="https://swaprunner.com" 
                                target="_blank" 
                                rel="noopener noreferrer" 
                                style={styles.button}
                            >
                                Visit SwapRunner
                            </a>
                        </div>
                    </div>
                </div>
            </main>
        </div>
    );
}

export default Products; 