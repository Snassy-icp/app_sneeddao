// Login.jsx
import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext';
import './Login.css'; // Make sure to create this CSS file
import Header from './components/Header';

function Login() {
  const [authOutput, setAuthOutput] = useState('');
  const { isAuthenticated, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (isAuthenticated) {
      // Only redirect to hub if we're on the root login page AND there's no 'from' parameter
      // If user is trying to access a specific page, let that page handle authentication
      if (location.pathname === '/') {
        const currentSearch = location.search;
        const urlParams = new URLSearchParams(currentSearch);
        const fromParam = urlParams.get('from');
        
        // If there's a 'from' parameter, redirect back to that page instead of /hub
        if (fromParam) {
          urlParams.delete('from'); // Remove the 'from' parameter
          const cleanSearch = urlParams.toString();
          const redirectPath = cleanSearch ? `${fromParam}?${cleanSearch}` : fromParam;
          navigate(redirectPath);
        } else {
          navigate(`/hub${currentSearch}`);
        }
      }
    }
  }, [isAuthenticated, navigate, location.search, location.pathname]);

  async function handleLogin(event) {
    event.preventDefault();
    try {
      await login();
      setAuthOutput('Login successful');
    } catch (error) {
      console.error('Error during login:', error);
      setAuthOutput('Login failed');
    }
  }

  return (
    <div className='page-container'>
      <Header />
      <main className="login-container">
        <form action="#" onSubmit={handleLogin}>
          <button type="submit" className="login-button">Login with Internet Identity</button>
        </form>
        <section id="auth_output">{authOutput}</section>
      </main>
    </div>
  );
}

export default Login;