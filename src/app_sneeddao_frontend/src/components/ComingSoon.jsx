import React from 'react';
import Header from './Header';

function ComingSoon({ title, showSnsDropdown }) {
    return (
        <div className='page-container'>
            <Header showSnsDropdown={showSnsDropdown} />
            <main className="wallet-container">
                <h1 style={{ color: '#ffffff', marginBottom: '20px' }}>{title}</h1>
                <div style={{
                    backgroundColor: '#2a2a2a',
                    borderRadius: '8px',
                    padding: '40px',
                    textAlign: 'center',
                    color: '#888',
                    fontSize: '1.2em'
                }}>
                    Coming Soon
                </div>
            </main>
        </div>
    );
}

export default ComingSoon; 