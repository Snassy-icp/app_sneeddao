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
      // Preserve URL parameters when redirecting after login
      const currentSearch = location.search;
      navigate(`/wallet${currentSearch}`);
    }
  }, [isAuthenticated, navigate, location.search]);

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