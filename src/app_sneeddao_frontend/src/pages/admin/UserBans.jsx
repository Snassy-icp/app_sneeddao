import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../AuthContext';
import { useAdminCheck } from '../../hooks/useAdminCheck';
import { createActor as createBackendActor } from 'declarations/app_sneeddao_backend';
import Header from '../../components/Header';

export default function UserBans() {
  const { isAuthenticated, identity } = useAuth();
  const navigate = useNavigate();
  const [bannedUsers, setBannedUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [principalId, setPrincipalId] = useState('');
  const [banDuration, setBanDuration] = useState(24); // Default 24 hours
  const [banReason, setBanReason] = useState('');

  // Use admin check hook
  useAdminCheck({ identity, isAuthenticated });

  useEffect(() => {
    if (isAuthenticated) {
      fetchBans();
    }
  }, [isAuthenticated]);

  const fetchBans = async () => {
    if (!identity) return;

    setLoading(true);
    try {
      const backendActor = createBackendActor(identity);
      const result = await backendActor.get_banned_users();
      if ('ok' in result) {
        setBannedUsers(result.ok);
      } else {
        setError(result.err);
      }
    } catch (err) {
      console.error('Error fetching bans:', err);
      setError('Failed to fetch banned users');
    } finally {
      setLoading(false);
    }
  };

  const handleBanUser = async (e) => {
    e.preventDefault();
    if (!identity || !principalId.trim()) return;

    setLoading(true);
    try {
      const backendActor = createBackendActor(identity);
      const result = await backendActor.ban_user(principalId, BigInt(banDuration * 3600), banReason);
      if ('ok' in result) {
        await fetchBans();
        setPrincipalId('');
        setBanReason('');
        setError(null);
      } else {
        setError(result.err);
      }
    } catch (err) {
      console.error('Error banning user:', err);
      setError('Failed to ban user');
    } finally {
      setLoading(false);
    }
  };

  const handleUnbanUser = async (principal) => {
    if (!identity) return;

    setLoading(true);
    try {
      const backendActor = createBackendActor(identity);
      const result = await backendActor.unban_user(principal);
      if ('ok' in result) {
        await fetchBans();
        setError(null);
      } else {
        setError(result.err);
      }
    } catch (err) {
      console.error('Error unbanning user:', err);
      setError('Failed to unban user');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className='page-container'>
      <Header />
      <main className="wallet-container">
        <h1 style={{ color: '#ffffff' }}>User Bans Management</h1>
        
        <section style={{ backgroundColor: '#2a2a2a', borderRadius: '8px', padding: '20px', marginTop: '20px' }}>
          <form onSubmit={handleBanUser} style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label style={{ color: '#ffffff' }}>Principal ID</label>
              <input
                type="text"
                value={principalId}
                onChange={(e) => setPrincipalId(e.target.value)}
                placeholder="Enter principal ID to ban"
                style={{
                  backgroundColor: '#3a3a3a',
                  border: '1px solid #4a4a4a',
                  borderRadius: '4px',
                  color: '#ffffff',
                  padding: '8px 12px',
                  width: '100%',
                  fontSize: '14px'
                }}
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label style={{ color: '#ffffff' }}>Ban Duration (hours)</label>
              <input
                type="number"
                value={banDuration}
                onChange={(e) => setBanDuration(e.target.value)}
                min="1"
                style={{
                  backgroundColor: '#3a3a3a',
                  border: '1px solid #4a4a4a',
                  borderRadius: '4px',
                  color: '#ffffff',
                  padding: '8px 12px',
                  width: '100%',
                  fontSize: '14px'
                }}
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label style={{ color: '#ffffff' }}>Ban Reason</label>
              <input
                type="text"
                value={banReason}
                onChange={(e) => setBanReason(e.target.value)}
                placeholder="Enter reason for ban"
                style={{
                  backgroundColor: '#3a3a3a',
                  border: '1px solid #4a4a4a',
                  borderRadius: '4px',
                  color: '#ffffff',
                  padding: '8px 12px',
                  width: '100%',
                  fontSize: '14px'
                }}
              />
            </div>

            <button 
              type="submit" 
              disabled={loading}
              style={{
                backgroundColor: '#3498db',
                color: '#ffffff',
                border: 'none',
                borderRadius: '4px',
                padding: '10px 16px',
                cursor: loading ? 'not-allowed' : 'pointer',
                fontSize: '14px',
                opacity: loading ? 0.7 : 1
              }}
            >
              Ban User
            </button>
          </form>

          {error && (
            <div style={{ 
              color: '#e74c3c', 
              backgroundColor: 'rgba(231, 76, 60, 0.1)', 
              padding: '10px', 
              borderRadius: '4px',
              marginTop: '15px' 
            }}>
              {error}
            </div>
          )}

          <div style={{ marginTop: '30px' }}>
            <h2 style={{ color: '#ffffff', marginBottom: '15px' }}>Currently Banned Users</h2>
            {loading ? (
              <div style={{ color: '#888', textAlign: 'center', padding: '20px' }}>Loading...</div>
            ) : bannedUsers.length === 0 ? (
              <div style={{ color: '#888', textAlign: 'center', padding: '20px' }}>No users are currently banned.</div>
            ) : (
              <div style={{ 
                backgroundColor: '#3a3a3a',
                borderRadius: '6px',
                overflow: 'hidden'
              }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ backgroundColor: '#2c3e50' }}>
                      <th style={{ padding: '12px', color: '#ffffff', textAlign: 'left' }}>Principal ID</th>
                      <th style={{ padding: '12px', color: '#ffffff', textAlign: 'left' }}>Expiry Time</th>
                      <th style={{ padding: '12px', color: '#ffffff', textAlign: 'right' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bannedUsers.map(([principal, expiry], index) => (
                      <tr 
                        key={principal}
                        style={{ 
                          borderTop: '1px solid #4a4a4a',
                          backgroundColor: index % 2 === 0 ? '#2a2a2a' : '#323232'
                        }}
                      >
                        <td style={{ padding: '12px', color: '#ffffff' }}>{principal}</td>
                        <td style={{ padding: '12px', color: '#ffffff' }}>
                          {new Date(Number(expiry) * 1000).toLocaleString()}
                        </td>
                        <td style={{ padding: '12px', textAlign: 'right' }}>
                          <button
                            onClick={() => handleUnbanUser(principal)}
                            style={{
                              backgroundColor: '#e74c3c',
                              color: '#ffffff',
                              border: 'none',
                              borderRadius: '4px',
                              padding: '6px 12px',
                              cursor: 'pointer',
                              fontSize: '14px'
                            }}
                          >
                            Unban
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
} 