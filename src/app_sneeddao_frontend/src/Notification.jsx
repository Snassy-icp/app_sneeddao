import React, { useEffect } from 'react';

const styles = {
    notification: {
        position: 'fixed',
        bottom: '20px',
        right: '20px',
        padding: '15px 20px',
        borderRadius: '8px',
        color: '#ffffff',
        fontSize: '16px',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        animation: 'slideIn 0.3s ease-out forwards',
        boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
        maxWidth: '400px',
    },
    success: {
        backgroundColor: '#2ecc71',
    },
    error: {
        backgroundColor: '#e74c3c',
    },
    icon: {
        fontSize: '20px',
    }
};

const Notification = ({ message, type = 'success', onClose, duration = 3000 }) => {
    useEffect(() => {
        const timer = setTimeout(() => {
            onClose();
        }, duration);

        return () => clearTimeout(timer);
    }, [duration, onClose]);

    return (
        <div 
            style={{
                ...styles.notification,
                ...(type === 'success' ? styles.success : styles.error)
            }}
        >
            <span style={styles.icon}>
                {type === 'success' ? '✓' : '✕'}
            </span>
            {message}
        </div>
    );
};

export default Notification; 