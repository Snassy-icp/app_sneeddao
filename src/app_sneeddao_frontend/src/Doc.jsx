import React from 'react';
import { Link } from 'react-router-dom';
import './Doc.css';

function Doc() {
  return (
    <div className='page-container'>
      <header className="site-header">
        <div className="logo">
            <Link to="/wallet">
                <img src="sneedlock-logo-cropped.png" alt="Sneedlock" />
            </Link>
        </div>
      </header>
      <main className="doc-container">
        <h1>Sneedlock Documentation</h1>
        <p>Welcome to Sneedlock, a decentralized finance platform built on the Internet Computer.</p>
        {/* Add more documentation content here */}
      </main>
    </div>
  );
}

export default Doc;
