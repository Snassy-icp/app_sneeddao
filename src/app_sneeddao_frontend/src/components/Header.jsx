import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { FaWallet } from 'react-icons/fa';

function Header() {
    const location = useLocation();

    return (
        <header className="site-header">
            <div className="logo">
                <Link to="/wallet">
                    <img src="sneedlock-logo-cropped.png" alt="Sneedlock" />
                </Link>
            </div>
            <nav className="nav-links">
                <Link to="/help">Help</Link>
                <Link to="/rll" className={location.pathname === '/rll' ? 'active' : ''}>RLL</Link>
                <Link 
                    to="/wallet" 
                    style={{ 
                        color: '#fff',
                        display: 'flex',
                        alignItems: 'center',
                        textDecoration: 'none',
                        marginLeft: '15px'
                    }}
                >
                    <FaWallet size={20} />
                </Link>
            </nav>
        </header>
    );
}

export default Header; 