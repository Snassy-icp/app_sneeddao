import React from 'react';
import { Link, useLocation } from 'react-router-dom';

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
            </nav>
        </header>
    );
}

export default Header; 