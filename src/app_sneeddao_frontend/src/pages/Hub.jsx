import React from 'react';
import Header from '../components/Header';

function Hub() {
    return (
        <div className='page-container'>
            <Header showSnsDropdown={true} />
            <main style={{
                maxWidth: '1200px',
                margin: '0 auto',
                padding: '2rem',
                textAlign: 'center'
            }}>
                <h1 style={{
                    fontSize: '3rem',
                    color: '#ffffff',
                    marginBottom: '1rem'
                }}>
                    Hub
                </h1>
                <p style={{
                    fontSize: '1.5rem',
                    color: '#888888',
                    fontStyle: 'italic'
                }}>
                    Coming Soon
                </p>
            </main>
        </div>
    );
}

export default Hub; 