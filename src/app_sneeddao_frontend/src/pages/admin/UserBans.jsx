import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../AuthContext';
import { useAdminCheck } from '../../hooks/useAdminCheck';
import { createActor as createBackendActor, canisterId as backendCanisterId } from 'declarations/app_sneeddao_backend';
import Header from '../../components/Header';

export default function UserBans() {
  const { isAuthenticated, identity } = useAuth();
  const navigate = useNavigate();
  const [bannedUsers, setBannedUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [principalId, setPrincipalId] = useState('');
  const [banDuration, setBanDuration] = useState('');
  const [banReason, setBanReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

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
      const backendActor = createBackendActor(backendCanisterId, {
        agentOptions: {
          identity,
          host: process.env.DFX_NETWORK === 'ic' ? 'https://icp0.io' : 'http://localhost:4943',
        }
      });
      const result = await backendActor.get_banned_users();
      if ('ok' in result) {
        // Convert the entries to an array if it's not already
        const bansArray = Array.isArray(result.ok) ? result.ok : Object.entries(result.ok);
        setBannedUsers(bansArray);
        setError('');
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
    if (!identity || !principalId.trim() || !banDuration.trim() || !banReason.trim()) return;

    setIsSubmitting(true);
    try {
      const backendActor = createBackendActor(backendCanisterId, {
        agentOptions: {
          identity,
          host: process.env.DFX_NETWORK === 'ic' ? 'https://icp0.io' : 'http://localhost:4943',
        }
      });
      const result = await backendActor.ban_user(principalId.trim(), BigInt(banDuration), banReason.trim());
      if ('ok' in result) {
        await fetchBans();
        setPrincipalId('');
        setBanDuration('');
        setBanReason('');
        setError('');
      } else {
        setError(result.err);
      }
    } catch (err) {
      console.error('Error banning user:', err);
      setError('Failed to ban user');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUnbanUser = async (principal) => {
    if (!identity) return;

    setIsSubmitting(true);
    try {
      const backendActor = createBackendActor(backendCanisterId, {
        agentOptions: {
          identity,
          host: process.env.DFX_NETWORK === 'ic' ? 'https://icp0.io' : 'http://localhost:4943',
        }
      });
      const result = await backendActor.unban_user(principal);
      if ('ok' in result) {
        await fetchBans();
        setError('');
      } else {
        setError(result.err);
      }
    } catch (err) {
      console.error('Error unbanning user:', err);
      setError('Failed to unban user');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className='page-container'>
      <Header />
      <main className="wallet-container">
        <h1 style={{ color: '#ffffff' }}>User Ban Management</h1>
        
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
              <label style={{ color: '#ffffff' }}>Ban Duration (seconds)</label>
              <input
                type="number"
                value={banDuration}
                onChange={(e) => setBanDuration(e.target.value)}
                placeholder="Enter ban duration in seconds"
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
              disabled={isSubmitting}
              style={{
                backgroundColor: '#3498db',
                color: '#ffffff',
                border: 'none',
                borderRadius: '4px',
                padding: '10px 16px',
                cursor: isSubmitting ? 'not-allowed' : 'pointer',
                fontSize: '14px',
                opacity: isSubmitting ? 0.7 : 1
              }}
            >
              {isSubmitting ? 'Banning...' : 'Ban User'}
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
                      <th style={{ padding: '12px', color: '#ffffff', textAlign: 'left' }}>Expiry</th>
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
                        <td style={{ padding: '12px', color: '#ffffff', fontFamily: 'monospace' }}>{principal}</td>
                        <td style={{ padding: '12px', color: '#ffffff' }}>
                          {new Date(Number(expiry) / 1000000).toLocaleString()}
                        </td>
                        <td style={{ padding: '12px', textAlign: 'right' }}>
                          <button
                            onClick={() => handleUnbanUser(principal)}
                            disabled={isSubmitting}
                            style={{
                              backgroundColor: '#e74c3c',
                              color: '#ffffff',
                              border: 'none',
                              borderRadius: '4px',
                              padding: '6px 12px',
                              cursor: isSubmitting ? 'not-allowed' : 'pointer',
                              fontSize: '14px',
                              opacity: isSubmitting ? 0.7 : 1
                            }}
                          >
                            {isSubmitting ? 'Unbanning...' : 'Unban'}
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