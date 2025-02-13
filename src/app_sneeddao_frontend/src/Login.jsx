// Login.jsx
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from './AuthContext';
import './Login.css'; // Make sure to create this CSS file

function Login() {
  const [authOutput, setAuthOutput] = useState('');
  const { isAuthenticated, login } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (isAuthenticated) {
      navigate('/wallet');
    }
  }, [isAuthenticated, navigate]);

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
      <header className="site-header">
        <div className="logo">
          <img src="sneedlock-logo-cropped.png" alt="Sneedlock" />
        </div>
      </header>
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